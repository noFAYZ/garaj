import { composite, DARK_TOKENS, LIGHT_TOKENS, oklchToHex, toNativeTokens } from '@vehicle-os/ui';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { useScheme } from './appearance';

/**
 * The phone's half of "Precision / Editorial", the web's design system.
 *
 * Every colour comes from `@vehicle-os/ui`, the same tokens `globals.css` declares (a test fails if
 * the two differ) — copper as identity, warm carbon and mineral as material, statuses spaced by hue.
 * React Native cannot use Tailwind, so the values are shared and the mechanism is not
 * (Architecture.md §65). What is added here is only what the web draws with CSS a phone lacks: the
 * resting card the web gets from `bg-card/50`, the lit rim of a dark floating surface, a scrim.
 */
const SHARED_DARK = toNativeTokens(DARK_TOKENS);
const SHARED_LIGHT = toNativeTokens(LIGHT_TOKENS);

/** The web's resting card is the card at half strength over the page; it lifts to full on hover. */
const resting = (tokens: typeof DARK_TOKENS | typeof LIGHT_TOKENS) =>
  composite(tokens.card.replace(')', ' / 0.5)'), tokens.background);

const DARK = {
  ...SHARED_DARK,
  /** A card at rest on the page — `bg-card/50`. */
  card: resting(DARK_TOKENS),
  /** The full card: something lifted, pressed, or floating over the page. */
  cardRaised: SHARED_DARK.card,
  /** Hairline edges, `ring-1 ring-border` at the web's 76%. */
  hairline: 'rgba(255,255,255,0.07)',
  /** The light catching the top edge of a dark floating surface. */
  rim: 'rgba(255,255,255,0.14)',
  scrim: 'rgba(0,0,0,0.52)',
  shadow: '#000000',
  /**
   * Hint text in an empty field: soft, well below the text it stands in for. Android's high-contrast
   * text setting ignores it (it redraws text solid black or white); the TextInput wrapper
   * (`font-text-input.tsx`) fades an empty field there instead.
   */
  placeholder: oklchToHex('oklch(0.52 0.012 70)'),
  dark: true,
};

export type Theme = { [K in keyof typeof DARK]: K extends 'dark' ? boolean : string };

const LIGHT: Theme = {
  ...SHARED_LIGHT,
  // The phone's page is plain white (user asked); the web keeps its warm paper. Resting cards still
  // mix against the paper, so they read as a faint warm tint on the white.
  background: '#ffffff',
  // Lighter than the web's muted (0.925), to sit softly on the white page (user asked).
  muted: oklchToHex('oklch(0.96 0.006 78)'),
  card: resting(LIGHT_TOKENS),
  // Raised surfaces are the page's own solid white (user asked), edged by a hairline; cards cast no shadow.
  cardRaised: '#ffffff',
  hairline: 'rgba(40,30,20,0.08)',
  rim: 'rgba(255,255,255,0.9)',
  scrim: 'rgba(28,22,16,0.38)',
  // The web's light shadow: warm ink at low strength, never black.
  shadow: oklchToHex('oklch(0.2 0.015 65)'),
  placeholder: oklchToHex('oklch(0.73 0.012 70)'),
  dark: false,
};

export function useTheme(): Theme {
  // The person's choice from Settings, else the phone's.
  return useScheme() === 'light' ? LIGHT : DARK;
}

/** A 4pt grid — the web's Tailwind spacing, in points. */
export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** The web's radii: instrument-like rather than toy-like. `xxl` is `rounded-2xl`, a card. */
export const radius = { sm: 7, md: 10, lg: 13, xl: 16, xxl: 20, xxxl: 24, pill: 999 } as const;

