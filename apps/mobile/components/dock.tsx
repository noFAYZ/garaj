import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { composite } from '@vehicle-os/ui';
import { AddGlyph } from '@/components/add-sheet';
import { Glyph, Icon, type IconName } from '@/lib/instrument';
import { ease, PressableScale, spring, useReduceMotion } from '@/lib/motion';
import { leaf, LEAF, lift, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Key } from '@/lib/ui';

/** One place in a dock. */
export type DockItem = {
  key: string;
  label: string;
  /** From the web's own icon set, so a place wears the same glyph on both. */
  icon: IconName;
  /** Worn where you are: the solid twin of an outlined `icon`. */
  activeIcon?: IconName;
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

/*
 * The slab's geometry. The bar is lower than the key is wide, and over its middle it rises into a
 * round boss that carries the key — the key grows out of the bar rather than sitting on it.
 */
/** The bar: an icon over its name. */
const BAR = 52;
/** The copper key, across. */
const KEY = 58;
/** The lip under the key's face (`Key`'s own). */
const LIP = 2;
/** The bar's material standing round the key. */
const RING = 6;
/** The boss: a circle round the key's centre, the key's radius and the ring. */
const BOSS = KEY / 2 + RING;
/** How far the boss rises above the bar's top edge. */
const RISE = 18;
/** The curve where the bar's edge turns up into the boss. */
const FILLET = 10;
/** The whole slab, boss included. */
const HEIGHT = RISE + BAR;
/** The key's centre, from the slab's top: its top a ring's width under the boss's. */
const KEY_Y = RING + KEY / 2;
/** How far either side of the key the bar's edge starts to rise. */
const REACH = filletReach();
/** Between the two halves of the places: the boss's foot, with air either side. */
const SPACE = 2 * REACH + 8;
/**
 * A place's width when the slab fits its places (the key in the middle): with no pad at the ends,
 * the slab's edge stands as far from a place's icon and name as the bar's top and bottom do.
 */
const SLOT = 62;
/** With the key at the end: its centre from the slab's right edge, clear of the tight corner. */
const KEY_END = REACH + LEAF.md.tight + 4;
// Less than a page's gutter: the vehicle dock's places get the width.
const GUTTER = spacing.md;
/** How far the wash stands in from its slot, and how wide it grows at most. */
const WASH_INSET = 3;
const WASH_MAX = 76;
/** Each end of the wash: as wide as its widest corner, the middle stretched between them. */
const CAP = LEAF.sm.wide;
const NEEDLE = 16;
/** Wider than a phone, the slab stops growing and sits centred. */
const MAX_WIDTH = 520;
/** The bar above the safe area: the slab and the air over it. */
const BAR_HEIGHT = spacing.sm + HEIGHT;

/** How far from the centre the bar's edge starts to turn up into the boss. */
function filletReach(): number {
  const dy = KEY_Y - (RISE - FILLET);
  return Math.sqrt((BOSS + FILLET) ** 2 - dy ** 2);
}

/**
 * The slab's outline at a width: the house leaf (swept top-left and bottom-right, tight elsewhere),
 * and over the key, at `cx` along its top edge, the boss, joined by a fillet either side so the edge
 * flows into it. Drawn rather than composed from views, because a bump has no `borderRadius`.
 */
function outline(width: number, cx: number, top = 0): string {
  const t = top + RISE;
  const bottom = top + HEIGHT;
  const { wide, tight } = LEAF.md;
  const reach = REACH;
  // Where each fillet meets the boss: along the line between their centres, the boss's radius out.
  const dy = KEY_Y - (RISE - FILLET);
  const k = BOSS / (BOSS + FILLET);
  const meetX = reach * k;
  const meetY = top + KEY_Y - dy * k;
  return [
    `M ${wide} ${t}`,
    `L ${cx - reach} ${t}`,
    `A ${FILLET} ${FILLET} 0 0 0 ${cx - meetX} ${meetY}`,
    `A ${BOSS} ${BOSS} 0 0 1 ${cx + meetX} ${meetY}`,
    `A ${FILLET} ${FILLET} 0 0 0 ${cx + reach} ${t}`,
    `L ${width - tight} ${t}`,
    `A ${tight} ${tight} 0 0 1 ${width} ${t + tight}`,
    `L ${width} ${bottom - wide}`,
    `A ${wide} ${wide} 0 0 1 ${width - wide} ${bottom}`,
    `L ${tight} ${bottom}`,
    `A ${tight} ${tight} 0 0 1 0 ${bottom - tight}`,
    `L 0 ${t + wide}`,
    `A ${wide} ${wide} 0 0 1 ${wide} ${t}`,
    'Z',
  ].join(' ');
}

/**
 * What a screen under a dock leaves below its last row: the dock floats, so a page that ends where
 * the screen ends would have its final row underneath it.
 */
export function useDockSpace(): number {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + Math.max(insets.bottom, spacing.sm) + spacing.lg;
}

/**
 * The dock: one floating slab at the foot of the screen in the web's popover material, cut as the
 * house leaf, and the copper key — larger than the bar is tall, standing in a boss the bar rises
 * into, so it reads as grown out of the bar. `keyAt="center"` (the app's few places) fits its
 * places either side of the key; `keyAt="end"` (a vehicle's five sections) runs the width of the
 * screen, the places in a row and the key at the right, where the thumb is.
 *
 * Every place says its name under its icon, always. Where you are sits on a copper wash in the
 * small leaf, a short copper needle on its top edge like a gauge's pointer, and the wash *travels*:
 * its leading edge sets off first and the trailing one follows, so it stretches toward where you
 * are going and gathers itself there. The icon you arrive at pops in, solid and copper.
 *
 * The key is the web's `.key` — a lit top edge, a lip under it, a face that sinks onto the lip —
 * made round, with light falling across its face and a bezel ring like a dial's. Pressed, it deals
 * what you can add as a hand of cards above it and becomes their ×. Held, it goes straight to the
 * camera. With no `actions`, a press opens the sheet directly.
 *
 * Both docks in the app are this one — the app's places and a vehicle's sections.
 */
export function Dock({
  items,
  activeKey,
  onSelect,
  add,
  actions,
  keyAt = 'center',
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
  /** Where the key stands: between the places, or after them at the right. */
  keyAt?: 'center' | 'end';
  /** The sheet the key opens: a sibling of the dock, so it covers the page rather than sits in it. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const { width: screenWidth } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [left] = useState(() => new Animated.Value(0));
  const [right] = useState(() => new Animated.Value(0));
  const [arrive] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const [fanned, setFanned] = useState(false);
  const placed = useRef<number | null>(null);
  const bottom = Math.max(insets.bottom, spacing.sm);

  const centred = keyAt === 'center';
  // The key's centre along the slab.
  const keyX = centred ? width / 2 : width - KEY_END;
  // Centred, the halves either side of it: the first holds the extra place when there is an odd
  // number. At the end, one row up to the boss's foot.
  const split = centred ? Math.ceil(items.length / 2) : items.length;
  const halves = [items.slice(0, split), items.slice(split)] as const;
  // No pad at the slab's ends: the air beside the places matches the air above and below them.
  const half = Math.max(0, (width - SPACE) / 2);
  const row = Math.max(0, keyX - REACH - 4);
  const index = items.findIndex((item) => item.key === activeKey);

  /** The active place's wash, from the slab's width rather than measured: the slots are equal. */
  const washAt = (at: number): [number, number] => {
    let slot: number;
    let x: number;
    if (centred) {
      const first = at < split;
      slot = half / Math.max(1, first ? halves[0].length : halves[1].length);
      x = first ? at * slot : half + SPACE + (at - split) * slot;
    } else {
      slot = row / Math.max(1, items.length);
      x = at * slot;
    }
    const span = Math.min(slot - WASH_INSET * 2, WASH_MAX);
    const l = x + (slot - span) / 2;
    return [l, l + span];
  };

  // The slab rises into place once, when its screen first appears.
  useEffect(() => {
    if (reduce) return;
    Animated.spring(arrive, {
      toValue: 1,
      delay: 0,
      useNativeDriver: true,
      speed: 4,
      bounciness: 5,
    }).start();
  }, [arrive, reduce]);

  /*
   * The wash's two edges, each on its own spring: whichever edge faces the way it is going leads,
   * the other lags, so the wash stretches across — over the key, between the halves — and settles.
   */
  useEffect(() => {
    if (width === 0 || index < 0) return;
    const [l, r] = washAt(index);
    const from = placed.current;
    placed.current = index;
    if (reduce || from === null) {
      left.setValue(l);
      right.setValue(r);
      return;
    }
    const goingRight = index > from;
    // The UI thread's, so the wash still travels while the JS thread mounts the screen it leads to.
    const lead = { useNativeDriver: true, speed: 14, bounciness: 4 } as const;
    const lag = { useNativeDriver: true, speed: 2, bounciness: 6 } as const;
    const settle = Animated.parallel([
      Animated.spring(left, { toValue: l, ...(goingRight ? lag : lead) }),
      Animated.spring(right, { toValue: r, ...(goingRight ? lead : lag) }),
    ]);
    settle.start();
    return () => settle.stop();
    // `washAt` reads only the slab's width, the layout and the places' count, all listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, width, centred, items.length, reduce, left, right]);

  /*
   * The wash from its two edges, in transforms only, which the native driver can move (`left` and
   * `width` are layout, and kept it on the JS thread). A view stretched by `scaleX` would stretch
   * its corners too, so each end is its own cap with the leaf's corners, and only the plain middle
   * is stretched: one point wide, scaled about its centre to span from cap to cap. Made once, so a
   * re-render mid-travel does not re-attach the native nodes.
   */
  const wash = useMemo(() => {
    const mid = Animated.multiply(Animated.add(left, right), 0.5);
    return {
      start: { transform: [{ translateX: left }] },
      end: { transform: [{ translateX: Animated.subtract(right, CAP) }] },
      middle: {
        transform: [
          { translateX: Animated.subtract(mid, 0.5) },
          {
            scaleX: Animated.subtract(right, left).interpolate({
              inputRange: [CAP, CAP + 1],
              outputRange: [0, 1],
              extrapolateLeft: 'clamp',
            }),
          },
        ],
      },
      needle: { transform: [{ translateX: Animated.subtract(mid, NEEDLE / 2) }] },
    };
  }, [left, right]);
  // Opaque (the soft copper over the slab), so where the pieces overlap there is no seam.
  const washFill = composite(theme.primarySoft, theme.popover);

  const pressKey = () => {
    if (actions && actions.length > 0) setFanned(true);
    else add.onPress();
  };

  const place = (item: DockItem) => {
    const focused = item.key === activeKey;
    return (
      <PressableScale
        key={item.key}
        onPress={() => {
          if (focused) return;
          onSelect(item.key);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={item.a11yLabel ?? item.label}
        scaleTo={0.9}
        style={styles.tab}
      >
        <TabIcon item={item} focused={focused} />
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          allowFontScaling={false}
          style={[
            styles.tabLabel,
            focused
              ? { color: theme.foreground, fontWeight: '700' }
              : { color: theme.mutedForeground },
          ]}
        >
          {item.label}
        </Text>
      </PressableScale>
    );
  };

  return (
    <View
      // Nothing is drawn around the slab, so a tap there belongs to the page behind.
      pointerEvents="box-none"
      style={[styles.bar, { paddingBottom: bottom }]}
    >
      <Animated.View
        pointerEvents="box-none"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={[
          styles.slab,
          // Centred, the slab is as wide as its places and the key; at the end, the screen's width.
          centred
            ? { width: items.length * SLOT + SPACE, maxWidth: '100%' }
            : { width: '100%', maxWidth: MAX_WIDTH },
          {
            transform: [
              { translateY: arrive.interpolate({ inputRange: [0, 1], outputRange: [110, 0] }) },
            ],
          },
        ]}
      >
        {/*
         * The bar's shadow, cast by a plain view of its shape — a view with no fill of its own casts
         * none on Android — and the outline drawn over it, boss and all.
         */}
        <View style={[styles.cast, { backgroundColor: theme.popover }, lift(theme)]} />
        {/*
         * Everything drawn on the slab, raised over the shadow's view. Android stacks siblings by
         * elevation before order: under the caster's, the bar, the places and the key were all
         * painted over by a plain white bar. No fill, so this casts nothing itself.
         */}
        <View pointerEvents="box-none" style={styles.face}>
          {width > 0 ? (
            <Svg
              width={width}
              height={HEIGHT + 1}
              style={styles.ground}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Path
                d={outline(width, keyX)}
                fill={theme.popover}
                stroke={theme.dark ? theme.rim : theme.hairline}
                strokeWidth={1}
              />
              {/* A copper glow in the boss, round the key: where it came out of the bar. */}
              <Circle cx={keyX} cy={KEY_Y} r={KEY / 2 + 3} fill={theme.primary} opacity={0.14} />
            </Svg>
          ) : null}

          {/* The places, in the bar under the boss's shoulders. */}
          <View
            style={[styles.track, centred ? null : { right: width - keyX + REACH + 4 }]}
            accessibilityRole="tablist"
          >
            {width > 0 && index >= 0 ? (
              <>
                <Animated.View
                  pointerEvents="none"
                  style={[styles.washMiddle, { backgroundColor: washFill }, wash.middle]}
                />
                <Animated.View
                  pointerEvents="none"
                  style={[styles.washStart, { backgroundColor: washFill }, wash.start]}
                />
                <Animated.View
                  pointerEvents="none"
                  style={[styles.washEnd, { backgroundColor: washFill }, wash.end]}
                />
                <Animated.View
                  pointerEvents="none"
                  style={[styles.needle, { backgroundColor: theme.primary }, wash.needle]}
                />
              </>
            ) : null}
            {centred ? (
              <>
                <View style={styles.half}>{halves[0].map(place)}</View>
                <View style={{ width: SPACE }} />
                <View style={styles.half}>{halves[1].map(place)}</View>
              </>
            ) : (
              items.map(place)
            )}
          </View>

          <View
            pointerEvents="box-none"
            style={centred ? styles.keyCentre : [styles.keyEnd, { left: keyX - KEY / 2 }]}
          >
            <Key
              onPress={pressKey}
              onLongPress={add.onLongPress}
              delayLongPress={100}
              radius={KEY / 2}
              accessibilityLabel={add.a11yLabel}
              accessibilityHint="Hold to take a photo"
              accessibilityState={{ expanded: add.open || fanned }}
              faceStyle={styles.keyFace}
            >
              <KeyFace open={add.open || fanned} />
            </Key>
          </View>
        </View>
      </Animated.View>

      {fanned && actions ? (
        <Fan
          actions={actions}
          keyBottom={bottom + HEIGHT - (RING + KEY)}
          keyX={(screenWidth - width) / 2 + keyX}
          centred={centred}
          onClose={() => setFanned(false)}
          onPick={(action) => {
            setFanned(false);
            action.onPress();
          }}
        />
      ) : null}

      {children}
    </View>
  );
}

/**
 * The key's face: light falling across the copper from above, a bezel ring a little in from its
 * edge like a dial's, and the + (× while what it opened is open).
 */
function KeyFace({ open }: { open: boolean }) {
  const theme = useTheme();
  const tall = KEY - LIP;
  return (
    <>
      <Svg
        width={KEY}
        height={tall}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Defs>
          <LinearGradient id="dockKeyLight" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={theme.dark ? 0.24 : 0.32} />
            <Stop offset="0.6" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Circle cx={KEY / 2} cy={tall / 2} r={tall / 2} fill="url(#dockKeyLight)" />
        <Circle
          cx={KEY / 2}
          cy={tall / 2}
          r={tall / 2 - 7}
          fill="none"
          stroke={theme.primaryForeground}
          strokeOpacity={0.2}
          strokeWidth={1.25}
        />
      </Svg>
      <AddGlyph open={open} color={theme.primaryForeground} size={26} />
    </>
  );
}

/**
 * A place's icon from the web's set: muted when you are elsewhere, copper and popped in when you
 * arrive, and solid there where the place has a solid twin.
 */
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
      <Icon
        name={focused ? (item.activeIcon ?? item.icon) : item.icon}
        size={22}
        color={focused ? theme.primary : theme.mutedForeground}
      />
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
/** Room round a card in its slot for its shadow: a hardware layer clips to its view's bounds. */
const CARD_PAD = 28;

/**
 * The hand the key deals: each card flies out of the key and lands in a stack above it, nearest
 * first, each turned a little, alternately, like cards dealt from the middle. The page dims behind
 * them, and the key stays where it was, as their ×.
 *
 * Positioned from the dock's own geometry rather than measured on screen, so a modal that starts
 * its own window under the status bar and one that does not land the hand in the same place.
 */
function Fan({
  actions,
  keyBottom,
  keyX,
  centred,
  onClose,
  onPick,
}: {
  actions: readonly DockAction[];
  /** The key's distance from the bottom of the screen. */
  keyBottom: number;
  /** The key's centre, from the screen's left. */
  keyX: number;
  /** Dealt straight up from a key in the middle; held from the right over one at the end. */
  centred: boolean;
  onClose: () => void;
  onPick: (action: DockAction) => void;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const { width: screenWidth } = useWindowDimensions();
  const [dim] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const [deal] = useState(() => actions.map(() => new Animated.Value(reduce ? 1 : 0)));
  const closing = useRef(false);
  const base = keyBottom + KEY + spacing.md;

  /*
   * Dealt once the modal's window is up, not on mount: a slow phone takes a few frames to open
   * that window, and a deal started on mount was half over (or done) before anything showed.
   */
  const dealIn = () => {
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
  };

  // Each card's flight, made once: a re-render mid-deal would re-attach its native nodes.
  const flight = useMemo(
    () =>
      deal.map((progress, index) => {
        // From the key's centre to where this card lands.
        const rise = base - keyBottom - KEY / 2 + index * (CARD + CARD_GAP) + CARD / 2;
        const turn = centred ? (index % 2 === 0 ? -1 : 1) * (1 + index * 0.5) : -(index + 1) * 1.6;
        return {
          opacity: progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
            {
              rotate: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [`${(index % 2 === 0 ? 1 : -1) * 14}deg`, `${turn}deg`],
              }),
            },
          ],
        };
      }),
    [deal, base, keyBottom, centred],
  );

  /** Every card back into the key at once, then the hand is gone. Once: a second tap is ignored. */
  const fold = (then: () => void) => {
    if (closing.current) return;
    closing.current = true;
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
    // Under the status and navigation bars too, so the dim covers the whole screen and the hand's
    // `bottom` is measured from the same edge as the dock's.
    <Modal
      visible
      transparent
      animationType="none"
      onShow={dealIn}
      onRequestClose={() => fold(onClose)}
      statusBarTranslucent
      navigationBarTranslucent
    >
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
        // Held from the right: the card's right edge, where it turns from.
        const right = screenWidth - keyX - KEY / 2 + index * 5;
        return (
          <Animated.View
            key={action.key}
            pointerEvents="box-none"
            /*
             * Drawn once into a texture that the flight only moves, scales and turns. Otherwise
             * Android redraws every card each frame at its new size, emoji paths and all, which is
             * what a slow phone could not keep up with. iOS composites layers like this already.
             */
            renderToHardwareTextureAndroid
            style={[
              styles.cardSlot,
              centred
                ? styles.cardCentre
                : {
                    right: right - CARD_PAD,
                    paddingRight: CARD_PAD,
                    alignItems: 'flex-end',
                    // The card's bottom-right corner, inside the slot's room for the shadow.
                    transformOrigin: [screenWidth - right, CARD_PAD + CARD, 0],
                  },
              { bottom: base + index * (CARD + CARD_GAP) - CARD_PAD },
              flight[index],
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
      <View style={[styles.fanKey, { left: keyX - KEY / 2, bottom: keyBottom }]}>
        <Key
          onPress={() => fold(onClose)}
          radius={KEY / 2}
          accessibilityLabel="Close"
          faceStyle={styles.keyFace}
        >
          <KeyFace open />
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
  slab: { height: HEIGHT },
  ground: { position: 'absolute', top: 0, left: 0 },
  cast: { position: 'absolute', top: RISE, left: 0, right: 0, height: BAR, ...leaf('md') },
  // Over the caster's elevation (`lift`'s 12), so Android draws the slab's face on top of it.
  face: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, elevation: 13 },
  // The bar's own band, under the boss: where the places sit.
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: RISE,
    height: BAR,
    flexDirection: 'row',
    alignItems: 'center',
  },
  half: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  washMiddle: { position: 'absolute', top: 3, bottom: 3, left: 0, width: 1 },
  washStart: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 0,
    width: CAP,
    borderTopLeftRadius: LEAF.sm.wide,
    borderBottomLeftRadius: LEAF.sm.tight,
    borderCurve: 'continuous',
  },
  washEnd: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 0,
    width: CAP,
    borderTopRightRadius: LEAF.sm.tight,
    borderBottomRightRadius: LEAF.sm.wide,
    borderCurve: 'continuous',
  },
  // The pointer on the wash's top edge: where you are, read like a gauge.
  needle: {
    position: 'absolute',
    top: 3,
    left: 0,
    width: NEEDLE,
    height: 3,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    height: BAR,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    // A little low in the bar, so the needle over the wash has air above the icon.
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  tabLabel: { ...typeScale.caption, fontSize: 10.5, lineHeight: 13, fontWeight: '600' },
  keyCentre: { position: 'absolute', top: RING, left: 0, right: 0, alignItems: 'center' },
  keyEnd: { position: 'absolute', top: RING },
  keyFace: { width: KEY, height: KEY - LIP, alignItems: 'center', justifyContent: 'center' },
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
  cardSlot: { position: 'absolute', left: 0, paddingVertical: CARD_PAD },
  cardCentre: { right: 0, alignItems: 'center' },
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
  fanKey: { position: 'absolute' },
});
