import { describe, expect, it } from 'vitest';
import { toBlocks, tokenize } from './answer-format';

const mazda = { id: 'v1', names: ['2019 Mazda MX-5', 'Mazda MX-5'] };
const kinds = (text: string) =>
  tokenize(text, [mazda])
    .filter((token) => token.kind !== 'text')
    .map((token) => `${token.kind}:${token.text}`);

describe('tokenize', () => {
  it('marks vehicles, money, distances and dates in one sentence', () => {
    expect(
      kinds(
        'Your 2019 Mazda MX-5 has cost $1,240.50, or 25.00 EUR, over 84,213 km since 2026-03-12.',
      ),
    ).toEqual([
      'vehicle:2019 Mazda MX-5',
      'figure:$1,240.50',
      'figure:25.00 EUR',
      'figure:84,213 km',
      'date:2026-03-12',
    ]);
  });

  it('prefers the longest vehicle name and leaves a model year alone', () => {
    expect(kinds('The mazda mx-5 is due in 3 months; the 2019 BMW is not yours.')).toEqual([
      'vehicle:mazda mx-5',
      'figure:3 months',
    ]);
  });

  it('keeps sentence punctuation out of figures and reads written dates', () => {
    expect(kinds('Spent Rs 5,000, then 40 L on 12 Mar 2026 and 6.2 L/100 km.')).toEqual([
      'figure:Rs 5,000',
      'figure:40 L',
      'date:12 Mar 2026',
      'figure:6.2 L/100 km',
    ]);
  });

  it('rejoins every character it was given', () => {
    const text = 'The 2019 Mazda MX-5 cost $20 on 2026-01-02.';
    expect(
      tokenize(text, [mazda])
        .map((token) => token.text)
        .join(''),
    ).toBe(text);
  });
});

describe('toBlocks', () => {
  it('splits a lead sentence from a label: value breakdown and drops stray markdown', () => {
    expect(
      toBlocks('**Total** is $1,240.\nAcross two lines.\n\n- FUEL: $820\n* service: $420\n- Tyres'),
    ).toEqual([
      { kind: 'prose', text: 'Total is $1,240. Across two lines.' },
      {
        kind: 'list',
        items: [
          { label: 'Fuel', value: '$820' },
          { label: 'Service', value: '$420' },
          { value: 'Tyres' },
        ],
      },
    ]);
  });
});
