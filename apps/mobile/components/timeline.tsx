import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { EventType } from '@vehicle-os/domain';
import { composite, type MonthGroup } from '@vehicle-os/ui';
import { RemoteImage } from '@/components/remote-image';
import { eventEmoji } from '@/lib/emoji';
import Svg, { Circle, Rect } from 'react-native-svg';
import { DATE_LOCALE, formatMoney, humanise } from '@/lib/format';
import { Glyph } from '@/lib/instrument';
import { monthSpend, type Dated } from '@/lib/ledger';
import { ease, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { cardSurface, figure, spacing, useTheme, leaf, type Theme } from '@/lib/theme';
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

/** The day's column, at the row's left edge, and its stamp's height: a size under the mark. */
const DAY = 26;
const DAY_TALL = 30;
/**
 * The rail's column, the width of the kind's mark — the notifications' muted ground, made round
 * (user asked: rounded, and the row less spaced).
 */
const RAIL = 36;
const RING = 36;
const TILE_RADIUS = RING / 2;
/** Between a row's columns. */
const COLUMN_GAP = 6;
const LINE = 1.5;
/** The body's air above and below; the badge line opens it, the title follows. */
const BODY_TOP = 18;
const BODY_BOTTOM = 14;
/** The badge line's height, and the kind's chip on it. */
const FACTS = 15;
const CHIP = 14;
/**
 * The chip grows out of the mark's top-right shoulder (user asked: no gap, morphing out of it):
 * its top a little under the mark's, so the mark hangs from the badge line.
 */
const CHIP_DROP = 2;
const RING_TOP = BODY_TOP + (FACTS - CHIP) / 2 - CHIP_DROP;
/** How far above the mark's middle the chip runs, and so where its words clear the mark's edge. */
const CHIP_RISE = RING / 2 - CHIP_DROP - CHIP / 2;
const CHIP_CLEAR = Math.ceil(Math.sqrt((RING / 2) ** 2 - CHIP_RISE ** 2)) + 5;
/** The day's stamp, centred on the mark beside it. */
const DAY_TOP = RING_TOP + (RING - DAY_TALL) / 2;
/** Rows reach past the page's gutter by this much, so a pressed row's wash has room round it. */
const BLEED = spacing.sm;

const MONTH = new Intl.DateTimeFormat(DATE_LOCALE, { month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short' });

/** The road down the rail column, above and below what sits on it. */
function Segments({
  top,
  bottom,
  draw,
}: {
  /** Drawn from the row above down to the mark's top edge. */
  top: boolean;
  /** Drawn from the mark's bottom edge to the row below: box to box, never behind a mark. */
  bottom: boolean;
  /** 0–1: the bottom stretch drawing itself down, as the row arrives. */
  draw?: Animated.Value;
}) {
  const theme = useTheme();
  return (
    <>
      {top ? (
        <View
          style={[styles.segment, { top: 0, height: RING_TOP, backgroundColor: theme.muted }]}
        />
      ) : null}
      {bottom ? (
        <Animated.View
          style={[
            styles.segment,
            styles.down,
            { top: RING_TOP + RING, bottom: 0, backgroundColor: theme.muted },
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
  const [year, month] = group.key.split('-').map(Number) as [number, number];
  const total = monthSpend(group.items);

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${group.label}${total ? `, spent ${formatMoney(total)}` : ''}`}
      style={styles.month}
    >
      <Text numberOfLines={1} style={[styles.monthName, { color: theme.foreground }]}>
        {MONTH.format(new Date(year, month - 1, 1)).toUpperCase()}
        {/* Its own weight: the font patch dresses each Text alone. */}
        <Text style={[styles.monthYear, { color: theme.mutedForeground }]}>
          {' '}
          {String(year).slice(-2)}
        </Text>
      </Text>
      {total ? (
        <View style={[styles.stamp, { backgroundColor: theme.muted }]}>
          <Text style={[figure, styles.stampText, { color: theme.mutedForeground }]}>
            {formatMoney(total, true)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A month's entries on a card, when the ledger is on the page rather than a sheet of its own — as
 * the notifications' days sit, a hairline between them. The month's heading goes above it.
 */
export function LedgerCard({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const surface = cardSurface(theme);
  return (
    <Ground.Provider value={composite(surface.backgroundColor, theme.background)}>
      <View style={[styles.card, surface]}>{children}</View>
    </Ground.Provider>
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

/** What the rows stand on: the page, or the card a `LedgerCard` lays under them. */
const Ground = createContext<string | null>(null);

/**
 * The ground a kind's mark and its chip share: its hue at 12% over what the row stands on, made
 * solid — so the chip can tuck under the mark without a darker overlap, and the road behind a mark
 * never shows through it. The muted grey without a hue.
 */
const kindWash = (theme: Theme, eventType: EventType, ground: string | null) => {
  const hue = HUE[eventType];
  return hue ? composite(`${theme[hue]}1F`, ground ?? theme.background) : theme.muted;
};

/** The kind as its badge says it: the filter's word, the long ones cut to what is read. */
const KIND_LABEL: Partial<Record<EventType, string>> = {
  PART_INSTALLED: 'Part',
  PART_REMOVED: 'Part out',
  CONDITION_CHECK: 'Condition',
  DOCUMENT_ADDED: 'Document',
};

/** The kind in a word, as the filter says it. */
const kindWord = (eventType: EventType) => KIND_LABEL[eventType] ?? humanise(eventType);

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

/** What is filed against an entry, for its row: the first picture there is, and how many in all. */
export type Filed = { uri: string | null; cacheKey: string; count: number };

/** Two instants on the same calendar day, in the phone's own zone. */
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * One entry on the road: its day as a calendar badge at the left edge, the kind's glyph on the
 * road, then what it was over its kind's badge and the place; flush right,
 * what it cost over what went in and how far it had come since the reading before. Under both, a
 * peek at what the entry holds: its first attachment as a thumbnail and the note's opening lines.
 * The whole row opens it, a wash under the thumb.
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
  note,
  filed,
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
  /** Said in the cost's place when there is none: a trip's distance, an odometer reading. */
  aside?: string | null;
  /** Under the cost, quieter: what went in. */
  trail?: readonly (string | null | false | undefined)[];
  /** The odometer since the reading before, signed: a rise in green, a drop in red. */
  change?: { text: string; up: boolean } | null;
  /** The note, cut to two lines under the figures. */
  note?: string | null;
  /** Its attachments, as a thumbnail beside the note. */
  filed?: Filed | null;
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
  const excerpt = note?.replace(/\s+/g, ' ').trim();
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
            <Segments top={!leadsDay} bottom={!endsDay} draw={draw} />
            <Ring eventType={eventType} state={state} />
          </View>
          <View style={styles.body}>
            <View style={styles.columns}>
              <View style={styles.left}>
                {/* The kind's badge over what it was (user asked), what else it records beside it. */}
                <View style={styles.facts}>
                  <KindBadge eventType={eventType} attached />
                  {rest ? (
                    <Text numberOfLines={1} style={[styles.meta, { color: theme.mutedForeground }]}>
                      {rest}
                    </Text>
                  ) : null}
                </View>
                <Text numberOfLines={2} style={[styles.title, { color: theme.foreground }]}>
                  {title}
                </Text>
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
                  <Text style={[figure, styles.cost, styles.aside, { color: theme.foreground }]}>
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
            {excerpt || filed ? (
              <View style={styles.peek}>
                {filed ? (
                  <View
                    style={[
                      styles.thumb,
                      { backgroundColor: theme.muted, borderColor: theme.border },
                    ]}
                  >
                    <RemoteImage
                      uri={filed.uri}
                      cacheKey={filed.cacheKey}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={150}
                      accessibilityIgnoresInvertColors
                      fallback={
                        <Ionicons
                          name="document-text-outline"
                          size={16}
                          color={theme.mutedForeground}
                        />
                      }
                    />
                    {filed.count > 1 ? (
                      <View style={styles.thumbCount}>
                        <Text style={[figure, styles.thumbCountText]}>{filed.count}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <Text numberOfLines={2} style={[styles.note, { color: theme.mutedForeground }]}>
                  {excerpt ||
                    `${filed!.count} ${filed!.count === 1 ? 'attachment' : 'attachments'}`}
                </Text>
              </View>
            ) : null}
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
 * The day an entry happened, as a tear-off calendar: the weekday small over the date in the
 * figures' mono, inside a hairline tile — no fill, as the glyphs beside it have none. The month is
 * the strip over its days, so the tile does not say it again. Today's is the primary's, so the
 * newest entries find themselves.
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
        {WEEKDAY.format(date).toUpperCase()}
      </Text>
      <Text style={[figure, styles.dayNumber, { color: today ? theme.primary : theme.foreground }]}>
        {date.getDate()}
      </Text>
    </View>
  );
}

/**
 * The kind on the road, in its row's rail: its glyph on the notifications' quiet tile, which the
 * road meets at its top and foot. A state rings the tile — waiting amber and dashed, refused red.
 * Pressing the row tips it.
 */
function Ring({ eventType, state }: { eventType: EventType; state?: 'waiting' | 'failed' }) {
  const theme = useTheme();
  const tip = useContext(Tip);
  const ground = useContext(Ground);
  const edge = state === 'failed' ? theme.destructive : state === 'waiting' ? theme.warning : null;
  return (
    <Animated.View
      style={[
        styles.ring,
        styles.tile,
        { backgroundColor: kindWash(theme, eventType, ground) },
        tip
          ? {
              transform: [
                { rotate: tip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-9deg'] }) },
                { scale: tip.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
              ],
            }
          : null,
      ]}
    >
      {edge ? (
        <Svg style={StyleSheet.absoluteFill} width={RING} height={RING}>
          <Rect
            x={0.75}
            y={0.75}
            width={RING - 1.5}
            height={RING - 1.5}
            rx={TILE_RADIUS - 0.75}
            fill="none"
            stroke={edge}
            strokeWidth={1.5}
            strokeDasharray={state === 'waiting' ? '3 2.5' : undefined}
          />
        </Svg>
      ) : null}
      <Glyph size={18}>{eventEmoji(eventType)}</Glyph>
    </Animated.View>
  );
}

/**
 * The kind, as a badge: a dot of its hue and its name in small tracked capitals, on a wash of the
 * same hue. The words stay in ink — the hue is only the dot and the wash — so the badge reads in
 * both themes at any hue. `attached`, it is a row's: it leaves the kind's mark from its side on the
 * mark's own wash — square where it joins, round where it ends, no edge and no dot (the mark is it).
 */
export function KindBadge({
  eventType,
  attached = false,
}: {
  eventType: EventType;
  attached?: boolean;
}) {
  const theme = useTheme();
  const ground = useContext(Ground);
  const hue = HUE[eventType];
  const tint = hue ? theme[hue] : null;
  return (
    <View
      style={[
        styles.badge,
        attached
          ? [styles.badgeAttached, { backgroundColor: kindWash(theme, eventType, ground) }]
          : {
              backgroundColor: kindWash(theme, eventType, ground),
              borderColor: tint ? `${tint}38` : theme.border,
            },
      ]}
    >
      {attached ? null : (
        <View style={[styles.badgeDot, { backgroundColor: tint ?? theme.mutedForeground }]} />
      )}
      <Text numberOfLines={1} style={[styles.badgeText, { color: theme.foreground }]}>
        {kindWord(eventType).toUpperCase()}
      </Text>
    </View>
  );
}

/** The logbook before it loads: the same road and rings, only the words waiting. */
export function LedgerPlaceholder({ rows = 4 }: { rows?: number }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading activity">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.row}>
          <Skeleton width={DAY} height={DAY_TALL} radius={7} style={styles.daySkeleton} />
          <View style={styles.rail}>
            <Skeleton width={RING} height={RING} radius={TILE_RADIUS} style={styles.ring} />
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
/**
 * A row's figures as small chips under it, washed in its kind's colour — a fill's litres, what one
 * cost and how far it went. Only the figures there are.
 */
export function FactChips({
  eventType,
  facts,
}: {
  eventType: EventType;
  /** `aside`: a figure said in passing inside the chip, after its own — a fill's price per unit. */
  facts: readonly {
    icon: ComponentProps<typeof Ionicons>['name'];
    text: string;
    aside?: string;
  }[];
}) {
  const theme = useTheme();
  const hue = HUE[eventType];
  const tint = hue ? theme[hue] : null;
  return (
    <View style={styles.factChips}>
      {facts.map((fact) => (
        <View
          key={fact.icon}
          style={[styles.factChip, { backgroundColor: tint ? `${tint}1A` : theme.muted }]}
        >
          <Ionicons name={fact.icon} size={11} color={tint ?? theme.mutedForeground} />
          <Text
            numberOfLines={1}
            style={[figure, styles.factChipText, { color: theme.foreground }]}
          >
            {fact.text}
          </Text>
          {fact.aside ? (
            <Text
              numberOfLines={1}
              style={[figure, styles.factChipAside, { color: theme.mutedForeground }]}
            >
              {fact.aside}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function fillQuantity(eventType: EventType, note: string | null) {
  const match = eventType === 'FUEL' || eventType === 'CHARGE' ? QUANTITY.exec(note ?? '') : null;
  return match
    ? { quantity: match[1]!.replace(/kwh$/i, 'kWh'), rest: note!.slice(match[0].length).trim() }
    : { quantity: null, rest: note?.trim() ?? '' };
}

const styles = StyleSheet.create({
  // Over the body, so a chip tucked under the mark never paints over its glyph.
  rail: { width: RAIL, alignSelf: 'stretch', alignItems: 'center', zIndex: 1 },
  segment: { position: 'absolute', left: (RAIL - LINE) / 2, width: LINE },
  down: { transformOrigin: 'top' },
  // A slim strip, the sheet's full width; the label lines up with the days' column.
  month: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: -BLEED,
    paddingHorizontal: BLEED,
  },
  monthName: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  monthYear: { fontSize: 10, lineHeight: 13, fontWeight: '500', letterSpacing: 0.2 },
  // A badge: a small filled pill round a quiet figure.
  stamp: { height: 18, justifyContent: 'center', paddingHorizontal: 7, borderRadius: 999 },
  stampText: { fontSize: 10.5, lineHeight: 13, fontWeight: '600', letterSpacing: 0 },
  /*
   * A leaf, so the wash under a pressed row sits inside its card as a shape of its own: the card's
   * corners less the 4pt the row stands in from it, the curves concentric.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: COLUMN_GAP,
    marginHorizontal: -BLEED,
    paddingLeft: BLEED,
    paddingRight: BLEED,
    ...leaf('md', 4),
  },
  ring: { marginTop: RING_TOP },
  tile: {
    width: RING,
    height: RING,
    borderRadius: TILE_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Rows bleed BLEED into the side padding: 4pt either side, and 4pt top and bottom to match.
  card: { ...leaf('md'), paddingHorizontal: spacing.md, paddingVertical: 4 },
  day: {
    alignSelf: 'flex-start',
    width: DAY,
    height: DAY_TALL,
    marginTop: DAY_TOP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayMonth: { fontSize: 6.5, lineHeight: 8, fontWeight: '700', letterSpacing: 0.3 },
  dayNumber: { fontSize: 12, lineHeight: 14, fontWeight: '600', letterSpacing: -0.4 },
  dayColumn: { width: DAY },
  daySkeleton: { alignSelf: 'flex-start', marginTop: DAY_TOP },
  facts: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  peek: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 9,
    // A white receipt on the white card still has an edge.
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // On the picture itself, so it reads on any photo in either theme.
  thumbCount: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000A6',
  },
  thumbCountText: { color: '#FFFFFF', fontSize: 9, lineHeight: 11, fontWeight: '700' },
  note: { flex: 1, minWidth: 0, fontSize: 11, lineHeight: 15, fontWeight: '400' },
  factChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  factChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 6,
    maxWidth: '100%',
  },
  factChipText: {
    flexShrink: 1,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  // A fill's price per unit, after its litres: a size down and muted, said rather than shown.
  factChipAside: { flexShrink: 0, fontSize: 9, lineHeight: 14, fontWeight: '500' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 14,
    paddingHorizontal: 4,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  // Out of the mark's top-right shoulder: it starts under the mark's middle (the column gap and
  // half the rail taken back), the mark drawn over it, and its words begin past the mark's edge.
  badgeAttached: {
    height: CHIP,
    marginLeft: -(COLUMN_GAP + RAIL / 2),
    paddingLeft: CHIP_CLEAR,
    paddingRight: 7,
    borderWidth: 0,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderTopRightRadius: 7,
    borderBottomRightRadius: 7,
  },
  badgeDot: { width: 4, height: 4, borderRadius: 2 },
  badgeText: { fontSize: 7.5, lineHeight: 10, fontWeight: '700', letterSpacing: 0.4 },
  aside: { fontWeight: '600' },
  body: { flex: 1, minWidth: 0, gap: 4, paddingTop: BODY_TOP, paddingBottom: BODY_BOTTOM },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  left: { flex: 1, minWidth: 0, gap: 2 },
  right: { flexShrink: 0, alignItems: 'flex-end', gap: 1 },
  change: { fontSize: 10, lineHeight: 15, fontWeight: '600', letterSpacing: -0.2 },
  // The dash's next-up line, a size up: a ledger row is read on its own, the dash's at a glance.
  title: {
    minWidth: 0,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  meta: { flexShrink: 1, minWidth: 0, fontSize: 11, lineHeight: FACTS, fontWeight: '500' },
  // The web's entry amount: `font-mono text-sm font-semibold tabular-nums`.
  cost: { fontSize: 13, lineHeight: 17, fontWeight: '600', letterSpacing: -0.3 },
  amount: { flexDirection: 'row', alignItems: 'baseline' },
  cents: { fontSize: 10, lineHeight: 17, fontWeight: '600', letterSpacing: -0.2 },
  trail: { fontSize: 10, lineHeight: 15, fontWeight: '500', letterSpacing: -0.2 },
  trailRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  trailDot: { width: 3, height: 3, borderRadius: 1.5 },
});
