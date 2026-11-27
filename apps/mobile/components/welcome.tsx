import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseDone, type TokenKind } from '@vehicle-os/ui';
import logoTextLight from '@/assets/logo-text-light.png';
import logoText from '@/assets/logo-text.png';
import { BayStage } from '@/components/bay-stage';
import { Footer, Kicker, TextKey, TwoTone } from '@/components/onboarding-kit';
import { useScheme } from '@/lib/appearance';
import { Glyph } from '@/lib/instrument';
import { ease, Gauge, PressableScale, useReduceMotion } from '@/lib/motion';
import { figure, leaf, rimmed, spacing, useTheme, type Theme } from '@/lib/theme';
import { Button } from '@/lib/ui';

/*
 * The welcome: three things Garajj does, each shown working rather than described — a bay whose
 * light flickers on as a vehicle rolls in; a line typed the way a person says it, picked apart by
 * the app's own quick-entry parser as it is typed; and a gauge running up to a service that falls
 * due, its reminder dropping in. One idea a screen, each with its own small moment.
 *
 * Seen once per install (`lib/onboarding`). The way in is on every scene — nobody is made to watch
 * all three — and the scenes turn by themselves only until the person touches them.
 */

type Mode = 'sign-in' | 'sign-up';

const SCENES = [
  {
    key: 'bay',
    kicker: '01 · Your garage',
    lead: 'Every vehicle,',
    rest: 'in its own bay.',
    line: 'Cars, bikes, boats — each with its own record, photos and papers.',
  },
  {
    key: 'line',
    kicker: '02 · Logging',
    lead: 'Log it like',
    rest: "you'd say it.",
    line: 'Type one line. Garajj picks out the litres, the price and the odometer.',
  },
  {
    key: 'ahead',
    kicker: '03 · Ahead of it',
    lead: "Know what's next,",
    rest: 'before it is due.',
    line: 'Services, papers and recalls — a nudge in time, never a surprise.',
  },
] as const;

/** How long a scene stays before the next, while nobody has touched them. */
const DWELL_MS = 5200;

