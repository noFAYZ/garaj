/**
 * Condition scoring (Architecture.md §32).
 *
 * Pure. Two questions, both about how a pile of per-category scores becomes one number that
 * can be shown next to a vehicle without lying about what was actually looked at.
 */

import type { ConditionCategory } from '@vehicle-os/contracts';

export interface ScoredItem {
  readonly category: ConditionCategory;
  readonly score: number | null;
  readonly notes?: string | null;
}

/**
 * The overall score of one assessment: the mean of the items that carry a score.
 *
 * Items scored `null` are excluded rather than counted as zero — "looked at it, could not
 * judge" is not the same as "it is ruined", and averaging the second in would make a careful
 * inspector's report worse than a careless one's.
 */
export function overallScore(items: readonly ScoredItem[]): number | null {
  const scored = items.filter(
    (item): item is ScoredItem & { score: number } => item.score !== null,
  );
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((total, item) => total + item.score, 0) / scored.length);
}

export interface DatedItem extends ScoredItem {
  readonly assessedAt: Date;
}

export interface CategoryStanding {
  readonly category: ConditionCategory;
  readonly score: number | null;
  readonly notes: string | null;
  readonly assessedAt: Date;
  readonly ageDays: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * The current standing per category: the most recent assessment of each.
 *
 * Not the latest assessment's items. A vehicle's tyres may have been checked last week and
 * its frame two years ago, and showing only the newest assessment would drop every category
 * it did not cover — reporting a partial inspection as though it were a full one.
 *
 * `items` may arrive in any order; the newest `assessedAt` per category wins.
 */
export function latestByCategory(items: readonly DatedItem[], now: Date): CategoryStanding[] {
  const newest = new Map<ConditionCategory, DatedItem>();

  for (const item of items) {
    const existing = newest.get(item.category);
    if (!existing || item.assessedAt > existing.assessedAt) newest.set(item.category, item);
  }

  return [...newest.values()]
    .map((item) => ({
      category: item.category,
      score: item.score,
      notes: item.notes ?? null,
      assessedAt: item.assessedAt,
      ageDays: Math.max(0, Math.floor((now.getTime() - item.assessedAt.getTime()) / MS_PER_DAY)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * How stale a condition score may be before it stops counting towards health.
 *
 * A year: a judgement about tyres from two years and 30,000 km ago is not evidence about the
 * tyres now, and letting it prop up a health score would be the system reassuring the owner
 * on the strength of something nobody has checked since.
 */
export const CONDITION_FRESHNESS_DAYS = 365;

/** The categories still fresh enough to say something about the vehicle today. */
export function freshStandings(
  standings: readonly CategoryStanding[],
  freshnessDays = CONDITION_FRESHNESS_DAYS,
): CategoryStanding[] {
  return standings.filter(
    (standing) => standing.score !== null && standing.ageDays <= freshnessDays,
  );
}
