import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import {
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MonthlySpend, Vehicle, VehiclePhoto } from '@vehicle-os/contracts';
import { vinTail } from '@vehicle-os/ui';
import { BrandLogo } from '@/components/brand-logo';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { VehicleStage, vehicleIcon } from '@/components/vehicle-card';
import { formatMoney, humanise } from '@/lib/format';
import { haptic, Odometer, PressableScale, Rise } from '@/lib/motion';
import { figure, lift, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

const pad = (value: number) => String(value).padStart(2, '0');
// UTC, as the spend is bucketed.
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** The photo tile beside the name: a stage in miniature, the same shape with or without a photo. */
const TILE = { width: 84, height: 64 } as const;
/** The bezel: the frame's padding, so the corners inside run parallel to the frame's. */
const BEZEL = 6;
const FRAME_RADIUS = 18;
const INNER_RADIUS = FRAME_RADIUS - BEZEL;

/**
 * Year, make, type and variant — minus anything the name already says, so "2019 Mazda MX-5"
 * gets only "Car". The line under the name.
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
 * The vehicle, at the top of every one of its sections — the web's hero, as a device: a card with a
 * thin bezel and a screen set into it, the inner corners running parallel to the outer.
 *
 * Compact, because it heads every section and the section is what you came for: the photo as a
 * tile beside the name rather than a stage above it, and the screen as one strip — the odometer on
 * its drums and this month's spend side by side, each a way in: the odometer to log a new reading,
 * the spend to the rest of the figures in Stats. The tile opens the gallery, or adds the first photo.
 */
export function VehicleHero({
  vehicle,
  photos,
  monthly,
  onAddPhoto,
  onEdit,
  onLogOdometer,
  onOpenStats,
}: {
  vehicle: Vehicle;
  photos: readonly VehiclePhoto[] | undefined;
  /** Spend per month: this month on the screen. `undefined` while it loads, `null` when unknown. */
  monthly: MonthlySpend | null | undefined;
  onAddPhoto?: () => void;
  /** Where a vehicle with no plate or VIN sends you to fill them in. */
  onEdit?: () => void;
  onLogOdometer?: () => void;
  onOpenStats?: () => void;
}) {
  const theme = useTheme();
  const [viewing, setViewing] = useState(false);

  // The primary photo leads: it is the one chosen to stand for the vehicle, and the cutout.
  const gallery = (photos ?? [])
    .filter((photo) => photo.thumbnailUrl)
    .sort((a, b) =>
      a.id === vehicle.primaryPhoto?.id ? -1 : b.id === vehicle.primaryPhoto?.id ? 1 : 0,
    );
  const frames =
    gallery.length > 0 ? gallery : vehicle.primaryPhoto?.thumbnailUrl ? [vehicle.primaryPhoto] : [];
  const cover = frames[0];
  const kind = kindOf(vehicle);

  const vin = vehicle.identificationNumber;
  const plate = vehicle.registrationIdentifier;

  // This calendar month's spend: the hero answers "what has it cost lately" without a year to unpick.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const spent =
    monthly === undefined
      ? undefined
      : monthly === null
        ? null
        : formatMoney(
            {
              amountMinor:
                monthly.points.find((point) => point.month === thisMonth)?.amountMinor ?? 0,
              currency: monthly.currency,
            },
            true,
          );

  return (
    <View style={[styles.frame, { backgroundColor: theme.card }, rimmed(theme)]}>
      <View style={styles.header}>
        {cover ? (
          <PressableScale
            onPress={() => {
              haptic.light();
              setViewing(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              frames.length > 1 ? `Photos, ${frames.length}. Open the gallery` : 'Open the photo'
            }
            scaleTo={0.94}
            style={styles.tile}
          >
            <VehicleStage
              photo={cover}
              make={vehicle.make}
              vehicleType={vehicle.vehicleType}
              logoSize={32}
              style={StyleSheet.absoluteFill}
            >
              {frames.length > 1 ? (
                <View style={[styles.count, { backgroundColor: `${theme.background}CC` }]}>
                  <Ionicons name="images" size={9} color={theme.foreground} />
                  <Text style={[figure, styles.countText, { color: theme.foreground }]}>
                    {frames.length}
                  </Text>
                </View>
              ) : null}
            </VehicleStage>
          </PressableScale>
        ) : (
          /*
           * Without a photo the tile is the make's badge and the way to add one: a camera on its
           * corner rather than a button of its own.
           */
          <PressableScale
            onPress={onAddPhoto}
            disabled={!onAddPhoto}
            accessibilityRole={onAddPhoto ? 'button' : 'image'}
            accessibilityLabel={onAddPhoto ? 'Add photos' : (vehicle.make ?? 'Vehicle')}
            scaleTo={0.94}
            style={[styles.tile, styles.mark, { backgroundColor: theme.muted }]}
          >
            {vehicle.make ? (
              <View style={[styles.markLogo, { backgroundColor: theme.cardRaised }]}>
                <BrandLogo make={vehicle.make} size={36} />
              </View>
            ) : (
              <Ionicons
                name={vehicleIcon(vehicle.vehicleType)}
                size={24}
                color={theme.mutedForeground}
              />
            )}
            {onAddPhoto ? (
              <View style={[styles.camera, { backgroundColor: theme.primary }, lift(theme)]}>
                <Ionicons name="camera" size={11} color={theme.primaryForeground} />
              </View>
            ) : null}
          </PressableScale>
        )}

        <View style={styles.identity}>
          <View style={styles.nameRow}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[styles.name, { color: theme.foreground }]}
            >
              {vehicle.displayName}
            </Text>
            {/* Active is the ordinary case; only a vehicle that has left says so. */}
            {vehicle.status !== 'ACTIVE' ? (
              <View style={[styles.status, { backgroundColor: theme.muted }]}>
                <Text style={[styles.statusText, { color: theme.mutedForeground }]}>
                  {humanise(vehicle.status)}
                </Text>
              </View>
            ) : null}
          </View>
          {kind ? (
            <Text numberOfLines={1} style={[styles.kind, { color: theme.mutedForeground }]}>
              {kind}
            </Text>
          ) : null}

          {plate || vin || onEdit ? (
            // What tells this one apart from another of the same model.
            <View style={styles.meta}>
              {plate ? <Plate value={plate} /> : null}
              {vin ? (
                /*
                 * The VIN by its tail. The whole of it goes to the share sheet, which is where Copy
                 * lives on both platforms — the one thing anyone does with a VIN is paste it.
                 */
                <PressableScale
                  onPress={() => void Share.share({ message: vin }).catch(() => undefined)}
                  accessibilityRole="button"
                  accessibilityLabel={`VIN ${vin}`}
                  accessibilityHint="Share or copy it"
                  hitSlop={8}
                  scaleTo={0.92}
                  style={[styles.chip, { backgroundColor: theme.muted }]}
                >
                  <Text style={[figure, styles.chipLabel, { color: theme.foreground }]}>VIN</Text>
                  <Text style={[figure, styles.chipValue, { color: theme.mutedForeground }]}>
                    {vinTail(vin)}
                  </Text>
                  <Ionicons name="copy-outline" size={10} color={theme.mutedForeground} />
                </PressableScale>
              ) : null}
              {/* No plate and no VIN: say what belongs here, and be the way to add it. */}
              {!plate && !vin && onEdit ? (
                <PressableScale
                  onPress={onEdit}
                  accessibilityRole="button"
                  hitSlop={8}
                  scaleTo={0.94}
                  style={[styles.chip, { backgroundColor: theme.muted }]}
                >
                  <Ionicons name="add" size={12} color={theme.foreground} />
                  <Text style={[styles.chipAdd, { color: theme.foreground }]}>Plate & VIN</Text>
                </PressableScale>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {/* The screen: the readout set into the device, one strip of two readings. */}
      <View style={[styles.screen, { backgroundColor: theme.border }]}>
        <View style={styles.panels}>
          <ScreenPanel
            icon="speedometer-outline"
            label="Odometer"
            index={0}
            hint="Record a new reading"
            onPress={onLogOdometer}
          >
            <View style={styles.reading}>
              <Odometer value={vehicle.currentOdometer} size={15} />
              {vehicle.currentOdometer !== null ? (
                <Text style={[figure, styles.unit, { color: theme.mutedForeground }]}>
                  {vehicle.odometerUnit === 'MI' ? 'MI' : 'KM'}
                </Text>
              ) : null}
            </View>
          </ScreenPanel>
          <ScreenPanel
            icon="wallet-outline"
            label="Spent"
            basis={MONTH.format(new Date())}
            index={1}
            hint="Opens Stats"
            onPress={onOpenStats}
          >
            {spent === undefined ? (
              <Skeleton width={72} height={20} />
            ) : (
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[
                  figure,
                  styles.money,
                  { color: spent === null ? theme.mutedForeground : theme.foreground },
                ]}
              >
                {spent ?? '—'}
              </Text>
            )}
          </ScreenPanel>
        </View>
        {vehicle.currentEngineHours !== null ? (
          <View style={[styles.hours, { backgroundColor: theme.background }]}>
            <Text style={[styles.label, { color: theme.mutedForeground }]}>ENGINE</Text>
            <Text style={[figure, styles.hoursValue, { color: theme.foreground }]}>
              {vehicle.currentEngineHours.toLocaleString()} h
            </Text>
          </View>
        ) : null}
      </View>

      {viewing ? (
        <PhotoViewer frames={frames} onClose={() => setViewing(false)} onAdd={onAddPhoto} />
      ) : null}
    </View>
  );
}

/**
 * A panel on the screen: its label, a chevron when it leads somewhere, the figure. The whole panel
 * is the way into its reading, each rising into place in turn like the web's.
 */
function ScreenPanel({
  icon,
  label,
  basis,
  index,
  hint,
  onPress,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  basis?: string;
  index: number;
  hint: string;
  onPress?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Rise index={index + 1} style={{ flex: 1, minWidth: 0 }}>
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
        accessibilityLabel={label}
        accessibilityHint={hint}
        scaleTo={0.97}
        style={[styles.panel, { backgroundColor: theme.background }]}
      >
        <View style={styles.panelTop}>
          <Ionicons name={icon} size={11} color={theme.mutedForeground} />
          <Text numberOfLines={1} style={[styles.label, { color: theme.mutedForeground }]}>
            {label.toUpperCase()}
            {basis ? <Text style={figure}> · {basis.toUpperCase()}</Text> : null}
          </Text>
          {onPress ? (
            <Ionicons
              name="chevron-forward"
              size={11}
              color={theme.mutedForeground}
              style={styles.chevron}
            />
          ) : null}
        </View>
        {children}
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

/** The bar's title, shown once the hero has scrolled away: the badge and the name. */
export function VehicleHeaderTitle({ vehicle }: { vehicle: Vehicle | undefined }) {
  const theme = useTheme();
  return (
    <View style={styles.headerTitle}>
      {vehicle?.make ? (
        <View style={[styles.headerBadge, { backgroundColor: theme.muted }]}>
          <BrandLogo make={vehicle.make} size={22} />
        </View>
      ) : null}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={[typeScale.headline, { flexShrink: 1, color: theme.foreground }]}
      >
        {vehicle?.displayName ?? 'Vehicle'}
      </Text>
    </View>
  );
}

/**
 * The hero before its vehicle arrives: the same frame and the same screen, with every label drawn
 * as real text. Only the name and the figures are placeholders, so nothing moves when it lands.
 */
export function VehicleHeroSkeleton() {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading vehicle"
      style={[styles.frame, { backgroundColor: theme.card }, rimmed(theme)]}
    >
      <View style={styles.header}>
        <Skeleton width={TILE.width} height={TILE.height} radius={INNER_RADIUS} />
        <View style={[styles.identity, { gap: 7 }]}>
          <Skeleton width="65%" height={18} />
          <Skeleton width="40%" height={11} />
          <Skeleton width={110} height={20} radius={5} />
        </View>
      </View>
      <View style={[styles.screen, { backgroundColor: theme.border }]}>
        <View style={styles.panels}>
          {(['ODOMETER', 'SPENT'] as const).map((label) => (
            <View
              key={label}
              style={[styles.panel, { flex: 1, backgroundColor: theme.background }]}
            >
              <Text style={[styles.label, { color: theme.mutedForeground }]}>{label}</Text>
              <Skeleton width={84} height={20} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: FRAME_RADIUS, padding: BEZEL, gap: BEZEL },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md - 2 },
  tile: { ...TILE, borderRadius: INNER_RADIUS, overflow: 'hidden' },
  mark: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  markLogo: { width: 36, height: 36, borderRadius: 10, overflow: 'hidden' },
  camera: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 5,
    height: 15,
  },
  countText: { fontSize: 9, fontWeight: '700' },
  identity: { flex: 1, minWidth: 0, justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3 },
  status: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  statusText: { fontSize: 10, lineHeight: 14, fontWeight: '600' },
  kind: { fontSize: 12, lineHeight: 16 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 5 },
  chip: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  chipLabel: { fontSize: 10, fontWeight: '700' },
  chipValue: { fontSize: 10, fontWeight: '600' },
  chipAdd: { fontSize: 11, fontWeight: '600' },
  screen: { borderRadius: INNER_RADIUS, overflow: 'hidden', gap: StyleSheet.hairlineWidth },
  panels: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  panel: { paddingHorizontal: 10, paddingVertical: 8, gap: 4 },
  panelTop: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 12 },
  label: { flexShrink: 1, fontSize: 9.5, lineHeight: 12, fontWeight: '600', letterSpacing: 1 },
  chevron: { marginLeft: 'auto' },
  reading: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  unit: { fontSize: 9, fontWeight: '600', letterSpacing: 1.4, paddingBottom: 3 },
  money: { fontSize: 18, lineHeight: 20, fontWeight: '600', letterSpacing: -0.6 },
  hours: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hoursValue: { fontSize: 12, fontWeight: '600' },
  plate: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderWidth: 1,
  },
  plateBand: { width: 12, alignItems: 'center', justifyContent: 'center' },
  plateBandText: { fontSize: 5, fontWeight: '700' },
  plateText: {
    fontSize: 11,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: 1.6,
    paddingHorizontal: 7,
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
  headerBadge: {
    width: 28,
    height: 28,
    borderRadius: 9,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
