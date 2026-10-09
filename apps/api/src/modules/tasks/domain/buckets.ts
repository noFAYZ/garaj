/**
 * Task bucketing for the task centre (PRD §29).
 *
 * Pure, and computed server-side rather than in each client, because "today" depends on the
 * *user's* timezone: a task due 1 March is overdue in Auckland hours before it is in Los
 * Angeles. Two clients doing their own arithmetic disagree, and the one that is wrong is
 * whichever is not where the user actually is.
 */

export type BucketName = 'overdue' | 'today' | 'thisWeek' | 'upcoming' | 'someday';

export interface BucketableTask {
  /** `YYYY-MM-DD`, or null for work with no deadline. */
  readonly dueDate: string | null;
  readonly status: string;
}

/**
 * The calendar date "now" falls on in a given IANA timezone.
 *
 * `Intl.DateTimeFormat` with `en-CA` yields ISO order (`2026-03-01`) directly, which avoids
 * assembling the string from parts and getting the padding wrong. Doing this by adding a UTC
 * offset would break twice a year, when the offset changes but the arithmetic does not.
 */
export function localDateIn(timezone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    // An unknown timezone on a stored profile must not break the task list.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}

/** Days between two `YYYY-MM-DD` strings, positive when `to` is later. */
function daysBetweenDateStrings(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

const CLOSED_STATUSES = new Set(['COMPLETED', 'CANCELLED']);

export function isOpen(task: BucketableTask): boolean {
  return !CLOSED_STATUSES.has(task.status);
}

export function bucketFor(task: BucketableTask, today: string): BucketName {
  // Real work, no deadline. Kept out of the counts so it cannot look urgent — a wish list
  // inflating the overdue badge is how people stop trusting the badge.
  if (!task.dueDate) return 'someday';

  const days = daysBetweenDateStrings(today, task.dueDate);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  // "This week" is the next seven days, not the remainder of the calendar week: a task due
  // Monday should not jump from "upcoming" to "this week" purely because Sunday passed.
  if (days <= 7) return 'thisWeek';
  return 'upcoming';
}

export interface Buckets<T> {
  overdue: T[];
  today: T[];
  thisWeek: T[];
  upcoming: T[];
  someday: T[];
}

/**
 * Splits open tasks into buckets, preserving the order they arrive in — the caller sorts by
 * due date and priority in SQL, and re-sorting here would silently override that.
 */
export function bucketTasks<T extends BucketableTask>(
  tasks: readonly T[],
  today: string,
): Buckets<T> {
  const buckets: Buckets<T> = {
    overdue: [],
    today: [],
    thisWeek: [],
    upcoming: [],
    someday: [],
  };

  for (const task of tasks) {
    if (!isOpen(task)) continue;
    buckets[bucketFor(task, today)].push(task);
  }

  return buckets;
}
