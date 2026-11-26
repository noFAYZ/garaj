import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState, type ReactNode, type ReactElement } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ScrollViewInstance,
} from 'react-native';
import type { PickedFile } from '@/lib/file-picker';
import { Eyebrow, formLabel, Glyph } from '@/lib/instrument';
import { ease, haptic, Pop, PressableScale, spring, useReduceMotion } from '@/lib/motion';
import { figure, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';

/**
 * The add forms' own pieces — the web's twins in `add-vehicle-dialog` and `vehicle/add-entry` —
 * so a vehicle and an entry are added with the same parts on both: the line marked ✦ that is read
 * into the form, a labelled rail of chips, a fact worn as a chip, and the photo's key beside Save.
 */

/** The line that is read: ✦, the words, and an action at its end when it has one. */
export function Line({
  trailing,
  lit = false,
  ...props
}: TextInputProps & {
  trailing?: ReactNode;
  /** Something has been read from it: the ✦ in ink. */
  lit?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.line,
        // Filled like the cards and chips round it; the ring only while it is being typed in.
        { backgroundColor: theme.muted, borderColor: focused ? theme.ring : 'transparent' },
      ]}
    >
      <Ionicons
        name="sparkles"
        size={15}
        color={lit || focused ? theme.foreground : theme.mutedForeground}
      />
      <TextInput
        placeholderTextColor={theme.placeholder}
        autoCorrect={false}
        maxLength={200}
        style={[typeScale.headline, styles.lineInput, { color: theme.foreground }]}
        {...props}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
      />
      {trailing}
    </View>
  );
}

