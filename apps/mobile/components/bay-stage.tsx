import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Defs,
  Ellipse,
  Line,
  LinearGradient,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import type { VehiclePhoto } from '@vehicle-os/contracts';
import type { VehicleType } from '@vehicle-os/domain';
import { BrandLogo } from '@/components/brand-logo';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { vehicleIcon } from '@/components/vehicle-card';
import { figure, lift, radius, useTheme, type Theme } from '@/lib/theme';

const pad = (value: number) => String(value).padStart(2, '0');

/** Where the back wall meets the floor, down the stage. */
export const HORIZON = 0.6;
/** Where the wheels stand. */
export const GROUND = 0.84;

export type StagePhoto = Pick<VehiclePhoto, 'id' | 'thumbnailUrl' | 'isCutout' | 'caption'> & {
  url?: string | null;
};

/** How lit a bay is, 0–1: a number when it never changes, a node when the light moves. */
export type Lit = number | Animated.Value | Animated.AnimatedMultiplication<number>;

/** The strip light's colour: a warm white at night, plain daylight by day. */
const lampColor = (theme: Theme) => (theme.dark ? '#FFF2E2' : '#FFFFFF');

/**
 * A vehicle in its bay — the stage the home's showroom and a vehicle's own page both draw.
 *
 * A back wall and a floor in perspective with its painted lines and number, under a strip light
 * that throws a cone onto the floor. A cutout stands on that floor with its contact shadow and its
 * reflection; a photo fills the bay; with neither, the make's badge stands there on a tile.
 *
 * The motion is the caller's: `drive` slides whatever stands in the bay sideways (a cutout driving
 * in on a swipe), `drift` a photo behind its frame, `scene` the whole room inside the frame (a
 * parallax, a lean-in on a pull). `children` draw over the stage: its marks, a door, a light.
 */
export function BayStage({
  id,
  photo,
  make,
  vehicleType,
  width,
  height,
  number,
  lit = 1,
  full = false,
  inset = 0,
  drive,
  drift,
  scene,
  style,
  children,
}: {
  /** Unique on the screen: the stage's gradients are named by it. */
  id: string;
  photo: StagePhoto | null | undefined;
  make: string | null;
  vehicleType: VehicleType;
  width: number;
  height: number;
  /** The bay's number, painted on the floor. */
  number: number;
  lit?: Lit;
  /** The original rather than the thumbnail, for the one big stage on a screen. */
  full?: boolean;
  /**
   * The top of the stage that is the status bar's, for a stage drawn up to the screen's edge: a
   * photo runs on under it; the room starts below it, its ceiling the wall's own colour.
   */
  inset?: number;
  drive?: Animated.AnimatedInterpolation<number>;
  drift?: Animated.AnimatedInterpolation<number>;
  scene?: Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const uri = photo?.thumbnailUrl
    ? full && !photo.isCutout
      ? (photo.url ?? photo.thumbnailUrl)
      : photo.thumbnailUrl
    : null;
  const key = photo ? photoKey(photo, full && !photo.isCutout ? 'full' : 'thumb') : '';
  const travel = drive ? { transform: [{ translateX: drive }] } : null;
  // The room's own height: the floor, the light and the vehicle are laid out in it.
  const room = height - inset;
  const tile = Math.round(Math.min(96, room * 0.36));
  const badge = (
    <View
      style={[
        styles.badge,
        { width: tile, height: tile, borderRadius: Math.round(tile * 0.3) },
        { backgroundColor: theme.cardRaised },
        lift(theme),
      ]}
    >
      {make ? (
        <BrandLogo make={make} size={Math.round(tile * 0.6)} />
      ) : (
        <Ionicons
          name={vehicleIcon(vehicleType)}
          size={Math.round(tile * 0.42)}
          color={theme.mutedForeground}
        />
      )}
    </View>
  );

  return (
    <View
      style={[
        styles.stage,
        // The wall's own top colour, so a scene moved down inside its frame shows no seam.
        { height, backgroundColor: theme.dark ? theme.background : theme.muted },
        style,
      ]}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, scene]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {uri && photo && !photo.isCutout ? (
          <Animated.View
            style={[
              styles.photo,
              drift
                ? { left: -width * 0.12, right: -width * 0.12, transform: [{ translateX: drift }] }
                : null,
            ]}
          >
            <RemoteImage
              uri={uri}
              cacheKey={key}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={260}
              accessible={false}
            />
          </Animated.View>
        ) : (
          <View style={[styles.room, { top: inset, height: room }]}>
            <Room id={id} width={width} height={room} lit={lit} />
            {uri ? (
              // The reflection: the cutout, upside down under its wheels, in a glossy floor.
              <Animated.View
                style={[
                  styles.subject,
                  { top: room * GROUND, height: room * (GROUND - 0.08) },
                  travel,
                ]}
              >
                <View style={[StyleSheet.absoluteFill, styles.reflection]}>
                  <RemoteImage
                    uri={uri}
                    cacheKey={key}
                    style={StyleSheet.absoluteFill}
                    contentFit="contain"
                    contentPosition="bottom"
                    accessible={false}
                  />
                </View>
              </Animated.View>
            ) : null}
            <Floor id={id} width={width} height={room} number={number} />
            {uri ? (
              <Animated.View
                style={[
                  styles.subject,
                  { top: room * 0.08, height: room * (GROUND - 0.08) },
                  travel,
                ]}
              >
                <Shadow id={id} width={width} y={room * (GROUND - 0.08)} />
                <RemoteImage
                  uri={uri}
                  cacheKey={key}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  contentPosition="bottom"
                  transition={260}
                  accessible={false}
                  fallback={<View style={[StyleSheet.absoluteFill, styles.fallback]}>{badge}</View>}
                />
              </Animated.View>
            ) : (
              <Animated.View
                style={[styles.subject, styles.fallback, { top: 0, height: room * GROUND }, travel]}
              >
                <Shadow id={id} width={width} y={room * GROUND} />
                {badge}
              </Animated.View>
            )}
          </View>
        )}
      </Animated.View>
      {children}
    </View>
  );
}

