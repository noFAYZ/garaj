/**
 * Due, in words and as a fraction — for schedules and for tasks.
 *
 * Pure: the server computed every status, remaining day and remaining distance (§23); this only
 * turns them into what a person reads. The schedule rows, the task rows and the vehicle cockpit
 * all read from here, so "Overdue by 580 km" is worded one way wherever it appears.
 */

import type { MaintenancePlan, Task } from '@vehicle-os/contracts';
import type { DistanceUnit } from '@vehicle-os/domain';
import { formatDate, formatDistance } from './format';

const DAY = 24 * 60 * 60 * 1000;

/**
 * One line saying what is actually due and when.
 *
 * `trigger` is the server's answer to "which interval arrives first", already normalised
 * across dates, distance and engine hours — picking the nearest one here would re-do that
 * comparison in a second place, and get it wrong on the units.
 */
export function describeDue(plan: MaintenancePlan, unit: DistanceUnit | null): string {
  if (plan.status === 'UNSCHEDULED') {
    return plan.intervalDistance && plan.nextDueOdometer === null
      ? 'Needs an odometer reading before it can be scheduled'
      : 'No baseline recorded yet';
  }

  const parts: string[] = [];
  if (plan.nextDueDate) {
    const days = plan.daysRemaining;
    parts.push(
      days === null
        ? formatDate(plan.nextDueDate)
        : days < 0
          ? `${Math.abs(days)} days ago (${formatDate(plan.nextDueDate)})`
          : `in ${days} days (${formatDate(plan.nextDueDate)})`,
    );
  }
  if (plan.nextDueOdometer !== null) {
    const remaining = plan.distanceRemaining;
    parts.push(
      remaining === null
        ? `at ${formatDistance(plan.nextDueOdometer, unit)}`
        : remaining < 0
          ? `${formatDistance(Math.abs(remaining), unit)} ago`
          : `in ${formatDistance(remaining, unit)}`,
    );
  }
  if (plan.nextDueEngineHours !== null) {
    const remaining = plan.engineHoursRemaining;
    parts.push(
      remaining === null || remaining >= 0
        ? `at ${plan.nextDueEngineHours} engine hours`
        : `${Math.abs(remaining)} engine hours ago`,
    );
  }

  return parts.length > 0 ? parts.join(' · ') : 'No interval set';
}

export interface GaugeReading {
  /** The measure that arrives first — the one the headline and the cells follow. */
  kind: 'distance' | 'time';
  /** Share of that interval used, 0 upward — past 1 is overdue. */
  progress: number;
  /** Cells: the interval's months for time, tenths for distance. */
  cells: number;
  /** Last done and next due, in every measure the schedule has: "Jun 26, 2025 · 120,000 km". */
  from: string;
  to: string;
}

export interface DueReading {
  headline: string;
  gauge: GaugeReading | null;
  /** The lead measure's distance or time, unsigned — "580 km", "4 months". Absent without a gauge. */
  amount?: string;
  /** Past due on the lead measure. */
  late?: boolean;
}

const count = (value: number, unit: string) => `${value} ${value === 1 ? unit : `${unit}s`}`;

/** Days as the unit a person would say: "12 days", "7 months", "2 years". */
function spanOfDays(days: number): string {
  if (days >= 730) return count(Math.round(days / 365), 'year');
  if (days >= 60) return count(Math.round(days / 30), 'month');
  return count(days, 'day');
}

/**
 * The headline and the meter, from what the server already computed.
 *
 * `daysRemaining` and `distanceRemaining` are the server's (§23); this only turns them into words and
 * a fraction of the interval. The measure that is further along leads, because it is the one that
 * arrives first.
 */
export function readDue(plan: MaintenancePlan, unit: DistanceUnit | null): DueReading {
  if (plan.status === 'UNSCHEDULED') {
    return { headline: describeDue(plan, unit), gauge: null };
  }

  const time =
    plan.nextDueDate && plan.lastPerformedAt && plan.daysRemaining !== null
      ? measure(
          (Date.parse(plan.nextDueDate) - Date.parse(plan.lastPerformedAt)) / DAY,
          plan.daysRemaining,
        )
      : null;
  const distance =
    plan.nextDueOdometer !== null &&
    plan.lastPerformedOdometer !== null &&
    plan.distanceRemaining !== null
      ? measure(plan.nextDueOdometer - plan.lastPerformedOdometer, plan.distanceRemaining)
      : null;

  const leadIsDistance = distance !== null && (time === null || distance.progress >= time.progress);
  const lead = leadIsDistance ? distance : time;

  if (!lead) return { headline: describeDue(plan, unit), gauge: null };

  const remaining = lead.remaining;
  const amount = leadIsDistance
    ? formatDistance(Math.abs(remaining), unit)
    : spanOfDays(Math.abs(remaining));
  const headline =
    remaining < 0
      ? `Overdue by ${amount}`
      : remaining === 0
        ? leadIsDistance
          ? 'Due now'
          : 'Due today'
        : `Due in ${amount}`;

  const hasTime = plan.lastPerformedAt && plan.nextDueDate;
  const hasDistance = plan.lastPerformedOdometer !== null && plan.nextDueOdometer !== null;
  const ends = (date: string | null, odometer: number | null) =>
    [
      hasTime && date ? formatDate(date) : null,
      hasDistance && odometer !== null ? formatDistance(odometer, unit) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return {
    headline,
    amount,
    late: remaining < 0,
    gauge: {
      kind: leadIsDistance ? 'distance' : 'time',
      progress: lead.progress,
      // A month a cell reads as a calendar; past two years that is noise, so it tops out.
      cells: leadIsDistance ? 10 : Math.min(24, Math.max(4, plan.intervalMonths ?? 12)),
      from: ends(plan.lastPerformedAt, plan.lastPerformedOdometer),
      to: ends(plan.nextDueDate, plan.nextDueOdometer),
    },
  };
}

function measure(total: number, remaining: number): { progress: number; remaining: number } | null {
  if (total <= 0) return null;
  return { progress: Math.max(0, (total - remaining) / total), remaining: Math.round(remaining) };
}

/** Whole days from today to an open task's due date, in local time; `null` when it has none. */
export function taskDays(task: Task, now: Date = new Date()): number | null {
  if (!task.dueDate || task.status === 'COMPLETED' || task.status === 'CANCELLED') return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((new Date(`${task.dueDate}T00:00:00`).getTime() - today) / DAY);
}

export function dueLabel(
  task: Task,
  now: Date = new Date(),
): { text: string; tone: string } | null {
  const days = taskDays(task, now);
  if (days === null || !task.dueDate) return null;

  if (days < 0) {
    const late = Math.abs(days);
    return { text: `${late} ${late === 1 ? 'day' : 'days'} late`, tone: 'text-destructive' };
  }
  if (days === 0) return { text: 'Due today', tone: 'text-warning' };
  if (days <= 7)
    return { text: `Due in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'text-warning' };
  if (days <= 30) return { text: `Due in ${days} days`, tone: 'text-foreground' };
  return { text: `Due ${formatDate(task.dueDate)}`, tone: 'text-foreground' };
}
