import { Ionicons } from '@expo/vector-icons';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { MonthlySpend, Vehicle, VehiclePhoto } from '@vehicle-os/contracts';
import { healthBand, vinTail } from '@vehicle-os/ui';
import type { NextUp } from '@/components/activity-feed';
import { BayStage, GROUND } from '@/components/bay-stage';
import { BrandLogo } from '@/components/brand-logo';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { formatMoney, humanise } from '@/lib/format';
import { Glyph, useToneColors } from '@/lib/instrument';
import {
  ease,
  Gauge,
  haptic,
  Odometer,
  PressableScale,
  Pulse,
  Rise,
  useIgnition,
  useReduceMotion,
} from '@/lib/motion';
import { figure, lift, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

const pad = (value: number) => String(value).padStart(2, '0');
// UTC, as the spend is bucketed.
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** The stage's foot, rounded, where it meets the page. */
const FOOT = radius.xxxl + 4;
/** The page's gutter, which the stage reaches past to the screen's edges. */
const GUTTER = spacing.lg;
/** The bar's own height under the status bar: room for its two round controls. */
const BAR = 52;
const CONTROL = 38;
/** The health's dial, and so the height every figure on the dash keeps. */
const DIAL = 24;
const SPARK = 16;
/** How far the dash docks up over the stage's foot: one object, the cluster on the showroom floor. */
const DOCK = 30;
/** An indicator's amber, as a car's — a light, not a status. */
const AMBER = '#FFB238';

/**
 * Year, make, type and variant — minus anything the name already says, so "2019 Mazda MX-5"
 * gets only "Car". The line under a vehicle's name where one is said.
 */
export function kindOf(vehicle: Vehicle): string {
  return [
    vehicle.year && String(vehicle.year),
    vehicle.make,
    humanise(vehicle.vehicleType),
    vehicle.variant,
  ]
    .filter((part): part is string => Boolean(part))
    .filter((part) => !vehicle.displayName.toLowerCase().includes(part.toLowerCase()))
    .join(' · ');
}

/**
 * The stage's size: the screen's whole width, and tall enough that the room under the status bar
 * keeps the showroom's shape — capped for a tablet.
 */
export function heroStage(screen: number, top: number) {
  const room = Math.min(320, Math.round(screen * 0.62));
  return { width: screen, height: room + top, top };
}

/*
 * The vehicles whose indicators have flashed this session.
 * ponytail: module-level, so going back and forth to one vehicle flashes it once.
 */
const unlocked = new Set<string>();

/**
 * The vehicle, at the top of every one of its sections: the bay it stands in on Home, up close,
 * drawn up to the screen's top edge with the page's bar floating over it (`VehicleTopBar`).
 *
 * The stage is the showroom's — the wall, the floor with its painted lines and the bay's number,
 * the strip light — with the vehicle on it: a cutout on the floor, a photo filling the bay, the
 * make's badge without either. The first time a session it is opened, its indicators flash twice
 * on the floor, felt as two taps: the car answering its key. On a scroll the scene moves slower
 * than the page; on a pull past the top the stage stays on the screen's edge and grows to fill
 * what the pull opens, its light humming while the vehicle is read again. A press opens the
 * gallery; held, it adds a photo.
 *
 * Its plate sits at the stage's foot, where a car wears one; under the stage the name, and the VIN.
 * Then the dash, one strip of readings with the job the vehicle needs next across its foot.
 */
export function VehicleHero({
  vehicle,
  photos,
  monthly,
  health,
  next,
  bay,
  y,
  refreshing = false,
  onAddPhoto,
  onEdit,
  onLogOdometer,
  onOpenStats,
  onOpenPlanned,
}: {
  vehicle: Vehicle;
  photos: readonly VehiclePhoto[] | undefined;
  /** Spend per month: this month on the dash. `undefined` while it loads, `null` when unknown. */
  monthly: MonthlySpend | null | undefined;
  /** The health score: `undefined` while it loads, `null` when there is not enough to judge. */
  health: number | null | undefined;
  /** The most pressing planned job; `null` with none, absent where Reminders is open anyway. */
  next?: NextUp | null;
  /** Its bay's number on Home, painted on the floor here too. */
  bay: number;
  /** The page's scroll, for the stage's parallax and its stretch. */
  y?: Animated.Value;
  /** The vehicle is being read again: the strip light hums. */
  refreshing?: boolean;
  onAddPhoto?: () => void;
  /** Where a vehicle with no plate or VIN sends you to fill them in. */
  onEdit?: () => void;
  onLogOdometer?: () => void;
  onOpenStats?: () => void;
  onOpenPlanned?: () => void;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const [viewing, setViewing] = useState(false);
  const [hum] = useState(() => new Animated.Value(1));
  const stage = heroStage(screen, insets.top);

  // The primary photo leads: it is the one chosen to stand for the vehicle, and the cutout.
  const gallery = (photos ?? [])
    .filter((photo) => photo.thumbnailUrl)
    .sort((a, b) =>
      a.id === vehicle.primaryPhoto?.id ? -1 : b.id === vehicle.primaryPhoto?.id ? 1 : 0,
    );
  const frames =
    gallery.length > 0 ? gallery : vehicle.primaryPhoto?.thumbnailUrl ? [vehicle.primaryPhoto] : [];
  const cover = frames[0];
  const vin = vehicle.identificationNumber;
  const plate = vehicle.registrationIdentifier;

  // The strip light hums while the vehicle is read again — the pull's answer, under the stage.
  useEffect(() => {
    if (!refreshing || reduce) {
      hum.setValue(1);
      return;
    }
    const to = (toValue: number) =>
      Animated.timing(hum, { toValue, duration: 380, easing: ease.inOut, useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([to(0.3), to(1)]));
    loop.start();
    return () => {
      loop.stop();
      hum.setValue(1);
    };
  }, [refreshing, reduce, hum]);

  /*
   * Pinned to the screen's top on a pull: it grows from its foot by exactly what the pull opens.
   * On the way down the scene inside it moves slower than the page.
   */
  const stretch = y
    ? {
        transform: [
          {
            scale: y.interpolate({
              inputRange: [-stage.height, 0],
              outputRange: [2, 1],
              extrapolate: 'clamp',
            }),
          },
        ],
      }
    : null;
  const scene = y
    ? {
        transform: [
          {
            translateY: y.interpolate({
              inputRange: [0, stage.height],
              outputRange: [0, stage.height * 0.4],
              extrapolate: 'clamp',
            }),
          },
        ],
      }
    : undefined;

  const openStage = () => {
    if (frames.length === 0) return onAddPhoto?.();
    haptic.light();
    setViewing(true);
  };

  return (
    <View style={styles.hero}>
      <Animated.View style={[styles.stageSlot, stretch]}>
        <PressableScale
          onPress={openStage}
          onLongPress={frames.length > 0 ? onAddPhoto : undefined}
          delayLongPress={350}
          disabled={frames.length === 0 && !onAddPhoto}
          accessibilityRole="button"
          accessibilityLabel={[
            frames.length > 1
              ? `Photos, ${frames.length}. Open the gallery`
              : frames.length === 1
                ? 'Open the photo'
                : 'Add a photo',
            // The plate is drawn on the stage, so the stage says it.
            plate ? `Number plate ${plate}` : null,
          ]
            .filter(Boolean)
            .join('. ')}
          accessibilityHint={frames.length > 0 && onAddPhoto ? 'Hold to add another' : undefined}
          // Full bleed: a stage that shrank under the thumb would pull its edges off the screen's.
          scaleTo={1}
        >
          <BayStage
            id={`hero-${vehicle.id}`}
            photo={cover ?? null}
            full
            make={vehicle.make}
            vehicleType={vehicle.vehicleType}
            width={stage.width}
            height={stage.height}
            inset={stage.top}
            number={bay}
            lit={hum}
            scene={scene}
            style={styles.stage}
          >
            {/* Over a photo, the status bar and the bar's controls need a darker sky to sit on. */}
            {cover && !cover.isCutout ? <Sky height={stage.top + BAR + 24} /> : null}
            <Unlock id={vehicle.id} width={stage.width} height={stage.height} top={stage.top} />
            <View pointerEvents="box-none" style={styles.foot}>
              <View pointerEvents="box-none" style={styles.marks}>
                {/* The plate where a car wears it, low on the front: what tells this one apart. */}
                {plate ? (
                  <View
                    style={[
                      styles.plateMount,
                      { backgroundColor: theme.cardRaised },
                      lift(theme, 'low'),
                    ]}
                  >
                    <Plate value={plate} />
                  </View>
                ) : null}
                {vin ? (
                  /*
                   * The VIN by its tail, beside the plate. The whole of it goes to the share sheet,
                   * which is where Copy lives on both platforms — all anyone does with a VIN is paste it.
                   */
                  <PressableScale
                    onPress={() => void Share.share({ message: vin }).catch(() => undefined)}
                    accessibilityRole="button"
                    accessibilityLabel={`VIN ${vin}`}
                    accessibilityHint="Share or copy it"
                    hitSlop={8}
                    scaleTo={0.92}
                    style={[styles.chip, { backgroundColor: `${theme.background}CC` }]}
                  >
                    <Text style={[figure, styles.chipLabel, { color: theme.foreground }]}>VIN</Text>
                    <Text style={[figure, styles.chipValue, { color: theme.mutedForeground }]}>
                      {vinTail(vin)}
                    </Text>
                    <Ionicons name="copy-outline" size={11} color={theme.mutedForeground} />
                  </PressableScale>
                ) : null}
                {/* No plate and no VIN: say what belongs here, and be the way to add it. */}
                {!plate && !vin && onEdit ? (
                  <PressableScale
                    onPress={onEdit}
                    accessibilityRole="button"
                    hitSlop={8}
                    scaleTo={0.94}
                    style={[styles.chip, { backgroundColor: `${theme.background}CC` }]}
                  >
                    <Ionicons name="add" size={13} color={theme.foreground} />
                    <Text style={[styles.chipAdd, { color: theme.foreground }]}>Plate & VIN</Text>
                  </PressableScale>
                ) : null}
                {/* Active is the ordinary case; only a vehicle that has left says so. */}
                {vehicle.status !== 'ACTIVE' ? (
                  <View style={[styles.mark, { backgroundColor: `${theme.background}CC` }]}>
                    <Text
                      style={[
                        typeScale.overline,
                        styles.markWord,
                        { color: theme.mutedForeground },
                      ]}
                    >
                      {humanise(vehicle.status)}
                    </Text>
                  </View>
                ) : null}
              </View>
              {frames.length > 1 ? (
                <View style={[styles.mark, { backgroundColor: `${theme.background}CC` }]}>
                  <Ionicons name="images-outline" size={12} color={theme.foreground} />
                  <Text style={[figure, styles.markFigure, { color: theme.foreground }]}>
                    {frames.length}
                  </Text>
                </View>
              ) : frames.length === 0 && onAddPhoto ? (
                // Without a photo the stage is the way to add one, and says so where the thumb is.
                <View
                  style={[styles.addPhoto, { backgroundColor: theme.primary }, lift(theme, 'low')]}
                >
                  <Ionicons name="camera" size={13} color={theme.primaryForeground} />
                  <Text style={[styles.addPhotoText, { color: theme.primaryForeground }]}>
                    Add photo
                  </Text>
                </View>
              ) : null}
            </View>
          </BayStage>
        </PressableScale>
      </Animated.View>

      {/* The name is the bar's, beside back; the dash docks onto the stage's foot. */}
      <Dash
        vehicle={vehicle}
        monthly={monthly}
        health={health}
        next={next}
        onLogOdometer={onLogOdometer}
        onOpenStats={onOpenStats}
        onOpenPlanned={onOpenPlanned}
      />

      {viewing ? (
        <PhotoViewer frames={frames} onClose={() => setViewing(false)} onAdd={onAddPhoto} />
      ) : null}
    </View>
  );
}

/** A darker sky over the top of a photo, for the status bar and the controls on it. */
function Sky({ height }: { height: number }) {
  const theme = useTheme();
  return (
    <Svg pointerEvents="none" width="100%" height={height} style={styles.sky}>
      <Defs>
        <LinearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={theme.background} stopOpacity={0.75} />
          <Stop offset="1" stopColor={theme.background} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height={height} fill="url(#hero-sky)" />
    </Svg>
  );
}

/**
 * The page's bar, floating over the stage: back on round glass, the vehicle's name beside it, and
 * its ⋯. As the stage goes under it the bar turns solid behind them — the stage and the bar are
 * one thing until the page needs a bar of its own. `pinned`, with no stage on the page, it is that
 * bar from the start, and the title wears the vehicle's picture and plate too.
 */
export function VehicleTopBar({
  vehicle,
  y,
  pinned = false,
  onBack,
  onMore,
}: {
  vehicle: Vehicle | undefined;
  y: Animated.Value;
  pinned?: boolean;
  onBack: () => void;
  onMore: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [shown] = useState(() => new Animated.Value(1));
  const stage = heroStage(width, insets.top);
  const under = stage.height - insets.top - BAR;
  const solid = pinned
    ? shown
    : y.interpolate({
        inputRange: [under - 48, under],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      });
  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top }]}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.cardRaised, opacity: solid }]}
      />
      <BarButton icon="chevron-back" label="Back" onPress={onBack} />
      <View pointerEvents="none" style={styles.barTitle}>
        <VehicleHeaderTitle vehicle={vehicle} bare={!pinned} />
      </View>
      <BarButton
        icon="ellipsis-horizontal"
        label={`More for ${vehicle?.displayName ?? 'this vehicle'}`}
        onPress={onMore}
      />
    </View>
  );
}

