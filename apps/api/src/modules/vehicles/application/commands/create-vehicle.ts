import type { Database } from '@vehicle-os/database';
import {
  assertCurrency,
  MoneyError,
  primaryUsageMeter,
  validateSpecs,
  type ActorContext,
  type VehicleType,
} from '@vehicle-os/domain';
import { ValidationError } from '../../../../infrastructure/errors';
import { idConflict } from '../../../../infrastructure/idempotency';

import { recordAudit } from '../../../../infrastructure/audit';
import type { CommandMeta } from '../../../garages/application/commands/create-garage';
import {
  findVehicleById,
  insertVehicle,
  type VehicleWithPhoto,
} from '../../infrastructure/repositories/vehicle-repository';

export interface CreateVehicleInput {
  /** Chosen by the client for a vehicle added offline; makes this create idempotent. */
  readonly id?: string;
  readonly garageId: string;
  readonly vehicleType: VehicleType;
  readonly nickname?: string;
  readonly make?: string;
  readonly model?: string;
  readonly variant?: string;
  readonly year?: number;
  readonly color?: string;
  readonly identificationNumber?: string;
  readonly registrationIdentifier?: string;
  readonly purchaseDate?: string;
  readonly purchasePriceAmountMinor?: number;
  readonly purchasePriceCurrency?: string;
  readonly currentOdometer?: number;
  readonly odometerUnit?: 'KM' | 'MI';
  readonly currentEngineHours?: number;
  readonly specs?: Record<string, unknown>;
}

export async function createVehicle(
  db: Database,
  actor: ActorContext,
  input: CreateVehicleInput,
  meta: CommandMeta,
): Promise<VehicleWithPhoto> {
  const fields: Record<string, string> = {};

  /*
   * An amount without a currency is meaningless and a currency without an amount is noise
   * — both halves travel together or neither does (§79).
   */
  const hasAmount = input.purchasePriceAmountMinor !== undefined;
  const hasCurrency = input.purchasePriceCurrency !== undefined;
  if (hasAmount !== hasCurrency) {
    fields[hasAmount ? 'purchasePriceCurrency' : 'purchasePriceAmountMinor'] =
      'A purchase price needs both an amount and a currency.';
  } else if (hasCurrency) {
    try {
      assertCurrency(input.purchasePriceCurrency!);
    } catch (error) {
      if (error instanceof MoneyError) fields.purchasePriceCurrency = error.message;
      else throw error;
    }
  }

  // Rejected rather than ignored: a trailer with engine hours means the client sent the
  // wrong form, and storing the value would surface a meter the type has no use for.
  const meter = primaryUsageMeter(input.vehicleType);
  if (input.currentEngineHours !== undefined && meter !== 'engineHours') {
    fields.currentEngineHours = `A vehicle of type ${input.vehicleType} does not track engine hours.`;
  }

  const { specs, errors } = validateSpecs(input.vehicleType, input.specs ?? {});
  for (const [key, message] of Object.entries(errors)) fields[`specs.${key}`] = message;

  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

  /*
   * The client's id where it sent one. A queued create is replayed until acknowledged, and the
   * acknowledgement is the part most likely to be lost — so the second attempt has to land on the
   * same row rather than beside it.
   */
  const vehicleId = await db.transaction(async (tx) => {
    const id = await insertVehicle(tx, {
      ...(input.id ? { id: input.id } : {}),
      garageId: input.garageId,
      vehicleType: input.vehicleType,
      nickname: input.nickname?.trim() || null,
      make: input.make?.trim() || null,
      model: input.model?.trim() || null,
      variant: input.variant?.trim() || null,
      year: input.year ?? null,
      color: input.color?.trim() || null,
      identificationNumber: normaliseIdentifier(input.identificationNumber),
      registrationIdentifier: normaliseIdentifier(input.registrationIdentifier),
      purchaseDate: input.purchaseDate ?? null,
      purchasePriceAmountMinor: input.purchasePriceAmountMinor ?? null,
      purchasePriceCurrency: input.purchasePriceCurrency ?? null,
      currentOdometer: input.currentOdometer ?? null,
      odometerUnit: input.odometerUnit ?? 'KM',
      currentEngineHours: input.currentEngineHours ?? null,
      specs,
      createdBy: actor.userId,
    });

    // Nothing inserted means this id is already a vehicle: a replay, not a second vehicle. The
    // audit entry is skipped with it — the creation was recorded the first time.
    if (id === null) return input.id!;

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId: input.garageId,
      action: 'vehicle.created',
      resourceType: 'vehicle',
      resourceId: id,
      metadata: { vehicleType: input.vehicleType, make: input.make, model: input.model },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });

    return id;
  });

  const vehicle = await findVehicleById(db, vehicleId);
  if (!vehicle) throw idConflict('vehicle');
  /*
   * A replay is only a replay if it lands on the same garage. `findVehicleById` answers for any
   * vehicle, so without this check a caller who guessed or reused someone else's id would be
   * handed that vehicle's record back — the caller's capability was checked against the garage in
   * *their* request, never against the row that already existed.
   */
  if (vehicle.garageId !== input.garageId) throw idConflict('vehicle');
  return vehicle;
}

/**
 * VINs and plates are compared and searched, so they are stored uppercase with spaces
 * removed. Otherwise "AB 12 CDE" and "ab12cde" are two different vehicles to every query.
 */
function normaliseIdentifier(value: string | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, '').toUpperCase();
  return trimmed || null;
}
