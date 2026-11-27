import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  Animated,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import type { Dashboard, Garage, Vehicle } from '@vehicle-os/contracts';
import type { DocumentType } from '@vehicle-os/domain';
import { dashboardQuery, garagesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { dueGauge, groupByMonth, spanOfDays } from '@vehicle-os/ui';
import { BrandLogo } from '@/components/brand-logo';
import {
  DashAction,
  DashCard,
  DashCell,
  DashCellSkeleton,
  DashReading,
  DashReadings,
  DashRow,
  DashRows,
  DashTag,
  DashValue,
  DASH_SHAPE,
} from '@/components/dash';
import { useDockSpace } from '@/components/dock';
import { NotificationBell } from '@/components/notification-bell';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { bayCard, EmptyBay, Showroom, ShowroomSkeleton, type BayFlag } from '@/components/showroom';
import { LedgerCard, LedgerMonth, LedgerRow } from '@/components/timeline';
import { useSpent, vehicleIcon } from '@/components/vehicle-card';
import { openAdd, type AddRequest } from '@/lib/add-request';
import { markSetupOffered, wasSetupOffered } from '@/lib/onboarding';
import { api } from '@/lib/api';
import { jobEmoji } from '@/lib/emoji';
import { ledgerDate } from '@/lib/ledger';
import {
  compactMoney,
  DATE_LOCALE,
  formatDistance,
  formatMoney,
  humanise,
  pad,
  TWELVE_HOUR,
} from '@/lib/format';
import { SectionHeading } from '@/lib/instrument';
import {
  ease,
  Gauge,
  haptic,
  PressableScale,
  Rise,
  useNow,
  useOnScreen,
  useReduceMotion,
  useScrollY,
} from '@/lib/motion';
import { figure, lift, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { Button, Empty, Face, Skeleton } from '@/lib/ui';
import { useProfile } from '@/lib/vehicle-units';

const PAGE = spacing.lg;
const DAY = new Intl.DateTimeFormat(DATE_LOCALE, {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});
const TIME = new Intl.DateTimeFormat(DATE_LOCALE, { hour: 'numeric', minute: '2-digit' });

/** Pull to rev: iOS overscrolls past the top, so the pull can drive a tachometer. */
const REV = Platform.OS === 'ios';
/** How far a pull goes to put the needle on the stop — about where iOS starts refreshing. */
const REV_FULL = 120;
const REV_SIZE = 92;

/** Morning from five, afternoon from noon, evening from six — and evening again until five. */
function salutationFor(hour: number) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The garage right now (PRD §25), opened like one: the dash, where the cluster greets the person,
 * lights a telltale for whatever is waiting and reads it out; their vehicles, each in its own lit
 * bay behind a door that rolls up the first time; the garages as floors of bays; and the recent
 * record as the logbook it is.
 *
 * On iOS the pull to refresh is a rev: the overscroll drives a tachometer, the thumb feels each
 * thousand, and the stop is where the garage is read again.
 */
export default function GarageScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dockSpace = useDockSpace();
  const [refreshing, setRefreshing] = useState(false);
  // The rev's last thousand and whether it is refreshing, read by the scroll listener.
  const engine = useRef({ rpm: 0, refreshing: false });
  const { y, onScroll } = useScrollY(
    REV
      ? (offset) => {
          if (engine.current.refreshing) return;
          const rpm = Math.max(0, Math.min(8, Math.floor((-offset / REV_FULL) * 8)));
          if (rpm > engine.current.rpm) haptic.selection();
          engine.current.rpm = rpm;
        }
      : undefined,
  );
  const dashboard = useQuery(dashboardQuery(api));
  const vehicles = useQuery(vehiclesQuery(api));
  const garages = useQuery(garagesQuery(api));
  const profile = useProfile();

  const data = dashboard.data;
  const vehicleList = vehicles.data?.data ?? [];
  const garageList = garages.data ?? [];
  const spent = useSpent(vehicleList);
  // Built once per dashboard, so what reads it — the card, the bays' flags — sees one list.
  const items = useMemo(() => (data ? itemsFrom(data.attention) : []), [data]);
  const flags = useMemo(() => flagsByVehicle(items), [items]);

  const byGarage = new Map<string, Vehicle[]>();
  for (const vehicle of vehicleList) {
    byGarage.set(vehicle.garageId, [...(byGarage.get(vehicle.garageId) ?? []), vehicle]);
  }
  const attention = attentionByGarage(data?.attention, vehicles.data?.data);
  const parked = !vehicles.isPending && vehicleList.length > 0;

  // An account with no garage yet is a first run: the setup opens by itself, once a session.
  const noGarage = Boolean(data && data.summary.garages === 0);
  useEffect(() => {
    if (!noGarage || wasSetupOffered()) return;
    markSetupOffered();
    router.push('/onboarding');
  }, [noGarage, router]);

  const refresh = () => {
    engine.current.refreshing = true;
    // On iOS the needle has just hit the stop: the limiter, felt.
    if (REV) haptic.warning();
    setRefreshing(true);
    void Promise.allSettled([dashboard.refetch(), vehicles.refetch(), garages.refetch()]).then(
      () => {
        engine.current.refreshing = false;
        setRefreshing(false);
      },
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + spacing.sm, paddingBottom: dockSpace },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            // On iOS the tachometer is the indicator; the system spinner would sit over it.
            tintColor={REV ? 'transparent' : theme.primary}
            colors={[theme.primary]}
            progressBackgroundColor={theme.popover}
          />
        }
      >
        {REV ? <RevMeter y={y} refreshing={refreshing} top={insets.top} /> : null}

        {/*
         * One row for who and when, and the two ways out — the bell and You. The wordmark is the
         * icon the app was opened from; the space it took goes to the garage.
         */}
        <Rise style={styles.topBar}>
          <Greeting name={profile.data?.name ?? ''} />
          <View style={styles.topActions}>
            <NotificationBell />
            {/* The web's avatar, the way to You. */}
            <PressableScale
              onPress={() => router.push('/settings')}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={profile.data?.name ? `You, ${profile.data.name}` : 'You'}
              scaleTo={0.86}
            >
              <Face user={profile.data} size={38} />
            </PressableScale>
          </View>
        </Rise>

        {dashboard.isError && !data ? (
          <Rise index={1}>
            <Empty
              title="Could not load your garage"
              description={dashboard.error.message}
              action={
                <Button
                  label="Try again"
                  variant="primary"
                  onPress={() => void dashboard.refetch()}
                  loading={dashboard.isFetching}
                />
              }
            />
          </Rise>
        ) : data && data.summary.garages === 0 ? (
          <Rise index={1}>
            <Empty
              title="Welcome to Garajj"
              description="Start with a garage. It holds your vehicles and the people you share them with."
              action={
                <Button
                  label="Set up my garage"
                  icon="key"
                  variant="primary"
                  onPress={() => router.push('/onboarding')}
                />
              }
            />
          </Rise>
        ) : (
          <>
            <Rise index={1} style={styles.heroGap}>
              <GarageDash data={data} vehicles={vehicleList} flags={flags} items={items} />
            </Rise>

            <Rise index={3}>
              {vehicles.isPending ? (
                <ShowroomSkeleton />
              ) : parked ? (
                <Showroom vehicles={vehicleList} spent={spent} flags={flags} />
              ) : (
                <EmptyBay onAdd={() => router.push('/add/vehicle')} />
              )}
            </Rise>

            {/*
             * The garages, as a rail rather than a line of text — and the way to add one sits at
             * the end of the row it will join.
             */}
            <Rise index={4} style={styles.section}>
              <SectionHeading
                title="Garages"
                count={garages.isPending ? undefined : garageList.length}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={GARAGE + spacing.md}
                decelerationRate="fast"
                style={{ marginHorizontal: -PAGE }}
                contentContainerStyle={styles.rail}
              >
                {garages.isPending
                  ? [0, 1].map((key) => (
                      <Skeleton key={key} width={GARAGE} height={128} style={leaf('md')} />
                    ))
                  : garageList.map((garage, index) => (
                      <Rise key={garage.id} index={index}>
                        <GarageCard
                          garage={garage}
                          vehicles={byGarage.get(garage.id)}
                          attention={attention ? (attention.get(garage.id) ?? null) : undefined}
                          onPress={() =>
                            router.push({ pathname: '/garage/[id]', params: { id: garage.id } })
                          }
                        />
                      </Rise>
                    ))}
                <NewGarageTile onPress={() => router.push('/add/garage')} />
              </ScrollView>
            </Rise>

            {data && data.recentActivity.length > 0 ? (
              <Rise index={5} style={styles.section}>
                <RecentActivity data={data} />
              </Rise>
            ) : null}
          </>
        )}
      </Animated.ScrollView>
    </View>
  );
}

