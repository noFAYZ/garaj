/**
 * The vehicle report — Overview, Refueling, Expenses, Income, Services, Routes — worked out from
 * the record the same way on the web and on the phone.
 *
 * Pure and structural: rows are typed by the fields read here rather than imported from the
 * contracts, so this package stays free of them and a test can build a row in one line. Money is
 * in minor units, distance in the vehicle's own unit, dates as ISO strings. A figure the record
 * cannot support is `null`, never a zero that reads as a real one.
 *
 * The three spend groups partition every running expense — nothing is in two, nothing is in
 * none — so the tabs always add up to the overview. The purchase is in none of them: it is
 * what the vehicle cost to get, not to run, and one bar of it flattens every month beside it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30.4375 * DAY_MS;

/* ——— Periods ——— */

export const REPORT_PERIODS = [
  { value: '1m', label: '1M', long: 'Last month', months: 1 },
  { value: '3m', label: '3M', long: 'Last 3 months', months: 3 },
  { value: '6m', label: '6M', long: 'Last 6 months', months: 6 },
  { value: '1y', label: '1Y', long: 'Last 12 months', months: 12 },
  { value: 'all', label: 'All', long: 'All time', months: null },
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number]['value'];

export const isReportPeriod = (value: unknown): value is ReportPeriod =>
  REPORT_PERIODS.some((period) => period.value === value);

export const periodOf = (value: ReportPeriod) =>
  REPORT_PERIODS.find((period) => period.value === value)!;

/**
 * Midnight UTC on the day `months` back. Not this instant: the value keys a query, and a
 * timestamp taken at render is a new key, a new request and a dead cache entry every render.
 */
export function periodStart(months: number | null, now = new Date()): string | undefined {
  if (months === null) return undefined;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()),
  ).toISOString();
}

/* ——— Groups ——— */

export type ReportGroup = 'REFUELING' | 'SERVICES' | 'EXPENSES';

/** In drawing order — the stack's order, bottom up, and the tabs' order. */
export const REPORT_GROUPS: readonly {
  key: ReportGroup;
  label: string;
  categories: readonly string[];
}[] = [
  { key: 'REFUELING', label: 'Refueling', categories: ['FUEL', 'CHARGING'] },
  { key: 'SERVICES', label: 'Services', categories: ['MAINTENANCE', 'REPAIR', 'PART', 'CLEANING'] },
  {
    key: 'EXPENSES',
    label: 'Expenses',
    categories: [
      'INSURANCE',
      'TAX',
      'REGISTRATION',
      'STORAGE',
      'TRANSPORT',
      'MODIFICATION',
      'ACCESSORY',
      'OTHER',
    ],
  },
];

/** The group a category's spend is reported under; `null` for the purchase. */
export function groupOf(category: string): ReportGroup | null {
  if (category === 'PURCHASE') return null;
  return REPORT_GROUPS.find((group) => group.categories.includes(category))?.key ?? 'EXPENSES';
}

/* ——— Rows ——— */

type Money = { amountMinor: number; currency: string };

/** The fields of an expense the report reads. */
export interface LedgerRow {
  id: string;
  category: string;
  description: string;
  vendor: string | null;
  amount: Money;
  occurredAt: string;
  odometer: number | null;
  quantity: string | null;
  quantityUnit: string | null;
  energyKwh: string | null;
}

export interface IncomeRow {
  id: string;
  category: string;
  description: string;
  payer: string | null;
  amount: Money;
  occurredAt: string;
}

export type TripPurpose = 'BUSINESS' | 'PERSONAL' | 'COMMUTE';

/** Business first — it is the one a report is usually for — then the two that are not claimed. */
export const TRIP_PURPOSES: readonly { key: TripPurpose; label: string }[] = [
  { key: 'BUSINESS', label: 'Business' },
  { key: 'COMMUTE', label: 'Commute' },
  { key: 'PERSONAL', label: 'Personal' },
];

export interface TripRow {
  eventId: string;
  occurredAt: string;
  title: string;
  trip: { purpose: TripPurpose; distance: number; deduction: Money | null };
}

/* ——— Time buckets ——— */

export type BucketUnit = 'month' | 'year';

