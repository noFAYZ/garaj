import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { schema, type Executor } from '@vehicle-os/database';
import type { ExpenseCategory } from '@vehicle-os/domain';
import type { CategorySum } from '../../domain/cost';
import type { EnergyFill } from '../../domain/energy';

export type ExpenseRow = typeof schema.expenses.$inferSelect;

export interface ListExpensesFilters {
  readonly vehicleId: string;
  readonly category?: ExpenseCategory;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly cursor?: { occurredAt: Date; id: string };
}

export async function listExpenses(
  db: Executor,
  filters: ListExpensesFilters,
): Promise<ExpenseRow[]> {
  const conditions: SQL[] = [eq(schema.expenses.vehicleId, filters.vehicleId)];

  if (filters.category) conditions.push(eq(schema.expenses.category, filters.category));
  if (filters.from) conditions.push(gte(schema.expenses.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(schema.expenses.occurredAt, filters.to));

  if (filters.cursor) {
    // Keyset on (occurred_at, id) — one invoice split into three expenses shares a
    // timestamp to the millisecond, and a timestamp-only cursor repeats one across pages.
    conditions.push(
      or(
        lt(schema.expenses.occurredAt, filters.cursor.occurredAt),
        and(
          eq(schema.expenses.occurredAt, filters.cursor.occurredAt),
          lt(schema.expenses.id, filters.cursor.id),
        ),
      )!,
    );
  }

  return (
    db
      .select()
      .from(schema.expenses)
      .where(and(...conditions))
      // Matches `expenses_vehicle_occurred_idx`, so this walks the index rather than sorting.
      .orderBy(desc(schema.expenses.occurredAt), desc(schema.expenses.id))
      .limit(filters.limit + 1)
  );
}

export async function findExpenseById(
  db: Executor,
  vehicleId: string,
  expenseId: string,
): Promise<ExpenseRow | null> {
  const [row] = await db
    .select()
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.id, expenseId),
        // Scoped to the vehicle, so an expense id from another garage cannot be read
        // through a vehicle the caller does have access to.
        eq(schema.expenses.vehicleId, vehicleId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertExpense(
  db: Executor,
  values: typeof schema.expenses.$inferInsert,
): Promise<ExpenseRow> {
  const [row] = await db.insert(schema.expenses).values(values).returning();
  if (!row) throw new Error('Expense insert returned no row');
  return row;
}

export async function updateExpense(
  db: Executor,
  expenseId: string,
  changes: Partial<typeof schema.expenses.$inferInsert>,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await db.update(schema.expenses).set(changes).where(eq(schema.expenses.id, expenseId));
}

/**
 * Hard delete. Financial records are not soft-deleted (§103): a total that silently changes
 * when a row is hidden is worse than no total, so removal is real and audited.
 */
export async function deleteExpense(db: Executor, expenseId: string): Promise<void> {
  await db.delete(schema.expenses).where(eq(schema.expenses.id, expenseId));
}

/**
 * Spend grouped by category and currency.
 *
 * Summed in SQL rather than by fetching rows: a vehicle with ten years of fill-ups has
 * thousands of expenses, and pulling them all across the wire to add them up is the kind of
 * thing that works fine until the first user who actually uses the product.
 */
export async function sumByCategory(
  db: Executor,
  vehicleId: string,
  window: { from?: Date; to?: Date } = {},
): Promise<CategorySum[]> {
  const conditions: SQL[] = [eq(schema.expenses.vehicleId, vehicleId)];
  if (window.from) conditions.push(gte(schema.expenses.occurredAt, window.from));
  if (window.to) conditions.push(lte(schema.expenses.occurredAt, window.to));

  const rows = await db
    .select({
      category: schema.expenses.category,
      currency: schema.expenses.currency,
      amountMinor: sql<number>`sum(${schema.expenses.amountMinor})::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.expenses)
    .where(and(...conditions))
    .groupBy(schema.expenses.category, schema.expenses.currency);

  return rows.map((row) => ({
    category: row.category,
    currency: row.currency,
    // `sum()` of a bigint comes back as a string from node-postgres — Number() here rather
    // than in the arithmetic, where a silent string concatenation would look like a total.
    amountMinor: Number(row.amountMinor),
    count: Number(row.count),
  }));
}

/**
 * The lowest and highest odometer readings on record for a vehicle.
 *
 * Read from `vehicle_events`, which is where every reading lands (§20) — including the ones
 * a maintenance completion writes. The span between them is the distance covered under this
 * owner, which is what a running cost has to be divided by.
 */
export async function odometerSpan(
  db: Executor,
  vehicleId: string,
): Promise<{ low: number | null; high: number | null }> {
  const [row] = await db
    .select({
      low: sql<number | null>`min(${schema.vehicleEvents.odometer})`,
      high: sql<number | null>`max(${schema.vehicleEvents.odometer})`,
    })
    .from(schema.vehicleEvents)
    .where(
      and(eq(schema.vehicleEvents.vehicleId, vehicleId), isNotNull(schema.vehicleEvents.odometer)),
    );

  return {
    low: row?.low === null || row?.low === undefined ? null : Number(row.low),
    high: row?.high === null || row?.high === undefined ? null : Number(row.high),
  };
}

/**
 * Every fuel fill on record, oldest first — the input to the full-to-full consumption
 * method, which needs the partial fills between two full tanks as much as the full ones.
 *
 * Not windowed: consumption is a property of the vehicle, not of the last 90 days, and a
 * window that cut the segment in half would divide one tank by two months of driving.
 */
export async function fuelFills(db: Executor, vehicleId: string): Promise<EnergyFill[]> {
  return db
    .select({
      occurredAt: schema.expenses.occurredAt,
      odometer: schema.expenses.odometer,
      odometerUnit: schema.expenses.odometerUnit,
      quantity: schema.expenses.quantity,
      quantityUnit: schema.expenses.quantityUnit,
      // Selected for `energy.ts`, which keeps each fuel's consumption apart rather than
      // averaging a hybrid's petrol and its charging into one figure.
      fuelType: schema.expenses.fuelType,
      isFullTank: sql<boolean | null>`(${schema.expenses.isFullTank} = 1)`,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.vehicleId, vehicleId),
        /*
         * Charging is its own category, and a vehicle that has both is exactly the case
         * this read exists for (GAPS §11, §19).
         */
        inArray(schema.expenses.category, ['FUEL', 'CHARGING']),
        isNotNull(schema.expenses.quantity),
      ),
    )
    .orderBy(schema.expenses.occurredAt);
}

/**
 * The currency a summary falls back to when nothing else names one — a vehicle with no
 * purchase price and no expenses yet. The garage's own default, so an empty summary is
 * already in the currency the first expense will most likely be entered in.
 */
/** The garage's currency and whether it wants other currencies converted into it. */
export async function garageCostSettings(
  db: Executor,
  garageId: string,
): Promise<{ currency: string; costReporting: 'STRICT' | 'CONVERTED' }> {
  const [row] = await db
    .select({
      currency: schema.garages.defaultCurrency,
      costReporting: schema.garages.costReporting,
    })
    .from(schema.garages)
    .where(eq(schema.garages.id, garageId))
    .limit(1);
  return row ?? { currency: 'USD', costReporting: 'STRICT' };
}

export async function garageDefaultCurrency(db: Executor, garageId: string): Promise<string> {
  const [row] = await db
    .select({ currency: schema.garages.defaultCurrency })
    .from(schema.garages)
    .where(eq(schema.garages.id, garageId))
    .limit(1);
  return row?.currency ?? 'USD';
}

/**
 * Spend per calendar month for one vehicle, per currency.
 *
 * Grouped by currency rather than filtered to one, so the caller decides: a strict garage
 * keeps the summary's currency and drops the rest, a converting one folds the rest in.
 *
 * `PURCHASE` is excluded, as it is from every other running-cost figure: the purchase is one
 * sum an order of magnitude above the rest, and a bar for it flattens every other month into
 * the axis — the chart would show only that the car was bought.
 *
 * Bucketed in UTC, which is how `occurred_at` is stored; the alternative is a boundary that
 * moves with the reader and a month that gains or loses its first day on a trip.
 */
export async function monthlySpend(
  db: Executor,
  vehicleId: string,
  from: Date,
): Promise<{ month: string; currency: string; amountMinor: number }[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${schema.expenses.occurredAt} at time zone 'UTC'), 'YYYY-MM')`,
      currency: schema.expenses.currency,
      amountMinor: sql<string>`sum(${schema.expenses.amountMinor})`,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.vehicleId, vehicleId),
        ne(schema.expenses.category, 'PURCHASE'),
        gte(schema.expenses.occurredAt, from),
      ),
    )
    .groupBy(sql`1`, schema.expenses.currency);

  // `sum()` of a bigint comes back as a string from the driver — Number() here rather than
  // in the arithmetic, where a silent concatenation would look like a total.
  return rows.map((row) => ({
    month: row.month,
    currency: row.currency,
    amountMinor: Number(row.amountMinor),
  }));
}

/**
 * Every fuel fill that has both halves of a price — an amount and a quantity — oldest first.
 * Charging is left out: a price per kWh is a different figure, and averaging it with litres
 * would be meaningless.
 */
export async function pricedFuelFills(db: Executor, vehicleId: string) {
  return db
    .select({
      occurredAt: schema.expenses.occurredAt,
      amountMinor: schema.expenses.amountMinor,
      currency: schema.expenses.currency,
      quantity: schema.expenses.quantity,
      quantityUnit: schema.expenses.quantityUnit,
      vendor: schema.expenses.vendor,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.vehicleId, vehicleId),
        eq(schema.expenses.category, 'FUEL'),
        isNotNull(schema.expenses.quantity),
      ),
    )
    .orderBy(schema.expenses.occurredAt);
}

