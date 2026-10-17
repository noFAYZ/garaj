import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Animated,
  Easing,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import type { Dashboard, Garage, Vehicle } from '@vehicle-os/contracts';
import type { DocumentType } from '@vehicle-os/domain';
import { dashboardQuery, garagesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { dueGauge, groupByMonth, spanOfDays } from '@vehicle-os/ui';
import logoTextLight from '@/assets/logo-text-light.png';
import logoText from '@/assets/logo-text.png';
import { BrandLogo } from '@/components/brand-logo';
import { useDockSpace } from '@/components/dock';
import { NotificationBell } from '@/components/notification-bell';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { EmptyBay, Showroom, ShowroomSkeleton, type BayFlag } from '@/components/showroom';
import { LedgerMonth, LedgerRow } from '@/components/timeline';
import { useSpent, vehicleIcon } from '@/components/vehicle-card';
import { api } from '@/lib/api';
import { jobEmoji } from '@/lib/emoji';
import { ledgerDate } from '@/lib/ledger';
import { formatDistance, formatMoney, humanise } from '@/lib/format';
import { Glyph, SectionHeading, SectionLink } from '@/lib/instrument';
import {
  ease,
  Gauge,
  haptic,
  PressableScale,
  Pulse,
  Rise,
  useReduceMotion,
  useScrollY,
} from '@/lib/motion';
import { figure, radius, rimmed, spacing, typeScale, useTheme, type Theme } from '@/lib/theme';
import { Button, CompactHeader, Empty, Face, Skeleton } from '@/lib/ui';
import { useProfile } from '@/lib/vehicle-units';

const pad = (value: number) => String(value).padStart(2, '0');
const PAGE = spacing.lg;
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

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
  const scheme = useColorScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dockSpace = useDockSpace();
  const [refreshing, setRefreshing] = useState(false);
  // Where the hero starts and ends on the page: the road under it sinks into the page by its end.
  const [hero, setHero] = useState<{ y: number; end: number }>();
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
  const items = data ? itemsFrom(data.attention) : [];
  const flags = flagsByVehicle(items);

  const byGarage = new Map<string, Vehicle[]>();
  for (const vehicle of vehicleList) {
    byGarage.set(vehicle.garageId, [...(byGarage.get(vehicle.garageId) ?? []), vehicle]);
  }
  const attention = attentionByGarage(data?.attention, vehicles.data?.data);
  const parked = !vehicles.isPending && vehicleList.length > 0;

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
            refreshing={refreshing}
            onRefresh={refresh}
            // On iOS the tachometer is the indicator; the system spinner would sit over it.
            tintColor={REV ? 'transparent' : theme.primary}
            colors={[theme.primary]}
            progressBackgroundColor={theme.popover}
          />
        }
      >
        <RoadAhead y={y} top={insets.top} end={hero?.end} />
        {REV ? <RevMeter y={y} refreshing={refreshing} top={insets.top} /> : null}

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
            <View
              onLayout={(event) => {
                const { y: at, height } = event.nativeEvent.layout;
                setHero({ y: Math.round(at), end: Math.round(at + height) });
              }}
              // Never so short that the road has no room below the horizon: with nothing waiting
              // the hero is a line or two, and the scenery takes the space instead.
              style={hero ? { minHeight: insets.top + HORIZON_AT + ROAD_MIN - hero.y } : null}
            >
              <Rise index={1}>
                <Hero name={profile.data?.name ?? ''} data={data} items={items} />
              </Rise>
            </View>

            <Rise index={2}>
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
            <Rise index={3} style={styles.section}>
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

/*
 * The sun comes up and the road draws in once a session, the first time the garage opens, as the
 * bays' door rolls up. ponytail: a module flag, so a remount (a sign-out and back) does not replay it.
 */
let driven = false;

type Flag = 'late' | 'soon';
type Kind = 'service' | 'papers' | 'recalls' | 'tasks';
type Point = { x: number; y: number };

/** The lanes, by where their feet land either side of the vanishing point, in screen widths. */
const LANES = [
  { k: -1.75, light: 'tail', weight: 2.6 },
  { k: -1.28, light: 'tail', weight: 1.9 },
  { k: -0.9, light: 'tail', weight: 1.3 },
  { k: -0.38, light: 'head', weight: 1.3 },
  { k: 0.06, light: 'head', weight: 1.9 },
  { k: 0.56, light: 'head', weight: 2.6 },
] as const;
/** The central reservation between the carriageways, and the road's two edges. */
const DIVIDER = -0.64;
const EDGES = [-2.4, 1.1] as const;
/** The vanishing point, across the screen — where the sun sits on the horizon. */
const VP_X = 0.76;
/** Below the safe area: the horizon, level with the name. */
const HORIZON_AT = 142;
/** The last stretch of road, over which it sinks into the page. */
const SINK = 130;
/** Where the road ends until the hero below it has been measured, below the safe area. */
const ROAD_END = 300;
/** The least road there is below the horizon; a hero with less to say grows to show it. */
const ROAD_MIN = 120;
const SUN = 30;

