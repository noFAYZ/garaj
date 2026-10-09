import { describe, expect, it } from 'vitest';
import type { MaintenancePlan, PlannedItem, Task } from '@vehicle-os/contracts';
import { cockpitLights } from './cockpit';

const NOW = new Date('2026-09-23T12:00:00');

const plan = (over: Partial<MaintenancePlan>): MaintenancePlan =>
  ({
    id: 'p',
    vehicleId: 'v',
    title: 'Plan',
    description: null,
    priority: 'MEDIUM',
    intervalDistance: null,
    intervalDistanceUnit: 'KM',
    intervalMonths: null,
    intervalEngineHours: null,
    lastPerformedAt: null,
    lastPerformedOdometer: null,
    lastPerformedEngineHours: null,
    nextDueDate: null,
    nextDueOdometer: null,
    nextDueEngineHours: null,
    status: 'OK',
    trigger: null,
    daysRemaining: null,
    distanceRemaining: null,
    engineHoursRemaining: null,
    isActive: true,
    ...over,
  }) as MaintenancePlan;

// The demo M3, as its API reported it.
const tyres = plan({
  id: 'tyres',
  title: 'Tyre rotation',
  status: 'OVERDUE',
  intervalDistance: 10000,
  lastPerformedOdometer: 25900,
  nextDueOdometer: 35900,
  distanceRemaining: -580,
});
const oil = plan({
  id: 'oil',
  title: 'Engine oil & filter',
  intervalDistance: 15000,
  intervalMonths: 12,
  lastPerformedAt: '2025-10-28T00:00:00Z',
  nextDueDate: '2026-10-28',
  daysRemaining: 35,
  lastPerformedOdometer: 22900,
  nextDueOdometer: 37900,
  distanceRemaining: 1420,
});
const brake = plan({
  id: 'brake',
  title: 'Brake fluid',
  intervalMonths: 24,
  lastPerformedAt: '2025-01-21T00:00:00Z',
  nextDueDate: '2027-01-21',
  daysRemaining: 120,
});
const inspection = {
  id: 'tuv',
  title: 'Book TÜV inspection',
  dueDate: '2026-10-02',
  status: 'TODO',
} as Task;

const planned = [
  { kind: 'SCHEDULE', schedule: oil },
  { kind: 'SCHEDULE', schedule: brake },
  { kind: 'TASK', task: inspection },
  { kind: 'SCHEDULE', schedule: tyres },
] as PlannedItem[];

describe('cockpit', () => {
  it('orders lights by urgency, then by what arrives first, and stops at three', () => {
    const lights = cockpitLights(planned, 'KM', 3, NOW);
    expect(lights.map((light) => light.key)).toEqual(['plan-tyres', 'task-tuv', 'plan-oil']);
    expect(lights[0]).toMatchObject({
      tone: 'destructive',
      status: 'Overdue by 580 km',
      anchor: 'plan-tyres',
    });
    expect(lights[1]).toMatchObject({ kind: 'task', status: 'Due in 9 days', tone: 'ink' });
  });

  it('turns a late task red and a close one amber', () => {
    const late = { ...inspection, id: 'late', dueDate: '2026-09-20' } as Task;
    const soon = { ...inspection, id: 'soon', dueDate: '2026-09-25' } as Task;
    const lights = cockpitLights(
      [
        { kind: 'TASK', task: soon },
        { kind: 'TASK', task: late },
      ] as PlannedItem[],
      'KM',
      3,
      NOW,
    );
    expect(lights.map((light) => [light.key, light.tone, light.status])).toEqual([
      ['task-late', 'destructive', '3 days late'],
      ['task-soon', 'warning', 'Due in 2 days'],
    ]);
  });
});
