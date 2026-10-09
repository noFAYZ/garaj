import { formatRelative } from '@/lib/format';

/*
 * The console's figures, one way each. Counts stay exact while they fit a glance and go compact
 * past ten thousand; days are UTC days, because that is how the API buckets them.
 */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en');

/** 1,284 stays exact; 12,900 becomes 12.9K. */
export const formatCount = (value: number) =>
  Math.abs(value) < 10_000 ? whole.format(value) : compact.format(value);

/** Always every digit, grouped: for a tooltip or a table, where the exact figure is the point. */
export const formatExact = (value: number) => whole.format(value);

export const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/** A share as text: "<1%" rather than a "0%" that reads as none at all. */
export const share = (part: number, whole: number) => {
  if (whole <= 0 || part <= 0) return '0%';
  const value = (part / whole) * 100;
  return value < 1 ? '<1%' : `${Math.round(value)}%`;
};

const dayFormats = {
  short: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  long: new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }),
  month: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }),
};

/** `2026-10-04` as "4 Oct", "Sun 4 Oct" or "Oct". Noon, so no time zone can tip it a day. */
export const dayLabel = (day: string, style: keyof typeof dayFormats = 'short') =>
  dayFormats[style].format(new Date(`${day}T12:00:00Z`));

/** "3 minutes ago". A server clock a little ahead of this one reads as now, never "in 29 seconds". */
export const ago = (iso: string) =>
  Date.parse(iso) > Date.now() - 30_000 ? 'just now' : formatRelative(iso);

const short = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
/** "28 Sept 26": a date that fits a table column. */
export const shortDate = (iso: string) => short.format(new Date(iso));

const stamp = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
/** Everything about a moment, for a tooltip: "4 Oct 2026, 19:36:12". */
export const fullStamp = (iso: string) => stamp.format(new Date(iso));

const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
export const clockTime = (iso: string) => clock.format(new Date(iso));

export const bytes = (value: number | null) => {
  if (value === null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n.toFixed(n < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
};

/** A span of seconds at the precision it is read at: "4m", "3h", "12d". */
export const span = (seconds: number | null) => {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
};

export const secondsOf = (ms: number | null) =>
  ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

/** Up to two letters from a name, else the email's first. */
export const initials = (name: string | null | undefined, email?: string | null) =>
  (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || (email?.[0] ?? '?').toUpperCase();

/** A uuid short enough to scan in a column: its first eight characters. */
export const shortId = (id: string) => id.slice(0, 8);
