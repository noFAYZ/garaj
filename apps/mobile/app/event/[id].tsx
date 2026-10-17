import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useRef, type ReactNode } from 'react';
import {
  Alert,
  Animated,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Line, RadialGradient, Rect, Stop } from 'react-native-svg';
import type {
  VehicleActivity,
  VehicleDocument,
  VehicleEvent,
  VehiclePhoto,
} from '@vehicle-os/contracts';
import {
  activityQuery,
  documentsQuery,
  eventQuery,
  photosQuery,
  queryKeys,
  vehicleQuery,
} from '@vehicle-os/api-client/react';
import type { EventType } from '@vehicle-os/domain';
import { odometerDeltas } from '@vehicle-os/ui';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { groupSurface } from '@/components/settings-kit';
import { fillQuantity, KindBadge, KindDisc, kindHue, splitCents } from '@/components/timeline';
import { api } from '@/lib/api';
import { fileParams, pickPhoto } from '@/lib/file-picker';
import { formatDistance, formatMoney, humanise } from '@/lib/format';
import { economy, sincePrevious, spendWindow, unitPrice } from '@/lib/ledger';
import { haptic, Odometer, Pop, PressableScale, Rise, useScrollY } from '@/lib/motion';
import { cardSurface, figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Empty, Skeleton } from '@/lib/ui';

/**
 * One entry, in full — drawn as a receipt is read: what it was and what it cost first, large, then
 * the facts it records on one sheet, then what only the whole record can say — how far and how long
 * since the last one of its kind, what that fill did per 100, and how this bill sits among the
 * others, as bars that open the entry each one is. The note, what is filed against it, and the way
 * to let it go close the page.
 */

/** The bar the keys float on, below the status bar. */
const BAR = 52;
const DISC = 76;
/** How far the kind's light reaches round the disc. */
const HALO = 196;
/** How tall the spend bars stand at their dearest. */
const BARS = 64;

const FULL_DATE = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const BAR_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** One of a kind, as a sentence says it: "since the last fill-up". */
const NOUN: Partial<Record<EventType, string>> = {
  FUEL: 'fill-up',
  CHARGE: 'charge',
  MAINTENANCE: 'service',
  REPAIR: 'repair',
  INSPECTION: 'inspection',
  CLEANING: 'wash',
  TRIP: 'trip',
};
const noun = (kind: EventType) => NOUN[kind] ?? `${humanise(kind).toLowerCase()} entry`;

/**
 * The row that opened this screen is already on the phone, in one of the logbook's pages: drawn
 * from there at once, then settled by the entry's own fetch — no blank screen between a tap and
 * what was tapped.
 */
