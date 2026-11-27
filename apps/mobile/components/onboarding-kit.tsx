import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ease, PressableScale, useReduceMotion } from '@/lib/motion';
import { figure, leaf, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';

/*
 * The parts every first-run screen is made of, so the welcome and the garage setup read as one
 * thing: a two-tone headline, a rail that fills as you go, a choice drawn as a card, and a footer
 * pinned where the thumb already is. One idea per screen, one decision, one big key.
 */

/**
 * The headline: what is being asked in ink, the reason it is asked muted under it — sign-in's
 * two-tone voice. The muted line is its own Text, with its own weight: a nested Text is dressed
 * alone (`lib/font-faces`).
 */
export function TwoTone({
  lead,
  rest,
  size = 'lg',
  align = 'left',
}: {
  lead: string;
  rest?: string;
  size?: 'lg' | 'xl';
  align?: 'left' | 'center';
}) {
  const theme = useTheme();
  const scale = size === 'xl' ? styles.xl : styles.lg;
  return (
    <Text accessibilityRole="header" style={[scale, { color: theme.foreground, textAlign: align }]}>
      {lead}
      {rest ? (
        <>
          {'\n'}
          <Text style={[scale, { color: theme.mutedForeground }]}>{rest}</Text>
        </>
      ) : null}
    </Text>
  );
}

/** A small tracked line over a headline: where in the flow this is, or what the screen is for. */
export function Kicker({
  children,
  tone = 'muted',
}: {
  children: string;
  tone?: 'muted' | 'copper';
}) {
  const theme = useTheme();
  return (
    <Text
      style={[
        figure,
        styles.kicker,
        { color: tone === 'copper' ? theme.primary : theme.mutedForeground },
      ]}
    >
      {children.toUpperCase()}
    </Text>
  );
}

/**
 * How far along: a segment a step, the done ones copper, the current one filling as it arrives —
 * and the first already lit when the setup opens (the account is made), so nobody starts at zero.
 */
export function StepRail({ step, total }: { step: number; total: number }) {
  const theme = useTheme();
  return (
    <View
      style={styles.rail}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: step }}
      accessibilityLabel={`Step ${step} of ${total}`}
    >
      {Array.from({ length: total }, (_, index) => (
        <RailSegment
          key={index}
          state={index < step - 1 ? 'done' : index === step - 1 ? 'current' : 'ahead'}
          color={theme.primary}
          ground={theme.muted}
        />
      ))}
    </View>
  );
}

