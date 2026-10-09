/**
 * Maintenance scheduling (Architecture.md §22, §23).
 *
 * A plan may carry any combination of a distance interval, a time interval and an engine-hour
 * interval. "Every 10,000 km OR every 12 months, whichever comes first" is the common case,
 * and *whichever comes first* is the whole rule: each configured interval produces a due
 * point, and the one arriving soonest decides the plan's state.
 *
 * Pure on purpose — no database, no clock beyond the `now` passed in. This is the highest
 * bug-density logic in the product and the one place a mistake shows up as a service that
 * silently never comes due.
 */

import { convertDistance, type DistanceUnit } from '@vehicle-os/domain';
import { addMonths, daysBetween, toDateOnly } from '@vehicle-os/utils';

export type DueStatus = 'OK' | 'DUE_SOON' | 'OVERDUE' | 'UNSCHEDULED';
export type DueTrigger = 'DATE' | 'DISTANCE' | 'ENGINE_HOURS';

export interface MaintenanceInterval {
  readonly intervalDistance: number | null;
  readonly intervalDistanceUnit: DistanceUnit | null;
  readonly intervalMonths: number | null;
  readonly intervalEngineHours: number | null;
  /**
   * The baseline the intervals count from — the last completion, or the vehicle's state when
   * the plan was created. Never null in practice: a plan without a baseline has nothing to
   * measure from, so creation seeds it.
   */
  readonly lastPerformedAt: Date | null;
  readonly lastPerformedOdometer: number | null;
  readonly lastPerformedEngineHours: number | null;
}

export interface VehicleUsage {
  readonly currentOdometer: number | null;
  /** The unit the vehicle's readings are stored in; may differ from the interval's. */
  readonly odometerUnit: DistanceUnit;
  readonly currentEngineHours: number | null;
}

export interface DueResult {
  readonly status: DueStatus;
  /** Which interval arrives first. Null when nothing is scheduled. */
  readonly trigger: DueTrigger | null;
  /** `YYYY-MM-DD`, when a time interval is configured. */
  readonly nextDueDate: string | null;
  /** In the *vehicle's* odometer unit, so a client can compare it without converting. */
  readonly nextDueOdometer: number | null;
  readonly nextDueEngineHours: number | null;
  /** Negative once overdue, in each dimension that is configured. */
  readonly daysRemaining: number | null;
  readonly distanceRemaining: number | null;
  readonly engineHoursRemaining: number | null;
}

/**
 * How close counts as "soon".
 *
 * "Soon" means "book it in the next couple of weeks", so the thresholds are absolute: two
 * weeks is two weeks, and 500 km is about a fortnight of ordinary driving whether the
 * interval is a 10,000 km oil change or a 60,000 km timing belt. Scaling the distance to the
 * interval gets this backwards — it would stay quiet at 500 km from a belt change, which is
 * the one you least want to miss.
 *
 * The fraction is only a cap, so a short interval does not warn from the moment it resets:
 * a 1,000 km chain lube warns in its last 250 km rather than half its life.
 */
const DUE_SOON_DAYS = 14;
const DUE_SOON_KM = 500;
const DUE_SOON_ENGINE_HOURS = 10;
const DUE_SOON_MAX_FRACTION = 0.25;