type Flag = 'late' | 'soon';
type Kind = 'service' | 'papers' | 'recalls';

/**
 * Who and when, in one line under a quiet stamp: the day and the time over "Good afternoon, Alex" —
 * the greeting muted, the name in the page's ink.
 */
function Greeting({ name }: { name: string }) {
  const theme = useTheme();
  const now = useNow();
  const firstName = name.trim().split(/\s+/)[0] ?? '';
  const salutation = salutationFor(now.getHours());
  return (
    <View
      style={styles.greeting}
      accessible
      accessibilityRole="header"
      accessibilityLabel={firstName ? `${salutation}, ${firstName}` : salutation}
    >
      <View style={styles.when}>
        <Text style={[figure, styles.day, { color: theme.mutedForeground }]}>
          {DAY.format(now).replace(',', '').toUpperCase()}
        </Text>
        <View style={[styles.whenDot, { backgroundColor: theme.borderStrong }]} />
        <Clock now={now} />
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={[styles.hello, { color: theme.foreground }]}
      >
        {firstName ? (
          <>
            {/* Its own weight: a nested Text is patched to its own font file (`lib/fonts`). */}
            <Text style={[styles.hello, { color: theme.mutedForeground }]}>{salutation}, </Text>
            {firstName}
          </>
        ) : (
          salutation
        )}
      </Text>
    </View>
  );
}

