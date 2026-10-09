import { Ionicons } from '@expo/vector-icons';
import { useQueries } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { memo, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import type { Vehicle, VehiclePhoto } from '@vehicle-os/contracts';
import type { VehicleType } from '@vehicle-os/domain';
import { costQuery } from '@vehicle-os/api-client/react';
import { paintSwatch } from '@vehicle-os/ui';
import { BrandLogo } from '@/components/brand-logo';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { api } from '@/lib/api';
import { formatMoney, humanise } from '@/lib/format';
import { ease, PressableScale, useReduceMotion } from '@/lib/motion';
import { figure, lift, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

const TYPE_ICONS: Partial<Record<VehicleType, keyof typeof Ionicons.glyphMap>> = {
  CAR: 'car-sport-outline',
  VAN: 'bus-outline',
  RV: 'bus-outline',
  MOTORCYCLE: 'bicycle-outline',
  SCOOTER: 'bicycle-outline',
  BICYCLE: 'bicycle-outline',
  BOAT: 'boat-outline',
};

export const vehicleIcon = (type: VehicleType) => TYPE_ICONS[type] ?? 'car-outline';

type Money = { amountMinor: number; currency: string };
type StagePhoto = Pick<VehiclePhoto, 'id' | 'thumbnailUrl' | 'isCutout' | 'caption'> & {
  url?: string | null;
};

/**
 * What each vehicle has cost to run: everything spent on it except buying it, lifetime, in its own
 * currency — the web's `useSpent`, from the same cost summaries, cached and shared with Stats.
 *
 * ponytail: one request per card. Plans cap a garage at a handful of vehicles.
 *
 * `undefined` while it loads, `null` when it could not be had.
 */
export function useSpent(
  vehicles: readonly Vehicle[],
): ReadonlyMap<string, Money | null | undefined> {
  const results = useQueries({ queries: vehicles.map((vehicle) => costQuery(api, vehicle.id)) });
  return new Map(
    vehicles.map((vehicle, index) => {
      const result = results[index];
      if (!result || result.isPending) return [vehicle.id, undefined];
      const cost = result.data;
      if (!cost) return [vehicle.id, null];
      return [
        vehicle.id,
        {
          amountMinor: cost.ownershipCost.amountMinor - (cost.purchasePrice?.amountMinor ?? 0),
          currency: cost.currency,
        },
      ];
    }),
  );
}

/**
 * The photo stage, as the web draws it. A background-removed cutout stands on the stage with a
 * soft floor shadow under it — the object, not a picture of it. An ordinary photo is shown whole
 * over a soft, dimmed copy of itself filling the rest, so cropping never takes the roof or the
 * wheels off. With no photo, the make's badge on a lifted tile, else the kind of vehicle.
 *
 * `imageStyle` lets a carousel or a scroll drift the picture inside its frame.
 */
export function VehicleStage({
  photo,
  make,
  vehicleType,
  logoSize = 56,
  full = false,
  style,
  imageStyle,
  children,
}: {
  photo: StagePhoto | null | undefined;
  make: string | null;
  vehicleType: VehicleType;
  logoSize?: number;
  /** The full-size original rather than the thumbnail — for the one big stage on a screen. */
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  imageStyle?: Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const cutout = Boolean(photo?.isCutout);
  const uri = photo
    ? full && !cutout
      ? (photo.url ?? photo.thumbnailUrl)
      : photo.thumbnailUrl
    : null;
  const key = photo ? photoKey(photo, full && !cutout ? 'full' : 'thumb') : '';
  const badge = make ? (
    <View
      style={[
        styles.badge,
        { width: logoSize, height: logoSize, backgroundColor: theme.cardRaised },
        lift(theme),
      ]}
    >
      <BrandLogo make={make} size={logoSize} />
    </View>
  ) : (
    <Ionicons
      name={vehicleIcon(vehicleType)}
      size={Math.round(logoSize * 0.8)}
      color={theme.borderStrong}
    />
  );

  return (
    <View
      style={[
        styles.stage,
        { backgroundColor: photo && uri && !cutout ? theme.muted : `${theme.muted}80` },
        style,
      ]}
    >
      {photo && uri ? (
        cutout ? (
          <>
            {/* The floor: a soft contact shadow, so the cutout stands on something. */}
            <Svg
              pointerEvents="none"
              style={styles.floor}
              viewBox="0 0 100 20"
              preserveAspectRatio="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Defs>
                <RadialGradient id="floor" cx="50%" cy="50%" rx="50%" ry="50%">
                  <Stop offset="0" stopColor={theme.foreground} stopOpacity={0.22} />
                  <Stop offset="1" stopColor={theme.foreground} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Ellipse cx="50" cy="10" rx="50" ry="10" fill="url(#floor)" />
            </Svg>
            <Animated.View style={[styles.cutout, imageStyle]}>
              <RemoteImage
                uri={uri}
                cacheKey={key}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                transition={260}
                accessibilityLabel={photo.caption ?? undefined}
                accessibilityIgnoresInvertColors
                fallback={badge}
              />
            </Animated.View>
          </>
        ) : (
          <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
            {/* The whole photo over a soft copy of itself, so the composition holds at any shape. */}
            <RemoteImage
              uri={uri}
              cacheKey={key}
              style={[StyleSheet.absoluteFill, { opacity: 0.5, transform: [{ scale: 1.1 }] }]}
              contentFit="cover"
              blurRadius={24}
              accessible={false}
            />
            <RemoteImage
              uri={uri}
              cacheKey={key}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              transition={260}
              accessibilityLabel={photo.caption ?? undefined}
              accessibilityIgnoresInvertColors
              fallback={badge}
            />
          </Animated.View>
        )
      ) : (
        badge
      )}
      {children}
    </View>
  );
}

/**
 * The garage grid's unit, as the web's (PRD §27): the vehicle on its stage, who it is, and its two
 * running figures.
 *
 * Nothing is printed over a photograph except a status that is not Active. Under it the name,
 * given two lines; what tells this one apart — the kind, the paint as a swatch — and the arrow that
 * says the whole card is the way in, turning copper as it is pressed. Then the two figures that
 * grow, in a small panel of their own: how far it has gone, and what it has cost to run.
 *
 * Memoised so a pull-to-refresh does not re-render every unchanged card.
 */
export const VehicleCard = memo(function VehicleCard({
  vehicle,
  spent,
  subtitle,
}: {
  vehicle: Vehicle;
  /** Running spend: `undefined` while it loads, `null` when it could not be had. */
  spent?: Money | null;
  /** Said under the name in place of the kind — the garage, on a list that mixes garages. */
  subtitle?: string;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const [turn] = useState(() => new Animated.Value(0));
  const photo = vehicle.primaryPhoto?.thumbnailUrl ? vehicle.primaryPhoto : null;
  const swatch = paintSwatch(vehicle.color);
  const unit = vehicle.odometerUnit === 'MI' ? 'mi' : 'km';
  const kind =
    subtitle ?? [humanise(vehicle.vehicleType), vehicle.variant].filter(Boolean).join(' · ');
  const odometer =
    vehicle.currentOdometer !== null ? Math.round(vehicle.currentOdometer).toLocaleString() : null;

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
    <Link href={{ pathname: '/vehicle/[id]', params: { id: vehicle.id } }} asChild>
      <PressableScale
        onPressIn={() => press(true)}
        onPressOut={() => press(false)}
        accessibilityRole="button"
        accessibilityLabel={[
          vehicle.displayName,
          odometer ? `${odometer} ${unit}` : null,
          spent ? `spent ${formatMoney(spent, true)}` : null,
          vehicle.status !== 'ACTIVE' ? humanise(vehicle.status) : null,
        ]
          .filter(Boolean)
          .join(', ')}
        scaleTo={0.985}
        style={[styles.card, { backgroundColor: theme.card }, rimmed(theme)]}
      >
        <VehicleStage
          photo={photo}
          make={vehicle.make}
          vehicleType={vehicle.vehicleType}
          style={styles.cardStage}
        >
          {vehicle.status !== 'ACTIVE' ? (
            <View style={[styles.status, { backgroundColor: `${theme.background}CC` }]}>
              <Text style={[typeScale.overline, { color: theme.mutedForeground }]}>
                {humanise(vehicle.status)}
              </Text>
            </View>
          ) : null}
        </VehicleStage>

        <View style={styles.identity}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={[typeScale.headline, { color: theme.foreground }]}>
              {vehicle.displayName}
            </Text>
            <View style={styles.kind}>
              {/* The badge is on the stage when there is no photo; beside the kind when there is. */}
              {photo && vehicle.make ? <BrandLogo make={vehicle.make} size={14} /> : null}
              <Text
                numberOfLines={1}
                style={[typeScale.caption, { flexShrink: 1, color: theme.mutedForeground }]}
              >
                {kind}
              </Text>
              {vehicle.color ? (
                <>
                  <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>·</Text>
                  {swatch ? (
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: swatch, borderColor: theme.hairline },
                      ]}
                    />
                  ) : null}
                  <Text
                    numberOfLines={1}
                    style={[typeScale.caption, { flexShrink: 1, color: theme.mutedForeground }]}
                  >
                    {vehicle.color}
                  </Text>
                </>
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
              size={14}
              color={pressed ? theme.primaryForeground : theme.mutedForeground}
            />
          </Animated.View>
        </View>

        {/*
         * Two figures in a small panel, the odometer always first, so a column of cards reads down.
         */}
        <View style={[styles.figures, { backgroundColor: `${theme.muted}99` }]}>
          <CardFigure label="Odometer" value={odometer} unit={unit} />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <CardFigure
            label="Spent"
            value={spent === undefined ? undefined : spent && formatMoney(spent, true)}
          />
        </View>
      </PressableScale>
    </Link>
  );
});

function CardFigure({
  label,
  value,
  unit,
}: {
  label: string;
  /** `undefined` while it loads; `null` for nothing to show. */
  value: string | null | undefined;
  unit?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.figure}>
      <Text numberOfLines={1} style={[typeScale.overline, { color: theme.mutedForeground }]}>
        {label}
      </Text>
      {value === undefined ? (
        <Skeleton width={64} height={16} style={{ marginTop: 3 }} />
      ) : (
        <View style={styles.figureLine}>
          <Text
            numberOfLines={1}
            style={[
              figure,
              styles.figureValue,
              { color: value === null ? theme.mutedForeground : theme.foreground },
            ]}
          >
            {value ?? '—'}
          </Text>
          {value && unit ? (
            <Text style={[typeScale.caption, { fontSize: 11, color: theme.mutedForeground }]}>
              {unit}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

export function VehicleCardSkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card }, rimmed(theme)]}>
      <Skeleton radius={radius.lg} style={styles.cardStage} />
      <View style={[styles.identity, { paddingVertical: 2 }]}>
        <View style={{ flex: 1, gap: 6 }}>
          <Skeleton width="70%" height={15} />
          <Skeleton width="45%" height={11} />
        </View>
      </View>
      <Skeleton height={48} radius={radius.lg} style={{ marginHorizontal: 6 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cutout: { position: 'absolute', left: '8%', right: '8%', top: '8%', bottom: '10%' },
  floor: { position: 'absolute', left: '20%', right: '20%', bottom: '9%', height: '12%' },
  badge: {
    borderRadius: radius.xxl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { borderRadius: radius.xxl, padding: spacing.sm, paddingBottom: 10, gap: spacing.md },
  cardStage: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.lg },
  status: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: 6,
  },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, minWidth: 0 },
  swatch: { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
  arrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  figures: { flexDirection: 'row', marginHorizontal: 6, borderRadius: radius.lg },
  divider: { width: StyleSheet.hairlineWidth },
  figure: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  figureLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 },
  figureValue: { flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: '600' },
});