/** The hills on the horizon, far then near: across as a share of the screen, height above it. */
const HILLS = [
  [
    [0.42, 0],
    [0.5, 8],
    [0.57, 5],
    [0.64, 16],
    [0.71, 10],
    [0.79, 21],
    [0.87, 12],
    [0.95, 19],
    [1.04, 11],
  ],
  [
    [0.55, 0],
    [0.62, 5],
    [0.69, 3],
    [0.76, 9],
    [0.84, 6],
    [0.92, 12],
    [1.04, 5],
  ],
] as const;
/** The lights along the central reservation, by how deep into the picture each stands. */
const LAMP_DEPTHS = [1.45, 1.85, 2.4, 3.1, 4, 5.3, 7, 9.4, 12.5] as const;
/** City lights at the horizon by night, out of focus: across, up from the horizon, radius, colour. */
const BOKEH = [
  [0.53, 24, 3, 'head'],
  [0.6, 33, 4, 'head'],
  [0.67, 41, 3, 'tail'],
  [0.86, 36, 5, 'head'],
  [0.92, 46, 3, 'tail'],
  [0.97, 30, 6, 'head'],
] as const;
/** A few stars by night, across and down as shares of the sky. */
const STARS = [
  [0.5, 0.38],
  [0.6, 0.58],
  [0.67, 0.3],
  [0.82, 0.46],
  [0.9, 0.28],
  [0.95, 0.62],
  [0.57, 0.76],
  [0.73, 0.68],
] as const;
/** Cloud bands by day: across, up from the horizon, length as a share of the screen, thickness. */
const CLOUDS = [
  [0.46, 58, 0.2, 3],
  [0.58, 40, 0.3, 4],
  [0.74, 66, 0.18, 3],
] as const;
/** The traffic: on which lane, which way, and how often. */
const CARS = [
  { lane: 0, away: true, duration: 3600, gap: 900 },
  { lane: 1, away: true, duration: 4400, gap: 2600 },
  { lane: 4, away: false, duration: 3200, gap: 1700 },
  { lane: 5, away: false, duration: 3900, gap: 3400 },
] as const;
const CAR_W = 58;
const CAR_H = 12;

