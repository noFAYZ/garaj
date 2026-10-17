import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import type { PickedFile } from '@/lib/file-picker';
import { Eyebrow, Glyph } from '@/lib/instrument';
import { ease, haptic, Pop, PressableScale, useReduceMotion } from '@/lib/motion';
import { radius, spacing, typeScale, useTheme } from '@/lib/theme';

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
        {
          backgroundColor: theme.cardRaised,
          borderColor: focused ? theme.ring : theme.border,
        },
      ]}
    >
      <Ionicons
        name="sparkles"
        size={15}
        color={lit || focused ? theme.foreground : theme.mutedForeground}
      />
      <TextInput
        placeholderTextColor={theme.borderStrong}
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
  /** An emoji, drawn in the web's own artwork. */
  readonly glyph?: string;
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
  const scroller = useRef<ScrollView>(null);
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
  }, [chosen]);

  return (
    <View style={{ gap: 6 }}>
      {label ? <Eyebrow style={{ paddingHorizontal: 2 }}>{label}</Eyebrow> : null}
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
              {item.glyph ? <Glyph size={17}>{item.glyph}</Glyph> : null}
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

const KEY = 54;

/**
 * The photo's key, beside Save and the same height: a camera with the reader's spark until
 * something is attached, then the photo itself — dimmed, a copper line sweeping over it while it is
 * read, a tick popping in once it has filled something. The web's receipt key is the same.
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
        { backgroundColor: theme.muted, borderColor: photo ? theme.primary : theme.border },
      ]}
    >
      {photo ? (
        <>
          <Image
            source={{ uri: photo.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
            accessible={false}
          />
          {reading ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}>
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
          <Ionicons name="camera-outline" size={22} color={theme.foreground} />
          {/* It reads what it sees: the spark says so before anyone finds out. */}
          <View style={[styles.spark, { backgroundColor: theme.primary }]}>
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
    minHeight: 54,
    borderRadius: radius.xxl,
    borderWidth: 1,
    paddingLeft: spacing.lg,
    paddingRight: 6,
  },
  lineInput: { flex: 1, fontSize: 16.5, paddingVertical: 10, paddingHorizontal: 0 },
  chip: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 999,
  },
  fact: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    maxWidth: '100%',
  },
  factLabel: { flexShrink: 1, fontWeight: '600' },
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
    borderRadius: radius.xxl,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
    right: 3,
    bottom: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spark: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