function fromLogbook(queryClient: QueryClient, vehicleId: string, id: string) {
  const pages = queryClient.getQueriesData<VehicleActivity>({
    queryKey: queryKeys.activity(vehicleId),
  });
  for (const [, page] of pages) {
    // The older pages are an infinite query under the same key, shaped differently.
    const hit = page?.done?.data?.find((event) => event.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export default function EventScreen() {
  const { id, vehicleId } = useLocalSearchParams<{ id: string; vehicleId: string }>();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const scroller = useRef<ScrollView>(null);
  const { y, onScroll } = useScrollY();

  const event = useQuery({
    ...eventQuery(api, vehicleId, id),
    placeholderData: () => fromLogbook(queryClient, vehicleId, id),
  });
  const data = event.data;
  const kind = data?.eventType;
  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  const photos = useQuery(photosQuery(api, vehicleId));
  const documents = useQuery(documentsQuery(api, vehicleId));
  // The logbook as Logs reads it, for the reading before this one: what the row said.
  const logbook = useQuery(activityQuery(api, vehicleId));
  // The same kind, for what has passed since the last one and how this one compares.
  const sameKind = useQuery({
    ...activityQuery(api, vehicleId, { eventType: kind ? [kind] : [] }),
    enabled: Boolean(kind),
  });

  // Filed against this entry, rather than merely belonging to the same vehicle.
  const attachedPhotos = (photos.data ?? []).filter((photo) => photo.eventId === id);
  const attachedDocuments = (documents.data?.data ?? []).filter(
    (document) => document.eventId === id,
  );

  const kindName = data ? humanise(data.eventType) : '';
  const titled =
    data !== undefined &&
    data.title.trim() !== '' &&
    data.title.trim().toLowerCase() !== kindName.toLowerCase();
  const title = data ? (titled ? data.title : kindName) : '';
  const hue = kind ? kindHue(kind) : undefined;
  const tint = hue ? theme[hue] : null;
  const delta = data ? (odometerDeltas(logbook.data?.done.data ?? []).get(data.id) ?? null) : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.event(vehicleId, id) });
    void queryClient.invalidateQueries({ queryKey: ['vehicles', vehicleId] });
  };

  const attach = async (source: 'camera' | 'library') => {
    try {
      const file = await pickPhoto(source);
      if (file) {
        router.push({
          pathname: '/add/photo',
          params: { vehicleId, eventId: id, ...fileParams(file) },
        });
      }
    } catch (error) {
      Alert.alert('Could not open photos', (error as Error).message);
    }
  };

  const addPhoto = () =>
    Alert.alert('Add a photo', undefined, [
      { text: 'Take a photo', onPress: () => void attach('camera') },
      { text: 'Choose from library', onPress: () => void attach('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const remove = () => {
    haptic.selection();
    Alert.alert(`Delete "${title || 'this entry'}"?`, 'Its cost leaves the totals too.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void api.events
            .remove(vehicleId, id)
            .then(() => {
              haptic.success();
              refresh();
              router.back();
            })
            .catch((error: unknown) =>
              Alert.alert('Could not delete it', (error as Error).message),
            );
        },
      },
    ]);
  };

  // A bill sent on as words: to whoever shares the car, the accountant, the garage.
  const share = () => {
    if (!data) return;
    const { quantity, rest } = fillQuantity(data.eventType, data.description);
    void Share.share({
      message: [
        data.cost ? `${title} — ${formatMoney(data.cost)}` : title,
        [FULL_DATE.format(new Date(data.occurredAt)), data.provider].filter(Boolean).join(' · '),
        [
          vehicle.data?.displayName,
          data.odometer !== null ? formatDistance(data.odometer, data.odometerUnit) : null,
          quantity,
        ]
          .filter(Boolean)
          .join(' · '),
        rest || null,
      ]
        .filter(Boolean)
        .join('\n'),
    }).catch(() => undefined);
  };

  // Another entry of the kind, from its bar or the last one's date: the screen turns to it in place.
  const open = (next: string) => {
    haptic.selection();
    router.setParams({ id: next });
    scroller.current?.scrollTo({ y: 0, animated: true });
  };

  const top = insets.top + BAR;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      {event.isError ? (
        <View style={{ flex: 1, paddingTop: top }}>
          <Empty title="Entry not found" description="It may have been deleted." />
        </View>
      ) : (
        <Animated.ScrollView
          ref={scroller}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={[
            styles.page,
            {
              paddingTop: top + spacing.xs,
              paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl,
            },
          ]}
        >
          {data ? (
            // Keyed, so turning to another entry plays its arrival again.
            <View key={data.id} style={styles.content}>
              <Hero event={data} title={title} glow={tint ?? theme.primary} />
              <Facts event={data} delta={delta} />
              <Context
                event={data}
                sameKind={sameKind.data?.done.data ?? []}
                tint={tint ?? theme.foreground}
                onOpen={open}
              />
              <Note event={data} tint={tint ?? theme.borderStrong} />
              <Attachments
                photos={attachedPhotos}
                documents={attachedDocuments}
                vehicleId={vehicleId}
                onAdd={addPhoto}
              />
              <Foot event={data} vehicleName={vehicle.data?.displayName} onDelete={remove} />
            </View>
          ) : (
            <Placeholder />
          )}
        </Animated.ScrollView>
      )}
      <TopBar y={y} title={title} onShare={data ? share : undefined} />
    </View>
  );
}