export function computeNextDue(
  plan: MaintenanceInterval,
  usage: VehicleUsage,
  now: Date = new Date(),
): DueResult {
  const hasDistance = plan.intervalDistance !== null && plan.intervalDistance > 0;
  const hasTime = plan.intervalMonths !== null && plan.intervalMonths > 0;
  const hasHours = plan.intervalEngineHours !== null && plan.intervalEngineHours > 0;

  if (!hasDistance && !hasTime && !hasHours) {
    return {
      status: 'UNSCHEDULED',
      trigger: null,
      nextDueDate: null,
      nextDueOdometer: null,
      nextDueEngineHours: null,
      daysRemaining: null,
      distanceRemaining: null,
      engineHoursRemaining: null,
    };
  }

  // --- Time -----------------------------------------------------------------
  let nextDueDate: string | null = null;
  let daysRemaining: number | null = null;
  if (hasTime && plan.lastPerformedAt) {
    const due = addMonths(plan.lastPerformedAt, plan.intervalMonths!);
    nextDueDate = toDateOnly(due);
    daysRemaining = daysBetween(now, due);
  }

  // --- Distance -------------------------------------------------------------
  let nextDueOdometer: number | null = null;
  let distanceRemaining: number | null = null;
  if (hasDistance && plan.lastPerformedOdometer !== null) {
    /*
     * The interval carries its own unit, which need not match the vehicle's. Converting the
     * interval into the vehicle's unit — rather than the other way round — keeps the answer
     * in the unit the odometer is actually read in, so no client has to convert to compare.
     */
    const intervalInVehicleUnit = convertDistance(
      plan.intervalDistance!,
      plan.intervalDistanceUnit ?? usage.odometerUnit,
      usage.odometerUnit,
    );
    nextDueOdometer = Math.round(plan.lastPerformedOdometer + intervalInVehicleUnit);

    if (usage.currentOdometer !== null) {
      distanceRemaining = nextDueOdometer - usage.currentOdometer;
    }
  }

  // --- Engine hours ---------------------------------------------------------
  let nextDueEngineHours: number | null = null;
  let engineHoursRemaining: number | null = null;
  if (hasHours && plan.lastPerformedEngineHours !== null) {
    nextDueEngineHours = plan.lastPerformedEngineHours + plan.intervalEngineHours!;
    if (usage.currentEngineHours !== null) {
      engineHoursRemaining = nextDueEngineHours - usage.currentEngineHours;
    }
  }

  /*
   * Each configured dimension votes, and the worst state wins — that is what "whichever
   * comes first" means. A dimension with no reading to compare against (a plan with a
   * distance interval on a vehicle whose odometer was never set) simply does not vote,
   * rather than blocking the others or defaulting to OK.
   */
  const votes: { status: DueStatus; trigger: DueTrigger; urgency: number }[] = [];

  /*
   * Every urgency is expressed in the same currency: how many "soon" windows are left.
   * Raw units are not comparable — 151 days overdue and 6,000 km overdue are both large
   * numbers describing entirely different things, and mixing them makes the reported
   * trigger depend on which dimension happened to be evaluated first.
   */
  const vote = (remaining: number, threshold: number, trigger: DueTrigger): void => {
    const window = Math.max(1, threshold);
    votes.push({
      status: remaining < 0 ? 'OVERDUE' : remaining <= window ? 'DUE_SOON' : 'OK',
      trigger,
      urgency: remaining / window,
    });
  };

  if (daysRemaining !== null && plan.intervalMonths !== null) {
    // Roughly 30 days a month is close enough for a cap that only bounds short intervals.
    const cap = plan.intervalMonths * 30 * DUE_SOON_MAX_FRACTION;
    vote(daysRemaining, Math.min(DUE_SOON_DAYS, cap), 'DATE');
  }

  if (distanceRemaining !== null && plan.intervalDistance !== null) {
    const intervalInVehicleUnit = convertDistance(
      plan.intervalDistance,
      plan.intervalDistanceUnit ?? usage.odometerUnit,
      usage.odometerUnit,
    );
    const fixed = convertDistance(DUE_SOON_KM, 'KM', usage.odometerUnit);
    vote(
      distanceRemaining,
      Math.min(fixed, intervalInVehicleUnit * DUE_SOON_MAX_FRACTION),
      'DISTANCE',
    );
  }

  if (engineHoursRemaining !== null && plan.intervalEngineHours !== null) {
    const cap = plan.intervalEngineHours * DUE_SOON_MAX_FRACTION;
    vote(engineHoursRemaining, Math.min(DUE_SOON_ENGINE_HOURS, cap), 'ENGINE_HOURS');
  }

  if (votes.length === 0) {
    // Intervals are configured but nothing can be measured yet — a distance-based plan on a
    // vehicle with no odometer reading. Not "OK": nothing has been checked.
    return {
      status: 'UNSCHEDULED',
      trigger: null,
      nextDueDate,
      nextDueOdometer,
      nextDueEngineHours,
      daysRemaining,
      distanceRemaining,
      engineHoursRemaining,
    };
  }

  const RANK: Record<DueStatus, number> = { OVERDUE: 0, DUE_SOON: 1, OK: 2, UNSCHEDULED: 3 };
  const winner = votes.reduce((worst, vote) => {
    if (RANK[vote.status] !== RANK[worst.status]) {
      return RANK[vote.status] < RANK[worst.status] ? vote : worst;
    }
    // Same status: the one furthest along decides, so an item overdue by 5,000 km reports
    // DISTANCE rather than whichever dimension happened to be evaluated first.
    return vote.urgency < worst.urgency ? vote : worst;
  });

  return {
    status: winner.status,
    trigger: winner.trigger,
    nextDueDate,
    nextDueOdometer,
    nextDueEngineHours,
    daysRemaining,
    distanceRemaining,
    engineHoursRemaining,
  };
}

/**
 * Where a completed service resets the clock to.
 *
 * The reading *at completion* is the new baseline, not the reading now — logging a service
 * performed last month at 38,000 km must schedule the next one from there, not from today's
 * 42,000 km, which would push it 4,000 km late.
 */
export function baselineAfterCompletion(record: {
  performedAt: Date;
  odometer: number | null;
  odometerUnit: DistanceUnit | null;
  engineHours: number | null;
  vehicleOdometerUnit: DistanceUnit;
}): {
  lastPerformedAt: Date;
  lastPerformedOdometer: number | null;
  lastPerformedEngineHours: number | null;
} {
  const odometer =
    record.odometer === null
      ? null
      : Math.round(
          convertDistance(
            record.odometer,
            record.odometerUnit ?? record.vehicleOdometerUnit,
            record.vehicleOdometerUnit,
          ),
        );

  return {
    lastPerformedAt: record.performedAt,
    lastPerformedOdometer: odometer,
    lastPerformedEngineHours: record.engineHours,
  };
}
