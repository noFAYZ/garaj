/**
 * Expense commands (Architecture.md §27).
 *
 * An expense is a financial record, so the rules are stricter than elsewhere: the amount and
 * its currency are both required, deletion is real rather than soft, and every write is
 * audited in the same transaction.
 */

import { eq } from 'drizzle-orm';
import { schema, type Database, type Executor } from '@vehicle-os/database';
import {
  assertCurrency,
  MoneyError,
  type ActorContext,
  type DistanceUnit,
  type ExpenseCategory,
  type FuelType,
  type QuantityUnit,
} from '@vehicle-os/domain';
import { NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import type { CommandMeta } from '../../../garages/application/commands/create-garage';
import { raiseOdometer } from '../../../vehicles/infrastructure/repositories/vehicle-repository';
import {
  deleteEvent,
  findEventById,
  insertEvent,
  updateEvent,
} from '../../../events/infrastructure/repositories/event-repository';
import { categoryForEventType, eventTypeForCategory } from '../../domain/event-category';
import {
  deleteExpense,
  findExpenseById,
  insertExpense,
  updateExpense,
  type ExpenseRow,
} from '../../infrastructure/repositories/expense-repository';

export interface CreateExpenseInput {
  readonly category: ExpenseCategory;
  readonly description: string;
  readonly vendor?: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly occurredAt: string;
  readonly odometer?: number;
  readonly odometerUnit?: DistanceUnit;
  readonly fuelType?: FuelType;
  readonly quantity?: string;
  readonly quantityUnit?: QuantityUnit;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly energyKwh?: string;
  readonly isFullTank?: boolean;
}

/**
 * A decimal quantity, as text.
 *
 * Kept as a string all the way to the `numeric` column: parsing "48.72" into a float to
 * validate it and writing the float back is how a year of fill-ups drifts off by a litre.
 */
const DECIMAL_PATTERN = /^\d{1,8}(\.\d{1,4})?$/;

function validateCommon(
  input: {
    currency?: string;
    quantity?: string | null;
    energyKwh?: string | null;
  },
  fields: Record<string, string>,
): void {
  if (input.currency) {
    try {
      assertCurrency(input.currency);
    } catch (error) {
      if (error instanceof MoneyError) fields.currency = error.message;
      else throw error;
    }
  }

  for (const key of ['quantity', 'energyKwh'] as const) {
    const value = input[key];
    if (value != null && !DECIMAL_PATTERN.test(value)) {
      fields[key] = 'Must be a positive number with up to four decimal places.';
    }
  }
}

export async function createExpense(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  garageId: string,
  input: CreateExpenseInput,
  meta: CommandMeta,
): Promise<ExpenseRow> {
  const fields: Record<string, string> = {};
  validateCommon(input, fields);
  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

  return db.transaction(async (tx) => {
    /*
     * The activity item first, then the expense pointing at it. Every expense is an event
     * carrying its cost, so a fill-up recorded on the spending page appears in the vehicle's
     * activity rather than only in the totals. One transaction: neither exists without the
     * other. Written straight through the repository rather than `recordEvent`, which would
     * mirror a second expense off the event's cost.
     */
    const { row: event } = await insertEvent(tx, {
      vehicleId,
      eventType: eventTypeForCategory(input.category),
      title: input.description.trim(),
      occurredAt: new Date(input.occurredAt),
      odometer: input.odometer ?? null,
      odometerUnit: input.odometerUnit ?? null,
      costAmountMinor: input.amountMinor,
      costCurrency: input.currency,
      provider: input.vendor?.trim() || null,
      source: 'USER',
      createdBy: actor.userId,
    });

    const expense = await insertExpense(tx, {
      vehicleId,
      eventId: event.id,
      category: input.category,
      description: input.description.trim(),
      vendor: input.vendor?.trim() || null,
      amountMinor: input.amountMinor,
      currency: input.currency,
      occurredAt: new Date(input.occurredAt),
      odometer: input.odometer ?? null,
      odometerUnit: input.odometerUnit ?? null,
      fuelType: input.fuelType ?? null,
      quantity: input.quantity ?? null,
      quantityUnit: input.quantityUnit ?? null,
      // Stored as strings: `numeric` round-trips exactly that way, and a float here would
      // make the same forecourt two different places on two different devices.
      latitude: input.latitude === undefined ? null : String(input.latitude),
      longitude: input.longitude === undefined ? null : String(input.longitude),
      energyKwh: input.energyKwh ?? null,
      // The column is an integer flag, not a boolean, so null still means "not stated".
      isFullTank: input.isFullTank === undefined ? null : input.isFullTank ? 1 : 0,
      source: 'USER',
      createdBy: actor.userId,
    });

    /*
     * A fill-up is a reading like any other. `raiseOdometer` only moves the vehicle forward,
     * so entering a receipt from last spring does not drag today's odometer backwards.
     */
    if (input.odometer !== undefined) await raiseOdometer(tx, vehicleId, input.odometer);

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'expense.created',
      resourceType: 'expense',
      resourceId: expense.id,
      metadata: {
        vehicleId,
        category: expense.category,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
      },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });

    return expense;
  });
}

