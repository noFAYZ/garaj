import type { DistanceUnit, VehicleStatus, VehicleType } from '@vehicle-os/domain';

export interface VehicleEntity {
  readonly id: string;
  readonly garageId: string;
  readonly vehicleType: VehicleType;
  readonly status: VehicleStatus;
  readonly nickname: string | null;
  readonly make: string | null;
  readonly model: string | null;
  readonly variant: string | null;
  readonly year: number | null;
  readonly color: string | null;
  readonly identificationNumber: string | null;
  readonly registrationIdentifier: string | null;
  readonly purchaseDate: string | null;
  readonly purchasePriceAmountMinor: number | null;
  readonly purchasePriceCurrency: string | null;
  readonly currentOdometer: number | null;
  readonly odometerUnit: DistanceUnit;
  readonly currentEngineHours: number | null;
  readonly primaryPhotoId: string | null;
  readonly specs: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * What to call a vehicle when the user has not named it.
 *
 * Falls back through nickname, then year/make/model, then the type. Something is always
 * returned: PRD §6.3 wants a vehicle creatable from almost nothing, so "2021 BMW" and
 * "Bicycle" both have to render as a usable card title rather than an empty string.
 */
export function displayName(vehicle: {
  nickname: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vehicleType: VehicleType;
}): string {
  if (vehicle.nickname?.trim()) return vehicle.nickname.trim();

  const parts = [vehicle.year?.toString(), vehicle.make, vehicle.model].filter(
    (part): part is string => Boolean(part?.trim()),
  );
  if (parts.length > 0) return parts.join(' ');

  // Last resort: "Motorcycle" beats an empty title on a card the user has to click.
  return titleCase(vehicle.vehicleType);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
