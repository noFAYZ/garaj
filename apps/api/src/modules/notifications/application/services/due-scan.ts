/**
 * The maintenance due scan (Architecture.md §36, §84; PRD §31).
 *
 * Runs on a schedule, finds work that has become due or overdue, and enqueues one
 * notification per person who should hear about it. "Contextual rather than noisy" is
 * enforced by the dedupe key: a plan that stays overdue for six weeks produces one
 * notification, not forty-two, because every scan derives the same key for the same cycle.
 */

import { eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@vehicle-os/database';
import { computeNextDue } from '../../../maintenance/domain/next-due';
import {
  listPlansForDueScan,
  type PlanWithVehicle,
} from '../../../maintenance/infrastructure/repositories/maintenance-repository';
import { displayName } from '../../../vehicles/domain/entities/vehicle';
import { notifyOnce, type PendingNotification } from './notify';

export interface ScanResult {
  readonly scanned: number;
  readonly due: number;
  readonly notified: number;
}

/**
 * Identity for one notification about one *cycle* of one plan.
 *
 * The due point is part of the key, so the reminder repeats after the next service moves it
 * — but not before. A key of just the plan id would notify once and then never again, even
 * years later when the item came due afresh.
 */
export function dedupeKey(
  planId: string,
  due: {
    nextDueDate: string | null;
    nextDueOdometer: number | null;
    nextDueEngineHours: number | null;
  },
  status: string,
): string {
  const cycle = [due.nextDueDate, due.nextDueOdometer, due.nextDueEngineHours]
    .map((part) => part ?? '-')
    .join('|');
  // The status is in the key so an item that slips from DUE_SOON to OVERDUE says so once,
  // rather than staying silent because the earlier warning already went out.
  return `MAINTENANCE:${status}:${planId}:${cycle}`;
}

/**
 * Everyone who should hear about work on a vehicle: the members of its garage.
 *
 * VIEWERs included — being unable to act on something is not a reason to be kept unaware of
 * it, and a shared garage is exactly where a second person noticing matters.
 */
async function recipientsFor(db: Database, vehicleIds: readonly string[]) {
  if (vehicleIds.length === 0) return new Map<string, string[]>();

  const rows = await db
    .select({
      vehicleId: schema.vehicles.id,
      userId: schema.garageMembers.userId,
    })
    .from(schema.vehicles)
    .innerJoin(schema.garageMembers, eq(schema.garageMembers.garageId, schema.vehicles.garageId))
    .where(inArray(schema.vehicles.id, [...vehicleIds]));

  const byVehicle = new Map<string, string[]>();
  for (const row of rows) {
    const list = byVehicle.get(row.vehicleId) ?? [];
    list.push(row.userId);
    byVehicle.set(row.vehicleId, list);
  }
  return byVehicle;
}

function describe(row: PlanWithVehicle, due: ReturnType<typeof computeNextDue>) {
  const vehicle = displayName({
    nickname: row.nickname,
    year: row.year,
    make: row.make,
    model: row.model,
    vehicleType: row.vehicleType,
  });

  /*
   * The message names the reason, because "maintenance due" alone tells the user nothing
   * they can act on. PRD §31's example is "BMW M3 is 1,200 km from its scheduled oil
   * service" — the distance is the whole point.
   */
  if (due.trigger === 'DISTANCE' && due.distanceRemaining !== null) {
    const unit = row.odometerUnit.toLowerCase();
    const body =
      due.distanceRemaining < 0
        ? `${vehicle} is ${Math.abs(due.distanceRemaining)} ${unit} past its ${row.plan.title}.`
        : `${vehicle} is ${due.distanceRemaining} ${unit} from its ${row.plan.title}.`;
    return { title: row.plan.title, body };
  }

  if (due.trigger === 'ENGINE_HOURS' && due.engineHoursRemaining !== null) {
    const body =
      due.engineHoursRemaining < 0
        ? `${vehicle} is ${Math.abs(due.engineHoursRemaining)} hours past its ${row.plan.title}.`
        : `${vehicle} is ${due.engineHoursRemaining} hours from its ${row.plan.title}.`;
    return { title: row.plan.title, body };
  }

  const days = due.daysRemaining;
  if (days === null)
    return { title: row.plan.title, body: `${vehicle}: ${row.plan.title} is due.` };

  const body =
    days < 0
      ? `${vehicle}: ${row.plan.title} was due ${Math.abs(days)} days ago.`
      : days === 0
        ? `${vehicle}: ${row.plan.title} is due today.`
        : `${vehicle}: ${row.plan.title} is due in ${days} days.`;
  return { title: row.plan.title, body };
}

export async function scanForDueMaintenance(
  db: Database,
  now: Date = new Date(),
): Promise<ScanResult> {
  /*
   * The horizon is generous because the SQL filter is deliberately coarse — it cannot judge
   * a distance interval, so `computeNextDue` decides afterwards. Filtering precisely in SQL
   * would mean writing the domain rules a second time, in a language where they would drift.
   */
  const horizon = new Date(now.getTime() + 30 * 86_400_000);
  const rows = await listPlansForDueScan(db, horizon);

  const actionable = rows
    .map((row) => ({
      row,
      due: computeNextDue(
        row.plan,
        {
          currentOdometer: row.currentOdometer,
          odometerUnit: row.odometerUnit,
          currentEngineHours: row.currentEngineHours,
        },
        now,
      ),
    }))
    .filter(({ due }) => due.status === 'DUE_SOON' || due.status === 'OVERDUE');

  if (actionable.length === 0) {
    return { scanned: rows.length, due: 0, notified: 0 };
  }

  const recipients = await recipientsFor(
    db,
    actionable.map(({ row }) => row.vehicleId),
  );

  // Already told them about this cycle? The dedupe key makes that a skipped row, not the noise
  // §36 forbids.
  const notified = await notifyOnce(
    db,
    actionable.flatMap<PendingNotification>(({ row, due }) => {
      const { title, body } = describe(row, due);
      return (recipients.get(row.vehicleId) ?? []).map((userId) => ({
        jobName: 'deliver-maintenance-reminder',
        row: {
          userId,
          garageId: null,
          vehicleId: row.vehicleId,
          notificationType: due.status === 'OVERDUE' ? 'MAINTENANCE_OVERDUE' : 'MAINTENANCE_DUE',
          title,
          body,
          payload: { planId: row.plan.id, trigger: due.trigger },
          dedupeKey: dedupeKey(row.plan.id, due, due.status),
        },
      }));
    }),
  );

  return { scanned: rows.length, due: actionable.length, notified };
}