/**
 * The garage at a glance, as the vehicle hero's dash is drawn: one raised card, three readings along
 * its top — the fleet first and largest, straight on the card with no tile, its count beside each
 * vehicle's mark tinted by what it is waiting on; then on tiles what it is worth and what running it
 * has cost, this month's share beside the word — and
 * under them what needs the person, most pressing first: its glyph, what and whose, how due in its
 * tone, and the one thing to do about it. Three show; the rest wait behind "more". With nothing
 * waiting, one row says so and offers to plan a reminder.
 */
function GarageDash({
  data,
  vehicles,
  flags,
  items,
}: {
  data: Dashboard | undefined;
  vehicles: readonly Vehicle[];
  flags: ReadonlyMap<string, BayFlag>;
  items: readonly Item[];
}) {
  const theme = useTheme();
  const router = useRouter();
  const narrow = useWindowDimensions().width < 360;
  const [open, setOpen] = useState(false);

  if (!data) {
    return (
      <View style={[DASH_SHAPE, lift(theme, 'low')]}>
        <DashCard>
          <DashReadings>
            <View style={styles.fleetSlot}>
              <View style={styles.fleet}>
                <Skeleton width={22} height={26} radius={6} />
                <View style={styles.fleetSide}>
                  <Skeleton width={44} height={14} />
                  <Skeleton width={40} height={8} />
                </View>
              </View>
            </View>
            <DashCellSkeleton label="Worth" />
            <DashCellSkeleton label="Spent" />
          </DashReadings>
          <DashRows>
            <View style={styles.rowSkeleton}>
              <Skeleton width={18} height={18} radius={9} />
              <Skeleton width="48%" height={12} />
            </View>
          </DashRows>
        </DashCard>
      </View>
    );
  }

  // In the currency most of it is in: a second currency is left out, never added in wrongly.
  const spend = Object.values(data.vehicleSpend);
  const counts = new Map<string, number>();
  for (const money of spend) counts.set(money.currency, (counts.get(money.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const total = spend
    .filter((money) => money.currency === currency)
    .reduce((sum, money) => sum + money.amountMinor, 0);
  const worth = data.summary.totalValue;
  const month = data.summary.spentThisMonth;
  const waiting = vehicles.filter((vehicle) => flags.has(vehicle.id)).length;
  const toneOf = (vehicle: Vehicle) => {
    const flag = flags.get(vehicle.id);
    return flag?.late ? theme.destructive : flag?.soon ? theme.warning : theme.primary;
  };
  const shown = open ? items : items.slice(0, NEXT_SHOWN);
  const hidden = items.length - NEXT_SHOWN;
  const plural = vehicles.length === 1 ? 'vehicle' : 'vehicles';

  return (
    // The lift on a wrapper: a shadow on the view that clips its corners is clipped with them.
    <View style={[DASH_SHAPE, lift(theme, 'low')]}>
      <DashCard>
        <DashReadings>
          {/*
           * The fleet, the dash's lead: no tile, a figure a size up from the rest, and each vehicle's
           * mark bare in the colour of what it waits on — the copper of the garage when nothing.
           */}
          <Rise index={2} style={styles.fleetSlot}>
            <PressableScale
              onPress={() => {
                haptic.selection();
                router.push('/vehicles');
              }}
              accessibilityRole="button"
              accessibilityLabel={`${vehicles.length} ${plural}${waiting ? `, ${waiting} due` : ''}`}
              accessibilityHint="Opens Vehicles"
              scaleTo={0.96}
              style={styles.fleet}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                style={[figure, styles.fleetCount, { color: theme.foreground }]}
              >
                {vehicles.length}
              </Text>
              <View style={styles.fleetSide}>
                <FleetMarks vehicles={vehicles} toneOf={toneOf} max={narrow ? 2 : 3} />
                <Text
                  numberOfLines={1}
                  style={[styles.fleetWord, { color: theme.mutedForeground }]}
                >
                  {plural.toUpperCase()}
                </Text>
              </View>
            </PressableScale>
          </Rise>
          <DashCell
            icon="pricetag-outline"
            label="Worth"
            said={`Worth ${worth ? compactMoney(worth.amountMinor, worth.currency) : 'not known'}`}
            index={3}
            narrow={narrow}
          >
            <DashReading>
              {worth ? (
                <DashValue
                  narrow={narrow}
                  count={{
                    value: worth.amountMinor,
                    format: (amount) => compactMoney(amount, worth.currency),
                  }}
                />
              ) : (
                <DashValue muted narrow={narrow}>
                  —
                </DashValue>
              )}
            </DashReading>
          </DashCell>
          <DashCell
            icon="wallet-outline"
            label="Spent"
            said={`Spent ${currency ? compactMoney(total, currency) : 'nothing'} to run${month && month.amountMinor > 0 ? `, ${compactMoney(month.amountMinor, month.currency)} of it this month` : ''}`}
            aside={
              month && month.amountMinor > 0 && !narrow ? (
                <DashTag color={theme.primary} wash={theme.primarySoft}>
                  +{compactMoney(month.amountMinor, month.currency)}
                </DashTag>
              ) : null
            }
            index={4}
            narrow={narrow}
          >
            <DashReading>
              {currency ? (
                <DashValue
                  narrow={narrow}
                  count={{ value: total, format: (amount) => compactMoney(amount, currency) }}
                />
              ) : (
                <DashValue muted narrow={narrow}>
                  —
                </DashValue>
              )}
            </DashReading>
          </DashCell>
        </DashReadings>

        <DashRows>
          {items.length === 0 ? (
            <DashRow
              emoji={<Ionicons name="checkmark-circle" size={18} color={theme.primary} />}
              title="Nothing needs you"
              whose={data.briefing[0] ?? 'Every service, paper and recall is in hand.'}
              tone="neutral"
              accessibilityLabel={`All clear. ${data.briefing[0] ?? 'Every service, paper and recall is in hand.'}`}
              trailing={
                <DashAction
                  icon="add"
                  label="Plan a reminder"
                  quiet
                  onPress={() => openAdd({ mode: 'planned' })}
                />
              }
            />
          ) : (
            shown.map((item, place) => {
              const act = actionFor(item);
              return (
                <DashRow
                  key={item.key}
                  emoji={item.emoji}
                  title={item.title}
                  whose={item.vehicle}
                  status={item.short}
                  tone={item.tone === 'late' ? 'destructive' : 'warning'}
                  onPress={() =>
                    router.push({ pathname: '/vehicle/[id]', params: { id: item.vehicleId } })
                  }
                  accessibilityLabel={`${item.title}, ${item.vehicle}, ${item.due}`}
                  accessibilityHint={`Opens ${item.vehicle}`}
                  index={5 + Math.min(place, NEXT_SHOWN)}
                  divided={place > 0}
                  trailing={
                    <DashAction
                      icon={act.icon}
                      label={`${act.label}: ${item.title}`}
                      onPress={() => {
                        if ('add' in act) openAdd(act.add);
                        else router.push(act.href);
                      }}
                    />
                  }
                />
              );
            })
          )}
          {hidden > 0 ? (
            <PressableScale
              onPress={() => {
                haptic.selection();
                setOpen((was) => !was);
              }}
              accessibilityRole="button"
              accessibilityLabel={open ? 'Show fewer' : `Show ${hidden} more`}
              scaleTo={0.97}
              style={styles.more}
            >
              <View style={[styles.moreRule, { backgroundColor: theme.border }]} />
              <Text style={[styles.moreText, { color: theme.mutedForeground }]}>
                {open ? 'Show fewer' : `${hidden} more`}
              </Text>
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={12}
                color={theme.mutedForeground}
              />
            </PressableScale>
          ) : null}
        </DashRows>
      </DashCard>
    </View>
  );
}

/**
 * The fleet beside its count: each vehicle's mark, bare, in the colour of what it waits on — late
 * red, soon amber, copper when nothing — and the rest a count.
 */
function FleetMarks({
  vehicles,
  toneOf,
  max,
}: {
  vehicles: readonly Vehicle[];
  toneOf: (vehicle: Vehicle) => string;
  max: number;
}) {
  const theme = useTheme();
  const shown = vehicles.slice(0, max);
  const more = vehicles.length - shown.length;
  return (
    <View
      style={styles.marks}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shown.map((vehicle) => (
        <Ionicons
          key={vehicle.id}
          name={vehicleIcon(vehicle.vehicleType).replace('-outline', '') as IoniconName}
          size={15}
          color={toneOf(vehicle)}
        />
      ))}
      {more > 0 ? (
        <Text style={[figure, styles.marksMore, { color: theme.mutedForeground }]}>+{more}</Text>
      ) : null}
    </View>
  );
}

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** What needs the person, shown before the rest wait behind "more". */
const NEXT_SHOWN = 3;

/** The one thing to do about an item, where it is done: a screen, or the + drawer's form. */
function actionFor(item: Item): {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
} & ({ href: Href } | { add: AddRequest }) {
  if (item.kind === 'papers') {
    return {
      label: 'Renew',
      icon: 'refresh',
      href: {
        pathname: '/add/document',
        params: {
          vehicleId: item.vehicleId,
          ...(item.documentType ? { documentType: item.documentType } : {}),
        },
      },
    };
  }
  if (item.kind === 'recalls') {
    return { label: 'Check', icon: 'shield-checkmark', href: '/notifications' };
  }
  // The schedule itself, so the drawer's form opens on completing it.
  return {
    label: 'Log',
    icon: 'checkmark',
    add: {
      vehicleId: item.vehicleId,
      kind: 'MAINTENANCE',
      ...(item.planId ? { planId: item.planId } : {}),
    },
  };
}

/** The time, its colon blinking the seconds away — on the native driver, so nothing re-renders. */
function Clock({ now }: { now: Date }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const onScreen = useOnScreen();
  const [blink] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduce || !onScreen) {
      blink.setValue(1);
      return;
    }
    const to = (toValue: number) =>
      Animated.timing(blink, {
        toValue,
        duration: 90,
        easing: ease.standard,
        useNativeDriver: true,
      });
    const loop = Animated.loop(
      Animated.sequence([Animated.delay(410), to(0.15), Animated.delay(410), to(1)]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink, reduce, onScreen]);
  const style = [figure, styles.day, { color: theme.foreground }];
  return (
    <View accessible accessibilityLabel={TIME.format(now)} style={styles.clock}>
      {/* The region's clock: 3:07 in New York, 15:07 in London — as the label says it too. */}
      <Text style={style}>{TWELVE_HOUR ? now.getHours() % 12 || 12 : pad(now.getHours())}</Text>
      <Animated.Text style={[style, { opacity: blink }]}>:</Animated.Text>
      <Text style={style}>{pad(now.getMinutes())}</Text>
    </View>
  );
}

interface Item {
  key: string;
  tone: Flag;
  kind: Kind;
  title: string;
  vehicle: string;
  /** When, in words: "Overdue by 3 months", "Expires in 4 days". */
  due: string;
  /** The same, in a chip's few characters: "4 mo late", "In 12 d", "Expired", "Recall". */
  short: string;
  vehicleId: string;
  /** The job's glyph, in the web's own artwork. */
  emoji: string;
  /** A paper's kind, so renewing it opens on the same one. */
  documentType?: DocumentType;
  /** A service's schedule, so logging it completes that one. */
  planId?: string;
}

/** A schedule's due in words, as the web's `readDue` says it. */
function dueLine(plan: Dashboard['attention']['maintenance'][number]['plan'], unit: string | null) {
  const gauge = dueGauge(plan);
  if (!gauge) return plan.status === 'OVERDUE' ? 'Overdue' : 'Due soon';
  const amount = gauge.byDistance
    ? formatDistance(Math.abs(gauge.remaining), unit)
    : spanOfDays(Math.abs(gauge.remaining));
  return gauge.remaining < 0 ? `Overdue by ${amount}` : `Due in ${amount}`;
}

/** A span in the fewest characters a stub has room for: 12 d, 4 mo, 2 yr. */
function shortSpan(days: number): string {
  if (days < 60) return `${days} d`;
  if (days < 730) return `${Math.round(days / 30.44)} mo`;
  return `${Math.round(days / 365.25)} yr`;
}

/** How due a schedule is, as its chip says it: "580 km late", "In 12 d". */
function shortDue(
  plan: Dashboard['attention']['maintenance'][number]['plan'],
  unit: string | null,
) {
  const gauge = dueGauge(plan);
  if (!gauge) return plan.status === 'OVERDUE' ? 'Overdue' : 'Due soon';
  const amount = gauge.byDistance
    ? formatDistance(Math.abs(gauge.remaining), unit)
    : shortSpan(Math.abs(gauge.remaining));
  if (gauge.remaining === 0) return 'Due now';
  return gauge.remaining < 0 ? `${amount} late` : `In ${amount}`;
}

/** A paper's glyph: the notification's own for the kinds it names, a note for the rest. */
const PAPER: Partial<Record<DocumentType, string>> = {
  REGISTRATION: '📋',
  INSURANCE: '🛡️',
  WARRANTY: '🧾',
  INSPECTION_REPORT: '🔍',
};

/** A recall's component as a person reads it: NHTSA's `EQUIPMENT:OTHER:LABELS` as `Equipment · Other · Labels`. */
function readable(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text
    .split(':')
    .map((part) => humanise(part.trim()))
    .join(' · ');
}

/**
 * What needs the person, most urgent first: services overdue, then papers expired, then recalls
 * that may apply, then what is merely coming — the web greeting's order.
 */
function itemsFrom(attention: Dashboard['attention']): Item[] {
  const items: (Item & { rank: number })[] = [];
  for (const due of attention.maintenance) {
    if (due.plan.status !== 'OVERDUE' && due.plan.status !== 'DUE_SOON') continue;
    const late = due.plan.status === 'OVERDUE';
    items.push({
      key: `plan-${due.plan.id}`,
      rank: late ? 0 : 3,
      tone: late ? 'late' : 'soon',
      kind: 'service',
      title: due.plan.title,
      vehicle: due.vehicleName,
      due: dueLine(due.plan, due.odometerUnit),
      short: shortDue(due.plan, due.odometerUnit),
      vehicleId: due.vehicleId,
      emoji: jobEmoji(due.plan.title),
      planId: due.plan.id,
    });
  }
  for (const paper of attention.documents) {
    const days = paper.daysRemaining;
    items.push({
      key: `doc-${paper.document.id}`,
      rank: days < 0 ? 1 : 4,
      tone: days < 0 ? 'late' : 'soon',
      kind: 'papers',
      title: paper.document.title,
      vehicle: paper.vehicleName,
      due:
        days < 0
          ? `Expired ${spanOfDays(-days)} ago`
          : days === 0
            ? 'Expires today'
            : `Expires in ${spanOfDays(days)}`,
      short: days < 0 ? 'Expired' : days === 0 ? 'Today' : `In ${shortSpan(days)}`,
      vehicleId: paper.vehicleId,
      emoji: PAPER[paper.document.documentType] ?? '📝',
      documentType: paper.document.documentType,
    });
  }
  for (const recall of attention.recalls) {
    items.push({
      key: `recall-${recall.notificationId}`,
      rank: 2,
      tone: 'late',
      kind: 'recalls',
      title: readable(recall.component || recall.campaign),
      vehicle: recall.vehicleName,
      due: 'May be under recall',
      short: 'Recall',
      vehicleId: recall.vehicleId,
      emoji: '⚠️',
    });
  }
  return items.sort((a, b) => a.rank - b.rank);
}

/** What each vehicle is waiting on, for the mark over its bay. */
function flagsByVehicle(items: readonly Item[]): ReadonlyMap<string, BayFlag> {
  const out = new Map<string, BayFlag>();
  for (const item of items) {
    const flag = out.get(item.vehicleId) ?? { late: 0, soon: 0 };
    flag[item.tone] += 1;
    out.set(item.vehicleId, flag);
  }
  return out;
}

/**
 * The pull to refresh, on iOS, as a rev: a tachometer hanging in the overscroll, its needle on the
 * pull — native-driven, so it is exactly where the thumb is — its redline where iOS starts the
 * refresh. While the garage is read again the engine idles high, the needle hunting round its
 * reading; then the page settles and the needle drops as it goes.
 */
function RevMeter({ y, refreshing, top }: { y: Animated.Value; refreshing: boolean; top: number }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [idle] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!refreshing || reduce) {
      idle.setValue(0);
      return;
    }
    const hunt = (toValue: number, ms: number) =>
      Animated.timing(idle, { toValue, duration: ms, easing: ease.inOut, useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([hunt(1, 130), hunt(-0.6, 190), hunt(0, 150)]));
    loop.start();
    return () => loop.stop();
  }, [refreshing, reduce, idle]);

  const progress = Animated.add(
    y.interpolate({ inputRange: [-REV_FULL, 0], outputRange: [1, 0], extrapolate: 'clamp' }),
    idle.interpolate({ inputRange: [-1, 1], outputRange: [-0.035, 0.035] }),
  ).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.rev,
        {
          // Centred in the gap the pull opens: it rides down at half the pull.
          top: top + spacing.sm / 2 - REV_SIZE / 2 - 10,
          opacity: y.interpolate({
            inputRange: [-56, -14],
            outputRange: [1, 0],
            extrapolate: 'clamp',
          }),
          transform: [
            {
              translateY: y.interpolate({
                inputRange: [-400, 0],
                outputRange: [-200, 0],
                extrapolate: 'clamp',
              }),
            },
          ],
        },
      ]}
    >
      <Gauge
        progress={progress}
        size={REV_SIZE}
        redlineFrom={0.8}
        marks={['0', '1', '2', '3', '4', '5', '6', '7', '8']}
        label=""
      >
        <Text style={[figure, styles.revUnit, { color: theme.mutedForeground }]}>×1000</Text>
      </Gauge>
      <Text style={[typeScale.overline, styles.revWord, { color: theme.mutedForeground }]}>
        {refreshing ? 'Revving' : 'Pull to rev'}
      </Text>
    </Animated.View>
  );
}

