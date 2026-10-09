/**
 * Earned against spent (GAPS §14).
 *
 * Pure: the caller does the SQL. Both sides arrive already filtered to one currency, because
 * a profit figure that adds euros of income to dollars of cost is not a profit figure.
 */

export interface CurrencySum {
  readonly currency: string;
  readonly amountMinor: number;
  readonly count: number;
}

export interface NetInput {
  readonly earned: readonly CurrencySum[];
  readonly spentMinor: number;
  readonly currency: string;
  /** Distance covered in the window, in the vehicle's unit. Null when readings cannot say. */
  readonly distanceCovered: number | null;
}

export interface NetResult {
  readonly totalEarnedMinor: number;
  readonly netMinor: number;
  /** Minor units earned per unit of distance. Null without a distance to divide by. */
  readonly earnedPerDistanceMinor: number | null;
  readonly otherCurrencies: CurrencySum[];
}

/**
 * The headline figures, with everything in another currency left out and listed.
 *
 * `net` is signed. A month that cost more than it earned is the most useful thing this
 * function can report, and flooring it at zero would hide exactly that.
 */
export function computeNet(input: NetInput): NetResult {
  const mine = input.earned.filter((sum) => sum.currency === input.currency);
  const totalEarnedMinor = mine.reduce((total, sum) => total + sum.amountMinor, 0);

  return {
    totalEarnedMinor,
    netMinor: totalEarnedMinor - input.spentMinor,
    earnedPerDistanceMinor:
      input.distanceCovered && input.distanceCovered > 0
        ? Math.round(totalEarnedMinor / input.distanceCovered)
        : null,
    otherCurrencies: input.earned
      .filter((sum) => sum.currency !== input.currency)
      .sort((a, b) => b.amountMinor - a.amountMinor),
  };
}
