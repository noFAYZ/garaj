/**
 * Bringing someone else's history in (PRD §6.5).
 *
 * Two properties this has to hold, because an imported row looks as authoritative
 * afterwards as one typed by hand:
 *
 *  1. **Nothing is written until the user has seen what would be.** A dry run maps every
 *     row and reports the result without touching the database, so a file picked as the
 *     wrong format is a paragraph on screen rather than nine hundred wrong expenses.
 *  2. **Re-running the same file changes nothing.** Each row's id is derived from the
 *     vehicle and the row's own content, so the insert conflicts with the one already there
 *     — a half-finished import is resumed by sending the same file again, which is what
 *     people actually do when an upload dies.
 *
 * Rows are imported as expenses, not timeline events. An expense is what every cost figure
 * reads, a fuel fill needs its quantity and full-tank flag to feed consumption, and the two
 * fuel-log products this accepts files from record nothing else.
 */

import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@vehicle-os/database';
import type { ActorContext, DistanceUnit, VolumeUnit } from '@vehicle-os/domain';
import type { ImportFormat, ImportReport } from '@vehicle-os/contracts';
import { parseCsvRecords } from '../../../../infrastructure/csv';
import { ValidationError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import type { CommandMeta } from '../../../garages/application/commands/create-garage';
import { MappingError, mapRow, type MappedRow } from '../../domain/mappings';

export interface ImportInput {
  readonly format: ImportFormat;
  readonly csv: string;
  readonly dryRun: boolean;
  readonly currency: string;
  readonly distanceUnit: DistanceUnit;
  readonly volumeUnit: VolumeUnit;
}

/** How many mapped rows come back in the report, so the caller can eyeball the mapping. */
const PREVIEW_ROWS = 5;

/** Beyond this the report itself stops being readable; the count still tells the whole story. */
const MAX_PROBLEMS = 50;

/**
 * A stable id for an imported row.
 *
 * Derived from the vehicle plus the fields that identify the fill-up — not from the row's
 * position, which changes the moment someone sorts the spreadsheet, and not from a random
 * id, which would make every re-upload a fresh copy of the history.
 *
 * A UUID shape, and v7-like only in that it is 16 bytes in the right layout: the timestamp
 * bits come from the *occurrence* rather than now, which keeps a decade of imported fill-ups
 * in index order instead of scattered at the end.
 *
 * ponytail: content-addressed, so two genuinely distinct fill-ups on the same day, at the
 * same odometer, for the same amount collapse into one. That pair is indistinguishable in
 * the source file too — if a format ever carries its own row id, prefer it.
 */
export function importRowId(vehicleId: string, row: MappedRow): string {
  if (row.id && /^[0-9a-f-]{36}$/i.test(row.id)) return row.id.toLowerCase();

  const fingerprint = [
    vehicleId,
    row.occurredAt.toISOString(),
    row.category,
    row.amountMinor,
    row.odometer ?? '',
    row.quantity ?? '',
  ].join('|');

  const digest = createHash('sha256').update(fingerprint).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  // Milliseconds since the epoch in the leading 48 bits, as UUIDv7 lays them out.
  const millis = row.occurredAt.getTime();
  bytes.writeUIntBE(Math.max(0, millis), 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface Candidate {
  readonly line: number;
  readonly id: string;
  readonly row: MappedRow;
}

export async function importCsv(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  garageId: string,
  input: ImportInput,
  meta: CommandMeta,
): Promise<ImportReport> {
  const parsed = parseCsvRecords(input.csv);
  if (parsed.rows.length === 0) {
    throw new ValidationError('Invalid request', {
      csv: 'No data rows found. The first line must be the header row.',
    });
  }

  const candidates: Candidate[] = [];
  const problems: ImportReport['problems'] = [];
  let failed = 0;

  parsed.rows.forEach((record, index) => {
    // +2: the header is line 1 and the gutter is 1-based, so this is the number the user
    // sees beside the row in their spreadsheet.
    const line = index + 2;
    try {
      const row = mapRow(record, input.format, {
        currency: input.currency,
        distanceUnit: input.distanceUnit,
        volumeUnit: input.volumeUnit,
      });
      candidates.push({ line, id: importRowId(vehicleId, row), row });
    } catch (error) {
      failed += 1;
      if (problems.length < MAX_PROBLEMS) {
        problems.push({
          line,
          message: error instanceof MappingError ? error.message : 'Could not read this row.',
        });
      }
    }
  });

  /*
   * A file that maps nothing is almost always the wrong format rather than a file of bad
   * rows, and saying so is more useful than reporting nine hundred identical problems.
   */
  if (candidates.length === 0) {
    throw new ValidationError('Invalid request', {
      format: `No rows could be read as a ${input.format} export. Check the format selection.`,
      ...(problems[0] ? { csv: problems[0].message } : {}),
    });
  }

  const existing = await existingIds(
    db,
    vehicleId,
    candidates.map((candidate) => candidate.id),
  );

  /*
   * Two identical rows *within one file* are the same fill-up entered twice by the source
   * app, and they collapse to one id — deduped here rather than left to the insert, so the
   * report's counts add up to the rows read.
   */
  const seen = new Set<string>(existing);
  const fresh: Candidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    fresh.push(candidate);
  }

  const duplicates = candidates.length - fresh.length;

  const report: ImportReport = {
    vehicleId,
    format: input.format,
    dryRun: input.dryRun,
    rowsRead: parsed.rows.length,
    created: fresh.length,
    duplicates,
    failed,
    problems,
    preview: candidates.slice(0, PREVIEW_ROWS).map((candidate) => ({
      line: candidate.line,
      occurredAt: candidate.row.occurredAt.toISOString(),
      category: candidate.row.category,
      description: candidate.row.description,
      amountMinor: candidate.row.amountMinor,
      currency: candidate.row.currency ?? input.currency,
      odometer: candidate.row.odometer,
      quantity: candidate.row.quantity,
    })),
    volumeUnit: input.volumeUnit,
  };

  if (input.dryRun || fresh.length === 0) return report;

  await db.transaction(async (tx) => {
    /*
     * One statement for the batch, not one per row: a decade of fill-ups is a few thousand
     * rows, and a round trip each would keep a request worker busy for minutes.
     * `onConflictDoNothing` makes a concurrent second attempt a no-op rather than an error.
     */
    await tx
      .insert(schema.expenses)
      .values(
        fresh.map((candidate) => ({
          id: candidate.id,
          vehicleId,
          category: candidate.row.category,
          description: candidate.row.description,
          vendor: candidate.row.vendor,
          amountMinor: candidate.row.amountMinor,
          currency: candidate.row.currency ?? input.currency,
          occurredAt: candidate.row.occurredAt,
          odometer: candidate.row.odometer,
          // A reading is meaningless without its unit, so the unit only travels with one.
          odometerUnit: candidate.row.odometer === null ? null : input.distanceUnit,
          fuelType: candidate.row.fuelType,
          quantity: candidate.row.quantity,
          quantityUnit:
            candidate.row.quantity === null
              ? null
              : (candidate.row.quantityUnit ?? input.volumeUnit),
          isFullTank: candidate.row.isFullTank === null ? null : candidate.row.isFullTank ? 1 : 0,
          // Not `USER` (§43): a figure nobody typed should stay distinguishable from one
          // somebody stands behind.
          source: 'IMPORT' as const,
          createdBy: actor.userId,
        })),
      )
      .onConflictDoNothing({ target: schema.expenses.id });

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'expense.imported',
      resourceType: 'vehicle',
      resourceId: vehicleId,
      metadata: {
        format: input.format,
        rowsRead: report.rowsRead,
        created: report.created,
        duplicates: report.duplicates,
        failed: report.failed,
      },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
  });

  return report;
}

/** Which of these ids this vehicle already has, so a re-run reports duplicates honestly. */
async function existingIds(
  db: Database,
  vehicleId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const rows = await db
    .select({ id: schema.expenses.id })
    .from(schema.expenses)
    .where(and(eq(schema.expenses.vehicleId, vehicleId), inArray(schema.expenses.id, [...ids])));

  return new Set(rows.map((row) => row.id));
}
