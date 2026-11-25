import type { PartProduct, VehiclePart } from '@vehicle-os/contracts';
import type {
  listGarageProducts,
  PartWithEntry,
} from '../../infrastructure/repositories/part-repository';

const number = (value: string | null) => (value === null ? null : Number(value));

export function serializePart({
  part,
  entryAt,
  entryOdometer,
  entryOdometerUnit,
}: PartWithEntry): VehiclePart {
  // On an entry, the entry's date and reading are the line's — edited with it, never copied.
  const onEntry = part.eventId !== null;
  const fittedAt = onEntry ? entryAt : part.fittedAt;
  return {
    id: part.id,
    vehicleId: part.vehicleId,
    eventId: part.eventId,
    position: part.position,
    action: part.action,
    brand: part.brand,
    name: part.name,
    spec: part.spec,
    partNumber: part.partNumber,
    quantity: number(part.quantity),
    unit: part.unit,
    cost:
      part.costAmountMinor !== null && part.costCurrency
        ? { amountMinor: part.costAmountMinor, currency: part.costCurrency }
        : null,
    fittedAt: fittedAt?.toISOString() ?? null,
    odometer: onEntry ? entryOdometer : part.odometer,
    odometerUnit: onEntry ? entryOdometerUnit : part.odometerUnit,
    warrantyUntil: part.warrantyUntil,
    notes: part.notes,
    createdAt: part.createdAt.toISOString(),
  };
}

export function serializeProduct(
  product: Awaited<ReturnType<typeof listGarageProducts>>[number],
): PartProduct {
  return {
    position: product.position,
    brand: product.brand,
    name: product.name,
    spec: product.spec,
    partNumber: product.partNumber,
    quantity: number(product.quantity),
    unit: product.unit,
    lastUsedAt: product.createdAt.toISOString(),
  };
}
