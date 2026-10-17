/*
 * A vehicle's papers, as the Docs tab reads them: which one of a kind is current, how much of its
 * term is left, and what the day count says in words — apart from the drawing so it can be checked
 * off the device.
 */

/** Past this, an expiry is a date, not a warning — the server's "expiring soon" line. */
export const SOON_DAYS = 60;
const DAY_MS = 86_400_000;
/** The term assumed when a paper has no issue date: most that run out are renewed yearly. */
const YEAR_DAYS = 365;

type Paper = {
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
  readonly createdAt: string;
};

export type PaperState = 'expired' | 'soon' | 'valid' | 'open';

const midnight = (day: string) => new Date(`${day}T00:00:00`).getTime();

/**
 * Where a paper stands today: run out, running out within `SOON_DAYS`, valid, or open — no expiry on
 * file. `days` is to the expiry, negative once past it; `left` is the share of its term still to
 * run, from the issue date when there is one.
 */
export function validity(paper: Paper, now = new Date()) {
  if (!paper.expiresOn) return { state: 'open' as PaperState, days: null, left: null };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = midnight(paper.expiresOn);
  const days = Math.round((end - today) / DAY_MS);
  // ponytail: a year's term when the start is unknown; an issue date makes it exact.
  const start = paper.issuedOn ? midnight(paper.issuedOn) : end - YEAR_DAYS * DAY_MS;
  const left = end > start ? Math.min(1, Math.max(0, (end - today) / (end - start))) : 0;
  const state: PaperState = days < 0 ? 'expired' : days <= SOON_DAYS ? 'soon' : 'valid';
  return { state, days, left };
}

/**
 * A day count as a countdown says it: days inside two months, months inside two years, years after
 * — the figure and its unit apart, so the figure can be the large one.
 */
export function countdown(days: number): { value: string; unit: string } {
  const span = Math.abs(days);
  const unit = (one: string, value: number) => (value === 1 ? one : `${one}s`);
  if (span >= 730) {
    const years = Math.round(span / 365);
    return { value: String(years), unit: unit('year', years) };
  }
  if (span >= SOON_DAYS) {
    const months = Math.round(span / 30);
    return { value: String(months), unit: unit('month', months) };
  }
  return { value: String(span), unit: unit('day', span) };
}

/**
 * The paper that stands for its kind: the one that runs latest — a renewal filed before last year's
 * certificate still counts — or, with no dates, the newest filed.
 */
export function current<T extends Paper>(papers: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const paper of papers) {
    if (!best) {
      best = paper;
      continue;
    }
    const a = paper.expiresOn ?? '';
    const b = best.expiresOn ?? '';
    if (a > b || (a === b && paper.createdAt > best.createdAt)) best = paper;
  }
  return best;
}

/** Most pressing first: run out, running out, valid by what is left, then undated, then missing. */
export function urgency(state: PaperState | null, days: number | null): number {
  if (state === null) return Number.MAX_SAFE_INTEGER;
  if (state === 'open') return Number.MAX_SAFE_INTEGER - 1;
  return days ?? 0;
}

/**
 * A day `months` after another, kept inside the month it lands in — a term from Jan 31 ends Feb 28,
 * not Mar 3, and a year from Feb 29 ends Feb 28.
 */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(year, month - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date, last));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}
