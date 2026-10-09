import { describe, expect, it } from 'vitest';
import { baselineAfterCompletion, computeNextDue, type MaintenanceInterval } from './next-due';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-06-01T12:00:00Z');

function plan(overrides: Partial<MaintenanceInterval> = {}): MaintenanceInterval {
  return {
    intervalDistance: null,
    intervalDistanceUnit: null,
    intervalMonths: null,
    intervalEngineHours: null,
    lastPerformedAt: at('2026-01-01T00:00:00Z'),
    lastPerformedOdometer: 30_000,
    lastPerformedEngineHours: null,
    ...overrides,
  };
}

const usage = (currentOdometer: number | null, currentEngineHours: number | null = null) => ({
  currentOdometer,
  odometerUnit: 'KM' as const,
  currentEngineHours,
});

describe('no intervals configured', () => {
  it('reports UNSCHEDULED rather than pretending to be fine', () => {
    const result = computeNextDue(plan(), usage(35_000), NOW);

    expect(result.status).toBe('UNSCHEDULED');
    expect(result.trigger).toBeNull();
  });

  it('ignores a zero or negative interval, which is not a schedule', () => {
    expect(computeNextDue(plan({ intervalMonths: 0 }), usage(35_000), NOW).status).toBe(
      'UNSCHEDULED',
    );
    expect(computeNextDue(plan({ intervalDistance: 0 }), usage(35_000), NOW).status).toBe(
      'UNSCHEDULED',
    );
  });
});

describe('time interval only', () => {
  it('computes the due date from the last completion', () => {
    const result = computeNextDue(plan({ intervalMonths: 12 }), usage(35_000), NOW);

    expect(result.nextDueDate).toBe('2027-01-01');
    expect(result.trigger).toBe('DATE');
    expect(result.status).toBe('OK');
  });

  /*
   * The `addMonths` clamp matters here: 31 Aug + 6 months must be 28 Feb, not 3 March.
   * Native date arithmetic overflows, which drifts a schedule forward every cycle.
   */
  it('clamps to the last valid day when the target month is shorter', () => {
    const result = computeNextDue(
      plan({ intervalMonths: 6, lastPerformedAt: at('2026-08-31T00:00:00Z') }),
      usage(35_000),
      NOW,
    );

    expect(result.nextDueDate).toBe('2027-02-28');
  });

  it('flags DUE_SOON inside the two-week window', () => {
    const result = computeNextDue(
      plan({ intervalMonths: 6, lastPerformedAt: at('2025-12-10T00:00:00Z') }),
      usage(35_000),
      NOW,
    );

    expect(result.nextDueDate).toBe('2026-06-10');
    expect(result.daysRemaining).toBe(9);
    expect(result.status).toBe('DUE_SOON');
  });

  it('flags OVERDUE past the due date, with a negative days remaining', () => {
    const result = computeNextDue(
      plan({ intervalMonths: 3, lastPerformedAt: at('2026-01-01T00:00:00Z') }),
      usage(35_000),
      NOW,
    );

    expect(result.status).toBe('OVERDUE');
    expect(result.daysRemaining).toBeLessThan(0);
  });
});

