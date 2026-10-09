/**
 * Timeline event commands (Architecture.md §20, §21).
 *
 * An event is the unit the whole product is built on: it is what appears on the timeline,
 * what carries the odometer forward, and what maintenance, expenses and documents attach to.
 */

import type { Database } from '@vehicle-os/database';
import {
  assertCurrency,
  distance,
  isOdometerRegression,
  MoneyError,
  type ActorContext,
  type DistanceUnit,
  type EventType,
} from '@vehicle-os/domain';
import { NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import {
  mirrorEventExpense,
  removeMirroredExpense,
} from '../../../expenses/application/commands/mirror-event-expense';
import type { CommandMeta } from '../../../garages/application/commands/create-garage';
import {
  findVehicleById,
  raiseEngineHours,
  raiseOdometer,
} from '../../../vehicles/infrastructure/repositories/vehicle-repository';
import { resolveTrip, type TripInput } from '../../domain/trip';
import {
  deleteEvent,
  findEventById,
  insertEvent,
  latestOdometerBefore,
  updateEvent,
  type EventRow,
} from '../../infrastructure/repositories/event-repository';

export interface EventWarning {
  readonly code: string;
  readonly message: string;
}

export interface EventResult {
  readonly event: EventRow;
  readonly warnings: EventWarning[];
}

export interface RecordEventInput {
  /** Chosen by the client for an entry made offline; makes this create idempotent. */
  readonly id?: string;
  readonly eventType: EventType;
  readonly title: string;
  readonly description?: string;
  readonly occurredAt: string;
  readonly odometer?: number;
  readonly odometerUnit?: DistanceUnit;
  readonly engineHours?: number;
  readonly costAmountMinor?: number;
  readonly costCurrency?: string;
  readonly provider?: string;
  readonly trip?: TripInput;
}

/**
 * Trip detail for the row, or field errors. Only a `TRIP` carries one: a mileage claim on a
 * fuel stop is a data-entry slip, and accepting it would put a fill-up on a tax report.
 */
function tripColumns(
  eventType: EventType,
  trip: TripInput | null | undefined,
  endOdometer: number | null | undefined,
  fields: Record<string, string>,
) {
  const cleared = {
    tripPurpose: null,
    tripStartOdometer: null,
    tripDistance: null,
    mileageRateMinor: null,
    mileageRateCurrency: null,
  };
  if (!trip) return cleared;
  if (eventType !== 'TRIP') {
    fields.trip = 'Only a trip can carry mileage detail.';
    return cleared;
  }
  const resolved = resolveTrip(trip, endOdometer);
  if ('errors' in resolved) {
    Object.assign(fields, resolved.errors);
    return cleared;
  }
  return resolved.trip;
}

/** Bounds the date rather than the value: a service cannot have been performed next year. */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

function validateShared(
  input: { occurredAt?: string; costAmountMinor?: number | null; costCurrency?: string },
  fields: Record<string, string>,
): void {
  if (input.occurredAt) {
    const when = new Date(input.occurredAt);
    if (Number.isNaN(when.getTime())) fields.occurredAt = 'Not a valid date.';
    else if (when.getTime() > Date.now() + MAX_FUTURE_MS) {
      fields.occurredAt = 'An event cannot be recorded in the future. Create a task instead.';
    }
  }

  // Amount and currency travel together or not at all (§79).
  const hasAmount = input.costAmountMinor !== undefined && input.costAmountMinor !== null;
  const hasCurrency = input.costCurrency !== undefined;
  if (hasAmount && !hasCurrency) fields.costCurrency = 'A cost needs a currency.';
  if (hasCurrency) {
    try {
      assertCurrency(input.costCurrency!);
    } catch (error) {
      if (error instanceof MoneyError) fields.costCurrency = error.message;
      else throw error;
    }
  }
}

/**
 * An odometer reading below the previous one is reported, not rejected.
 *
 * Clusters get replaced, dashboards get misread off a photo, and imported data is imperfect.
 * Blocking the write would leave someone unable to record what actually happened, which is
 * worse than a flagged row — so this returns a warning and the event is saved.
 */
async function odometerWarning(
  db: Database,
  vehicleId: string,
  occurredAt: Date,
  odometer: number,
  unit: DistanceUnit,
): Promise<EventWarning | null> {
  const previous = await latestOdometerBefore(db, vehicleId, occurredAt);
  if (!previous) return null;

  const before = distance(previous.odometer, previous.odometerUnit);
  if (!isOdometerRegression(before, distance(odometer, unit))) return null;

  return {
    code: 'ODOMETER_REGRESSION',
    message:
      `This reading (${odometer} ${unit.toLowerCase()}) is lower than the previous one ` +
      `(${previous.odometer} ${previous.odometerUnit.toLowerCase()}). Saved anyway — ` +
      'check the value if that was not intentional.',
  };
}

/*
 * Creating an event is not separately audited: the event *is* the record, and it is already
 * visible on the timeline with its author and timestamp. Editing and deleting one changes
 * history that someone else may have relied on, so those are audited (§57).
 */
export async function recordEvent(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  input: RecordEventInput,
): Promise<EventResult> {
  const vehicle = await findVehicleById(db, vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle');

  const fields: Record<string, string> = {};
  validateShared(input, fields);
  if (input.odometer !== undefined && input.odometerUnit === undefined) {
    fields.odometerUnit = 'An odometer reading needs its unit.';
  }
  const trip = tripColumns(input.eventType, input.trip, input.odometer, fields);
  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

  const occurredAt = new Date(input.occurredAt);
  const warnings: EventWarning[] = [];

  if (input.odometer !== undefined && input.odometerUnit) {
    const warning = await odometerWarning(
      db,
      vehicleId,
      occurredAt,
      input.odometer,
      input.odometerUnit,
    );
    if (warning) warnings.push(warning);
  }

  const event = await db.transaction(async (tx) => {
    const { row: created, created: isNew } = await insertEvent(tx, {
      ...(input.id ? { id: input.id } : {}),
      vehicleId,
      eventType: input.eventType,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      occurredAt,
      odometer: input.odometer ?? null,
      // A trip with only a typed distance still needs to say what that distance is in.
      odometerUnit: input.odometerUnit ?? (input.trip ? vehicle.odometerUnit : null),
      engineHours: input.engineHours ?? null,
      ...trip,
      costAmountMinor: input.costAmountMinor ?? null,
      costCurrency: input.costCurrency ?? null,
      provider: input.provider?.trim() || null,
      source: 'USER',
      createdBy: actor.userId,
    });

    /*
     * Everything below happens once per entry, not once per attempt. A replay of a queued write
     * must not mirror a second expense or raise the odometer again — the first attempt already
     * did both, and this one exists only because its answer went missing.
     */
    if (!isNew) return created;

    // A cost on the timeline is money spent on the vehicle, so it becomes an expense in the
    // same transaction — a total assembled from only one of the two screens is wrong.
    await mirrorEventExpense(tx, created, actor.userId);

    /*
     * The cached reading on the vehicle only ever moves forward (see `raiseOdometer`), so
     * back-filling an old receipt adds it to the timeline without rewriting the present.
     */
    if (input.odometer !== undefined) await raiseOdometer(tx, vehicleId, input.odometer);
    if (input.engineHours !== undefined) await raiseEngineHours(tx, vehicleId, input.engineHours);

    return created;
  });

  return { event, warnings };
}

/**
 * The edit shape is not `Partial<RecordEventInput>`: on create, an omitted optional field
 * simply is not set, while on edit `null` is a meaningful value meaning "clear this". The
 * two need different types or clearing a description becomes impossible to express.
 */
export interface EditEventInput {
  readonly eventType?: EventType;
  readonly title?: string;
  readonly description?: string | null;
  readonly occurredAt?: string;
  readonly odometer?: number | null;
  readonly odometerUnit?: DistanceUnit;
  readonly engineHours?: number | null;
  readonly costAmountMinor?: number | null;
  readonly costCurrency?: string;
  readonly provider?: string | null;
  readonly trip?: TripInput | null;
}

export async function editEvent(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  eventId: string,
  garageId: string,
  input: EditEventInput,
  meta: CommandMeta,
): Promise<EventResult> {
  const existing = await findEventById(db, vehicleId, eventId);
  if (!existing) throw new NotFoundError('Event');

  const fields: Record<string, string> = {};
  validateShared(input, fields);

  // A reading needs a unit — either supplied now or already on the row from before.
  if (input.odometer != null && !(input.odometerUnit ?? existing.odometerUnit)) {
    fields.odometerUnit = 'An odometer reading needs its unit.';
  }
  /*
   * The trip is re-resolved whenever it, the type or the end reading changes: a corrected
   * end reading re-measures the distance, and a trip turned into something else loses its
   * mileage detail rather than keeping a claim on a row that is no longer a trip.
   */
  const tripTouched =
    input.trip !== undefined || input.eventType !== undefined || input.odometer !== undefined;
  const nextType = input.eventType ?? existing.eventType;
  const currentTrip: TripInput | null =
    existing.tripPurpose === null
      ? null
      : {
          purpose: existing.tripPurpose,
          startOdometer: existing.tripStartOdometer,
          // Re-measured from the readings when there are any, kept as typed otherwise.
          distance: existing.tripStartOdometer === null ? existing.tripDistance : null,
          rateMinor: existing.mileageRateMinor,
          rateCurrency: existing.mileageRateCurrency,
        };
  const trip = tripTouched
    ? tripColumns(
        nextType,
        input.trip === undefined ? (nextType === 'TRIP' ? currentTrip : null) : input.trip,
        input.odometer === undefined ? existing.odometer : input.odometer,
        fields,
      )
    : null;
  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

  const changes: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) changes[key] = value;
  };

  assign('eventType', input.eventType);
  assign('title', input.title?.trim());
  assign(
    'description',
    input.description === undefined ? undefined : (input.description?.trim() ?? null),
  );
  assign('occurredAt', input.occurredAt ? new Date(input.occurredAt) : undefined);
  assign('odometer', input.odometer);
  assign('odometerUnit', input.odometerUnit);
  assign('engineHours', input.engineHours);
  assign('costAmountMinor', input.costAmountMinor);
  assign('costCurrency', input.costCurrency);
  assign('provider', input.provider === undefined ? undefined : (input.provider?.trim() ?? null));
  if (trip) Object.assign(changes, trip);

  await db.transaction(async (tx) => {
    await updateEvent(tx, eventId, changes);

    // Re-read rather than merging `changes` by hand: the mirror has to follow the row as it
    // now stands, and a second copy of the merge logic is a second thing to get wrong.
    const current = await findEventById(tx, vehicleId, eventId);
    if (current) await mirrorEventExpense(tx, current, actor.userId);

    if (input.odometer != null) await raiseOdometer(tx, vehicleId, input.odometer);
    if (input.engineHours != null) await raiseEngineHours(tx, vehicleId, input.engineHours);

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'event.updated',
      resourceType: 'vehicle_event',
      resourceId: eventId,
      metadata: { vehicleId, changed: Object.keys(changes) },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
  });

  const updated = await findEventById(db, vehicleId, eventId);
  if (!updated) throw new NotFoundError('Event');
  return { event: updated, warnings: [] };
}

/**
 * Deleting an event is audited. It is a hard delete — the timeline is the product's record
 * of what happened, and a hidden-but-present event would still be counted by every rollup
 * while being invisible to the person trying to work out why the total is wrong.
 */
export async function removeEvent(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  eventId: string,
  garageId: string,
  meta: CommandMeta,
): Promise<void> {
  const existing = await findEventById(db, vehicleId, eventId);
  if (!existing) throw new NotFoundError('Event');

  await db.transaction(async (tx) => {
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'event.deleted',
      resourceType: 'vehicle_event',
      resourceId: eventId,
      metadata: {
        vehicleId,
        eventType: existing.eventType,
        title: existing.title,
        occurredAt: existing.occurredAt.toISOString(),
      },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
    // Before the event goes: `event_id` is `set null` on delete, so the derived expense
    // would otherwise survive as an orphan that every total still counts.
    await removeMirroredExpense(tx, eventId);
    await deleteEvent(tx, eventId);
  });
}
