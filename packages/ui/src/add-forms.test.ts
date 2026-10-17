import { describe, expect, it } from 'vitest';
import {
  asVin,
  commonJobs,
  dropExtra,
  extraChips,
  firstDue,
  offersSchedule,
  rankKinds,
  splitDraft,
} from './add-forms';
import { parsePlanned } from './quick-entry';
import { typeForMake } from './vehicle-makes';

describe('rankKinds', () => {
  it('puts what the vehicle logs first, most used first, then the common kinds', () => {
    const all = ['PURCHASE', 'FUEL', 'MAINTENANCE', 'REPAIR', 'TRIP', 'NOTE'] as const;
    const logged = [{ eventType: 'TRIP' }, { eventType: 'REPAIR' }, { eventType: 'TRIP' }];
    expect(rankKinds(all, logged)).toEqual([
      'TRIP',
      'REPAIR',
      'FUEL',
      'MAINTENANCE',
      'NOTE',
      'PURCHASE',
    ]);
  });
});

describe('commonJobs', () => {
  it('writes every job in a line the reader reads back, whatever the locale groups with', () => {
    for (const job of commonJobs('km')) {
      const read = parsePlanned(job.line);
      expect(read.title, job.line).not.toBe('');
      expect(read.everyMonths ?? read.everyDistance ?? read.due, job.line).not.toBeNull();
    }
    expect(parsePlanned(commonJobs('mi')[0]!.line).everyDistance).toBe(6000);
  });
});

describe('firstDue', () => {
  const now = new Date('2026-10-12T10:00:00');
  it('says the month and the reading, whichever the schedule counts', () => {
    expect(firstDue(12, 10000, 52900, 'km', now)).toBe('Oct 2027 or 62,900 km');
    expect(firstDue(null, 6000, null, 'mi', now)).toBe('6,000 mi on');
    expect(firstDue(null, null, 100, 'km', now)).toBeNull();
  });
});

describe('asVin', () => {
  it('takes a pasted VIN with its spaces, and nothing that cannot be one', () => {
    expect(asVin('jm1nd 2 a1 4 g0 1 1 4821')).toBe('JM1ND2A14G0114821');
    expect(asVin('JM1ND2A14G011482')).toBeNull();
    expect(asVin('JM1ND2A14G011482O')).toBeNull();
    expect(asVin('2019 Mazda MX-5 RF')).toBeNull();
  });
});

describe('a description, read', () => {
  const { answers, type, unit, extras } = splitDraft({
    vehicleType: 'CAR',
    make: 'Porsche',
    model: '911',
    variant: 'Carrera S',
    year: 2019,
    color: 'White',
    registrationIdentifier: 'ab12 cde',
    purchasePrice: 98000,
    purchaseCurrency: 'USD',
    currentOdometer: 42000,
    odometerUnit: 'KM',
    specs: { oilCapacity: 8.5 },
  });

  it('answers the form and keeps the rest as extras', () => {
    expect(answers).toEqual({
      make: 'Porsche',
      model: '911',
      year: '2019',
      plate: 'AB12 CDE',
      odometer: '42000',
    });
    expect(type).toBe('CAR');
    expect(unit).toBe('KM');
    expect(extraChips(extras).map((chip) => chip.label)).toEqual([
      'Carrera S',
      'White',
      'Bought for $98,000',
      '1 factory spec',
    ]);
  });

  it('drops a chip with everything behind it', () => {
    expect(extraChips(dropExtra(extras, 'purchase')).map((chip) => chip.key)).toEqual([
      'variant',
      'color',
      'specs',
    ]);
  });
});

describe('typeForMake', () => {
  it('answers the type only for a maker of one kind of thing', () => {
    expect(typeForMake('Ducati')).toBe('MOTORCYCLE');
    expect(typeForMake('toyota')).toBe('CAR');
    expect(typeForMake('Honda')).toBeNull();
    expect(typeForMake('Unknown Motors')).toBeNull();
  });
});

describe('offersSchedule', () => {
  it('offers a due schedule to work, never to a fill-up unless the line names it', () => {
    expect(offersSchedule('MAINTENANCE', false, false)).toBe(true);
    expect(offersSchedule('REPAIR', true, false)).toBe(true);
    expect(offersSchedule('REPAIR', false, false)).toBe(false);
    expect(offersSchedule('FUEL', true, false)).toBe(false);
    expect(offersSchedule('FUEL', false, true)).toBe(true);
  });
});
