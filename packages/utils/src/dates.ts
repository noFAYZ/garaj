/**
 * Date helpers. All arithmetic is UTC — the server never reads the host timezone, so a
 * container in a different region cannot shift a maintenance due date by a day.
 */

export const MS_PER_DAY = 86_400_000;

/**
 * Adds calendar months, clamping to the last valid day of the target month.
 *
 * Native `Date.setMonth` overflows instead: 31 Jan + 1 month gives 3 March, so a service
 * scheduled monthly from the 31st drifts forward through the year and eventually skips a
 * month entirely. Clamping to 28 Feb is what a person means by "a month later".
 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonthStart = Date.UTC(year, month + months, 1);
  const target = new Date(targetMonthStart);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();

  target.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  target.setUTCHours(
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
  return target;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** `YYYY-MM-DD` for a date-only column (purchase date, registration expiry). */
export function toDateOnly(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

export function fromDateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Expected a YYYY-MM-DD date, received: ${value}`);
  }
  return parsed;
}
