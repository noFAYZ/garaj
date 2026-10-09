import { describe, expect, it } from 'vitest';
import { freshStandings, latestByCategory, overallScore } from './condition';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-08T12:00:00Z');

describe('overallScore', () => {
  it('averages the scored items', () => {
    expect(
      overallScore([
        { category: 'EXTERIOR', score: 80 },
        { category: 'INTERIOR', score: 90 },
      ]),
    ).toBe(85);
  });

  /*
   * "Looked at it, could not judge" is not "it is ruined". Counting a null as zero would
   * make a careful inspector's report score worse than a careless one's.
   */
  it('ignores an unscored item rather than counting it as zero', () => {
    expect(
      overallScore([
        { category: 'EXTERIOR', score: 80 },
        { category: 'FRAME', score: null },
      ]),
    ).toBe(80);
  });

  it('is null when nothing was scored at all', () => {
    expect(overallScore([{ category: 'EXTERIOR', score: null }])).toBeNull();
    expect(overallScore([])).toBeNull();
  });
});

describe('latestByCategory', () => {
  /*
   * The reason this is not simply "the newest assessment's items". Tyres checked last week
   * and a frame checked two years ago are both current knowledge about their own category;
   * showing only the newest assessment would drop the frame entirely.
   */
  it('takes the most recent score per category, across assessments', () => {
    const standings = latestByCategory(
      [
        { category: 'TIRES', score: 60, assessedAt: at('2024-01-01T00:00:00Z') },
        { category: 'TIRES', score: 85, assessedAt: at('2026-09-01T00:00:00Z') },
        { category: 'FRAME', score: 95, assessedAt: at('2024-06-01T00:00:00Z') },
      ],
      NOW,
    );

    expect(standings.find((row) => row.category === 'TIRES')?.score).toBe(85);
    expect(standings.find((row) => row.category === 'FRAME')?.score).toBe(95);
  });

  it('reports how old each category’s judgement is', () => {
    const standings = latestByCategory(
      [{ category: 'TIRES', score: 85, assessedAt: at('2026-08-29T12:00:00Z') }],
      NOW,
    );

    expect(standings[0]?.ageDays).toBe(10);
  });

  it('does not depend on the order the rows arrive in', () => {
    const rows = [
      { category: 'TIRES' as const, score: 60, assessedAt: at('2024-01-01T00:00:00Z') },
      { category: 'TIRES' as const, score: 85, assessedAt: at('2026-09-01T00:00:00Z') },
    ];

    expect(latestByCategory(rows, NOW)).toEqual(latestByCategory([...rows].reverse(), NOW));
  });

  it('keeps a category whose latest reading could not be judged', () => {
    const standings = latestByCategory(
      [{ category: 'ELECTRICAL', score: null, assessedAt: at('2026-09-01T00:00:00Z') }],
      NOW,
    );

    expect(standings).toHaveLength(1);
    expect(standings[0]?.score).toBeNull();
  });
});

describe('freshStandings', () => {
  /*
   * A judgement about tyres from two years and 30,000 km ago is not evidence about the tyres
   * now. Letting it prop up a health score would be the system reassuring the owner on the
   * strength of something nobody has checked since.
   */
  it('drops a category nobody has looked at within the window', () => {
    const standings = latestByCategory(
      [
        { category: 'TIRES', score: 85, assessedAt: at('2026-09-01T00:00:00Z') },
        { category: 'FRAME', score: 95, assessedAt: at('2024-06-01T00:00:00Z') },
      ],
      NOW,
    );

    const fresh = freshStandings(standings);
    expect(fresh.map((row) => row.category)).toEqual(['TIRES']);
  });

  it('drops a category that was looked at recently but could not be judged', () => {
    const standings = latestByCategory(
      [{ category: 'ELECTRICAL', score: null, assessedAt: at('2026-09-01T00:00:00Z') }],
      NOW,
    );

    expect(freshStandings(standings)).toEqual([]);
  });

  it('keeps one exactly on the boundary rather than dropping it a day early', () => {
    const standings = latestByCategory(
      [{ category: 'BODY', score: 70, assessedAt: at('2025-09-08T12:00:00Z') }],
      NOW,
    );

    expect(standings[0]?.ageDays).toBe(365);
    expect(freshStandings(standings)).toHaveLength(1);
  });
});
