import { Ionicons } from '@expo/vector-icons';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { minorUnitExponent, type EventType } from '@vehicle-os/domain';
import type { MonthGroup } from '@vehicle-os/ui';
import { eventEmoji } from '@/lib/emoji';
import { formatMoney, humanise } from '@/lib/format';
import { Glyph } from '@/lib/instrument';
import { haptic, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { figure, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';

/*
 * The logbook, as one set of parts — the web's `components/timeline`, piece for piece, so an entry
 * looks the same on the phone as on the web, and the same on Home as on a vehicle's Logs.
 *
 * Months are chapters, each under a desk-calendar leaf with its band in copper. Down the left runs
 * the rail, a dashed line — a road through the month — with a leaf for each day's first entry and
 * a quieter stop for the rest of that day. Beside it the entry's card, every card in the same
 * order: the kind's glyph in its corner, the kind and title with what it cost, then its note and
 * the facts it records — so a column of them reads like a ledger.
 */

type Money = { amountMinor: number; currency: string };
type Dated = { readonly occurredAt: string; readonly cost: Money | null };

/*
 * The geometry, compact: a phone's logbook is read in a column a thumb wide, so the rail, the
 * leaves and the cards are drawn small and close, and the record shows more entries a screen.
 */
/** The rail's column: a leaf is 34 wide, centred in it. */
export const RAIL = 38;
const LEAF = 34;
const GAP = spacing.sm;
/** Space under each row; the road runs on through it to the next. */
const ROW_GAP = spacing.sm;
const CARD_PAD = 10;
/** The entry's glyph tile, and where its middle falls from the top of the row. */
const ICON = 32;
// The card's 1pt rim, its padding, then half the tile.
const GLYPH_MID = 1 + CARD_PAD + ICON / 2;
const STOP = 9;

const MONTH_ABBR = new Intl.DateTimeFormat('en-US', { month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const pad = (value: number) => String(value).padStart(2, '0');

/** Whether the entry at `index` is the first of its day — the one that hangs the day's leaf. */
export function startsDay(items: readonly { occurredAt: string }[], index: number): boolean {
  return (
    index === 0 ||
    new Date(items[index - 1]!.occurredAt).toDateString() !==
      new Date(items[index]!.occurredAt).toDateString()
  );
}

/** The month's spend, when every cost in it shares a currency; null with none, or a mix. */
function monthTotal(items: readonly Dated[]): string | null {
  const costs = items.flatMap((item) => (item.cost ? [item.cost] : []));
  if (costs.length === 0) return null;
  const currency = costs[0]!.currency;
  if (costs.some((cost) => cost.currency !== currency)) return null;
  return formatMoney({
    amountMinor: costs.reduce((sum, cost) => sum + cost.amountMinor, 0),
    currency,
  });
}

/**
 * A desk-calendar leaf: a band on top, a figure under it. Copper for a month — a landmark down a
 * long record — and a quiet band for a day.
 */
function Leaf({
  band,
  figure: value,
  brand = false,
  large = false,
}: {
  band: string;
  figure: string;
  brand?: boolean;
  large?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.leaf, { backgroundColor: theme.cardRaised, borderColor: theme.border }]}>
      <Text
        style={[
          styles.leafBand,
          brand
            ? { backgroundColor: theme.primary, color: theme.primaryForeground }
            : { backgroundColor: theme.muted, color: theme.mutedForeground },
        ]}
      >
        {band.toUpperCase()}
      </Text>
      <Text style={[figure, large ? styles.leafDay : styles.leafYear, { color: theme.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

/**
 * A month's chapter heading: on the rail, the month's own copper leaf; beside it a rule and what
 * the month cost. The leaf already says the month, so its name is said only to a screen reader.
 */
export function MonthHeading({ group }: { group: MonthGroup<Dated> }) {
  const theme = useTheme();
  const [year, month] = group.key.split('-').map(Number) as [number, number];
  const total = monthTotal(group.items);
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${group.label}${total ? `, spent ${total}` : ''}`}
      style={styles.month}
    >
      <View style={styles.railCell}>
        <Leaf band={MONTH_ABBR.format(new Date(year, month - 1, 1))} figure={String(year)} brand />
      </View>
      <View style={[styles.monthRule, { backgroundColor: theme.border }]} />
      {total ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.monthLabel, { color: theme.mutedForeground }]}>SPENT</Text>
          <Text style={[figure, styles.monthTotal, { color: theme.foreground }]}>{total}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One line of the logbook: the day on the rail, the entry (`children`) beside it. `last` is the
 * month's last entry, where the road stops rather than trailing off below the chapter.
 */
export function TimelineRow({
  occurredAt,
  firstOfDay,
  last,
  index,
  children,
}: {
  occurredAt: string;
  firstOfDay: boolean;
  last: boolean;
  /** Position in its month, for the entrance stagger. */
  index: number;
  children: ReactNode;
}) {
  const theme = useTheme();
  const date = new Date(occurredAt);
  return (
    <Rise index={index} style={styles.row}>
      <View
        style={styles.railCell}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Road color={theme.borderStrong} stopAt={last ? GLYPH_MID + 1 : null} />
        {firstOfDay ? (
          // A ring of the page's colour round the leaf, so the road breaks for it.
          <View
            style={{ borderRadius: 12, borderWidth: 3, borderColor: theme.background, margin: -3 }}
          >
            <Leaf band={WEEKDAY.format(date)} figure={pad(date.getDate())} large />
          </View>
        ) : (
          // Level with the middle of the card's glyph.
          <View
            style={[
              styles.stop,
              { borderColor: theme.borderStrong, backgroundColor: theme.background },
            ]}
          />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </Rise>
  );
}

/** The road: a dashed line down the rail — six on, six off — to the next row or to a stop. */
export function Road({ color, stopAt }: { color: string; stopAt: number | null }) {
  return (
    <Svg
      pointerEvents="none"
      style={[styles.road, stopAt === null ? { bottom: -ROW_GAP } : { height: stopAt }]}
    >
      <Line x1={1} y1={0} x2={1} y2="100%" stroke={color} strokeWidth={2} strokeDasharray="6 6" />
    </Svg>
  );
}

/** The card's press, shared with its glyph: pressing an entry tips its stamp, as hovering does on the web. */
const Tip = createContext<Animated.Value | null>(null);

/**
 * The entry's surface: its parts stacked at one rhythm, giving a little under the thumb. With
 * `onPress`, the whole card opens the entry.
 */
export function EntryCard({
  onPress,
  accessibilityLabel,
  accessibilityHint,
  children,
}: {
  onPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [tip] = useState(() => new Animated.Value(0));
  const to = (value: 0 | 1) =>
    reduce
      ? tip.setValue(value)
      : Animated.spring(tip, {
          toValue: value,
          useNativeDriver: true,
          speed: 30,
          bounciness: value ? 4 : 10,
        }).start();

  return (
    <Tip.Provider value={tip}>
      <PressableScale
        onPress={
          onPress
            ? () => {
                haptic.selection();
                onPress();
              }
            : undefined
        }
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        scaleTo={0.985}
        style={[styles.card, { backgroundColor: theme.card }, rimmed(theme)]}
      >
        {children}
      </PressableScale>
    </Tip.Provider>
  );
}

/** The entry's kind as its glyph on a tile — the web's `KindIcon`, tipping when its card is pressed. */
export function KindIcon({
  emoji,
  size = ICON,
  tint,
}: {
  emoji: string;
  size?: number;
  /** The tile's fill, when a state (waiting, failed) colours it. */
  tint?: string;
}) {
  const theme = useTheme();
  const tip = useContext(Tip);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.36),
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tint ?? theme.muted,
        },
        tip
          ? {
              transform: [
                { rotate: tip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-6deg'] }) },
                { scale: tip.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) },
              ],
            }
          : null,
      ]}
    >
      <Glyph size={Math.round(size * 0.59)}>{emoji}</Glyph>
    </Animated.View>
  );
}

/**
 * An entry's head, always in the same order so a column of cards lines up: the glyph in the
 * corner; beside it the kind — the one bold word on the card, in mono — over the title, with what
 * it cost level with them; then the rest (`children`: note, facts) in the same column. A title
 * that only repeats the kind ("Fuel", filed under Fuel) is left out.
 */
export function EntryHead({
  eventType,
  title,
  cost,
  tint,
  children,
}: {
  eventType: EventType;
  title: string;
  cost: Money | null;
  tint?: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const kind = humanise(eventType);
  const titled = title.trim() !== '' && title.trim().toLowerCase() !== kind.toLowerCase();
  return (
    <View style={styles.head}>
      <KindIcon emoji={eventEmoji(eventType)} tint={tint} />
      <View style={styles.headBody}>
        <View style={styles.headTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[figure, styles.kind, { color: theme.foreground }]}>
              {kind.toUpperCase()}
            </Text>
            {titled ? (
              <Text numberOfLines={1} style={[styles.title, { color: theme.foreground }]}>
                {title}
              </Text>
            ) : null}
          </View>
          {cost ? <Amount money={cost} /> : null}
        </View>
        {children}
      </View>
    </View>
  );
}

/** The foot of an entry: its `Fact`s as a row of badges. */
export function Facts({ children }: { children: ReactNode }) {
  return <View style={styles.facts}>{children}</View>;
}

/** One thing an entry records — a reading, who did it, which vehicle — as a badge: glyph, value. */
export function Fact({
  icon,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.fact, { backgroundColor: theme.muted }]}>
      <Ionicons name={icon} size={11} color={theme.mutedForeground} />
      <Text style={[styles.small, { flexShrink: 1, color: theme.mutedForeground }]}>
        {children}
      </Text>
    </View>
  );
}

/** The note in one line, under the title. */
export function NotePreview({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.note}>
      <Ionicons name="document-text-outline" size={11} color={theme.mutedForeground} />
      <Text numberOfLines={1} style={[styles.small, { flex: 1, color: theme.mutedForeground }]}>
        {text}
      </Text>
    </View>
  );
}

const amountFormats = new Map<string, Intl.NumberFormat>();

/**
 * Money set as a figure, as the web sets it: the whole units at reading size, the symbol and the
 * cents smaller and quieter — the part the eye compares down a list first, then the change.
 */
export function Amount({ money, large = false }: { money: Money; large?: boolean }) {
  const theme = useTheme();
  let format = amountFormats.get(money.currency);
  if (!format) {
    format = new Intl.NumberFormat('en-US', { style: 'currency', currency: money.currency });
    amountFormats.set(money.currency, format);
  }
  const value = money.amountMinor / 10 ** minorUnitExponent(money.currency);
  // ponytail: an engine without `formatToParts` sets the whole amount at one size.
  const parts =
    typeof format.formatToParts === 'function'
      ? format.formatToParts(value)
      : [{ type: 'integer', value: format.format(value) }];
  return (
    <Text accessibilityLabel={formatMoney(money)} style={{ flexShrink: 0 }}>
      {parts.map((part, index) =>
        part.type === 'integer' || part.type === 'group' ? (
          <Text
            key={index}
            style={[
              figure,
              large ? styles.amountLarge : styles.amount,
              { color: theme.foreground },
            ]}
          >
            {part.value}
          </Text>
        ) : (
          <Text
            key={index}
            style={[
              figure,
              large ? styles.amountSmallLarge : styles.amountSmall,
              { color: theme.mutedForeground },
            ]}
          >
            {part.value}
          </Text>
        ),
      )}
    </Text>
  );
}

const QUANTITY = /^\s*(\d[\d.,]*\s?(?:l|kwh|gal))\b[\s,;·—-]*/i;

/**
 * A fill's quantity from the front of its note — where the quick entry puts it — and what is left
 * of the note: the web's `fillQuantity`, so "40 L" stands as a fact on both.
 */
export function fillQuantity(eventType: EventType, note: string | null) {
  const match = eventType === 'FUEL' || eventType === 'CHARGE' ? QUANTITY.exec(note ?? '') : null;
  return match
    ? { quantity: match[1]!.replace(/kwh$/i, 'kWh'), rest: note!.slice(match[0].length).trim() }
    : { quantity: null, rest: note?.trim() ?? '' };
}

const styles = StyleSheet.create({
  railCell: { width: RAIL, alignItems: 'center' },
  leaf: {
    width: LEAF,
    overflow: 'hidden',
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'stretch',
  },
  leafBand: {
    ...typeScale.overline,
    fontSize: 8,
    lineHeight: 13,
    letterSpacing: 0.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  leafDay: { fontSize: 14, lineHeight: 19, fontWeight: '600', textAlign: 'center' },
  leafYear: { fontSize: 9.5, lineHeight: 16, fontWeight: '600', textAlign: 'center' },
  month: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
  },
  monthRule: { flex: 1, minWidth: 16, height: StyleSheet.hairlineWidth },
  monthLabel: { fontSize: 8.5, lineHeight: 11, fontWeight: '600', letterSpacing: 0.9 },
  monthTotal: { fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  row: { flexDirection: 'row', gap: GAP, paddingBottom: ROW_GAP },
  road: { position: 'absolute', top: 0, width: 2 },
  stop: {
    marginTop: GLYPH_MID - STOP / 2,
    width: STOP,
    height: STOP,
    borderRadius: STOP / 2,
    borderWidth: 2,
  },
  card: { borderRadius: radius.xl, padding: CARD_PAD, gap: spacing.sm },
  head: { flexDirection: 'row', gap: 10 },
  headBody: { flex: 1, minWidth: 0, gap: 6 },
  headTop: { minHeight: ICON, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kind: { fontSize: 10, lineHeight: 13, fontWeight: '700', letterSpacing: 0.7 },
  title: { fontSize: 13, lineHeight: 17, fontWeight: '400', marginTop: 1 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  fact: {
    minHeight: 20,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  small: { fontSize: 11, lineHeight: 14 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  amount: { fontSize: 15, lineHeight: 19, fontWeight: '500', letterSpacing: -0.3 },
  amountSmall: { fontSize: 10.5, lineHeight: 19, fontWeight: '500' },
  amountLarge: { fontSize: 24, lineHeight: 28, fontWeight: '600', letterSpacing: -0.6 },
  amountSmallLarge: { fontSize: 14, lineHeight: 28, fontWeight: '500' },
});