/**
 * The keys over the page — back, and share — with a bar under them that only arrives once the
 * hero has scrolled away, the entry's name in it.
 */
function TopBar({
  y,
  title,
  onShare,
}: {
  y: Animated.Value;
  title: string;
  onShare: (() => void) | undefined;
}) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const shown = y.interpolate({ inputRange: [90, 130], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            opacity: shown,
            backgroundColor: theme.background,
            borderBottomColor: theme.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      />
      <Key
        icon="arrow-back"
        label="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
      />
      <Animated.Text
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          typeScale.label,
          styles.barTitle,
          {
            color: theme.foreground,
            opacity: shown,
            transform: [
              { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
            ],
          },
        ]}
      >
        {title}
      </Animated.Text>
      {onShare ? (
        <Key icon="share-outline" label="Share this entry" onPress={onShare} />
      ) : (
        <View style={styles.key} />
      )}
    </View>
  );
}

function Key({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      scaleTo={0.9}
      style={[styles.key, groupSurface(theme)]}
    >
      <Ionicons name={icon} size={19} color={theme.foreground} />
    </PressableScale>
  );
}

/**
 * The kind's light round its disc — tight, so the page stays white and the gradient is too short to
 * band; it blooms with the disc as it arrives.
 */
function Halo({ color }: { color: string }) {
  const theme = useTheme();
  return (
    <Svg
      pointerEvents="none"
      width={HALO}
      height={HALO}
      style={styles.halo}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient id="entry-halo" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={theme.dark ? 0.34 : 0.26} />
          <Stop offset="0.5" stopColor={color} stopOpacity={theme.dark ? 0.1 : 0.08} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={HALO} height={HALO} fill="url(#entry-halo)" />
    </Svg>
  );
}

/**
 * What it was and what it cost, as a receipt's head: the kind's disc — the one its row wears in
 * Logs, grown — the name, the amount in the figures' mono with its cents quieter, then the kind
 * and the day.
 */
function Hero({ event, title, glow }: { event: VehicleEvent; title: string; glow: string }) {
  const theme = useTheme();
  const [whole, cents] = event.cost ? splitCents(event.cost) : ['', ''];
  // Nothing paid: a trip's headline is how far it went.
  const distance =
    !event.cost && event.trip ? formatDistance(event.trip.distance, event.odometerUnit) : null;
  const day = FULL_DATE.format(new Date(event.occurredAt));
  return (
    <View
      accessible
      accessibilityLabel={[
        title,
        humanise(event.eventType),
        event.cost ? formatMoney(event.cost) : distance,
        day,
      ]
        .filter(Boolean)
        .join(', ')}
      style={styles.hero}
    >
      <Pop style={styles.disc}>
        <Halo color={glow} />
        <KindDisc eventType={event.eventType} size={DISC} />
      </Pop>
      <Rise index={1} style={styles.heroText}>
        <Text numberOfLines={2} style={[styles.title, { color: theme.foreground }]}>
          {title}
        </Text>
        {event.cost ? (
          // Side by side, not nested: a nested figure can be dressed differently on a phone.
          <View style={styles.amount}>
            <Text style={[figure, styles.whole, { color: theme.foreground }]}>{whole}</Text>
            {cents ? (
              <Text style={[figure, styles.cents, { color: theme.mutedForeground }]}>{cents}</Text>
            ) : null}
          </View>
        ) : distance ? (
          <Text style={[figure, styles.whole, { color: theme.foreground }]}>{distance}</Text>
        ) : null}
      </Rise>
      <Rise index={2} style={styles.heroMeta}>
        <KindBadge eventType={event.eventType} />
        <Text style={[figure, styles.heroDate, { color: theme.mutedForeground }]}>{day}</Text>
      </Rise>
    </View>
  );
}

