import { describe, expect, it } from 'vitest';
import { MappingError, mapRow, parseDecimal, parseRowDate, toMinor } from './mappings';

const defaults = { currency: 'USD', distanceUnit: 'KM', volumeUnit: 'LITER' } as const;

describe('parseDecimal', () => {
  it('reads both decimal conventions', () => {
    expect(parseDecimal('1,234.56')).toBe(1234.56);
    expect(parseDecimal('1.234,56')).toBe(1234.56);
    expect(parseDecimal('42,50')).toBe(42.5);
    expect(parseDecimal('1,500')).toBe(1500);
  });

  it('ignores currency symbols and returns null for nothing numeric', () => {
    expect(parseDecimal('$ 12.00')).toBe(12);
    expect(parseDecimal('n/a')).toBeNull();
  });
});

describe('parseRowDate', () => {
  it('reads ISO and day-first dates, and refuses anything else', () => {
    expect(parseRowDate('2024-03-09')?.toISOString()).toBe('2024-03-09T12:00:00.000Z');
    expect(parseRowDate('09/03/2024')?.toISOString()).toBe('2024-03-09T12:00:00.000Z');
    expect(parseRowDate('March 9 2024')).toBeNull();
  });
});

describe('mapRow', () => {
  it('reads a Fuelly fill-up, inverting its partial flag', () => {
    const row = mapRow(
      {
        date: '2024-03-09',
        odometer: '54321',
        gallons: '12.004',
        totalspent: '41.28',
        partial: '0',
        gasbrand: 'Shell',
      },
      'fuelly',
      defaults,
    );

    expect(row.category).toBe('FUEL');
    expect(row.amountMinor).toBe(4128);
    expect(row.odometer).toBe(54321);
    expect(row.quantity).toBe('12.004');
    expect(row.isFullTank).toBe(true);
    expect(row.vendor).toBe('Shell');
  });

  it('derives the total from a unit price when the file has no total column', () => {
    const row = mapRow(
      { date: '2024-03-09', volume: '40', priceperunit: '1,75', fulltank: 'yes' },
      'drivvo',
      defaults,
    );
    expect(row.amountMinor).toBe(toMinor(70, 'USD'));
    expect(row.isFullTank).toBe(true);
  });

  it('takes minor units and the currency straight off a garaj export', () => {
    const row = mapRow(
      {
        id: '018f7a2e-0000-7000-8000-000000000001',
        occurredat: '2024-03-09T08:00:00.000Z',
        category: 'MAINTENANCE',
        description: 'Oil change',
        amountminor: '9950',
        currency: 'eur',
      },
      'garaj',
      defaults,
    );

    expect(row.amountMinor).toBe(9950);
    expect(row.currency).toBe('EUR');
    expect(row.category).toBe('MAINTENANCE');
    expect(row.id).toBe('018f7a2e-0000-7000-8000-000000000001');
  });

  it('refuses a row it cannot price or date, naming the reason', () => {
    expect(() => mapRow({ date: '2024-03-09' }, 'fuelly', defaults)).toThrow(MappingError);
    expect(() => mapRow({ totalspent: '10' }, 'fuelly', defaults)).toThrow(/date/i);
  });
});

describe('fuelio', () => {
  it('reads a fill with a unit price and no total', () => {
    const row = mapRow(
      {
        // Keys arrive already normalised, as `normaliseHeader` leaves them: "Price/l" is
        // "pricel" and "Fuel station name" is "fuelstationname".
        data: '2026-03-04',
        odo: '120450',
        fuel: '41.2',
        pricel: '1.759',
        full: '1',
        fuelstationname: 'Shell A12',
      },
      'fuelio',
      { ...defaults, currency: 'EUR' },
    );

    expect(row.category).toBe('FUEL');
    expect(row.odometer).toBe(120_450);
    expect(row.quantity).toBe('41.2');
    // 41.2 x 1.759 = 72.47 EUR, to the cent.
    expect(row.amountMinor).toBe(toMinor(72.47, 'EUR'));
    expect(row.isFullTank).toBe(true);
    expect(row.vendor).toBe('Shell A12');
  });
});

describe('mycars', () => {
  it('keeps a service row out of the fuel figures', () => {
    const row = mapRow(
      {
        date: '2026-02-11',
        type: 'Service',
        cost: '189.00',
        currency: 'USD',
        note: 'Annual service',
        odometer: '88000',
      },
      'mycars',
      defaults,
    );

    // Mapped from its own type column, not assumed to be fuel: a service row read as a fill
    // lands in the consumption figures and quietly wrecks them.
    expect(row.category).not.toBe('FUEL');
    expect(row.quantity).toBeNull();
    expect(row.amountMinor).toBe(toMinor(189, 'USD'));
    expect(row.currency).toBe('USD');
  });

  it('reads a quantity and a total off a fill', () => {
    const row = mapRow(
      { date: '2026-02-20', type: 'Fuel', quantity: '38.4', cost: '12.10', odometer: '12000' },
      'mycars',
      defaults,
    );

    expect(row.category).toBe('FUEL');
    expect(row.quantity).toBe('38.4');
    expect(row.amountMinor).toBe(toMinor(12.1, 'USD'));
  });
});