/** What a garage's vehicles are waiting on, from the dashboard's one list of it. */
interface GarageAttention {
  late: number;
  soon: number;
  papers: number;
  /** The worst flag each vehicle carries, for the light over its bay. */
  vehicles: ReadonlyMap<string, Flag>;
}

/** The dashboard's attention list, sorted into garages through the vehicles it names. */
function attentionByGarage(
  attention: Dashboard['attention'] | undefined,
  vehicles: readonly Vehicle[] | undefined,
): ReadonlyMap<string, GarageAttention> | undefined {
  if (!attention || !vehicles) return undefined;
  const garageOf = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.garageId]));
  const out = new Map<string, GarageAttention & { vehicles: Map<string, Flag> }>();
  const note = (vehicleId: string, flag: Flag, count: 'late' | 'soon' | 'papers') => {
    const garageId = garageOf.get(vehicleId);
    if (!garageId) return;
    const entry = out.get(garageId) ?? { late: 0, soon: 0, papers: 0, vehicles: new Map() };
    entry[count] += 1;
    if (entry.vehicles.get(vehicleId) !== 'late') entry.vehicles.set(vehicleId, flag);
    out.set(garageId, entry);
  };
  for (const item of attention.maintenance) {
    if (item.plan.status === 'OVERDUE') note(item.vehicleId, 'late', 'late');
    else if (item.plan.status === 'DUE_SOON') note(item.vehicleId, 'soon', 'soon');
  }
  for (const item of attention.documents) {
    note(item.vehicleId, item.daysRemaining < 0 ? 'late' : 'soon', 'papers');
  }
  return out;
}

