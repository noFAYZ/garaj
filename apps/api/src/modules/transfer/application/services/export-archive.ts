/**
 * Reading a vehicle's whole history back out (PRD §6.5).
 *
 * The rows are read here rather than through the paginated list endpoints: an export is the
 * one read that is *supposed* to return everything, and walking a cursor 25 rows at a time
 * to assemble a file server-side would be a loop around a question the database answers in
 * one query.
 *
 * Every figure leaves as it was stored — minor units, the currency it was paid in, the unit
 * the odometer was read in. Converting on the way out would make the file disagree with the
 * product, and a backup that disagrees with its source is not a backup.
 */

import { and, asc, gte, inArray, isNull, lte, type SQL } from 'drizzle-orm';
import { schema, type Executor } from '@vehicle-os/database';

export interface ExportWindow {
  readonly from?: Date;
  readonly to?: Date;
}

/**
 * Column order is the file's contract: it is the header row a spreadsheet shows, and it is
 * what `garaj`-format imports read back. Appending is safe; reordering is not.
 */
export const EXPENSE_COLUMNS = [
  'id',
  'vehicleId',
  'occurredAt',
  'category',
  'description',
  'vendor',
  'amountMinor',
  'currency',
  'odometer',
  'odometerUnit',
  'fuelType',
  'quantity',
  'quantityUnit',
  'energyKwh',
  'isFullTank',
  'source',
] as const;

export const EVENT_COLUMNS = [
  'id',
  'vehicleId',
  'occurredAt',
  'eventType',
  'title',
  'description',
  'odometer',
  'odometerUnit',
  'engineHours',
  'costAmountMinor',
  'costCurrency',
  'provider',
  'source',
] as const;

export const MAINTENANCE_COLUMNS = [
  'id',
  'vehicleId',
  'performedAt',
  'title',
  'workPerformed',
  'notes',
  'provider',
  'odometer',
  'odometerUnit',
  'partsCostAmountMinor',
  'laborCostAmountMinor',
  'totalCostAmountMinor',
  'costCurrency',
  'nextRecommendedDate',
  'nextRecommendedOdometer',
] as const;

/**
 * The document *index*, not the documents.
 *
 * Titles, types and expiry dates travel; the bytes do not. A signed URL in an export would
 * expire and leave a file of dead links, and inlining a scanned service book would make a
 * 40 MB CSV — files are downloaded one at a time, where each one's authorization check
 * still happens.
 */
export const DOCUMENT_COLUMNS = [
  'id',
  'vehicleId',
  'documentType',
  'title',
  'filename',
  'mimeType',
  'sizeBytes',
  'issuedOn',
  'expiresOn',
  'notes',
  'uploadedAt',
] as const;

export type ExpenseExportRow = Record<(typeof EXPENSE_COLUMNS)[number], unknown>;
export type EventExportRow = Record<(typeof EVENT_COLUMNS)[number], unknown>;
export type MaintenanceExportRow = Record<(typeof MAINTENANCE_COLUMNS)[number], unknown>;
export type DocumentExportRow = Record<(typeof DOCUMENT_COLUMNS)[number], unknown>;

export async function exportExpenses(
  db: Executor,
  vehicleIds: readonly string[],
  range: ExportWindow = {},
): Promise<ExpenseExportRow[]> {
  if (vehicleIds.length === 0) return [];

  const conditions: SQL[] = [inArray(schema.expenses.vehicleId, [...vehicleIds])];
  if (range.from) conditions.push(gte(schema.expenses.occurredAt, range.from));
  if (range.to) conditions.push(lte(schema.expenses.occurredAt, range.to));

  const rows = await db
    .select()
    .from(schema.expenses)
    .where(and(...conditions))
    // Oldest first, unlike every screen in the product: a file is read top to bottom, and a
    // history that starts at the end reads backwards in every spreadsheet that opens it.
    .orderBy(asc(schema.expenses.occurredAt), asc(schema.expenses.id));

  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    occurredAt: row.occurredAt.toISOString(),
    category: row.category,
    description: row.description,
    vendor: row.vendor,
    amountMinor: row.amountMinor,
    currency: row.currency,
    odometer: row.odometer,
    odometerUnit: row.odometerUnit,
    fuelType: row.fuelType,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    energyKwh: row.energyKwh,
    // Stored as 0/1 so the column can also say "not recorded"; the file says so too.
    isFullTank: row.isFullTank === null ? null : row.isFullTank === 1,
    source: row.source,
  }));
}

