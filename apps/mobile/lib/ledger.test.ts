import { describe, expect, it } from 'vitest';
import { economy, ledgerDate, monthSpend, sincePrevious, spendWindow, unitPrice } from './ledger';

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
const entry = (amountMinor: number | null, eventType = 'FUEL', currency = 'USD') => ({
  occurredAt: '2026-10-01T10:00:00',
  cost: amountMinor === null ? null : { amountMinor, currency },
  eventType,
});

describe('ledgerDate', () => {
  // Thursday, 9 October 2026, late in the evening.
  const now = new Date('2026-10-09T23:30:00');

  it('says today and yesterday by the calendar, not by 24 hours', () => {
    expect(ledgerDate('2026-10-09T00:10:00', now)).toBe('Today');
    expect(ledgerDate('2026-10-08T23:59:00', now)).toBe('Yesterday');
  });

  it('names the weekday inside the week, then the date', () => {
    expect(ledgerDate('2026-10-06T09:00:00', now)).toBe('Tuesday');
    expect(ledgerDate('2026-10-02T09:00:00', now)).toBe('Oct 2');
    expect(ledgerDate('2025-12-25T09:00:00', now)).toBe('Dec 25');
  });
});

describe('monthSpend', () => {
  it('adds a month up in its one currency, entries without a cost aside', () => {
    expect(monthSpend([entry(6000), entry(null, 'NOTE'), entry(4500, 'CLEANING')])).toEqual(
      usd(10_500),
    );
  });

  it('has no total for a month in two currencies, or with nothing spent', () => {
    expect(monthSpend([entry(6000), entry(900_000, 'FUEL', 'JPY')])).toBeNull();
    expect(monthSpend([entry(null, 'NOTE')])).toBeNull();
  });
});

const reading = (id: string, day: string, odometer: number | null, amountMinor: number | null = null) => ({
  id,
  occurredAt: `2026-${day}T10:00:00`,
  cost: amountMinor === null ? null : usd(amountMinor),
  odometer,
  odometerUnit: 'KM',
});

describe('sincePrevious', () => {
  const fills = [reading('c', '10-12', 92_310), reading('b', '09-30', 91_470), reading('a', '09-01', null)];

  it('finds the entry of the kind before, the days and the distance between', () => {
    const since = sincePrevious(fills[0]!, fills);
    expect(since?.previous.id).toBe('b');
    expect(since?.days).toBe(12);
    expect(since?.distance).toBe(840);
  });

  it('has days but no distance where the one before took no reading, and nothing for the first', () => {
    expect(sincePrevious(fills[1]!, fills)).toMatchObject({ days: 29, distance: null });
    expect(sincePrevious(fills[2]!, fills)).toBeNull();
  });

  it('measures no distance across units, or down', () => {
    const miles = { ...reading('m', '10-01', 10), odometerUnit: 'MI' };
    expect(sincePrevious(fills[0]!, [miles])?.distance).toBeNull();
    expect(sincePrevious(reading('d', '10-20', 90_000), fills)?.distance).toBeNull();
  });
});

describe('economy and unitPrice', () => {
  it('says litres per 100 km and miles per gallon, full to full', () => {
    expect(economy('30 L', 400, 'KM')).toBe('7.5 L/100 km');
    expect(economy('42,5 L', 500, 'KM')).toBe('8.5 L/100 km');
    expect(economy('12 gal', 360, 'MI')).toBe('30.0 mpg');
    expect(economy('30 L', null, 'KM')).toBeNull();
    expect(economy(null, 400, 'KM')).toBeNull();
  });

  it('prices one unit of the fill', () => {
    expect(unitPrice(usd(6000), '40 L')).toEqual({ price: usd(150), per: 'L' });
    expect(unitPrice(null, '40 L')).toBeNull();
  });
});

describe('spendWindow', () => {
  const fills = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
    reading(`f${n}`, `10-${String(n).padStart(2, "0")}`, null, n * 1000),
  );

  it('keeps the entry near the middle, oldest first, with the median as typical', () => {
    const window = spendWindow(fills[1]!, fills, 4)!;
    expect(window.bars.map((bar) => bar.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(spendWindow(fills[9]!, fills, 4)!.bars.map((bar) => bar.id)).toEqual(['f7', 'f8', 'f9', 'f10']);
    expect(window.typical).toBe(5500);
    expect(window.max).toBe(5500);
  });

  it('draws nothing under three costs or without one, and keeps to one currency', () => {
    expect(spendWindow(fills[0]!, fills.slice(0, 2))).toBeNull();
    expect(spendWindow({ ...fills[0]!, cost: null }, fills)).toBeNull();
    const yen = { ...fills[2]!, id: 'yen', cost: { amountMinor: 9, currency: 'JPY' } };
    expect(spendWindow(fills[0]!, [...fills.slice(0, 2), yen])).toBeNull();
  });
});
