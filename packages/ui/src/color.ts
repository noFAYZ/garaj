/**
 * Converting the tokens into something React Native can parse.
 *
 * The tokens are authored in oklch because its lightness is perceptual — stepping the first
 * number gives a ramp that reads as evenly spaced, which stepping hex lightness does not.
 * CSS understands that directly. React Native does not: as of 0.76 its colour normaliser
 * handles hex, rgb, hsl and hwb, and an `oklch(…)` string simply fails to parse, which shows
 * up on a device as a black or transparent surface rather than as an error.
 *
 * Keeping a second hand-maintained list of hex values is how the two platforms drift apart
 * on the day someone adjusts one and forgets the other. So the conversion is done here, from
 * the same source, by the published formula.
 *
 * No dependency: this is forty lines of arithmetic out of the Oklab paper, and it is easier
 * to verify against known values than a package is to keep current.
 */

/** sRGB gamma encoding — the same curve the CSS spec applies on the way out of linear light. */
function encodeGamma(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

function toByte(channel: number): number {
  // Clamped, not wrapped: an out-of-gamut colour becomes the nearest displayable one rather
  // than an unrelated hue.
  return Math.max(0, Math.min(255, Math.round(encodeGamma(channel) * 255)));
}

const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i;

/**
 * `oklch(L C H)` to `#rrggbb`, and `oklch(L C H / A)` to `#rrggbbaa`.
 *
 * The alpha is kept, not dropped: the web's soft tints are its colours at a tenth or so, laid
 * over whatever is behind them, and an opaque conversion turned a faint copper wash into solid
 * copper on the phone. React Native parses eight-digit hex.
 *
 * Returns the input unchanged if it is not an oklch string, so a token already written as
 * hex — the chart series — passes through untouched.
 */
export function oklchToHex(value: string): string {
  const match = OKLCH.exec(value.trim());
  if (!match) return value;

  const rawLightness = match[1]!;
  const lightness = rawLightness.endsWith('%')
    ? Number.parseFloat(rawLightness) / 100
    : Number.parseFloat(rawLightness);
  const chroma = Number.parseFloat(match[2]!);
  const hue = Number.parseFloat(match[3]!);

  if (!Number.isFinite(lightness) || !Number.isFinite(chroma) || !Number.isFinite(hue)) {
    return value;
  }

  // Polar oklch to cartesian oklab.
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  // Oklab to LMS, cubed back out of the cube root the space is defined in.
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  // LMS to linear sRGB.
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const hex = [red, green, blue]
    .map((channel) => toByte(channel).toString(16).padStart(2, '0'))
    .join('');
  const rawAlpha = match[4];
  if (rawAlpha === undefined) return `#${hex}`;
  const alpha = rawAlpha.endsWith('%')
    ? Number.parseFloat(rawAlpha) / 100
    : Number.parseFloat(rawAlpha);
  if (!Number.isFinite(alpha) || alpha >= 1) return `#${hex}`;
  return `#${hex}${Math.round(Math.max(0, alpha) * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/**
 * `top` laid over an opaque `bottom`, as the screen shows it: per channel, in encoded sRGB — the
 * way browsers and React Native both blend. An opaque `top` comes back as itself.
 */
export function composite(top: string, bottom: string): string {
  const over = oklchToHex(top);
  const under = oklchToHex(bottom);
  const alpha = over.length === 9 ? Number.parseInt(over.slice(7, 9), 16) / 255 : 1;
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(index, index + 2), 16);
  return `#${[1, 3, 5]
    .map((index) =>
      Math.round(alpha * channel(over, index) + (1 - alpha) * channel(under, index))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * A whole token set, converted.
 *
 * React Native reads this; the web reads the originals, because CSS can interpolate oklch
 * and a hex value it cannot.
 */
export function toNativeTokens<T extends Record<string, string>>(tokens: T): T {
  return Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => [name, oklchToHex(value)]),
  ) as T;
}

/** Relative luminance of `#rrggbb`, as WCAG 2 defines it. */
function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

/**
 * WCAG contrast between two colours, each oklch or hex: 1 for none, 21 for black on white.
 *
 * Measured on the hex each value renders as, so the check is of what reaches the screen — the
 * same conversion React Native gets.
 */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(oklchToHex(first)), luminance(oklchToHex(second))].sort(
    (a, b) => b - a,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}
