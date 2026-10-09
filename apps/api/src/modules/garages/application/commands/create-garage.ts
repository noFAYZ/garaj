import type { Database } from '@vehicle-os/database';
import { assertCurrency, MoneyError, type ActorContext } from '@vehicle-os/domain';
import { ValidationError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import {
  insertGarage,
  insertMember,
  type GarageWithMeta,
} from '../../infrastructure/repositories/garage-repository';

export interface CreateGarageInput {
  readonly name: string;
  readonly description?: string;
  readonly defaultCurrency?: string;
}

export interface CommandMeta {
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly actorEmail: string | null;
}

export async function createGarage(
  db: Database,
  actor: ActorContext,
  input: CreateGarageInput,
  meta: CommandMeta,
): Promise<GarageWithMeta> {
  const currency = input.defaultCurrency ?? 'USD';
  try {
    assertCurrency(currency);
  } catch (error) {
    if (error instanceof MoneyError) {
      throw new ValidationError('Invalid request', { defaultCurrency: error.message });
    }
    throw error;
  }

  /*
   * Garage and owner membership are one transaction. A garage without its owner row is
   * unreachable — `listForUser` joins through membership — so a partial commit would leave
   * an orphan nobody can see or delete.
   */
  return db.transaction(async (tx) => {
    const garage = await insertGarage(tx, {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      ownerId: actor.userId,
      defaultCurrency: currency,
    });

    await insertMember(tx, { garageId: garage.id, userId: actor.userId, role: 'OWNER' });

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: meta.actorEmail,
      garageId: garage.id,
      action: 'garage.created',
      resourceType: 'garage',
      resourceId: garage.id,
      metadata: { name: garage.name },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });

    return { ...garage, vehicleCount: 0, role: 'OWNER' as const };
  });
}
