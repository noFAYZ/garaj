import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddGlyph } from '@/components/add-sheet';
import { Glyph, Icon, type IconName } from '@/lib/instrument';
import { ease, haptic, PressableScale, spring, useReduceMotion } from '@/lib/motion';
import { lift, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Key } from '@/lib/ui';

/** One place in a dock. */
export type DockItem = {
  key: string;
  label: string;
  /** From the web's own icon set, so a place wears the same glyph on both. */
  icon: IconName;
  /** A colour when something waits behind this section, nothing when it does not. */
  dot?: string | null;
  /** How many wait there — the web's count on its Reminders tab. Wins over `dot`. */
  count?: number;
  /** Red when any of them is late, amber when they are only coming. */
  countTone?: 'destructive' | 'warning';
  /** Said instead of the label, where a count belongs in it. */
  a11yLabel?: string;
};

/** One card the key deals: something to add, said as what it is. */
export type DockAction = {
  key: string;
  emoji: string;
  label: string;
  hint?: string;
  onPress: () => void;
};

// Old architecture on Android keeps LayoutAnimation behind a flag; on the new one it is a no-op.
if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

/** Where a place sits inside the dock, measured rather than divided into equal slots. */
type Box = { x: number; width: number };

const PAD = 5;
const TAB = 44;
const KEY = 44;
const DOCK = KEY + PAD * 2;
const GUTTER = spacing.lg;
/** The bar above the safe area: the dock and the air over it. */
const BAR_HEIGHT = spacing.sm + DOCK;

/**
 * What a screen under a dock leaves below its last row: the dock floats, so a page that ends where
 * the screen ends would have its final row underneath it.
 */
export function useDockSpace(): number {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + Math.max(insets.bottom, spacing.sm) + spacing.lg;
}

/**
 * The dock: one floating surface — the web's popover material, its lit rim in the dark — that
 * hugs what it holds and sits centred over the page: the places, then the copper key. Nothing is
 * spread to fill a width, so the icons sit close and the bar is only as wide as its contents.
 *
 * The places wear the web's own Solar duotone icons. Where you are wears its label inside the web
 * nav's copper wash, and the wash *travels*: its leading edge sets off first and the trailing one
 * follows, so it stretches toward where you are going and gathers itself there. The icon you
 * arrive at pops in, in copper.
 *
 * The key is the web's `.key` — a lit top edge, a lip under it, a face that sinks onto the lip.
 * Pressed, it deals what you can add as a fanned hand of cards, nearest first, and becomes their
 * ×. Held, it goes straight to the camera. With no `actions`, a press opens the sheet directly.
 *
 * Both docks in the app are this one — the app's places and a vehicle's sections.
 */
