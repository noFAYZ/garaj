import { and, count, desc, eq, gte, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { schema, type Executor } from '@vehicle-os/database';
import type { IncomeCategory } from '@vehicle-os/domain';

export interface IncomeRow {
  id: string;
  vehicleId: string;
  category: IncomeCategory;
  description: string;
  payer: string | null;
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  odometer: number | null;
  odometerUnit: 'KM' | 'MI' | null;
  driverId: string | null;
  /** Joined from the member's user, so a report names people rather than ids. */
  driverName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The selection every read here shares, including the driver's name. */
const columns = {
  id: schema.vehicleIncome.id,
  vehicleId: schema.vehicleIncome.vehicleId,
  category: schema.vehicleIncome.category,
  description: schema.vehicleIncome.description,
  payer: schema.vehicleIncome.payer,
  amountMinor: schema.vehicleIncome.amountMinor,
  currency: schema.vehicleIncome.currency,
  occurredAt: schema.vehicleIncome.occurredAt,
  odometer: schema.vehicleIncome.odometer,
  odometerUnit: schema.vehicleIncome.odometerUnit,
  driverId: schema.vehicleIncome.driverId,
  driverName: schema.users.name,
  createdAt: schema.vehicleIncome.createdAt,
  updatedAt: schema.vehicleIncome.updatedAt,
};

export interface IncomeFilters {
  readonly from?: Date;
  readonly to?: Date;
  readonly category?: IncomeCategory;
  readonly driverId?: string;
  readonly limit: number;
  /** Keyset, as every other list in the product pages (§101). */
  readonly cursor?: { occurredAt: Date; id: string };
}

/** One row over the limit, so the caller can tell whether another page exists. */
export async function listIncome(
  db: Executor,
  vehicleId: string,
  filters: IncomeFilters,
): Promise<IncomeRow[]> {
  const conditions: SQL[] = [eq(schema.vehicleIncome.vehicleId, vehicleId)];
  if (filters.from) conditions.push(gte(schema.vehicleIncome.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(schema.vehicleIncome.occurredAt, filters.to));
  if (filters.category) conditions.push(eq(schema.vehicleIncome.category, filters.category));
  if (filters.driverId) conditions.push(eq(schema.vehicleIncome.driverId, filters.driverId));

  if (filters.cursor) {
    // On (occurred_at, id): a day of fares shares a timestamp to the millisecond, and a
    // timestamp-only cursor repeats one across pages.
    conditions.push(
      or(
        lt(schema.vehicleIncome.occurredAt, filters.cursor.occurredAt),
        and(
          eq(schema.vehicleIncome.occurredAt, filters.cursor.occurredAt),
          lt(schema.vehicleIncome.id, filters.cursor.id),
        ),
      )!,
    );
  }

  const rows = await db
    .select(columns)
    .from(schema.vehicleIncome)
    // Left joins: a row may name no driver, and a member whose account was deleted still has
    // a row worth reporting — it just no longer has a name.
    .leftJoin(schema.garageMembers, eq(schema.garageMembers.id, schema.vehicleIncome.driverId))
    .leftJoin(schema.users, eq(schema.users.id, schema.garageMembers.userId))
    .where(and(...conditions))
    // Matches `vehicle_income_vehicle_occurred_idx`, so this walks the index.
    .orderBy(desc(schema.vehicleIncome.occurredAt), desc(schema.vehicleIncome.id))
    .limit(filters.limit + 1);

  return rows as IncomeRow[];
}

export async function findIncomeById(
  db: Executor,
  incomeId: string,
): Promise<(IncomeRow & { garageId: string }) | null> {
  const [row] = await db
    .select({ ...columns, garageId: schema.vehicles.garageId })
    .from(schema.vehicleIncome)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.vehicleIncome.vehicleId))
    .leftJoin(schema.garageMembers, eq(schema.garageMembers.id, schema.vehicleIncome.driverId))
    .leftJoin(schema.users, eq(schema.users.id, schema.garageMembers.userId))
    .where(eq(schema.vehicleIncome.id, incomeId))
    .limit(1);

  return (row as (IncomeRow & { garageId: string }) | undefined) ?? null;
}

/** Totals per currency in the window — the input to `computeNet`. */
export async function sumIncome(
  db: Executor,
  vehicleId: string,
  window: { from?: Date; to?: Date },
): Promise<{ currency: string; amountMinor: number; count: number }[]> {
  const rows = await db
    .select({
      currency: schema.vehicleIncome.currency,
      amountMinor: sql<string>`sum(${schema.vehicleIncome.amountMinor})`,
      count: count(),
    })
    .from(schema.vehicleIncome)
    .where(
      and(
        eq(schema.vehicleIncome.vehicleId, vehicleId),
        ...([
          window.from ? gte(schema.vehicleIncome.occurredAt, window.from) : undefined,
          window.to ? lte(schema.vehicleIncome.occurredAt, window.to) : undefined,
        ].filter(Boolean) as SQL[]),
      ),
    )
    .groupBy(schema.vehicleIncome.currency);

  return rows.map((row) => ({
    currency: row.currency,
    amountMinor: Number(row.amountMinor),
    count: row.count,
  }));
}

export async function sumIncomeByCategory(
  db: Executor,
  vehicleId: string,
  currency: string,
  window: { from?: Date; to?: Date },
): Promise<{ category: IncomeCategory; amountMinor: number; count: number }[]> {
  const rows = await db
    .select({
      category: schema.vehicleIncome.category,
      amountMinor: sql<string>`sum(${schema.vehicleIncome.amountMinor})`,
      count: count(),
    })
    .from(schema.vehicleIncome)
    .where(
      and(
        eq(schema.vehicleIncome.vehicleId, vehicleId),
        eq(schema.vehicleIncome.currency, currency),
        ...([
          window.from ? gte(schema.vehicleIncome.occurredAt, window.from) : undefined,
          window.to ? lte(schema.vehicleIncome.occurredAt, window.to) : undefined,
        ].filter(Boolean) as SQL[]),
      ),
    )
    .groupBy(schema.vehicleIncome.category);

  return rows.map((row) => ({
    category: row.category,
    amountMinor: Number(row.amountMinor),
    count: row.count,
  }));
}

export async function sumIncomeByDriver(
  db: Executor,
  vehicleId: string,
  currency: string,
  window: { from?: Date; to?: Date },
): Promise<{ driverId: string; driverName: string | null; amountMinor: number; count: number }[]> {
  const rows = await db
    .select({
      driverId: schema.vehicleIncome.driverId,
      driverName: schema.users.name,
      amountMinor: sql<string>`sum(${schema.vehicleIncome.amountMinor})`,
      count: count(),
    })
    .from(schema.vehicleIncome)
    .leftJoin(schema.garageMembers, eq(schema.garageMembers.id, schema.vehicleIncome.driverId))
    .leftJoin(schema.users, eq(schema.users.id, schema.garageMembers.userId))
    .where(
      and(
        eq(schema.vehicleIncome.vehicleId, vehicleId),
        eq(schema.vehicleIncome.currency, currency),
        ...([
          window.from ? gte(schema.vehicleIncome.occurredAt, window.from) : undefined,
          window.to ? lte(schema.vehicleIncome.occurredAt, window.to) : undefined,
        ].filter(Boolean) as SQL[]),
      ),
    )
    .groupBy(schema.vehicleIncome.driverId, schema.users.name);

  // Rows that name no driver are not a driver called "null"; they are simply not in a
  // per-driver report.
  return rows.flatMap((row) =>
    row.driverId === null
      ? []
      : [
          {
            driverId: row.driverId,
            driverName: row.driverName,
            amountMinor: Number(row.amountMinor),
            count: row.count,
          },
        ],
  );
}