/** A smooth line through points: each corner rounded off by a curve to the next midpoint. */
function smooth(points: readonly Point[]): string {
  const first = points[0]!;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const q = points[i + 1]!;
    d += ` Q ${p.x} ${p.y} ${(p.x + q.x) / 2} ${(p.y + q.y) / 2}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}

/**
 * The page's own picture, under the top bar and the greeting: a drive into the sunset. The sun
 * sits on the horizon level with the name, behind two ranges of hills; a highway runs off to it,
 * lights along its central reservation shrinking toward the sun, its lanes long-exposure light
 * trails — taillights going away, headlights coming — and now and then a car's lights travel them.
 * It is painted straight onto the page and sinks into it where the hero ends, so it has no edge:
 * by night a red sun goes down behind dark hills and the trails glow, under stars; by day the sun
 * is peach on sand-coloured hills, the trails red and copper, with a few bands of cloud.
 *
 * The first time a session, the sun rises from behind the horizon and the road opens out toward
 * you; the sun's glow breathes; the traffic stops under reduce motion; and as the page scrolls the
 * picture rises a little slower than it and fades.
 */
function RoadAhead({
  y,
  top,
  end,
}: {
  y: Animated.Value;
  top: number;
  /** Where the hero's last line sits on the page: the road has gone by there. */
  end: number | undefined;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();
  const [lit] = useState(() => new Animated.Value(driven || reduce ? 1 : 0));
  const [breath] = useState(() => new Animated.Value(1));
  const night = theme.dark;
  const height = end ?? top + ROAD_END;
  const ground = height + 60;
  const vp = { x: width * VP_X, y: top + HORIZON_AT };
  // A short hero — nothing waiting — leaves a short road: it sinks over most of what there is.
  const sink = Math.min(SINK, (height - vp.y) * 0.75);
  const paint = night ? '#ffffff' : theme.borderStrong;
  const tone = night
    ? {
        tail: '#ff5a43',
        head: '#ffe5c0',
        sun: ['#ffcb85', '#e2532a'],
        glow: '#ff8f4d',
        hills: ['#2a1c16', '#1b1310'],
        road: '#1a1411',
        lamp: '#ffd7a3',
        pole: '#4a3a31',
      }
    : {
        tail: theme.destructive,
        head: theme.primary,
        sun: ['#ffe3ba', '#f0874a'],
        glow: '#ffac6b',
        hills: ['#ead5bf', '#dfc3a8'],
        road: '#e7dccf',
        lamp: '#c96f3b',
        pole: '#c8b29d',
      };
  const foot = (k: number): Point => ({ x: vp.x + k * width, y: ground });
  // A point `s` of the way from the vanishing point (0) to a foot (1).
  const along = (to: Point, s: number): Point => ({
    x: vp.x + (to.x - vp.x) * s,
    y: vp.y + (to.y - vp.y) * s,
  });
  // How much of the road is left at a height on the page: 1 until it starts to sink, 0 at its end.
  const left = (at: number) => Math.min(1, Math.max(0, (height - at) / sink));
  // Every lane shares its horizon and its ground, so one set of stops fades them all into the page.
  const sAt = (at: number) => (at - vp.y) / (ground - vp.y);
  const [sinks, gone] = [sAt(height - sink), sAt(height)];
  const divider = foot(DIVIDER);
  const [leftEdge, rightEdge] = [foot(EDGES[0]), foot(EDGES[1])];

  useEffect(() => {
    if (driven || reduce) return;
    const draw = Animated.timing(lit, {
      toValue: 1,
      duration: 1500,
      delay: 120,
      easing: ease.out,
      useNativeDriver: true,
    });
    draw.start(({ finished }) => {
      if (finished) driven = true;
    });
    return () => draw.stop();
  }, [lit, reduce]);

  useEffect(() => {
    if (reduce) return;
    const to = (toValue: number) =>
      Animated.timing(breath, {
        toValue,
        duration: 2600,
        easing: ease.inOut,
        useNativeDriver: true,
      });
    const loop = Animated.loop(Animated.sequence([to(0.7), to(1)]));
    loop.start();
    return () => loop.stop();
  }, [breath, reduce]);

  /** A stroke's gradient along a lane: out of the horizon, full where the road is near, gone into the page. */
  const fading = (id: string, to: Point, color: string, strongest: number) => (
    <LinearGradient
      key={id}
      id={id}
      gradientUnits="userSpaceOnUse"
      x1={vp.x}
      y1={vp.y}
      x2={to.x}
      y2={to.y}
    >
      <Stop offset="0" stopColor={color} stopOpacity={0} />
      <Stop offset="0.2" stopColor={color} stopOpacity={strongest * 0.3} />
      <Stop offset={sinks} stopColor={color} stopOpacity={strongest} />
      <Stop offset={gone} stopColor={color} stopOpacity={0} />
    </LinearGradient>
  );

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.road,
        {
          height,
          // It lags the page a little and is gone before the lag could carry it under the bays.
          opacity: y.interpolate({
            inputRange: [0, 260],
            outputRange: [1, 0],
            extrapolate: 'clamp',
          }),
          transform: [
            {
              translateY: y.interpolate({
                inputRange: [0, 300],
                outputRange: [0, 75],
                extrapolate: 'clamp',
              }),
            },
          ],
        },
      ]}
    >
      {/* The sky: the light from the horizon, and stars by night or cloud by day. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient
            id="rd-sky"
            gradientUnits="userSpaceOnUse"
            cx={vp.x}
            cy={vp.y}
            fx={vp.x}
            fy={vp.y}
            rx={width * 0.8}
            ry={HORIZON_AT}
          >
            <Stop offset="0" stopColor={theme.primary} stopOpacity={night ? 0.42 : 0.22} />
            <Stop offset="0.5" stopColor={theme.primary} stopOpacity={night ? 0.1 : 0.06} />
            <Stop offset="1" stopColor={theme.primary} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="rd-tail">
            <Stop offset="0" stopColor={tone.tail} stopOpacity={0.9} />
            <Stop offset="1" stopColor={tone.tail} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="rd-head">
            <Stop offset="0" stopColor={tone.head} stopOpacity={0.9} />
            <Stop offset="1" stopColor={tone.head} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="rd-cloud" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.85} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#rd-sky)" />
        {night
          ? STARS.map(([across, down], index) => (
              <Circle
                key={index}
                cx={across * width}
                cy={top + down * (vp.y - top)}
                r={0.8}
                fill="#ffffff"
                opacity={0.5}
              />
            ))
          : CLOUDS.map(([across, up, long, thick], index) => (
              <Rect
                key={index}
                x={across * width}
                y={vp.y - up}
                width={long * width}
                height={thick}
                rx={thick / 2}
                fill="url(#rd-cloud)"
              />
            ))}
        {night
          ? BOKEH.map(([across, up, r, light], index) => (
              <Circle
                key={index}
                cx={across * width}
                cy={vp.y - up}
                r={r}
                fill={`url(#rd-${light})`}
                opacity={0.5}
              />
            ))
          : null}
      </Svg>

      {/* The sun's own glow, breathing, and coming up with it. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.multiply(lit, breath) }]}>
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient
              id="rd-glow"
              gradientUnits="userSpaceOnUse"
              cx={vp.x}
              cy={vp.y}
              fx={vp.x}
              fy={vp.y}
              rx={width * 0.42}
              ry={62}
            >
              <Stop offset="0" stopColor={tone.glow} stopOpacity={night ? 0.55 : 0.42} />
              <Stop offset="1" stopColor={tone.glow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={width} height={height} fill="url(#rd-glow)" />
        </Svg>
      </Animated.View>

      {/* The sun, rising from behind the horizon: the sky above it clips it at the horizon. */}
      <View style={[styles.sky, { height: vp.y + 0.5 }]}>
        <Animated.View
          style={[
            styles.sun,
            {
              left: vp.x - SUN * 2,
              top: vp.y - SUN * 2,
              transform: [
                {
                  translateY: lit.interpolate({ inputRange: [0, 1], outputRange: [SUN * 1.7, 0] }),
                },
              ],
            },
          ]}
        >
          <Svg width={SUN * 4} height={SUN * 4}>
            <Defs>
              <RadialGradient id="rd-halo">
                <Stop offset="0.45" stopColor={tone.sun[1]} stopOpacity={night ? 0.5 : 0.35} />
                <Stop offset="1" stopColor={tone.sun[1]} stopOpacity={0} />
              </RadialGradient>
              <LinearGradient id="rd-disc" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={tone.sun[0]} />
                <Stop offset="1" stopColor={tone.sun[1]} />
              </LinearGradient>
            </Defs>
            <Circle cx={SUN * 2} cy={SUN * 2} r={SUN * 2} fill="url(#rd-halo)" />
            <Circle cx={SUN * 2} cy={SUN * 2} r={SUN} fill="url(#rd-disc)" />
          </Svg>
        </Animated.View>
      </View>

      {/* The hills the sun goes down behind, each melting in from the left. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          {HILLS.map((range, index) => (
            <LinearGradient
              key={index}
              id={`rd-hill-${index}`}
              gradientUnits="userSpaceOnUse"
              x1={range[0][0] * width}
              y1={0}
              x2={(range[0][0] + 0.12) * width}
              y2={0}
            >
              <Stop offset="0" stopColor={tone.hills[index]} stopOpacity={0} />
              <Stop offset="1" stopColor={tone.hills[index]} stopOpacity={1} />
            </LinearGradient>
          ))}
          <LinearGradient id="rd-horizon" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0.3" stopColor={paint} stopOpacity={0} />
            <Stop offset={VP_X} stopColor={paint} stopOpacity={night ? 0.16 : 0.5} />
            <Stop offset="1" stopColor={paint} stopOpacity={night ? 0.05 : 0.2} />
          </LinearGradient>
        </Defs>
        {HILLS.map((range, index) => {
          const points = range.map(([across, up]) => ({ x: across * width, y: vp.y - up }));
          return (
            <Path
              key={index}
              d={`${smooth(points)} L ${width + 4} ${vp.y} L ${points[0]!.x} ${vp.y} Z`}
              fill={`url(#rd-hill-${index})`}
            />
          );
        })}
        <Rect y={vp.y} width={width} height={1} fill="url(#rd-horizon)" />
      </Svg>

      {/* The road, opening out from the horizon toward you the first time. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            opacity: lit,
            transformOrigin: `${Math.round(VP_X * 100)}% ${Math.round((vp.y / height) * 100)}%`,
            transform: [{ scale: lit.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
          },
        ]}
      >
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient
              id="rd-tarmac"
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={vp.y}
              x2={0}
              y2={height}
            >
              <Stop offset="0" stopColor={tone.road} stopOpacity={1} />
              <Stop
                offset={(height - sink - vp.y) / (height - vp.y)}
                stopColor={tone.road}
                stopOpacity={1}
              />
              <Stop offset="1" stopColor={tone.road} stopOpacity={0} />
            </LinearGradient>
            <RadialGradient id="rd-lamp">
              <Stop offset="0" stopColor={tone.lamp} stopOpacity={0.85} />
              <Stop offset="1" stopColor={tone.lamp} stopOpacity={0} />
            </RadialGradient>
            {LANES.map((lane, index) =>
              fading(`rd-lane-${index}`, foot(lane.k), tone[lane.light], 1),
            )}
            {EDGES.map((k, index) =>
              fading(`rd-edge-${index}`, foot(k), paint, night ? 0.12 : 0.55),
            )}
          </Defs>
          <Polygon
            points={`${vp.x - 1},${vp.y} ${vp.x + 1},${vp.y} ${rightEdge.x},${rightEdge.y} ${leftEdge.x},${leftEdge.y}`}
            fill="url(#rd-tarmac)"
          />
          {EDGES.map((k, index) => {
            const end = foot(k);
            return (
              <Line
                key={k}
                x1={vp.x}
                y1={vp.y}
                x2={end.x}
                y2={end.y}
                stroke={`url(#rd-edge-${index})`}
                strokeWidth={1.4}
              />
            );
          })}
          {/* Each trail twice: a wide faint bloom, then the streak itself. */}
          {LANES.map((lane, index) => {
            const end = foot(lane.k);
            return (
              <G key={index}>
                <Line
                  x1={vp.x}
                  y1={vp.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={`url(#rd-lane-${index})`}
                  strokeOpacity={night ? 0.18 : 0.1}
                  strokeWidth={lane.weight * 5}
                  strokeLinecap="round"
                />
                <Line
                  x1={vp.x}
                  y1={vp.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={`url(#rd-lane-${index})`}
                  strokeWidth={lane.weight}
                  strokeLinecap="round"
                />
              </G>
            );
          })}
          {/* The painted line down the reservation, its dashes shortening into the distance. */}
          {Array.from({ length: 12 }, (_, index) => {
            const depth = 1 + index * 0.75;
            const near = along(divider, 1 / depth);
            const far = along(divider, 1 / (depth + 0.38));
            return (
              <Line
                key={index}
                x1={near.x}
                y1={near.y}
                x2={far.x}
                y2={far.y}
                stroke={paint}
                strokeOpacity={(night ? 0.28 : 0.6) * left(near.y)}
                strokeWidth={2.4 / depth}
              />
            );
          })}
          {/* The lights down the reservation: a pole, a T of arms, a lamp at each end. */}
          {LAMP_DEPTHS.map((depth) => {
            const s = 1 / depth;
            const base = along(divider, s);
            const head = { x: base.x, y: base.y - 52 * s };
            const arm = 11 * s;
            const shown = left(base.y);
            if (shown === 0) return null;
            return (
              <G key={depth} opacity={shown}>
                <Line
                  x1={base.x}
                  y1={base.y}
                  x2={head.x}
                  y2={head.y}
                  stroke={tone.pole}
                  strokeWidth={Math.max(0.6, 2.2 * s)}
                />
                <Line
                  x1={head.x - arm}
                  y1={head.y}
                  x2={head.x + arm}
                  y2={head.y}
                  stroke={tone.pole}
                  strokeWidth={Math.max(0.5, 1.6 * s)}
                />
                {night
                  ? [-arm, arm].map((dx) => (
                      <Circle
                        key={dx}
                        cx={head.x + dx}
                        cy={head.y + 1.5 * s}
                        r={14 * s}
                        fill="url(#rd-lamp)"
                      />
                    ))
                  : null}
                {[-arm, arm].map((dx) => (
                  <Circle
                    key={dx}
                    cx={head.x + dx}
                    cy={head.y + 1.5 * s}
                    r={Math.max(0.7, 2.2 * s)}
                    fill={tone.lamp}
                  />
                ))}
              </G>
            );
          })}
        </Svg>
        {reduce
          ? null
          : CARS.map((car, index) => (
              <Car
                key={index}
                {...car}
                vp={vp}
                to={foot(LANES[car.lane].k)}
                light={LANES[car.lane].light}
                color={tone[LANES[car.lane].light]}
                gone={gone}
              />
            ))}
      </Animated.View>
    </Animated.View>
  );
}