export function Dock({
  items,
  activeKey,
  onSelect,
  add,
  actions,
  children,
}: {
  items: readonly DockItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  add: {
    a11yLabel: string;
    /** Whether the sheet the key opens is open — the key shows × for it too. */
    open: boolean;
    onPress: () => void;
    onLongPress: () => void;
  };
  actions?: readonly DockAction[];
  /** The sheet the key opens: a sibling of the dock, so it covers the page rather than sits in it. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const reduce = useReduceMotion();
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [dockWidth, setDockWidth] = useState(0);
  const [left] = useState(() => new Animated.Value(0));
  const [right] = useState(() => new Animated.Value(0));
  const [arrive] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const [fanned, setFanned] = useState(false);
  const placed = useRef<Box | null>(null);
  const bottom = Math.max(insets.bottom, spacing.sm);
  // The dock is centred, so the key's distance from the screen's right edge follows its width.
  const keyRight = dockWidth > 0 ? (screenWidth - dockWidth) / 2 + PAD : GUTTER + PAD;

  const target = boxes[activeKey];

  // The dock rises into place once, when its screen first appears.
  useEffect(() => {
    if (reduce) return;
    Animated.spring(arrive, {
      toValue: 1,
      delay: 120,
      useNativeDriver: true,
      speed: 10,
      bounciness: 5,
    }).start();
  }, [arrive, reduce]);

  /*
   * The wash's two edges, each on its own spring: whichever edge faces the way it is going leads,
   * the other lags, so the pill stretches across and settles. `left` and `width` cannot ride the
   * native driver; three views on a spring is not the work that drops frames.
   */
  useEffect(() => {
    if (!target) return;
    const from = placed.current;
    placed.current = target;
    if (reduce || !from) {
      left.setValue(target.x);
      right.setValue(target.x + target.width);
      return;
    }
    const goingRight = target.x > from.x;
    const lead = { useNativeDriver: false, speed: 24, bounciness: 4 } as const;
    const lag = { useNativeDriver: false, speed: 11, bounciness: 6 } as const;
    const settle = Animated.parallel([
      Animated.spring(left, { toValue: target.x, ...(goingRight ? lag : lead) }),
      Animated.spring(right, { toValue: target.x + target.width, ...(goingRight ? lead : lag) }),
    ]);
    settle.start();
    return () => settle.stop();
  }, [target, reduce, left, right]);

  /**
   * The label's arrival changes the dock's width, and the dock re-centres: both are a layout
   * change, asked for before the press lands so they glide rather than jump.
   */
  const easeLabels = () => {
    if (reduce) return;
    LayoutAnimation.configureNext({
      duration: 280,
      create: { type: 'easeOut', property: 'opacity' },
      update: { type: 'spring', springDamping: 0.85 },
      delete: { type: 'easeIn', property: 'opacity', duration: 90 },
    });
  };

  const measure = (key: string) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    setBoxes((previous) => {
      const known = previous[key];
      return known?.x === x && known.width === width
        ? previous
        : { ...previous, [key]: { x, width } };
    });
  };

  const pressKey = () => {
    haptic.light();
    if (actions && actions.length > 0) setFanned(true);
    else add.onPress();
  };

  return (
    <View
      // Nothing is drawn around the capsule, so a tap there belongs to the page behind.
      pointerEvents="box-none"
      style={[styles.bar, { paddingBottom: bottom }]}
    >
      <Animated.View
        onLayout={(event) => setDockWidth(event.nativeEvent.layout.width)}
        style={[
          styles.dock,
          { backgroundColor: theme.popover },
          rimmed(theme),
          lift(theme),
          {
            transform: [
              { translateY: arrive.interpolate({ inputRange: [0, 1], outputRange: [90, 0] }) },
            ],
          },
        ]}
      >
        {/* The wash measures against this row, which has no padding of its own. */}
        <View accessibilityRole="tablist" style={styles.track}>
          {target ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pill,
                {
                  left,
                  width: Animated.subtract(right, left),
                  backgroundColor: theme.primarySoft,
                },
              ]}
            />
          ) : null}

          {items.map((item) => {
            const focused = item.key === activeKey;
            return (
              <PressableScale
                key={item.key}
                onPress={() => {
                  if (focused) return;
                  haptic.selection();
                  easeLabels();
                  onSelect(item.key);
                }}
                onLayout={measure(item.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                // The label is drawn only where you are, so every place names itself here.
                accessibilityLabel={item.a11yLabel ?? item.label}
                scaleTo={0.86}
                style={[styles.tab, focused && styles.tabActive]}
              >
                <TabIcon item={item} focused={focused} />
                {focused ? (
                  <Text numberOfLines={1} style={[styles.tabLabel, { color: theme.foreground }]}>
                    {item.label}
                  </Text>
                ) : null}
              </PressableScale>
            );
          })}
        </View>

        <Key
          onPress={pressKey}
          onLongPress={add.onLongPress}
          delayLongPress={300}
          radius={KEY / 2}
          accessibilityLabel={add.a11yLabel}
          accessibilityHint="Hold to take a photo"
          accessibilityState={{ expanded: add.open || fanned }}
          faceStyle={styles.keyFace}
        >
          <AddGlyph open={add.open || fanned} color={theme.primaryForeground} size={22} />
        </Key>
      </Animated.View>

      {fanned && actions ? (
        <Fan
          actions={actions}
          bottom={bottom}
          keyRight={keyRight}
          onClose={() => setFanned(false)}
          onPick={(action) => {
            setFanned(false);
            haptic.selection();
            action.onPress();
          }}
        />
      ) : null}

      {children}
    </View>
  );
}

/** A place's icon: the web's duotone glyph, muted when you are elsewhere, copper and popped in when you arrive. */
function TabIcon({ item, focused }: { item: DockItem; focused: boolean }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!focused || reduce) return;
    scale.setValue(0.55);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...spring.pop }).start();
  }, [focused, reduce, scale]);

  const count = item.count ?? 0;
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Icon name={item.icon} size={22} color={focused ? theme.primary : theme.mutedForeground} />
      {count > 0 ? (
        <View
          style={[
            styles.count,
            {
              borderColor: theme.popover,
              backgroundColor: item.countTone === 'destructive' ? theme.destructive : theme.warning,
            },
          ]}
        >
          <Text
            allowFontScaling={false}
            style={[
              styles.countText,
              {
                color:
                  item.countTone === 'destructive' ? theme.destructiveForeground : theme.background,
              },
            ]}
          >
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      ) : item.dot ? (
        <View style={[styles.dot, { backgroundColor: item.dot, borderColor: theme.popover }]} />
      ) : null}
    </Animated.View>
  );
}

const CARD = 56;
const CARD_GAP = 10;