const GARAGE = 236;
const BAYS = 4;
const rank = (flag: Flag | undefined) => (flag === 'late' ? 0 : flag === 'soon' ? 1 : 2);

/**
 * A garage, drawn as its floor — the web's: a row of numbered bays with painted lines between them
 * and its vehicles parked in them, the ones that need something first, a red or amber light over
 * their bay. Under it the name and its line, and the arrow that turns copper as it is pressed.
 */
function GarageCard({
  garage,
  vehicles = [],
  attention,
  onPress,
}: {
  garage: Garage;
  vehicles?: readonly Vehicle[];
  /** `null` when known to be clear; `undefined` while unknown. */
  attention?: GarageAttention | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const [pressed, setPressed] = useState(false);
  const count = garage.vehicleCount;
  const overflows = count > BAYS;
  const parked = [...vehicles]
    .sort((a, b) => rank(attention?.vehicles.get(a.id)) - rank(attention?.vehicles.get(b.id)))
    .slice(0, overflows ? BAYS - 1 : BAYS);
  const shared = garage.role !== 'OWNER';
  const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

  return (
    <PressableScale
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={[
        garage.name,
        plural(count, 'vehicle'),
        shared ? `shared with you as ${humanise(garage.role).toLowerCase()}` : null,
        attention?.late ? `${attention.late} overdue` : null,
        attention?.soon ? `${attention.soon} due soon` : null,
        attention?.papers ? `${plural(attention.papers, 'paper')} running out` : null,
      ]
        .filter(Boolean)
        .join(', ')}
      scaleTo={0.985}
      // The bays' own solid surface: white by day, lifted by a hairline and a soft shadow.
      style={[styles.garage, bayCard(theme)]}
    >
      {/* The floor. */}
      <View
        style={[styles.floor, { backgroundColor: pressed ? theme.muted : `${theme.muted}99` }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: BAYS }, (_, bay) => {
          const vehicle = parked[bay];
          const isOverflow = overflows && bay === BAYS - 1;
          const flag = vehicle ? attention?.vehicles.get(vehicle.id) : undefined;
          return (
            <View key={bay} style={styles.bay}>
              {/* The painted line between this bay and the last. */}
              {bay > 0 ? (
                <Svg style={styles.bayLine}>
                  <Line
                    x1={1}
                    y1={0}
                    x2={1}
                    y2="100%"
                    stroke={theme.borderStrong}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    strokeLinecap="round"
                  />
                </Svg>
              ) : null}
              <View style={styles.parking}>
                {isOverflow ? (
                  <Text style={[figure, styles.overflow, { color: theme.foreground }]}>
                    +{count - (BAYS - 1)}
                  </Text>
                ) : vehicle ? (
                  <Parked vehicle={vehicle} />
                ) : null}
              </View>
              {/* The bay's number, painted on the floor. */}
              <Text
                style={[
                  figure,
                  styles.bayNumber,
                  { color: theme.mutedForeground, opacity: vehicle || isOverflow ? 1 : 0.5 },
                ]}
              >
                {pad(bay + 1)}
              </Text>
              {flag ? (
                <View
                  style={[
                    styles.flag,
                    {
                      borderColor: theme.muted,
                      backgroundColor: flag === 'late' ? theme.destructive : theme.warning,
                    },
                  ]}
                />
              ) : null}
            </View>
          );
        })}
      </View>

      {/* The name and how many it holds; whose it is only when it is not yours. */}
      <View style={styles.garageFoot}>
        <Text numberOfLines={1} style={[styles.garageName, { color: theme.foreground }]}>
          {garage.name}
        </Text>
        <Text numberOfLines={1} style={[styles.garageMeta, { color: theme.mutedForeground }]}>
          <Text style={[figure, styles.garageMeta, { color: theme.foreground }]}>{count}</Text>{' '}
          {count === 1 ? 'vehicle' : 'vehicles'}
          {shared ? ` · ${humanise(garage.role)}` : ''}
        </Text>
      </View>
    </PressableScale>
  );
}

