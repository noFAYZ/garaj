import type { Vehicle, VehiclePhoto } from '@vehicle-os/contracts';
import { VEHICLE_TYPE_CAPABILITIES } from '@vehicle-os/domain';
import { displayName } from '../../domain/entities/vehicle';
import type { VehicleWithPhoto } from '../../infrastructure/repositories/vehicle-repository';

/**
 * Photo rows carry a storage key, not a URL. The key is never sent to a client — it would
 * be a stable, guessable-looking handle to a private object — so the serializer takes an
 * already-minted signed URL, or null when one was not requested.
 */
export function serializePhoto(
  photo: NonNullable<VehicleWithPhoto['primaryPhoto']>,
  vehicleId: string,
  url: string | null,
  thumbnailUrl: string | null = url,
): VehiclePhoto {
  return {
    id: photo.id,
    vehicleId,
    eventId: photo.eventId,
    conditionAssessmentId: photo.conditionAssessmentId,
    url,
    thumbnailUrl,
    isCutout: photo.cutoutKey !== null,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes,
    width: photo.width,
    height: photo.height,
    caption: photo.caption,
    category: photo.category,
    capturedAt: photo.capturedAt,
    createdAt: photo.createdAt.toISOString(),
  };
}

export function serializeVehicle(
  vehicle: VehicleWithPhoto,
  primaryPhotoUrl: string | null,
  primaryThumbnailUrl: string | null = primaryPhotoUrl,
): Vehicle {
  return {
    id: vehicle.id,
    garageId: vehicle.garageId,
    vehicleType: vehicle.vehicleType,
    status: vehicle.status,

    nickname: vehicle.nickname,
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    year: vehicle.year,
    color: vehicle.color,
    displayName: displayName(vehicle),

    identificationNumber: vehicle.identificationNumber,
    registrationIdentifier: vehicle.registrationIdentifier,

    purchaseDate: vehicle.purchaseDate,
    purchasePrice:
      vehicle.purchasePriceAmountMinor !== null && vehicle.purchasePriceCurrency
        ? {
            amountMinor: vehicle.purchasePriceAmountMinor,
            currency: vehicle.purchasePriceCurrency,
          }
        : null,

    currentOdometer: vehicle.currentOdometer,
    odometerUnit: vehicle.odometerUnit,
    currentEngineHours: vehicle.currentEngineHours,

    primaryPhoto: vehicle.primaryPhoto
      ? serializePhoto(vehicle.primaryPhoto, vehicle.id, primaryPhotoUrl, primaryThumbnailUrl)
      : null,
    specs: vehicle.specs as Vehicle['specs'],
    // Sent with every vehicle so a client renders only the sections that apply to its type
    // — no bicycle gets a "Fuel" tab — without a second round trip for the descriptor.
    capabilities: [...VEHICLE_TYPE_CAPABILITIES[vehicle.vehicleType]],

    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
}