/**
 * The hand the key deals: each card flies out of the key and lands in a stack above it, nearest
 * first, every one a little more turned and a little further left than the one below — a hand of
 * cards held from the key. The page dims behind them, and the key stays where it was, as their ×.
 *
 * Positioned from the dock's own geometry rather than measured on screen, so a modal that starts
 * its own window under the status bar and one that does not land the hand in the same place.
 */
function Fan({
  actions,
  bottom,
  keyRight,
  onClose,
  onPick,
}: {
  actions: readonly DockAction[];
  /** The dock's distance from the bottom of the screen. */
  bottom: number;
  /** The key's distance from the right of the screen. */
  keyRight: number;
  onClose: () => void;
  onPick: (action: DockAction) => void;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [dim] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const [deal] = useState(() => actions.map(() => new Animated.Value(reduce ? 1 : 0)));
  const keyBottom = bottom + PAD;
  const base = keyBottom + KEY + spacing.md;

  useEffect(() => {
    if (reduce) return;
    Animated.parallel([
      Animated.timing(dim, { toValue: 1, duration: 200, easing: ease.out, useNativeDriver: true }),
      Animated.stagger(
        38,
        deal.map((value) =>
          Animated.spring(value, { toValue: 1, useNativeDriver: true, speed: 13, bounciness: 7 }),
        ),
      ),
    ]).start();
  }, [dim, deal, reduce]);

  /** Every card back into the key at once, then the hand is gone. */
  const fold = (then: () => void) => {
    if (reduce) return then();
    Animated.parallel([
      Animated.timing(dim, { toValue: 0, duration: 160, useNativeDriver: true }),
      ...deal.map((value) =>
        Animated.timing(value, {
          toValue: 0,
          duration: 150,
          easing: ease.in,
          useNativeDriver: true,
        }),
      ),
    ]).start(() => then());
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => fold(onClose)}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim, opacity: dim }]}
      >
        <Pressable
          onPress={() => fold(onClose)}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {actions.map((action, index) => {
        const progress = deal[index]!;
        // From the key's centre to where this card lands.
        const rise = base - keyBottom - KEY / 2 + index * (CARD + CARD_GAP) + CARD / 2;
        const turn = -(index + 1) * 1.6;
        return (
          <Animated.View
            key={action.key}
            style={[
              styles.cardSlot,
              {
                right: keyRight + index * 5,
                bottom: base + index * (CARD + CARD_GAP),
                opacity: progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
                transform: [
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [rise, 0],
                    }),
                  },
                  { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
                  {
                    rotate: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [`${18 + index * 4}deg`, `${turn}deg`],
                    }),
                  },
                ],
              },
            ]}
          >
            <PressableScale
              onPress={() => fold(() => onPick(action))}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityHint={action.hint}
              scaleTo={0.95}
              style={[styles.card, { backgroundColor: theme.popover }, rimmed(theme), lift(theme)]}
            >
              <View style={[styles.coin, { backgroundColor: theme.muted }]}>
                <Glyph size={24}>{action.emoji}</Glyph>
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text numberOfLines={1} style={[typeScale.label, { color: theme.foreground }]}>
                  {action.label}
                </Text>
                {action.hint ? (
                  <Text
                    numberOfLines={1}
                    style={[typeScale.caption, { color: theme.mutedForeground }]}
                  >
                    {action.hint}
                  </Text>
                ) : null}
              </View>
            </PressableScale>
          </Animated.View>
        );
      })}

      {/* The key, where it stood, as the hand's ×. */}
      <View style={[styles.keySlot, { right: keyRight, bottom: keyBottom }]}>
        <Key
          onPress={() => fold(onClose)}
          radius={KEY / 2}
          accessibilityLabel="Close"
          faceStyle={styles.keyFace}
        >
          <AddGlyph open color={theme.primaryForeground} size={22} />
        </Key>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingHorizontal: GUTTER,
  },
  dock: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: DOCK,
    borderRadius: DOCK / 2,
    padding: PAD,
  },
  track: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  pill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 999 },
  tab: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: TAB,
    minWidth: TAB,
    paddingHorizontal: 11,
    borderRadius: 999,
  },
  tabActive: { paddingLeft: 12, paddingRight: 15 },
  tabLabel: { ...typeScale.label, fontSize: 13, flexShrink: 1 },
  keyFace: { width: KEY, height: KEY - 2 },
  count: {
    position: 'absolute',
    top: -6,
    right: -9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontSize: 9, fontWeight: '800' },
  dot: {
    position: 'absolute',
    top: -3,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 999,
    borderWidth: 2,
  },
  cardSlot: { position: 'absolute', transformOrigin: 'right bottom' },
  card: {
    height: CARD,
    minWidth: 196,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: 8,
    paddingRight: spacing.lg,
    borderRadius: radius.xxl,
  },
  coin: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keySlot: { position: 'absolute' },
});
