/**
 * Global search (Architecture.md §40, §82, §83).
 *
 * Postgres, no search service — §40 is explicit that one is not to be introduced initially.
 *
 * ponytail: `ILIKE '%term%'` over the handful of columns a person actually searches, not
 * `tsvector` with GIN indexes. A garage holds hundreds of rows, not millions, and full text
 * would add a migration, generated columns and rank tuning to answer the same question. The
 * ceiling is a sequential scan per table: when one garage's data makes that slow, the upgrade
 * is a `pg_trgm` GIN index per column, then tsvector — both behind this same function, which
 * is why §40 says the public API must not change.
 *
 * Every query is filtered by the caller's garage memberships *inside the SQL* (§83): filtering
 * after the fact means the rows were still read, and one bug away from being returned.
 */

import { and, desc, eq, ilike, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { schema, type Executor } from '@vehicle-os/database';
import type { SearchResultType } from '@vehicle-os/contracts';
import type { VehicleType } from '@vehicle-os/domain';

export interface SearchHit {
  readonly type: SearchResultType;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly vehicleId: string | null;
  readonly vehicleName: string | null;
  readonly date: Date | string | null;
  readonly relevance: number;
}

export interface VehicleNaming {
  readonly nickname: string | null;
  readonly make: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly vehicleType: VehicleType;
}

/**
 * How well a hit matches, comparable across types.
 *
 * An exact title beats a title that starts with the term, which beats one that merely
 * contains it, which beats a match found only in a body field. Postgres `ts_rank` would give
 * numbers that are only comparable within one query shape — and these have to be sorted
 * against each other across six tables.
 */
export function relevanceOf(title: string, term: string, matchedTitle: boolean): number {
  const haystack = title.toLowerCase();
  const needle = term.toLowerCase();

  if (!matchedTitle) return 0.4;
  if (haystack === needle) return 1;
  if (haystack.startsWith(needle)) return 0.85;
  return 0.6;
}

/** `%` and `_` are wildcards in LIKE; a user typing them means the characters. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

interface Scope {
  readonly garageIds: readonly string[];
  readonly pattern: string;
  readonly term: string;
  readonly limit: number;
}

function vehicleColumns() {
  return {
    nickname: schema.vehicles.nickname,
    make: schema.vehicles.make,
    model: schema.vehicles.model,
    year: schema.vehicles.year,
    vehicleType: schema.vehicles.vehicleType,
  };
}

async function searchVehicles(db: Executor, scope: Scope, name: (v: VehicleNaming) => string) {
  const rows = await db
    .select({
      id: schema.vehicles.id,
      ...vehicleColumns(),
      registration: schema.vehicles.registrationIdentifier,
      vin: schema.vehicles.identificationNumber,
      createdAt: schema.vehicles.createdAt,
    })
    .from(schema.vehicles)
    .where(
      and(
        inArray(schema.vehicles.garageId, [...scope.garageIds]),
        isNull(schema.vehicles.deletedAt),
        or(
          ilike(schema.vehicles.nickname, scope.pattern),
          ilike(schema.vehicles.make, scope.pattern),
          ilike(schema.vehicles.model, scope.pattern),
          ilike(schema.vehicles.registrationIdentifier, scope.pattern),
          ilike(schema.vehicles.identificationNumber, scope.pattern),
        )!,
      ),
    )
    .limit(scope.limit);

  return rows.map((row): SearchHit => {
    const title = name(row);
    return {
      type: 'VEHICLE',
      id: row.id,
      title,
      subtitle: row.registration ?? row.vin,
      vehicleId: row.id,
      vehicleName: title,
      date: null,
      relevance: relevanceOf(title, scope.term, true),
    };
  });
}

async function searchEvents(db: Executor, scope: Scope, name: (v: VehicleNaming) => string) {
  const rows = await db
    .select({
      id: schema.vehicleEvents.id,
      title: schema.vehicleEvents.title,
      description: schema.vehicleEvents.description,
      eventType: schema.vehicleEvents.eventType,
      occurredAt: schema.vehicleEvents.occurredAt,
      vehicleId: schema.vehicles.id,
      ...vehicleColumns(),
    })
    .from(schema.vehicleEvents)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.vehicleEvents.vehicleId))
    .where(
      and(
        inArray(schema.vehicles.garageId, [...scope.garageIds]),
        isNull(schema.vehicles.deletedAt),
        or(
          ilike(schema.vehicleEvents.title, scope.pattern),
          ilike(schema.vehicleEvents.description, scope.pattern),
          ilike(schema.vehicleEvents.provider, scope.pattern),
        )!,
      ),
    )
    .orderBy(desc(schema.vehicleEvents.occurredAt))
    .limit(scope.limit);

  return rows.map((row): SearchHit => {
    const matchedTitle = row.title.toLowerCase().includes(scope.term.toLowerCase());
    return {
      type: 'EVENT',
      id: row.id,
      title: row.title,
      subtitle: row.eventType,
      vehicleId: row.vehicleId,
      vehicleName: name(row),
      date: row.occurredAt,
      relevance: relevanceOf(row.title, scope.term, matchedTitle),
    };
  });
}

async function searchTasks(db: Executor, scope: Scope, name: (v: VehicleNaming) => string) {
  const rows = await db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      description: schema.tasks.description,
      status: schema.tasks.status,
      dueDate: schema.tasks.dueDate,
      vehicleId: schema.tasks.vehicleId,
      ...vehicleColumns(),
    })
    .from(schema.tasks)
    .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.tasks.vehicleId))
    .where(
      and(
        // The task's own garage, not the vehicle's: a task need not name a vehicle at all.
        inArray(schema.tasks.garageId, [...scope.garageIds]),
        isNull(schema.tasks.deletedAt),
        or(
          ilike(schema.tasks.title, scope.pattern),
          ilike(schema.tasks.description, scope.pattern),
        )!,
      ),
    )
    .limit(scope.limit);

  return rows.map((row): SearchHit => {
    const matchedTitle = row.title.toLowerCase().includes(scope.term.toLowerCase());
    return {
      type: 'TASK',
      id: row.id,
      title: row.title,
      subtitle: row.status,
      vehicleId: row.vehicleId,
      vehicleName: row.vehicleType ? name(row as VehicleNaming) : null,
      date: row.dueDate,
      relevance: relevanceOf(row.title, scope.term, matchedTitle),
    };
  });
}

async function searchPlans(db: Executor, scope: Scope, name: (v: VehicleNaming) => string) {
  const rows = await db
    .select({
      id: schema.maintenancePlans.id,
      title: schema.maintenancePlans.title,
      description: schema.maintenancePlans.description,
      vehicleId: schema.vehicles.id,
      ...vehicleColumns(),
    })
    .from(schema.maintenancePlans)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.maintenancePlans.vehicleId))
    .where(
      and(
        inArray(schema.vehicles.garageId, [...scope.garageIds]),
        isNull(schema.vehicles.deletedAt),
        or(
          ilike(schema.maintenancePlans.title, scope.pattern),
          ilike(schema.maintenancePlans.description, scope.pattern),
        )!,
      ),
    )
    .limit(scope.limit);

  return rows.map((row): SearchHit => {
    const matchedTitle = row.title.toLowerCase().includes(scope.term.toLowerCase());
    return {
      type: 'MAINTENANCE',
      id: row.id,
      title: row.title,
      subtitle: 'Maintenance schedule',
      vehicleId: row.vehicleId,
      vehicleName: name(row),
      date: null,
      relevance: relevanceOf(row.title, scope.term, matchedTitle),
    };
  });
}

async function searchDocuments(db: Executor, scope: Scope, name: (v: VehicleNaming) => string) {
  const rows = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      filename: schema.documents.filename,
      documentType: schema.documents.documentType,
      expiresOn: schema.documents.expiresOn,
      vehicleId: schema.vehicles.id,
      ...vehicleColumns(),
    })
    .from(schema.documents)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.documents.vehicleId))
    .where(
      and(
        inArray(schema.vehicles.garageId, [...scope.garageIds]),
        isNull(schema.documents.deletedAt),
        isNull(schema.vehicles.deletedAt),
        // A pending upload has no file behind it; offering it as a result is offering
        // nothing to open.
        isNotNull(schema.documents.uploadedAt),
        or(
          ilike(schema.documents.title, scope.pattern),
          ilike(schema.documents.filename, scope.pattern),
          ilike(schema.documents.notes, scope.pattern),
        )!,
      ),
    )
    .limit(scope.limit);

  return rows.map((row): SearchHit => {
    const matchedTitle = row.title.toLowerCase().includes(scope.term.toLowerCase());
    return {
      type: 'DOCUMENT',
      id: row.id,
      title: row.title,
      subtitle: row.documentType,
      vehicleId: row.vehicleId,
      vehicleName: name(row),
      date: row.expiresOn,
      relevance: relevanceOf(row.title, scope.term, matchedTitle),
    };
  });
}

async function searchExpenses(db: Executor, scope: Scope, name: (v: VehicleNaming) => string) {
  const rows = await db
    .select({
      id: schema.expenses.id,
      description: schema.expenses.description,
      vendor: schema.expenses.vendor,
      category: schema.expenses.category,
      occurredAt: schema.expenses.occurredAt,
      vehicleId: schema.vehicles.id,
      ...vehicleColumns(),
    })
    .from(schema.expenses)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.expenses.vehicleId))
    .where(
      and(
        inArray(schema.vehicles.garageId, [...scope.garageIds]),
        isNull(schema.vehicles.deletedAt),
        or(
          ilike(schema.expenses.description, scope.pattern),
          ilike(schema.expenses.vendor, scope.pattern),
        )!,
      ),
    )
    .orderBy(desc(schema.expenses.occurredAt))
    .limit(scope.limit);

  return rows.map((row): SearchHit => {
    const matchedTitle = row.description.toLowerCase().includes(scope.term.toLowerCase());
    return {
      type: 'EXPENSE',
      id: row.id,
      title: row.description,
      subtitle: row.vendor ?? row.category,
      vehicleId: row.vehicleId,
      vehicleName: name(row),
      date: row.occurredAt,
      relevance: relevanceOf(row.description, scope.term, matchedTitle),
    };
  });
}

async function searchIdeas(db: Executor, scope: Scope, name: (v: VehicleNaming) => string) {
  const rows = await db
    .select({
      id: schema.ideas.id,
      title: schema.ideas.title,
      status: schema.ideas.status,
      vehicleId: schema.vehicles.id,
      ...vehicleColumns(),
    })
    .from(schema.ideas)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.ideas.vehicleId))
    .where(
      and(
        inArray(schema.vehicles.garageId, [...scope.garageIds]),
        isNull(schema.ideas.deletedAt),
        isNull(schema.vehicles.deletedAt),
        or(
          ilike(schema.ideas.title, scope.pattern),
          ilike(schema.ideas.description, scope.pattern),
        )!,
      ),
    )
    .limit(scope.limit);

  return rows.map((row): SearchHit => {
    const matchedTitle = row.title.toLowerCase().includes(scope.term.toLowerCase());
    return {
      type: 'IDEA',
      id: row.id,
      title: row.title,
      subtitle: row.status,
      vehicleId: row.vehicleId,
      vehicleName: name(row),
      date: null,
      relevance: relevanceOf(row.title, scope.term, matchedTitle),
    };
  });
}

const SEARCHERS: Record<
  SearchResultType,
  (db: Executor, scope: Scope, name: (v: VehicleNaming) => string) => Promise<SearchHit[]>
> = {
  VEHICLE: searchVehicles,
  EVENT: searchEvents,
  TASK: searchTasks,
  MAINTENANCE: searchPlans,
  DOCUMENT: searchDocuments,
  EXPENSE: searchExpenses,
  IDEA: searchIdeas,
};

export async function search(
  db: Executor,
  options: {
    garageIds: readonly string[];
    term: string;
    type?: SearchResultType;
    limit: number;
    displayName: (vehicle: VehicleNaming) => string;
  },
): Promise<SearchHit[]> {
  if (options.garageIds.length === 0) return [];

  const scope: Scope = {
    garageIds: options.garageIds,
    pattern: `%${escapeLike(options.term)}%`,
    term: options.term,
    // Each table is capped at the requested limit; the merge below trims to it again. A
    // per-table cap stops one chatty table from crowding out every other kind of result.
    limit: options.limit,
  };

  const searchers = options.type ? [SEARCHERS[options.type]] : Object.values(SEARCHERS);
  // In parallel: independent reads, and running them in sequence would multiply the wait for
  // the same answer.
  const batches = await Promise.all(
    searchers.map((searcher) => searcher(db, scope, options.displayName)),
  );

  return batches
    .flat()
    .sort((a, b) => b.relevance - a.relevance || a.title.localeCompare(b.title))
    .slice(0, options.limit);
}
