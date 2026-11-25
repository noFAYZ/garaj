import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { MonthlySpend, Vehicle, VehiclePhoto } from '@vehicle-os/contracts';
import { costTrendsQuery } from '@vehicle-os/api-client/react';
import { efficiencyInWindow, healthBand, vinTail } from '@vehicle-os/ui';
import type { NextUp } from '@/components/activity-feed';
import { BayStage } from '@/components/bay-stage';
import { BrandLogo } from '@/components/brand-logo';
import {
  DashCard,
  DashCell,
  DashCellSkeleton,
  DashMini,
  DashNote,
  DashReading,
  DashReadings,
  DashRow,
  DashRows,
  DashStack,
  DashUnit,
  DashValue,
} from '@/components/dash';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { api } from '@/lib/api';
import { Glyph } from '@/lib/instrument';
import { pad, DATE_LOCALE, formatMoney, humanise } from '@/lib/format';
import { ease, Gauge, haptic, PressableScale, useIgnition, useReduceMotion } from '@/lib/motion';
import { figure, lift, rimmed, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

// UTC, as the spend is bucketed.
const MONTH = new Intl.DateTimeFormat(DATE_LOCALE, { month: 'short', timeZone: 'UTC' });

/** What a fuel is measured in, as the rate says it — Stats' words. */
const FUEL_UNIT: Record<string, string> = {
  LITER: 'L',
  US_GALLON: 'gal',
  IMP_GALLON: 'gal',
  KWH: 'kWh',
  KG: 'kg',
};

/**
 * The vehicle's average consumption over its whole record, as Stats reads it — "8.4 L/100 km",
 * "30.0 mi/gal" — from the fuel it has used most; null until two fills with readings measure one.
 */
function useFuelAverage(vehicle: Vehicle): { value: string; unit: string } | null | undefined {
  const trends = useQuery(costTrendsQuery(api, vehicle.id));
  if (trends.isPending) return undefined;
  const perHundred = vehicle.odometerUnit !== 'MI';
  const distance = perHundred ? 'km' : 'mi';
  const [best] = (trends.data?.efficiency ?? [])
    .flatMap((series) => {
      const result = efficiencyInWindow(series.points, 0, perHundred);
      return result
        ? [{ unit: series.unit, average: result.average, n: series.points.length }]
        : [];
    })
    .sort((a, b) => b.n - a.n);
  if (!best) return null;
  const fuel = FUEL_UNIT[best.unit] ?? best.unit;
  return {
    value: best.average.toFixed(1),
    unit: perHundred ? `${fuel}/100${distance}` : `${distance}/${fuel}`,
  };
}

/** The page's gutter, which the stage reaches past towards the screen's edges. */
const GUTTER = spacing.lg;
/**
 * How far the stage stands in from the screen's sides and top: a card on the page, with room round
 * it, but still wider than the dash that docks onto it (which keeps the page's gutter).
 */
const STAGE_INSET = spacing.sm;
/** The bar's own height under the status bar: room for its two round controls. */
const BAR = 52;
const CONTROL = 38;
const SPARK = 16;
/** How far the dash docks up over the stage's foot: one object, the cluster on the showroom floor. */
const DOCK = 30;

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
  // What of the stage is under the status bar, now that it starts STAGE_INSET down the screen.
  const under = Math.max(0, top - STAGE_INSET);
  return {
    width: screen - STAGE_INSET * 2,
    height: room + under,
    top: under,
    /** Where the stage's foot is on the screen, from its top edge. */
    foot: STAGE_INSET + room + under,
  };
}

/**
 * The vehicle, at the top of every one of its sections, drawn up to the screen's top edge with the
 * page's bar floating over it (`VehicleTopBar`).
 *
 * The stage is plain (user asked): the vehicle on the page's own ground — a photo filling it, a
 * cutout standing with its shadow, the make's badge without either — and nothing moving but the
 * vehicle coming into view. A press opens the gallery; held, it adds a photo.
 *
 * Its plate sits at the stage's foot, where a car wears one, the VIN beside it. Then the dash, one
 * strip of readings with the job the vehicle needs next across its foot.
 */
