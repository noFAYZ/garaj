import type { MaintenancePlan, MaintenanceRecord } from '@vehicle-os/contracts';
import type { DistanceUnit } from '@vehicle-os/domain';
import { computeNextDue } from '../../domain/next-due';
import type { PlanRow, RecordRow } from '../../infrastructure/repositories/maintenance-repository';

export interface VehicleState {
  currentOdometer: number | null;
  odometerUnit: DistanceUnit;
  currentEngineHours: number | null;
}

/**
 * Serializing a plan computes its status.
 *
 * Not read from the cached columns: those move only when something is written, while the
 * answer changes as the calendar advances and the odometer climbs. A plan that became
 * overdue overnight has had no write to refresh it, so a stored status would still say OK.
 */
export function serializePlan(
  plan: PlanRow,
  vehicle: VehicleState,
  now: Date = new Date(),
): MaintenancePlan {
  const due = computeNextDue(plan, vehicle, now);

  return {
    id: plan.id,
    vehicleId: plan.vehicleId,
    title: plan.title,
    description: plan.description,
    priority: plan.priority,

    intervalDistance: plan.intervalDistance,
    intervalDistanceUnit: plan.intervalDistanceUnit,
    intervalMonths: plan.intervalMonths,
    intervalEngineHours: plan.intervalEngineHours,

    lastPerformedAt: plan.lastPerformedAt?.toISOString() ?? null,
    lastPerformedOdometer: plan.lastPerformedOdometer,
    lastPerformedEngineHours: plan.lastPerformedEngineHours,

    nextDueDate: due.nextDueDate,
    nextDueOdometer: due.nextDueOdometer,
    nextDueEngineHours: due.nextDueEngineHours,

    status: due.status,
    trigger: due.trigger,
    daysRemaining: due.daysRemaining,
    distanceRemaining: due.distanceRemaining,
    engineHoursRemaining: due.engineHoursRemaining,

    isActive: plan.isActive,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

const money = (amountMinor: number | null, currency: string | null) =>
  amountMinor !== null && currency ? { amountMinor, currency } : null;

export function serializeRecord(record: RecordRow): MaintenanceRecord {
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    planId: record.planId,
    eventId: record.eventId,
    title: record.title,
    workPerformed: record.workPerformed,
    notes: record.notes,
    provider: record.provider,
    performedAt: record.performedAt.toISOString(),
    odometer: record.odometer,
    odometerUnit: record.odometerUnit,
    engineHours: record.engineHours,
    partsCost: money(record.partsCostAmountMinor, record.costCurrency),
    laborCost: money(record.laborCostAmountMinor, record.costCurrency),
    totalCost: money(record.totalCostAmountMinor, record.costCurrency),
    createdAt: record.createdAt.toISOString(),
  };
}
