import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { schema, type Executor } from '@vehicle-os/database';
import type { DocumentType, VehicleType } from '@vehicle-os/domain';

export type DocumentRow = typeof schema.documents.$inferSelect;

export interface ListDocumentsFilters {
  readonly vehicleId: string;
  readonly documentType?: DocumentType;
  /** `YYYY-MM-DD` cut-off; only documents expiring on or before it. */
  readonly expiringBefore?: string;
  readonly limit: number;
  readonly cursor?: { createdAt: Date; id: string };
}

export async function listDocuments(
  db: Executor,
  filters: ListDocumentsFilters,
): Promise<DocumentRow[]> {
  const conditions: SQL[] = [
    eq(schema.documents.vehicleId, filters.vehicleId),
    isNull(schema.documents.deletedAt),
  ];

  if (filters.documentType)
    conditions.push(eq(schema.documents.documentType, filters.documentType));
  if (filters.expiringBefore) {
    conditions.push(
      isNotNull(schema.documents.expiresOn),
      lte(schema.documents.expiresOn, filters.expiringBefore),
    );
  }

  if (filters.cursor) {
    conditions.push(
      or(
        sql`${schema.documents.createdAt} < ${filters.cursor.createdAt}`,
        and(
          eq(schema.documents.createdAt, filters.cursor.createdAt),
          sql`${schema.documents.id} < ${filters.cursor.id}`,
        ),
      )!,
    );
  }

  return db
    .select()
    .from(schema.documents)
    .where(and(...conditions))
    .orderBy(desc(schema.documents.createdAt), desc(schema.documents.id))
    .limit(filters.limit + 1);
}

export async function findDocumentById(
  db: Executor,
  vehicleId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  const [row] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        // Scoped to the vehicle: a document id from another garage is not reachable through
        // a vehicle the caller does have access to.
        eq(schema.documents.vehicleId, vehicleId),
        isNull(schema.documents.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updateDocument(
  db: Executor,
  documentId: string,
  changes: Partial<typeof schema.documents.$inferInsert>,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await db.update(schema.documents).set(changes).where(eq(schema.documents.id, documentId));
}

/**
 * Soft delete (§103). A document is a legal or financial artefact — an insurance certificate
 * removed by mistake is worth being able to restore, and the bytes stay in storage until a
 * worker collects them.
 */
export async function softDeleteDocument(db: Executor, documentId: string): Promise<void> {
  await db
    .update(schema.documents)
    .set({ deletedAt: new Date() })
    .where(eq(schema.documents.id, documentId));
}

export interface ExpiringRow {
  readonly document: DocumentRow;
  readonly vehicleId: string;
  readonly garageId: string;
  readonly nickname: string | null;
  readonly make: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly vehicleType: VehicleType;
}

/**
 * Documents expiring on or before a date, across a set of garages.
 *
 * One query with a join rather than a document query per vehicle: this feeds both the
 * dashboard and the scheduled scan, and the scan runs across every garage in the system.
 */
export async function listExpiringDocuments(
  db: Executor,
  garageIds: readonly string[],
  before: string,
): Promise<ExpiringRow[]> {
  if (garageIds.length === 0) return [];

  const rows = await db
    .select({
      document: schema.documents,
      vehicleId: schema.vehicles.id,
      garageId: schema.vehicles.garageId,
      nickname: schema.vehicles.nickname,
      make: schema.vehicles.make,
      model: schema.vehicles.model,
      year: schema.vehicles.year,
      vehicleType: schema.vehicles.vehicleType,
    })
    .from(schema.documents)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.documents.vehicleId))
    .where(
      and(
        inArray(schema.vehicles.garageId, [...garageIds]),
        isNull(schema.documents.deletedAt),
        isNull(schema.vehicles.deletedAt),
        isNotNull(schema.documents.expiresOn),
        lte(schema.documents.expiresOn, before),
        // Unfinalized rows point at an object that may never have arrived; warning about
        // the expiry of a file nobody can open is noise.
        isNotNull(schema.documents.uploadedAt),
      ),
    )
    // Soonest — and most overdue — first, which is the order they need acting on.
    .orderBy(asc(schema.documents.expiresOn));

  return rows;
}

/** Every garage in the system, for the scheduled scan. */
export async function allGarageIds(db: Executor): Promise<string[]> {
  const rows = await db.select({ id: schema.garages.id }).from(schema.garages);
  return rows.map((row) => row.id);
}
