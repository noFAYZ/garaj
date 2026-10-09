/**
 * Document expiry (PRD §21, Architecture.md §28).
 *
 * Pure. An expiry date is a calendar date, not an instant: a registration that runs out on
 * 31 March runs out on 31 March wherever you are, so the comparison is between date strings
 * and never between timestamps — subtracting `Date`s here would make a document expire a day
 * early for anyone west of UTC.
 */

/** How far ahead a document counts as "expiring soon". Two months is time to renew one. */
export const EXPIRY_HORIZON_DAYS = 60;

const MS_PER_DAY = 86_400_000;

/** Whole days from `today` to `expiresOn`; negative once it has passed. */
export function daysUntil(expiresOn: string, today: string): number {
  const target = Date.parse(`${expiresOn}T00:00:00Z`);
  const from = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(from)) return 0;
  return Math.round((target - from) / MS_PER_DAY);
}

export function isExpiringSoon(
  expiresOn: string | null,
  today: string,
  horizonDays = EXPIRY_HORIZON_DAYS,
): boolean {
  if (!expiresOn) return false;
  // Already expired counts: something that ran out last week is more urgent than something
  // running out next month, not less.
  return daysUntil(expiresOn, today) <= horizonDays;
}

/*
 * "Today" in a given timezone is the task centre's problem too, and it is the same problem:
 * re-implementing it here would be a second answer to "what day is it for this user", and
 * the two would disagree at midnight.
 */
export { localDateIn } from '../../tasks/domain/buckets';
