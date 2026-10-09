import type { CostReportingMode } from '@vehicle-os/domain';
import type { Database } from '@vehicle-os/database';
import { assertCurrency, MoneyError, type ActorContext } from '@vehicle-os/domain';
import { NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import {
  deleteGarage,
  findById,
  updateGarage as persistGarage,
  type GarageWithMeta,
} from '../../infrastructure/repositories/garage-repository';
import type { CommandMeta } from './create-garage';

export interface UpdateGarageInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly defaultCurrency?: string;
  readonly costReporting?: CostReportingMode;
}

export async function updateGarage(
  db: Database,
  actor: ActorContext,
  garageId: string,
  input: UpdateGarageInput,
  meta: CommandMeta,
): Promise<GarageWithMeta> {
  if (input.defaultCurrency !== undefined) {
    try {
      assertCurrency(input.defaultCurrency);
    } catch (error) {
      if (error instanceof MoneyError) {
        throw new ValidationError('Invalid request', { defaultCurrency: error.message });
      }
      throw error;
    }
  }

  // Only the keys the caller actually sent are written, so a PATCH of one field cannot
  // blank the others.
  const changes = Object.fromEntries(
    Object.entries({
      name: input.name?.trim(),
      description:
        input.description === undefined ? undefined : (input.description?.trim() ?? null),
      defaultCurrency: input.defaultCurrency,
      costReporting: input.costReporting,
    }).filter(([, value]) => value !== undefined),
  );

  await db.transaction(async (tx) => {
    await persistGarage(tx, garageId, changes);
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: meta.actorEmail,
      garageId,
      action: 'garage.updated',
      resourceType: 'garage',
      resourceId: garageId,
      metadata: { changed: Object.keys(changes) },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
  });

  const updated = await findById(db, garageId, actor.userId);
  if (!updated) throw new NotFoundError('Garage');
  return updated;
}

/**
 * Deleting a garage cascades to its vehicles and everything hanging off them.
 *
 * Not a soft delete: §103 reserves those for vehicles, documents, tasks and ideas. A garage
 * is the tenant boundary, so a "deleted" one still visible to queries is a data-leak shape
 * waiting to happen. The audit row is written first and survives the cascade because
 * `audit_logs.garage_id` is `set null`, not `cascade`.
 */
export async function removeGarage(
  db: Database,
  actor: ActorContext,
  garageId: string,
  meta: CommandMeta,
): Promise<void> {
  const garage = await findById(db, garageId, actor.userId);
  if (!garage) throw new NotFoundError('Garage');

  await db.transaction(async (tx) => {
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: meta.actorEmail,
      garageId,
      action: 'garage.deleted',
      resourceType: 'garage',
      resourceId: garageId,
      metadata: { name: garage.name, vehicleCount: garage.vehicleCount },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
    await deleteGarage(tx, garageId);
  });
}
