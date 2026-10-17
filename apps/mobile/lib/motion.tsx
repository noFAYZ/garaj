import * as Haptics from 'expo-haptics';
import {
  Fragment,
  forwardRef,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { figure, useTheme } from './theme';

/**
 * Motion, on the web's clock.
 *
 * The same curves and durations `globals.css` names — `--ease-out-quint`, a 360ms rise of 10px, a
 * 28ms stagger, the odometer's roll — so a screen settles the same way on either platform. Anything
 * the thumb touches answers on the UI thread (native driver, transform and opacity only), and every
 * movement is skipped under the OS reduce-motion setting: the state still changes, it just does
 * not travel.
 */

export const duration = {
  instant: 60,
  fast: 160,
  base: 220,
  rise: 360,
  dial: 700,
  roll: 1300,
} as const;

export const ease = {
  /** `--ease-out-quint`: arrivals — fast out of the gate, a long soft landing. */
  out: Easing.bezier(0.22, 1, 0.36, 1),
  /** `--ease-standard`: colour and small state changes. */
  standard: Easing.bezier(0.2, 0.75, 0.25, 1),
  /** `--ease-in-out`: things that travel while staying on screen. */
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  /** Exits: leave quickly, nobody watches something go. */
  in: Easing.bezier(0.7, 0, 0.84, 0),
} as const;

export const spring = {
  /** The web nav pill's spring (`bounce: 0.18, duration: 0.32`): indicators that travel. */
  glide: { speed: 18, bounciness: 6 },
  /** Things that arrive with a little joy: a tick, a badge, a card dealt from the key. */
  pop: { speed: 14, bounciness: 12 },
} as const;

/*
 * The OS reduce-motion setting, read once and kept current.
 * ponytail: one app-lifetime subscription at import, instead of one listener per pressable.
 */
let reduceMotion = false;
const listeners = new Set<() => void>();
function setReduceMotion(value: boolean) {
  reduceMotion = value;
  listeners.forEach((listener) => listener());
}
void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

export function useReduceMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => reduceMotion,
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A `Pressable` that gives under the thumb and springs back with a little overshoot — the web's
 * `active:scale-[0.99]` on a card, `active:scale-95` on a control, with the release a phone can
 * feel. Scale only: the web never dims what is pressed.
 *
 * `forwardRef` because expo-router's `<Link asChild>` hands its child a ref.
 */
export const PressableScale = forwardRef<
  View,
  Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number }
>(function PressableScale({ style, scaleTo = 0.97, onPressIn, onPressOut, ...props }, ref) {
  const reduce = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));

  const animateTo = (toValue: 0 | 1) => {
    if (reduce) {
      progress.setValue(toValue);
      return;
    }
    Animated.spring(progress, {
      toValue,
      useNativeDriver: true,
      speed: toValue === 1 ? 60 : 22,
      // Straight down on press, a small bounce on release: the button settling back.
      bounciness: toValue === 1 ? 0 : 9,
    }).start();
  };

  return (
    <AnimatedPressable
      {...props}
      ref={ref}
      onPressIn={(event) => {
        animateTo(1);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animateTo(0);
        onPressOut?.(event);
      }}
      style={[
        style,
        {
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) },
          ],
        },
      ]}
    />
  );
});

/**
 * The web's `animate-rise stagger`: content fades and rises 10px into place when it first mounts,
 * siblings in a 28ms wave capped at the eighth. Pull to refresh re-renders without remounting, so
 * it does not replay.
 */
export function Rise({
  children,
  index = 0,
  distance = 10,
  style,
}: {
  children: ReactNode;
  index?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(reduce ? 1 : 0));

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: duration.rise,
      delay: Math.min(index, 8) * 28,
      easing: ease.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, index, reduce]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Scales in from nothing with a bounce — for a badge, a tick, a dot that just appeared. */
export function Pop({
  children,
  style,
  delay = 0,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
  const reduce = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return;
    const animation = Animated.spring(scale, {
      toValue: 1,
      delay,
      useNativeDriver: true,
      ...spring.pop,
    });
    animation.start();
    return () => animation.stop();
  }, [scale, reduce, delay]);
  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