export function Welcome({ onFinish }: { onFinish: (mode: Mode) => void }) {
  const theme = useTheme();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduce = useReduceMotion();
  const pager = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(0);
  // Turning by itself stops for good the moment the person takes over, or a screen reader is on.
  const [auto, setAuto] = useState(!reduce);
  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => on && setAuto(false));
  }, []);

  const stage = {
    width: width - spacing.lg * 2,
    height: Math.round(Math.min(320, Math.max(200, height * 0.36))),
  };

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(SCENES.length - 1, next));
    pager.current?.scrollTo({ x: clamped * width, animated: !reduce });
    setIndex(clamped);
  };

  useEffect(() => {
    if (!auto) return;
    const timer = setTimeout(() => go(index === SCENES.length - 1 ? 0 : index + 1), DWELL_MS);
    return () => clearTimeout(timer);
    // `go` reads the latest width; the timer restarts on each scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, index]);

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    setIndex(next);
  };

  const finish = (mode: Mode) => {
    onFinish(mode);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.top}>
        <Image
          source={scheme === 'light' ? logoText : logoTextLight}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel="Garajj"
        />
        <TextKey label="Sign in" onPress={() => finish('sign-in')} />
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => setAuto(false)}
        onMomentumScrollEnd={settle}
        style={styles.pager}
        accessibilityRole="adjustable"
        accessibilityLabel={`${SCENES[index]!.lead} ${SCENES[index]!.rest}`}
        accessibilityValue={{ text: `${index + 1} of ${SCENES.length}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          setAuto(false);
          go(index + (event.nativeEvent.actionName === 'increment' ? 1 : -1));
        }}
      >
        {SCENES.map((scene, place) => (
          <View key={scene.key} style={[styles.scene, { width }]}>
            <PressableScale
              onPress={() => {
                setAuto(false);
                go(place === SCENES.length - 1 ? 0 : place + 1);
              }}
              accessible={false}
              scaleTo={0.985}
              style={[styles.stage, { height: stage.height }, stageSurface(theme)]}
            >
              {scene.key === 'bay' ? (
                <BayScene active={index === place} width={stage.width} height={stage.height} />
              ) : scene.key === 'line' ? (
                <LineScene active={index === place} />
              ) : (
                <AheadScene active={index === place} height={stage.height} />
              )}
            </PressableScale>
            <View style={styles.words}>
              <Kicker tone="copper">{scene.kicker}</Kicker>
              <TwoTone lead={scene.lead} rest={scene.rest} />
              <Text style={[styles.lede, { color: theme.mutedForeground }]}>{scene.line}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <Footer>
        <Dots index={index} count={SCENES.length} />
        <Button label="Get started" variant="primary" pill onPress={() => finish('sign-up')} />
        <Button
          label="I already have an account"
          variant="ghost"
          onPress={() => finish('sign-in')}
        />
      </Footer>
    </View>
  );
}

/** The stage a scene plays on: the app's lead card, raised. */
const stageSurface = (theme: Theme) => [{ backgroundColor: theme.cardRaised }, rimmed(theme)];

/** Which scene: a copper pill for this one, dots for the others. */
function Dots({ index, count }: { index: number; count: number }) {
  const theme = useTheme();
  return (
    <View
      style={styles.dots}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: count }, (_, place) => (
        <Dot key={place} on={place === index} color={theme.primary} off={theme.borderStrong} />
      ))}
    </View>
  );
}

function Dot({ on, color, off }: { on: boolean; color: string; off: string }) {
  const reduce = useReduceMotion();
  const [grow] = useState(() => new Animated.Value(on ? 1 : 0));
  useEffect(() => {
    const target = on ? 1 : 0;
    if (reduce) return grow.setValue(target);
    // Width, so on the JS driver: three small views, a few frames.
    Animated.timing(grow, {
      toValue: target,
      duration: 320,
      easing: ease.out,
      useNativeDriver: false,
    }).start();
  }, [on, grow, reduce]);
  return (
    <Animated.View
      style={[
        styles.dot,
        {
          width: grow.interpolate({ inputRange: [0, 1], outputRange: [6, 22] }),
          backgroundColor: grow.interpolate({ inputRange: [0, 1], outputRange: [off, color] }),
        },
      ]}
    />
  );
}

/**
 * Scene one: a bay in the dark. Its strip light stutters on the way a workshop tube does, and a
 * vehicle rolls in under it and settles; its card slides up under the floor.
 */
function BayScene({ active, width, height }: { active: boolean; width: number; height: number }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [lit] = useState(() => new Animated.Value(reduce ? 1 : 0.08));
  const [roll] = useState(() => new Animated.Value(reduce ? 0 : 1));
  const [card] = useState(() => new Animated.Value(reduce ? 1 : 0));

  useEffect(() => {
    if (!active || reduce) return;
    lit.setValue(0.08);
    roll.setValue(1);
    card.setValue(0);
    const flick = (toValue: number, duration: number) =>
      Animated.timing(lit, { toValue, duration, useNativeDriver: false });
    const run = Animated.sequence([
      Animated.delay(200),
      // The tube: a stutter, a catch, then on.
      flick(0.6, 60),
      flick(0.15, 80),
      flick(0.85, 70),
      flick(0.35, 120),
      flick(1, 180),
      Animated.parallel([
        Animated.spring(roll, { toValue: 0, speed: 6, bounciness: 7, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(520),
          Animated.timing(card, {
            toValue: 1,
            duration: 420,
            easing: ease.out,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]);
    run.start();
    return () => {
      run.stop();
    };
  }, [active, reduce, lit, roll, card]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.clip]}>
      <BayStage
        id="welcome-bay"
        photo={null}
        make={null}
        vehicleType="CAR"
        width={width}
        height={height}
        number={1}
        lit={lit}
        drive={roll.interpolate({ inputRange: [0, 1], outputRange: [0, width * 0.75] })}
      />
      <Animated.View
        style={[
          styles.bayCard,
          { backgroundColor: `${theme.cardRaised}F2` },
          rimmed(theme),
          {
            opacity: card,
            transform: [
              { translateY: card.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            ],
          },
        ]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.bayName, { color: theme.foreground }]}>
            Daily driver
          </Text>
          <Text numberOfLines={1} style={[styles.bayLine, { color: theme.mutedForeground }]}>
            Bay 01 · ready
          </Text>
        </View>
        <View style={styles.bayFigures}>
          <Text style={[figure, styles.bayFigure, { color: theme.foreground }]}>128,400</Text>
          <Text style={[figure, styles.bayUnit, { color: theme.mutedForeground }]}>KM</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const LINE = 'Filled 40 L at Shell, $62.40, 52,300 km';
/** Per character, a quick typist's pace. */
const KEY_MS = 46;

/** The facts the parser finds, in the order a reader takes them in. */
const FACT_ORDER: readonly TokenKind[] = ['kind', 'quantity', 'money', 'odometer', 'place'];

/**
 * Scene two: the quick line, typed. The app's own parser reads it as it is typed — each fact lights
 * in its colour in the line and drops in below as a chip the moment it is whole.
 */
function LineScene({ active }: { active: boolean }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [typed, setTyped] = useState(reduce ? LINE.length : 0);

  useEffect(() => {
    if (!active || reduce) return;
    setTyped(0);
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setTyped(count);
      if (count >= LINE.length) clearInterval(timer);
    }, KEY_MS);
    return () => clearInterval(timer);
  }, [active, reduce]);

  const text = LINE.slice(0, typed);
  const parsed = useMemo(() => parseDone(text), [text]);
  // Only a token the typing has finished: a half-typed "52,3" is not yet a reading.
  const whole = parsed.tokens.filter((token) => token.end < text.length || typed === LINE.length);
  const hue: Record<TokenKind, string> = {
    kind: theme.foreground,
    quantity: theme.chartRefuel,
    money: theme.primary,
    odometer: theme.chartTrip,
    place: theme.chartService,
    date: theme.chartExpense,
    interval: theme.chartExpense,
  };

  // The line in runs: plain text, and each recognised fact in its colour.
  const runs: { text: string; kind: TokenKind | null }[] = [];
  let cursor = 0;
  for (const token of [...whole].sort((a, b) => a.start - b.start)) {
    if (token.start > cursor) runs.push({ text: text.slice(cursor, token.start), kind: null });
    runs.push({ text: text.slice(token.start, token.end), kind: token.kind });
    cursor = token.end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), kind: null });

  const facts = FACT_ORDER.filter((kind) => whole.some((token) => token.kind === kind));
  const label = (kind: TokenKind) =>
    kind === 'kind'
      ? 'Fuel'
      : kind === 'quantity'
        ? (parsed.quantity ?? '')
        : kind === 'money'
          ? `$${parsed.amount ?? ''}`
          : kind === 'odometer'
            ? `${(parsed.odometer ?? 0).toLocaleString()} km`
            : (parsed.place ?? '');

  return (
    <View style={styles.lineScene}>
      <View style={[styles.lineField, { backgroundColor: theme.background }, rimmed(theme)]}>
        <Text style={[styles.spark, { color: theme.primary }]}>✦</Text>
        <Text style={[styles.lineText, { color: theme.foreground }]}>
          {runs.map((run, place) => (
            <Text
              key={place}
              style={[
                styles.lineText,
                run.kind
                  ? {
                      color: hue[run.kind],
                      fontWeight: run.kind === 'kind' ? '700' : '600',
                    }
                  : null,
              ]}
            >
              {run.text}
            </Text>
          ))}
          <Caret />
        </Text>
      </View>
      <View style={styles.facts}>
        {facts.map((kind) => (
          <FactChip key={kind} color={hue[kind]} text={label(kind)} glyph={kind === 'kind'} />
        ))}
      </View>
    </View>
  );
}

/** The caret, blinking after the last letter. */
function Caret() {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (reduce) return;
    const timer = setInterval(() => setOn((value) => !value), 520);
    return () => clearInterval(timer);
  }, [reduce]);
  return <Text style={[styles.lineText, { color: on ? theme.primary : 'transparent' }]}>▍</Text>;
}

function FactChip({ color, text, glyph }: { color: string; text: string; glyph: boolean }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [pop] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return;
    Animated.spring(pop, { toValue: 1, speed: 18, bounciness: 12, useNativeDriver: true }).start();
  }, [pop, reduce]);
  return (
    <Animated.View
      style={[
        styles.fact,
        { backgroundColor: `${color}1A`, borderColor: `${color}55` },
        {
          opacity: pop,
          transform: [
            { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
            { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
      ]}
    >
      {glyph ? (
        <Glyph size={14}>⛽</Glyph>
      ) : (
        <View style={[styles.factDot, { backgroundColor: color }]} />
      )}
      <Text style={[figure, styles.factText, { color: theme.foreground }]}>{text}</Text>
    </Animated.View>
  );
}

/**
 * Scene three: what is next. The service's gauge runs up to where it stands — most of the way
 * round, amber — and its reminder drops in from the top the way a notification does.
 */
function AheadScene({ active, height }: { active: boolean; height: number }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [sweep] = useState(() => new Animated.Value(reduce ? 0.86 : 0));
  const [note] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const dial = Math.round(Math.min(150, height * 0.5));

  useEffect(() => {
    if (!active || reduce) return;
    sweep.setValue(0);
    note.setValue(0);
    const run = Animated.parallel([
      Animated.timing(sweep, {
        toValue: 0.86,
        duration: 1300,
        delay: 250,
        easing: ease.out,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.delay(1400),
        Animated.spring(note, { toValue: 1, speed: 10, bounciness: 9, useNativeDriver: true }),
      ]),
    ]);
    run.start();
    return () => {
      run.stop();
    };
  }, [active, reduce, sweep, note]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.clip, styles.ahead]}>
      <Animated.View
        style={[
          styles.notice,
          { backgroundColor: `${theme.popover}F5` },
          rimmed(theme),
          {
            opacity: note,
            transform: [
              { translateY: note.interpolate({ inputRange: [0, 1], outputRange: [-70, 0] }) },
            ],
          },
        ]}
      >
        <View style={[styles.noticeIcon, { backgroundColor: theme.primary }]}>
          <Ionicons name="notifications" size={13} color={theme.primaryForeground} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.noticeTitle, { color: theme.foreground }]}>
            Oil change due soon
          </Text>
          <Text numberOfLines={1} style={[styles.noticeLine, { color: theme.mutedForeground }]}>
            Daily driver · in 12 days
          </Text>
        </View>
        <Text style={[figure, styles.noticeWhen, { color: theme.mutedForeground }]}>now</Text>
      </Animated.View>

      <View style={styles.dialRow}>
        <Gauge progress={sweep} size={dial} color={theme.warning} redlineFrom={0.9} label="">
          <Glyph size={Math.round(dial * 0.2)}>🛢️</Glyph>
        </Gauge>
        <Text style={[styles.dialWord, { color: theme.mutedForeground }]}>OIL CHANGE</Text>
        <Text style={[figure, styles.dialFigure, { color: theme.foreground }]}>
          12 days · 480 km left
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  logo: { width: 109, height: 29 },
  pager: { flex: 1 },
  scene: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg },
  stage: { ...leaf('lg'), overflow: 'hidden' },
  clip: { ...leaf('lg'), overflow: 'hidden' },
  words: { gap: 6 },
  lede: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  dots: { flexDirection: 'row', gap: 6, alignSelf: 'center', marginBottom: spacing.xs },
  dot: { height: 6, borderRadius: 3 },

  bayCard: {
    ...leaf('sm'),
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bayName: { fontSize: 14, lineHeight: 19, fontWeight: '700', letterSpacing: -0.2 },
  bayLine: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  bayFigures: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  bayFigure: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
  bayUnit: { fontSize: 9, lineHeight: 12, fontWeight: '600', letterSpacing: 0.4 },

  lineScene: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.lg },
  lineField: {
    ...leaf('sm'),
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 78,
  },
  spark: { fontSize: 18, lineHeight: 24 },
  lineText: { flexShrink: 1, fontSize: 17, lineHeight: 24, fontWeight: '500', letterSpacing: -0.2 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, minHeight: 64 },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  factDot: { width: 6, height: 6, borderRadius: 3 },
  factText: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0 },

  ahead: { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: spacing.lg },
  notice: {
    ...leaf('sm'),
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeTitle: { fontSize: 13.5, lineHeight: 18, fontWeight: '700' },
  noticeLine: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  noticeWhen: { fontSize: 10, lineHeight: 14, fontWeight: '600' },
  dialRow: { alignItems: 'center', gap: 2 },
  dialWord: { fontSize: 10, lineHeight: 13, fontWeight: '600', letterSpacing: 1.2, marginTop: -6 },
  dialFigure: { fontSize: 14, lineHeight: 19, fontWeight: '600', letterSpacing: 0 },
});
