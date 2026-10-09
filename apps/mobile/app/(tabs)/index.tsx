import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Animated,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import type { Dashboard, Garage, Vehicle } from '@vehicle-os/contracts';
import { dashboardQuery, garagesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { dueGauge, groupByMonth, spanOfDays } from '@vehicle-os/ui';
import logoTextLight from '@/assets/logo-text-light.png';
import logoText from '@/assets/logo-text.png';
import { BrandLogo } from '@/components/brand-logo';
import { useDockSpace } from '@/components/dock';
import { NotificationBell } from '@/components/notification-bell';
import { photoKey, RemoteImage } from '@/components/remote-image';
import {
  EntryCard,
  EntryHead,
  Fact,
  Facts,
  MonthHeading,
  startsDay,
  TimelineRow,
} from '@/components/timeline';
import { useSpent, VehicleCard, vehicleIcon } from '@/components/vehicle-card';
import { api } from '@/lib/api';
import { formatDistance, humanise } from '@/lib/format';
import { Chip, SectionHeading, SectionLink } from '@/lib/instrument';
import {
  ease,
  haptic,
  PressableScale,
  Rise,
  spring,
  useReduceMotion,
  useScrollY,
} from '@/lib/motion';
import { figure, lift, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, CompactHeader, Empty, Face, Ground, Skeleton } from '@/lib/ui';
import { useProfile } from '@/lib/vehicle-units';

const pad = (value: number) => String(value).padStart(2, '0');
const PAGE = spacing.lg;
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** Morning from five, afternoon from noon, evening from six — and evening again until five. */
function salutationFor(hour: number) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The time, kept current to the minute: the greeting and its clock read from it. */
function useNow(every = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/**
 * The garage right now (PRD §25) — the web's home, at a phone's width: the greeting panel with the
 * day, the person, their vehicles as a hand of cards and what needs them; the garages as floors of
 * bays; the vehicles; and the recent record as the logbook it is.
 */
export default function GarageScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dockSpace = useDockSpace();
  const { y, onScroll } = useScrollY();
  const dashboard = useQuery(dashboardQuery(api));
  const vehicles = useQuery(vehiclesQuery(api));
  const garages = useQuery(garagesQuery(api));
  const profile = useProfile();
  const [garageFilter, setGarageFilter] = useState<string | null>(null);

  const data = dashboard.data;
  const vehicleList = vehicles.data?.data ?? [];
  const garageList = garages.data ?? [];
  const spent = useSpent(vehicleList);

  const byGarage = new Map<string, Vehicle[]>();
  for (const vehicle of vehicleList) {
    byGarage.set(vehicle.garageId, [...(byGarage.get(vehicle.garageId) ?? []), vehicle]);
  }
  const attention = attentionByGarage(data?.attention, vehicles.data?.data);
  // A filter left pointing at a garage that has since gone falls back to everything.
  const activeFilter = garageList.some((garage) => garage.id === garageFilter)
    ? garageFilter
    : null;
  const shownVehicles = activeFilter ? (byGarage.get(activeFilter) ?? []) : vehicleList;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + spacing.sm, paddingBottom: dockSpace },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={dashboard.isFetching && !dashboard.isPending}
            onRefresh={() => {
              void dashboard.refetch();
              void vehicles.refetch();
              void garages.refetch();
            }}
            tintColor={theme.primary}
          />
        }
      >
        <Rise style={styles.topBar}>
          <Image
            source={scheme === 'light' ? logoText : logoTextLight}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Garaj"
          />
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
              <Face user={profile.data} size={40} />
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
              title="Welcome to Garaj"
              description="Start with a garage. It holds your vehicles and the people you share them with."
              action={
                <Button
                  label="Create your first garage"
                  icon="add"
                  variant="primary"
                  onPress={() => router.push('/add/garage')}
                />
              }
            />
          </Rise>
        ) : (
          <>
            <Rise index={1}>
              {data ? (
                <Greeting name={profile.data?.name ?? ''} dashboard={data} vehicles={vehicleList} />
              ) : (
                <Skeleton width="100%" height={220} radius={radius.xxxl} />
              )}
            </Rise>

            {/*
             * The garages, as a rail rather than a line of text — and the way to add one sits at
             * the end of the row it will join.
             */}
            <Rise index={2} style={styles.section}>
              <SectionHeading
                title="Garages"
                count={garages.isPending ? undefined : garageList.length}
                trailing={
                  <SectionLink label="Manage" onPress={() => router.push('/settings/data')} />
                }
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
                      <Skeleton key={key} width={GARAGE} height={190} radius={radius.xxl} />
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

            <Rise index={3} style={styles.section}>
              <SectionHeading
                title="Vehicles"
                count={vehicles.isPending ? undefined : vehicleList.length}
                trailing={
                  vehicleList.length > 0 ? (
                    <SectionLink label="See all" onPress={() => router.push('/vehicles')} />
                  ) : null
                }
              />
              {/* One garage is the common case, and a filter with one option is not a choice. */}
              {garageList.length > 1 && vehicleList.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginHorizontal: -PAGE }}
                  contentContainerStyle={styles.chips}
                >
                  <Chip
                    label="All"
                    count={vehicleList.length}
                    selected={activeFilter === null}
                    onPress={() => setGarageFilter(null)}
                  />
                  {garageList.map((garage) => (
                    <Chip
                      key={garage.id}
                      label={garage.name}
                      count={byGarage.get(garage.id)?.length ?? 0}
                      selected={activeFilter === garage.id}
                      onPress={() => setGarageFilter(garage.id)}
                    />
                  ))}
                </ScrollView>
              ) : null}
              {vehicles.isPending ? (
                <Skeleton width="100%" height={300} radius={radius.xxl} />
              ) : shownVehicles.length === 0 ? (
                <View style={{ height: 300 }}>
                  <Empty
                    title="No vehicles yet"
                    description="Add a car, motorcycle, bicycle, boat — anything with a story worth keeping."
                    action={
                      <Button
                        label="Add your first vehicle"
                        icon="add"
                        variant="primary"
                        onPress={() => router.push('/add/vehicle')}
                      />
                    }
                  />
                </View>
              ) : (
                <View style={{ gap: spacing.md }}>
                  {shownVehicles.map((vehicle, index) => (
                    <Rise key={vehicle.id} index={index}>
                      <VehicleCard vehicle={vehicle} spent={spent.get(vehicle.id)} />
                    </Rise>
                  ))}
                </View>
              )}
            </Rise>

            {data && data.recentActivity.length > 0 ? (
              <Rise index={4} style={styles.section}>
                <RecentActivity data={data} />
              </Rise>
            ) : null}
          </>
        )}
      </Animated.ScrollView>
      <CompactHeader title="Garage" y={y} />
    </View>
  );
}