/** A control on the bar: a round of the page's colour, half see-through, over the stage. */
function BarButton({
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
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      scaleTo={0.88}
      style={[styles.barButton, { backgroundColor: `${theme.background}B3` }, rimmed(theme)]}
    >
      <Ionicons name={icon} size={20} color={theme.foreground} />
    </PressableScale>
  );
}

/**
 * The car answering its key: both indicators flash twice on the floor of the bay, each flash a tap
 * under the thumb. Once a session a vehicle, never under reduce motion, gone once it has played.
 */
function Unlock({
  id,
  width,
  height,
  top,
}: {
  id: string;
  width: number;
  height: number;
  /** Where the room starts under the status bar. */
  top: number;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [due] = useState(() => !reduce && !unlocked.has(id));
  const [done, setDone] = useState(!due);
  const [flash] = useState(() => new Animated.Value(0));
  const room = height - top;

  useEffect(() => {
    if (!due) return;
    unlocked.add(id);
    const on = () =>
      Animated.timing(flash, { toValue: 1, duration: 60, easing: ease.out, useNativeDriver: true });
    const off = (ms: number) =>
      Animated.timing(flash, { toValue: 0, duration: ms, easing: ease.in, useNativeDriver: true });
    // As the page lands: on, off, on, and a longer fade.
    const blink = Animated.sequence([
      Animated.delay(450),
      on(),
      off(240),
      Animated.delay(70),
      on(),
      off(420),
    ]);
    const first = setTimeout(haptic.light, 450);
    const second = setTimeout(haptic.light, 450 + 60 + 240 + 70);
    blink.start(({ finished }) => {
      if (finished) setDone(true);
    });
    return () => {
      blink.stop();
      clearTimeout(first);
      clearTimeout(second);
    };
  }, [due, flash, id]);

  if (done) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: flash }]}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={`blink-${id}`} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={AMBER} stopOpacity={theme.dark ? 0.8 : 0.65} />
            <Stop offset="1" stopColor={AMBER} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {[0.15, 0.85].map((at) => (
          <Ellipse
            key={at}
            cx={width * at}
            cy={top + room * GROUND}
            rx={width * 0.2}
            ry={room * 0.14}
            fill={`url(#blink-${id})`}
          />
        ))}
      </Svg>
    </Animated.View>
  );
}

