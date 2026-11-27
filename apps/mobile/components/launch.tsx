import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Animated, Appearance, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import letterA from '@/assets/launch/letter-a.png';
import letterALight from '@/assets/launch/letter-a-light.png';
import letterG from '@/assets/launch/letter-G.png';
import letterGLight from '@/assets/launch/letter-G-light.png';
import letterJ from '@/assets/launch/letter-j.png';
import letterJLight from '@/assets/launch/letter-j-light.png';
import letterR from '@/assets/launch/letter-r.png';
import letterRLight from '@/assets/launch/letter-r-light.png';
import streaks from '@/assets/launch/streaks.png';
import tyre from '@/assets/launch/tyre.png';
import tyreDark from '@/assets/launch/tyre-dark.png';
import { ease, haptic, useReduceMotion } from '@/lib/motion';

/*
 * The launch: the native splash, brought to life. It opens on exactly the native splash's frame —
 * its ground, the tyre mark at the same size in the same place — so the hand-over cannot be seen.
 * Then the engine catches: the streaks are drawn in as the tyre winds back, and blast out as it
 * kicks forward; the mark settles into its place in the wordmark while the letters rise in from
 * G to j; and when the app behind is ready, the tyre drives off the way its streaks say it is
 * going — left — and the ground fades to the garage.
 *
 * Robust by construction: everything moves on the native driver, so a busy JS thread loading the
 * app behind cannot stutter it; the native splash is only let go once the first frame here is
 * drawn (or after a short wait, whatever happens); a slow start idles rather than freezes; it never
 * stays up past MAX_MS; and with Reduce Motion it is the still mark, then a fade.
 *
 * Layers come from `assets/launch/` — the splash icon and the wordmark, split (tyre, streaks, each
 * letter) on their own canvases so they line up with the native splash and with each other.
 */

/** The native splash's ground and mark, as app.json's `expo-splash-screen` plugin draws them. */
const GROUND = { light: '#FFFFFF', dark: '#090705' } as const;
/** `imageWidth`: the 1024 splash icon drawn this many points wide, in the middle of the screen. */
const MARK = 200;
const CANVAS = 1024;
/** In the splash icon's canvas: where the tyre sits, and where its streaks leave it. */
const TYRE = { x: (220 + 534) / 2, y: (352 + 677) / 2 };
const STREAKS_FROM = 471;
/** The tyre and streaks together, in the splash icon's canvas and in the wordmark's. */
const GROUP = { x0: 220, x1: 804, y0: 352, y1: 677 };
const LOCKUP = { width: 1587, x0: 997, x1: 1585, y0: 49, y1: 375, top: 49, bottom: 410 };
/** The letters' crops in the wordmark's canvas: their left edges and widths, one shared band. */
const BAND = { top: 40, height: 376 };
const LETTERS = [
  { key: 'G', left: 11, width: 235 },
  { key: 'a1', left: 268, width: 190 },
  { key: 'r', left: 502, width: 95 },
  { key: 'a2', left: 614, width: 190 },
  { key: 'j', left: 814, width: 77 },
  // Garajj: the same j again, 87 along — the wordmark's own spacing.
  { key: 'j2', left: 901, width: 77 },
] as const;
const ART = {
  light: { tyre, G: letterG, a1: letterA, r: letterR, a2: letterA, j: letterJ, j2: letterJ },
  dark: {
    tyre: tyreDark,
    G: letterGLight,
    a1: letterALight,
    r: letterRLight,
    a2: letterALight,
    j: letterJLight,
    j2: letterJLight,
  },
};
/** The logo's own red, for the glow the rev throws behind the tyre. */
const RED = '#ED1C24';

/** However long the app behind takes, the launch is never what is left on screen. */
const MAX_MS = 6_000;
/** If the first frame here never reports in, the native splash is let go anyway. */
const HANDOVER_MS = 700;

/*
 * The phone's own scheme as the app opened. The native splash was drawn in it before any JS ran,
 * so the first frame here must be too — read now, at import, before Settings' choice (applied
 * asynchronously by `lib/appearance`) turns `Appearance` to the app's scheme.
 */
const SYSTEM_DARK = Appearance.getColorScheme() === 'dark';