/**
 * Every month this vehicle has cost anything, with the purchase kept separate.
 *
 * Unwindowed, unlike `monthlySpend`: the ownership curve is the whole history by definition,
 * and a curve that starts three years in starts at zero on a vehicle that has cost £12,000.
 */
export async function monthlyHistory(
  db: Executor,
  vehicleId: string,
  currency: string,
): Promise<{ month: string; amountMinor: number }[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${schema.expenses.occurredAt} at time zone 'UTC'), 'YYYY-MM')`,
      amountMinor: sql<string>`sum(${schema.expenses.amountMinor})`,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.vehicleId, vehicleId),
        ne(schema.expenses.category, 'PURCHASE'),
        // One currency, as every other figure here: a curve that adds euros to dollars is a
        // chart of exchange rates.
        eq(schema.expenses.currency, currency),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return rows.map((row) => ({ month: row.month, amountMinor: Number(row.amountMinor) }));
}

/**
 * Every odometer reading with a date, oldest first — the input to distance per year.
 *
 * From the events table, which is where readings live: an expense may carry one, but a service
 * or a plain reading entry is just as much a measurement of how far the vehicle has gone.
 */
export async function odometerReadings(
  db: Executor,
  vehicleId: string,
): Promise<{ occurredAt: Date; odometer: number; odometerUnit: 'KM' | 'MI' | null }[]> {
  const rows = await db
    .select({
      occurredAt: schema.vehicleEvents.occurredAt,
      odometer: schema.vehicleEvents.odometer,
      odometerUnit: schema.vehicleEvents.odometerUnit,
    })
    .from(schema.vehicleEvents)
    .where(
      and(eq(schema.vehicleEvents.vehicleId, vehicleId), isNotNull(schema.vehicleEvents.odometer)),
    )
    .orderBy(schema.vehicleEvents.occurredAt);

  return rows.flatMap((row) =>
    row.odometer === null
      ? []
      : [
          {
            occurredAt: row.occurredAt,
            odometer: Number(row.odometer),
            odometerUnit: row.odometerUnit,
          },
        ],
  );
}

/** The purchase, for the point the ownership curve starts at. */
export async function purchaseRecord(
  db: Executor,
  vehicleId: string,
  currency: string,
): Promise<{ amountMinor: number; occurredAt: Date } | null> {
  const [row] = await db
    .select({ amountMinor: schema.expenses.amountMinor, occurredAt: schema.expenses.occurredAt })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.vehicleId, vehicleId),
        eq(schema.expenses.category, 'PURCHASE'),
        eq(schema.expenses.currency, currency),
      ),
    )
    .orderBy(schema.expenses.occurredAt)
    .limit(1);

  return row ? { amountMinor: Number(row.amountMinor), occurredAt: row.occurredAt } : null;
}
