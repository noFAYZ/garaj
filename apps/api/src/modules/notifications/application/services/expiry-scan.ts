/**
 * The document expiry scan (PRD §21, §31; Architecture.md §36).
 *
 * Runs on a schedule, finds documents that have expired or are about to, and queues one
 * notification per person who should hear about it. The dedupe key carries the expiry date,
 * so a registration renewed for another year notifies again — and one left alone does not
 * notify every morning until it does.
 */

import { inArray } from 'drizzle-orm';
import { schema, type Database } from '@vehicle-os/database';
import type { NotificationType } from '@vehicle-os/domain';
import {
  allGarageIds,
  listExpiringDocuments,
} from '../../../documents/infrastructure/repositories/document-repository';
import { EXPIRY_HORIZON_DAYS, daysUntil } from '../../../documents/domain/expiry';
import { displayName } from '../../../vehicles/domain/entities/vehicle';
import { notifyOnce, type PendingNotification } from './notify';

export interface ExpiryScanResult {
  readonly scanned: number;
  readonly notified: number;
}

/**
 * Identity for one notification about one expiry.
 *
 * The date is in the key, so renewing a certificate — which moves the date — produces a
 * fresh reminder next time it approaches, while the same certificate left untouched is
 * mentioned once. The bucket is in it too, so "expires in 60 days" and "has expired" are
 * two different things to be told, said once each.
 */
export function expiryDedupeKey(documentId: string, expiresOn: string, expired: boolean): string {
  return `DOCUMENT:${expired ? 'EXPIRED' : 'EXPIRING'}:${documentId}:${expiresOn}`;
}

/**
 * The more specific type where there is one.
 *
 * "Your insurance has expired" is actionable in a way "a document has expired" is not, and
 * the notification types already distinguish them.
 */
export function notificationTypeFor(documentType: string): NotificationType {
  if (documentType === 'INSURANCE') return 'INSURANCE_EXPIRING';
  if (documentType === 'REGISTRATION') return 'REGISTRATION_EXPIRING';
  if (documentType === 'WARRANTY') return 'WARRANTY_EXPIRING';
  return 'DOCUMENT_EXPIRING';
}

function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export async function recipientsFor(db: Database, garageIds: readonly string[]) {
  if (garageIds.length === 0) return new Map<string, string[]>();

  const rows = await db
    .select({ garageId: schema.garageMembers.garageId, userId: schema.garageMembers.userId })
    .from(schema.garageMembers)
    .where(inArray(schema.garageMembers.garageId, [...garageIds]));

  const byGarage = new Map<string, string[]>();
  for (const row of rows) {
    const list = byGarage.get(row.garageId) ?? [];
    list.push(row.userId);
    byGarage.set(row.garageId, list);
  }
  return byGarage;
}

export async function scanForExpiringDocuments(
  db: Database,
  now: Date = new Date(),
): Promise<ExpiryScanResult> {
  /*
   * UTC for the scan, not a per-user timezone. It runs once for everyone, and a reminder
   * arriving a few hours either side of local midnight is not what makes it useful — the
   * *screens* answer "is this expired today?" in the reader's own zone.
   */
  const today = now.toISOString().slice(0, 10);
  const garageIds = await allGarageIds(db);
  const rows = await listExpiringDocuments(db, garageIds, addDays(today, EXPIRY_HORIZON_DAYS));

  if (rows.length === 0) return { scanned: 0, notified: 0 };

  const recipients = await recipientsFor(
    db,
    rows.map((row) => row.garageId),
  );

  const notified = await notifyOnce(
    db,
    rows.flatMap<PendingNotification>((row) => {
      const expiresOn = row.document.expiresOn!;
      const remaining = daysUntil(expiresOn, today);
      const expired = remaining < 0;

      const vehicle = displayName({
        nickname: row.nickname,
        year: row.year,
        make: row.make,
        model: row.model,
        vehicleType: row.vehicleType,
      });

      const body = expired
        ? `${vehicle}: ${row.document.title} expired ${Math.abs(remaining)} days ago.`
        : remaining === 0
          ? `${vehicle}: ${row.document.title} expires today.`
          : `${vehicle}: ${row.document.title} expires in ${remaining} days.`;

      return (recipients.get(row.garageId) ?? []).map((userId) => ({
        jobName: 'deliver-document-expiry',
        row: {
          userId,
          garageId: row.garageId,
          vehicleId: row.vehicleId,
          notificationType: notificationTypeFor(row.document.documentType),
          title: row.document.title,
          body,
          payload: { documentId: row.document.id, expiresOn, daysRemaining: remaining },
          dedupeKey: expiryDedupeKey(row.document.id, expiresOn, expired),
        },
      }));
    }),
  );

  return { scanned: rows.length, notified };
}
