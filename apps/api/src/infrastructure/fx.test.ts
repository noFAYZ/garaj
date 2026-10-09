import { describe, expect, it } from 'vitest';
import { convertMinor, type FxRates } from './fx';

/** USD base, as the provider quotes it: one dollar buys 0.9 EUR, 150 JPY. */
const rates: FxRates = {
  base: 'USD',
  asOf: '2026-09-18T11:17:00.000Z',
  rates: { EUR: 0.9, JPY: 150, CHF: 0.8 },
};

describe('convertMinor', () => {
  it('converts through the base currency', () => {
    // 90.00 EUR is $100.00, which is 80.00 CHF.
    expect(convertMinor(9_000, 'EUR', 'CHF', rates)).toBe(8_000);
  });

  it('leaves an amount already in the target currency exactly as it is', () => {
    expect(convertMinor(1_234, 'EUR', 'EUR', rates)).toBe(1_234);
  });

  /*
   * The one that a plain multiply gets wrong by a hundred: JPY has no minor unit, so ¥15000
   * is fifteen thousand yen while 15000 USD minor is $150 — and $100 is ¥15000, not ¥1500000.
   */
  it('respects currencies whose minor unit exponent differs', () => {
    expect(convertMinor(10_000, 'USD', 'JPY', rates)).toBe(15_000);
    expect(convertMinor(15_000, 'JPY', 'USD', rates)).toBe(10_000);
  });

  it('handles the base currency on either side without needing it in the table', () => {
    expect(convertMinor(10_000, 'USD', 'EUR', rates)).toBe(9_000);
    expect(convertMinor(9_000, 'EUR', 'USD', rates)).toBe(10_000);
  });

  // A rate the provider does not quote is not a rate of 1.
  it('answers null for a currency missing from the table', () => {
    expect(convertMinor(5_000, 'XPF', 'USD', rates)).toBeNull();
    expect(convertMinor(5_000, 'USD', 'XPF', rates)).toBeNull();
  });
});
