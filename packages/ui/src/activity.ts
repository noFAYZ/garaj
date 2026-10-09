/**
 * Pure helpers behind the activity feed, the add forms and the notification list — shared so the
 * web and the phone group, count and format the same record the same way.
 *
 * Typed structurally rather than against `@vehicle-os/contracts`, which this package does not
 * depend on: anything with the fields works.
 */

interface Dated {
  readonly occurredAt: string;
}

interface Reading extends Dated {
  readonly id: string;
  readonly odometer: number | null;
  readonly odometerUnit: string | null;
}

export interface MonthGroup<T> {
  /** `2026-09`. */
  readonly key: string;
  /** `September 2026`. */
  readonly label: string;
  readonly items: T[];
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

/**
 * Consecutive runs by calendar month, in the order given. The feed arrives newest first; grouping
 * into a map and reading it back would quietly re-sort the record.
 *
 * In the device's own zone, because entries carry the real time they were logged (`stampForDay`):
 * a fill-up at 1am is that local day, not the previous one in UTC.
 */
export function groupByMonth<T extends Dated>(items: readonly T[]): MonthGroup<T>[] {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const date = new Date(item.occurredAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (groups.at(-1)?.key !== key)
      groups.push({ key, label: MONTH_LABEL.format(date), items: [] });
    groups.at(-1)!.items.push(item);
  }
  return groups;
}

/**
 * Distance since the previous entry with a reading, keyed by entry. Walked oldest to newest; only
 * a rise in the same unit counts — a lower reading is a correction or a cluster swap.
 */
export function odometerDeltas(items: readonly Reading[]): Map<string, number> {
  const deltas = new Map<string, number>();
  let previous: Reading | null = null;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.odometer === null) continue;
    if (
      previous?.odometer != null &&
      previous.odometerUnit === item.odometerUnit &&
      item.odometer > previous.odometer
    ) {
      deltas.set(item.id, item.odometer - previous.odometer);
    }
    previous = item;
  }
  return deltas;
}

/** A calendar day in the device's own zone as `YYYY-MM-DD`; `toISOString` is a day off at night. */
export function localDay(shift: { days?: number; months?: number } = {}, now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + (shift.days ?? 0));
  date.setMonth(date.getMonth() + (shift.months ?? 0));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The instant to record an entry dated `day` (`YYYY-MM-DD`, local).
 *
 * Today is the moment it is logged. Another day is that day at the current time of day. Entries
 * were stamped at 12:00 UTC while quick entries used the real time, so one day's entries sorted
 * by an invented noon and interleaved — the newest sandwiched between older ones. A real time
 * keeps a day's entries in the order they were made.
 */
export function stampForDay(day: string, now = new Date()): string {
  if (day === localDay({}, now)) return now.toISOString();
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(
    year,
    month - 1,
    date,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds(),
  ).toISOString();
}

/** Whole days from today to a `YYYY-MM-DD`, between local midnights; negative once it has passed. */
export function daysUntil(day: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((new Date(`${day}T00:00:00`).getTime() - today) / 86_400_000);
}

/** Digits only, no leading zeros — what an odometer or an interval can be typed as. */
export const digitsOnly = (value: string, max = 9): string =>
  value
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, max);

/** Up to two decimals and one point — what a price can be typed as. */
export function amountOnly(value: string): string {
  const [whole = '', ...rest] = value.replace(/[^\d.]/g, '').split('.');
  const cleaned = whole.replace(/^0+(?=\d)/, '').slice(0, 9);
  return rest.length ? `${cleaned}.${rest.join('').slice(0, 2)}` : cleaned;
}

/** `Today`, `Yesterday`, `This week`, `Earlier` — counted between local midnights. */
export function dayBucket(iso: string, now = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor((today - new Date(iso).getTime()) / 86_400_000) + 1;
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

/** A clock-sized age: `now`, `12m`, `3h`, `2d`, then the date. */
export function shortAge(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface Gaugeable {
  readonly status: string;
  readonly lastPerformedAt: string | null;
  readonly lastPerformedOdometer: number | null;
  readonly nextDueDate: string | null;
  readonly nextDueOdometer: number | null;
  readonly daysRemaining: number | null;
  readonly distanceRemaining: number | null;
}

export interface DueGauge {
  /** Whether the distance interval leads — the one further along, so the one arriving first. */
  readonly byDistance: boolean;
  /** Negative once overdue; days, or distance in the vehicle's unit. */
  readonly remaining: number;
  /** Share of the interval used, 0 upward (past 1 once overdue). */
  readonly progress: number;
}

/**
 * A schedule read as a gauge, from what the server computed: of time and distance, whichever is
 * further through its interval leads. `null` when neither interval has a baseline to measure from.
 */
export function dueGauge(plan: Gaugeable): DueGauge | null {
  if (plan.status === 'UNSCHEDULED') return null;
  const measure = (total: number, remaining: number) =>
    total > 0
      ? { progress: Math.max(0, (total - remaining) / total), remaining: Math.round(remaining) }
      : null;

  const time =
    plan.nextDueDate && plan.lastPerformedAt && plan.daysRemaining !== null
      ? measure(
          (Date.parse(plan.nextDueDate) - Date.parse(plan.lastPerformedAt)) / 86_400_000,
          plan.daysRemaining,
        )
      : null;
  const distance =
    plan.nextDueOdometer !== null &&
    plan.lastPerformedOdometer !== null &&
    plan.distanceRemaining !== null
      ? measure(plan.nextDueOdometer - plan.lastPerformedOdometer, plan.distanceRemaining)
      : null;

  const byDistance = distance !== null && (time === null || distance.progress >= time.progress);
  const lead = byDistance ? distance : time;
  return lead ? { byDistance, ...lead } : null;
}

/** A span of days as a person says it: days, then months past 60, then years past two. */
export function spanOfDays(days: number): string {
  const count = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
  if (days >= 730) return count(Math.round(days / 365), 'year');
  if (days >= 60) return count(Math.round(days / 30), 'month');
  return count(days, 'day');
}