describe('distance interval only', () => {
  it('computes the due odometer from the last completion', () => {
    const result = computeNextDue(
      plan({ intervalDistance: 10_000, intervalDistanceUnit: 'KM' }),
      usage(35_000),
      NOW,
    );

    expect(result.nextDueOdometer).toBe(40_000);
    expect(result.distanceRemaining).toBe(5_000);
    expect(result.status).toBe('OK');
    expect(result.trigger).toBe('DISTANCE');
  });

  /*
   * Absolute, not proportional. 500 km is about a fortnight of driving whichever service it
   * precedes, and a proportional window would stay silent 500 km from a timing belt — the
   * one you least want to be surprised by.
   */
  it('warns at the same distance regardless of how long the interval is', () => {
    const oilChange = computeNextDue(
      plan({ intervalDistance: 10_000, intervalDistanceUnit: 'KM' }),
      usage(39_500),
      NOW,
    );
    const timingBelt = computeNextDue(
      plan({ intervalDistance: 60_000, intervalDistanceUnit: 'KM' }),
      usage(89_500),
      NOW,
    );

    expect(oilChange.distanceRemaining).toBe(500);
    expect(timingBelt.distanceRemaining).toBe(500);
    expect(oilChange.status).toBe('DUE_SOON');
    expect(timingBelt.status).toBe('DUE_SOON');
  });

  /* But a short interval must not warn from the moment it resets. */
  it('caps the window at a quarter of a short interval', () => {
    const chainLube = plan({ intervalDistance: 1_000, intervalDistanceUnit: 'KM' });

    // 300 km left of 1,000 is more than the 250 km cap.
    expect(computeNextDue(chainLube, usage(30_700), NOW).status).toBe('OK');
    expect(computeNextDue(chainLube, usage(30_800), NOW).status).toBe('DUE_SOON');
  });

  it('flags OVERDUE past the due odometer', () => {
    const result = computeNextDue(
      plan({ intervalDistance: 10_000, intervalDistanceUnit: 'KM' }),
      usage(41_200),
      NOW,
    );

    expect(result.status).toBe('OVERDUE');
    expect(result.distanceRemaining).toBe(-1_200);
  });

  /*
   * A service interval quoted in miles on a vehicle whose odometer reads kilometres. The
   * answer must come back in the vehicle's unit or every comparison downstream is wrong by
   * a factor of 1.6.
   */
  it('converts an interval given in a different unit from the odometer', () => {
    const result = computeNextDue(
      plan({ intervalDistance: 5_000, intervalDistanceUnit: 'MI', lastPerformedOdometer: 30_000 }),
      usage(35_000),
      NOW,
    );

    // 5,000 mi is 8,046.72 km.
    expect(result.nextDueOdometer).toBe(38_047);
    expect(result.status).toBe('OK');
  });
});

describe('engine hours', () => {
  it('computes the due hours for a boat serviced every 100 hours', () => {
    const result = computeNextDue(
      plan({ intervalEngineHours: 100, lastPerformedEngineHours: 250 }),
      usage(null, 300),
      NOW,
    );

    expect(result.nextDueEngineHours).toBe(350);
    expect(result.engineHoursRemaining).toBe(50);
    expect(result.trigger).toBe('ENGINE_HOURS');
    expect(result.status).toBe('OK');
  });

  it('flags OVERDUE past the due hours', () => {
    const result = computeNextDue(
      plan({ intervalEngineHours: 100, lastPerformedEngineHours: 250 }),
      usage(null, 370),
      NOW,
    );

    expect(result.status).toBe('OVERDUE');
  });
});

describe('compound intervals — whichever comes first', () => {
  const compound = plan({
    intervalDistance: 10_000,
    intervalDistanceUnit: 'KM',
    intervalMonths: 12,
    lastPerformedAt: at('2026-01-01T00:00:00Z'),
    lastPerformedOdometer: 30_000,
  });

  it('reports both due points regardless of which one wins', () => {
    const result = computeNextDue(compound, usage(35_000), NOW);

    expect(result.nextDueDate).toBe('2027-01-01');
    expect(result.nextDueOdometer).toBe(40_000);
    expect(result.status).toBe('OK');
  });

  /* Heavy use: the distance runs out long before the year does. */
  it('picks DISTANCE when the odometer arrives first', () => {
    const result = computeNextDue(compound, usage(41_000), NOW);

    expect(result.status).toBe('OVERDUE');
    expect(result.trigger).toBe('DISTANCE');
  });

  /* Light use: the vehicle barely moved, but the calendar still came round. */
  it('picks DATE when the year arrives first', () => {
    const result = computeNextDue(
      { ...compound, lastPerformedAt: at('2025-01-01T00:00:00Z') },
      usage(31_000),
      NOW,
    );

    expect(result.status).toBe('OVERDUE');
    expect(result.trigger).toBe('DATE');
  });

  it('takes the worse of the two when they disagree', () => {
    // Distance says OK (5,000 km to go); the date passed two months ago.
    const result = computeNextDue(
      { ...compound, lastPerformedAt: at('2025-03-01T00:00:00Z') },
      usage(35_000),
      NOW,
    );

    expect(result.status).toBe('OVERDUE');
    expect(result.trigger).toBe('DATE');
  });

  it('reports the more urgent trigger when both are overdue', () => {
    // Overdue by 5 months and by 6,000 km — 6,000 km past a 10,000 km interval is further
    // through its window than 5 months past a 12-month one.
    const result = computeNextDue(
      { ...compound, lastPerformedAt: at('2025-01-01T00:00:00Z') },
      usage(46_000),
      NOW,
    );

    expect(result.status).toBe('OVERDUE');
    expect(result.trigger).toBe('DISTANCE');
  });

  it('handles all three intervals at once', () => {
    const result = computeNextDue(
      {
        ...compound,
        intervalEngineHours: 100,
        lastPerformedEngineHours: 250,
      },
      usage(35_000, 360),
      NOW,
    );

    expect(result.status).toBe('OVERDUE');
    expect(result.trigger).toBe('ENGINE_HOURS');
  });
});