/**
 * The dash, one strip of readings: the odometer on its drums, this month's spend beside the half
 * year it closes, and the health on a small dial whose needle checks itself on arrival. Each is a
 * way in, the odometer to log a reading, the spend and the dial to Stats. Across its foot, when
 * there is one, the job the vehicle needs next, lit in its tone like a lamp on a cluster.
 */
function Dash({
  vehicle,
  monthly,
  health,
  next,
  onLogOdometer,
  onOpenStats,
  onOpenPlanned,
}: {
  vehicle: Vehicle;
  monthly: MonthlySpend | null | undefined;
  health: number | null | undefined;
  next?: NextUp | null;
  onLogOdometer?: () => void;
  onOpenStats?: () => void;
  onOpenPlanned?: () => void;
}) {
  const theme = useTheme();
  // This calendar month's spend: the hero answers "what has it cost lately" without a year to unpick.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const spent =
    monthly === undefined
      ? undefined
      : monthly === null
        ? null
        : {
            amountMinor:
              monthly.points.find((point) => point.month === thisMonth)?.amountMinor ?? 0,
            currency: monthly.currency,
          };
  const unit = vehicle.odometerUnit === 'MI' ? 'MI' : 'KM';

  return (
    // The lift on a wrapper: a shadow on the view that clips its corners is clipped with them.
    <View style={[styles.dock, lift(theme)]}>
      <View style={[styles.dash, { backgroundColor: theme.cardRaised }, rimmed(theme)]}>
        <View style={styles.readings}>
          <DashCell
            label="Odometer"
            said={
              vehicle.currentOdometer === null
                ? 'Odometer, no reading yet'
                : `Odometer ${Math.round(vehicle.currentOdometer).toLocaleString()} ${unit.toLowerCase()}`
            }
            index={2}
            hint="Record a new reading"
            onPress={onLogOdometer}
          >
            <View style={styles.reading}>
              <Odometer value={vehicle.currentOdometer} size={14} />
              {vehicle.currentOdometer !== null ? (
                <Text style={[figure, styles.unit, { color: theme.mutedForeground }]}>{unit}</Text>
              ) : null}
            </View>
            {vehicle.currentEngineHours !== null ? (
              <Text style={[figure, styles.hours, { color: theme.mutedForeground }]}>
                {vehicle.currentEngineHours.toLocaleString()} H · ENGINE
              </Text>
            ) : null}
          </DashCell>
          <Rule />
          <DashCell
            label="Spent"
            basis={MONTH.format(new Date())}
            said={
              spent === undefined
                ? 'Spent this month, loading'
                : spent === null
                  ? 'Spent this month, not known'
                  : `Spent this month ${formatMoney(spent)}`
            }
            index={3}
            hint="Opens Stats"
            grow
            onPress={onOpenStats}
          >
            <View style={styles.reading}>
              {spent === undefined ? (
                <Skeleton width={52} height={16} />
              ) : (
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[
                    figure,
                    styles.figure,
                    styles.money,
                    { color: spent === null ? theme.mutedForeground : theme.foreground },
                  ]}
                >
                  {spent ? formatMoney(spent, true) : '—'}
                </Text>
              )}
              {monthly && monthly.points.length > 1 ? (
                <Spark points={monthly.points} month={thisMonth} />
              ) : null}
            </View>
          </DashCell>
          <Rule />
          <DashCell
            label="Health"
            said={
              health === undefined
                ? 'Health, loading'
                : health === null
                  ? 'Health not yet assessed'
                  : `Health ${health} out of 100`
            }
            index={4}
            hint="Opens Stats"
            onPress={onOpenStats}
          >
            {/* Mounted with its score, so the needle's check runs to the reading, not to a blank. */}
            <View style={styles.reading}>
              {health === undefined ? <RestingDial /> : <HealthDial score={health} />}
            </View>
          </DashCell>
        </View>
        {next ? <NextUpRow next={next} onPress={onOpenPlanned} /> : null}
      </View>
    </View>
  );
}

