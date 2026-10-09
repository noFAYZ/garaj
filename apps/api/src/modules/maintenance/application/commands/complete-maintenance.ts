/**
 * Logging completed work (Architecture.md §22, §38).
 *
 * One request, one transaction, four writes: the maintenance record, the timeline event it
 * appears as, the expense when a cost was given, and the outbox message that tells the
 * worker something happened. Splitting these across calls leaves a service half-logged the
 * moment one of them fails — a record with no timeline entry, or a cost that never reaches
 * the ownership total.
 */

import type { Database } from '@vehicle-os/database';
import {
  assertCurrency,
  MoneyError,
  type ActorContext,
  type DistanceUnit,
} from '@vehicle-os/domain';
import { NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { enqueue } from '../../../../infrastructure/outbox';
import { insertEvent } from '../../../events/infrastructure/repositories/event-repository';
import {
  findVehicleById,
  raiseEngineHours,
  raiseOdometer,
} from '../../../vehicles/infrastructure/repositories/vehicle-repository';
import { schema } from '@vehicle-os/database';
import { baselineAfterCompletion, computeNextDue } from '../../domain/next-due';
import {
  findPlanById,
  insertRecord,
  updatePlan,
  type PlanRow,
  type RecordRow,
} from '../../infrastructure/repositories/maintenance-repository';

export interface CompleteInput {
  readonly title?: string;
  readonly performedAt: string;
  readonly workPerformed?: string;
  readonly notes?: string;
  readonly provider?: string;
  readonly odometer?: number;
  readonly odometerUnit?: DistanceUnit;
  readonly engineHours?: number;
  readonly partsCostAmountMinor?: number;
  readonly laborCostAmountMinor?: number;
  readonly costCurrency?: string;
}

export interface CompletionResult {
  readonly record: RecordRow;
  /** Null for an unscheduled repair; otherwise the plan with its clock reset. */
  readonly plan: PlanRow | null;
}

export async function completeMaintenance(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  planId: string | null,
  input: CompleteInput,
  now: Date = new Date(),
): Promise<CompletionResult> {
  const vehicle = await findVehicleById(db, vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle');

  const plan = planId ? await findPlanById(db, vehicleId, planId) : null;
  if (planId && !plan) throw new NotFoundError('Maintenance plan');

  const fields: Record<string, string> = {};

  const performedAt = new Date(input.performedAt);
  if (Number.isNaN(performedAt.getTime())) {
    fields.performedAt = 'Not a valid date.';
  } else if (performedAt.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    fields.performedAt = 'Work cannot be recorded as done in the future. Create a task instead.';
  }

  if (input.odometer !== undefined && input.odometerUnit === undefined) {
    fields.odometerUnit = 'An odometer reading needs its unit.';
  }

  const partsCost = input.partsCostAmountMinor;
  const laborCost = input.laborCostAmountMinor;
  const hasCost = partsCost !== undefined || laborCost !== undefined;
  if (hasCost && !input.costCurrency) {
    fields.costCurrency = 'A cost needs a currency.';
  } else if (input.costCurrency) {
    try {
      assertCurrency(input.costCurrency);
    } catch (error) {
      if (error instanceof MoneyError) fields.costCurrency = error.message;
      else throw error;
    }
  }

  const title = input.title?.trim() || plan?.title;
  if (!title) fields.title = 'An unscheduled repair needs a title.';

  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

  // Summed here rather than in the database so the total is a stored fact, not a view that
  // has to be recomputed everywhere it is read.
  const totalCost = hasCost ? (partsCost ?? 0) + (laborCost ?? 0) : null;

  return db.transaction(async (tx) => {
    /*
     * The timeline event first: the record points at it, so it has to exist to be
     * referenced. Both are in this transaction, so neither can survive without the other.
     */
    const { row: event } = await insertEvent(tx, {
      vehicleId,
      eventType: 'MAINTENANCE',
      title: title!,
      description: input.workPerformed?.trim() || null,
      occurredAt: performedAt,
      odometer: input.odometer ?? null,
      odometerUnit: input.odometerUnit ?? null,
      engineHours: input.engineHours ?? null,
      costAmountMinor: totalCost,
      costCurrency: totalCost === null ? null : (input.costCurrency ?? null),
      provider: input.provider?.trim() || null,
      source: 'USER',
      createdBy: actor.userId,
    });

    const record = await insertRecord(tx, {
      vehicleId,
      planId: plan?.id ?? null,
      eventId: event.id,
      title: title!,
      workPerformed: input.workPerformed?.trim() || null,
      notes: input.notes?.trim() || null,
      provider: input.provider?.trim() || null,
      performedAt,
      odometer: input.odometer ?? null,
      odometerUnit: input.odometerUnit ?? null,
      engineHours: input.engineHours ?? null,
      partsCostAmountMinor: partsCost ?? null,
      laborCostAmountMinor: laborCost ?? null,
      totalCostAmountMinor: totalCost,
      costCurrency: totalCost === null ? null : (input.costCurrency ?? null),
      source: 'USER',
      createdBy: actor.userId,
    });

    /*
     * A service with a cost is also money spent on the vehicle. Written here rather than
     * left to the user to enter twice — a maintenance history and an ownership total that
     * disagree is the exact fragmentation the product exists to remove (PRD §4).
     */
    if (totalCost !== null && input.costCurrency) {
      await tx.insert(schema.expenses).values({
        vehicleId,
        eventId: event.id,
        category: 'MAINTENANCE',
        description: title!,
        vendor: input.provider?.trim() || null,
        amountMinor: totalCost,
        currency: input.costCurrency,
        occurredAt: performedAt,
        odometer: input.odometer ?? null,
        odometerUnit: input.odometerUnit ?? null,
        engineHours: input.engineHours ?? null,
        source: 'USER',
        createdBy: actor.userId,
      });
    }

    if (input.odometer !== undefined) await raiseOdometer(tx, vehicleId, input.odometer);
    if (input.engineHours !== undefined) await raiseEngineHours(tx, vehicleId, input.engineHours);

    let updatedPlan: PlanRow | null = null;
    if (plan) {
      /*
       * The clock resets to the reading *at completion*, not to the vehicle's reading now.
       * Logging last month's service at 38,000 km must schedule the next one from there —
       * using today's 42,000 km would push it 4,000 km late.
       */
      const baseline = baselineAfterCompletion({
        performedAt,
        odometer: input.odometer ?? null,
        odometerUnit: input.odometerUnit ?? null,
        engineHours: input.engineHours ?? null,
        vehicleOdometerUnit: vehicle.odometerUnit,
      });

      const rebased = { ...plan, ...baseline };
      const due = computeNextDue(rebased, {
        currentOdometer: vehicle.currentOdometer,
        odometerUnit: vehicle.odometerUnit,
        currentEngineHours: vehicle.currentEngineHours,
      });

      const changes = {
        ...baseline,
        nextDueDate: due.nextDueDate,
        nextDueOdometer: due.nextDueOdometer,
        nextDueEngineHours: due.nextDueEngineHours,
      };
      await updatePlan(tx, plan.id, changes);
      updatedPlan = { ...rebased, ...changes };

      /*
       * Clears any notification already sent for the cycle just closed, so a reminder does
       * not sit in the user's list for work they have just logged. Idempotent by key: a
       * retry resolves the same cycle rather than queuing a second cleanup.
       */
      await enqueue(tx, {
        queue: 'notifications',
        jobName: 'maintenance-completed',
        payload: { planId: plan.id, vehicleId, recordId: record.id },
        jobKey: `maintenance-completed:${record.id}`,
      });
    }

    return { record, plan: updatedPlan };
  });
}