/**
 * A vehicle in its bay. A cutout stands on the floor; a full photo fills the bay as a picture;
 * without one, the make's badge, then the kind of vehicle.
 */
function Parked({ vehicle }: { vehicle: Vehicle }) {
  const theme = useTheme();
  const photo = vehicle.primaryPhoto;
  if (photo?.thumbnailUrl) {
    return (
      <RemoteImage
        uri={photo.thumbnailUrl}
        cacheKey={photoKey(photo, 'thumb')}
        style={photo.isCutout ? styles.parkedCutout : styles.parkedPhoto}
        contentFit={photo.isCutout ? 'contain' : 'cover'}
        contentPosition={photo.isCutout ? 'bottom' : 'center'}
        transition={200}
        accessible={false}
      />
    );
  }
  return (
    <View style={[styles.parkedBadge, { backgroundColor: theme.cardRaised }]}>
      {vehicle.make ? (
        <BrandLogo make={vehicle.make} size={32} />
      ) : (
        <Ionicons name={vehicleIcon(vehicle.vehicleType)} size={16} color={theme.mutedForeground} />
      )}
    </View>
  );
}

/** Room for another: an outline, so it never reads as a garage of its own. */
function NewGarageTile({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [turn] = useState(() => new Animated.Value(0));
  const [pressed, setPressed] = useState(false);
  const to = (value: 0 | 1) => {
    setPressed(Boolean(value));
    if (reduce) return turn.setValue(value);
    Animated.timing(turn, {
      toValue: value,
      duration: 300,
      easing: ease.out,
      useNativeDriver: true,
    }).start();
  };
  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      onPressIn={() => to(1)}
      onPressOut={() => to(0)}
      accessibilityRole="button"
      accessibilityLabel="New garage"
      scaleTo={0.97}
      style={[styles.newGarage, { borderColor: pressed ? theme.borderStrong : theme.border }]}
    >
      <Animated.View
        style={[
          styles.newGarageIcon,
          {
            backgroundColor: pressed ? theme.primary : theme.muted,
            transform: [
              { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) },
            ],
          },
        ]}
      >
        <Ionicons
          name="add"
          size={18}
          color={pressed ? theme.primaryForeground : theme.mutedForeground}
        />
      </Animated.View>
      <Text
        style={[
          typeScale.caption,
          styles.newGarageLabel,
          { color: pressed ? theme.foreground : theme.mutedForeground },
        ]}
      >
        New garage
      </Text>
    </PressableScale>
  );
}

