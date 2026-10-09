/**
 * The health engine (Architecture.md §33, §80).
 *
 * Pure, rule-based and explainable. It takes the vehicle's observable state and returns a
 * score with the reasons attached — §33 requires that a user can understand why the number
 * moved, which rules out anything whose output cannot be reproduced by hand.
 *
 * Health is derived and never stored (§33: "it should never become the primary source of
 * truth"). It changes as the calendar advances with nothing being written, so a cached score
 * would be wrong by the next morning.
 */

import type { DueStatus, HealthCategory, HealthFactor } from '@vehicle-os/contracts';

export interface HealthInput {
  /** Maintenance plans with their computed due status. */
  readonly plans: readonly { title: string; status: DueStatus }[];
  /** Open tasks with their due dates, as `YYYY-MM-DD`. */
  readonly tasks: readonly { title: string; dueDate: string | null; priority: string }[];
  /** Documents that carry an expiry date. */
  readonly documents: readonly { title: string; expiresOn: string }[];
  /**
   * The current condition standing per category — the most recent score for each, already
   * filtered to the ones fresh enough to say something about the vehicle today.
   */
  readonly condition: readonly { category: string; score: number; ageDays: number }[];
  /** Today, in the reader's timezone — an expiry is a calendar date. */
  readonly today: string;
}

export interface CategoryResult {
  readonly category: HealthCategory;
  readonly score: number | null;
  readonly basis: string;
}

export interface HealthResult {
  readonly overall: number | null;
  readonly categories: readonly CategoryResult[];
  readonly factors: readonly HealthFactor[];
  readonly summary: string;
}

/**
 * What each problem costs.
 *
 * Flat deductions rather than proportions of the category: one overdue service on a vehicle
 * with two plans is the same problem as one overdue service on a vehicle with twenty, and a
 * proportional model reports the well-documented vehicle as sicker for having more schedules.
 */
const PENALTIES = {
  overduePlan: 25,
  dueSoonPlan: 8,
  unscheduledPlan: 5,
  expiredDocument: 30,
  expiringDocument: 10,
  overdueTask: 12,
  urgentOverdueTask: 20,
} as const;

const MS_PER_DAY = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/** 100 minus the deductions, floored at zero — a score is not a debt. */
function scoreFrom(factors: readonly HealthFactor[], category: HealthCategory): number {
  const deducted = factors
    .filter((factor) => factor.category === category)
    .reduce((total, factor) => total + factor.penalty, 0);
  return Math.max(0, 100 - deducted);
}

