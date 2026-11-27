import { Ionicons } from '@expo/vector-icons';
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Glyph, useToneColors, type Tone } from '@/lib/instrument';
import { CountUp, PressableScale, Rise } from '@/lib/motion';
import { fitFigure } from '@/lib/format';
import { figure, rimmed, spacing, useTheme, leaf } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

/*
 * The dash: readings on tiles of their own along the top of one raised card, and under them what
 * needs doing next. The vehicle hero docks one over its stage; Home wears one for the whole garage.
 * One set of parts, so a figure, a label and a next-up line are the same size wherever they are.
 */

/** The health's dial, and so the height every figure on the dash keeps. */
export const DIAL = 24;

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** The dash's card: one raised surface, its corners clipping what is drawn on it. */
export function DashCard({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.dash, { backgroundColor: theme.cardRaised }, rimmed(theme), style]}>
      {children}
    </View>
  );
}

/** The readings' row: tiles of one width, a little of the card's white between and round them. */
export function DashReadings({ children }: { children: ReactNode }) {
  return <View style={styles.readings}>{children}</View>;
}

/** The width a reading's figure may take, measured by its row; `null` until it has been laid out. */
const Room = createContext<number | null>(null);

/**
 * Under a tile's label: the figure, and `beside` it whatever qualifies it (a unit, a spark), on the
 * dial's height. The row measures itself so the figure can be sized to what is left.
 */
export function DashReading({ children, beside }: { children: ReactNode; beside?: ReactNode }) {
  const [row, setRow] = useState<number | null>(null);
  const [side, setSide] = useState(0);
  const room = row === null ? null : row - (beside ? side + GAP : 0);
  return (
    <View style={styles.reading} onLayout={(event) => setRow(event.nativeEvent.layout.width)}>
      <Room.Provider value={room}>{children}</Room.Provider>
      {beside ? (
        <View onLayout={(event) => setSide(event.nativeEvent.layout.width)}>{beside}</View>
      ) : null}
    </View>
  );
}

const FIGURE = 17;
const FIGURE_NARROW = 15;
const GAP = 5;

/** A figure's unit beside it: KM, MI. */
export function DashUnit({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[figure, styles.unit, { color: theme.mutedForeground }]}>{children}</Text>;
}

/** A small line under a figure, in the same quiet caps: "1,240 H ENGINE". */
export function DashNote({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text numberOfLines={1} style={[figure, styles.unit, { color: theme.mutedForeground }]}>
      {children}
    </Text>
  );
}

/**
 * A reading's figure: the mono at semibold, one line that shrinks to its tile rather than
 * overflowing it — a six-figure odometer or a four-figure month still fits. With `count` it counts
 * up to its value as it arrives.
 */
export function DashValue({
  muted = false,
  narrow = false,
  count,
  children,
}: {
  muted?: boolean;
  narrow?: boolean;
  count?: { value: number; format: (value: number) => string };
  children?: ReactNode;
}) {
  const theme = useTheme();
  const room = useContext(Room);
  // Sized for the final figure, so a count-up does not change size on its way there.
  const final = count ? count.format(count.value) : typeof children === 'string' ? children : '';
  const size = narrow ? FIGURE_NARROW : FIGURE;
  const style = [
    figure,
    styles.figure,
    {
      fontSize: fitFigure(final, room, size),
      color: muted ? theme.mutedForeground : theme.foreground,
    },
  ];
  // Held at its own size whatever the phone's font setting: the tile's width is what bounds it.
  const fit = { numberOfLines: 1, maxFontSizeMultiplier: 1 } as const;
  if (count) {
    return <CountUp value={count.value} format={count.format} {...fit} style={style} />;
  }
  return (
    <Text {...fit} style={style}>
      {children}
    </Text>
  );
}

/**
 * A reading on the dash: on its own tile, its icon and word over its figure, and at the label's end
 * whatever qualifies it (`aside`). With `onPress` the whole tile is the way into its reading; each
 * rises into place in turn like the web's.
 */
