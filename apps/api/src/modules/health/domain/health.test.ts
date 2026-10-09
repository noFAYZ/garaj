import { describe, expect, it } from 'vitest';
import { computeHealth, type HealthInput } from './health';

const TODAY = '2026-09-08';

const input = (overrides: Partial<HealthInput> = {}): HealthInput => ({
  plans: [],
  tasks: [],
  documents: [],
  condition: [],
  today: TODAY,
  ...overrides,
});

const scoreOf = (result: ReturnType<typeof computeHealth>, category: string) =>
  result.categories.find((row) => row.category === category)?.score;

describe('computeHealth', () => {
  /*
   * The distinction the whole design turns on. A brand new vehicle has nothing wrong with it
   * and nothing checked; reporting 100 would be reassurance the system has not earned.
   */
  it('reports no score at all for a vehicle with nothing recorded', () => {
    const result = computeHealth(input());

    expect(result.overall).toBeNull();
    expect(result.summary).toBe('Not enough recorded yet to judge this vehicle.');
    expect(result.categories.every((row) => row.score === null)).toBe(true);
  });

  it('is 100 when everything on record is in order', () => {
    const result = computeHealth(
      input({
        plans: [{ title: 'Oil change', status: 'OK' }],
        documents: [{ title: 'Insurance', expiresOn: '2027-06-01' }],
      }),
    );

    expect(result.overall).toBe(100);
    expect(result.factors).toEqual([]);
    expect(result.summary).toBe('Everything on record is up to date.');
  });

  it('deducts for an overdue plan and says so in a factor', () => {
    const result = computeHealth(input({ plans: [{ title: 'Timing belt', status: 'OVERDUE' }] }));

    expect(scoreOf(result, 'MAINTENANCE')).toBe(75);
    expect(result.factors).toEqual([
      { category: 'MAINTENANCE', label: 'Timing belt', detail: 'Overdue.', penalty: 25 },
    ]);
  });

  /*
   * "Nothing is wrong" and "nothing has been checked" must not produce the same number, so a
   * category with no inputs is excluded from the mean rather than scored 100.
   */
  it('averages only the categories it could assess', () => {
    const result = computeHealth(input({ plans: [{ title: 'Oil change', status: 'DUE_SOON' }] }));

    // Maintenance is 92; tasks and documentation have nothing to judge.
    expect(scoreOf(result, 'MAINTENANCE')).toBe(92);
    expect(scoreOf(result, 'TASKS')).toBeNull();
    expect(scoreOf(result, 'DOCUMENTATION')).toBeNull();
    expect(result.overall).toBe(92);
  });

  it('mixes the assessed categories into one mean', () => {
    const result = computeHealth(
      input({
        plans: [{ title: 'Belt', status: 'OVERDUE' }],
        documents: [{ title: 'Rego', expiresOn: '2026-08-01' }],
      }),
    );

    // Maintenance 75, documentation 70 — the mean of the two, tasks excluded.
    expect(result.overall).toBe(73);
  });

  /*
   * A plan that cannot be measured is not a healthy plan. `UNSCHEDULED` means there is no
   * reading to count from, which is unknown health rather than good health.
   */
  it('deducts a little for a plan that cannot be scheduled at all', () => {
    const result = computeHealth(
      input({ plans: [{ title: 'Chain lube', status: 'UNSCHEDULED' }] }),
    );

    expect(scoreOf(result, 'MAINTENANCE')).toBe(95);
    expect(result.factors[0]?.detail).toContain('no reading');
  });

  it('hits documentation harder for an expired document than an expiring one', () => {
    const expired = computeHealth(
      input({ documents: [{ title: 'Insurance', expiresOn: '2026-08-08' }] }),
    );
    const expiring = computeHealth(
      input({ documents: [{ title: 'Insurance', expiresOn: '2026-10-08' }] }),
    );

    expect(scoreOf(expired, 'DOCUMENTATION')).toBe(70);
    expect(scoreOf(expiring, 'DOCUMENTATION')).toBe(90);
    expect(expired.factors[0]?.detail).toBe('Expired 31 days ago.');
  });

  it('ignores a document whose expiry is still far off', () => {
    const result = computeHealth(
      input({ documents: [{ title: 'Warranty', expiresOn: '2028-01-01' }] }),
    );

    expect(scoreOf(result, 'DOCUMENTATION')).toBe(100);
    expect(result.factors).toEqual([]);
  });

  it('costs more for an overdue urgent task than an overdue ordinary one', () => {
    const urgent = computeHealth(
      input({ tasks: [{ title: 'Fix brakes', dueDate: '2026-09-01', priority: 'URGENT' }] }),
    );
    const ordinary = computeHealth(
      input({ tasks: [{ title: 'Wash it', dueDate: '2026-09-01', priority: 'LOW' }] }),
    );

    expect(scoreOf(urgent, 'TASKS')).toBe(80);
    expect(scoreOf(ordinary, 'TASKS')).toBe(88);
  });

  it('does not deduct for a task that is not yet due, or has no date', () => {
    const result = computeHealth(
      input({
        tasks: [
          { title: 'Later', dueDate: '2026-12-01', priority: 'HIGH' },
          { title: 'Someday', dueDate: null, priority: 'HIGH' },
        ],
      }),
    );

    expect(scoreOf(result, 'TASKS')).toBe(100);
  });

  /** A score is not a debt: enough problems floor at zero rather than going negative. */
  it('floors a category at zero', () => {
    const result = computeHealth(
      input({
        plans: [
          { title: 'A', status: 'OVERDUE' },
          { title: 'B', status: 'OVERDUE' },
          { title: 'C', status: 'OVERDUE' },
          { title: 'D', status: 'OVERDUE' },
          { title: 'E', status: 'OVERDUE' },
        ],
      }),
    );

    expect(scoreOf(result, 'MAINTENANCE')).toBe(0);
  });

  /*
   * Flat deductions, not proportional ones. Recording more schedules must not make the same
   * single overdue item look less serious — nor the vehicle look sicker for being documented.
   */
  it('scores one overdue item the same whether the vehicle has two plans or twenty', () => {
    const few = computeHealth(
      input({
        plans: [
          { title: 'Belt', status: 'OVERDUE' },
          { title: 'Oil', status: 'OK' },
        ],
      }),
    );
    const many = computeHealth(
      input({
        plans: [
          { title: 'Belt', status: 'OVERDUE' },
          ...Array.from({ length: 19 }, (_, i) => ({ title: `Plan ${i}`, status: 'OK' as const })),
        ],
      }),
    );

    expect(scoreOf(few, 'MAINTENANCE')).toBe(scoreOf(many, 'MAINTENANCE'));
  });

  it('names the worst problem in the summary and counts the rest', () => {
    const result = computeHealth(
      input({
        plans: [{ title: 'Timing belt', status: 'OVERDUE' }],
        documents: [{ title: 'Insurance', expiresOn: '2026-09-20' }],
      }),
    );

    // The overdue belt outweighs the expiring certificate, so it is the one named.
    expect(result.summary).toBe('Timing belt: Overdue and 1 other item.');
  });

  describe('condition', () => {
    it('scores the category as the mean of what was assessed', () => {
      const result = computeHealth(
        input({
          condition: [
            { category: 'EXTERIOR', score: 80, ageDays: 10 },
            { category: 'TIRES', score: 60, ageDays: 10 },
          ],
        }),
      );

      expect(scoreOf(result, 'CONDITION')).toBe(70);
    });

    /*
     * The invariant every category obeys: the score shown is exactly 100 minus the
     * deductions listed beside it. One factor per assessed category would sum past the
     * shortfall and make the arithmetic uncheckable.
     */
    it('deducts once, so the factors still add up to the score', () => {
      const result = computeHealth(
        input({
          condition: [
            { category: 'EXTERIOR', score: 80, ageDays: 10 },
            { category: 'TIRES', score: 60, ageDays: 10 },
            { category: 'INTERIOR', score: 70, ageDays: 10 },
          ],
        }),
      );

      const deducted = result.factors
        .filter((factor) => factor.category === 'CONDITION')
        .reduce((total, factor) => total + factor.penalty, 0);

      expect(result.factors.filter((factor) => factor.category === 'CONDITION')).toHaveLength(1);
      expect(scoreOf(result, 'CONDITION')).toBe(100 - deducted);
    });

    it('names the worst category in the factor', () => {
      const result = computeHealth(
        input({
          condition: [
            { category: 'EXTERIOR', score: 90, ageDays: 5 },
            { category: 'TIRES', score: 40, ageDays: 5 },
          ],
        }),
      );

      expect(result.factors[0]?.label).toBe('Tires');
    });

    it('deducts nothing when everything assessed is perfect', () => {
      const result = computeHealth(
        input({ condition: [{ category: 'EXTERIOR', score: 100, ageDays: 5 }] }),
      );

      expect(scoreOf(result, 'CONDITION')).toBe(100);
      expect(result.factors).toEqual([]);
    });

    it('is not assessed at all when nothing fresh was recorded', () => {
      const result = computeHealth(input({ plans: [{ title: 'Oil', status: 'OK' }] }));
      expect(scoreOf(result, 'CONDITION')).toBeNull();
    });
  });
});
