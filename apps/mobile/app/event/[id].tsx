import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Share, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
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
import { EntryParts } from '@/components/parts-kit';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { HeaderKey } from '@/components/settings-kit';
import { fillQuantity, KindBadge, KindDisc, kindHue, splitCents } from '@/components/timeline';
import { api } from '@/lib/api';
import { fileParams, pickPhoto } from '@/lib/file-picker';
import { DATE_LOCALE, formatDistance, formatMoney, humanise } from '@/lib/format';
import { Segmented } from '@/lib/instrument';
import { economy, sincePrevious, spendWindow, unitPrice } from '@/lib/ledger';
import { haptic, Odometer, Pop, PressableScale, Rise } from '@/lib/motion';
import { cardSurface, figure, radius, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { Empty, Skeleton } from '@/lib/ui';
import { dialog, FAILED } from '@/lib/dialog';

/**
 * One entry, in full — drawn as a receipt is read: what it was and what it cost first, large, then
 * the rest on tabs rather than one long page (user asked). Details: the facts it records, each with
 * its icon, the note, and where it came from. Insights: what only the whole record can say — how
 * far and how long since the last one of its kind, what that fill did per 100, and how this bill
 * sits among the others, as bars that open the entry each one is. Files: what is filed against it.
 * The stack's own header carries the way back, share and delete, as the document screen's does.
 */

const DISC = 64;
/**
 * How far the kind's light reaches round the disc. It is spent by 85% of the way out, and the hero
 * stands far enough under the header for that to fit: the page's top would cut it otherwise.
 */
const HALO = 140;
/** How tall the spend bars stand at their dearest. */
const BARS = 64;

const FULL_DATE = new Intl.DateTimeFormat(DATE_LOCALE, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const SHORT_DATE = new Intl.DateTimeFormat(DATE_LOCALE, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const BAR_DATE = new Intl.DateTimeFormat(DATE_LOCALE, { month: 'short', day: 'numeric' });

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

type IconName = keyof typeof Ionicons.glyphMap;
type Tab = 'details' | 'insights' | 'files';

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
  const scroller = useRef<ScrollViewInstance>(null);
  const [tab, setTab] = useState<Tab>('details');

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
  const same = sameKind.data?.done.data ?? [];
  // Insights only when the record can say something: a last one of its kind, or bills to compare.
  const insightful =
    data !== undefined &&
    Boolean(sincePrevious(data, same) || (data.cost && spendWindow(data, same)));
  const fileCount = attachedPhotos.length + attachedDocuments.length;
  // A tab the entry turned to cannot show falls back to its details.
  const shown: Tab = tab === 'insights' && !insightful ? 'details' : tab;

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
      dialog('Could not open photos', (error as Error).message, undefined, FAILED);
    }
  };

  const addPhoto = () =>
    dialog(
      'Add a photo',
      undefined,
      [
        { text: 'Take a photo', onPress: () => void attach('camera') },
        { text: 'Choose from library', onPress: () => void attach('library') },
        { text: 'Cancel', style: 'cancel' },
      ],
      { icon: 'camera-outline' },
    );

  const remove = () => {
    haptic.selection();
    dialog(`Delete "${title || 'this entry'}"?`, 'Its cost leaves the totals too.', [
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
              dialog('Could not delete it', (error as Error).message, undefined, FAILED),
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

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      {/*
       * The app's header, as every pushed screen wears it: part of the page, not floating over it
       * (user asked). No title — the hero names the entry; share and delete are its round keys.
       */}
      <Stack.Screen
        options={{
          title: '',
          headerRight: () =>
            data ? (
              <>
                <HeaderKey icon="share-outline" label="Share this entry" onPress={share} />
                <HeaderKey
                  icon="trash-outline"
                  label="Delete this entry"
                  color={theme.destructive}
                  onPress={remove}
                />
              </>
            ) : null,
        }}
      />
      {event.isError ? (
        <Empty title="Entry not found" description="It may have been deleted." />
      ) : (
        <ScrollView
          ref={scroller}
          contentContainerStyle={[
            styles.page,
            { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl },
          ]}
        >
          {data ? (
            // Keyed, so turning to another entry plays its arrival again.
            <View key={data.id} style={styles.content}>
              <Hero event={data} title={title} glow={tint ?? theme.primary} />
              <Rise index={3}>
                <Segmented
                  small
                  value={shown}
                  options={[
                    { value: 'details', label: 'Details' },
                    ...(insightful ? [{ value: 'insights' as const, label: 'Insights' }] : []),
                    {
                      value: 'files',
                      label: fileCount > 0 ? `Files · ${fileCount}` : 'Files',
                      said: `Files, ${fileCount}`,
                    },
                  ]}
                  onChange={setTab}
                />
              </Rise>
              {/* Keyed by the tab too, so each one arrives as the page did. */}
              <View key={shown} style={styles.content}>
                {shown === 'details' ? (
                  <>
                    <Facts event={data} delta={delta} />
                    <Note event={data} tint={tint ?? theme.borderStrong} />
                    <EntryParts
                      vehicleId={vehicleId}
                      eventId={data.id}
                      index={5}
                      label={<Label icon="construct-outline">Parts & fluids</Label>}
                    />
                    <Record event={data} vehicleName={vehicle.data?.displayName} />
                  </>
                ) : shown === 'insights' ? (
                  <Context
                    event={data}
                    sameKind={same}
                    tint={tint ?? theme.foreground}
                    onOpen={open}
                  />
                ) : (
                  <Attachments
                    photos={attachedPhotos}
                    documents={attachedDocuments}
                    vehicleId={vehicleId}
                    onAdd={addPhoto}
                  />
                )}
              </View>
            </View>
          ) : (
            <Placeholder />
          )}
        </ScrollView>
      )}
    </View>
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
          <Stop offset="0.45" stopColor={color} stopOpacity={theme.dark ? 0.1 : 0.08} />
          <Stop offset="0.85" stopColor={color} stopOpacity={0} />
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
        <Ionicons name="calendar-outline" size={12} color={theme.mutedForeground} />
        <Text style={[figure, styles.heroDate, { color: theme.mutedForeground }]}>{day}</Text>
      </Rise>
    </View>
  );
}

type Fact = {
  key: string;
  icon: IconName;
  label: string;
  /** What a screen reader says for the value. */
  said: string;
  value: ReactNode;
  /** A small signed figure under the value: the odometer since the reading before. */
  sub?: { text: string; color: string } | null;
};

/**
 * Everything else the entry records, as a spec sheet: two columns, hairlines between, its icon and
 * a small tracked label over each value — the odometer on its drums, what went in and what a litre
 * of it cost, where, the engine's hours, a trip's purpose and claim. Only what is there is drawn.
 */
function Facts({ event, delta }: { event: VehicleEvent; delta: number | null }) {
  const theme = useTheme();
  const { quantity } = fillQuantity(event.eventType, event.description);
  const price = unitPrice(event.cost, quantity);
  const unit = event.odometerUnit === 'MI' ? 'mi' : 'km';
  const value = (text: string, mono = true) => (
    <Text
      numberOfLines={2}
      style={[mono ? figure : null, styles.factValue, { color: theme.foreground }]}
    >
      {text}
    </Text>
  );
  // Side by side, not nested, like the hero: the cents quieter than the amount.
  const money = (amount: Parameters<typeof splitCents>[0]) => {
    const [whole, cents] = splitCents(amount);
    return (
      <View style={styles.amount}>
        <Text style={[figure, styles.factValue, { color: theme.foreground }]}>{whole}</Text>
        {cents ? (
          <Text style={[figure, styles.factCents, { color: theme.mutedForeground }]}>{cents}</Text>
        ) : null}
      </View>
    );
  };

  const facts: Fact[] = [];
  if (event.odometer !== null) {
    facts.push({
      key: 'odometer',
      icon: 'speedometer-outline',
      label: 'Odometer',
      said: formatDistance(event.odometer, event.odometerUnit),
      value: (
        <View style={styles.reading}>
          <Odometer value={event.odometer} size={15} />
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
    facts.push({
      key: 'where',
      icon: 'location-outline',
      label: 'Where',
      said: event.provider,
      value: value(event.provider, false),
    });
  }
  if (quantity) {
    facts.push({
      key: 'quantity',
      icon: event.eventType === 'CHARGE' ? 'flash-outline' : 'water-outline',
      label: event.eventType === 'CHARGE' ? 'Charged' : 'Filled',
      said: quantity,
      value: value(quantity),
    });
  }
  if (price) {
    facts.push({
      key: 'price',
      icon: 'pricetag-outline',
      label: `Per ${price.per}`,
      said: `${formatMoney(price.price)} per ${price.per}`,
      value: money(price.price),
    });
  }
  if (event.engineHours !== null) {
    facts.push({
      key: 'hours',
      icon: 'time-outline',
      label: 'Engine hours',
      said: `${event.engineHours.toLocaleString()} hours`,
      value: value(`${event.engineHours.toLocaleString()} h`),
    });
  }
  if (event.trip) {
    facts.push({
      key: 'purpose',
      icon: 'briefcase-outline',
      label: 'Purpose',
      said: humanise(event.trip.purpose),
      value: value(humanise(event.trip.purpose), false),
    });
    // The hero already says the distance when nothing was paid.
    if (event.cost) {
      const distance = formatDistance(event.trip.distance, event.odometerUnit);
      facts.push({
        key: 'distance',
        icon: 'navigate-outline',
        label: 'Distance',
        said: distance,
        value: value(distance),
      });
    }
    if (event.trip.deduction) {
      facts.push({
        key: 'deduction',
        icon: 'receipt-outline',
        label: 'Deduction',
        said: formatMoney(event.trip.deduction),
        value: money(event.trip.deduction),
        sub: event.trip.rate
          ? { text: `${formatMoney(event.trip.rate)}/${unit}`, color: theme.mutedForeground }
          : null,
      });
    }
  }
  if (facts.length === 0) return null;

  return (
    <Rise index={4} style={[styles.card, cardSurface(theme)]}>
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
              <Label icon={fact.icon}>{fact.label}</Label>
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

  // Each figure under its icon and name, its unit beside it; `said` is the same for a screen reader.
  const stats: { icon: IconName; label: string; value: string; unit: string; said: string }[] = [];
  if (since?.distance) {
    const driven = formatDistance(since.distance, event.odometerUnit);
    stats.push({
      icon: 'navigate-outline',
      label: 'Driven',
      value: driven.split(' ')[0]!,
      unit,
      said: `${driven} driven`,
    });
  }
  if (since) {
    const days = since.days === 1 ? 'day' : 'days';
    stats.push(
      since.days === 0
        ? {
            icon: 'calendar-outline',
            label: 'Apart',
            value: 'Same',
            unit: 'day',
            said: 'the same day',
          }
        : {
            icon: 'calendar-outline',
            label: 'Apart',
            value: String(since.days),
            unit: days,
            said: `${since.days} ${days} apart`,
          },
    );
  }
  const fill = economy(quantity, since?.distance ?? null, event.odometerUnit);
  if (fill) {
    const [figureText, ...rest] = fill.split(' ');
    stats.push({
      icon: 'leaf-outline',
      label: 'Economy',
      value: figureText!,
      unit: rest.join(' '),
      said: fill,
    });
  }
  if (
    event.cost &&
    since?.distance &&
    (event.eventType === 'FUEL' || event.eventType === 'CHARGE')
  ) {
    const running = formatMoney({
      amountMinor: event.cost.amountMinor / since.distance,
      currency: event.cost.currency,
    });
    stats.push({
      icon: 'cash-outline',
      label: 'Cost',
      value: running,
      unit: `/${unit}`,
      said: `${running} per ${unit}`,
    });
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
          {/* Side by side while they fit; four go two by two. */}
          <View style={styles.stats}>
            {stats.map((stat) => (
              <View
                key={stat.said}
                accessible
                accessibilityLabel={stat.said}
                style={[
                  styles.stat,
                  { backgroundColor: theme.muted },
                  stats.length === 4 ? styles.statHalf : null,
                ]}
              >
                <Label icon={stat.icon}>{stat.label}</Label>
                <View style={styles.statLine}>
                  <Text
                    numberOfLines={1}
                    style={[figure, styles.statValue, { color: theme.foreground }]}
                  >
                    {stat.value}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.statUnit, { color: theme.mutedForeground }]}
                  >
                    {stat.unit}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {spend && event.cost ? (
        <View
          style={[styles.half, since ? [styles.halfBelow, { borderTopColor: theme.border }] : null]}
        >
          <View style={styles.halfHead}>
            <Verdict
              amount={event.cost.amountMinor}
              typical={spend.typical}
              kind={event.eventType}
            />
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
      <Text
        numberOfLines={1}
        style={[styles.halfTitle, { flexShrink: 1, color: theme.foreground }]}
      >
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
                style={[styles.spendBar, { height, backgroundColor: mine ? tint : `${tint}2E` }]}
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
        <Line
          x1="0"
          x2="100%"
          y1={BARS - 0.5}
          y2={BARS - 0.5}
          stroke={theme.border}
          strokeWidth={1}
        />
      </Svg>
    </View>
  );
}

/** The note, on a card of its own: a rule in the kind's colour and the words beside it. */
function Note({ event, tint }: { event: VehicleEvent; tint: string }) {
  const theme = useTheme();
  // A fill's quantity is a fact above; the note is what is left of it.
  const { rest } = fillQuantity(event.eventType, event.description);
  if (!rest) return null;
  return (
    <Rise index={5} style={[styles.card, styles.note, cardSurface(theme)]}>
      <View style={[styles.noteRule, { backgroundColor: tint }]} />
      <View style={{ flex: 1, gap: 6 }}>
        <Label icon="reader-outline">Note</Label>
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
      <Rise index={4}>
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
    <Rise index={4} style={{ gap: spacing.md }}>
      {/* The tab already says how many: the photos as a rail, the way to add one at its end. */}
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

/**
 * Where the entry belongs and came from, as rows: the vehicle, the day it was logged, and who
 * logged it when it was not typed in by hand. Delete is the header's.
 */
function Record({ event, vehicleName }: { event: VehicleEvent; vehicleName: string | undefined }) {
  const theme = useTheme();
  const rows: { icon: IconName; label: string; value: string }[] = [
    ...(vehicleName
      ? [{ icon: 'car-outline' as const, label: 'Vehicle', value: vehicleName }]
      : []),
    {
      icon: 'create-outline',
      label: 'Logged',
      value: SHORT_DATE.format(new Date(event.createdAt)),
    },
    ...(/^ai$/i.test(event.source)
      ? [{ icon: 'sparkles-outline' as const, label: 'Added by', value: 'Assistant' }]
      : event.source === 'IMPORT'
        ? [{ icon: 'cloud-download-outline' as const, label: 'Source', value: 'Imported' }]
        : []),
  ];
  return (
    <Rise index={6} style={[styles.card, cardSurface(theme)]}>
      {rows.map((row, place) => (
        <Fragment key={row.label}>
          {place > 0 ? <View style={[styles.rule, { backgroundColor: theme.border }]} /> : null}
          <View accessible accessibilityLabel={`${row.label}, ${row.value}`} style={styles.line}>
            <Ionicons name={row.icon} size={17} color={theme.mutedForeground} />
            <Text style={[typeScale.label, styles.lineLabel, { color: theme.mutedForeground }]}>
              {row.label}
            </Text>
            <Text
              numberOfLines={1}
              style={[typeScale.label, styles.lineValue, { color: theme.foreground }]}
            >
              {row.value}
            </Text>
          </View>
        </Fragment>
      ))}
    </Rise>
  );
}

/** A small tracked name under its icon's lead, over a figure or a fact. */
function Label({ icon, children }: { icon: IconName; children: string }) {
  const theme = useTheme();
  return (
    <View style={styles.labelRow}>
      <Ionicons name={icon} size={12} color={theme.mutedForeground} />
      <Text numberOfLines={1} style={[styles.label, { color: theme.mutedForeground }]}>
        {children.toUpperCase()}
      </Text>
    </View>
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
      <Skeleton width="100%" height={128} style={leaf('md')} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  content: { gap: spacing.md },
  disc: { width: DISC, height: DISC, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: (DISC - HALO) / 2, left: (DISC - HALO) / 2 },
  hero: { alignItems: 'center', gap: 10, paddingTop: spacing.xl, paddingBottom: spacing.xs },
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
  whole: { fontSize: 36, lineHeight: 44, fontWeight: '600', letterSpacing: -1.2 },
  cents: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.4 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroDate: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: -0.2 },
  card: leaf('md'),
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { paddingHorizontal: 14, paddingVertical: 12, gap: 5 },
  cellRight: { borderLeftWidth: StyleSheet.hairlineWidth },
  cellBelow: { borderTopWidth: StyleSheet.hairlineWidth },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  label: { flexShrink: 1, fontSize: 9.5, lineHeight: 12, fontWeight: '700', letterSpacing: 0.7 },
  factValue: { fontSize: 20, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },
  factCents: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  reading: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  readingUnit: { fontSize: 9, opacity: 0.75 },
  sub: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  half: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  halfBelow: { borderTopWidth: StyleSheet.hairlineWidth },
  halfHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  halfTitle: { flex: 1, fontSize: 13, lineHeight: 17, fontWeight: '600' },
  halfAside: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // Equal tiles on the muted wash, as the dash's readings sit.
  stat: { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 4, padding: 10, borderRadius: radius.lg },
  statHalf: { flexBasis: '40%' },
  statLine: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  statValue: {
    flexShrink: 1,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  statUnit: { flexShrink: 1, fontSize: 9, lineHeight: 11, fontWeight: '500', opacity: 0.75 },
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
  note: { flexDirection: 'row', gap: 12, padding: 14 },
  noteRule: { width: 2, borderRadius: 1 },
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
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 14,
  },
  lineLabel: { fontWeight: '500' },
  lineValue: { flex: 1, textAlign: 'right' },
});
