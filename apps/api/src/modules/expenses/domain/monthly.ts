/**
 * Spend per month (PRD §18, the analytics half of Architecture.md §27).
 *
 * Pure: the caller does the SQL, this fills the gaps. A month with no spending has to appear
 * as a zero rather than be missing — a chart drawn from only the months that had expenses
 * puts January next to July and reports a quiet summer as a busy one.
 */

export interface MonthlyPoint {
  /** `YYYY-MM`, UTC. */
  readonly month: string;
  readonly amountMinor: number;
}

/**
 * Every month in the window ending at `now`, oldest first.
 *
 * The window is counted back from the current month inclusive, so `months: 12` is this month
 * and the eleven before it — which is what "the last year" means to someone reading a chart
 * in March, not the twelve months ending last December.
 */
export function monthlySeries(
  rows: readonly MonthlyPoint[],
  months: number,
  now: Date,
): MonthlyPoint[] {
  const byMonth = new Map(rows.map((row) => [row.month, row.amountMinor]));

  const series: MonthlyPoint[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    // Built in UTC to match how the rows were bucketed. Doing it with a local-time Date
    // would shift the boundary for anyone east of Greenwich and drop or double a month.
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const key = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
    series.push({ month: key, amountMinor: byMonth.get(key) ?? 0 });
  }
  return series;
}

/** The first day of the earliest month the window covers, for the SQL bound. */
export function windowStart(months: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
}