/** A hairline between two readings, short of the strip's edges. */
function Rule() {
  const theme = useTheme();
  return <View style={[styles.rule, { backgroundColor: theme.border }]} />;
}

/**
 * A reading on the dash: its label over its figure. The whole cell is the way into its reading,
 * each rising into place in turn like the web's.
 */
function DashCell({
  label,
  basis,
  said,
  index,
  hint,
  grow = false,
  onPress,
  children,
}: {
  label: string;
  basis?: string;
  /** The reading, as a screen reader says it. */
  said: string;
  index: number;
  hint: string;
  /** Takes the room the other readings leave. */
  grow?: boolean;
  onPress?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Rise index={index} style={grow ? styles.grow : null}>
      <PressableScale
        onPress={
          onPress
            ? () => {
                haptic.selection();
                onPress();
              }
            : undefined
        }
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={said}
        accessibilityHint={hint}
        scaleTo={0.95}
        style={styles.cell}
      >
        <Text numberOfLines={1} style={[styles.label, { color: theme.mutedForeground }]}>
          {label.toUpperCase()}
          {basis ? <Text style={figure}> · {basis.toUpperCase()}</Text> : null}
        </Text>
        {children}
      </PressableScale>
    </Rise>
  );
}

/** The health: the web's gauge drawn small beside its score, its needle checking itself first. */
function HealthDial({ score }: { score: number | null }) {
  const theme = useTheme();
  const band = healthBand(score);
  const progress = useIgnition(score === null ? 0 : score / 100);
  return (
    <>
      <Gauge progress={progress} size={DIAL} color={band ? theme[band] : undefined} bare label="" />
      <Text
        style={[
          figure,
          styles.figure,
          { color: score === null ? theme.mutedForeground : theme.foreground },
        ]}
      >
        {score ?? '—'}
      </Text>
    </>
  );
}