type Flag = 'late' | 'soon';

interface Item {
  key: string;
  tone: Flag;
  title: string;
  detail: string;
  vehicleId: string;
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
      title: due.plan.title,
      detail: `${due.vehicleName} · ${dueLine(due.plan, due.odometerUnit)}`,
      vehicleId: due.vehicleId,
    });
  }
  for (const paper of attention.documents) {
    const days = paper.daysRemaining;
    items.push({
      key: `doc-${paper.document.id}`,
      rank: days < 0 ? 1 : 4,
      tone: days < 0 ? 'late' : 'soon',
      title: paper.document.title,
      detail: `${paper.vehicleName} · ${
        days < 0
          ? `Expired ${spanOfDays(-days)} ago`
          : days === 0
            ? 'Expires today'
            : `Expires in ${spanOfDays(days)}`
      }`,
      vehicleId: paper.vehicleId,
    });
  }
  for (const recall of attention.recalls) {
    items.push({
      key: `recall-${recall.notificationId}`,
      rank: 2,
      tone: 'late',
      title: recall.component || recall.campaign,
      detail: `${recall.vehicleName} · May be under recall`,
      vehicleId: recall.vehicleId,
    });
  }
  return items.sort((a, b) => a.rank - b.rank);
}

/** How many of them the greeting names; the rest are counted. */
const SHOWN = 3;