/**
 * The web's `status-ping`: a solid dot with a ring that swells to 2.4× and fades over two seconds.
 * For things that are live — overdue, syncing, now — never for decoration.
 */
export function Pulse({ color, size = 8 }: { color: string; size?: number }) {
  const reduce = useReduceMotion();
  const [wave] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.timing(wave, {
        toValue: 1,
        duration: 2000,
        easing: ease.out,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [wave, reduce]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      {reduce ? null : (
        <Animated.View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size,
            backgroundColor: color,
            opacity: wave.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.65, 0, 0] }),
            transform: [
              { scale: wave.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 2.4, 2.4] }) },
            ],
          }}
        />
      )}
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

/**
 * A number that counts up to its value, re-counting from where it was when the value changes.
 *
 * ponytail: JS-driven text (a re-render per frame for under a second), fine for the handful of
 * headline counts that use it; never put one in a list row.
 */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  style,
  ...text
}: {
  value: number;
  format?: (value: number) => string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
}) {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = from.current;
    const began = Date.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - began) / 900);
      const eased = 1 - Math.pow(1 - t, 5); // out-quint
      const next = start + (value - start) * eased;
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduce]);

  return (
    <Text {...text} style={style} accessibilityLabel={format(value)}>
      {format(shown)}
    </Text>
  );
}

/**
 * The web's odometer: a drum per digit, leading zeros and all, rolling to the reading — on first
 * sight from zero in a 70ms wave from the left, and on a new reading straight to it. Leading zeros
 * and the thousands commas are quieter than the digits that count. `null` is a reading nobody has
 * taken: dashes, not zeros, because zero is a reading.
 *
 * Each drum is a window onto a column of 0–9 that slides on the native driver; the shading top and
 * bottom (the web's inset `--drum-edge`) is one gradient over the whole row.
 */
export function Odometer({
  value,
  digits = 6,
  size = 26,
  drums = true,
  style,
}: {
  value: number | null;
  digits?: number;
  /** The digits' font size; the drums are sized from it. */
  size?: number;
  /** The web's `odo-drums`: each digit in its own drum. Off for a bare rolling figure. */
  drums?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const line = Math.round(size * 1.3);
  if (value === null) {
    return (
      <Text style={[figure, { fontSize: size, lineHeight: line, color: theme.mutedForeground }]}>
        ———
      </Text>
    );
  }
  const text = String(Math.max(0, Math.round(value))).padStart(digits, '0');
  const firstSignificant = [...text].findIndex((digit) => digit !== '0');

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={Math.round(value).toLocaleString()}
      style={[styles.odometer, style]}
    >
      {[...text].map((digit, index) => (
        <Fragment key={index}>
          {/* Thousands separators counted from the right, so seven digits still group correctly. */}
          {index > 0 && (text.length - index) % 3 === 0 ? (
            <Text
              style={[
                figure,
                {
                  fontSize: size * 0.8,
                  lineHeight: line,
                  color: theme.mutedForeground,
                  marginHorizontal: drums ? -1 : 0,
                },
              ]}
            >
              ,
            </Text>
          ) : null}
          <Drum
            digit={Number(digit)}
            index={index}
            size={size}
            line={line}
            drum={drums}
            quiet={firstSignificant === -1 || index < firstSignificant}
          />
        </Fragment>
      ))}
      {drums ? (
        // The drums' rounding: light falls off toward the top and bottom of each window.
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Defs>
            <LinearGradient id="drum" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={theme.background} stopOpacity={0.85} />
              <Stop offset="0.3" stopColor={theme.background} stopOpacity={0} />
              <Stop offset="0.7" stopColor={theme.background} stopOpacity={0} />
              <Stop offset="1" stopColor={theme.background} stopOpacity={0.85} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#drum)" />
        </Svg>
      ) : null}
    </View>
  );
}