export function Launch({
  ready,
  onDone,
}: {
  /** The app behind can be shown: fonts, session, cache and scheme are in. */
  ready: boolean;
  /** The launch has left the screen; unmount it. */
  onDone: () => void;
}) {
  const reduce = useReduceMotion();
  // Its own measured box, not the window's: the native splash centres on the whole screen, which
  // is what this covers, while the window's height can leave out a navigation bar.
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const width = box?.width ?? 0;
  const height = box?.height ?? 0;
  const scheme = SYSTEM_DARK ? 'dark' : 'light';
  const art = ART[scheme];

  const [values] = useState(() => ({
    streak: new Animated.Value(1),
    tilt: new Animated.Value(0),
    nudge: new Animated.Value(0),
    glow: new Animated.Value(0),
    lock: new Animated.Value(0),
    drive: new Animated.Value(0),
    ground: new Animated.Value(1),
    letters: LETTERS.map(() => new Animated.Value(0)),
  }));
  const [loaded, setLoaded] = useState(0);
  const [introDone, setIntroDone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const started = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const idle = useRef<Animated.CompositeAnimation | null>(null);
  const later = (ms: number, run: () => void) => timers.current.push(setTimeout(run, ms));

  // Where the mark goes in the wordmark, the wordmark drawn as wide as the screen allows.
  const lockupWidth = Math.min(250, width * 0.62);
  const k = lockupWidth / LOCKUP.width;
  const s0 = MARK / CANVAS;
  const scale = ((LOCKUP.x1 - LOCKUP.x0) * k) / ((GROUP.x1 - GROUP.x0) * s0);
  const lockupTop = height / 2 - ((LOCKUP.top + LOCKUP.bottom) / 2) * k;
  const groupDrop = ((GROUP.y0 + GROUP.y1) / 2 - CANVAS / 2) * s0 * scale;
  const dx = ((LOCKUP.x0 + LOCKUP.x1) / 2 - LOCKUP.width / 2) * k;
  const dy = lockupTop + ((LOCKUP.y0 + LOCKUP.y1) / 2) * k - height / 2 - groupDrop;

  const timing = (value: Animated.Value, toValue: number, duration: number, easing = ease.out) =>
    Animated.timing(value, { toValue, duration, easing, useNativeDriver: true });
  const spring = (value: Animated.Value, toValue: number, speed = 14, bounciness = 8) =>
    Animated.spring(value, { toValue, speed, bounciness, useNativeDriver: true });

  const intro = () => {
    if (reduce) return setIntroDone(true);
    // Felt as heard: the catch as the streaks are drawn in, the rev as they blast out.
    later(120, haptic.light);
    later(300, haptic.light);
    Animated.sequence([
      // A beat on the still mark, so the eye has it before it moves.
      Animated.delay(120),
      // Wind back: the streaks pulled in, the tyre rocked back on its heels.
      Animated.parallel([
        timing(values.streak, 0.22, 180, ease.inOut),
        timing(values.tilt, -10, 180, ease.inOut),
        timing(values.nudge, 6, 180, ease.inOut),
      ]),
      // The rev: streaks out past their length, the tyre kicking forward, a glow behind it.
      Animated.parallel([
        timing(values.streak, 1.4, 200),
        timing(values.tilt, 7, 200),
        timing(values.nudge, -7, 200),
        timing(values.glow, 1, 200),
      ]),
      // Into the wordmark: the mark settles into its place, the letters rise in from G to j.
      Animated.parallel([
        spring(values.streak, 1),
        spring(values.tilt, 0),
        spring(values.nudge, 0),
        timing(values.glow, 0, 700, ease.standard),
        spring(values.lock, 1, 9, 5),
        Animated.sequence([
          Animated.delay(90),
          Animated.stagger(
            60,
            values.letters.map((letter) => timing(letter, 1, 460)),
          ),
        ]),
      ]),
    ]).start(() => setIntroDone(true));
  };

  // The hand-over: once this frame is drawn over the native splash, the native one goes, and the
  // engine starts. Whatever happens, it goes within HANDOVER_MS.
  const handOver = () => {
    if (started.current) return;
    started.current = true;
    void SplashScreen.hideAsync()
      .catch(() => undefined)
      .finally(() => requestAnimationFrame(intro));
  };
  useEffect(() => {
    if (box && loaded >= 2) handOver();
    // `handOver` runs once, guarded by `started`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, loaded]);
  useEffect(() => {
    const timer = setTimeout(handOver, HANDOVER_MS);
    const cap = setTimeout(() => setLeaving(true), MAX_MS);
    const pending = timers.current;
    return () => {
      clearTimeout(timer);
      clearTimeout(cap);
      pending.forEach(clearTimeout);
      idle.current?.stop();
    };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Waiting on the app: the streaks breathe, so a slow start reads as working, not frozen.
  useEffect(() => {
    if (!introDone || ready || reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        timing(values.streak, 1.14, 650, ease.inOut),
        timing(values.streak, 1, 650, ease.inOut),
      ]),
    );
    idle.current = loop;
    loop.start();
    return () => loop.stop();
  }, [introDone, ready, reduce, values.streak]);

  useEffect(() => {
    if (introDone && ready) setLeaving(true);
  }, [introDone, ready]);

  // Drive off: the letters drop away, the tyre backs up a touch and launches left, its streaks
  // stretching behind it, and the ground fades to the garage.
  useEffect(() => {
    if (!leaving) return;
    idle.current?.stop();
    if (reduce) {
      timing(values.ground, 0, 240, ease.standard).start(onDone);
      return;
    }
    later(140, haptic.medium);
    Animated.parallel([
      Animated.stagger(
        30,
        [...values.letters].reverse().map((letter) => timing(letter, 0, 220, ease.in)),
      ),
      Animated.sequence([
        Animated.parallel([
          timing(values.drive, 12, 140),
          timing(values.streak, 0.55, 140),
          timing(values.tilt, -6, 140),
        ]),
        Animated.parallel([
          timing(values.drive, -width, 400, ease.in),
          timing(values.streak, 3.2, 280),
          timing(values.tilt, 0, 200),
        ]),
      ]),
      Animated.sequence([Animated.delay(320), timing(values.ground, 0, 320, ease.standard)]),
    ]).start(onDone);
    // Once, when it starts to leave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const markX = Animated.add(
    values.lock.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }),
    values.drive,
  );

  return (
    <Animated.View
      // Touches wait while it covers the app, and pass through as it fades.
      pointerEvents={leaving ? 'none' : 'auto'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={({ nativeEvent }) =>
        setBox({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
      }
      style={[
        StyleSheet.absoluteFill,
        styles.launch,
        { backgroundColor: GROUND[scheme], opacity: values.ground },
      ]}
    >
      <StatusBar style={SYSTEM_DARK ? 'light' : 'dark'} />

      {/* Nothing is placed until the box is measured; the native splash is still over it. */}
      {box ? (
        <>
          {/* The letters, each at its place in the wordmark, rising in under the mark. */}
          {LETTERS.map((letter, index) => {
            const shown = values.letters[index]!;
            return (
              <Animated.Image
                key={letter.key}
                source={art[letter.key]}
                fadeDuration={0}
                resizeMode="stretch"
                style={[
                  styles.layer,
                  {
                    left: width / 2 - lockupWidth / 2 + letter.left * k,
                    top: lockupTop + BAND.top * k,
                    width: letter.width * k,
                    height: BAND.height * k,
                    opacity: shown,
                    transform: [
                      {
                        translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }),
                      },
                      { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
                    ],
                  },
                ]}
              />
            );
          })}

          {/* The mark: the native splash's own, in its place, then on its way. */}
          <Animated.View
            style={[
              styles.layer,
              {
                left: width / 2 - MARK / 2,
                top: height / 2 - MARK / 2,
                width: MARK,
                height: MARK,
                transform: [
                  { translateX: markX },
                  {
                    translateY: values.lock.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, dy],
                    }),
                  },
                  {
                    scale: values.lock.interpolate({ inputRange: [0, 1], outputRange: [1, scale] }),
                  },
                ],
              },
            ]}
          >
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                {
                  opacity: values.glow,
                  transform: [
                    {
                      scale: values.glow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.6, 1.15],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Svg width={MARK} height={MARK}>
                <Defs>
                  <RadialGradient id="launch-glow" cx="50%" cy="50%" r="50%">
                    <Stop offset="0" stopColor={RED} stopOpacity={SYSTEM_DARK ? 0.42 : 0.24} />
                    <Stop offset="1" stopColor={RED} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle
                  cx={(TYRE.x / CANVAS) * MARK}
                  cy={(TYRE.y / CANVAS) * MARK}
                  r={MARK * 0.36}
                  fill="url(#launch-glow)"
                />
              </Svg>
            </Animated.View>
            <Animated.Image
              source={streaks}
              fadeDuration={0}
              onLoad={() => setLoaded((count) => count + 1)}
              style={[
                StyleSheet.absoluteFill,
                styles.full,
                {
                  // Stretched out of the tyre's edge, where the streaks leave it.
                  transformOrigin: `${(STREAKS_FROM / CANVAS) * 100}% 50%`,
                  transform: [{ scaleX: values.streak }],
                },
              ]}
            />
            <Animated.Image
              source={art.tyre}
              fadeDuration={0}
              onLoad={() => setLoaded((count) => count + 1)}
              style={[
                StyleSheet.absoluteFill,
                styles.full,
                {
                  transformOrigin: `${(TYRE.x / CANVAS) * 100}% ${(TYRE.y / CANVAS) * 100}%`,
                  transform: [
                    { translateX: values.nudge },
                    {
                      rotate: values.tilt.interpolate({
                        inputRange: [-90, 90],
                        outputRange: ['-90deg', '90deg'],
                      }),
                    },
                  ],
                },
              ]}
            />
          </Animated.View>
        </>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  launch: { zIndex: 1000, elevation: 1000 },
  layer: { position: 'absolute' },
  full: { width: '100%', height: '100%' },
});