/**
 * A car's lights on its lane: going away, they shrink toward the horizon and slow as they go;
 * coming, they grow and quicken toward you and sink into the page with the road. Straight lanes,
 * so a native-driven translate is the whole journey.
 */
function Car({
  vp,
  to,
  light,
  color,
  gone,
  away,
  duration,
  gap,
}: {
  vp: Point;
  to: Point;
  /** Whose lights: names the gradient, which a colour's `#` cannot. */
  light: 'tail' | 'head';
  color: string;
  /** How far along the lane the road has sunk into the page. */
  gone: number;
  away: boolean;
  duration: number;
  gap: number;
}) {
  const [t] = useState(() => new Animated.Value(0));
  // `s` along the lane: 0 at the horizon, 1 at its foot; they live where the road shows.
  const near = gone * 0.85;
  const [from, end] = away ? [near, 0.04] : [0.04, near];
  const dx = to.x - vp.x;
  const dy = to.y - vp.y;

  useEffect(() => {
    const drive = Animated.loop(
      Animated.sequence([
        Animated.delay(gap),
        Animated.timing(t, {
          toValue: 1,
          duration,
          easing: away ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    drive.start();
    return () => drive.stop();
  }, [t, gap, duration, away]);

  return (
    <Animated.View
      style={[
        styles.car,
        {
          left: vp.x - CAR_W / 2,
          top: vp.y - CAR_H / 2,
          opacity: away
            ? t.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 1, 0.8, 0] })
            : t.interpolate({ inputRange: [0, 0.35, 0.75, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            {
              translateX: t.interpolate({ inputRange: [0, 1], outputRange: [dx * from, dx * end] }),
            },
            {
              translateY: t.interpolate({ inputRange: [0, 1], outputRange: [dy * from, dy * end] }),
            },
            { rotate: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg` },
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [from, end] }) },
          ],
        },
      ]}
    >
      <Svg width={CAR_W} height={CAR_H}>
        <Defs>
          <RadialGradient id={`rd-car-${light}`}>
            <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
            <Stop offset="0.35" stopColor={color} stopOpacity={0.95} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse
          cx={CAR_W / 2}
          cy={CAR_H / 2}
          rx={CAR_W / 2}
          ry={CAR_H / 2}
          fill={`url(#rd-car-${light})`}
        />
      </Svg>
    </Animated.View>
  );
}

/** What the hero counts, in the order it chips them; tasks are counted, never listed. */
const KINDS = [
  { key: 'service', label: 'Service' },
  { key: 'papers', label: 'Papers' },
  { key: 'recalls', label: 'Recalls' },
  { key: 'tasks', label: 'Tasks' },
] as const satisfies readonly { key: Kind; label: string }[];

/** What a kind reads — how many, and how many of those are late — or `null` before the dashboard. */
function readKind(
  key: Kind,
  items: readonly Item[],
  attention: Dashboard['attention'] | undefined,
): { count: number; late: number } | null {
  if (!attention) return null;
  if (key === 'tasks') {
    return {
      count: attention.overdueTasks + attention.tasksDueToday,
      late: attention.overdueTasks,
    };
  }
  const mine = items.filter((item) => item.kind === key);
  return { count: mine.length, late: mine.filter((item) => item.tone === 'late').length };
}

/** How long each thing ahead stays on the card before the next takes its place. */
const DWELL = 4600;

/**
 * Glass over the road: smoked by night, frosted by day — dark or light enough to read on over the
 * brightest trail, its top edge catching the light.
 */
const glass = (theme: Theme) =>
  theme.dark
    ? {
        backgroundColor: 'rgba(18,13,11,0.6)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderTopColor: 'rgba(255,255,255,0.2)',
      }
    : {
        backgroundColor: 'rgba(255,255,255,0.74)',
        borderColor: theme.hairline,
        borderTopColor: 'rgba(255,255,255,0.95)',
      };

/**
 * The top of the page, standing on the road ahead: the day and the time, the person — their name
 * large — then what is ahead of them: a chip for each kind of thing waiting, its dot the colour of
 * the worst of it and its edge lit while one of its own is on the card, and the card, which turns
 * through them by itself, most urgent first. A chip turns it to its kind.
 */
function Hero({
  name,
  data,
  items,
}: {
  name: string;
  /** `undefined` while the dashboard loads. */
  data: Dashboard | undefined;
  items: readonly Item[];
}) {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow();
  // Where the card is: it only counts up, and is read modulo what there is to read.
  const [at, setAt] = useState(0);
  const firstName = name.trim().split(/\s+/)[0] ?? '';
  const salutation = salutationFor(now.getHours());
  const briefing = items.length === 0 ? data?.briefing : undefined;
  const current = items.length > 0 ? items[at % items.length] : undefined;

  return (
    <View>
      <View style={styles.heroTop}>
        <Text style={[figure, styles.day, { color: theme.mutedForeground }]}>
          {DAY.format(now).replace(',', '').toUpperCase()}
        </Text>
        <Clock now={now} />
      </View>

      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={firstName ? `${salutation}, ${firstName}` : salutation}
      >
        {firstName ? (
          <>
            <Text style={[styles.salutation, { color: theme.mutedForeground }]}>{salutation},</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.name, { color: theme.foreground }]}
            >
              {firstName}
            </Text>
          </>
        ) : (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.name, { color: theme.foreground }]}
          >
            {salutation}
          </Text>
        )}
      </View>

      {/* A chip for each kind with something waiting — a kind with nothing says nothing. */}
      <View style={styles.chips}>
        {KINDS.map(({ key, label }) => {
          const reading = readKind(key, items, data?.attention);
          if (!reading || reading.count === 0) return null;
          const first = items.findIndex((item) => item.kind === key);
          const tone = reading.late ? theme.destructive : theme.warning;
          return (
            <PressableScale
              key={key}
              onPress={() => {
                haptic.selection();
                if (key === 'tasks') router.push('/tasks');
                else if (first >= 0) setAt(first);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${reading.count}${reading.late ? `, ${reading.late} late` : ' coming up'}`}
              accessibilityHint={key === 'tasks' ? 'Opens Tasks' : 'Shows the first of them'}
              accessibilityState={{ selected: current?.kind === key }}
              hitSlop={4}
              scaleTo={0.94}
              style={[
                styles.chip,
                glass(theme),
                current?.kind === key
                  ? { borderColor: `${tone}80`, borderTopColor: `${tone}80` }
                  : null,
              ]}
            >
              {reading.late ? (
                <Pulse color={theme.destructive} size={6} />
              ) : (
                <View style={[styles.chipDot, { backgroundColor: theme.warning }]} />
              )}
              <Text style={[styles.chipLabel, { color: theme.foreground }]}>{label}</Text>
              <Text style={[figure, styles.chipCount, { color: theme.mutedForeground }]}>
                {reading.count}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      <Ahead items={items} briefing={briefing} at={at} onStep={setAt} />
    </View>
  );
}

/**
 * What is ahead, one at a time on a glass card that turns by itself every few seconds: the face
 * slides away and the next slides in, its glyph popping up. Each thing goes to its vehicle; with
 * nothing waiting it reads out the garage's briefing. A screen reader can turn it with its Next
 * action. Under reduce motion it still turns — the card is the only way to see the rest — but the
 * new face is simply there.
 */
function Ahead({
  items,
  briefing,
  at,
  onStep,
}: {
  items: readonly Item[];
  /** The dashboard's sentences when nothing is waiting; `undefined` while it loads. */
  briefing: readonly string[] | undefined;
  at: number;
  onStep: Dispatch<SetStateAction<number>>;
}) {
  const theme = useTheme();
  const router = useRouter();
  const reduce = useReduceMotion();
  const count = items.length > 0 ? items.length : (briefing?.length ?? 0);
  const [shown, setShown] = useState(at);
  // The face: -1 leaving to the left, 0 in place, 1 waiting on the right to come in.
  const [swap] = useState(() => new Animated.Value(0));
  const arriving = useRef(false);

  useEffect(() => {
    if (at === shown) return;
    if (reduce || count === 0 || at % count === shown % count) {
      setShown(at);
      return;
    }
    const leave = Animated.timing(swap, {
      toValue: -1,
      duration: 170,
      easing: ease.in,
      useNativeDriver: true,
    });
    leave.start(({ finished }) => {
      if (!finished) return;
      swap.setValue(1);
      arriving.current = true;
      setShown(at);
    });
    return () => leave.stop();
    // Only a new place starts a turn; `shown` catches up to it.
  }, [at]);

  // The next face comes in once it is the one drawn, so the old one never flashes on its way.
  useEffect(() => {
    if (!arriving.current) return;
    arriving.current = false;
    Animated.spring(swap, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 5 }).start();
  }, [shown, swap]);

  // Each stays a while, then the next takes its place; a jump from a chip starts its stay afresh.
  useEffect(() => {
    if (count < 2) return;
    const stay = setTimeout(() => onStep((value) => value + 1), DWELL);
    return () => clearTimeout(stay);
  }, [at, count, onStep]);

  const place = count > 0 ? shown % count : 0;
  const item = items[place];
  const next = {
    accessibilityActions: count > 1 ? [{ name: 'next', label: 'Next' }] : undefined,
    onAccessibilityAction: () => onStep((value) => value + 1),
  };
  const line = item ? undefined : briefing?.[place];
  const face = {
    opacity: swap.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
    transform: [
      { translateX: swap.interpolate({ inputRange: [-1, 0, 1], outputRange: [-22, 0, 22] }) },
    ],
  };
  const pop = {
    transform: [
      { scale: swap.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.85, 1, 0.55] }) },
    ],
  };

  return (
    <View>
      {item ? (
        <PressableScale
          onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: item.vehicleId } })}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, ${item.vehicle}, ${item.due}`}
          accessibilityHint={`Opens ${item.vehicle}`}
          {...next}
          scaleTo={0.98}
          style={[styles.glass, glass(theme)]}
        >
          <Animated.View
            style={[
              styles.glassTile,
              pop,
              {
                backgroundColor: item.tone === 'late' ? theme.destructiveSoft : theme.warningSoft,
                borderColor: `${item.tone === 'late' ? theme.destructive : theme.warning}40`,
              },
            ]}
          >
            <Glyph size={22}>{item.emoji}</Glyph>
          </Animated.View>
          <Animated.View style={[styles.glassText, face]}>
            <Text numberOfLines={1} style={[styles.glassTitle, { color: theme.foreground }]}>
              {item.title}
            </Text>
            {/* When leads: a narrow card cuts the vehicle's name, never how late it is. */}
            <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
              <Text
                style={{
                  fontWeight: '600',
                  color: item.tone === 'late' ? theme.destructive : theme.warning,
                }}
              >
                {item.due}
              </Text>{' '}
              · {item.vehicle}
            </Text>
          </Animated.View>
          <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
        </PressableScale>
      ) : line !== undefined ? (
        <View accessible accessibilityLabel={line} {...next} style={[styles.glass, glass(theme)]}>
          <View style={[styles.tickerDot, { backgroundColor: theme.primary }]} />
          <Animated.Text
            numberOfLines={2}
            style={[typeScale.label, styles.tickerText, face, { color: theme.foreground }]}
          >
            {line.split(NUMBERS).map((part, i) =>
              i % 2 === 1 ? (
                <Text key={i} style={[figure, { fontWeight: '600' }]}>
                  {part}
                </Text>
              ) : (
                part
              ),
            )}
          </Animated.Text>
        </View>
      ) : (
        <View style={[styles.glass, glass(theme)]}>
          <Skeleton width={42} height={42} radius={13} />
          <View style={[styles.glassText, { gap: 7 }]}>
            <Skeleton width="64%" height={13} />
            <Skeleton width="46%" height={10} />
          </View>
        </View>
      )}
    </View>
  );
}

/** Whole numbers in a sentence, with their thousands and decimals — never a full stop after. */
const NUMBERS = /(\d+(?:[.,]\d+)*)/;

/** The time, its colon blinking the seconds away — on the native driver, so nothing re-renders. */
function Clock({ now }: { now: Date }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [blink] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduce) return;
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
  }, [blink, reduce]);
  const style = [figure, styles.day, { color: theme.foreground }];
  return (
    <View accessible accessibilityLabel={TIME.format(now)} style={styles.clock}>
      <Text style={style}>{pad(now.getHours())}</Text>
      <Animated.Text style={[style, { opacity: blink }]}>:</Animated.Text>
      <Text style={style}>{pad(now.getMinutes())}</Text>
    </View>
  );
}

interface Item {
  key: string;
  tone: Flag;
  /** The chip it counts under. */
  kind: Exclude<Kind, 'tasks'>;
  title: string;
  vehicle: string;
  /** When, in words: "Overdue by 3 months", "Expires in 4 days". */
  due: string;
  vehicleId: string;
  /** The job's glyph, in the web's own artwork. */
  emoji: string;
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
      vehicleId: due.vehicleId,
      emoji: jobEmoji(due.plan.title),
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
      vehicleId: paper.vehicleId,
      emoji: PAPER[paper.document.documentType] ?? '📝',
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
  let row = 0;
  return (
    <>
      <SectionHeading title="Recent activity" />
      <View>
        {months.map((group) => (
          <View key={group.key}>
            <LedgerMonth group={group} />
            {group.items.map((item, place) => {
              const kind = humanise(item.eventType);
              const titled =
                item.title.trim() !== '' && item.title.trim().toLowerCase() !== kind.toLowerCase();
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
  // The wordmark is 1500 x 421.
  logo: { height: 24, width: Math.round((24 * 1500) / 421) },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  road: { position: 'absolute', top: 0, left: 0, right: 0 },
  sky: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  sun: { position: 'absolute', width: SUN * 4, height: SUN * 4 },
  car: { position: 'absolute', width: CAR_W, height: CAR_H },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  day: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 1 },
  clock: { flexDirection: 'row' },
  salutation: { fontSize: 16, lineHeight: 21, fontWeight: '500', letterSpacing: -0.2 },
  name: { fontSize: 44, lineHeight: 48, fontWeight: '700', letterSpacing: -1.8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, marginBottom: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipLabel: { fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  chipCount: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 68,
    padding: 12,
    borderRadius: radius.xxl,
    borderWidth: 1,
  },
  glassTile: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassText: { flex: 1, minWidth: 0, gap: 2 },
  glassTitle: { fontSize: 15.5, lineHeight: 20, fontWeight: '600', letterSpacing: -0.2 },
  tickerDot: { width: 6, height: 6, borderRadius: 3 },
  tickerText: { flex: 1, fontWeight: '500' },

  rev: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  revUnit: { fontSize: 8, lineHeight: 10, fontWeight: '600' },
  revWord: { fontSize: 9, lineHeight: 11, marginTop: -6 },

  rail: { gap: spacing.md, paddingHorizontal: PAGE, paddingVertical: 2 },
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
