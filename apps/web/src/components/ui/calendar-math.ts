/**
 * The date picker's calendar arithmetic, as plain functions on `YYYY-MM-DD` strings — the format a
 * date input, the forms and the API all already speak. Local calendar days throughout: a `Date` is
 * only ever built at local midnight, because `toISOString` is a day off for half the world at night.
 * No DOM and no React, so the parts most likely to be subtly wrong are tested directly.
 */

export type Day = string;

const pad = (value: number) => String(value).padStart(2, '0');

export const toDay = (date: Date): Day =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The local date a day names; null for anything that is not a real day ("2026-02-31"). */
export function fromDay(day: Day): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const parsed = new Date(year, month, date);
  return parsed.getMonth() === month && parsed.getDate() === date ? parsed : null;
}

export const todayDay = (): Day => toDay(new Date());

export function addDays(day: Day, days: number): Day {
  const date = fromDay(day)!;
  return toDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

/** Calendar months on, holding the day where the month has it — 31 Jan and a month is 28 Feb. */
export function addMonths(day: Day, months: number): Day {
  const date = fromDay(day)!;
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), last));
  return toDay(target);
}

/** Inside the bounds, either of which may be missing. ISO days compare as strings. */
export const within = (day: Day, min?: Day, max?: Day) =>
  !(min && day < min) && !(max && day > max);

export function clamp(day: Day, min?: Day, max?: Day): Day {
  if (min && day < min) return min;
  if (max && day > max) return max;
  return day;
}

/** Monday first: the week most of the app's users count in. */
export const WEEK_START = 1;

/** Where a day falls in its displayed week, 0 for the first column. */
export const column = (day: Day) => (fromDay(day)!.getDay() - WEEK_START + 7) % 7;

/**
 * The 42 days a month view shows — six full weeks from the week the 1st falls in — so the grid
 * never changes height as the months go by.
 */
export function monthGrid(year: number, month: number): Day[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - WEEK_START + 7) % 7;
  return Array.from({ length: 42 }, (_, index) => toDay(new Date(year, month, 1 - offset + index)));
}

/** A range in order, whichever end was picked first. */
export const ordered = (a: Day, b: Day): [Day, Day] => (a <= b ? [a, b] : [b, a]);
