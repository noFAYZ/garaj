import type { Expense } from '@vehicle-os/contracts';
import type { ExpenseRow } from '../../infrastructure/repositories/expense-repository';

export function serializeExpense(expense: ExpenseRow): Expense {
  return {
    id: expense.id,
    vehicleId: expense.vehicleId,
    eventId: expense.eventId,

    category: expense.category,
    description: expense.description,
    vendor: expense.vendor,

    amount: { amountMinor: expense.amountMinor, currency: expense.currency },

    occurredAt: expense.occurredAt.toISOString(),
    odometer: expense.odometer,
    odometerUnit: expense.odometerUnit,

    // `numeric` comes back as a string and stays one: turning "48.72" into a float to put it
    // on the wire reintroduces exactly the error the column type exists to avoid.
    fuelType: expense.fuelType,
    quantity: expense.quantity,
    quantityUnit: expense.quantityUnit,
    latitude: expense.latitude === null ? null : Number(expense.latitude),
    longitude: expense.longitude === null ? null : Number(expense.longitude),
    energyKwh: expense.energyKwh,
    isFullTank: expense.isFullTank === null ? null : expense.isFullTank === 1,

    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}