export function computeHealth(input: HealthInput): HealthResult {
  const factors: HealthFactor[] = [];

  for (const plan of input.plans) {
    if (plan.status === 'OVERDUE') {
      factors.push({
        category: 'MAINTENANCE',
        label: plan.title,
        detail: 'Overdue.',
        penalty: PENALTIES.overduePlan,
      });
    } else if (plan.status === 'DUE_SOON') {
      factors.push({
        category: 'MAINTENANCE',
        label: plan.title,
        detail: 'Due soon.',
        penalty: PENALTIES.dueSoonPlan,
      });
    } else if (plan.status === 'UNSCHEDULED') {
      /*
       * A small deduction, not none. `UNSCHEDULED` means the interval cannot be measured —
       * usually no odometer reading — and a vehicle nobody is recording readings for is not
       * in known-good health, it is in unknown health.
       */
      factors.push({
        category: 'MAINTENANCE',
        label: plan.title,
        detail: 'Cannot be scheduled — no reading to count from.',
        penalty: PENALTIES.unscheduledPlan,
      });
    }
  }

  for (const document of input.documents) {
    const days = daysBetween(input.today, document.expiresOn);
    if (days < 0) {
      factors.push({
        category: 'DOCUMENTATION',
        label: document.title,
        detail: `Expired ${Math.abs(days)} days ago.`,
        penalty: PENALTIES.expiredDocument,
      });
    } else if (days <= 60) {
      factors.push({
        category: 'DOCUMENTATION',
        label: document.title,
        detail: `Expires in ${days} days.`,
        penalty: PENALTIES.expiringDocument,
      });
    }
  }

  /*
   * Condition enters as a single deduction, not one per category.
   *
   * The recorded scores average to the category's score, and expressing that as one penalty
   * of `100 − average` keeps the invariant every other category obeys: the score shown is
   * exactly 100 minus the deductions listed beside it. Per-category factors would sum to
   * more than the shortfall and make the arithmetic impossible to check by hand — which is
   * the one thing §33 asks of this.
   */
  const conditionScore =
    input.condition.length === 0
      ? null
      : Math.round(
          input.condition.reduce((total, row) => total + row.score, 0) / input.condition.length,
        );

  if (conditionScore !== null && conditionScore < 100) {
    const worst = [...input.condition].sort((a, b) => a.score - b.score)[0]!;
    factors.push({
      category: 'CONDITION',
      label: humaniseCategory(worst.category),
      detail:
        input.condition.length === 1
          ? `Assessed at ${worst.score} out of 100${worst.ageDays > 90 ? `, ${worst.ageDays} days ago` : ''}.`
          : `Lowest of ${input.condition.length} assessed categories, at ${worst.score} out of 100.`,
      penalty: 100 - conditionScore,
    });
  }

  for (const task of input.tasks) {
    if (!task.dueDate) continue;
    const days = daysBetween(input.today, task.dueDate);
    if (days >= 0) continue;
    const urgent = task.priority === 'URGENT' || task.priority === 'HIGH';
    factors.push({
      category: 'TASKS',
      label: task.title,
      detail: `Overdue by ${Math.abs(days)} days.`,
      penalty: urgent ? PENALTIES.urgentOverdueTask : PENALTIES.overdueTask,
    });
  }

  /*
   * A category with no inputs scores null, not 100. "Nothing is wrong" and "nothing has been
   * checked" are different answers, and only one of them is reassuring.
   */
  const categories: CategoryResult[] = [
    {
      category: 'MAINTENANCE',
      score: input.plans.length === 0 ? null : scoreFrom(factors, 'MAINTENANCE'),
      basis:
        input.plans.length === 0
          ? 'No maintenance schedules yet.'
          : `${input.plans.length} ${input.plans.length === 1 ? 'schedule' : 'schedules'}.`,
    },
    {
      category: 'TASKS',
      score: input.tasks.length === 0 ? null : scoreFrom(factors, 'TASKS'),
      basis:
        input.tasks.length === 0
          ? 'No open tasks.'
          : `${input.tasks.length} open ${input.tasks.length === 1 ? 'task' : 'tasks'}.`,
    },
    {
      category: 'CONDITION',
      score: conditionScore,
      basis:
        input.condition.length === 0
          ? 'Nothing assessed in the last year.'
          : `${input.condition.length} ${input.condition.length === 1 ? 'category' : 'categories'} assessed.`,
    },
    {
      category: 'DOCUMENTATION',
      score: input.documents.length === 0 ? null : scoreFrom(factors, 'DOCUMENTATION'),
      basis:
        input.documents.length === 0
          ? 'No documents with an expiry date.'
          : `${input.documents.length} ${input.documents.length === 1 ? 'document' : 'documents'} with an expiry.`,
    },
  ];

  const assessed = categories.filter(
    (category): category is CategoryResult & { score: number } => category.score !== null,
  );

  /*
   * The mean of the categories that were assessed, so a vehicle with no documents is not
   * scored as though its paperwork were missing. An unweighted mean: there is no evidence
   * for a weighting, and inventing one would make the number harder to explain, not better.
   */
  const overall =
    assessed.length === 0
      ? null
      : Math.round(assessed.reduce((total, row) => total + row.score, 0) / assessed.length);

  return { overall, categories, factors, summary: summarise(overall, factors) };
}

/** `FRONT_BRAKES` -> `Front brakes`. Shared with the client's own formatter by convention. */
function humaniseCategory(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function summarise(overall: number | null, factors: readonly HealthFactor[]): string {
  if (overall === null) return 'Not enough recorded yet to judge this vehicle.';

  const worst = [...factors].sort((a, b) => b.penalty - a.penalty)[0];
  if (!worst) return 'Everything on record is up to date.';

  const others = factors.length - 1;
  const tail = others === 0 ? '' : ` and ${others} other ${others === 1 ? 'item' : 'items'}`;
  // The single worst thing, named. A list of six deductions is a report; one sentence
  // naming the belt that is overdue is something the owner can act on.
  return `${worst.label}: ${worst.detail.replace(/\.$/, '')}${tail}.`;
}
