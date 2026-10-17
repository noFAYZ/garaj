import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { EventType } from '@vehicle-os/domain';
import type { MonthGroup } from '@vehicle-os/ui';
import { eventEmoji } from '@/lib/emoji';
import Svg, { Circle } from 'react-native-svg';
import { formatMoney, humanise } from '@/lib/format';
import { Glyph } from '@/lib/instrument';
import { monthSpend, type Dated } from '@/lib/ledger';
import { ease, haptic, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { figure, spacing, useTheme } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

/*
 * The logbook, as a ledger — the admin console's vehicle Logbook, made the phone's own: each day a
 * calendar badge at the left, its entries' glyphs beside it — joined by a short road when the day
 * has several, standing apart otherwise — then two tight lines, what it was and what it cost, its
 * kind and what else it records; figures flush right in the mono the web uses, cents small, so a
 * column of them reads like a ledger. Months head their days with what they spent.
 *
 * Home's recent activity and a vehicle's Logs are the same parts, so an entry looks the same
 * wherever it is read.
 */

type Money = { amountMinor: number; currency: string };

/** The day's column, at the row's left edge. */
const DAY = 30;
/** The rail's column; the glyph is centred in it, on a ground that breaks the road round it. */
const RAIL = 34;
const RING = 34;
/**
 * Between a row's columns. The glyph is 22 in its 34, so its own 6 each side and this make the
 * day → glyph and glyph → title gaps the same 10: one rhythm across the row.
 */
const COLUMN_GAP = 4;
const LINE = 1.5;
/** The ring's top inside its row, and so where its middle falls. */
const RING_TOP = 16;
const RING_MID = RING_TOP + RING / 2;
/** Rows reach past the page's gutter by this much, so a pressed row's wash has room round it. */
const BLEED = spacing.sm;

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short' });

/**
 * What the ledger is drawn on, when it is not the page: a month's node and the road's end are cut
 * out of the road in this colour.
 */
export const LedgerSurface = createContext<string | null>(null);

/** The road down the rail column, above and below what sits on it. */
function Segments({
  top,
  bottom,
  mid,
  draw,
}: {
  /** Drawn from the row above down to `mid`. */
  top: boolean;
  /** Drawn from `mid` to the row below. */
  bottom: boolean;
  mid: number;
  /** 0–1: the bottom stretch drawing itself down, as the row arrives. */
  draw?: Animated.Value;
}) {
  const theme = useTheme();
  return (
    <>
      {top ? (
        <View style={[styles.segment, { top: 0, height: mid, backgroundColor: theme.muted }]} />
      ) : null}
      {bottom ? (
        <Animated.View
          style={[
            styles.segment,
            styles.down,
            { top: mid, bottom: 0, backgroundColor: theme.muted },
            draw ? { transform: [{ scaleY: draw }] } : null,
          ]}
        />
      ) : null}
    </>
  );
}

/**
 * A month's heading: a slim strip the sheet's full width between one month's stretch of road and
 * the next — the month in small tracked capitals with its year quieter, and what it cost as a small
 * badge at the right. A section's name, not an entry, so nothing of the road crosses it.
 */
export function LedgerMonth({ group }: { group: MonthGroup<Dated> }) {
  const theme = useTheme();
  const surface = useContext(LedgerSurface) ?? theme.background;
  const [year, month] = group.key.split('-').map(Number) as [number, number];
  const total = monthSpend(group.items);

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${group.label}${total ? `, spent ${formatMoney(total)}` : ''}`}
      style={[styles.month, { backgroundColor: theme.muted }]}
    >
      <Text numberOfLines={1} style={[styles.monthName, { color: theme.foreground }]}>
        {MONTH.format(new Date(year, month - 1, 1)).toUpperCase()}
        {/* Its own weight: the font patch dresses each Text alone. */}
        <Text style={[styles.monthYear, { color: theme.mutedForeground }]}> {year}</Text>
      </Text>
      {total ? (
        <View style={[styles.stamp, { backgroundColor: surface }]}>
          <Text style={[figure, styles.stampText, { color: theme.mutedForeground }]}>
            {formatMoney(total, true)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The ring's press, shared with its row: pressing an entry tips its glyph. */
const Tip = createContext<Animated.Value | null>(null);

type Hue =
  'chartRefuel' | 'chartService' | 'chartExpense' | 'chartTrip' | 'primary' | 'destructive';

/**
 * The colour an entry's kind wears: the report group it spends under, as its chart hue — a
 * fill-up is the orange its column is in Stats, a service the blue — copper for owning it (bought,
 * sold, valued), red for an accident. Notes and papers stay neutral.
 */
const HUE: Partial<Record<EventType, Hue>> = {
  PURCHASE: 'primary',
  SALE: 'primary',
  VALUATION: 'primary',
  ACCIDENT: 'destructive',
  CONDITION_CHECK: 'chartService',
  FUEL: 'chartRefuel',
  CHARGE: 'chartRefuel',
  MAINTENANCE: 'chartService',
  REPAIR: 'chartService',
  INSPECTION: 'chartService',
  CLEANING: 'chartService',
  PART_INSTALLED: 'chartService',
  PART_REMOVED: 'chartService',
  INSURANCE: 'chartExpense',
  REGISTRATION: 'chartExpense',
  MODIFICATION: 'chartExpense',
  EXPENSE: 'chartExpense',
  TRIP: 'chartTrip',
};

/** The colour an entry's kind wears, as a theme key; none for the neutral kinds. */
export const kindHue = (eventType: EventType): Hue | undefined => HUE[eventType];

/** The kind as its badge says it: the filter's word, the long ones cut to what is read. */
const KIND_LABEL: Partial<Record<EventType, string>> = {
  PART_INSTALLED: 'Part',
  PART_REMOVED: 'Part out',
  CONDITION_CHECK: 'Condition',
  DOCUMENT_ADDED: 'Document',
};

/**
 * `$1,059.80` → `$1,059` and `.80`; a currency without cents keeps all of it whole, and so does a
 * whole amount — `$34`, not `$34.00` (user asked): the cents are said only when there are some.
 */
export function splitCents(money: Money): [string, string] {
  const full = formatMoney(money);
  const match = /^(.*\d)(\.\d+)(\D*)$/.exec(full);
  if (!match) return [full, ''];
  return /^\.0+$/.test(match[2]!)
    ? [`${match[1]}${match[3]}`, '']
    : [match[1]!, `${match[2]}${match[3]}`];
}

/** Two instants on the same calendar day, in the phone's own zone. */
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * One entry on the road: its day as a calendar badge at the left edge, the kind's glyph on the
 * road, then what it was over its kind's badge and the place; flush right,
 * what it cost over what went in and how far it had come since the reading before. The mark wears
 * the kind's glyph on its report hue. The reading itself and the note are the entry's own
 * screen's; the whole row opens it, a wash under the thumb.
 *
 * `state` is for an entry still on this phone: a dashed amber ring while it waits for signal, a
 * red one if the server refused it — the row's `children` say which and offer the way out.
 */
export function LedgerRow({
  eventType,
  title,
  occurredAt,
  previousAt,
  nextAt,
  meta,
  cost,
  aside,
  trail,
  change,
  state,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  index,
  children,
}: {
  eventType: EventType;
  title: string;
  /** When it happened: the day badge at the row's left. */
  occurredAt: string;
  /**
   * When the rows above and below in its month happened. A day with several entries wears one
   * badge, on its first, and only its own entries are joined by the road: days stand apart.
   */
  previousAt?: string;
  nextAt?: string;
  meta: readonly (string | null | false | undefined)[];
  cost: Money | null;
  /** Said in the cost's place when there is none: a trip's distance. */
  aside?: string | null;
  /** Under the cost, quieter: what went in. */
  trail?: readonly (string | null | false | undefined)[];
  /** The odometer since the reading before, signed: a rise in green, a drop in red. */
  change?: { text: string; up: boolean } | null;
  state?: 'waiting' | 'failed';
  onPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Position on the page, for the entrance stagger. */
  index: number;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [tip] = useState(() => new Animated.Value(0));
  const [draw] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const [pressed, setPressed] = useState(false);
  const rest = meta.filter(Boolean).join(' · ');
  const leadsDay = !previousAt || !sameDay(previousAt, occurredAt);
  const endsDay = !nextAt || !sameDay(occurredAt, nextAt);
  const [whole, cents] = cost ? splitCents(cost) : ['', ''];
  const under = (trail ?? []).filter((part): part is string => Boolean(part));

  useEffect(() => {
    if (reduce) return;
    const animation = Animated.timing(draw, {
      toValue: 1,
      duration: 320,
      delay: 120 + Math.min(index, 10) * 40,
      easing: ease.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [draw, index, reduce]);

  const press = (down: boolean) => {
    setPressed(down);
    if (reduce) return tip.setValue(down ? 1 : 0);
    Animated.spring(tip, {
      toValue: down ? 1 : 0,
      useNativeDriver: true,
      speed: 30,
      bounciness: down ? 4 : 12,
    }).start();
  };

  return (
    <Rise index={Math.min(index, 8)}>
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
          onPressIn={() => press(true)}
          onPressOut={() => press(false)}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : 'text'}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          scaleTo={0.985}
          style={[styles.row, pressed ? { backgroundColor: `${theme.muted}B3` } : null]}
        >
          {leadsDay ? <DayBadge occurredAt={occurredAt} /> : <View style={styles.dayColumn} />}
          <View
            style={styles.rail}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Segments top={!leadsDay} bottom={!endsDay} mid={RING_MID} draw={draw} />
            <Ring eventType={eventType} state={state} />
          </View>
          <View style={styles.body}>
            <View style={styles.columns}>
              <View style={styles.left}>
                <Text numberOfLines={1} style={[styles.title, { color: theme.foreground }]}>
                  {title}
                </Text>
                <View style={styles.facts}>
                  <KindBadge eventType={eventType} />
                  {rest ? (
                    <Text numberOfLines={1} style={[styles.meta, { color: theme.mutedForeground }]}>
                      {rest}
                    </Text>
                  ) : null}
                </View>
              </View>
              {/*
               * The figures, flush right as the web's entries stack them: the cost, set as the
               * web's `Amount` sets it, then what went in and how far it has come since the
               * reading before, in green — or red where the reading went down.
               */}
              <View style={styles.right}>
                {cost ? (
                  /*
                   * The web's mono, semibold; the cents a second figure beside it, smaller and
                   * quieter. Side by side rather than nested, so the units are exactly the figure
                   * they were — a nested text can be dressed differently on a phone.
                   */
                  <View style={styles.amount}>
                    <Text style={[figure, styles.cost, { color: theme.foreground }]}>{whole}</Text>
                    {cents ? (
                      <Text style={[figure, styles.cents, { color: theme.mutedForeground }]}>
                        {cents}
                      </Text>
                    ) : null}
                  </View>
                ) : aside ? (
                  <Text
                    style={[figure, styles.cost, styles.aside, { color: theme.mutedForeground }]}
                  >
                    {aside}
                  </Text>
                ) : null}
                {under.length > 0 || change ? (
                  <View style={styles.trailRow}>
                    {/* Each figure apart, a dot between: mono spaces would spread a line wide. */}
                    {under.map((part, place) => (
                      <View key={place} style={styles.trailRow}>
                        {place > 0 ? (
                          <View
                            style={[styles.trailDot, { backgroundColor: theme.borderStrong }]}
                          />
                        ) : null}
                        <Text style={[figure, styles.trail, { color: theme.mutedForeground }]}>
                          {part}
                        </Text>
                      </View>
                    ))}
                    {change ? (
                      <View style={styles.trailRow}>
                        {under.length > 0 ? (
                          <View
                            style={[styles.trailDot, { backgroundColor: theme.borderStrong }]}
                          />
                        ) : null}
                        <Text
                          style={[
                            figure,
                            styles.change,
                            { color: change.up ? theme.success : theme.destructive },
                          ]}
                        >
                          {change.text}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
            {children}
          </View>
        </PressableScale>
      </Tip.Provider>
    </Rise>
  );
}

/**
 * An entry's kind as its glyph alone — no colour behind it (user asked): the Fluent art carries the
 * kind. On the road it sits in a disc of the ledger's own ground, so the road breaks round it rather
 * than running through; elsewhere it floats. A state still rings it: waiting amber and dashed,
 * refused red. The road wears it small; an entry's own screen wears it large.
 */
export function KindDisc({
  eventType,
  size = RING,
  state,
  ground = 'transparent',
  style,
}: {
  eventType: EventType;
  size?: number;
  state?: 'waiting' | 'failed';
  /** What it is cut out of: the surface under the road. */
  ground?: string;
  style?: ComponentProps<typeof Animated.View>['style'];
}) {
  const theme = useTheme();
  const edge = state === 'failed' ? theme.destructive : state === 'waiting' ? theme.warning : null;
  const r = size / 2;
  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: r,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: ground,
        },
        style,
      ]}
    >
      {edge ? (
        <Svg style={StyleSheet.absoluteFill} width={size} height={size}>
          <Circle
            cx={r}
            cy={r}
            r={r - 0.75}
            fill="none"
            stroke={edge}
            strokeWidth={1.5}
            strokeDasharray={state === 'waiting' ? '3 2.5' : undefined}
          />
        </Svg>
      ) : null}
      <Glyph size={Math.round(size * 0.66)}>{eventEmoji(eventType)}</Glyph>
    </Animated.View>
  );
}

/**
 * The day an entry happened, as a tear-off calendar: the month small over the day's number in the
 * figures' mono, inside a hairline tile — no fill, as the glyphs beside it have none. Today's is the
 * primary's, so the newest entries find themselves.
 */
function DayBadge({ occurredAt }: { occurredAt: string }) {
  const theme = useTheme();
  const date = new Date(occurredAt);
  const today = date.toDateString() === new Date().toDateString();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.day, { borderColor: today ? `${theme.primary}73` : theme.border }]}
    >
      <Text style={[styles.dayMonth, { color: today ? theme.primary : theme.mutedForeground }]}>
        {MONTH.format(date).toUpperCase()}
      </Text>
      <Text style={[figure, styles.dayNumber, { color: today ? theme.primary : theme.foreground }]}>
        {date.getDate()}
      </Text>
    </View>
  );
}

/** The glyph on the road, in its row's rail; pressing the row tips it. */
function Ring({ eventType, state }: { eventType: EventType; state?: 'waiting' | 'failed' }) {
  const theme = useTheme();
  const tip = useContext(Tip);
  return (
    <KindDisc
      eventType={eventType}
      state={state}
      ground={useContext(LedgerSurface) ?? theme.background}
      style={[
        styles.ring,
        tip
          ? {
              transform: [
                { rotate: tip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-9deg'] }) },
                { scale: tip.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
              ],
            }
          : null,
      ]}
    />
  );
}

/**
 * The kind, as a badge at the head of the second line: a dot of its hue and its name in small
 * tracked capitals, on a wash of the same hue. The words stay in ink — the hue is only the dot
 * and the wash — so the badge reads in both themes at any hue.
 */
export function KindBadge({ eventType }: { eventType: EventType }) {
  const theme = useTheme();
  const hue = HUE[eventType];
  const tint = hue ? theme[hue] : null;
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: tint ? `${tint}1F` : theme.muted,
          borderColor: tint ? `${tint}38` : theme.border,
        },
      ]}
    >
      <View style={[styles.badgeDot, { backgroundColor: tint ?? theme.mutedForeground }]} />
      <Text numberOfLines={1} style={[styles.badgeText, { color: theme.foreground }]}>
        {(KIND_LABEL[eventType] ?? humanise(eventType)).toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * Where the road ends: the record's first entry, said with its date — or, while there is more of
 * it on the server, the way to fetch it (`children`), the road running on dashed into it.
 */
export function LedgerEnd({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const surface = useContext(LedgerSurface) ?? theme.background;
  return (
    <View style={styles.end}>
      <View style={styles.dayColumn} />
      <View
        style={styles.rail}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          style={[styles.terminal, { borderColor: theme.borderStrong, backgroundColor: surface }]}
        />
      </View>
      <View style={styles.endBody}>{children}</View>
    </View>
  );
}

/** The logbook before it loads: the same road and rings, only the words waiting. */
export function LedgerPlaceholder({ rows = 4 }: { rows?: number }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading activity">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.row}>
          <Skeleton width={DAY} height={RING} radius={9} style={styles.daySkeleton} />
          <View style={styles.rail}>
            <Skeleton width={22} height={22} radius={11} style={{ marginTop: RING_MID - 11 }} />
          </View>
          <View style={[styles.body, { gap: 7 }]}>
            <Skeleton width="46%" height={12} />
            <Skeleton width="70%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** The entry's kind as its glyph on a tile — the web's `KindIcon`. */
export function KindIcon({
  emoji,
  size = 32,
  tint,
}: {
  emoji: string;
  size?: number;
  /** The tile's fill, when a state (late, soon) colours it. */
  tint?: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.36),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tint ?? theme.muted,
      }}
    >
      <Glyph size={Math.round(size * 0.59)}>{emoji}</Glyph>
    </View>
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

/** Where the end's marker sits in its row. */
const END_MID = 22;

const styles = StyleSheet.create({
  rail: { width: RAIL, alignSelf: 'stretch', alignItems: 'center' },
  segment: { position: 'absolute', left: (RAIL - LINE) / 2, width: LINE },
  down: { transformOrigin: 'top' },
  // A slim strip, the sheet's full width; the label lines up with the days' column.
  month: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: -BLEED,
    paddingHorizontal: BLEED,
  },
  monthName: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  monthYear: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 1.1 },
  // A badge: a small filled pill round a quiet figure.
  stamp: { height: 16, justifyContent: 'center', paddingHorizontal: 6, borderRadius: 999 },
  stampText: { fontSize: 10, lineHeight: 12, fontWeight: '600', letterSpacing: 0.2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: COLUMN_GAP,
    marginHorizontal: -BLEED,
    paddingLeft: BLEED,
    paddingRight: BLEED,
  },
  ring: { marginTop: RING_TOP },
  day: {
    alignSelf: 'flex-start',
    width: DAY,
    height: RING,
    marginTop: RING_TOP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayMonth: { fontSize: 8.5, lineHeight: 10, fontWeight: '700', letterSpacing: 0.8 },
  dayNumber: { fontSize: 14, lineHeight: 17, fontWeight: '600', letterSpacing: -0.4 },
  dayColumn: { width: DAY },
  daySkeleton: { alignSelf: 'flex-start', marginTop: RING_TOP },
  facts: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 17,
    paddingHorizontal: 5,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  badgeDot: { width: 5, height: 5, borderRadius: 2.5 },
  badgeText: { fontSize: 9, lineHeight: 12, fontWeight: '700', letterSpacing: 0.7 },
  aside: { fontWeight: '600' },
  // The two lines centred on the mark: (2 × 13 + 20 + 4 + 17 − 34) ÷ 2 = RING_TOP.
  body: { flex: 1, minWidth: 0, gap: 4, paddingVertical: RING_TOP - 3 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  left: { flex: 1, minWidth: 0, gap: 4 },
  right: { flexShrink: 0, alignItems: 'flex-end', gap: 1 },
  change: { fontSize: 11.5, lineHeight: 16, fontWeight: '600', letterSpacing: -0.2 },
  title: {
    minWidth: 0,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  meta: { flexShrink: 1, minWidth: 0, fontSize: 12, lineHeight: 16 },
  // The web's entry amount: `font-mono text-sm font-semibold tabular-nums`, a size up on a phone.
  cost: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
  amount: { flexDirection: 'row', alignItems: 'baseline' },
  cents: { fontSize: 11.5, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
  trail: { fontSize: 11, lineHeight: 16, fontWeight: '500', letterSpacing: -0.2 },
  trailRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  trailDot: { width: 3, height: 3, borderRadius: 1.5 },
  end: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: COLUMN_GAP,
    minHeight: END_MID * 2,
    marginHorizontal: -BLEED,
    paddingLeft: BLEED,
    paddingRight: BLEED,
  },
  terminal: {
    position: 'absolute',
    top: END_MID - 6,
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 2,
  },
  endBody: { flex: 1, minWidth: 0, paddingVertical: spacing.sm },
});