/**
 * The house card silhouette, from Home's dash (user, 2026-11-20: every card the same, "creative and
 * modern"): a leaf. The top-left corner, where a card is entered and read from, and the bottom-right,
 * where it ends and its action sits, are swept wide; the other two are held tight. Every curve is
 * continuous (a squircle on iOS), never a quarter circle.
 *
 * Containers only: cards, panels, list groups, previews. Controls (buttons, chips, inputs, keys)
 * keep symmetric corners so an action never reads as a container, and sheets and dialogs keep theirs.
 *
 * `lg` for a screen's lead card (Home's dash, the vehicle's stage and dash, a showroom bay, the
 * Logs card), `md` for content cards, `sm` for small ones and tiles. `inset` is for what sits inside
 * a card along its edge: its corners are the card's less the inset, so the curves stay concentric.
 */
export const LEAF = {
  lg: { wide: 32, tight: 12 },
  md: { wide: 24, tight: 10 },
  sm: { wide: 18, tight: 7 },
} as const;
export type LeafSize = keyof typeof LEAF;

export function leaf(size: LeafSize = 'md', inset = 0): ViewStyle {
  const wide = Math.max(0, LEAF[size].wide - inset);
  const tight = Math.max(0, LEAF[size].tight - inset);
  return {
    borderTopLeftRadius: wide,
    borderTopRightRadius: tight,
    borderBottomRightRadius: wide,
    borderBottomLeftRadius: tight,
    borderCurve: 'continuous',
  };
}

/** Only a leaf's top corners, for what heads a card (a photo, a stage), its foot meeting the rest. */
/**
 * The type scale: a screen picks a role, not a number. Albert Sans, as the web sets it, at the web's
 * sizes; figures in mono (`figure`).
 */
export const typeScale = {
  /** The one huge heading on a screen. */
  hero: { fontSize: 40, lineHeight: 44, fontWeight: '700', letterSpacing: -1.6 },
  /** The greeting, the sign-in headline — the web's `text-2xl font-bold tracking-tight`. */
  display: { fontSize: 28, lineHeight: 33, fontWeight: '700', letterSpacing: -0.7 },
  /** Section titles — the web's `text-lg font-semibold tracking-tight`. */
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: -0.35 },
  /** A card's name. */
  headline: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.15 },
  /** Running text, the web's `text-md`. */
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  /** Buttons, chips, field labels — `text-sm font-semibold`. */
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  /** Meta lines under a row, hints — `text-xs`. */
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
  /** The web's `text-label`: small, uppercase, tracked out. */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 1.15,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, TextStyle>;

/**
 * Figures — odometers, money, counts — in mono with tabular digits, as the web sets every number:
 * a reading that changes in place does not jitter, and a column of them lines up. Cascadia Mono, the
 * file the web loads too; `Mono` is a role, resolved to the right weight's file by `fonts.tsx`.
 */
export const figure: TextStyle = {
  fontFamily: 'Mono',
  fontVariant: ['tabular-nums'],
  letterSpacing: -0.3,
};

/**
 * The web's `shadow-float`: something floating over the page — the dock, a sheet, a dialog. Cards
 * stay flat (user asked): a shadow per card is a cost on every frame of a scroll on a cheap phone.
 */
export const lift = (theme: Theme) => ({
  shadowColor: theme.shadow,
  shadowOpacity: theme.dark ? 0.5 : 0.16,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 12 },
  elevation: 12,
});

/**
 * A floating surface's edge: in the dark a lit line along the top and a faint ring all round —
 * the web's dialog rim — and in daylight a hairline.
 */
export const rimmed = (theme: Theme) => ({
  borderWidth: 1,
  borderColor: theme.hairline,
  borderTopColor: theme.dark ? theme.rim : theme.hairline,
});

/**
 * A card on a detail page, flat: white by day; at night the resting card with a little of the page
 * through it. A hairline edges both.
 */
export const cardSurface = (theme: Theme) => ({
  backgroundColor: theme.dark ? `${theme.card}E8` : theme.cardRaised,
  borderColor: theme.hairline,
  borderWidth: StyleSheet.hairlineWidth,
});
