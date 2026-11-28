import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { PressableScale, useReduceMotion } from '@/lib/motion';
import { figure, leaf, LEAF, useTheme } from '@/lib/theme';

/** The card's edge, the same width chosen or not, so choosing never shifts it. */
const EDGE = 1.5;
/** The Recommended tab's height over the edge, and the curves it grows out of the edge on. */
const TAB = 20;
const FEET = 7;
/** Bays drawn on a plan's card; the rest of its room is a figure after them. */
const BAYS_SHOWN = 6;

/**
 * A plan, or a way to pay, as a radio card: white, never tinted (user asked), its edge the only
 * thing that changes — the border colour at rest, copper round the chosen one — with a radio that
 * springs into a copper check and the price turning copper with it. Its head says which (a plan's
 * own badge), the line under it what it holds; on the right what it comes to, with the month it
 * would have cost struck over it when there is one.
 *
 * `tab` grows a word out of the top edge: the edge itself thickens into a tab, on a curve either
 * side. The recommended card's edge and tab stay copper whether it is chosen or not (user asked);
 * its radio and price still say which one is.
 */
export function PlanCard({
  head,
  sub,
  price,
  compare,
  said,
  selected,
  tab,
  onPress,
}: {
  head: ReactNode;
  sub: ReactNode;
  /** What it comes to; null while the store has no price for it. */
  price: { figure: string; unit: string } | null;
  /** The month it would have cost paid monthly, struck over a longer price. */
  compare: string | null;
  said: string;
  selected: boolean;
  /** A word grown out of the card's top edge: Recommended. */
  tab?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [check] = useState(() => new Animated.Value(selected ? 1 : 0));
  // Made once: a new interpolation each render re-attaches its native node.
  const pop = useMemo(
    () => ({
      opacity: check,
      transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
    }),
    [check],
  );
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

  const edge = selected || tab ? theme.primary : theme.border;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${said}${tab ? `, ${tab.toLowerCase()}` : ''}`}
      scaleTo={0.98}
      style={[
        styles.card,
        tab ? styles.tabbed : null,
        { backgroundColor: theme.cardRaised, borderColor: edge },
      ]}
    >
      {tab ? (
        <View pointerEvents="none" style={[styles.tab, { backgroundColor: edge }]}>
          {/* The feet: a square of the edge's colour with the page's circle cut from its outer top. */}
          <View style={[styles.foot, styles.footLeft, { backgroundColor: edge }]}>
            <View style={[styles.cut, styles.cutLeft, { backgroundColor: theme.background }]} />
          </View>
          <View style={[styles.foot, styles.footRight, { backgroundColor: edge }]}>
            <View style={[styles.cut, styles.cutRight, { backgroundColor: theme.background }]} />
          </View>
          <Ionicons name="sparkles" size={10} color={theme.primaryForeground} />
          <Text style={[styles.tabText, { color: theme.primaryForeground }]}>
            {tab.toUpperCase()}
          </Text>
        </View>
      ) : null}

      <View style={[styles.radio, { borderColor: selected ? theme.primary : theme.borderStrong }]}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.radioOn, { backgroundColor: theme.primary }, pop]}
        >
          <Ionicons name="checkmark" size={15} color={theme.primaryForeground} />
        </Animated.View>
      </View>

      <View style={styles.words}>
        {head}
        {sub}
      </View>

      {price ? (
        <View style={styles.price}>
          {compare ? (
            <Text style={[figure, styles.compare, { color: theme.mutedForeground }]}>
              {compare}
            </Text>
          ) : null}
          <Text
            style={[figure, styles.figure, { color: selected ? theme.primary : theme.foreground }]}
          >
            {price.figure}
          </Text>
          <Text style={[styles.unit, { color: theme.mutedForeground }]}>{price.unit}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

/** A card's shape while the store's offers load. */
export function PlanCardGhost() {
  const theme = useTheme();
  return <View style={[styles.card, styles.ghost, { backgroundColor: theme.muted }]} />;
}

/**
 * A plan's room for vehicles as a row of little bays, the garage's own picture: the ones your
 * vehicles take filled in copper, the rest open. Six at most; a figure after them says the rest.
 */
export function Bays({ room, used }: { room: number; used: number }) {
  const theme = useTheme();
  return (
    <View
      style={styles.bays}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: Math.min(room, BAYS_SHOWN) }, (_, index) => (
        <View
          key={index}
          style={[
            styles.bay,
            index < used
              ? { backgroundColor: theme.primary }
              : { borderWidth: 1.25, borderColor: theme.borderStrong },
          ]}
        />
      ))}
      {/* The rest of the room as a figure: six bays, and "+94" for a hundred. */}
      {room > BAYS_SHOWN ? (
        <Text style={[figure, styles.more, { color: theme.mutedForeground }]}>
          +{room - BAYS_SHOWN}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The main cards' leaf (Home's dash, the vehicle cards), as the user asked.
  card: {
    ...leaf('lg'),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 70,
    borderWidth: EDGE,
    paddingLeft: 14,
    paddingRight: 16,
    paddingVertical: 10,
  },
  // Room above for the tab that grows out of its top edge.
  tabbed: { marginTop: TAB },
  ghost: { borderWidth: 0, opacity: 0.6 },
  // Its foot on the edge's outer line, so the edge and the tab are one stroke.
  tab: {
    position: 'absolute',
    top: -(TAB + EDGE),
    // Its left foot on the straight of the edge, clear of the wide corner's curve.
    left: LEAF.lg.wide + FEET - EDGE,
    height: TAB + EDGE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingBottom: EDGE,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
  },
  tabText: { fontSize: 9.5, lineHeight: 12, fontWeight: '800', letterSpacing: 0.7 },
  foot: { position: 'absolute', bottom: EDGE, width: FEET, height: FEET, overflow: 'hidden' },
  footLeft: { left: -FEET },
  footRight: { right: -FEET },
  cut: { position: 'absolute', top: -FEET, width: FEET * 2, height: FEET * 2, borderRadius: FEET },
  cutLeft: { left: -FEET },
  cutRight: { left: 0 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5 },
  // Over the ring as well, so the chosen radio is one copper disc with its check.
  radioOn: {
    top: -1.5,
    right: -1.5,
    bottom: -1.5,
    left: -1.5,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { flex: 1, minWidth: 0, gap: 7 },
  price: { alignItems: 'flex-end' },
  compare: { fontSize: 11, lineHeight: 14, textDecorationLine: 'line-through' },
  figure: { fontSize: 21, lineHeight: 25, fontWeight: '700', letterSpacing: -0.5 },
  unit: { fontSize: 11, lineHeight: 14 },
  bays: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  bay: { width: 8, height: 10, borderRadius: 2.5 },
  more: { fontSize: 11.5, lineHeight: 15, fontWeight: '600', marginLeft: 3 },
});
