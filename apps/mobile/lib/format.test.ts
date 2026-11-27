import { describe, expect, it } from 'vitest';
import { fitFigure } from './format';

describe('fitFigure', () => {
  it('keeps its size when the figure fits, and before the row is measured', () => {
    expect(fitFigure('PKR4.5M', 120, 17)).toBe(17);
    expect(fitFigure('PKR4.5M', null, 17)).toBe(17);
  });

  it('shrinks only as far as the width demands', () => {
    const size = fitFigure('PKR45.2M', 60, 17);
    expect(size).toBeLessThan(17);
    // Eight Cascadia Mono glyphs at that size fill the room, less the spare point.
    expect(8 * size * (1200 / 2048)).toBeCloseTo(59, 5);
  });

  it('never drops below a readable floor', () => {
    expect(fitFigure('PKR123,456,789', 20, 17)).toBe(10);
  });
});
