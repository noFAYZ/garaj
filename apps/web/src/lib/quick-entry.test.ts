import { describe, expect, it } from 'vitest';
import { fillQuantity, parseDone, parsePlanned } from './quick-entry';

// A Saturday.
const today = new Date('2026-10-03T15:00:00');

describe('parseDone', () => {
  it('reads a fill-up said in one breath', () => {
    const parsed = parseDone('Filled up 40 L, €62.40 at Shell, 52,900 km yesterday', { today });
    expect(parsed).toMatchObject({
      title: 'Filled up',
      kind: 'FUEL',
      amount: '62.40',
      currency: 'EUR',
      odometer: 52900,
      day: '2026-10-02',
      place: 'Shell',
      quantity: '40 L',
    });
  });

  it('keeps the words that name the job in the title', () => {
    const parsed = parseDone('Oil and filter change at Kwik Fit for €189.50', { today });
    expect(parsed).toMatchObject({
      title: 'Oil and filter change',
      kind: 'MAINTENANCE',
      amount: '189.50',
      place: 'Kwik Fit',
    });
  });

  it('takes money in every way it is written', () => {
    expect(parseDone('Parking €4', { today }).amount).toBe('4');
    expect(parseDone('Parking 4.5 eur', { today }).amount).toBe('4.50');
    expect(parseDone('Wash 12.00', { today }).amount).toBe('12.00');
    expect(parseDone('Tyres $1,240', { today }).amount).toBe('1240');
    // The currency it was written in travels with it; a bare amount has none.
    expect(parseDone('Parking 4.5 eur', { today }).currency).toBe('EUR');
    expect(parseDone('Wash £8', { today }).currency).toBe('GBP');
    expect(parseDone('Tyres $1,240', { today }).currency).toBe('$');
    expect(parseDone('Wash 12.00', { today }).currency).toBeNull();
  });

  it('reads a bare reading, and one said as a distance since the last', () => {
    expect(parseDone('Fuel 52900', { today }).odometer).toBe(52900);
    expect(parseDone('Fuel +150 km', { today, lastReading: 52747 }).odometer).toBe(52897);
    // Without a last reading there is nothing to add to, so it is left in the words.
    expect(parseDone('Fuel +150 km', { today }).odometer).toBeNull();
  });

  it('reads days the way people say them, never into the future', () => {
    expect(parseDone('Wash today', { today }).day).toBe('2026-10-03');
    expect(parseDone('Wash 3 days ago', { today }).day).toBe('2026-09-30');
    expect(parseDone('Wash on Monday', { today }).day).toBe('2026-09-28');
    expect(parseDone('Wash last saturday', { today }).day).toBe('2026-09-26');
    expect(parseDone('Wash 12 Sep', { today }).day).toBe('2026-09-12');
    // December has not come yet this year, so it was last December.
    expect(parseDone('Wash Dec 20', { today }).day).toBe('2025-12-20');
  });

  it('infers the kind from what was measured', () => {
    expect(parseDone('32 kWh at home', { today }).kind).toBe('CHARGE');
    expect(parseDone('45 litres', { today }).kind).toBe('FUEL');
  });

  it('leaves a line it does not understand alone', () => {
    expect(parseDone('Rattle from the dash at idle', { today })).toMatchObject({
      title: 'Rattle from the dash at idle',
      kind: null,
      amount: null,
      odometer: null,
    });
  });

  it('says where each thing it read sat in the line', () => {
    const line = 'Wash €12 at Splash';
    const { tokens } = parseDone(line, { today });
    expect(tokens.map((t) => [t.kind, line.slice(t.start, t.end)])).toEqual([
      ['kind', 'Wash'],
      ['money', '€12'],
      ['place', 'at Splash'],
    ]);
  });
});

describe('parsePlanned', () => {
  it('reads a repeat by distance, time, or both', () => {
    expect(parsePlanned('Rotate tyres every 10,000 km', { today })).toMatchObject({
      title: 'Rotate tyres',
      everyDistance: 10000,
      everyMonths: null,
    });
    expect(parsePlanned('Oil change every 12 months or 15k km', { today })).toMatchObject({
      title: 'Oil change',
      everyMonths: 12,
      everyDistance: 15000,
    });
    expect(parsePlanned('Inspection yearly', { today })).toMatchObject({
      title: 'Inspection',
      everyMonths: 12,
    });
  });

  it('reads a due date, always ahead', () => {
    expect(parsePlanned('Renew insurance on 11 Nov', { today })).toMatchObject({
      title: 'Renew insurance',
      due: '2026-11-11',
    });
    expect(parsePlanned('Book MOT next week', { today }).due).toBe('2026-10-10');
    expect(parsePlanned('Book MOT in 3 months', { today }).due).toBe('2027-01-03');
    expect(parsePlanned('Wash tomorrow', { today }).due).toBe('2026-10-04');
    // September has gone this year.
    expect(parsePlanned('Renew tax 1 Sep', { today }).due).toBe('2027-09-01');
  });
});

it('lifts a fill quantity off the front of its note', () => {
  expect(fillQuantity('FUEL', '40 L')).toEqual({ quantity: '40 L', rest: '' });
  expect(fillQuantity('CHARGE', '32kwh · slow charger')).toEqual({
    quantity: '32kWh',
    rest: 'slow charger',
  });
  expect(fillQuantity('FUEL', '12.5 gal, premium')).toEqual({
    quantity: '12.5 gal',
    rest: 'premium',
  });
  // Not a fill, or not a quantity: the note stays whole.
  expect(fillQuantity('MAINTENANCE', '5 L of oil')).toEqual({ quantity: null, rest: '5 L of oil' });
  expect(fillQuantity('FUEL', '40 Lanes road')).toEqual({ quantity: null, rest: '40 Lanes road' });
  expect(fillQuantity('FUEL', null)).toEqual({ quantity: null, rest: '' });
});