export function DashCell({
  icon,
  label,
  basis,
  aside,
  said,
  index,
  hint,
  narrow = false,
  onPress,
  style,
  children,
}: {
  icon: IoniconName;
  label: string;
  /** Said after the label, in its figures: "SPENT · NOV". */
  basis?: string;
  aside?: ReactNode;
  /** The reading, as a screen reader says it. */
  said: string;
  index: number;
  hint?: string;
  narrow?: boolean;
  onPress?: () => void;
  /** The tile's own shape, where a card's corner asks for one. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Rise index={index} style={styles.cellSlot}>
      <PressableScale
        onPress={
          onPress
            ? () => {
                onPress();
              }
            : undefined
        }
        disabled={!onPress}
        accessible
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={said}
        accessibilityHint={onPress ? hint : undefined}
        scaleTo={0.96}
        style={[
          styles.cell,
          narrow ? styles.cellNarrow : null,
          { backgroundColor: theme.muted },
          style,
        ]}
      >
        <View style={styles.labelRow}>
          <Ionicons name={icon} size={11} color={theme.mutedForeground} />
          <Text numberOfLines={1} style={[styles.label, { color: theme.mutedForeground }]}>
            {label.toUpperCase()}
            {basis ? <Text style={[figure, styles.label]}> · {basis.toUpperCase()}</Text> : null}
          </Text>
          {aside ? <View style={styles.aside}>{aside}</View> : null}
        </View>
        {children}
      </PressableScale>
    </Rise>
  );
}

/** Two small readings stacked in one tile's place, splitting its height: health over fuel. */
export function DashStack({ children }: { children: ReactNode }) {
  return <View style={styles.stack}>{children}</View>;
}

/**
 * A small reading on one line, for a `DashStack`: its mark (a dial, a glyph), the figure, then
 * its word in the label's caps — "◔ 82 HEALTH". `value` undefined is still loading.
 */
export function DashMini({
  lead,
  value,
  word,
  muted = false,
  said,
  index,
  hint,
  narrow = false,
  onPress,
}: {
  lead: ReactNode;
  value: string | undefined;
  word: string;
  muted?: boolean;
  said: string;
  index: number;
  hint?: string;
  narrow?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Rise index={index} style={styles.miniSlot}>
      <PressableScale
        onPress={
          onPress
            ? () => {
                onPress();
              }
            : undefined
        }
        disabled={!onPress}
        accessible
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={said}
        accessibilityHint={onPress ? hint : undefined}
        scaleTo={0.96}
        style={[styles.mini, narrow ? styles.cellNarrow : null, { backgroundColor: theme.muted }]}
      >
        {lead}
        {value === undefined ? (
          <Skeleton width={22} height={12} />
        ) : (
          <Text
            numberOfLines={1}
            style={[
              figure,
              styles.miniFigure,
              { color: muted ? theme.mutedForeground : theme.foreground },
            ]}
          >
            {value}
          </Text>
        )}
        <Text
          numberOfLines={1}
          style={[figure, styles.unit, styles.miniWord, { color: theme.mutedForeground }]}
        >
          {word.toUpperCase()}
        </Text>
      </PressableScale>
    </Rise>
  );
}

/** A tile before its reading arrives: the label as real text, only the figure waiting. */
export function DashCellSkeleton({
  label,
  width = 44,
  style,
}: {
  label: string;
  width?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.cellSlot, styles.cell, { backgroundColor: theme.muted }, style]}>
      <Text style={[styles.label, { color: theme.mutedForeground }]}>{label.toUpperCase()}</Text>
      <View style={styles.reading}>
        <Skeleton width={width} height={16} />
      </View>
    </View>
  );
}

/** A small figure on a wash, for a tile's `aside` or a row's status: "+$120", "−4 mo". */
export function DashTag({
  children,
  color,
  wash,
}: {
  children: ReactNode;
  color: string;
  wash: string;
}) {
  return (
    <View style={[styles.tag, { backgroundColor: wash }]}>
      <Text numberOfLines={1} style={[figure, styles.tagText, { color }]}>
        {children}
      </Text>
    </View>
  );
}

/** The rows under the readings, pulled up into the tiles' margin so their air is even. */
export function DashRows({ children }: { children: ReactNode }) {
  return <View style={styles.rows}>{children}</View>;
}

/**
 * What needs doing next, under the readings: its glyph, what it is — and, where several vehicles
 * share the dash, whose — and how it stands as a status in its tone. On the dash's own ground: the
 * status carries the tone, not a wash across the row. `trailing` is the way on: a chevron by
 * default, or the one thing to do about it.
 */
