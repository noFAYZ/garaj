/**
 * The vehicle cockpit's warning lights: what it needs soonest.
 *
 * Pure, and built only from what the server already decided — each schedule's status and the
 * share of its interval used, each task's due date. Nothing here re-derives "overdue".
 */

import type { MaintenancePlan, PlannedItem } from '@vehicle-os/contracts';
import type { DistanceUnit } from '@vehicle-os/domain';
import { dueLabel, readDue, taskDays } from './due';

export type CockpitTone = 'ink' | 'warning' | 'destructive' | 'muted';

export interface CockpitLight {
  key: string;
  title: string;
  status: string;
  tone: CockpitTone;
  kind: 'schedule' | 'task';
  /** The id of its row on the activity tab. */
  anchor: string;
}

const STATUS_TONE: Record<MaintenancePlan['status'], CockpitTone> = {
  OVERDUE: 'destructive',
  DUE_SOON: 'warning',
  OK: 'ink',
  UNSCHEDULED: 'muted',
};

const RANK: Record<CockpitTone, number> = { destructive: 0, warning: 1, ink: 2, muted: 3 };

interface Ranked {
  light: CockpitLight;
  rank: number;
  closeness: number;
}

const TASK_TONE: Record<string, CockpitTone> = {
  'text-destructive': 'destructive',
  'text-warning': 'warning',
};

/**
 * Up to `limit` lights: everything late or close first, then whatever arrives soonest. Schedules
 * and tasks compete on one scale — a status band, then how close each is (the share of interval
 * left for a schedule, days for a task, both brought to about a year).
 */
export function cockpitLights(
  planned: readonly PlannedItem[],
  unit: DistanceUnit | null,
  limit = 3,
  now: Date = new Date(),
): CockpitLight[] {
  const lights = planned.flatMap((item): Ranked[] => {
    if (item.kind === 'SCHEDULE') {
      const plan = item.schedule;
      if (plan.isActive === false) return [];
      const due = readDue(plan, unit);
      const tone = STATUS_TONE[plan.status];
      return [
        {
          light: {
            key: `plan-${plan.id}`,
            title: plan.title,
            status: due.headline,
            tone,
            kind: 'schedule',
            anchor: `plan-${plan.id}`,
          },
          rank: RANK[tone],
          closeness: due.gauge ? 1 - due.gauge.progress : 1,
        },
      ];
    }
    const task = item.task;
    const label = dueLabel(task, now);
    const days = taskDays(task, now);
    const tone: CockpitTone = label ? (TASK_TONE[label.tone] ?? 'ink') : 'muted';
    return [
      {
        light: {
          key: `task-${task.id}`,
          title: task.title,
          status: label?.text ?? 'No due date',
          tone,
          kind: 'task',
          anchor: `task-${task.id}`,
        },
        rank: RANK[tone],
        closeness: days === null ? 1 : days / 365,
      },
    ];
  });

  return lights
    .sort((a, b) => a.rank - b.rank || a.closeness - b.closeness)
    .slice(0, limit)
    .map((entry) => entry.light);
}
