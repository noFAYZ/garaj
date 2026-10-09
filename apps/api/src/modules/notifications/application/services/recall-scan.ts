/**
 * The recall scan.
 *
 * Weekly, for every vehicle still on the road with a make, model and year: ask NHTSA for
 * campaigns on that model, and tell each garage member once per campaign. The dedupe key is
 * the vehicle and the campaign number, so a recall is mentioned when it first appears and
 * never again — the notification is the record that the owner was told.
 *
 * Every message says *may*. The lookup is by model, not VIN (see `recalls.ts`); stating a
 * recall as fact on a car that was never affected, or was already fixed, is exactly the
 * wrong-and-confident kind of message a safety feature cannot send.
 */

import { and, inArray, isNotNull, isNull } from 'drizzle-orm';
import { schema, type Database } from '@vehicle-os/database';
import { env } from '@vehicle-os/config';
import { recallsFor, type Recall } from '../../../../infrastructure/recalls';
import { displayName } from '../../../vehicles/domain/entities/vehicle';
import { recipientsFor } from './expiry-scan';
import { notifyOnce, type PendingNotification } from './notify';

export interface RecallScanResult {
  readonly models: number;
  readonly notified: number;
}

type Lookup = (vehicle: { make: string; model: string; year: number }) => Promise<Recall[] | null>;

export function recallDedupeKey(vehicleId: string, campaign: string): string {
  return `RECALL:${vehicleId}:${campaign}`;
}

export function recallBody(vehicleName: string, recall: Recall): string {
  return (
    `${vehicleName} may be affected by NHTSA recall ${recall.campaign} (${recall.component}). ` +
    'This matches the make, model and year — check your VIN at nhtsa.gov/recalls to confirm, ' +
    'and whether the remedy has already been done.'
  );
}

export async function scanForRecalls(
  db: Database,
  lookup: Lookup = (vehicle) => recallsFor(env().RECALLS_URL, vehicle),
): Promise<RecallScanResult> {
  const vehicles = await db
    .select({
      id: schema.vehicles.id,
      garageId: schema.vehicles.garageId,
      make: schema.vehicles.make,
      model: schema.vehicles.model,
      year: schema.vehicles.year,
      nickname: schema.vehicles.nickname,
      vehicleType: schema.vehicles.vehicleType,
    })
    .from(schema.vehicles)
    .where(
      and(
        isNull(schema.vehicles.deletedAt),
        // A sold car's recall is the new owner's to hear about.
        inArray(schema.vehicles.status, ['ACTIVE', 'STORED']),
        isNotNull(schema.vehicles.make),
        isNotNull(schema.vehicles.model),
        isNotNull(schema.vehicles.year),
      ),
    );

  if (vehicles.length === 0) return { models: 0, notified: 0 };

  /*
   * One lookup per model, not per vehicle: a fleet of twelve identical vans is one question.
   * Sequential rather than parallel, because this is a free public API and a burst of a few
   * hundred requests at 06:00 on Monday is how that stops being true.
   */
  const byModel = new Map<string, Recall[] | null>();
  for (const vehicle of vehicles) {
    const key = `${vehicle.make}|${vehicle.model}|${vehicle.year}`.toLowerCase();
    if (!byModel.has(key)) {
      byModel.set(
        key,
        await lookup({ make: vehicle.make!, model: vehicle.model!, year: vehicle.year! }),
      );
    }
  }

  const recipients = await recipientsFor(
    db,
    vehicles.map((vehicle) => vehicle.garageId),
  );

  // The dedupe key makes a second week's scan a no-op for a campaign already mentioned.
  const notified = await notifyOnce(
    db,
    vehicles.flatMap<PendingNotification>((vehicle) => {
      const recalls = byModel.get(`${vehicle.make}|${vehicle.model}|${vehicle.year}`.toLowerCase());
      const name = displayName(vehicle);
      return (recalls ?? []).flatMap((recall) =>
        (recipients.get(vehicle.garageId) ?? []).map((userId) => ({
          jobName: 'deliver-recall',
          row: {
            userId,
            garageId: vehicle.garageId,
            vehicleId: vehicle.id,
            notificationType: 'RECALL',
            title: `Possible recall: ${recall.component}`,
            body: recallBody(name, recall),
            payload: {
              campaign: recall.campaign,
              component: recall.component,
              summary: recall.summary,
              remedy: recall.remedy,
              reportedOn: recall.reportedOn,
              // Carried so a client can word it as a likelihood without re-deriving why.
              matchedBy: 'MAKE_MODEL_YEAR',
            },
            dedupeKey: recallDedupeKey(vehicle.id, recall.campaign),
          },
        })),
      );
    }),
  );

  return { models: byModel.size, notified };
}
