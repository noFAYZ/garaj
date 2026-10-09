import type { PlannedItem } from '@vehicle-os/contracts';

/**
 * The order planned activity is shown in: what needs doing first, first.
 *
 * A schedule arrives with its status already computed. A task has only a due date, so its
 * urgency is derived to match: past the date is overdue, within the window is due soon, no
 * date at all sorts with the unscheduled. Within a band the nearer date leads and undated
 * items go last — so an overdue task and an overdue service sit together at the top rather
 * than in two lists.
 *
 * ponytail: "today" is the UTC date. For someone far from UTC a task due today can land a band
 * early or late around midnight; pass the profile's local date (as the task buckets do) if
 * that ever shows.
 */
const DUE_SOON_DAYS = 14;

const BAND = { OVERDUE: 0, DUE_SOON: 1, OK: 2, UNSCHEDULED: 3 } as const;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function bandOf(item: PlannedItem, today: string): number {
  if (item.kind === 'SCHEDULE') return BAND[item.schedule.status];

  const due = item.task.dueDate;
  if (!due) return BAND.UNSCHEDULED;
  if (due < today) return BAND.OVERDUE;
  return daysBetween(today, due) <= DUE_SOON_DAYS ? BAND.DUE_SOON : BAND.OK;
}

const dateOf = (item: PlannedItem): string | null =>
  item.kind === 'SCHEDULE' ? item.schedule.nextDueDate : item.task.dueDate;

export function orderPlanned(items: readonly PlannedItem[], today: string): PlannedItem[] {
  return items.toSorted((a, b) => {
    const band = bandOf(a, today) - bandOf(b, today);
    if (band !== 0) return band;

    const left = dateOf(a);
    const right = dateOf(b);
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left < right ? -1 : 1;
  });
}
