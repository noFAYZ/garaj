import type { Database } from '@vehicle-os/database';
import {
  assertCurrency,
  MoneyError,
  validateSpecs,
  type ActorContext,
  type DistanceUnit,
  type VehicleStatus,
} from '@vehicle-os/domain';
import { NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import { enqueue } from '../../../../infrastructure/outbox';
import type { CommandMeta } from '../../../garages/application/commands/create-garage';
import {
  archiveVehicle,
  findVehicleById,
  photoBelongsToVehicle,
  updateVehicle as persistVehicle,
  type VehicleWithPhoto,
} from '../../infrastructure/repositories/vehicle-repository';

export interface UpdateVehicleInput {
  readonly nickname?: string | null;
  readonly make?: string | null;
  readonly model?: string | null;
  readonly variant?: string | null;
  readonly year?: number | null;
  readonly color?: string | null;
  readonly status?: VehicleStatus;
  readonly identificationNumber?: string | null;
  readonly registrationIdentifier?: string | null;
  readonly purchaseDate?: string | null;
  readonly purchasePriceAmountMinor?: number | null;
  readonly purchasePriceCurrency?: string;
  readonly currentOdometer?: number;
  readonly odometerUnit?: DistanceUnit;
  readonly currentEngineHours?: number;
  readonly specs?: Record<string, unknown>;
  readonly primaryPhotoId?: string | null;
}

export async function updateVehicle(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  input: UpdateVehicleInput,
  meta: CommandMeta,
): Promise<VehicleWithPhoto> {
  const existing = await findVehicleById(db, vehicleId);
  if (!existing) throw new NotFoundError('Vehicle');

  const fields: Record<string, string> = {};

  if (input.purchasePriceCurrency !== undefined) {
    try {
      assertCurrency(input.purchasePriceCurrency);
    } catch (error) {
      if (error instanceof MoneyError) fields.purchasePriceCurrency = error.message;
      else throw error;
    }
  }

  /*
   * Specs are merged, not replaced. A client editing one section of the profile sends only
   * that section; a replace would wipe every field the form did not happen to render.
   * An explicit `null` for a key is how that form removes a value.
   */
  let mergedSpecs: Record<string, unknown> | undefined;
  if (input.specs) {
    const { specs, errors } = validateSpecs(existing.vehicleType, input.specs);
    for (const [key, message] of Object.entries(errors)) fields[`specs.${key}`] = message;

    mergedSpecs = { ...existing.specs };
    for (const key of Object.keys(input.specs)) delete mergedSpecs[key];
    Object.assign(mergedSpecs, specs);
  }

  if (input.primaryPhotoId) {
    const belongs = await photoBelongsToVehicle(db, vehicleId, input.primaryPhotoId);
    if (!belongs) fields.primaryPhotoId = 'That photo does not belong to this vehicle.';
  }

  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

  const changes: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) changes[key] = value;
  };

  assign('nickname', trimOrNull(input.nickname));
  assign('make', trimOrNull(input.make));
  assign('model', trimOrNull(input.model));
  assign('variant', trimOrNull(input.variant));
  assign('year', input.year);
  assign('color', trimOrNull(input.color));
  assign('status', input.status);
  assign('identificationNumber', normaliseIdentifier(input.identificationNumber));
  assign('registrationIdentifier', normaliseIdentifier(input.registrationIdentifier));
  assign('purchaseDate', input.purchaseDate);
  assign('purchasePriceAmountMinor', input.purchasePriceAmountMinor);
  assign('purchasePriceCurrency', input.purchasePriceCurrency);
  assign('currentOdometer', input.currentOdometer);
  assign('odometerUnit', input.odometerUnit);
  assign('currentEngineHours', input.currentEngineHours);
  assign('primaryPhotoId', input.primaryPhotoId);
  assign('specs', mergedSpecs);

  await db.transaction(async (tx) => {
    await persistVehicle(tx, vehicleId, changes);
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId: existing.garageId,
      action: 'vehicle.updated',
      resourceType: 'vehicle',
      resourceId: vehicleId,
      metadata: { changed: Object.keys(changes) },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });

    /*
     * A newly promoted photo needs its background removed — the cutout is only made for
     * the photo a card actually shows, so it is not made at upload time for photos that
     * were never primary. The job key is the photo, so promoting the same one twice does
     * not pay for two removals.
     */
    if (input.primaryPhotoId) {
      await enqueue(tx, {
        queue: 'image-processing',
        jobName: 'process-photo',
        payload: { photoId: input.primaryPhotoId, vehicleId },
        /*
         * Keyed by the *reason*, not just the photo.
         *
         * BullMQ dedupes on the job id and keeps a completed job for an hour, so reusing
         * finalize's key here meant this enqueue was silently dropped — and the job it
         * collided with had run before the photo was primary and correctly done nothing.
         * The result was a photo that was primary, a queue with nothing pending, and no
         * cutout, with no error anywhere to explain it.
         *
         * Running twice is harmless: the handler returns early once a cutout exists.
         */
        jobKey: `process-photo:${input.primaryPhotoId}:primary`,
      });
    }
  });

  const updated = await findVehicleById(db, vehicleId);
  if (!updated) throw new NotFoundError('Vehicle');
  return updated;
}

export async function archive(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  meta: CommandMeta,
): Promise<void> {
  const existing = await findVehicleById(db, vehicleId);
  if (!existing) throw new NotFoundError('Vehicle');

  await db.transaction(async (tx) => {
    await archiveVehicle(tx, vehicleId);
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId: existing.garageId,
      action: 'vehicle.archived',
      resourceType: 'vehicle',
      resourceId: vehicleId,
      metadata: { make: existing.make, model: existing.model },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
  });
}

function trimOrNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

function normaliseIdentifier(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.replace(/\s+/g, '').toUpperCase() || null;
}
