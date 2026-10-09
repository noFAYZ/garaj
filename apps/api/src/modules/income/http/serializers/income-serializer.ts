import type { Income } from '@vehicle-os/contracts';
import type { IncomeRow } from '../../infrastructure/repositories/income-repository';

/**
 * Row to wire DTO, field by field rather than spread: a column added to the table should not
 * silently start appearing in API responses.
 */
export function serializeIncome(row: IncomeRow): Income {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    category: row.category,
    description: row.description,
    payer: row.payer,
    amount: { amountMinor: Number(row.amountMinor), currency: row.currency },
    occurredAt: row.occurredAt.toISOString(),
    odometer: row.odometer === null ? null : Number(row.odometer),
    odometerUnit: row.odometerUnit,
    driverId: row.driverId,
    driverName: row.driverName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