function Drum({
  digit,
  index,
  size,
  line,
  drum,
  quiet,
}: {
  digit: number;
  index: number;
  size: number;
  line: number;
  drum: boolean;
  quiet: boolean;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [roll] = useState(() => new Animated.Value(reduce ? digit : 0));
  const first = useRef(true);

  useEffect(() => {
    if (reduce) {
      roll.setValue(digit);
      return;
    }
    const opening = first.current;
    first.current = false;
    const animation = Animated.timing(roll, {
      toValue: digit,
      duration: opening ? duration.roll : 900,
      delay: opening ? 200 + index * 70 : index * 42,
      easing: ease.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [digit, index, reduce, roll]);

  return (
    <View
      style={[
        { height: line, overflow: 'hidden' },
        drum
          ? {
              paddingHorizontal: Math.round(size * 0.12),
              marginHorizontal: Math.max(1, Math.round(size * 0.04)),
              borderRadius: Math.round(size * 0.22),
              backgroundColor: theme.cardRaised,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
            }
          : null,
      ]}
    >
      <Animated.View
        style={{
          transform: [
            {
              translateY: roll.interpolate({ inputRange: [0, 9], outputRange: [0, -9 * line] }),
            },
          ],
        }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <Text
            key={n}
            style={[
              figure,
              {
                fontSize: size,
                lineHeight: line,
                height: line,
                fontWeight: '600',
                // Android pads a line for accents; in a drum that offsets every digit.
                includeFontPadding: false,
                textAlignVertical: 'center',
                color: quiet ? theme.mutedForeground : theme.foreground,
              },
            ]}
          >
            {n}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

/**
 * A bar that fills to `progress` (0–1) from the left on mount — the web's `dial-fill`, 700ms — and
 * glides when it changes. Native-driven: the fill is full width, scaled from its left edge.
 */
export function Meter({
  progress,
  color,
  track,
  height = 6,
  style,
}: {
  progress: number;
  color: string;
  track: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const target = Math.max(0, Math.min(1, progress));
  const [fill] = useState(() => new Animated.Value(reduce ? target : 0));
  useEffect(() => {
    if (reduce) {
      fill.setValue(target);
      return;
    }
    const animation = Animated.timing(fill, {
      toValue: target,
      duration: duration.dial,
      delay: 120,
      easing: ease.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fill, target, reduce]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }, style]}
    >
      <Animated.View
        style={{
          height: '100%',
          width: '100%',
          borderRadius: height,
          backgroundColor: color,
          transformOrigin: 'left',
          transform: [{ scaleX: fill }],
        }}
      />
    </View>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * A ring gauge that sweeps round to `progress` (0–1), on the web dial's curve. The centre is the
 * caller's: a figure, a glyph.
 */
export function Ring({
  progress,
  size = 96,
  stroke = 8,
  color,
  track,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color: string;
  track: string;
  children?: ReactNode;
}) {
  const reduce = useReduceMotion();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const target = Math.max(0, Math.min(1, progress));
  const [sweep] = useState(() => new Animated.Value(reduce ? target : 0));
  useEffect(() => {
    if (reduce) {
      sweep.setValue(target);
      return;
    }
    // ponytail: JS-driven — SVG props cannot ride the native driver. One ring per screen.
    const animation = Animated.timing(sweep, {
      toValue: target,
      duration: 1050,
      delay: 100,
      easing: ease.out,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [sweep, target, reduce]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}
      >
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={sweep.interpolate({
            inputRange: [0, 1],
            outputRange: [circumference, 0],
          })}
        />
      </Svg>
      {children}
    </View>
  );
}

/*
 * The web's 270° gauge (`components/ui/instruments.tsx`), point for point: zero at the bottom
 * left, full at the bottom right, the open quarter at the bottom for the readout. Drawn on the
 * web's 200-unit box so the two read the same at any size.
 */
const GAUGE_START = 135;
const GAUGE_SWEEP = 270;
const GAUGE_R = 84;
const GAUGE_LENGTH = (GAUGE_R * GAUGE_SWEEP * Math.PI) / 180;
const polar = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)] as const;
};
const gaugeArc = (from: number, to: number) => {
  const [x0, y0] = polar(GAUGE_R, from);
  const [x1, y1] = polar(GAUGE_R, to);
  return `M ${x0} ${y0} A ${GAUGE_R} ${GAUGE_R} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};
const GAUGE_TRACK = gaugeArc(GAUGE_START, GAUGE_START + GAUGE_SWEEP);
const GAUGE_TICKS = Array.from({ length: 41 }, (_, i) => GAUGE_START + (GAUGE_SWEEP * i) / 40);

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * A needle gauge — the web's `Gauge`. `progress` is 0–1 of the dial and pins at the stops; the
 * needle turns on whatever drives it, the native driver included. `color` draws the reading's arc
 * behind the needle, which is an SVG prop and so needs a JS-driven `progress` (`useIgnition`).
 * `redlineFrom` paints the last stretch of the track; `marks` sets figures round the dial, evenly
 * from zero to full, with the major ticks under them. `bare` drops the ticks and draws the rest
 * heavier, for a dial small enough to sit beside its figure.
 *
 * The drawing is decoration: `label` is what a screen reader hears, and `children` — the readout
 * in the open quarter — is real text for everyone else.
 */
export function Gauge({
  progress,
  size = 128,
  color,
  redlineFrom,
  marks,
  bare = false,
  label,
  children,
}: {
  progress: Animated.Value | Animated.AnimatedInterpolation<number>;
  size?: number;
  color?: string;
  redlineFrom?: number;
  marks?: readonly string[];
  bare?: boolean;
  label: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const every = marks && marks.length > 1 ? 40 / (marks.length - 1) : 10;
  // On the 200-unit box: a bare dial is drawn at a fifth of the size, so its lines are heavier.
  const weight = bare ? 24 : 5;
  const turn = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [`${GAUGE_START}deg`, `${GAUGE_START + GAUGE_SWEEP}deg`],
    extrapolate: 'clamp',
  });
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 200 200" style={StyleSheet.absoluteFill}>
        {(bare ? [] : GAUGE_TICKS).map((deg, i) => {
          const major = i % every === 0;
          const [x1, y1] = polar(major ? 64 : 69, deg);
          const [x2, y2] = polar(74, deg);
          return (
            <Line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={major ? theme.mutedForeground : theme.borderStrong}
              strokeWidth={major ? 1.75 : 1}
              strokeLinecap="round"
            />
          );
        })}
        {marks?.map((mark, i) => {
          const [x, y] = polar(50, GAUGE_START + (GAUGE_SWEEP * i) / (marks.length - 1));
          const red = redlineFrom !== undefined && i / (marks.length - 1) >= redlineFrom;
          return (
            <SvgText
              key={mark}
              x={x}
              y={y + 5}
              fontSize={14}
              fontFamily="CascadiaMono_600SemiBold"
              textAnchor="middle"
              fill={red ? theme.destructive : theme.mutedForeground}
            >
              {mark}
            </SvgText>
          );
        })}
        <Path
          d={GAUGE_TRACK}
          fill="none"
          stroke={theme.muted}
          strokeWidth={weight}
          strokeLinecap="round"
        />
        {redlineFrom !== undefined ? (
          <Path
            d={gaugeArc(GAUGE_START + GAUGE_SWEEP * redlineFrom, GAUGE_START + GAUGE_SWEEP)}
            fill="none"
            stroke={theme.destructive}
            strokeOpacity={0.55}
            strokeWidth={weight}
            strokeLinecap="round"
          />
        ) : null}
        {color ? (
          <AnimatedPath
            d={GAUGE_TRACK}
            fill="none"
            stroke={color}
            strokeWidth={weight}
            strokeLinecap="round"
            strokeDasharray={`${GAUGE_LENGTH} ${GAUGE_LENGTH}`}
            strokeDashoffset={progress.interpolate({
              inputRange: [0, 1],
              outputRange: [GAUGE_LENGTH, 0],
              extrapolate: 'clamp',
            })}
          />
        ) : null}
      </Svg>
      {/* The needle turns as a view, so a native-driven reading turns it on the UI thread. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { transform: [{ rotate: turn }] }]}
      >
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Line
            x1={100}
            y1={100}
            x2={158}
            y2={100}
            stroke={theme.foreground}
            strokeWidth={bare ? 14 : 2.5}
            strokeLinecap="round"
          />
          <Circle
            cx={100}
            cy={100}
            r={bare ? 20 : 7}
            fill={bare ? theme.foreground : theme.background}
            stroke={theme.foreground}
            strokeWidth={bare ? 0 : 2}
          />
        </Svg>
      </Animated.View>
      {children ? (
        <View pointerEvents="none" style={[styles.gaugeReadout, { bottom: size * 0.03 }]}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

/** The web's `gauge-ignite` curve: a cluster's needle has weight, slow off the stop and slow on. */
const IGNITE = Easing.bezier(0.45, 0, 0.2, 1);

/**
 * A gauge's progress for its first reading, the way a cluster checks itself — the web's
 * `gauge-ignite`: from 280ms, the needle sweeps to the stop and back to the reading over 1700ms,
 * and the thumb feels it touch the stop. A later reading glides there. JS-driven, because the arc
 * that follows the needle is an SVG prop; one gauge a screen.
 */
export function useIgnition(fraction: number) {
  const reduce = useReduceMotion();
  const target = Math.max(0, Math.min(1, fraction));
  const [progress] = useState(() => new Animated.Value(reduce ? target : 0));
  const lit = useRef(reduce);

  useEffect(() => {
    if (reduce) {
      progress.setValue(target);
      return;
    }
    if (lit.current) {
      const glide = Animated.timing(progress, {
        toValue: target,
        duration: duration.dial,
        easing: ease.out,
        useNativeDriver: false,
      });
      glide.start();
      return () => glide.stop();
    }
    lit.current = true;
    let settle: Animated.CompositeAnimation | null = null;
    const sweep = Animated.timing(progress, {
      toValue: 1,
      duration: 765,
      delay: 280,
      easing: IGNITE,
      useNativeDriver: false,
    });
    sweep.start(({ finished }) => {
      if (!finished) return;
      haptic.light();
      settle = Animated.timing(progress, {
        toValue: target,
        duration: 935,
        easing: IGNITE,
        useNativeDriver: false,
      });
      settle.start();
    });
    return () => {
      sweep.stop();
      settle?.stop();
    };
  }, [progress, target, reduce]);

  return progress;
}

/**
 * A scroll position for the collapsing large-title header: hand `onScroll` to an
 * `Animated.ScrollView` / `FlatList` / `SectionList`, and `y` to `CompactHeader`.
 *
 * `listener` hears each offset on the JS thread — for a haptic, never for drawing, which rides `y`.
 * Whether there is one is settled on the first render.
 */
export function useScrollY(listener?: (y: number) => void) {
  const [y] = useState(() => new Animated.Value(0));
  const heard = useRef(listener);
  useEffect(() => {
    heard.current = listener;
  });
  const [onScroll] = useState(() =>
    Animated.event([{ nativeEvent: { contentOffset: { y } } }], {
      useNativeDriver: true,
      listener: listener
        ? (event: NativeSyntheticEvent<NativeScrollEvent>) =>
            heard.current?.(event.nativeEvent.contentOffset.y)
        : undefined,
    }),
  );
  return { y, onScroll };
}

/**
 * Haptics for confirmations and choices, not for every tap — a phone that buzzes on
 * everything teaches its owner to ignore it.
 * ponytail: fire and forget; a device without a haptic engine simply does nothing.
 */
export const haptic = {
  /** A choice changed: a chip, a tab. */
  selection: () => void Haptics.selectionAsync().catch(() => undefined),
  /** A physical-feeling press: the key going down, a sheet opening. */
  light: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  /** Something was saved. */
  success: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  /** Something needs a second look. */
  warning: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
};

const styles = StyleSheet.create({
  odometer: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  gaugeReadout: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
