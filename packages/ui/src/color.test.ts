import { describe, expect, it } from 'vitest';
import { composite, oklchToHex, toNativeTokens } from './color';
import { DARK_TOKENS, LIGHT_TOKENS } from './tokens';

describe('oklchToHex', () => {
  /*
   * Anchors from the CSS Color 4 conversions. These are the values a browser produces for
   * the same strings, which is the point — the two platforms must render one design.
   */
  it('converts pure white and black', () => {
    expect(oklchToHex('oklch(1 0 0)')).toBe('#ffffff');
    expect(oklchToHex('oklch(0 0 0)')).toBe('#000000');
  });

  it('converts a neutral grey to an equal-channel hex', () => {
    const hex = oklchToHex('oklch(0.5 0 0)');
    expect(hex).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });

  it('converts a chromatic colour to the expected channel ordering', () => {
    // A red: the red channel must dominate, and the result must be in gamut.
    const hex = oklchToHex('oklch(0.628 0.2577 29.23)');
    const [red, green, blue] = [1, 3, 5].map((index) =>
      Number.parseInt(hex.slice(index, index + 2), 16),
    );

    expect(red).toBeGreaterThan(green!);
    expect(red).toBeGreaterThan(blue!);
    expect(red).toBeGreaterThan(200);
  });

  it('accepts a percentage lightness', () => {
    expect(oklchToHex('oklch(100% 0 0)')).toBe('#ffffff');
  });

  /** The brand accent is authored in hex; it must survive untouched. */
  it('passes a non-oklch value through unchanged', () => {
    expect(oklchToHex('#ff9500')).toBe('#ff9500');
    expect(oklchToHex('transparent')).toBe('transparent');
  });

  it('returns the input rather than NaN for a malformed string', () => {
    expect(oklchToHex('oklch(nonsense)')).toBe('oklch(nonsense)');
  });

  /** Out of gamut clamps to the nearest displayable colour, never wraps to another hue. */
  it('clamps an out-of-gamut colour instead of wrapping', () => {
    const hex = oklchToHex('oklch(0.9 0.4 140)');
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  /** A wash keeps its alpha: dropping it turned a faint copper tint into solid copper. */
  it('keeps an alpha as the last byte', () => {
    expect(oklchToHex('oklch(1 0 0 / 0.5)')).toBe('#ffffff80');
    expect(oklchToHex('oklch(0 0 0 / 10%)')).toBe('#0000001a');
    expect(oklchToHex('oklch(1 0 0 / 1)')).toBe('#ffffff');
  });
});

describe('composite', () => {
  it('lays a wash over what is under it', () => {
    expect(composite('oklch(1 0 0 / 0.5)', '#000000')).toBe('#808080');
  });

  it('leaves an opaque colour as itself', () => {
    expect(composite('#123456', '#ffffff')).toBe('#123456');
  });
});

describe('toNativeTokens', () => {
  /*
   * The bug this exists for: React Native 0.76 parses hex, rgb, hsl and hwb — an `oklch(…)`
   * string fails, and on a device that is a black surface rather than an error.
   */
  it('leaves no oklch anywhere in either theme', () => {
    for (const tokens of [DARK_TOKENS, LIGHT_TOKENS]) {
      for (const value of Object.values(toNativeTokens(tokens))) {
        expect(value).not.toContain('oklch');
        expect(value).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      }
    }
  });

  it('keeps every token name', () => {
    expect(Object.keys(toNativeTokens(DARK_TOKENS))).toEqual(Object.keys(DARK_TOKENS));
  });

  it('keeps the dark theme dark and the light theme light', () => {
    const dark = toNativeTokens(DARK_TOKENS);
    const light = toNativeTokens(LIGHT_TOKENS);

    const brightness = (hex: string) =>
      [1, 3, 5].reduce(
        (total, index) => total + Number.parseInt(hex.slice(index, index + 2), 16),
        0,
      );

    expect(brightness(dark.background)).toBeLessThan(brightness(light.background));
    expect(brightness(dark.foreground)).toBeGreaterThan(brightness(light.foreground));
  });
});