/**
 * The bay's back wall and floor, and the strip light over them. The light — its tube, glow, cone
 * and the pool it throws — rides `lit`, so it flickers on with a door and follows a swipe.
 */
export function Room({
  id,
  width,
  height,
  lit,
}: {
  id: string;
  width: number;
  height: number;
  lit: Lit;
}) {
  const theme = useTheme();
  const horizon = height * HORIZON;
  const ground = height * GROUND;
  const lamp = lampColor(theme);
  const mid = width / 2;
  return (
    <>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`wall-${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.dark ? theme.background : theme.muted} />
            <Stop offset="1" stopColor={theme.dark ? theme.cardRaised : theme.background} />
          </LinearGradient>
          <LinearGradient id={`floor-${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.dark ? theme.cardRaised : theme.background} />
            <Stop offset="1" stopColor={theme.muted} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={horizon} fill={`url(#wall-${id})`} />
        <Rect y={horizon} width={width} height={height - horizon} fill={`url(#floor-${id})`} />
        {/* The skirting where the wall meets the floor. */}
        <Line x1={0} x2={width} y1={horizon} y2={horizon} stroke={theme.border} strokeWidth={1} />
        {/* The strip light's housing, dark until the tube in it catches. */}
        <Rect x={mid - 42} y={7} width={84} height={8} rx={4} fill={theme.border} />
      </Svg>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: lit }]}>
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={`cone-${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={lamp} stopOpacity={theme.dark ? 0.16 : 0.85} />
              <Stop offset="1" stopColor={lamp} stopOpacity={0} />
            </LinearGradient>
            <RadialGradient id={`pool-${id}`} cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor={lamp} stopOpacity={theme.dark ? 0.2 : 0.95} />
              <Stop offset="1" stopColor={lamp} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id={`glow-${id}`} cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor={lamp} stopOpacity={theme.dark ? 0.45 : 0.9} />
              <Stop offset="1" stopColor={lamp} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Polygon
            points={`${mid - 36},12 ${mid + 36},12 ${mid + width * 0.46},${ground} ${mid - width * 0.46},${ground}`}
            fill={`url(#cone-${id})`}
          />
          <Ellipse
            cx={mid}
            cy={(horizon + ground) / 2 + 6}
            rx={width * 0.44}
            ry={(ground - horizon) * 0.95}
            fill={`url(#pool-${id})`}
          />
          <Ellipse cx={mid} cy={11} rx={86} ry={20} fill={`url(#glow-${id})`} />
          <Rect x={mid - 36} y={9} width={72} height={4} rx={2} fill={lamp} />
        </Svg>
      </Animated.View>
    </>
  );
}

/**
 * The floor's markings, over the reflection: a grid that runs back to the wall in perspective,
 * the bay's dashed lines either side, and its number painted at the front — and a fade at the
 * front edge, so the reflection sinks into the floor rather than stopping at a line.
 */
