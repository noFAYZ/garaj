import type { VehicleEvent } from '@vehicle-os/contracts';
import type { EventRow } from '../../infrastructure/repositories/event-repository';
import { tripDeductionMinor } from '../../domain/trip';

export function serializeTrip(event: EventRow): VehicleEvent['trip'] {
  if (event.tripPurpose === null || event.tripDistance === null) return null;

  const rate =
    event.mileageRateMinor !== null && event.mileageRateCurrency
      ? { amountMinor: event.mileageRateMinor, currency: event.mileageRateCurrency }
      : null;
  const deduction = rate ? tripDeductionMinor(event.tripDistance, rate.amountMinor) : null;

  return {
    purpose: event.tripPurpose,
    startOdometer: event.tripStartOdometer,
    distance: event.tripDistance,
    rate,
    deduction:
      rate && deduction !== null ? { amountMinor: deduction, currency: rate.currency } : null,
  };
}

export function serializeEvent(event: EventRow): VehicleEvent {
  return {
    id: event.id,
    vehicleId: event.vehicleId,
    eventType: event.eventType,
    title: event.title,
    description: event.description,
    occurredAt: event.occurredAt.toISOString(),
    odometer: event.odometer,
    odometerUnit: event.odometerUnit,
    engineHours: event.engineHours,
    // Both halves or neither: an amount with no currency is not a cost, it is a number.
    cost:
      event.costAmountMinor !== null && event.costCurrency
        ? { amountMinor: event.costAmountMinor, currency: event.costCurrency }
        : null,
    provider: event.provider,
    trip: serializeTrip(event),
    source: event.source,
    createdBy: event.createdBy,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
