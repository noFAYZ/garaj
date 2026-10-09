import { expect, it } from 'vitest';
import { proposalFromLine } from './line-proposal';

// A Saturday.
const today = new Date('2026-10-03T15:00:00');

it('reads a fill-up into the fields the entry card shows', () => {
  expect(
    proposalFromLine('Filled up 40 L, €62.40 at Shell, 52,900 km yesterday', false, 'v1', {
      today,
    }),
  ).toEqual({
    action: 'log_entry',
    summary: '',
    fields: {
      vehicle_id: 'v1',
      kind: 'FUEL',
      title: 'Filled up',
      date: '2026-10-02',
      amount: '62.40',
      currency: 'EUR',
      odometer: 52900,
      place: 'Shell',
      quantity: '40',
      quantity_unit: 'L',
    },
  });
});

it('reads a repeat as a plan with its interval, and leaves the vehicle to ask for', () => {
  expect(proposalFromLine('Rotate tyres every 10,000 km', true, null, { today })).toMatchObject({
    action: 'plan',
    fields: { vehicle_id: null, title: 'Rotate tyres', every_distance: 10000 },
  });
});