type Fact = {
  key: string;
  label: string;
  /** What a screen reader says for the value. */
  said: string;
  value: ReactNode;
  /** A small signed figure under the value: the odometer since the reading before. */
  sub?: { text: string; color: string } | null;
};

/**
 * Everything else the entry records, as a spec sheet: two columns, hairlines between, a small
 * tracked label over each value — the odometer on its drums, what went in and what a litre of it
 * cost, where, the engine's hours, a trip's purpose and claim. Only what is there is drawn.
 */
function Facts({ event, delta }: { event: VehicleEvent; delta: number | null }) {
  const theme = useTheme();
  const { quantity } = fillQuantity(event.eventType, event.description);
  const price = unitPrice(event.cost, quantity);
  const unit = event.odometerUnit === 'MI' ? 'mi' : 'km';
  const value = (text: string, mono = true) => (
    <Text numberOfLines={2} style={[mono ? figure : null, styles.factValue, { color: theme.foreground }]}>
      {text}
    </Text>
  );

  const facts: Fact[] = [];
  if (event.odometer !== null) {
    facts.push({
      key: 'odometer',
      label: 'Odometer',
      said: formatDistance(event.odometer, event.odometerUnit),
      value: (
        <View style={styles.reading}>
          <Odometer value={event.odometer} size={13} />
          <Text style={[typeScale.caption, styles.readingUnit, { color: theme.mutedForeground }]}>
            {unit}
          </Text>
        </View>
      ),
      sub:
        delta === null
          ? null
          : {
              text: `${delta > 0 ? '+' : '−'}${formatDistance(Math.abs(delta), event.odometerUnit)}`,
              color: delta > 0 ? theme.success : theme.destructive,
            },
    });
  }
  if (event.provider) {
    facts.push({ key: 'where', label: 'Where', said: event.provider, value: value(event.provider, false) });
  }
  if (quantity) {
    facts.push({
      key: 'quantity',
      label: event.eventType === 'CHARGE' ? 'Charged' : 'Filled',
      said: quantity,
      value: value(quantity),
    });
  }
  if (price) {
    facts.push({
      key: 'price',
      label: `Per ${price.per}`,
      said: `${formatMoney(price.price)} per ${price.per}`,
      value: value(formatMoney(price.price)),
    });
  }
  if (event.engineHours !== null) {
    facts.push({
      key: 'hours',
      label: 'Engine hours',
      said: `${event.engineHours.toLocaleString()} hours`,
      value: value(`${event.engineHours.toLocaleString()} h`),
    });
  }
  if (event.trip) {
    facts.push({
      key: 'purpose',
      label: 'Purpose',
      said: humanise(event.trip.purpose),
      value: value(humanise(event.trip.purpose), false),
    });
    // The hero already says the distance when nothing was paid.
    if (event.cost) {
      const distance = formatDistance(event.trip.distance, event.odometerUnit);
      facts.push({ key: 'distance', label: 'Distance', said: distance, value: value(distance) });
    }
    if (event.trip.deduction) {
      const claim = formatMoney(event.trip.deduction);
      facts.push({
        key: 'deduction',
        label: 'Deduction',
        said: claim,
        value: value(claim),
        sub: event.trip.rate
          ? { text: `${formatMoney(event.trip.rate)}/${unit}`, color: theme.mutedForeground }
          : null,
      });
    }
  }
  if (facts.length === 0) return null;

  return (
    <Rise index={3} style={[styles.card, cardSurface(theme)]}>
      <View style={styles.grid}>
        {facts.map((fact, place) => {
          // An odd one out takes the whole last row.
          const wide = facts.length % 2 === 1 && place === facts.length - 1;
          return (
            <View
              key={fact.key}
              accessible
              accessibilityLabel={`${fact.label}, ${fact.said}${
                fact.sub ? `, ${fact.sub.text}` : ''
              }`}
              style={[
                styles.cell,
                { width: wide ? '100%' : '50%', borderColor: theme.border },
                place % 2 === 1 ? styles.cellRight : null,
                place >= 2 ? styles.cellBelow : null,
              ]}
            >
              <Text style={[styles.label, { color: theme.mutedForeground }]}>
                {fact.label.toUpperCase()}
              </Text>
              {fact.value}
              {fact.sub ? (
                <Text style={[figure, styles.sub, { color: fact.sub.color }]}>{fact.sub.text}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </Rise>
  );
}

/**
 * What only the whole record can say about this entry. Since the last one of its kind: the distance,
 * the days, what the fill did per 100 and per km. Then the kind's spend round it as bars — this one
 * in the kind's colour, the typical bill a dashed line — each bar the way to its entry. Either half
 * is left out when the record cannot say it, and the card with both.
 */
function Context({
  event,
  sameKind,
  tint,
  onOpen,
}: {
  event: VehicleEvent;
  sameKind: readonly VehicleEvent[];
  tint: string;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const since = sincePrevious(event, sameKind);
  const spend = spendWindow(event, sameKind);
  const { quantity } = fillQuantity(event.eventType, event.description);
  const unit = event.odometerUnit === 'MI' ? 'mi' : 'km';

  // Each figure says what it is by its unit; `said` is the same for a screen reader.
  const stats: { value: string; unit: string; said: string }[] = [];
  if (since?.distance) {
    const driven = formatDistance(since.distance, event.odometerUnit);
    stats.push({ value: driven.split(' ')[0]!, unit, said: `${driven} driven` });
  }
  if (since) {
    const days = since.days === 1 ? 'day' : 'days';
    stats.push(
      since.days === 0
        ? { value: 'Same', unit: 'day', said: 'the same day' }
        : { value: String(since.days), unit: days, said: `${since.days} ${days} apart` },
    );
  }
  const fill = economy(quantity, since?.distance ?? null, event.odometerUnit);
  if (fill) {
    const [figureText, ...rest] = fill.split(' ');
    stats.push({ value: figureText!, unit: rest.join(' '), said: fill });
  }
  if (event.cost && since?.distance && (event.eventType === 'FUEL' || event.eventType === 'CHARGE')) {
    const running = formatMoney({
      amountMinor: event.cost.amountMinor / since.distance,
      currency: event.cost.currency,
    });
    stats.push({ value: running, unit: `/${unit}`, said: `${running} per ${unit}` });
  }

  if (stats.length === 0 && !spend) return null;
  const currency = event.cost?.currency ?? 'USD';

  return (
    <Rise index={4} style={[styles.card, cardSurface(theme)]}>
      {since ? (
        <View style={styles.half}>
          <PressableScale
            onPress={() => onOpen(since.previous.id)}
            accessibilityRole="button"
            accessibilityLabel={`Since the last ${noun(event.eventType)}, ${SHORT_DATE.format(
              new Date(since.previous.occurredAt),
            )}`}
            accessibilityHint="Opens it"
            scaleTo={0.98}
            style={styles.halfHead}
          >
            <Text style={[styles.halfTitle, { color: theme.foreground }]}>
              Since the last {noun(event.eventType)}
            </Text>
            <Text style={[figure, styles.halfAside, { color: theme.mutedForeground }]}>
              {BAR_DATE.format(new Date(since.previous.occurredAt))}
            </Text>
            <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} />
          </PressableScale>
          <View style={styles.stats}>
            {stats.map((stat, place) => (
              <Fragment key={stat.said}>
                {place > 0 ? (
                  <View style={[styles.statRule, { backgroundColor: theme.border }]} />
                ) : null}
                <View accessible accessibilityLabel={stat.said} style={styles.statLine}>
                  <Text style={[figure, styles.statValue, { color: theme.foreground }]}>
                    {stat.value}
                  </Text>
                  <Text style={[styles.statUnit, { color: theme.mutedForeground }]}>{stat.unit}</Text>
                </View>
              </Fragment>
            ))}
          </View>
        </View>
      ) : null}

      {spend && event.cost ? (
        <View
          style={[
            styles.half,
            since ? [styles.halfBelow, { borderTopColor: theme.border }] : null,
          ]}
        >
          <View style={styles.halfHead}>
            <Verdict amount={event.cost.amountMinor} typical={spend.typical} kind={event.eventType} />
            <Text style={[figure, styles.halfAside, { color: theme.mutedForeground }]}>
              typical {formatMoney({ amountMinor: spend.typical, currency }, true)}
            </Text>
          </View>
          <Bars
            bars={spend.bars}
            current={event.id}
            max={spend.max}
            typical={spend.typical}
            tint={tint}
            onOpen={onOpen}
          />
          <View style={styles.axis}>
            <Text style={[figure, styles.axisText, { color: theme.mutedForeground }]}>
              {BAR_DATE.format(new Date(spend.bars[0]!.occurredAt))}
            </Text>
            <Text style={[figure, styles.axisText, { color: theme.mutedForeground }]}>
              {BAR_DATE.format(new Date(spend.bars.at(-1)!.occurredAt))}
            </Text>
          </View>
        </View>
      ) : null}
    </Rise>
  );
}

/** This bill against the kind's typical one, in a word and an arrow. */
function Verdict({ amount, typical, kind }: { amount: number; typical: number; kind: EventType }) {
  const theme = useTheme();
  const change = typical > 0 ? Math.round(((amount - typical) / typical) * 100) : 0;
  // Within a few percent is the usual bill, not news.
  const near = Math.abs(change) < 3;
  const color = near ? theme.mutedForeground : change > 0 ? theme.warning : theme.success;
  return (
    <View style={styles.verdict}>
      <Ionicons
        name={near ? 'remove' : change > 0 ? 'arrow-up' : 'arrow-down'}
        size={13}
        color={color}
      />
      <Text numberOfLines={1} style={[styles.halfTitle, { flexShrink: 1, color: theme.foreground }]}>
        {near
          ? `About your typical ${noun(kind)}`
          : change >= 100
            ? // Past double, a multiple reads at a glance where "250%" has to be worked out.
              `${(amount / typical).toFixed(1).replace(/\.0$/, '')}× typical`
            : `${Math.abs(change)}% ${change > 0 ? 'above' : 'below'} typical`}
      </Text>
    </View>
  );
}

/**
 * The kind's bills as bars, oldest at the left; this one in its colour, the rest a wash of it, the
 * typical bill dashed across. Each bar is the way to its entry.
 */
function Bars({
  bars,
  current,
  max,
  typical,
  tint,
  onOpen,
}: {
  bars: readonly VehicleEvent[];
  current: string;
  max: number;
  typical: number;
  tint: string;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const level = Math.round(BARS - (typical / max) * BARS);
  return (
    <View style={{ height: BARS }}>
      <View style={styles.bars}>
        {bars.map((bar) => {
          const mine = bar.id === current;
          const height = Math.max(4, Math.round(((bar.cost?.amountMinor ?? 0) / max) * BARS));
          return (
            <PressableScale
              key={bar.id}
              disabled={mine}
              onPress={() => onOpen(bar.id)}
              accessibilityRole="button"
              accessibilityLabel={`${BAR_DATE.format(new Date(bar.occurredAt))}, ${formatMoney(bar.cost)}`}
              accessibilityState={{ selected: mine }}
              scaleTo={0.9}
              style={styles.barSlot}
            >
              <View
                style={[
                  styles.spendBar,
                  { height, backgroundColor: mine ? tint : `${tint}2E` },
                ]}
              />
            </PressableScale>
          );
        })}
      </View>
      <Svg
        pointerEvents="none"
        width="100%"
        height={BARS}
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Line
          x1="0"
          x2="100%"
          y1={level}
          y2={level}
          stroke={theme.mutedForeground}
          strokeOpacity={0.55}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        {/* The bars' ground. */}
        <Line x1="0" x2="100%" y1={BARS - 0.5} y2={BARS - 0.5} stroke={theme.border} strokeWidth={1} />
      </Svg>
    </View>
  );
}

/** The note, as a quote: a rule in the kind's colour and the words beside it. */
function Note({ event, tint }: { event: VehicleEvent; tint: string }) {
  const theme = useTheme();
  // A fill's quantity is a fact above; the note is what is left of it.
  const { rest } = fillQuantity(event.eventType, event.description);
  if (!rest) return null;
  return (
    <Rise index={5} style={styles.note}>
      <View style={[styles.noteRule, { backgroundColor: tint }]} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.label, { color: theme.mutedForeground }]}>NOTE</Text>
        <Text style={[typeScale.body, { color: theme.foreground }]}>{rest}</Text>
      </View>
    </Rise>
  );
}

/**
 * What is filed against the entry: photographs as a rail with the way to add one at its end, then
 * papers. With nothing filed, one line that asks for the receipt.
 */
function Attachments({
  photos,
  documents,
  vehicleId,
  onAdd,
}: {
  photos: VehiclePhoto[];
  documents: VehicleDocument[];
  vehicleId: string;
  onAdd: () => void;
}) {
  const theme = useTheme();
  const count = photos.length + documents.length;

  if (count === 0) {
    return (
      <Rise index={6}>
        <PressableScale
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Attach a receipt or photo"
          scaleTo={0.98}
          style={[styles.attach, { borderColor: theme.borderStrong }]}
        >
          <Ionicons name="camera-outline" size={18} color={theme.mutedForeground} />
          <Text style={[typeScale.label, { flex: 1, color: theme.mutedForeground }]}>
            Attach a receipt or photo
          </Text>
          <Ionicons name="add" size={18} color={theme.mutedForeground} />
        </PressableScale>
      </Rise>
    );
  }

  return (
    <Rise index={6} style={{ gap: spacing.sm }}>
      <View style={styles.sectionHead}>
        <Text style={[styles.halfTitle, { color: theme.foreground }]}>Attachments</Text>
        <Text style={[figure, styles.halfAside, { color: theme.mutedForeground }]}>{count}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm }}
      >
        {photos.map((photo) => (
          <View key={photo.id} style={[styles.thumb, { backgroundColor: theme.muted }]}>
            <RemoteImage
              uri={photo.thumbnailUrl}
              cacheKey={photoKey(photo, 'thumb')}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              accessibilityIgnoresInvertColors
            />
          </View>
        ))}
        <PressableScale
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Add a photo to this entry"
          scaleTo={0.95}
          style={[styles.thumb, styles.addThumb, { borderColor: theme.borderStrong }]}
        >
          <Ionicons name="add" size={22} color={theme.mutedForeground} />
        </PressableScale>
      </ScrollView>
      {documents.length > 0 ? (
        <View style={[styles.card, cardSurface(theme)]}>
          {documents.map((document, place) => (
            <Fragment key={document.id}>
              {place > 0 ? <View style={[styles.rule, { backgroundColor: theme.border }]} /> : null}
              <DocumentLine document={document} vehicleId={vehicleId} />
            </Fragment>
          ))}
        </View>
      ) : null}
    </Rise>
  );
}

function DocumentLine({ document, vehicleId }: { document: VehicleDocument; vehicleId: string }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        router.push({
          pathname: '/document/[id]',
          params: { id: document.id, vehicleId, title: document.title },
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={document.title}
      scaleTo={0.99}
      style={styles.documentRow}
    >
      <Ionicons name="document-text-outline" size={18} color={theme.mutedForeground} />
      <Text numberOfLines={1} style={[typeScale.label, { flex: 1, color: theme.foreground }]}>
        {document.title}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
    </PressableScale>
  );
}

/** Where the entry came from, quietly, and the way to let it go. */
function Foot({
  event,
  vehicleName,
  onDelete,
}: {
  event: VehicleEvent;
  vehicleName: string | undefined;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const by = /^ai$/i.test(event.source) ? 'by the assistant' : event.source === 'IMPORT' ? 'imported' : null;
  return (
    <Rise index={7} style={styles.foot}>
      <Text style={[typeScale.caption, styles.logged, { color: theme.mutedForeground }]}>
        {[vehicleName, `Logged ${SHORT_DATE.format(new Date(event.createdAt))}`, by]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <PressableScale
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Delete this entry"
        scaleTo={0.96}
        style={[styles.delete, { backgroundColor: theme.destructiveSoft }]}
      >
        <Ionicons name="trash-outline" size={15} color={theme.destructive} />
        <Text style={[typeScale.label, { color: theme.destructive }]}>Delete entry</Text>
      </PressableScale>
    </Rise>
  );
}

/** The page before the entry arrives: the hero's shapes and the sheet's, waiting. */
function Placeholder() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading the entry"
      style={styles.content}
    >
      <View style={styles.hero}>
        <Skeleton width={DISC} height={DISC} radius={DISC / 2} />
        <View style={[styles.heroText, { gap: 10 }]}>
          <Skeleton width={150} height={18} />
          <Skeleton width={130} height={34} />
        </View>
        <Skeleton width={190} height={16} />
      </View>
      <Skeleton width="100%" height={128} radius={radius.xl} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg },
  content: { gap: spacing.lg },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: (BAR - 40) / 2,
  },
  barTitle: { flex: 1, textAlign: 'center' },
  key: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: { width: DISC, height: DISC, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: (DISC - HALO) / 2, left: (DISC - HALO) / 2 },
  hero: { alignItems: 'center', gap: 12, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  heroText: { alignItems: 'center', gap: 2 },
  title: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '600',
    letterSpacing: -0.3,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  amount: { flexDirection: 'row', alignItems: 'baseline' },
  whole: { fontSize: 40, lineHeight: 48, fontWeight: '600', letterSpacing: -1.4 },
  cents: { fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: -0.4 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroDate: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: -0.2 },
  card: { borderRadius: radius.xl + 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { paddingHorizontal: 14, paddingVertical: 12, gap: 5 },
  cellRight: { borderLeftWidth: StyleSheet.hairlineWidth },
  cellBelow: { borderTopWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 10, lineHeight: 13, fontWeight: '600', letterSpacing: 1 },
  factValue: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  reading: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  readingUnit: { fontSize: 11 },
  sub: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  half: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  halfBelow: { borderTopWidth: StyleSheet.hairlineWidth },
  halfHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  halfTitle: { flex: 1, fontSize: 13, lineHeight: 17, fontWeight: '600' },
  halfAside: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 8 },
  statRule: { width: StyleSheet.hairlineWidth, height: 16 },
  statLine: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  statValue: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.3 },
  statUnit: { flexShrink: 1, fontSize: 11, lineHeight: 14, fontWeight: '500' },
  verdict: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  barSlot: { flex: 1, height: BARS, alignItems: 'center', justifyContent: 'flex-end' },
  // Slim, whatever the count: wide blocks of near-equal bills read as a wall, not a trend.
  spendBar: {
    width: '60%',
    maxWidth: 20,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 1.5,
    borderBottomRightRadius: 1.5,
  },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontSize: 10, lineHeight: 13, fontWeight: '500' },
  note: { flexDirection: 'row', gap: 12, paddingHorizontal: 2 },
  noteRule: { width: 2, borderRadius: 1 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  attach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  thumb: { width: 84, height: 84, borderRadius: radius.lg, overflow: 'hidden' },
  addThumb: {
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rule: { height: StyleSheet.hairlineWidth, marginLeft: 42 },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  foot: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  logged: { textAlign: 'center' },
  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
  },
});
