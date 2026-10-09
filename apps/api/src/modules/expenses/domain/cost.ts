/**
 * Cost rollups (PRD §18, Architecture.md §27).
 *
 * Pure: the caller does the SQL, this does the arithmetic. Every figure the product quotes
 * to a user — "this car has cost you €14,200, €0.31 per kilometre" — comes out of here, so
 * it is the one place worth testing exhaustively.
 */

import type { ExpenseCategory } from '@vehicle-os/domain';

export interface CategorySum {
  readonly category: ExpenseCategory;
  readonly currency: string;
  readonly amountMinor: number;
  readonly count: number;
}

export interface CostInput {
  /** Sums grouped by (category, currency), over the requested window. */
  readonly windowSums: readonly CategorySum[];
  /** The same grouping over all time — the lifetime figures ignore the window. */
  readonly lifetimeSums: readonly CategorySum[];

  readonly purchasePriceAmountMinor: number | null;
  readonly purchasePriceCurrency: string | null;
  /** `YYYY-MM-DD`, as stored. */
  readonly purchaseDate: string | null;

  /** Lowest and highest odometer readings on record, in the vehicle's own unit. */
  readonly odometerLow: number | null;
  readonly odometerHigh: number | null;

  /** For dividing by elapsed years. Injected so the tests are not clock-dependent. */
  readonly now: Date;
}

export interface CostTotals {
  readonly currency: string;
  readonly totalSpentMinor: number;
  readonly byCategory: readonly { category: ExpenseCategory; amountMinor: number; count: number }[];
  readonly purchasePriceMinor: number | null;
  readonly ownershipCostMinor: number;
  readonly costPerYearMinor: number | null;
  readonly costPerDistanceMinor: number | null;
  readonly distanceCovered: number | null;
  readonly otherCurrencies: readonly { currency: string; amountMinor: number; count: number }[];
}

/**
 * Which currency the summary is quoted in.
 *
 * The purchase currency wins, because the purchase is almost always the largest single sum
 * and a summary that excluded it would be reporting the small change. Failing that, the
 * currency with the most spend — not the most rows, or one tank of fuel abroad outvotes a
 * gearbox rebuild at home.
 */
export function primaryCurrency(input: CostInput, fallback: string): string {
  if (input.purchasePriceCurrency) return input.purchasePriceCurrency;

  const totals = new Map<string, number>();
  for (const sum of input.lifetimeSums) {
    totals.set(sum.currency, (totals.get(sum.currency) ?? 0) + sum.amountMinor);
  }

  let best: string | null = null;
  let bestTotal = -1;
  // Ties broken alphabetically rather than by iteration order, so the same data always
  // produces the same answer regardless of how the rows came back.
  for (const [currency, total] of [...totals].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (total > bestTotal) {
      best = currency;
      bestTotal = total;
    }
  }
  return best ?? fallback;
}

const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;

export function computeCost(input: CostInput, fallbackCurrency: string): CostTotals {
  const currency = primaryCurrency(input, fallbackCurrency);

  const inCurrency = (sums: readonly CategorySum[]) =>
    sums.filter((sum) => sum.currency === currency);

  const byCategory = inCurrency(input.windowSums)
    .map((sum) => ({ category: sum.category, amountMinor: sum.amountMinor, count: sum.count }))
    // Largest first: a cost breakdown is read to find where the money went.
    .sort((a, b) => b.amountMinor - a.amountMinor || a.category.localeCompare(b.category));

  const totalSpentMinor = byCategory.reduce((total, row) => total + row.amountMinor, 0);

  /*
   * Lifetime running spend excludes PURCHASE, because the purchase price is added from the
   * vehicle itself. Someone who recorded the purchase in both places would otherwise see it
   * counted twice, and the error is invisible — it just looks like an expensive car.
   */
  const lifetimeRunningMinor = inCurrency(input.lifetimeSums)
    .filter((sum) => sum.category !== 'PURCHASE')
    .reduce((total, sum) => total + sum.amountMinor, 0);

  const purchasePriceMinor =
    input.purchasePriceCurrency === currency ? input.purchasePriceAmountMinor : null;
  const ownershipCostMinor = (purchasePriceMinor ?? 0) + lifetimeRunningMinor;

  const years = elapsedYears(input.purchaseDate, input.now);
  const costPerYearMinor =
    years === null || years <= 0 ? null : Math.round(ownershipCostMinor / years);

  /*
   * Distance covered is measured between the readings on record, not from zero: nothing
   * stores the odometer at purchase, so a used vehicle's `currentOdometer` includes tens of
   * thousands of kilometres this owner neither drove nor paid for.
   */
  const distanceCovered =
    input.odometerLow === null || input.odometerHigh === null
      ? null
      : Math.max(0, input.odometerHigh - input.odometerLow);

  const costPerDistanceMinor =
    distanceCovered === null || distanceCovered === 0
      ? null
      : Math.round(lifetimeRunningMinor / distanceCovered);

  const others = new Map<string, { amountMinor: number; count: number }>();
  for (const sum of input.lifetimeSums) {
    if (sum.currency === currency) continue;
    const existing = others.get(sum.currency) ?? { amountMinor: 0, count: 0 };
    others.set(sum.currency, {
      amountMinor: existing.amountMinor + sum.amountMinor,
      count: existing.count + sum.count,
    });
  }

  return {
    currency,
    totalSpentMinor,
    byCategory,
    purchasePriceMinor,
    ownershipCostMinor,
    costPerYearMinor,
    costPerDistanceMinor,
    distanceCovered,
    otherCurrencies: [...others]
      .map(([code, totals]) => ({ currency: code, ...totals }))
      .sort((a, b) => b.amountMinor - a.amountMinor || a.currency.localeCompare(b.currency)),
  };
}

/**
 * Years between a stored `YYYY-MM-DD` and now, as a fraction.
 *
 * A mean Gregorian year rather than 365 days: over a decade the difference is more than two
 * days, which is enough to move an annual cost figure by a visible amount.
 */
export function elapsedYears(purchaseDate: string | null, now: Date): number | null {
  if (!purchaseDate) return null;
  const purchased = new Date(`${purchaseDate}T00:00:00Z`);
  if (Number.isNaN(purchased.getTime())) return null;

  const elapsed = now.getTime() - purchased.getTime();
  // A future purchase date is data entry, not time travel; dividing by it would produce a
  // negative annual cost.
  return elapsed <= 0 ? null : elapsed / MS_PER_YEAR;
}

/**
 * Every sum re-expressed in `target`, for a garage that asked for converted totals (GAPS §7).
 *
 * All or nothing, like the aside it replaces: if any currency cannot be converted the caller
 * gets null and keeps the strict figures. A total that quietly left out the one currency the
 * rate table lacked would be a converted total that is short, with nothing saying so.
 *
 * Converted per (category, currency) group rather than per row, then merged: the rate is the
 * same for every row in a group, and rounding once per group keeps the result reproducible
 * from the published rate.
 */
export function convertSums(
  sums: readonly CategorySum[],
  target: string,
  convert: (amountMinor: number, from: string) => number | null,
): CategorySum[] | null {
  const merged = new Map<ExpenseCategory, { amountMinor: number; count: number }>();

  for (const sum of sums) {
    const amount =
      sum.currency === target ? sum.amountMinor : convert(sum.amountMinor, sum.currency);
    if (amount === null) return null;
    const entry = merged.get(sum.category) ?? { amountMinor: 0, count: 0 };
    entry.amountMinor += amount;
    entry.count += sum.count;
    merged.set(sum.category, entry);
  }

  return [...merged].map(([category, entry]) => ({ category, currency: target, ...entry }));
}
