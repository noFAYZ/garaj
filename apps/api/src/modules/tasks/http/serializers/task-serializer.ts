import type { Task } from '@vehicle-os/contracts';
import { displayName } from '../../../vehicles/domain/entities/vehicle';
import type { TaskRow } from '../../infrastructure/repositories/task-repository';

export function serializeTask(task: TaskRow): Task {
  return {
    id: task.id,
    garageId: task.garageId,
    vehicleId: task.vehicleId,
    // Only when the task actually names a vehicle; the same fallback chain the garage grid
    // uses, so one vehicle reads identically wherever it appears.
    vehicleName:
      task.vehicleId && task.vehicleType
        ? displayName({
            nickname: task.vehicleNickname,
            year: task.vehicleYear,
            make: task.vehicleMake,
            model: task.vehicleModel,
            vehicleType: task.vehicleType,
          })
        : null,
    maintenancePlanId: task.maintenancePlanId,

    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    category: task.category,

    dueDate: task.dueDate,
    dueOdometer: task.dueOdometer,

    assigneeId: task.assigneeId,
    assigneeName: task.assigneeName,

    estimatedCost:
      task.estimatedCostAmountMinor !== null && task.costCurrency
        ? { amountMinor: task.estimatedCostAmountMinor, currency: task.costCurrency }
        : null,
    actualCost:
      task.actualCostAmountMinor !== null && task.costCurrency
        ? { amountMinor: task.actualCostAmountMinor, currency: task.costCurrency }
        : null,

    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