export interface RailItem {
  readonly key: string;
  readonly label: string;
  /** An emoji, drawn in the web's own artwork — or an icon of its own. */
  readonly glyph?: string | ReactElement;
  readonly selected: boolean;
  /** Chosen by the line, not a hand: ✦. */
  readonly marked?: boolean;
  /** After the label: a due status, a tick. */
  readonly trailing?: ReactNode;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

/**
 * A labelled row of chips that scrolls sideways edge to edge, the web's `Rail`. The chosen one is
 * kept in view: a kind the line picked may sit past the edge.
 */
export function Rail({
  label,
  items,
  inset = spacing.md,
}: {
  label?: string;
  items: readonly RailItem[];
  /** The screen's side padding, which the rail runs out into. */
  inset?: number;
}) {
  const theme = useTheme();
  const scroller = useRef<ScrollViewInstance>(null);
  const spots = useRef(new Map<string, { x: number; width: number }>());
  const view = useRef({ x: 0, width: 0 });
  const chosen = items.find((item) => item.selected)?.key;

  // Brings a chip into view when it is outside it; a chip already showing is left where it is.
  const reveal = (spot: { x: number; width: number } | undefined) => {
    const { x, width } = view.current;
    if (!spot || !width) return;
    if (spot.x < x || spot.x + spot.width > x + width) {
      scroller.current?.scrollTo({ x: Math.max(0, spot.x - inset * 2), animated: true });
    }
  };
  // On a new choice. Its place is the one its own layout last reported — see `onLayout` below for
  // a chip that moved because the order did.
  // ponytail: a chip chosen before the rail has measured itself is not scrolled to.
  useEffect(() => {
    if (chosen) reveal(spots.current.get(chosen));
    // On a new choice only: `reveal` reads refs, and is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  return (
    <View style={{ gap: 6 }}>
      {label ? <Eyebrow style={[formLabel, styles.label]}>{label}</Eyebrow> : null}
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={(event) => {
          view.current.x = event.nativeEvent.contentOffset.x;
        }}
        onLayout={(event) => {
          view.current.width = event.nativeEvent.layout.width;
        }}
        style={{ marginHorizontal: -inset }}
        contentContainerStyle={{ gap: spacing.sm - 2, paddingHorizontal: inset }}
      >
        {items.map((item) => {
          const ink = item.selected ? theme.primaryForeground : theme.foreground;
          return (
            <PressableScale
              key={item.key}
              onLayout={(event) => {
                const spot = {
                  x: event.nativeEvent.layout.x,
                  width: event.nativeEvent.layout.width,
                };
                spots.current.set(item.key, spot);
                // The order can change under a chosen chip (a vehicle's habits arriving).
                if (item.selected) reveal(spot);
              }}
              onPress={() => {
                if (!item.selected) haptic.selection();
                item.onPress();
              }}
              disabled={item.disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: item.selected, disabled: Boolean(item.disabled) }}
              accessibilityLabel={`${item.label}${item.marked ? ', read from what you typed' : ''}`}
              scaleTo={0.94}
              style={[
                styles.chip,
                {
                  backgroundColor: item.selected ? theme.primary : theme.muted,
                  opacity: item.disabled ? 0.4 : 1,
                },
              ]}
            >
              {typeof item.glyph === 'string' ? (
                <Glyph size={17}>{item.glyph}</Glyph>
              ) : (
                (item.glyph ?? null)
              )}
              <Text numberOfLines={1} style={[typeScale.label, { maxWidth: 200, color: ink }]}>
                {item.label}
              </Text>
              {item.marked ? <Ionicons name="sparkles" size={11} color={ink} /> : null}
              {item.trailing}
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * A fact about the entry worn as a chip — the day, the place, a trip's purpose. Pressed, it opens or
 * toggles what it says; its × drops it.
 */
export function Fact({
  icon,
  glyph,
  label,
  selected = false,
  marked = false,
  onPress,
  onRemove,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  /** An emoji in place of the icon, drawn in the web's own artwork. */
  glyph?: string;
  label: string;
  selected?: boolean;
  marked?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const ink = selected ? theme.primaryForeground : theme.foreground;
  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        onPress?.();
      }}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}${marked ? ', filled for you' : ''}`}
      scaleTo={0.95}
      style={[
        styles.fact,
        onRemove ? { paddingRight: 4 } : null,
        { backgroundColor: selected ? theme.primary : theme.muted },
      ]}
    >
      {glyph ? (
        <Glyph size={16}>{glyph}</Glyph>
      ) : icon ? (
        <Ionicons name={icon} size={14} color={selected ? ink : theme.mutedForeground} />
      ) : null}
      <Text numberOfLines={1} style={[typeScale.caption, styles.factLabel, { color: ink }]}>
        {label}
      </Text>
      {marked ? <Ionicons name="sparkles" size={10} color={ink} /> : null}
      {onRemove ? (
        <PressableScale
          onPress={() => {
            haptic.selection();
            onRemove();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Leave out ${label}`}
          hitSlop={8}
          scaleTo={0.85}
          style={styles.factRemove}
        >
          <Ionicons name="close" size={13} color={theme.mutedForeground} />
        </PressableScale>
      ) : null}
    </PressableScale>
  );
}

/**
 * A choice made in a sheet, as a card of its own: its picture in a tile, the name and a quiet line
 * under it (where its odometer stands, how often it is logged) that says what the card is without a
 * caption, and the chevron that says a press opens the list. Symmetric corners: it is a control.
 */
export function SelectCell({
  value,
  detail,
  lead,
  marked = false,
  onPress,
  accessibilityLabel,
}: {
  value: string;
  /** The quiet line under the name. */
  detail?: string;
  /** In the tile ahead of the name: the vehicle's photo, the kind's emoji. */
  lead?: ReactNode;
  /** Chosen by the line, not a hand: ✦. */
  marked?: boolean;
  /** Absent when there is nothing else to choose: the card only says what it is. */
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
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
      accessibilityLabel={`${accessibilityLabel}${marked ? ', read from what you typed' : ''}`}
      accessibilityHint={onPress ? 'Opens the list to choose from' : undefined}
      scaleTo={0.98}
      style={[styles.select, { backgroundColor: theme.muted }]}
    >
      <View style={[styles.selectTile, { backgroundColor: theme.cardRaised }]}>{lead}</View>
      <View style={styles.selectWords}>
        <Text numberOfLines={1} style={[styles.selectName, { color: theme.foreground }]}>
          {value}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={[styles.selectDetail, { color: theme.mutedForeground }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      {marked ? <Ionicons name="sparkles" size={11} color={theme.primary} /> : null}
      {onPress ? <Ionicons name="chevron-expand" size={15} color={theme.mutedForeground} /> : null}
    </PressableScale>
  );
}

/** The switch's track and the knob that runs in it. */
const TRACK = 38;
const KNOB = 18;
const TRACK_PAD = 3;

/**
 * A switch between two ways of the same thing — Quick or Details, Once or Repeats: a copper knob in
 * a track between the two names, the side it rests on in ink. A switch, not tabs: it flips how the
 * form asks, it goes nowhere. A press anywhere on it flips it; the knob runs on the native driver.
 */
export function TwoWay({
  left,
  right,
  on,
  onChange,
  said,
}: {
  left: string;
  right: string;
  /** Resting on the right-hand way. */
  on: boolean;
  onChange: (on: boolean) => void;
  /** The right-hand way as a screen reader says it, a switch that is on or off. */
  said: string;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [x] = useState(() => new Animated.Value(on ? 1 : 0));
  const knob = useMemo(
    () => ({
      transform: [
        {
          translateX: x.interpolate({
            inputRange: [0, 1],
            outputRange: [0, TRACK - KNOB - TRACK_PAD * 2],
          }),
        },
      ],
    }),
    [x],
  );
  useEffect(() => {
    if (reduce) return x.setValue(on ? 1 : 0);
    const slide = Animated.spring(x, {
      toValue: on ? 1 : 0,
      useNativeDriver: true,
      ...spring.glide,
    });
    slide.start();
    return () => slide.stop();
  }, [on, reduce, x]);

  const word = (text: string, lit: boolean) => (
    <Text
      numberOfLines={1}
      style={[styles.twoWayWord, { color: lit ? theme.foreground : theme.mutedForeground }]}
    >
      {text}
    </Text>
  );
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onChange(!on);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={said}
      hitSlop={8}
      style={styles.twoWay}
    >
      {word(left, !on)}
      <View style={[styles.track, { backgroundColor: theme.primarySoft }]}>
        <Animated.View style={[styles.knob, { backgroundColor: theme.primary }, knob]} />
      </View>
      {word(right, on)}
    </Pressable>
  );
}

/** The primary key beside it at `md`: a 44pt face on its 2pt lip. */
const KEY = 46;

const MONTH_SHORT = new Intl.DateTimeFormat('en-GB', { month: 'short' });

/**
 * The entry's day as a key, beside the photo's and the same size: a calendar leaf in miniature —
 * TODAY (or the month) small in copper over the day's number in figures. A day other than today
 * wears the copper ring an attached photo does, so a back-dated entry is seen before it is saved.
 * Pressed, the calendar. A button, not a field: the day is nearly always today.
 */
export function DateKey({
  day,
  today,
  said,
  marked = false,
  onPress,
}: {
  /** `YYYY-MM-DD`. */
  day: string;
  /** Today's `YYYY-MM-DD`, so the key can say so. */
  today: string;
  /** The day as a sentence says it: "Today", "Sat 3 Oct". */
  said: string;
  /** Read from the line or the photo: ✦. */
  marked?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const date = new Date(`${day}T12:00:00`);
  const isToday = day === today;
  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`When: ${said}${marked ? ', read from what you typed' : ''}`}
      accessibilityHint="Opens the calendar"
      scaleTo={0.92}
      style={[
        styles.key,
        { backgroundColor: theme.muted },
        isToday ? rimmed(theme) : { borderWidth: 2, borderColor: theme.primary },
      ]}
    >
      <Text style={[styles.dateMonth, { color: theme.primary }]}>
        {isToday ? 'Today' : MONTH_SHORT.format(date)}
      </Text>
      <Text style={[styles.dateDay, { color: theme.foreground }]}>{date.getDate()}</Text>
      {marked ? (
        <View
          style={[styles.spark, { backgroundColor: theme.primary, borderColor: theme.popover }]}
        >
          <Ionicons name="sparkles" size={9} color={theme.primaryForeground} />
        </View>
      ) : null}
    </PressableScale>
  );
}

/**
 * The photo's key, beside Save and the same height: round, as the app's other secondary keys (the
 * dock's, the onboarding's) — a camera with the reader's spark until something is attached, then
 * the photo itself in a copper ring: dimmed, a copper line sweeping over it while it is read, a tick
 * popping in once it has filled something. The web's receipt key is the same.
 */
export function PhotoKey({
  photo,
  name,
  reading,
  read,
  onPress,
  onLongPress,
}: {
  photo: PickedFile | null;
  /** What the photo is: a receipt, an invoice, the dashboard, the vehicle. */
  name: string;
  reading: boolean;
  read: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [sweep] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!reading || reduce) {
      sweep.setValue(0);
      return;
    }
    const pass = (toValue: number) =>
      Animated.timing(sweep, { toValue, duration: 700, easing: ease.inOut, useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([pass(1), pass(0)]));
    loop.start();
    return () => loop.stop();
  }, [reading, reduce, sweep]);

  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={
        photo ? `${name} attached${reading ? ', being read' : ''}` : `Add a photo of the ${name}`
      }
      accessibilityHint={photo ? 'Retake or remove it' : 'Opens the camera. Hold for your photos'}
      scaleTo={0.92}
      style={[
        styles.key,
        { backgroundColor: theme.muted },
        photo ? { borderWidth: 2, borderColor: theme.primary } : rimmed(theme),
      ]}
    >
      {photo ? (
        <>
          {/* The photo clipped to the circle; the tick sits on its rim, outside the clip. */}
          <View style={styles.keyClip}>
            <Image
              source={{ uri: photo.uri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={150}
              accessible={false}
            />
          </View>
          {reading ? (
            <View style={[styles.keyClip, { backgroundColor: theme.scrim }]}>
              <Animated.View
                style={[
                  styles.sweep,
                  {
                    backgroundColor: theme.primary,
                    shadowColor: theme.primary,
                    transform: [
                      {
                        translateY: sweep.interpolate({
                          inputRange: [0, 1],
                          outputRange: [6, KEY - 10],
                        }),
                      },
                    ],
                  },
                ]}
              />
            </View>
          ) : null}
          {read ? (
            <Pop
              style={[styles.tick, { backgroundColor: theme.success, borderColor: theme.popover }]}
            >
              <Ionicons name="checkmark" size={10} color={theme.background} />
            </Pop>
          ) : null}
        </>
      ) : (
        <>
          <Ionicons name="camera-outline" size={21} color={theme.foreground} />
          {/* It reads what it sees: the spark says so before anyone finds out. */}
          <View
            style={[styles.spark, { backgroundColor: theme.primary, borderColor: theme.popover }]}
          >
            <Ionicons name="sparkles" size={9} color={theme.primaryForeground} />
          </View>
        </>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    minHeight: 48,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 6,
  },
  lineInput: { flex: 1, fontSize: 15.5, paddingVertical: 9, paddingHorizontal: 0 },
  label: { paddingHorizontal: 2 },
  chip: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 999,
  },
  fact: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    maxWidth: '100%',
  },
  factLabel: { flexShrink: 1, fontWeight: '600' },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingLeft: 9,
    paddingRight: 14,
    borderRadius: radius.lg,
  },
  selectTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectWords: { flex: 1, minWidth: 0, gap: 1 },
  selectName: { fontSize: 14, lineHeight: 18, fontWeight: '600', letterSpacing: -0.1 },
  selectDetail: { fontSize: 11.5, lineHeight: 15 },
  dateMonth: {
    fontSize: 8.5,
    lineHeight: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  dateDay: { ...figure, fontSize: 16, lineHeight: 19, fontWeight: '700', letterSpacing: -0.4 },
  // Its own width wherever it sits: a switch, not a bar across the form.
  twoWay: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8 },
  twoWayWord: { fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  track: {
    width: TRACK,
    height: KNOB + TRACK_PAD * 2,
    borderRadius: 999,
    padding: TRACK_PAD,
  },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2 },
  factRemove: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  key: {
    width: KEY,
    height: KEY,
    borderRadius: KEY / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // RN 0.88 has no absoluteFillObject: the fill spelled out.
  keyClip: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: KEY / 2,
    overflow: 'hidden',
  },
  sweep: {
    position: 'absolute',
    left: 4,
    right: 4,
    height: 2,
    borderRadius: 1,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  tick: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // On the key's rim, as a badge: outside its circle, not crowding the camera.
  spark: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