function RestingDial() {
  const [still] = useState(() => new Animated.Value(0));
  return (
    <>
      <Gauge progress={still} size={DIAL} bare label="" />
      <Skeleton width={22} height={16} />
    </>
  );
}

/**
 * The six months this one closes, as a column a month — this month in copper, the rest quiet —
 * rising in a wave from the oldest. How this month compares, before a figure is read.
 */
function Spark({
  points,
  month,
}: {
  points: MonthlySpend['points'];
  /** This month's key, `YYYY-MM`. */
  month: string;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [grow] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const shown = points.slice(-6);
  const max = Math.max(1, ...shown.map((point) => point.amountMinor));

  useEffect(() => {
    if (reduce) return;
    const animation = Animated.timing(grow, {
      toValue: 1,
      duration: 900,
      delay: 300,
      easing: ease.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [grow, reduce]);

  return (
    <View
      style={styles.spark}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shown.map((point, index) => {
        const now = point.month === month;
        const from = (index / shown.length) * 0.45;
        const spent = point.amountMinor > 0;
        return (
          <Animated.View
            key={point.month}
            style={[
              styles.sparkBar,
              {
                // A month with nothing spent is a mark on the line; any spend stands above it.
                height: spent ? Math.max(4, Math.round((point.amountMinor / max) * SPARK)) : 1.5,
                backgroundColor: now ? theme.primary : theme.borderStrong,
                opacity: now ? 1 : spent ? 0.8 : 0.5,
                transform: [
                  {
                    scaleY: grow.interpolate({
                      inputRange: [from, from + 0.55],
                      outputRange: [0, 1],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/**
 * The job the vehicle needs next — late before soon — across the dash's foot: washed in its tone
 * while it is late or near, what it is, how it stands, and the way to the rest in Reminders.
 */
function NextUpRow({ next, onPress }: { next: NextUp; onPress?: () => void }) {
  const theme = useTheme();
  const { soft, strong } = useToneColors(next.tone);
  const quiet = next.tone === 'neutral';
  return (
    <Rise index={5}>
      <PressableScale
        onPress={
          onPress
            ? () => {
                haptic.selection();
                onPress();
              }
            : undefined
        }
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={`Next up: ${next.title}, ${next.headline}`}
        accessibilityHint="Opens Reminders"
        scaleTo={0.98}
        style={[
          styles.next,
          { borderTopColor: theme.border, backgroundColor: quiet ? undefined : soft },
        ]}
      >
        <View
          style={[styles.nextTile, { backgroundColor: quiet ? theme.muted : theme.cardRaised }]}
        >
          <Glyph size={14}>{next.emoji}</Glyph>
        </View>
        <Text numberOfLines={1} style={[styles.nextLine, { color: theme.foreground }]}>
          {next.title}
        </Text>
        {next.tone === 'destructive' ? <Pulse color={strong} size={6} /> : null}
        <Text
          numberOfLines={1}
          style={[styles.nextHeadline, { color: quiet ? theme.mutedForeground : strong }]}
        >
          {next.headline}
        </Text>
        <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} />
      </PressableScale>
    </Rise>
  );
}

/**
 * The gallery, full screen: swiped a page at a time, the whole photo shown, a counter, and the
 * way to add another. Mounted only while open, so it always starts on the featured photo.
 */
function PhotoViewer({
  frames,
  onClose,
  onAdd,
}: {
  frames: readonly VehiclePhoto[];
  onClose: () => void;
  onAdd?: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const [position, setPosition] = useState(0);

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== position) haptic.selection();
    setPosition(next);
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={{ flex: 1, backgroundColor: theme.background }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <View style={[styles.viewerBar, { paddingTop: insets.top + spacing.sm }]}>
          <Text style={[figure, styles.viewerCount, { color: theme.foreground }]}>
            {pad(Math.min(position, frames.length - 1) + 1)}
            <Text style={{ color: theme.mutedForeground }}> / {pad(frames.length)}</Text>
          </Text>
          <View style={styles.viewerActions}>
            {onAdd ? (
              <PressableScale
                onPress={() => {
                  onClose();
                  onAdd();
                }}
                accessibilityRole="button"
                accessibilityLabel="Add a photo"
                scaleTo={0.88}
                style={[styles.round, { backgroundColor: theme.muted }]}
              >
                <Ionicons name="add" size={20} color={theme.foreground} />
              </PressableScale>
            ) : null}
            <PressableScale
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              scaleTo={0.88}
              style={[styles.round, { backgroundColor: theme.muted }]}
            >
              <Ionicons name="close" size={20} color={theme.foreground} />
            </PressableScale>
          </View>
        </View>

        {width > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
            style={{ flex: 1 }}
          >
            {frames.map((photo) => (
              <View
                key={photo.id}
                style={{ width, flex: 1, paddingBottom: insets.bottom + spacing.xl }}
              >
                <RemoteImage
                  uri={photo.url ?? photo.thumbnailUrl}
                  cacheKey={photoKey(photo, photo.url ? 'full' : 'thumb')}
                  style={{ flex: 1 }}
                  contentFit="contain"
                  transition={200}
                  accessibilityLabel={photo.caption ?? 'Photo'}
                />
              </View>
            ))}
          </ScrollView>
        ) : null}

        {frames.length > 1 ? (
          <View style={[styles.viewerDots, { bottom: insets.bottom + spacing.sm }]}>
            {frames.map((photo, index) => (
              <View
                key={photo.id}
                style={[
                  styles.viewerDot,
                  {
                    width: index === position ? 18 : 6,
                    backgroundColor: index === position ? theme.primary : theme.borderStrong,
                  },
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** The number plate, drawn as one — the web's: a dark band, then the registration in wide mono. */
function Plate({ value }: { value: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Number plate ${value}`}
      style={[
        styles.plate,
        { backgroundColor: theme.cardRaised, borderColor: `${theme.foreground}33` },
      ]}
    >
      <View style={[styles.plateBand, { backgroundColor: theme.foreground }]}>
        <Text
          allowFontScaling={false}
          style={[figure, styles.plateBandText, { color: theme.background }]}
        >
          REG
        </Text>
      </View>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={[figure, styles.plateText, { color: theme.foreground }]}
      >
        {value.toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * The bar's title, beside back: the vehicle's name. Where the stage is not (`bare` off) the
 * vehicle small beside it — its photo, or its make's badge — and its plate under it in the plate's
 * mono; over the stage, which shows both, the name alone and larger.
 */
export function VehicleHeaderTitle({
  vehicle,
  bare = false,
}: {
  vehicle: Vehicle | undefined;
  bare?: boolean;
}) {
  const theme = useTheme();
  const photo = !bare && vehicle?.primaryPhoto?.thumbnailUrl ? vehicle.primaryPhoto : null;
  const plate = bare ? null : vehicle?.registrationIdentifier;
  return (
    <View style={styles.headerTitle}>
      {photo ? (
        <View style={[styles.headerBadge, { backgroundColor: theme.muted }]}>
          <RemoteImage
            uri={photo.thumbnailUrl}
            cacheKey={photoKey(photo, 'thumb')}
            style={StyleSheet.absoluteFill}
            contentFit={photo.isCutout ? 'contain' : 'cover'}
            accessibilityElementsHidden
          />
        </View>
      ) : !bare && vehicle?.make ? (
        <View style={[styles.headerBadge, { backgroundColor: theme.muted }]}>
          <BrandLogo make={vehicle.make} size={22} />
        </View>
      ) : null}
      <View style={{ flexShrink: 1 }}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
          style={[bare ? styles.barName : typeScale.headline, { color: theme.foreground }]}
        >
          {vehicle?.displayName ?? 'Vehicle'}
        </Text>
        {plate ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={[figure, styles.headerPlate, { color: theme.mutedForeground }]}
          >
            {plate.toUpperCase()}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The hero before its vehicle arrives: the same stage and dash, with every label drawn as real
 * text. Only the name and the figures wait, so nothing moves when it lands.
 */
export function VehicleHeroSkeleton() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const stage = heroStage(screen, insets.top);
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading vehicle" style={styles.hero}>
      <View
        style={[
          styles.stageSlot,
          styles.stage,
          { height: stage.height, backgroundColor: theme.muted },
        ]}
      />
      <View
        style={[styles.dock, styles.dash, { backgroundColor: theme.cardRaised }, rimmed(theme)]}
      >
        <View style={styles.readings}>
          {(['ODOMETER', 'SPENT', 'HEALTH'] as const).map((label, index) => (
            <Fragment key={label}>
              {index > 0 ? <Rule /> : null}
              <View style={[styles.cell, label === 'SPENT' ? styles.grow : null]}>
                <Text style={[styles.label, { color: theme.mutedForeground }]}>{label}</Text>
                <View style={styles.reading}>
                  <Skeleton width={label === 'ODOMETER' ? 100 : 44} height={16} />
                </View>
              </View>
            </Fragment>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md },
  // Past the page's gutter to the screen's edges; grows from its foot when pulled.
  stageSlot: { marginHorizontal: -GUTTER, transformOrigin: 'bottom' },
  stage: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: FOOT,
    borderBottomRightRadius: FOOT,
  },
  sky: { position: 'absolute', top: 0, left: 0 },
  // Above the docked dash, where the floor shows.
  foot: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12 + DOCK,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  marks: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plateMount: { borderRadius: 4 },
  mark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  markWord: { fontSize: 10, lineHeight: 13 },
  markFigure: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  addPhoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  addPhotoText: { fontSize: 12, lineHeight: 15, fontWeight: '700' },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: (BAR - CONTROL) / 2,
  },
  barTitle: { flex: 1, minWidth: 0, alignItems: 'flex-start', paddingTop: (BAR - CONTROL) / 2 },
  barName: { fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: -0.4 },
  barButton: {
    marginTop: (BAR - CONTROL) / 2,
    width: CONTROL,
    height: CONTROL,
    borderRadius: CONTROL / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
  },
  chipLabel: { fontSize: 10.5, fontWeight: '700' },
  chipValue: { fontSize: 10.5, fontWeight: '600' },
  chipAdd: { fontSize: 11.5, fontWeight: '600' },
  // Docked up over the stage's foot; the hero's gap is cancelled so the overlap is exactly DOCK.
  dock: { marginTop: -(DOCK + spacing.md), borderRadius: radius.xxl },
  dash: { borderRadius: radius.xxl, overflow: 'hidden' },
  readings: { flexDirection: 'row' },
  grow: { flex: 1, minWidth: 0 },
  rule: { width: StyleSheet.hairlineWidth, marginVertical: 12 },
  cell: { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  label: { fontSize: 9.5, lineHeight: 12, fontWeight: '600', letterSpacing: 1 },
  // Every figure keeps the dial's height, so the three sit on one line.
  reading: { height: DIAL, flexDirection: 'row', alignItems: 'center', gap: 5 },
  unit: { fontSize: 9, lineHeight: 12, fontWeight: '600', letterSpacing: 1.2 },
  hours: { fontSize: 9.5, lineHeight: 12, fontWeight: '600', letterSpacing: 0.8 },
  // The web's figure: its mono at semibold, untracked.
  figure: { fontSize: 18, lineHeight: 22, fontWeight: '600', letterSpacing: 0 },
  money: { flexShrink: 1 },
  spark: {
    marginLeft: 'auto',
    height: SPARK,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  sparkBar: { width: 3, borderRadius: 1, transformOrigin: 'bottom' },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingLeft: 10,
    paddingRight: 12,
  },
  nextTile: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextLine: { flex: 1, fontSize: 13.5, lineHeight: 18, fontWeight: '600' },
  nextHeadline: { fontSize: 11.5, lineHeight: 16, fontWeight: '600' },
  plate: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 4,
  },
  plateBand: { width: 13, alignItems: 'center', justifyContent: 'center' },
  plateBandText: { fontSize: 5, fontWeight: '700' },
  plateText: {
    fontSize: 12,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: 1.8,
    paddingHorizontal: 8,
  },
  viewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  viewerCount: { fontSize: 14, fontWeight: '600' },
  viewerActions: { flexDirection: 'row', gap: spacing.sm },
  round: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerDots: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  viewerDot: { height: 6, borderRadius: 3 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  headerPlate: { fontSize: 10, lineHeight: 13, fontWeight: '600', letterSpacing: 1.4 },
  headerBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
