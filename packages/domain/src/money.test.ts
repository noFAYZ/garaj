import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  add,
  compare,
  format,
  fromMajor,
  minorUnitExponent,
  money,
  multiply,
  subtract,
  sum,
  toMajor,
  zero,
} from './money';

describe('minorUnitExponent', () => {
  it('reads the exponent per currency rather than assuming 2', () => {
    expect(minorUnitExponent('USD')).toBe(2);
    expect(minorUnitExponent('EUR')).toBe(2);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KWD')).toBe(3);
  });

  it('rejects anything that is not a 3-letter code', () => {
    expect(() => minorUnitExponent('US')).toThrow(MoneyError);
    expect(() => minorUnitExponent('dollars')).toThrow(MoneyError);
  });
});

describe('construction', () => {
  it('normalises the currency code to upper case', () => {
    expect(money(100, 'usd').currency).toBe('USD');
  });

  it('rejects fractional minor units', () => {
    expect(() => money(10.5, 'USD')).toThrow(MoneyError);
  });

  it('rejects amounts past the safe integer range instead of rounding them', () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, 'USD')).toThrow(MoneyError);
  });
});

describe('fromMajor / toMajor', () => {
  it('round-trips a plain amount', () => {
    expect(toMajor(fromMajor(57000, 'USD'))).toBe(57000);
  });

  /*
   * The classic float trap: 1.005 * 100 is 100.49999999999999 in binary, so a truncating
   * implementation stores 100 and loses a cent on roughly half of all real prices.
   */
  it('rounds to nearest rather than truncating the binary representation', () => {
    expect(fromMajor(1.005, 'USD').amountMinor).toBe(101);
    expect(fromMajor(0.1, 'USD').amountMinor).toBe(10);
    expect(fromMajor(12.34, 'USD').amountMinor).toBe(1234);
  });

  it('scales by the currency exponent, not always by 100', () => {
    expect(fromMajor(1000, 'JPY').amountMinor).toBe(1000);
    expect(fromMajor(1.234, 'KWD').amountMinor).toBe(1234);
  });

  it('rejects a non-finite major amount', () => {
    expect(() => fromMajor(Number.NaN, 'USD')).toThrow(MoneyError);
    expect(() => fromMajor(Number.POSITIVE_INFINITY, 'USD')).toThrow(MoneyError);
  });
});

describe('arithmetic', () => {
  it('does not accumulate float error the way 0.1 + 0.2 does', () => {
    const total = add(fromMajor(0.1, 'USD'), fromMajor(0.2, 'USD'));
    expect(total.amountMinor).toBe(30);
    expect(toMajor(total)).toBe(0.3);
  });

  it('refuses to combine different currencies', () => {
    expect(() => add(money(100, 'USD'), money(100, 'EUR'))).toThrow(MoneyError);
    expect(() => subtract(money(100, 'USD'), money(100, 'EUR'))).toThrow(MoneyError);
    expect(() => compare(money(100, 'USD'), money(100, 'EUR'))).toThrow(MoneyError);
  });

  it('subtracts into a negative balance', () => {
    expect(subtract(money(100, 'USD'), money(250, 'USD')).amountMinor).toBe(-150);
  });

  it('rounds a multiplied amount to a whole minor unit', () => {
    expect(multiply(money(1000, 'USD'), 0.075).amountMinor).toBe(75);
    expect(multiply(money(333, 'USD'), 1 / 3).amountMinor).toBe(111);
  });
});

describe('sum', () => {
  it('adds a list of same-currency amounts', () => {
    const total = sum([money(180_00, 'USD'), money(1240_00, 'USD'), money(650_00, 'USD')]);
    expect(total).toEqual(money(2070_00, 'USD'));
  });

  /*
   * An empty garage has no total, not a total of zero dollars. Defaulting the currency
   * would label every non-USD user's empty state in the wrong currency.
   */
  it('returns null for an empty list rather than guessing a currency', () => {
    expect(sum([])).toBeNull();
  });

  it('throws when the list mixes currencies', () => {
    expect(() => sum([money(100, 'USD'), money(100, 'EUR')])).toThrow(MoneyError);
  });
});

describe('format', () => {
  it('formats using the currency exponent', () => {
    expect(format(money(4850000, 'USD'))).toBe('$48,500.00');
    expect(format(money(1000, 'JPY'))).toBe('¥1,000');
  });

  it('formats zero', () => {
    expect(format(zero('USD'))).toBe('$0.00');
  });
});

describe('rounding direction', () => {
  it('rounds half away from zero in both directions', () => {
    expect(fromMajor(-1.005, 'USD').amountMinor).toBe(-101);
    expect(fromMajor(2.675, 'USD').amountMinor).toBe(268);
    expect(fromMajor(-2.675, 'USD').amountMinor).toBe(-268);
  });

  it('never produces negative zero, which would serialise as "-0"', () => {
    expect(Object.is(fromMajor(-0.001, 'USD').amountMinor, 0)).toBe(true);
    expect(Object.is(multiply(money(-1, 'USD'), 0).amountMinor, 0)).toBe(true);
  });
});

describe('currency validation', () => {
  it('accepts real ISO 4217 codes', () => {
    for (const code of ['USD', 'EUR', 'GBP', 'JPY', 'KWD', 'SEK', 'AED']) {
      expect(() => money(100, code)).not.toThrow();
    }
  });

  /*
   * A pattern check alone passes "XYZ": three uppercase letters, no such currency. The
   * amount would store fine and then be unformattable and unsummable forever.
   */
  it('rejects a well-formed code that is not a real currency', () => {
    expect(() => money(100, 'XYZ')).toThrow(MoneyError);
    expect(() => money(100, 'ZZZ')).toThrow(MoneyError);
  });
});
