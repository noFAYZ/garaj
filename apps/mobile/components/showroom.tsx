import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import type { Vehicle } from '@vehicle-os/contracts';
import { paintSwatch } from '@vehicle-os/ui';
import { BayStage, Floor, Room } from '@/components/bay-stage';
import { BrandLogo } from '@/components/brand-logo';
import { kindOf } from '@/components/vehicle-hero';
import { formatMoney, humanise } from '@/lib/format';
import { Eyebrow, SectionLink } from '@/lib/instrument';
import { ease, haptic, Odometer, PressableScale, Pulse, useReduceMotion } from '@/lib/motion';
import { figure, radius, rimmed, spacing, typeScale, useTheme, type Theme } from '@/lib/theme';
import { Button, Skeleton } from '@/lib/ui';

type Money = { amountMinor: number; currency: string };

/** What a vehicle is waiting on: things late and things coming, from the home's one list. */
export type BayFlag = { late: number; soon: number };

const pad = (value: number) => String(value).padStart(2, '0');

const PAGE = spacing.lg;
const GAP = spacing.md;
/** How much of the next bay shows at the edge: enough to say there is one. */
const PEEK = 26;
/** The stage's height, for its width. */
const STAGE = 0.62;
/** The card's padding round its stage. */
const BEZEL = 6;
/** How far a card's shadow reaches past it, top and bottom. */
const SHADOW_ROOM = 24;
/** The pager's track. */
const TRACK = 52;

/*
 * The door goes up once a session, the first time the garage is opened; after that the bays are
 * simply lit. ponytail: a module flag, so a remount (a sign-out and back) does not replay it.
 */
let opened = false;

/**
 * The person's vehicles, each in its own bay — the home screen's hero.
 *
 * A bay is a stage drawn as a garage: a back wall, a floor in perspective with its painted lines
 * and number, a strip light over it throwing a cone onto the floor. A cutout stands on that floor
 * with its contact shadow and its reflection; a photo fills the bay; with neither, the make's
 * badge stands there on a tile. Under the stage, who it is and its two running figures.
 *
 * The first time, the door rolls up and the strip light flickers on — a tink, then a hold — once
 * a session, and never under reduce motion. Swiped, the bays slide past on a snap: the light
 * follows the bay in front, the vehicle drives in a little faster than its bay, a photo drifts
 * slower behind its frame, and the thumb feels each bay land.
 */
export function Showroom({
  vehicles,
  spent,
  flags,
}: {
  vehicles: readonly Vehicle[];
  spent: ReadonlyMap<string, Money | null | undefined>;
  flags: ReadonlyMap<string, BayFlag>;
}) {
  const router = useRouter();
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();
  const count = vehicles.length;
  const cardWidth = width - PAGE * 2 - (count > 1 ? PEEK : 0);
  const snap = cardWidth + GAP;
  const [x] = useState(() => new Animated.Value(0));
  const [door] = useState(() => new Animated.Value(opened || reduce ? 1 : 0));
  const [light] = useState(() => new Animated.Value(opened || reduce ? 1 : 0));
  const [revealed, setRevealed] = useState(opened || reduce);
  const [page, setPage] = useState(0);
  const landed = useRef(0);

  useEffect(() => {
    if (revealed) return;
    // A strip light catching: on, off, half, off, on.
    const flick = (toValue: number, ms: number) =>
      Animated.timing(light, {
        toValue,
        duration: ms,
        easing: Easing.linear,
        useNativeDriver: true,
      });
    const reveal = Animated.parallel([
      Animated.timing(door, {
        toValue: 1,
        duration: 640,
        delay: 220,
        easing: ease.inOut,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(560),
        flick(0.85, 40),
        Animated.delay(60),
        flick(0.1, 50),
        Animated.delay(110),
        flick(0.7, 40),
        Animated.delay(40),
        flick(0.2, 50),
        Animated.delay(70),
        flick(1, 120),
      ]),
    ]);
    // Felt with it: the tink as the tube first catches, the thunk as it holds.
    const tink = setTimeout(haptic.selection, 560);
    const hold = setTimeout(haptic.light, 1030);
    reveal.start(({ finished }) => {
      if (!finished) return;
      opened = true;
      setRevealed(true);
    });
    return () => {
      reveal.stop();
      clearTimeout(tink);
      clearTimeout(hold);
    };
  }, [revealed, door, light]);

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x } } }], {
        useNativeDriver: true,
        listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
          const next = Math.round(event.nativeEvent.contentOffset.x / snap);
          if (next === landed.current || next < 0 || next >= count) return;
          landed.current = next;
          haptic.selection();
          setPage(next);
        },
      }),
    [x, snap, count],
  );

  return (
    <View style={{ gap: spacing.md }}>
      <Animated.ScrollView
        horizontal
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={count > 1}
        showsHorizontalScrollIndicator={false}
        snapToInterval={snap}
        decelerationRate="fast"
        disableIntervalMomentum
        // The rail clips what overflows it, so it is padded for the cards' shadow and pulled back.
        style={{ marginHorizontal: -PAGE, marginVertical: 2 - SHADOW_ROOM }}
        contentContainerStyle={[
          styles.rail,
          // Room after the last bay, so it lands where every other one does.
          count > 1 ? { paddingRight: PAGE + PEEK } : null,
        ]}
      >
        {vehicles.map((vehicle, index) => (
          <Bay
            key={vehicle.id}
            vehicle={vehicle}
            index={index}
            width={cardWidth}
            x={x}
            snap={snap}
            door={door}
            light={light}
            revealed={revealed}
            spent={spent.get(vehicle.id)}
            flag={flags.get(vehicle.id)}
          />
        ))}
      </Animated.ScrollView>

      {count > 1 ? (
        <View style={styles.pagerRow}>
          <Pager count={count} page={page} x={x} snap={snap} />
          <SectionLink label="See all" onPress={() => router.push('/vehicles')} />
        </View>
      ) : null}
    </View>
  );
}

