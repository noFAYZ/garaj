import { describe, expect, it } from 'vitest';
import { addMonths, countdown, current, urgency, validity } from './papers';

const now = new Date('2026-10-15T09:30:00');
const paper = (expiresOn: string | null, issuedOn: string | null = null, createdAt = '2026-01-01T00:00:00Z') => ({
  expiresOn,
  issuedOn,
  createdAt,
});

describe('validity', () => {
  it('reads expired, soon, valid and open by the day', () => {
    expect(validity(paper('2026-10-12'), now)).toMatchObject({ state: 'expired', days: -3, left: 0 });
    expect(validity(paper('2026-10-15'), now)).toMatchObject({ state: 'soon', days: 0 });
    expect(validity(paper('2026-12-14'), now)).toMatchObject({ state: 'soon', days: 60 });
    expect(validity(paper('2026-12-15'), now)).toMatchObject({ state: 'valid', days: 61 });
    expect(validity(paper(null), now)).toEqual({ state: 'open', days: null, left: null });
  });

  it('measures what is left of the term from the issue date, or a year without one', () => {
    expect(validity(paper('2027-10-15', '2025-10-15'), now).left).toBeCloseTo(0.5, 2);
    expect(validity(paper('2027-04-15'), now).left).toBeCloseTo(0.5, 1);
  });
});

describe('countdown', () => {
  it('says days, then months, then years', () => {
    expect(countdown(1)).toEqual({ value: '1', unit: 'day' });
    expect(countdown(-12)).toEqual({ value: '12', unit: 'days' });
    expect(countdown(212)).toEqual({ value: '7', unit: 'months' });
    expect(countdown(800)).toEqual({ value: '2', unit: 'years' });
  });
});

describe('current', () => {
  it('stands the latest-running paper for its kind, then the newest filed', () => {
    const renewal = paper('2027-03-01', null, '2026-02-01T00:00:00Z');
    const lastYear = paper('2026-03-01', null, '2026-05-01T00:00:00Z');
    expect(current([lastYear, renewal])).toBe(renewal);
    const older = paper(null, null, '2025-01-01T00:00:00Z');
    const newer = paper(null, null, '2026-01-01T00:00:00Z');
    expect(current([older, newer])).toBe(newer);
    expect(current([])).toBeUndefined();
  });
});

describe('urgency', () => {
  it('puts the expired first and the missing last', () => {
    const order = [
      ['valid', 200],
      [null, null],
      ['expired', -3],
      ['open', null],
      ['soon', 12],
    ] as const;
    const sorted = [...order].sort((a, b) => urgency(a[0], a[1]) - urgency(b[0], b[1]));
    expect(sorted.map(([state]) => state)).toEqual(['expired', 'soon', 'valid', 'open', null]);
  });
});

describe('addMonths', () => {
  it('runs a term to the same day, kept inside a shorter month', () => {
    expect(addMonths('2026-10-15', 12)).toBe('2027-10-15');
    expect(addMonths('2026-10-15', 6)).toBe('2027-04-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });
});