export function Floor({
  id,
  width,
  height,
  number,
}: {
  id: string;
  width: number;
  height: number;
  number: number;
}) {
  const theme = useTheme();
  const horizon = height * HORIZON;
  const ground = height * GROUND;
  const mid = width / 2;
  // Lines on the floor meet at a point just above the skirting, so the floor lies flat.
  const vanish = horizon - height * 0.16;
  const back = (bottom: number) => mid + (bottom - mid) * ((horizon - vanish) / (height - vanish));
  const columns = Array.from({ length: 15 }, (_, i) => -width * 0.75 + (i * width * 2.5) / 14);
  const rows = [1, 2, 3, 4, 5].map((k) => horizon + (height - horizon) * Math.pow(k / 5, 1.7));
  const bay = [width * 0.1, width * 0.9];
  return (
    <>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient
            id={`sink-${id}`}
            x1="0"
            y1={ground}
            x2="0"
            y2={height}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={theme.muted} stopOpacity={0} />
            <Stop offset="1" stopColor={theme.muted} stopOpacity={0.9} />
          </LinearGradient>
          <LinearGradient
            id={`grid-${id}`}
            x1="0"
            y1={horizon}
            x2="0"
            y2={height}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={theme.border} stopOpacity={0} />
            <Stop offset="1" stopColor={theme.border} stopOpacity={1} />
          </LinearGradient>
          <LinearGradient
            id={`paint-${id}`}
            x1="0"
            y1={horizon}
            x2="0"
            y2={height}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={theme.borderStrong} stopOpacity={0.15} />
            <Stop offset="1" stopColor={theme.borderStrong} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect y={ground} width={width} height={height - ground} fill={`url(#sink-${id})`} />
        {columns.map((bottom) => (
          <Line
            key={`c${bottom}`}
            x1={back(bottom)}
            y1={horizon}
            x2={bottom}
            y2={height}
            stroke={`url(#grid-${id})`}
            strokeWidth={1}
          />
        ))}
        {rows.map((y) => (
          <Line
            key={`r${y}`}
            x1={0}
            x2={width}
            y1={y}
            y2={y}
            stroke={`url(#grid-${id})`}
            strokeWidth={1}
          />
        ))}
        {bay.map((bottom) => (
          <Line
            key={`b${bottom}`}
            x1={back(bottom)}
            y1={horizon}
            x2={bottom}
            y2={height}
            stroke={`url(#paint-${id})`}
            strokeWidth={2.5}
            strokeDasharray="10 7"
          />
        ))}
      </Svg>
      {/* The bay's number, painted flat on the floor in front of the wheels. */}
      <View
        pointerEvents="none"
        style={[styles.painted, { top: ground - 6, height: height - ground + 6 }]}
      >
        <Text style={[figure, styles.paintedText, { color: theme.borderStrong }]}>
          {pad(number)}
        </Text>
      </View>
    </>
  );
}

/**
 * The contact shadow under whatever stands in the bay, so it stands on something. `y` is the
 * ground line inside the subject's box, which sits 8% in from the stage's left edge.
 */
function Shadow({ id, width, y }: { id: string; width: number; y: number }) {
  const theme = useTheme();
  const ink = theme.dark ? '#000000' : theme.shadow;
  return (
    <Svg
      pointerEvents="none"
      width={width}
      height={24}
      style={[styles.shadow, { top: y - 12, left: -width * 0.08 }]}
    >
      <Defs>
        <RadialGradient id={`shadow-${id}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={ink} stopOpacity={theme.dark ? 0.7 : 0.32} />
          <Stop offset="1" stopColor={ink} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={width / 2} cy={12} rx={width * 0.36} ry={9} fill={`url(#shadow-${id})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stage: { borderRadius: radius.xl + 2, overflow: 'hidden' },
  photo: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  room: { position: 'absolute', left: 0, right: 0 },
  subject: { position: 'absolute', left: '8%', right: '8%' },
  reflection: { opacity: 0.16, transform: [{ scaleY: -1 }] },
  fallback: { alignItems: 'center', justifyContent: 'flex-end' },
  badge: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  shadow: { position: 'absolute' },
  painted: { position: 'absolute', left: 0, right: 0, alignItems: 'center', overflow: 'hidden' },
  paintedText: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: 2,
    opacity: 0.55,
    transform: [{ perspective: 160 }, { rotateX: '62deg' }],
  },
});