export function VehicleHero({
  vehicle,
  photos,
  monthly,
  health,
  next,
  bay,
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
  onAddPhoto?: () => void;
  /** Where a vehicle with no plate or VIN sends you to fill them in. */
  onEdit?: () => void;
  onLogOdometer?: () => void;
  onOpenStats?: () => void;
  onOpenPlanned?: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const [viewing, setViewing] = useState(false);
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

  const openStage = () => {
    if (frames.length === 0) return onAddPhoto?.();
    haptic.light();
    setViewing(true);
  };

  return (
    <View style={styles.hero}>
      {/* The lift on a wrapper: a shadow on the view that clips its corners is clipped with them. */}
      <View style={[styles.stageSlot, { backgroundColor: theme.background }, lift(theme, 'low')]}>
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
          // A card on the page now, so it gives a little under the thumb like the rest.
          scaleTo={0.985}
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
            plain
            style={[styles.stage, rimmed(theme)]}
          >
            {/* Over a photo, the status bar and the bar's controls need a darker sky to sit on. */}
            {cover && !cover.isCutout ? <Sky height={stage.top + BAR + 24} /> : null}
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
      </View>

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
 * The page's bar, floating: back and ⋯ on round glass, the vehicle's name between them. It never
 * turns into a solid bar (user asked: no floating top bars anywhere) — the name steps aside as the
 * page scrolls under it, and only the two round keys stay. `pinned`, with no stage on the page,
 * the title wears the vehicle's picture and plate too.
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
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const stage = heroStage(width, insets.top);
  const under = stage.foot - insets.top - BAR;
  // Gone before anything scrolls under it: at once on a pinned page, past the stage on Logs.
  const title = y.interpolate({
    inputRange: pinned ? [0, 24] : [under - 48, under - 8],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top }]}>
      <BarButton icon="chevron-back" label="Back" onPress={onBack} />
      <Animated.View pointerEvents="none" style={[styles.barTitle, { opacity: title }]}>
        <VehicleHeaderTitle vehicle={vehicle} bare={!pinned} />
      </Animated.View>
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
 * The dash: three readings on tiles of their own — the odometer, this month's spend with the half
 * year it closes, and the health on a small dial whose needle checks itself on arrival — each the
 * same width, an icon by its word, so they stand apart without a line between them. Each tile is a
 * way in: the odometer to log a reading, the spend and the dial to Stats. Under them, when there is
 * one, the job the vehicle needs next, its status in its tone.
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
  const reading = vehicle.currentOdometer;
  // A small phone's tiles are a third of 288: tighter, a size down, the month left to the label.
  const narrow = useWindowDimensions().width < 360;
  const fuel = useFuelAverage(vehicle);

  return (
    // The lift on a wrapper: a shadow on the view that clips its corners is clipped with them.
    <View style={[styles.dock, lift(theme)]}>
      <DashCard>
        <DashReadings>
          <DashCell
            icon="speedometer-outline"
            label="Odometer"
            said={
              reading === null
                ? 'Odometer, no reading yet'
                : `Odometer ${Math.round(reading).toLocaleString()} ${unit.toLowerCase()}`
            }
            index={2}
            hint="Record a new reading"
            narrow={narrow}
            onPress={onLogOdometer}
          >
            <DashReading>
              <DashValue muted={reading === null} narrow={narrow}>
                {reading === null ? '—' : Math.round(reading).toLocaleString()}
              </DashValue>
              {reading !== null ? <DashUnit>{unit}</DashUnit> : null}
            </DashReading>
            {vehicle.currentEngineHours !== null ? (
              <DashNote>{vehicle.currentEngineHours.toLocaleString()} H ENGINE</DashNote>
            ) : null}
          </DashCell>
          <DashCell
            icon="wallet-outline"
            label="Spent"
            basis={narrow ? undefined : MONTH.format(new Date())}
            said={
              spent === undefined
                ? 'Spent this month, loading'
                : spent === null
                  ? 'Spent this month, not known'
                  : `Spent this month ${formatMoney(spent)}`
            }
            index={3}
            hint="Opens Stats"
            narrow={narrow}
            onPress={onOpenStats}
          >
            <DashReading>
              {spent === undefined ? (
                <Skeleton width={48} height={16} />
              ) : (
                <DashValue muted={!spent} narrow={narrow}>
                  {spent ? formatMoney(spent, true) : '—'}
                </DashValue>
              )}
              {monthly && monthly.points.length > 1 ? (
                <Spark points={monthly.points} month={thisMonth} />
              ) : null}
            </DashReading>
          </DashCell>
          <DashStack>
            <DashMini
              // Mounted with its score, so the needle's check runs to the reading, not to a blank.
              lead={health === undefined ? <RestingDial /> : <HealthDial score={health} />}
              value={health === undefined ? undefined : String(health ?? '—')}
              muted={health === null}
              word="Health"
              said={
                health === undefined
                  ? 'Health, loading'
                  : health === null
                    ? 'Health not yet assessed'
                    : `Health ${health} out of 100`
              }
              index={4}
              hint="Opens Stats"
              narrow={narrow}
              onPress={onOpenStats}
            />
            <DashMini
              lead={<Glyph size={14}>⛽</Glyph>}
              value={fuel === undefined ? undefined : (fuel?.value ?? '—')}
              muted={!fuel}
              word={fuel?.unit ?? 'Avg'}
              said={
                fuel === undefined
                  ? 'Fuel average, loading'
                  : fuel === null
                    ? 'Fuel average not yet measured'
                    : `Fuel average ${fuel.value} ${fuel.unit}`
              }
              index={5}
              hint="Opens Stats"
              narrow={narrow}
              onPress={onOpenStats}
            />
          </DashStack>
        </DashReadings>
        {next ? (
          <DashRows>
            <DashRow
              emoji={next.emoji}
              title={next.title}
              status={next.headline}
              tone={next.tone}
              onPress={onOpenPlanned}
              accessibilityLabel={`Next up: ${next.title}, ${next.headline}`}
              accessibilityHint="Opens Reminders"
            />
          </DashRows>
        ) : null}
      </DashCard>
    </View>
  );
}

/** The dial beside the health's score on its small card. */
const MINI_DIAL = 16;

/** The health: the web's gauge drawn small beside its score, its needle checking itself first. */
function HealthDial({ score }: { score: number | null }) {
  const theme = useTheme();
  const band = healthBand(score);
  const progress = useIgnition(score === null ? 0 : score / 100);
  return (
    <Gauge
      progress={progress}
      size={MINI_DIAL}
      color={band ? theme[band] : undefined}
      bare
      label=""
    />
  );
}

function RestingDial() {
  const [still] = useState(() => new Animated.Value(0));
  return <Gauge progress={still} size={MINI_DIAL} bare label="" />;
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
          <BrandLogo make={vehicle.make} size={32} />
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
          { height: stage.height, backgroundColor: theme.background },
        ]}
      />
      <DashCard style={styles.dock}>
        <DashReadings>
          {(['Odometer', 'Spent', 'Health'] as const).map((label) => (
            <DashCellSkeleton key={label} label={label} width={label === 'Odometer' ? 72 : 44} />
          ))}
        </DashReadings>
      </DashCard>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md },
  // Past the page's gutter, but STAGE_INSET short of the screen's sides and top: a card, rounded all
  // round, still wider than the dash on its foot.
  stageSlot: {
    marginHorizontal: -GUTTER + STAGE_INSET,
    marginTop: STAGE_INSET,
    ...leaf('lg'),
  },
  stage: leaf('lg'),
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
  dock: { marginTop: -(DOCK + spacing.md), ...leaf('lg') },
  spark: {
    flexShrink: 0,
    height: SPARK,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  sparkBar: { width: 3, borderRadius: 1, transformOrigin: 'bottom' },
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