function RailSegment({
  state,
  color,
  ground,
}: {
  state: 'done' | 'current' | 'ahead';
  color: string;
  ground: string;
}) {
  const reduce = useReduceMotion();
  const target = state === 'ahead' ? 0 : 1;
  const [fill] = useState(() => new Animated.Value(target));
  useEffect(() => {
    if (reduce) return fill.setValue(target);
    const animation = Animated.timing(fill, {
      toValue: target,
      duration: 520,
      easing: ease.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fill, target, reduce]);
  return (
    <View style={[styles.segment, { backgroundColor: ground }]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.segmentFill,
          {
            backgroundColor: color,
            opacity: state === 'current' ? 1 : 0.85,
            transform: [{ scaleX: fill }],
          },
        ]}
      />
    </View>
  );
}

/** A round glass key: back, close. */
export function RoundKey({
  icon,
  label,
  onPress,
  tone = 'glass',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** `primary`: the screen's main action, copper. */
  tone?: 'glass' | 'primary';
}) {
  const theme = useTheme();
  const primary = tone === 'primary';
  return (
    <PressableScale
      onPress={() => {
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      scaleTo={0.9}
      style={[
        styles.roundKey,
        primary
          ? { backgroundColor: theme.primary }
          : [{ backgroundColor: `${theme.cardRaised}E6` }, rimmed(theme)],
      ]}
    >
      <Ionicons
        name={icon}
        size={primary ? 20 : 18}
        color={primary ? theme.primaryForeground : theme.foreground}
      />
    </PressableScale>
  );
}

/** A quiet word-key: Skip, Not now. */
export function TextKey({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={() => {
        onPress();
      }}
      accessibilityRole="button"
      hitSlop={10}
      scaleTo={0.94}
      style={styles.textKey}
    >
      <Text style={[typeScale.label, { color: theme.mutedForeground }]}>{label}</Text>
    </PressableScale>
  );
}

/**
 * One of a few answers, as a card: its icon, what it is, a line on what it means. No outlines —
 * at rest it is a raised card with a quiet dot; chosen, it takes the copper wash every chosen thing
 * in the app wears and the dot springs into a copper check. The whole card is the target.
 */
export function ChoiceCard({
  icon,
  title,
  line,
  selected,
  onPress,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  line: string;
  selected: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [check] = useState(() => new Animated.Value(selected ? 1 : 0));
  useEffect(() => {
    const target = selected ? 1 : 0;
    if (reduce) return check.setValue(target);
    const animation = Animated.spring(check, {
      toValue: target,
      speed: 20,
      bounciness: 12,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [check, selected, reduce]);
  return (
    <PressableScale
      onPress={() => {
        onPress();
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${line}`}
      scaleTo={0.97}
      style={[
        styles.choice,
        selected
          ? { backgroundColor: theme.primarySoft }
          : [{ backgroundColor: theme.cardRaised }, rimmed(theme)],
        style,
      ]}
    >
      <View
        style={[styles.choiceGlyph, { backgroundColor: selected ? theme.cardRaised : theme.muted }]}
      >
        <Ionicons name={icon} size={24} color={selected ? theme.primary : theme.foreground} />
      </View>
      <View style={styles.choiceWords}>
        <Text style={[styles.choiceTitle, { color: theme.foreground }]}>{title}</Text>
        <Text style={[styles.choiceLine, { color: theme.mutedForeground }]}>{line}</Text>
      </View>
      <View style={[styles.radio, { backgroundColor: theme.muted }]}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.radioOn,
            {
              backgroundColor: theme.primary,
              opacity: check,
              transform: [
                { scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
              ],
            },
          ]}
        >
          <Ionicons name="checkmark" size={15} color={theme.primaryForeground} />
        </Animated.View>
      </View>
    </PressableScale>
  );
}

/** Where the decision is made: pinned to the foot of the screen, in the thumb's reach. */
export function Footer({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}
    >
      {children}
    </View>
  );
}

/**
 * A step's content arriving: in from the side it is travelling to, so going forward and going back
 * feel like moving along one strip rather than screens swapping.
 */
export function Slide({
  direction,
  children,
  style,
}: {
  direction: 1 | -1;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const [arrive] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return;
    const animation = Animated.timing(arrive, {
      toValue: 1,
      duration: 420,
      easing: ease.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [arrive, reduce]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: arrive,
          transform: [
            {
              translateX: arrive.interpolate({
                inputRange: [0, 1],
                outputRange: [28 * direction, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  lg: { fontSize: 24, lineHeight: 28, fontWeight: '700', letterSpacing: -0.8 },
  xl: { fontSize: 28, lineHeight: 32, fontWeight: '700', letterSpacing: -1 },
  kicker: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 1.6 },
  rail: { flex: 1, flexDirection: 'row', gap: 5, alignItems: 'center' },
  segment: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  segmentFill: { borderRadius: 2, transformOrigin: 'left' },
  roundKey: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textKey: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 },
  choice: {
    ...leaf('md'),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    paddingRight: spacing.lg,
  },
  choiceGlyph: {
    ...leaf('sm'),
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceWords: { flex: 1, minWidth: 0, gap: 2 },
  choiceTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700', letterSpacing: -0.3 },
  choiceLine: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  radio: { width: 26, height: 26, borderRadius: 13 },
  radioOn: { borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.xs },
});