export interface UpdateExpenseInput {
  readonly category?: ExpenseCategory;
  readonly description?: string;
  readonly vendor?: string | null;
  readonly amountMinor?: number;
  readonly currency?: string;
  readonly occurredAt?: string;
  readonly odometer?: number | null;
  readonly odometerUnit?: DistanceUnit;
  readonly fuelType?: FuelType | null;
  readonly quantity?: string | null;
  readonly quantityUnit?: QuantityUnit;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly energyKwh?: string | null;
  readonly isFullTank?: boolean | null;
}

/**
 * Carries an expense correction onto the activity item it records.
 *
 * Written straight to the event rather than through `editEvent`, which would mirror the event
 * back onto this expense mid-edit. The item's type follows the category only when the
 * category stops describing it: an inspection filed as maintenance stays an inspection.
 */
async function syncEventFromExpense(
  tx: Executor,
  vehicleId: string,
  eventId: string,
  input: UpdateExpenseInput,
): Promise<void> {
  const event = await findEventById(tx, vehicleId, eventId);
  if (!event) return;

  const changes: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) changes[key] = value;
  };

  if (input.category !== undefined && categoryForEventType(event.eventType) !== input.category) {
    changes.eventType = eventTypeForCategory(input.category);
  }
  assign('title', input.description?.trim());
  assign('provider', input.vendor === undefined ? undefined : input.vendor?.trim() || null);
  assign('costAmountMinor', input.amountMinor);
  assign('costCurrency', input.currency);
  assign('occurredAt', input.occurredAt === undefined ? undefined : new Date(input.occurredAt));
  assign('odometer', input.odometer);
  assign('odometerUnit', input.odometerUnit);

  await updateEvent(tx, eventId, changes);
}

/**
 * What happens to an expense's activity item when the expense is deleted.
 *
 * Usually it goes too: the item *was* that expense, and a costless "Fuel" left behind would be
 * a record of nothing. A completed service is the exception — its item is also the service
 * record's timeline entry, and deleting the money must not erase the fact that the work was
 * done — so there only the cost is cleared.
 */
async function releaseEvent(tx: Executor, eventId: string): Promise<void> {
  const [record] = await tx
    .select({ id: schema.maintenanceRecords.id })
    .from(schema.maintenanceRecords)
    .where(eq(schema.maintenanceRecords.eventId, eventId))
    .limit(1);

  if (record) {
    await updateEvent(tx, eventId, { costAmountMinor: null, costCurrency: null });
    return;
  }
  await deleteEvent(tx, eventId);
}

export async function editExpense(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  garageId: string,
  expenseId: string,
  input: UpdateExpenseInput,
  meta: CommandMeta,
): Promise<ExpenseRow> {
  const existing = await findExpenseById(db, vehicleId, expenseId);
  if (!existing) throw new NotFoundError('Expense');

  const fields: Record<string, string> = {};
  validateCommon(input, fields);
  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

  const changes: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) changes[key] = value;
  };

  assign('category', input.category);
  assign('description', input.description?.trim());
  assign('vendor', input.vendor === undefined ? undefined : (input.vendor?.trim() ?? null));
  assign('amountMinor', input.amountMinor);
  assign('currency', input.currency);
  assign('occurredAt', input.occurredAt === undefined ? undefined : new Date(input.occurredAt));
  assign('odometer', input.odometer);
  assign('odometerUnit', input.odometerUnit);
  assign('fuelType', input.fuelType);
  assign('quantity', input.quantity);
  assign('quantityUnit', input.quantityUnit);
  if (input.latitude !== undefined) assign('latitude', String(input.latitude));
  if (input.longitude !== undefined) assign('longitude', String(input.longitude));
  assign('energyKwh', input.energyKwh);
  assign(
    'isFullTank',
    input.isFullTank === undefined
      ? undefined
      : input.isFullTank === null
        ? null
        : input.isFullTank
          ? 1
          : 0,
  );

  return db.transaction(async (tx) => {
    await updateExpense(tx, expenseId, changes);
    // The activity item moves with the expense it records, in the same transaction.
    if (existing.eventId) await syncEventFromExpense(tx, vehicleId, existing.eventId, input);

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'expense.updated',
      resourceType: 'expense',
      resourceId: expenseId,
      // The old amount is kept in the entry: a corrected total is only auditable if the
      // figure it replaced is written down somewhere.
      metadata: {
        vehicleId,
        changed: Object.keys(changes),
        previousAmountMinor: existing.amountMinor,
        previousCurrency: existing.currency,
      },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });

    const updated = await findExpenseById(tx, vehicleId, expenseId);
    if (!updated) throw new NotFoundError('Expense');
    return updated;
  });
}

export async function removeExpense(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  garageId: string,
  expenseId: string,
  meta: CommandMeta,
): Promise<void> {
  const existing = await findExpenseById(db, vehicleId, expenseId);
  if (!existing) throw new NotFoundError('Expense');

  await db.transaction(async (tx) => {
    await deleteExpense(tx, expenseId);
    if (existing.eventId) await releaseEvent(tx, existing.eventId);

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'expense.deleted',
      resourceType: 'expense',
      resourceId: expenseId,
      // The whole row, because after this transaction it exists nowhere else.
      metadata: {
        vehicleId,
        category: existing.category,
        description: existing.description,
        amountMinor: existing.amountMinor,
        currency: existing.currency,
        occurredAt: existing.occurredAt.toISOString(),
      },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
  });
}