describe('missing readings', () => {
  /*
   * A distance-based plan on a vehicle whose odometer was never recorded cannot be judged.
   * Reporting OK would tell the user everything is fine when nothing has been checked.
   */
  it('reports UNSCHEDULED when there is no reading to measure against', () => {
    const result = computeNextDue(
      plan({ intervalDistance: 10_000, intervalDistanceUnit: 'KM' }),
      usage(null),
      NOW,
    );

    expect(result.status).toBe('UNSCHEDULED');
    expect(result.nextDueOdometer).toBe(40_000);
  });

  it('still uses the dimensions it can measure when one is missing', () => {
    const result = computeNextDue(
      plan({
        intervalDistance: 10_000,
        intervalDistanceUnit: 'KM',
        intervalMonths: 3,
        lastPerformedAt: at('2026-01-01T00:00:00Z'),
      }),
      usage(null),
      NOW,
    );

    // No odometer, but the date interval alone is enough to know it is overdue.
    expect(result.status).toBe('OVERDUE');
    expect(result.trigger).toBe('DATE');
  });

  it('reports UNSCHEDULED when the plan has no baseline at all', () => {
    const result = computeNextDue(
      plan({ intervalMonths: 12, lastPerformedAt: null, lastPerformedOdometer: null }),
      usage(35_000),
      NOW,
    );

    expect(result.status).toBe('UNSCHEDULED');
  });
});

describe('baselineAfterCompletion', () => {
  /*
   * The reading at completion, not the reading now. Logging a service performed last month
   * at 38,000 km must schedule the next one from there — using today's 42,000 km would push
   * it 4,000 km late.
   */
  it('resets the clock to the moment of the service, not to now', () => {
    const baseline = baselineAfterCompletion({
      performedAt: at('2026-05-01T00:00:00Z'),
      odometer: 38_000,
      odometerUnit: 'KM',
      engineHours: null,
      vehicleOdometerUnit: 'KM',
    });

    expect(baseline.lastPerformedAt).toEqual(at('2026-05-01T00:00:00Z'));
    expect(baseline.lastPerformedOdometer).toBe(38_000);
  });

  it('normalises a reading taken in a different unit from the vehicle', () => {
    const baseline = baselineAfterCompletion({
      performedAt: at('2026-05-01T00:00:00Z'),
      odometer: 20_000,
      odometerUnit: 'MI',
      engineHours: null,
      vehicleOdometerUnit: 'KM',
    });

    expect(baseline.lastPerformedOdometer).toBe(32_187);
  });

  it('carries engine hours through for a boat', () => {
    const baseline = baselineAfterCompletion({
      performedAt: at('2026-05-01T00:00:00Z'),
      odometer: null,
      odometerUnit: null,
      engineHours: 350,
      vehicleOdometerUnit: 'KM',
    });

    expect(baseline.lastPerformedEngineHours).toBe(350);
    expect(baseline.lastPerformedOdometer).toBeNull();
  });
});

describe('a full service cycle', () => {
  it('moves OK -> DUE_SOON -> OVERDUE, then back to OK after completion', () => {
    const oilChange = plan({
      intervalDistance: 10_000,
      intervalDistanceUnit: 'KM',
      intervalMonths: 12,
      lastPerformedAt: at('2026-01-01T00:00:00Z'),
      lastPerformedOdometer: 30_000,
    });

    expect(computeNextDue(oilChange, usage(33_000), NOW).status).toBe('OK');
    expect(computeNextDue(oilChange, usage(39_500), NOW).status).toBe('DUE_SOON');
    expect(computeNextDue(oilChange, usage(40_500), NOW).status).toBe('OVERDUE');

    const after = {
      ...oilChange,
      ...baselineAfterCompletion({
        performedAt: NOW,
        odometer: 40_500,
        odometerUnit: 'KM',
        engineHours: null,
        vehicleOdometerUnit: 'KM',
      }),
    };

    const refreshed = computeNextDue(after, usage(40_500), NOW);
    expect(refreshed.status).toBe('OK');
    expect(refreshed.nextDueOdometer).toBe(50_500);
    expect(refreshed.nextDueDate).toBe('2027-06-01');
  });
});