export async function exportEvents(
  db: Executor,
  vehicleIds: readonly string[],
  range: ExportWindow = {},
): Promise<EventExportRow[]> {
  if (vehicleIds.length === 0) return [];

  const conditions: SQL[] = [inArray(schema.vehicleEvents.vehicleId, [...vehicleIds])];
  if (range.from) conditions.push(gte(schema.vehicleEvents.occurredAt, range.from));
  if (range.to) conditions.push(lte(schema.vehicleEvents.occurredAt, range.to));

  const rows = await db
    .select()
    .from(schema.vehicleEvents)
    .where(and(...conditions))
    .orderBy(asc(schema.vehicleEvents.occurredAt), asc(schema.vehicleEvents.id));

  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    occurredAt: row.occurredAt.toISOString(),
    eventType: row.eventType,
    title: row.title,
    description: row.description,
    odometer: row.odometer,
    odometerUnit: row.odometerUnit,
    engineHours: row.engineHours,
    costAmountMinor: row.costAmountMinor,
    costCurrency: row.costCurrency,
    provider: row.provider,
    source: row.source,
  }));
}

export async function exportMaintenance(
  db: Executor,
  vehicleIds: readonly string[],
  range: ExportWindow = {},
): Promise<MaintenanceExportRow[]> {
  if (vehicleIds.length === 0) return [];

  const conditions: SQL[] = [inArray(schema.maintenanceRecords.vehicleId, [...vehicleIds])];
  if (range.from) conditions.push(gte(schema.maintenanceRecords.performedAt, range.from));
  if (range.to) conditions.push(lte(schema.maintenanceRecords.performedAt, range.to));

  const rows = await db
    .select()
    .from(schema.maintenanceRecords)
    .where(and(...conditions))
    .orderBy(asc(schema.maintenanceRecords.performedAt), asc(schema.maintenanceRecords.id));

  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    performedAt: row.performedAt.toISOString(),
    title: row.title,
    workPerformed: row.workPerformed,
    notes: row.notes,
    provider: row.provider,
    odometer: row.odometer,
    odometerUnit: row.odometerUnit,
    partsCostAmountMinor: row.partsCostAmountMinor,
    laborCostAmountMinor: row.laborCostAmountMinor,
    totalCostAmountMinor: row.totalCostAmountMinor,
    costCurrency: row.costCurrency,
    nextRecommendedDate: row.nextRecommendedDate,
    nextRecommendedOdometer: row.nextRecommendedOdometer,
  }));
}

export async function exportDocuments(
  db: Executor,
  vehicleIds: readonly string[],
): Promise<DocumentExportRow[]> {
  if (vehicleIds.length === 0) return [];

  const rows = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.vehicleId, [...vehicleIds]),
        // A deleted document is gone from every other read; an export that resurrected it
        // would be the one place the soft delete leaks.
        isNull(schema.documents.deletedAt),
      ),
    )
    .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));

  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    documentType: row.documentType,
    title: row.title,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    notes: row.notes,
    uploadedAt: row.uploadedAt === null ? null : row.uploadedAt.toISOString(),
  }));
}

export interface Archive {
  readonly exportedAt: string;
  readonly vehicleIds: readonly string[];
  readonly expenses: readonly ExpenseExportRow[];
  readonly events: readonly EventExportRow[];
  readonly maintenance: readonly MaintenanceExportRow[];
  readonly documents: readonly DocumentExportRow[];
}

/**
 * Every dataset in one document, for the backup case.
 *
 * Four queries in parallel rather than four requests: a user asking for "all my data" is
 * asking one question, and making them stitch four downloads together is making the product
 * the user's problem.
 */
export async function buildArchive(
  db: Executor,
  vehicleIds: readonly string[],
  range: ExportWindow = {},
): Promise<Archive> {
  const [expenses, events, maintenance, documents] = await Promise.all([
    exportExpenses(db, vehicleIds, range),
    exportEvents(db, vehicleIds, range),
    exportMaintenance(db, vehicleIds, range),
    exportDocuments(db, vehicleIds),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    vehicleIds: [...vehicleIds],
    expenses,
    events,
    maintenance,
    documents,
  };
}
