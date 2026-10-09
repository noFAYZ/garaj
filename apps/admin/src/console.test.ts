import { describe, expect, it } from 'vitest';
import { movingAverage, monotonePath, niceTicks } from './components/chart';
import { fingerprint, groupFailures } from './components/errors';
import { splitAction, subjectHref, verbOf } from './lib/audit';
import { href, parseHash } from './lib/route';

describe('chart scales', () => {
  it('puts the grid on round numbers, and never on a fraction of a count', () => {
    expect(niceTicks(0, 66)).toEqual([0, 20, 40, 60, 80]);
    expect(niceTicks(0, 3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0, 1)).toEqual([0, 1]);
    // A window of all zeros still has a scale to stand on.
    expect(niceTicks(0, 0)).toEqual([0, 1]);
    // A running total fits its window rather than starting at zero.
    expect(niceTicks(11.25, 40)).toEqual([10, 20, 30, 40]);
  });

  it('draws a curve that never overshoots the days it joins', () => {
    const points = [
      [0, 50],
      [10, 0],
      [20, 0],
      [30, 80],
      [40, 80],
    ] as const;
    const ys = [...monotonePath(points).matchAll(/C[^C]*/g)].flatMap((segment) =>
      [...segment[0].matchAll(/-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((match) =>
        Number(match[1]),
      ),
    );
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(80);
    }
  });

  it('averages the trailing week, with a shorter window at the start', () => {
    const average = movingAverage([7, 0, 0, 0, 0, 0, 0, 7]);
    expect(average[0]).toBe(7);
    expect(average[1]).toBe(3.5);
    expect(average[6]).toBe(1);
    expect(average[7]).toBe(1);
  });
});

describe('failures', () => {
  const quota = (key: string) =>
    `AI provider returned 429: { "message": "Quota exceeded for key ${key}, please check your plan" }`;

  it('treats the same failure with a different id or long value as one cause', () => {
    expect(fingerprint(quota('a'.repeat(30)))).toBe(fingerprint(quota('b'.repeat(30))));
    expect(fingerprint('No such vehicle 01a0a627-e614-791f-aa73-f0c9f8cec184')).toBe(
      fingerprint('No such vehicle 01a0a632-57b8-7f96-9f01-d4d5dcc1a215'),
    );
    // A status code is the news, not noise.
    expect(fingerprint('Email provider returned 403')).not.toBe(
      fingerprint('Email provider returned 503'),
    );
  });

  it('counts each cause and keeps its newest occurrence first', () => {
    const groups = groupFailures([
      {
        at: '2026-10-08T10:00:00Z',
        message: 'Email provider returned 403',
        who: 'new@example.test',
      },
      {
        at: '2026-10-07T10:00:00Z',
        message: 'Email provider returned 403',
        who: 'old@example.test',
      },
      { at: '2026-10-06T10:00:00Z', message: null },
    ]);
    expect(groups.map((group) => group.count)).toEqual([2, 1]);
    expect(groups[0]!.latest.who).toBe('new@example.test');
    expect(groups[1]!.message).toBe('No reason recorded');
  });
});

describe('audit actions', () => {
  it('colours a change by what happened', () => {
    expect(verbOf('admin.user.updated').kind).toBe('console');
    expect(verbOf('vehicle.archived').kind).toBe('remove');
    expect(verbOf('api_key.revoked').kind).toBe('remove');
    expect(verbOf('document.uploaded').kind).toBe('create');
    expect(verbOf('api_key.created').kind).toBe('create');
    expect(verbOf('garage.vehicle_drivers_assigned').kind).toBe('change');
  });

  it('splits an action into what it is about and what happened', () => {
    expect(splitAction('admin.garage.vehicle_drivers_assigned')).toEqual({
      scope: 'garage.',
      what: 'vehicle_drivers_assigned',
    });
    expect(splitAction('login')).toEqual({ scope: '', what: 'login' });
  });

  it('links to the subject, but not to one the entry deleted', () => {
    const base = { resourceId: 'r1', garageId: null };
    expect(subjectHref({ ...base, action: 'admin.user.updated', resourceType: 'user' })).toBe(
      '#/users/r1',
    );
    expect(subjectHref({ ...base, action: 'admin.user.deleted', resourceType: 'user' })).toBeNull();
    expect(
      subjectHref({
        action: 'vehicle.created',
        resourceType: 'vehicle',
        resourceId: 'v1',
        garageId: 'g1',
      }),
    ).toBe('#/garages/g1');
  });
});

describe('routes', () => {
  it('reads a section, a record and its filters from the hash', () => {
    const route = parseHash('#/users/abc?plan=PAID&q=bob');
    expect(route.section).toBe('users');
    expect(route.id).toBe('abc');
    expect(route.params.get('plan')).toBe('PAID');
    expect(parseHash('').section).toBe('overview');
    // Old names still land.
    expect(parseHash('#/audit').section).toBe('logs');
    expect(parseHash('#/management').section).toBe('users');
  });

  it('writes a link that leaves empty filters out', () => {
    expect(href('users', undefined, { q: '', plan: 'PAID', sort: undefined })).toBe(
      '#/users?plan=PAID',
    );
    expect(href('garages', 'g 1')).toBe('#/garages/g%201');
  });
});