/**
 * Every bucket from `fromMs` to `now`, quiet ones included — a series of only the busy months
 * puts January beside July. Months up to two years; past that, years, or the bars go to hairs.
 * UTC, the server's own bucketing.
 */
export function timeBuckets(
  fromMs: number,
  now = new Date(),
): { unit: BucketUnit; keys: string[] } {
  const start = new Date(Math.min(fromMs, now.getTime()));
  const months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth()) +
    1;
  if (months > 24) {
    const keys: string[] = [];
    for (let year = start.getUTCFullYear(); year <= now.getUTCFullYear(); year += 1) {
      keys.push(String(year));
    }
    return { unit: 'year', keys };
  }
  return {
    unit: 'month',
    keys: Array.from({ length: months }, (_, index) => {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }),
  };
}

const bucketOf = (iso: string, unit: BucketUnit) =>
  new Date(iso).toISOString().slice(0, unit === 'month' ? 7 : 4);

const SHORT_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const LONG_MONTH = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-09` → `Sep` / `September 2026`; `2025` → `’25` / `2025`. Noon UTC, so no zone moves it. */
export function bucketLabel(key: string, style: 'short' | 'long'): string {
  if (key.length === 4) return style === 'short' ? `’${key.slice(2)}` : key;
  const date = new Date(`${key}-01T12:00:00Z`);
  return (style === 'short' ? SHORT_MONTH : LONG_MONTH).format(date);
}

/* ——— Ranking ——— */

export interface Ranked {
  key: string;
  amountMinor: number;
  count: number;
}

/** Sums by key, largest first. A blank key is dropped; keys differing only in case are one. */
function rank<T>(
  rows: readonly T[],
  keyOf: (row: T) => string | null,
  amountOf: (row: T) => number,
): Ranked[] {
  const totals = new Map<string, Ranked>();
  for (const row of rows) {
    const raw = keyOf(row)?.trim();
    if (!raw) continue;
    const id = raw.toLowerCase();
    const current = totals.get(id) ?? { key: raw, amountMinor: 0, count: 0 };
    totals.set(id, {
      ...current,
      amountMinor: current.amountMinor + amountOf(row),
      count: current.count + 1,
    });
  }
  return [...totals.values()].sort((a, b) => b.amountMinor - a.amountMinor);
}

/* ——— Spend ——— */

export interface SpendReport<T extends LedgerRow = LedgerRow> {
  currency: string;
  fromMs: number;
  toMs: number;
  /** Whole days the window spans, never under one. */
  days: number;
  unit: BucketUnit;
  /** Running spend: every group, the purchase excluded. */
  total: number;
  count: number;
  groups: Record<ReportGroup, { total: number; count: number }>;
  buckets: { key: string; values: Record<ReportGroup, number>; total: number }[];
  /** In the report's currency and window, running only, newest first. */
  rows: T[];
  purchaseMinor: number;
  /** Spend in other currencies, left out rather than converted at a guess. */
  excluded: { currency: string; amountMinor: number; count: number }[];
}

const emptyGroups = () =>
  ({
    REFUELING: { total: 0, count: 0 },
    SERVICES: { total: 0, count: 0 },
    EXPENSES: { total: 0, count: 0 },
  }) satisfies SpendReport['groups'];

export function buildSpendReport<T extends LedgerRow>(
  ledger: readonly T[],
  { currency, from, now = new Date() }: { currency: string; from?: string; now?: Date },
): SpendReport<T> {
  const toMs = now.getTime();
  const earliest = Math.min(toMs, ...ledger.map((row) => Date.parse(row.occurredAt)));
  const fromMs = from ? Date.parse(from) : earliest;
  const inWindow = ledger.filter((row) => {
    const at = Date.parse(row.occurredAt);
    return at >= fromMs && at <= toMs;
  });

  const excluded = new Map<string, { currency: string; amountMinor: number; count: number }>();
  const rows: T[] = [];
  let purchaseMinor = 0;
  for (const row of inWindow) {
    if (row.amount.currency !== currency) {
      const other = excluded.get(row.amount.currency) ?? {
        currency: row.amount.currency,
        amountMinor: 0,
        count: 0,
      };
      excluded.set(row.amount.currency, {
        ...other,
        amountMinor: other.amountMinor + row.amount.amountMinor,
        count: other.count + 1,
      });
    } else if (groupOf(row.category) === null) {
      purchaseMinor += row.amount.amountMinor;
    } else {
      rows.push(row);
    }
  }
  rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const { unit, keys } = timeBuckets(fromMs, now);
  const buckets = new Map(
    keys.map((key) => [
      key,
      {
        key,
        values: { REFUELING: 0, SERVICES: 0, EXPENSES: 0 } as Record<ReportGroup, number>,
        total: 0,
      },
    ]),
  );
  const groups = emptyGroups();
  for (const row of rows) {
    const group = groupOf(row.category)!;
    const amount = row.amount.amountMinor;
    groups[group].total += amount;
    groups[group].count += 1;
    const bucket = buckets.get(bucketOf(row.occurredAt, unit));
    if (bucket) {
      bucket.values[group] += amount;
      bucket.total += amount;
    }
  }

  return {
    currency,
    fromMs,
    toMs,
    days: Math.max(1, Math.round((toMs - fromMs) / DAY_MS)),
    unit,
    total: rows.reduce((sum, row) => sum + row.amount.amountMinor, 0),
    count: rows.length,
    groups,
    buckets: [...buckets.values()],
    rows,
    purchaseMinor,
    excluded: [...excluded.values()],
  };
}

/** Months the window spans, as a fraction — the divisor of a per-month figure. */
export const reportMonths = (report: Pick<SpendReport, 'fromMs' | 'toMs'>) =>
  Math.max(1, (report.toMs - report.fromMs) / MONTH_MS);

export interface GroupDetail<T extends LedgerRow = LedgerRow> {
  total: number;
  count: number;
  /** Per entry. */
  averageMinor: number | null;
  perMonthMinor: number;
  byCategory: Ranked[];
  byVendor: Ranked[];
  /** Largest first, at most five. */
  largest: T[];
  latest: T | null;
  buckets: { key: string; value: number }[];
  rows: T[];
}

/** One group's slice of the report: the figures its tab leads with. */
export function groupDetail<T extends LedgerRow>(
  report: SpendReport<T>,
  group: ReportGroup,
): GroupDetail<T> {
  const rows = report.rows.filter((row) => groupOf(row.category) === group);
  const total = report.groups[group].total;
  return {
    total,
    count: rows.length,
    averageMinor: rows.length > 0 ? Math.round(total / rows.length) : null,
    perMonthMinor: Math.round(total / reportMonths(report)),
    byCategory: rank(
      rows,
      (row) => row.category,
      (row) => row.amount.amountMinor,
    ),
    byVendor: rank(
      rows,
      (row) => row.vendor,
      (row) => row.amount.amountMinor,
    ),
    largest: [...rows].sort((a, b) => b.amount.amountMinor - a.amount.amountMinor).slice(0, 5),
    latest: rows[0] ?? null,
    buckets: report.buckets.map((bucket) => ({ key: bucket.key, value: bucket.values[group] })),
    rows,
  };
}

/* ——— Distance ——— */

/**
 * How far the odometer moved inside the window: the span of the readings in it. Null under two
 * readings — one reading is a position, not a distance.
 */
export function distanceInWindow(
  readings: readonly { occurredAt: string; odometer: number | null }[],
  fromMs: number,
  toMs = Date.now(),
): number | null {
  const values = readings
    .filter((reading) => {
      const at = Date.parse(reading.occurredAt);
      return reading.odometer !== null && at >= fromMs && at <= toMs;
    })
    .map((reading) => reading.odometer!);
  if (values.length < 2) return null;
  const distance = Math.max(...values) - Math.min(...values);
  return distance > 0 ? distance : null;
}

/* ——— Refuelling ——— */

export interface FuelUnitReport {
  /** LITER, US_GALLON, IMP_GALLON, KWH or KG — never summed across. */
  unit: string;
  quantity: number;
  fills: number;
  /** What the fills with a quantity cost, over that quantity. Minor units, unrounded. */
  pricePerUnitMinor: number | null;
  prices: { at: number; perUnitMinor: number; vendor: string | null }[];
  /** Cheapest first. */
  places: { vendor: string; fills: number; perUnitMinor: number }[];
}

export interface RefuelReport {
  fills: number;
  total: number;
  averageFillMinor: number | null;
  /** Mean gap between consecutive fills. */
  daysBetween: number | null;
  distanceBetween: number | null;
  /** Largest quantity first: a plug-in hybrid gets litres and kilowatt-hours, apart. */
  units: FuelUnitReport[];
  latest: LedgerRow | null;
}

/** What went in, and what it is measured in. Charging reads its kWh; a fill its quantity. */
function quantityOf(row: LedgerRow): { unit: string; quantity: number } | null {
  const raw = row.category === 'CHARGING' ? (row.energyKwh ?? row.quantity) : row.quantity;
  const quantity = Number(raw);
  if (!raw || !Number.isFinite(quantity) || quantity <= 0) return null;
  const unit = row.category === 'CHARGING' ? 'KWH' : (row.quantityUnit ?? 'LITER');
  return { unit, quantity };
}

export function buildRefuelReport(report: SpendReport): RefuelReport {
  const fills = report.rows
    .filter((row) => groupOf(row.category) === 'REFUELING')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const total = fills.reduce((sum, row) => sum + row.amount.amountMinor, 0);

  const first = fills[0];
  const last = fills[fills.length - 1];
  const daysBetween =
    first && last && fills.length >= 2
      ? (Date.parse(last.occurredAt) - Date.parse(first.occurredAt)) / DAY_MS / (fills.length - 1)
      : null;
  const read = fills.filter((row) => row.odometer !== null).map((row) => row.odometer!);
  const span = read.length >= 2 ? Math.max(...read) - Math.min(...read) : 0;
  const distanceBetween = span > 0 ? span / (read.length - 1) : null;

  const byUnit = new Map<string, { row: LedgerRow; quantity: number }[]>();
  for (const row of fills) {
    const measured = quantityOf(row);
    if (!measured) continue;
    byUnit.set(measured.unit, [
      ...(byUnit.get(measured.unit) ?? []),
      { row, quantity: measured.quantity },
    ]);
  }
  const units: FuelUnitReport[] = [...byUnit.entries()]
    .map(([unit, entries]) => {
      const quantity = entries.reduce((sum, entry) => sum + entry.quantity, 0);
      const cost = entries.reduce((sum, entry) => sum + entry.row.amount.amountMinor, 0);
      const places = new Map<
        string,
        { vendor: string; fills: number; cost: number; quantity: number }
      >();
      for (const { row, quantity: amount } of entries) {
        const vendor = row.vendor?.trim();
        if (!vendor) continue;
        const id = vendor.toLowerCase();
        const place = places.get(id) ?? { vendor, fills: 0, cost: 0, quantity: 0 };
        places.set(id, {
          ...place,
          fills: place.fills + 1,
          cost: place.cost + row.amount.amountMinor,
          quantity: place.quantity + amount,
        });
      }
      return {
        unit,
        quantity,
        fills: entries.length,
        pricePerUnitMinor: quantity > 0 ? cost / quantity : null,
        prices: entries.map(({ row, quantity: amount }) => ({
          at: Date.parse(row.occurredAt),
          perUnitMinor: row.amount.amountMinor / amount,
          vendor: row.vendor,
        })),
        places: [...places.values()]
          .map((place) => ({
            vendor: place.vendor,
            fills: place.fills,
            perUnitMinor: place.cost / place.quantity,
          }))
          .sort((a, b) => a.perUnitMinor - b.perUnitMinor),
      };
    })
    .sort((a, b) => b.quantity - a.quantity);

  return {
    fills: fills.length,
    total,
    averageFillMinor: fills.length > 0 ? Math.round(total / fills.length) : null,
    daysBetween,
    distanceBetween,
    units,
    latest: last ?? null,
  };
}

/**
 * Consumption inside the window, from the server's measured steps. Weighted by distance — every
 * drop over every kilometre — not the mean of the steps, which lets a short splash count as much
 * as a long tank. `perHundred` reads L/100 km (lower is better); otherwise distance per unit.
 */
export function efficiencyInWindow(
  points: readonly {
    occurredAt: string;
    quantity: number;
    distanceCovered: number;
    per100Km: number;
    distancePerUnit: number;
  }[],
  fromMs: number,
  perHundred: boolean,
): { average: number; best: number; worst: number; points: { x: number; y: number }[] } | null {
  const inWindow = points.filter((point) => Date.parse(point.occurredAt) >= fromMs);
  const quantity = inWindow.reduce((sum, point) => sum + point.quantity, 0);
  const distance = inWindow.reduce((sum, point) => sum + point.distanceCovered, 0);
  if (inWindow.length === 0 || quantity <= 0 || distance <= 0) return null;
  const rates = inWindow.map((point) => ({
    x: Date.parse(point.occurredAt),
    y: perHundred ? point.per100Km : point.distancePerUnit,
  }));
  const ys = rates.map((point) => point.y);
  return {
    average: perHundred ? (quantity / distance) * 100 : distance / quantity,
    best: perHundred ? Math.min(...ys) : Math.max(...ys),
    worst: perHundred ? Math.max(...ys) : Math.min(...ys),
    points: rates,
  };
}

/* ——— Income ——— */

export interface IncomeReport {
  total: number;
  count: number;
  averageMinor: number | null;
  /** Earned less the running spend of the same window. Negative is reported, not floored. */
  net: number;
  byCategory: Ranked[];
  byPayer: Ranked[];
  buckets: { key: string; earned: number; spent: number }[];
  excluded: { currency: string; amountMinor: number; count: number }[];
}

export function buildIncomeReport(income: readonly IncomeRow[], spend: SpendReport): IncomeReport {
  const rows: IncomeRow[] = [];
  const excluded = new Map<string, { currency: string; amountMinor: number; count: number }>();
  for (const row of income) {
    const at = Date.parse(row.occurredAt);
    if (at < spend.fromMs || at > spend.toMs) continue;
    if (row.amount.currency === spend.currency) {
      rows.push(row);
      continue;
    }
    const other = excluded.get(row.amount.currency) ?? {
      currency: row.amount.currency,
      amountMinor: 0,
      count: 0,
    };
    excluded.set(row.amount.currency, {
      ...other,
      amountMinor: other.amountMinor + row.amount.amountMinor,
      count: other.count + 1,
    });
  }
  const total = rows.reduce((sum, row) => sum + row.amount.amountMinor, 0);
  const earned = new Map(spend.buckets.map((bucket) => [bucket.key, 0]));
  for (const row of rows) {
    const key = bucketOf(row.occurredAt, spend.unit);
    if (earned.has(key)) earned.set(key, earned.get(key)! + row.amount.amountMinor);
  }
  return {
    total,
    count: rows.length,
    averageMinor: rows.length > 0 ? Math.round(total / rows.length) : null,
    net: total - spend.total,
    byCategory: rank(
      rows,
      (row) => row.category,
      (row) => row.amount.amountMinor,
    ),
    byPayer: rank(
      rows,
      (row) => row.payer,
      (row) => row.amount.amountMinor,
    ),
    buckets: spend.buckets.map((bucket) => ({
      key: bucket.key,
      earned: earned.get(bucket.key) ?? 0,
      spent: bucket.total,
    })),
    excluded: [...excluded.values()],
  };
}

/* ——— Routes ——— */

export interface RoutesReport {
  trips: number;
  distance: number;
  averageDistance: number | null;
  byPurpose: Record<TripPurpose, { distance: number; trips: number }>;
  /** Business distance over all logged distance. */
  businessShare: number | null;
  unit: BucketUnit;
  buckets: { key: string; values: Record<TripPurpose, number>; total: number }[];
  /** Longest first, at most five. */
  longest: TripRow[];
}

export function buildRoutesReport(
  trips: readonly TripRow[],
  { from, now = new Date() }: { from?: string; now?: Date },
): RoutesReport {
  const fromMs = from
    ? Date.parse(from)
    : Math.min(now.getTime(), ...trips.map((row) => Date.parse(row.occurredAt)));
  const rows = trips.filter((row) => Date.parse(row.occurredAt) >= fromMs);
  const byPurpose: RoutesReport['byPurpose'] = {
    BUSINESS: { distance: 0, trips: 0 },
    PERSONAL: { distance: 0, trips: 0 },
    COMMUTE: { distance: 0, trips: 0 },
  };
  const { unit, keys } = timeBuckets(fromMs, now);
  const buckets = new Map(
    keys.map((key) => [
      key,
      {
        key,
        values: { BUSINESS: 0, PERSONAL: 0, COMMUTE: 0 } as Record<TripPurpose, number>,
        total: 0,
      },
    ]),
  );
  for (const row of rows) {
    const { purpose, distance } = row.trip;
    byPurpose[purpose].distance += distance;
    byPurpose[purpose].trips += 1;
    const bucket = buckets.get(bucketOf(row.occurredAt, unit));
    if (bucket) {
      bucket.values[purpose] += distance;
      bucket.total += distance;
    }
  }
  const distance = rows.reduce((sum, row) => sum + row.trip.distance, 0);
  return {
    trips: rows.length,
    distance,
    averageDistance: rows.length > 0 ? distance / rows.length : null,
    byPurpose,
    businessShare: distance > 0 ? byPurpose.BUSINESS.distance / distance : null,
    unit,
    buckets: [...buckets.values()],
    longest: [...rows].sort((a, b) => b.trip.distance - a.trip.distance).slice(0, 5),
  };
}

/* ——— Insights: what the record adds up to past its sums ——— */

/** Whole months between a day and now, never under one. */
export function monthsSince(day: string, now = new Date()): number {
  return Math.max(1, Math.floor((now.getTime() - Date.parse(`${day}T00:00:00`)) / MONTH_MS));
}

/**
 * Spend per month over the last year, and against the year before. `points` oldest first, one per
 * month, quiet months as zeros. The average only counts months the vehicle was owned, so a car
 * bought in June is not averaged over an empty spring.
 */
export function monthlyPace(
  points: readonly { amountMinor: number }[],
  ownedMonths: number | null,
): { averageMinor: number; lastYearMinor: number; changePercent: number | null } | null {
  if (points.length === 0) return null;
  const last = points.slice(-12);
  const lastYearMinor = last.reduce((sum, point) => sum + point.amountMinor, 0);
  const months = Math.max(1, Math.min(last.length, ownedMonths ?? last.length));
  const previous = points.length >= 24 ? points.slice(-24, -12) : null;
  const previousMinor = previous?.reduce((sum, point) => sum + point.amountMinor, 0) ?? 0;
  const changePercent =
    previous && previousMinor > 0 && (ownedMonths === null || ownedMonths >= 24)
      ? Math.round(((lastYearMinor - previousMinor) / previousMinor) * 1000) / 10
      : null;
  return { averageMinor: Math.round(lastYearMinor / months), lastYearMinor, changePercent };
}

/**
 * What each unit of distance has really cost: the running costs plus what the vehicle has lost in
 * value, over the distance driven while owned. The figure a running-cost-per-km leaves out, and
 * the one that decides whether a cheap car was cheap.
 */
export function trueCostPerDistance({
  runningMinor,
  paidMinor,
  worthMinor,
  distance,
}: {
  runningMinor: number;
  paidMinor: number | null;
  worthMinor: number | null;
  distance: number | null;
}): { perDistanceMinor: number; includesDepreciation: boolean } | null {
  if (!distance || distance <= 0) return null;
  const depreciation =
    paidMinor !== null && worthMinor !== null ? Math.max(0, paidMinor - worthMinor) : null;
  const total = runningMinor + (depreciation ?? 0);
  if (total <= 0) return null;
  return { perDistanceMinor: total / distance, includesDepreciation: depreciation !== null };
}

/** Value lost per year owned. Under a quarter of a year is too short to annualise honestly. */
export function depreciationPerYear(
  paidMinor: number | null,
  worthMinor: number | null,
  purchaseDate: string | null,
  now = new Date(),
): number | null {
  if (paidMinor === null || worthMinor === null || !purchaseDate) return null;
  const years = (now.getTime() - Date.parse(`${purchaseDate}T00:00:00`)) / (MONTH_MS * 12);
  if (years < 0.25) return null;
  return Math.round((paidMinor - worthMinor) / years);
}

/** Average distance a year, from whole years only; the current year is still being driven. */
export function distancePerYear(
  years: readonly { year: number; distance: number }[],
  now = new Date(),
): number | null {
  const whole = years.filter((row) => row.year < now.getFullYear() && row.distance > 0);
  const pool = whole.length > 0 ? whole : years.filter((row) => row.distance > 0);
  if (pool.length === 0) return null;
  return Math.round(pool.reduce((sum, row) => sum + row.distance, 0) / pool.length);
}