/**
 * The top of the home screen — the web's greeting, as a panel over workshop graph paper: the day
 * and the time in mono, the salutation with the name a step quieter, the person's vehicles as a
 * fanned hand of cards, and what needs them as pills that go straight to the vehicle concerned.
 */
function Greeting({
  name,
  dashboard,
  vehicles,
}: {
  name: string;
  dashboard: Dashboard;
  vehicles: readonly Vehicle[];
}) {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow();
  const firstName = name.trim().split(/\s+/)[0] ?? '';
  const items = itemsFrom(dashboard.attention);

  return (
    <View style={[styles.greeting, { backgroundColor: theme.card }, rimmed(theme)]}>
      <Ground />
      <View style={styles.greetingTop}>
        <Text style={[figure, styles.day, { color: theme.mutedForeground }]}>
          {DAY.format(now).replace(',', '').toUpperCase()}
          {'  ·  '}
          {pad(now.getHours())}:{pad(now.getMinutes())}
        </Text>
        <Fleet vehicles={vehicles} onPress={() => router.push('/vehicles')} />
      </View>

      <Text accessibilityRole="header" style={[typeScale.display, { color: theme.foreground }]}>
        {salutationFor(now.getHours())}
        {firstName ? (
          <>
            ,{'\n'}
            <Text style={{ color: theme.mutedForeground }}>{firstName}</Text>
          </>
        ) : null}
      </Text>

      {items.length > 0 ? (
        <View style={styles.needs}>
          <Text style={[typeScale.overline, { color: theme.mutedForeground }]}>
            Needs you
            <Text style={[figure, { letterSpacing: 0 }]}> {pad(items.length)}</Text>
          </Text>
          {items.slice(0, SHOWN).map((item, index) => (
            <Rise key={item.key} index={index + 2}>
              <PressableScale
                onPress={() =>
                  router.push({ pathname: '/vehicle/[id]', params: { id: item.vehicleId } })
                }
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${item.detail}`}
                scaleTo={0.97}
                style={[styles.pill, { backgroundColor: `${theme.background}99` }]}
              >
                <View
                  style={[
                    styles.pillDot,
                    { backgroundColor: item.tone === 'late' ? theme.destructive : theme.warning },
                  ]}
                />
                <Text
                  numberOfLines={1}
                  style={[typeScale.caption, styles.pillTitle, { color: theme.foreground }]}
                >
                  {item.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[typeScale.caption, { flexShrink: 1, color: theme.mutedForeground }]}
                >
                  {item.detail}
                </Text>
              </PressableScale>
            </Rise>
          ))}
          {items.length > SHOWN ? (
            <PressableScale
              onPress={() => router.push('/tasks')}
              accessibilityRole="button"
              accessibilityLabel={`${items.length - SHOWN} more`}
              scaleTo={0.95}
              style={styles.more}
            >
              <Text style={[figure, styles.moreText, { color: theme.mutedForeground }]}>
                +{items.length - SHOWN}
              </Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** How far each card sits from the middle of the hand, at rest and fanned — the web's values, scaled. */
const HAND = { step: 22, fan: 34, tilt: 7, fanTilt: 11 } as const;
const HAND_CARD = { width: 78, height: 64 } as const;

/**
 * The person's vehicles as a hand of cards, three at most, the best picture held in front. Dealt
 * on arrival — from a stack into the hand — and spread wider while the thumb is on them, as the
 * web's spread under the pointer. A press opens the vehicles.
 */
function Fleet({ vehicles, onPress }: { vehicles: readonly Vehicle[]; onPress: () => void }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [spread] = useState(() => new Animated.Value(reduce ? 1 : 0));

  useEffect(() => {
    if (reduce) return;
    Animated.spring(spread, {
      toValue: 1,
      delay: 240,
      useNativeDriver: true,
      ...spring.pop,
    }).start();
  }, [spread, reduce]);

  const shown = [...vehicles]
    .sort(
      (a, b) =>
        Number(Boolean(b.primaryPhoto?.thumbnailUrl)) -
        Number(Boolean(a.primaryPhoto?.thumbnailUrl)),
    )
    .slice(0, 3);
  if (shown.length === 0) return null;
  // The best card in the middle, in front: [2nd, 1st, 3rd].
  const hand = shown.length === 3 ? [shown[1]!, shown[0]!, shown[2]!] : shown;
  const middle = (hand.length - 1) / 2;
  const front = shown[0]!.id;
  const fan = (to: number) =>
    reduce
      ? spread.setValue(to)
      : Animated.timing(spread, {
          toValue: to,
          duration: 420,
          easing: ease.out,
          useNativeDriver: true,
        }).start();

  return (
    <PressableScale
      onPress={onPress}
      onPressIn={() => fan(2)}
      onPressOut={() => fan(1)}
      accessibilityRole="button"
      accessibilityLabel={`Your vehicles: ${shown.map((vehicle) => vehicle.displayName).join(', ')}`}
      scaleTo={1}
      style={styles.hand}
    >
      {hand.map((vehicle) => {
        const offset = hand.indexOf(vehicle) - middle;
        const photo = vehicle.primaryPhoto?.thumbnailUrl ? vehicle.primaryPhoto : null;
        return (
          <Animated.View
            key={vehicle.id}
            style={[
              styles.handCard,
              {
                backgroundColor: theme.muted,
                borderColor: theme.card,
                zIndex: 10 - Math.abs(offset) * 2,
              },
              lift(theme),
              {
                transform: [
                  {
                    translateX: spread.interpolate({
                      inputRange: [0, 1, 2],
                      outputRange: [0, offset * HAND.step, offset * HAND.fan],
                    }),
                  },
                  { translateY: Math.abs(offset) * 5 },
                  {
                    rotate: spread.interpolate({
                      inputRange: [0, 1, 2],
                      outputRange: [
                        '0deg',
                        `${offset * HAND.tilt}deg`,
                        `${offset * HAND.fanTilt}deg`,
                      ],
                    }),
                  },
                ],
              },
            ]}
          >
            {photo ? (
              <RemoteImage
                uri={photo.thumbnailUrl}
                cacheKey={photoKey(photo, 'thumb')}
                style={photo.isCutout ? styles.handCutout : StyleSheet.absoluteFill}
                contentFit={photo.isCutout ? 'contain' : 'cover'}
                transition={200}
                accessible={false}
              />
            ) : (
              <View style={styles.handBadge}>
                {vehicle.make ? (
                  <View style={[styles.handLogo, { backgroundColor: theme.cardRaised }]}>
                    <BrandLogo make={vehicle.make} size={30} />
                  </View>
                ) : (
                  <Ionicons
                    name={vehicleIcon(vehicle.vehicleType)}
                    size={22}
                    color={theme.mutedForeground}
                  />
                )}
              </View>
            )}
            {vehicle.id === front ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.handName,
                  { color: theme.foreground, backgroundColor: `${theme.background}D9` },
                ]}
              >
                {vehicle.displayName}
              </Text>
            ) : null}
          </Animated.View>
        );
      })}
    </PressableScale>
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

const GARAGE = 268;
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
      style={[styles.garage, { backgroundColor: theme.card }, rimmed(theme)]}
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

      <View style={styles.garageFoot}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={[typeScale.headline, { fontSize: 16, color: theme.foreground }]}
          >
            {garage.name}
          </Text>
          <Text
            numberOfLines={1}
            style={[typeScale.caption, { marginTop: 2, color: theme.mutedForeground }]}
          >
            <Text style={[figure, { fontWeight: '600', color: theme.foreground }]}>
              {pad(count)}
            </Text>{' '}
            {count === 1 ? 'vehicle' : 'vehicles'} · {garage.description ?? garage.defaultCurrency}
            {/* Only when it is not yours: every garage you made says Owner, which is noise. */}
            {shared ? ` · ${humanise(garage.role)}` : ''}
          </Text>
        </View>
        <View
          style={[
            styles.arrow,
            {
              backgroundColor: pressed ? theme.primary : theme.muted,
              transform: [{ rotate: pressed ? '-45deg' : '0deg' }],
            },
          ]}
        >
          <Ionicons
            name="arrow-forward"
            size={16}
            color={pressed ? theme.primaryForeground : theme.mutedForeground}
          />
        </View>
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
        <BrandLogo make={vehicle.make} size={40} />
      ) : (
        <Ionicons name={vehicleIcon(vehicle.vehicleType)} size={20} color={theme.mutedForeground} />
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
          size={22}
          color={pressed ? theme.primaryForeground : theme.mutedForeground}
        />
      </Animated.View>
      <Text
        style={[typeScale.label, { color: pressed ? theme.foreground : theme.mutedForeground }]}
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
  return (
    <>
      <SectionHeading title="Recent activity" />
      <View style={{ gap: spacing.sm }}>
        {months.map((group) => (
          <View key={group.key}>
            <MonthHeading group={group} />
            <View style={{ marginTop: spacing.sm }}>
              {group.items.map((item, index) => (
                <TimelineRow
                  key={item.id}
                  occurredAt={item.occurredAt}
                  firstOfDay={startsDay(group.items, index)}
                  last={index === group.items.length - 1}
                  index={index}
                >
                  <EntryCard
                    onPress={() =>
                      router.push({ pathname: '/vehicle/[id]', params: { id: item.vehicleId } })
                    }
                    accessibilityLabel={`${humanise(item.eventType)}: ${item.title}, ${item.vehicleName}`}
                    accessibilityHint={`Opens ${item.vehicleName}`}
                  >
                    <EntryHead eventType={item.eventType} title={item.title} cost={item.cost}>
                      <Facts>
                        <Fact icon="car-sport-outline">{item.vehicleName}</Fact>
                        <Fact icon="time-outline">{TIME.format(new Date(item.occurredAt))}</Fact>
                      </Facts>
                    </EntryHead>
                  </EntryCard>
                </TimelineRow>
              ))}
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: PAGE, gap: spacing.xxl + 4 },
  section: { gap: spacing.md },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: -spacing.md,
  },
  // The wordmark is 1500 x 421.
  logo: { height: 24, width: Math.round((24 * 1500) / 421) },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  greeting: {
    borderRadius: radius.xxxl,
    padding: spacing.lg + 2,
    gap: spacing.md,
    overflow: 'hidden',
  },
  greetingTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  day: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 1 },
  needs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 2 },
  pill: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: spacing.md,
    paddingVertical: 6,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillTitle: { flexShrink: 0, maxWidth: 140, fontWeight: '600' },
  more: { paddingHorizontal: 4, paddingVertical: 6 },
  moreText: { fontSize: 12 },

  hand: { width: 150, height: 80, marginTop: -4 },
  handCard: {
    position: 'absolute',
    bottom: 4,
    left: (150 - HAND_CARD.width) / 2,
    ...HAND_CARD,
    borderRadius: 14,
    borderWidth: 3,
    overflow: 'hidden',
    transformOrigin: 'bottom',
  },
  handCutout: { position: 'absolute', left: 6, right: 6, top: 4, bottom: 14 },
  handBadge: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 12 },
  handLogo: { width: 34, height: 34, borderRadius: 10, overflow: 'hidden' },
  handName: {
    position: 'absolute',
    left: 3,
    right: 3,
    bottom: 3,
    borderRadius: 7,
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 2,
    fontSize: 9,
    fontWeight: '700',
  },

  rail: { gap: spacing.md, paddingHorizontal: PAGE, paddingVertical: 2 },
  chips: { gap: 6, paddingHorizontal: PAGE },
  garage: {
    width: GARAGE,
    borderRadius: radius.xxl,
    padding: 10,
    paddingBottom: spacing.lg,
    gap: 14,
  },
  floor: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    overflow: 'hidden',
    paddingHorizontal: 4,
    paddingTop: 6,
  },
  bay: {
    flex: 1,
    aspectRatio: 4 / 5,
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
    width: 40,
    height: 40,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  garageFoot: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: 6,
  },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newGarage: {
    width: 150,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderRadius: radius.xxl,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  newGarageIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
