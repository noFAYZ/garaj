import { describe, expect, it } from 'vitest';
import type { Vehicle } from '@vehicle-os/contracts';
import { findVehicle, readIntent } from './add-intent';

const vehicle = (over: Partial<Vehicle>): Vehicle =>
  ({ id: over.displayName, nickname: null, make: null, model: null, ...over }) as Vehicle;

const mazda = vehicle({ displayName: '2019 Mazda MX-5', make: 'Mazda', model: 'MX-5' });
const porsche = vehicle({ displayName: '2021 Porsche 911', make: 'Porsche', model: '911' });
const cayenne = vehicle({ displayName: '2020 Porsche Cayenne', make: 'Porsche', model: 'Cayenne' });
const garage = [mazda, porsche];

describe('findVehicle', () => {
  it('finds the vehicle a line names, and takes it and its "the" out', () => {
    expect(findVehicle('Filled up the Mazda, €62 at Shell', garage)).toEqual({
      vehicle: mazda,
      rest: 'Filled up, €62 at Shell',
    });
    expect(findVehicle('Oil change on the MX-5', garage).vehicle).toBe(mazda);
  });

  it('prefers the longest name, and asks when two match equally', () => {
    expect(findVehicle('Wash the Porsche Cayenne', [porsche, cayenne]).vehicle).toBe(cayenne);
    expect(findVehicle('Wash the Porsche', [porsche, cayenne]).vehicle).toBeNull();
  });
});

describe('readIntent', () => {
  it('sends a question to Ask, with the vehicle it is about', () => {
    expect(readIntent('What did the Mazda cost this year?', garage)).toMatchObject({
      kind: 'ask',
      vehicle: mazda,
    });
    expect(readIntent('how much fuel am I using', garage).kind).toBe('ask');
  });

  it('reads anything else as something to log on a vehicle', () => {
    expect(readIntent('Filled up the Mazda 40 L €62', garage)).toEqual({
      kind: 'log',
      line: 'Filled up 40 L €62',
      vehicle: mazda,
      planned: false,
    });
  });

  it('reads "remind me", or an interval, as a reminder', () => {
    expect(readIntent('remind me to rotate tyres every 10,000 km on the Porsche', garage)).toEqual({
      kind: 'log',
      line: 'rotate tyres every 10,000 km',
      vehicle: porsche,
      planned: true,
    });
    expect(readIntent('Oil change every 12 months', [mazda])).toMatchObject({
      planned: true,
      vehicle: mazda,
    });
  });

  it('takes the only vehicle when none is named, and none of several', () => {
    expect(
      readIntent('Washed it', [mazda]).kind === 'log' && readIntent('Washed it', [mazda]),
    ).toMatchObject({ vehicle: mazda });
    expect(readIntent('Washed it', garage)).toMatchObject({ vehicle: null });
  });
});