export function DashRow({
  emoji,
  title,
  whose,
  status,
  tone,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  trailing,
  index = 5,
  divided = false,
}: {
  emoji: ReactNode;
  title: string;
  whose?: string;
  status?: string;
  tone: Tone;
  onPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  trailing?: ReactNode;
  index?: number;
  /** A hairline over it, when it follows another row. */
  divided?: boolean;
}) {
  const theme = useTheme();
  const { strong } = useToneColors(tone);
  const quiet = tone === 'neutral';
  const ink = quiet ? theme.mutedForeground : strong;
  return (
    <Rise index={index}>
      {divided ? <View style={[styles.rowRule, { backgroundColor: theme.border }]} /> : null}
      <View style={styles.row}>
        <PressableScale
          onPress={
            onPress
              ? () => {
                  onPress();
                }
              : undefined
          }
          disabled={!onPress}
          accessible
          accessibilityRole={onPress ? 'button' : 'text'}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={onPress ? accessibilityHint : undefined}
          scaleTo={0.98}
          style={styles.rowOpen}
        >
          {/* One width for every glyph, so the words start on one line whatever the art. */}
          <View style={styles.glyph}>
            {typeof emoji === 'string' ? <Glyph size={18}>{emoji}</Glyph> : emoji}
          </View>
          <View style={styles.rowWords}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.foreground }]}>
              {title}
            </Text>
            {whose ? (
              <Text numberOfLines={1} style={[styles.rowWhose, { color: theme.mutedForeground }]}>
                {whose}
              </Text>
            ) : null}
          </View>
          {status ? (
            <View style={[styles.status, { backgroundColor: quiet ? theme.muted : `${ink}1F` }]}>
              <Text numberOfLines={1} style={[styles.statusText, { color: ink }]}>
                {status}
              </Text>
            </View>
          ) : null}
          {trailing === undefined ? (
            <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} />
          ) : null}
        </PressableScale>
        {trailing ?? null}
      </View>
    </Rise>
  );
}

/** The one thing to do about a row, as a small round key at its end: log it, renew it, check it. */
export function DashAction({
  icon,
  label,
  onPress,
  quiet = false,
}: {
  icon: IoniconName;
  /** Said, never shown: the key is only its icon. */
  label: string;
  onPress: () => void;
  /** On the card's muted ground rather than copper's wash: the way to plan, when nothing is due. */
  quiet?: boolean;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={() => {
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      scaleTo={0.9}
      style={[styles.action, { backgroundColor: quiet ? theme.muted : theme.primarySoft }]}
    >
      <Ionicons name={icon} size={14} color={quiet ? theme.foreground : theme.primary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  dash: { ...leaf('lg'), overflow: 'hidden' },
  readings: { flexDirection: 'row', gap: 6, padding: 6 },
  cellSlot: { flex: 1, minWidth: 0 },
  cell: {
    flexGrow: 1,
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 10,
    // A small leaf of its own inside the card's: the same silhouette, a size down.
    ...leaf('sm'),
  },
  cellNarrow: { paddingHorizontal: 8 },
  stack: { flex: 1, minWidth: 0, gap: 6 },
  miniSlot: { flex: 1 },
  mini: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 4,
    ...leaf('sm'),
  },
  miniFigure: {
    flexShrink: 0,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  miniWord: { flexShrink: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { flexShrink: 1, fontSize: 7.5, lineHeight: 10, fontWeight: '600', letterSpacing: 0.15 },
  // Taller than the label, so it hangs over the line rather than pushing the figure down.
  aside: { marginLeft: 'auto', flexShrink: 0, marginVertical: -2 },
  // Every figure keeps the dial's height, so the three sit on one line.
  reading: { height: DIAL, flexDirection: 'row', alignItems: 'center', gap: GAP },
  unit: { fontSize: 8, lineHeight: 10, fontWeight: '600', letterSpacing: 0.15 },
  // The web's figure: its mono at semibold, untracked.
  figure: { flexShrink: 1, fontSize: FIGURE, lineHeight: 22, fontWeight: '600', letterSpacing: 0 },
  tag: { height: 14, justifyContent: 'center', paddingHorizontal: 4, borderRadius: 4 },
  tagText: { fontSize: 8.5, lineHeight: 11, fontWeight: '700', letterSpacing: 0 },
  rows: { marginTop: -2, paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: 12,
  },
  rowRule: { height: StyleSheet.hairlineWidth, marginLeft: 40, marginRight: 14 },
  glyph: { width: 18, alignItems: 'center', overflow: 'visible' },
  rowOpen: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    paddingLeft: 14,
  },
  // The title first: whose it is gives way before what it is does.
  rowWords: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  rowTitle: { flexShrink: 1, fontSize: 13.5, lineHeight: 18, fontWeight: '600' },
  /*
   * The room the title leaves, but never less than a few letters: on a small phone a clipped
   * single letter reads as a fault, "Dail…" as a name cut short.
   */
  rowWhose: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 40,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  // Its whole width before the title gives way: how late it is is never the part cut.
  status: {
    flexShrink: 0,
    maxWidth: '55%',
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: 7,
    borderRadius: 6,
  },
  statusText: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  action: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