/** One vehicle in its bay: the stage, then who it is and its figures. The whole card opens it. */
function Bay({
  vehicle,
  index,
  width,
  x,
  snap,
  door,
  light,
  revealed,
  spent,
  flag,
}: {
  vehicle: Vehicle;
  index: number;
  width: number;
  x: Animated.Value;
  snap: number;
  door: Animated.Value;
  light: Animated.Value;
  revealed: boolean;
  spent: Money | null | undefined;
  flag: BayFlag | undefined;
}) {
  const theme = useTheme();
  const router = useRouter();
  const reduce = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const [turn] = useState(() => new Animated.Value(0));
  const stage = width - BEZEL * 2;
  const height = Math.round(width * STAGE);
  const photo = vehicle.primaryPhoto?.thumbnailUrl ? vehicle.primaryPhoto : null;
  const swatch = paintSwatch(vehicle.color);
  const unit = vehicle.odometerUnit === 'MI' ? 'mi' : 'km';
  const kind = kindOf(vehicle) || humanise(vehicle.vehicleType);
  const needs = flag ? flag.late + flag.soon : 0;

  // This bay's place in the swipe: 1 in front, 0 a whole bay away either side.
  const range = [(index - 1) * snap, index * snap, (index + 1) * snap];
  const focus = x.interpolate({ inputRange: range, outputRange: [0, 1, 0], extrapolate: 'clamp' });
  const scale = focus.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  // The strip light follows the bay in front; the others keep a little of it.
  const lit = Animated.multiply(
    light,
    focus.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
  );
  // A cutout drives in faster than its bay; a photo drifts slower than its frame.
  const drive = x.interpolate({
    inputRange: range,
    outputRange: [snap * 0.32, 0, -snap * 0.32],
    extrapolate: 'clamp',
  });
  const drift = x.interpolate({
    inputRange: range,
    outputRange: [-width * 0.12, 0, width * 0.12],
    extrapolate: 'clamp',
  });

  const press = (down: boolean) => {
    setPressed(down);
    if (reduce) return turn.setValue(down ? 1 : 0);
    Animated.timing(turn, {
      toValue: down ? 1 : 0,
      duration: 300,
      easing: ease.out,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ width, transform: [{ scale }] }}>
      <PressableScale
        onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: vehicle.id } })}
        onPressIn={() => press(true)}
        onPressOut={() => press(false)}
        accessibilityRole="button"
        accessibilityLabel={[
          vehicle.displayName,
          kind,
          vehicle.currentOdometer !== null
            ? `${Math.round(vehicle.currentOdometer).toLocaleString()} ${unit}`
            : null,
          spent ? `spent ${formatMoney(spent, true)}` : null,
          needs ? `${needs} ${needs === 1 ? 'thing needs' : 'things need'} you` : null,
          vehicle.status !== 'ACTIVE' ? humanise(vehicle.status) : null,
        ]
          .filter(Boolean)
          .join(', ')}
        scaleTo={0.985}
        style={[styles.card, bayCard(theme)]}
      >
        <BayStage
          id={vehicle.id}
          photo={photo}
          make={vehicle.make}
          vehicleType={vehicle.vehicleType}
          width={stage}
          height={height}
          number={index + 1}
          lit={lit}
          drive={drive}
          drift={drift}
        >
          <View style={styles.marks}>
            {vehicle.status !== 'ACTIVE' ? (
              <View style={[styles.mark, { backgroundColor: `${theme.background}CC` }]}>
                <Text style={[typeScale.overline, { fontSize: 10, color: theme.mutedForeground }]}>
                  {humanise(vehicle.status)}
                </Text>
              </View>
            ) : (
              <View />
            )}
            {flag && needs > 0 ? (
              <View style={[styles.mark, { backgroundColor: `${theme.background}CC` }]}>
                {flag.late > 0 ? (
                  <Pulse color={theme.destructive} size={7} />
                ) : (
                  <View style={[styles.dot, { backgroundColor: theme.warning }]} />
                )}
                <Text style={[typeScale.caption, styles.markText, { color: theme.foreground }]}>
                  {flag.late > 0
                    ? `${needs} need${needs === 1 ? 's' : ''} you`
                    : `${needs} due soon`}
                </Text>
              </View>
            ) : null}
          </View>

          {revealed ? null : (
            <>
              {/* Lights out until the strip light catches. */}
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: theme.scrim,
                    opacity: light.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                  },
                ]}
              />
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    transform: [
                      {
                        translateY: door.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, -height],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Door width={stage} height={height} number={index + 1} />
              </Animated.View>
            </>
          )}
        </BayStage>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[typeScale.title, { color: theme.foreground }]}>
                {vehicle.displayName}
              </Text>
              <View style={styles.kind}>
                {photo && vehicle.make ? <BrandLogo make={vehicle.make} size={14} /> : null}
                <Text
                  numberOfLines={1}
                  style={[typeScale.caption, { flexShrink: 1, color: theme.mutedForeground }]}
                >
                  {kind}
                </Text>
                {swatch ? (
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: swatch, borderColor: theme.hairline },
                    ]}
                  />
                ) : null}
              </View>
            </View>
            {/* Says the whole card is the way in; turns toward where it goes under the thumb. */}
            <Animated.View
              style={[
                styles.arrow,
                { backgroundColor: pressed ? theme.primary : theme.muted },
                {
                  transform: [
                    {
                      rotate: turn.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '-45deg'],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Ionicons
                name="arrow-forward"
                size={15}
                color={pressed ? theme.primaryForeground : theme.mutedForeground}
              />
            </Animated.View>
          </View>

          <View style={[styles.readings, { backgroundColor: `${theme.muted}99` }]}>
            <View style={styles.reading}>
              <Eyebrow style={{ fontSize: 10 }}>Odometer</Eyebrow>
              <View style={styles.readingLine}>
                <Odometer value={vehicle.currentOdometer} size={13} />
                {vehicle.currentOdometer !== null ? (
                  <Text style={[typeScale.caption, { fontSize: 11, color: theme.mutedForeground }]}>
                    {unit}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.reading}>
              <Eyebrow style={{ fontSize: 10 }}>Spent</Eyebrow>
              {spent === undefined ? (
                <Skeleton width={64} height={17} style={{ marginTop: 2 }} />
              ) : (
                <Text
                  numberOfLines={1}
                  style={[
                    figure,
                    styles.readingValue,
                    { color: spent ? theme.foreground : theme.mutedForeground },
                  ]}
                >
                  {spent ? formatMoney(spent, true) : '—'}
                </Text>
              )}
            </View>
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const SLAT = 11;

/**
 * The roller door: slats with a lit edge and a shadowed one, the bottom rail and its handle, the
 * bay's number stencilled across it.
 */
function Door({ width, height, number }: { width: number; height: number; number: number }) {
  const theme = useTheme();
  const slats = Array.from({ length: Math.ceil(height / SLAT) }, (_, i) => i * SLAT);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.muted }]}>
      <Svg width={width} height={height}>
        {slats.map((y) => (
          <Fragment key={y}>
            <Line x1={0} x2={width} y1={y + 0.5} y2={y + 0.5} stroke={theme.rim} strokeWidth={1} />
            <Line
              x1={0}
              x2={width}
              y1={y + SLAT - 1}
              y2={y + SLAT - 1}
              stroke={theme.border}
              strokeWidth={2}
            />
          </Fragment>
        ))}
        <Rect y={height - 10} width={width} height={10} fill={theme.borderStrong} />
        <Rect
          x={width / 2 - 20}
          y={height - 24}
          width={40}
          height={7}
          rx={3.5}
          fill={theme.borderStrong}
        />
      </Svg>
      <View style={styles.stencil}>
        <Text style={[figure, styles.stencilText, { color: theme.mutedForeground }]}>
          BAY {pad(number)}
        </Text>
      </View>
    </View>
  );
}

/** Where you are in the row of bays: the number, and a copper thumb that slides with the swipe. */
function Pager({
  count,
  page,
  x,
  snap,
}: {
  count: number;
  page: number;
  x: Animated.Value;
  snap: number;
}) {
  const theme = useTheme();
  const thumb = TRACK / count;
  return (
    <View
      style={styles.pager}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[figure, styles.pagerFigure, { color: theme.foreground }]}>
        {pad(page + 1)}
        <Text style={{ color: theme.mutedForeground }}> / {pad(count)}</Text>
      </Text>
      <View style={[styles.track, { backgroundColor: theme.muted }]}>
        <Animated.View
          style={[
            styles.thumb,
            {
              width: thumb,
              backgroundColor: theme.primary,
              transform: [
                {
                  translateX: x.interpolate({
                    inputRange: [0, Math.max(1, (count - 1) * snap)],
                    outputRange: [0, TRACK - thumb],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            },
          ]}
        />
      </View>
    </View>
  );
}

/**
 * A bay with nothing in it yet: the same room with the light on, the painted lines waiting, and
 * the one way to fill it.
 */
export function EmptyBay({ onAdd }: { onAdd: () => void }) {
  const theme = useTheme();
  const { width: screen } = useWindowDimensions();
  const width = screen - PAGE * 2 - BEZEL * 2;
  const height = Math.round(width * STAGE);
  return (
    <View style={[styles.card, bayCard(theme)]}>
      <View
        style={[styles.stage, { height, backgroundColor: theme.cardRaised }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Room id="empty" width={width} height={height} lit={1} />
        <Floor id="empty" width={width} height={height} number={1} />
      </View>
      <View style={[styles.info, styles.emptyInfo]}>
        <Text style={[typeScale.title, { color: theme.foreground, textAlign: 'center' }]}>
          An empty bay
        </Text>
        <Text
          style={[
            typeScale.label,
            { fontWeight: '400', color: theme.mutedForeground, textAlign: 'center' },
          ]}
        >
          Add a car, motorcycle, bicycle, boat — anything with a story worth keeping.
        </Text>
        <View style={{ marginTop: spacing.sm }}>
          <Button label="Park your first vehicle" icon="add" variant="primary" onPress={onAdd} />
        </View>
      </View>
    </View>
  );
}

/** The showroom before the vehicles arrive: one bay's shape, waiting. */
export function ShowroomSkeleton() {
  const theme = useTheme();
  const { width: screen } = useWindowDimensions();
  const width = screen - PAGE * 2;
  return (
    <View style={[styles.card, bayCard(theme)]}>
      <Skeleton height={Math.round(width * STAGE)} radius={radius.xl} />
      <View style={[styles.info, { gap: spacing.sm }]}>
        <Skeleton width="55%" height={18} />
        <Skeleton width="35%" height={12} />
        <Skeleton height={46} radius={radius.lg} />
      </View>
    </View>
  );
}

/**
 * A bay's card. On the white day page it is a white card lifted by a soft, wide shadow and a
 * hairline, not a tinted box; in the dark it stays the resting card with the lit rim.
 */
const bayCard = (theme: Theme) =>
  theme.dark
    ? { backgroundColor: theme.card, ...rimmed(theme) }
    : {
        backgroundColor: theme.cardRaised,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.hairline,
        shadowColor: theme.shadow,
        shadowOpacity: 0.1,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 5,
      };

const styles = StyleSheet.create({
  rail: { gap: GAP, paddingHorizontal: PAGE, paddingVertical: SHADOW_ROOM },
  card: { borderRadius: radius.xxl + 4, padding: BEZEL, gap: 2 },
  stage: { borderRadius: radius.xl + 2, overflow: 'hidden' },
  marks: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  markText: { fontWeight: '600' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  stencil: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 12,
  },
  stencilText: { fontSize: 20, fontWeight: '700', letterSpacing: 6, opacity: 0.55 },
  info: { paddingHorizontal: 10, paddingTop: 12, paddingBottom: 6, gap: 12 },
  emptyInfo: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: 14,
  },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0 },
  swatch: { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
  arrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readings: { flexDirection: 'row', borderRadius: radius.lg },
  reading: { flex: 1, minWidth: 0, gap: 4, paddingHorizontal: spacing.md, paddingVertical: 9 },
  readingLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  readingValue: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  divider: { width: StyleSheet.hairlineWidth },
  pagerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pager: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pagerFigure: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  track: { width: TRACK, height: 3, borderRadius: 2, overflow: 'hidden' },
  thumb: { height: 3, borderRadius: 2 },
});