/**
 * Recent activity as the logbook it is — the vehicle Logs' own parts, so an entry looks the same
 * wherever it is read. On this page every entry can be a different vehicle, so the vehicle leads
 * its facts, and the whole card goes to that vehicle.
 */
function RecentActivity({ data }: { data: Dashboard }) {
  const router = useRouter();
  const months = groupByMonth(data.recentActivity);
  let row = 0;
  return (
    <>
      <SectionHeading title="Recent activity" />
      <View>
        {months.map((group) => (
          <View key={group.key} style={styles.activityMonth}>
            <LedgerMonth group={group} />
            <LedgerCard>
              {group.items.map((item, place) => {
                const kind = humanise(item.eventType);
                const titled =
                  item.title.trim() !== '' &&
                  item.title.trim().toLowerCase() !== kind.toLowerCase();
                const when = ledgerDate(item.occurredAt);
                return (
                  <LedgerRow
                    key={item.id}
                    eventType={item.eventType}
                    title={titled ? item.title : kind}
                    occurredAt={item.occurredAt}
                    previousAt={place > 0 ? group.items[place - 1]!.occurredAt : undefined}
                    nextAt={group.items[place + 1]?.occurredAt}
                    // On this page every entry can be a different vehicle, so it is named.
                    meta={[item.vehicleName]}
                    cost={item.cost}
                    onPress={() =>
                      router.push({ pathname: '/vehicle/[id]', params: { id: item.vehicleId } })
                    }
                    accessibilityLabel={[
                      when,
                      `${kind}: ${item.title}`,
                      item.vehicleName,
                      item.cost ? formatMoney(item.cost) : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    accessibilityHint={`Opens ${item.vehicleName}`}
                    index={row++}
                  />
                );
              })}
            </LedgerCard>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: PAGE, gap: spacing.xl },
  section: { gap: spacing.md },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: -spacing.sm,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  greeting: { flex: 1, minWidth: 0, gap: 3 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  whenDot: { width: 3, height: 3, borderRadius: 2 },
  hello: { fontSize: 22, lineHeight: 27, fontWeight: '700', letterSpacing: -0.6 },

  day: { fontSize: 10.5, lineHeight: 14, fontWeight: '600', letterSpacing: 1 },
  clock: { flexDirection: 'row' },
  heroGap: { paddingTop: 18 },
  rowSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 40,
    paddingRight: 14,
    paddingTop: 2,
    paddingBottom: 6,
  },
  moreRule: { position: 'absolute', top: 0, left: 40, right: 14, height: StyleSheet.hairlineWidth },
  moreText: { paddingTop: 6, fontSize: 11.5, lineHeight: 15, fontWeight: '600' },
  // The tiles' share of the row, with no tile of its own: straight on the card.
  fleetSlot: { flex: 1, minWidth: 0 },
  fleet: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  fleetCount: { flexShrink: 1, fontSize: 30, lineHeight: 34, fontWeight: '600', letterSpacing: -1 },
  fleetSide: { flexShrink: 0, gap: 4 },
  fleetWord: { fontSize: 7.5, lineHeight: 10, fontWeight: '600', letterSpacing: 0.15 },
  marks: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  marksMore: { fontSize: 10.5, lineHeight: 14, fontWeight: '600', marginLeft: 1 },

  rev: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  revUnit: { fontSize: 8, lineHeight: 10, fontWeight: '600' },
  revWord: { fontSize: 9, lineHeight: 11, marginTop: -6 },

  rail: { gap: spacing.md, paddingHorizontal: PAGE, paddingVertical: 2 },
  activityMonth: { gap: spacing.sm, marginBottom: spacing.md },
  garage: {
    width: GARAGE,
    ...leaf('md'),
    padding: 8,
    paddingBottom: 12,
    gap: 10,
  },
  floor: {
    flexDirection: 'row',
    // The card's leaf less its 8pt bezel, so the floor's corners run with the card's.
    ...leaf('md', 8),
    overflow: 'hidden',
    paddingHorizontal: 4,
    paddingTop: 6,
  },
  bay: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  bayLine: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 2 },
  parking: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  overflow: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  bayNumber: { fontSize: 9, fontWeight: '600', letterSpacing: 1, marginTop: 2 },
  flag: {
    position: 'absolute',
    right: 6,
    top: 4,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
  },
  parkedCutout: { width: '100%', height: '100%' },
  parkedPhoto: { width: '100%', height: '100%', borderRadius: 8 },
  parkedBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  garageFoot: { gap: 1, paddingHorizontal: 6 },
  garageName: { fontSize: 15, lineHeight: 20, fontWeight: '700', letterSpacing: -0.25 },
  garageMeta: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  newGarage: {
    width: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    ...leaf('md'),
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  newGarageLabel: { fontWeight: '600', textAlign: 'center' },
  newGarageIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
