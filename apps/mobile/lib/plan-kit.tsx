import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Image,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { PlanPrice, PlanState } from '@vehicle-os/contracts';
import {
  formatPlanPrice,
  limitsFor,
  PLAN_NAMES,
  PLAN_RANK,
  type PlanLimits,
  type PlanTier,
} from '@vehicle-os/domain';
import logoTextLight from '@/assets/logo-text-light.png';
import logoText from '@/assets/logo-text.png';
import type { Tone } from '@/lib/instrument';
import { useReduceMotion } from '@/lib/motion';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';

/*
 * The plan's pieces, as the web draws them (`apps/web/src/components/plan-kit.tsx`): a pass for
 * the plan you hold, bars for rank, a badge for status, a ledger for a change. A tier never gets a
 * colour of its own — ink carries rank, colour is kept for status.
 */

const pad = (value: number) => String(value).padStart(2, '0');

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** A tier's rank as three bars lit up to it, like signal strength. */
export function TierMark({ tier, color }: { tier: PlanTier; color: string }) {
  const rank = PLAN_RANK[tier];
  return (
    <View style={styles.bars} importantForAccessibility="no-hide-descendants">
      {[8, 12, 16].map((height, step) => (
        <View
          key={height}
          style={[styles.bar, { height, backgroundColor: color, opacity: step > rank ? 0.25 : 1 }]}
        />
      ))}
    </View>
  );
}

/** What a plan's state means, once, for every badge that reports it. */
export function planStatus(plan: PlanState): { tone: Tone; label: string; live: boolean } {
  if (plan.status === 'PAST_DUE')
    return { tone: 'destructive', label: 'Payment failed', live: false };
  if (plan.cancelAtPeriodEnd) return { tone: 'warning', label: 'Ending', live: false };
  if (plan.plan === 'FREE') return { tone: 'neutral', label: 'Free', live: false };
  return { tone: 'success', label: 'Active', live: true };
}

/** A status on its own soft tint, with a dot that breathes while it is live. */
export function StatusBadge({
  tone,
  label,
  live = false,
}: {
  tone: Tone;
  label: string;
  live?: boolean;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const ring = useRef(new Animated.Value(0)).current;
  const [soft, strong] =
    tone === 'success'
      ? [theme.successSoft, theme.success]
      : tone === 'warning'
        ? [theme.warningSoft, theme.warning]
        : tone === 'destructive'
          ? [theme.destructiveSoft, theme.destructive]
          : [theme.muted, theme.mutedForeground];

  useEffect(() => {
    if (!live || reduce) return;
    const loop = Animated.loop(
      Animated.timing(ring, { toValue: 1, duration: 2000, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [live, reduce, ring]);

  return (
    <View style={[styles.badge, { backgroundColor: soft }]}>
      <View style={styles.dotBox}>
        {live && !reduce ? (
          <Animated.View
            style={[
              styles.dot,
              StyleSheet.absoluteFill,
              {
                backgroundColor: strong,
                opacity: ring.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.7, 0, 0] }),
                transform: [
                  {
                    scale: ring.interpolate({
                      inputRange: [0, 0.7, 1],
                      outputRange: [1, 2.6, 2.6],
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}
        <View style={[styles.dot, { backgroundColor: strong }]} />
      </View>
      <Text style={[typeScale.caption, { fontWeight: '600', color: strong }]}>{label}</Text>
    </View>
  );
}

/**
 * The plan you hold, as a pass. Paid is ink — the one solid card, the way a paid membership card
 * is the black one — and Free is the outline of the same card. `children` sits along the bottom.
 */
export function PlanPass({
  plan,
  price,
  children,
  style,
}: {
  plan: PlanState;
  price: PlanPrice | null;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const paid = plan.plan !== 'FREE';
  const ink = paid ? theme.primaryForeground : theme.foreground;
  // The wordmark that reads on this surface: an ink pass is light in the dark theme, and dark in the light one.
  const surfaceIsLight = paid ? scheme !== 'light' : scheme === 'light';
  const status = planStatus(plan);
  const reading = price ? formatPlanPrice(price) : null;

  const line = !paid
    ? 'No card · no renewal'
    : !plan.currentPeriodEnd
      ? 'Complimentary'
      : plan.status === 'PAST_DUE'
        ? 'Update the card to keep it'
        : `${plan.cancelAtPeriodEnd ? 'Ends' : 'Renews'} ${shortDate(plan.currentPeriodEnd)}`;

  return (
    <View
      accessible
      accessibilityLabel={`Your plan: ${PLAN_NAMES[plan.plan]}, ${status.label}. ${line}${
        reading ? `. ${reading.amount} per ${reading.per}` : ''
      }`}
      style={[
        styles.pass,
        paid
          ? { backgroundColor: theme.primary, ...styles.passLift }
          : { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.borderStrong },
        style,
      ]}
    >
      {/* The mark's speed lines, thin and faint, running off the edge: the pass's texture. */}
      <View style={styles.lines} pointerEvents="none">
        {[120, 72, 96, 48].map((width) => (
          <View key={width} style={[styles.line, { width, backgroundColor: ink }]} />
        ))}
      </View>

      <View style={styles.passTop}>
        <View style={styles.brand}>
          <Image
            source={surfaceIsLight ? logoText : logoTextLight}
            style={styles.wordmark}
            resizeMode="contain"
          />
          <Text
            style={[typeScale.overline, figure, { color: ink, opacity: 0.7, letterSpacing: 2 }]}
          >
            PASS
          </Text>
        </View>
        <StatusBadge tone={status.tone} label={status.label} live={status.live} />
      </View>

      <View style={styles.passBody}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.passName, { color: ink }]}>{PLAN_NAMES[plan.plan]}</Text>
            <TierMark tier={plan.plan} color={ink} />
          </View>
          <Text
            style={[
              typeScale.caption,
              figure,
              { color: ink, opacity: 0.7, textTransform: 'uppercase' },
            ]}
          >
            {line}
          </Text>
        </View>
        {reading ? (
          <Text style={[figure, { color: ink }]}>
            <Text style={styles.passPrice}>{reading.amount}</Text>
            <Text style={[typeScale.caption, { opacity: 0.7 }]}>/{reading.per}</Text>
          </Text>
        ) : null}
      </View>

      {children ? (
        <View
          style={[
            styles.passFoot,
            { borderTopColor: paid ? theme.primaryEdge : theme.borderStrong },
          ]}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

/** A plan as a small pass, for a from → to strip. */
export function PassChip({ tier }: { tier: PlanTier }) {
  const theme = useTheme();
  const paid = tier !== 'FREE';
  const ink = paid ? theme.primaryForeground : theme.foreground;
  return (
    <View
      style={[
        styles.chip,
        paid
          ? { backgroundColor: theme.primary }
          : { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.borderStrong },
      ]}
    >
      <TierMark tier={tier} color={ink} />
      <Text style={[typeScale.label, { color: ink }]}>{PLAN_NAMES[tier]}</Text>
    </View>
  );
}

const LEDGER: readonly [string, keyof PlanLimits][] = [
  ['Vehicles', 'vehicles'],
  ['Garages', 'garages'],
  ['People per garage', 'members'],
];

/** Every ceiling old → new, with any the account is already over flagged in place. */
export function LimitLedger({
  from,
  to,
  usage,
}: {
  from: PlanTier;
  to: PlanTier;
  usage?: { vehicles: number; garages: number };
}) {
  const theme = useTheme();
  const before = limitsFor(from);
  const after = limitsFor(to);
  return (
    <View style={[styles.ledger, { backgroundColor: theme.card }]}>
      {LEDGER.map(([label, key], index) => {
        const used = key === 'members' ? undefined : usage?.[key];
        const over = used !== undefined && used > after[key];
        return (
          <View
            key={key}
            accessible
            accessibilityLabel={`${label}: ${before[key]} to ${after[key]}${
              over ? `, you have ${used}` : ''
            }`}
            style={[
              styles.ledgerRow,
              index > 0 && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: theme.border,
              },
              over && { backgroundColor: theme.warningSoft },
            ]}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <Text style={[typeScale.body, { color: theme.foreground }]}>{label}</Text>
              {over ? (
                <Text style={[typeScale.caption, { fontWeight: '600', color: theme.warning }]}>
                  You have {pad(used)}
                </Text>
              ) : null}
            </View>
            <Text
              style={[
                typeScale.body,
                figure,
                { color: over ? theme.foreground : theme.mutedForeground },
              ]}
            >
              {pad(before[key])}
            </Text>
            <Ionicons name="arrow-forward" size={14} color={theme.mutedForeground} />
            <Text
              style={[
                typeScale.headline,
                figure,
                {
                  color: over ? theme.warning : theme.foreground,
                  minWidth: 28,
                  textAlign: 'right',
                },
              ]}
            >
              {pad(after[key])}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { width: 4, borderRadius: 999 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dotBox: { width: 6, height: 6 },
  dot: { width: 6, height: 6, borderRadius: 999 },
  pass: { borderRadius: radius.xl + 4, overflow: 'hidden' },
  passLift: {
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  lines: {
    position: 'absolute',
    right: -24,
    top: 26,
    alignItems: 'flex-end',
    gap: 8,
    opacity: 0.12,
  },
  line: { height: 2, borderRadius: 999 },
  passTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: { width: 64, height: 18 },
  passBody: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + 6,
    paddingBottom: spacing.lg,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  passName: { fontSize: 32, lineHeight: 36, fontWeight: '700', letterSpacing: -0.8 },
  passPrice: { fontSize: 22, lineHeight: 26, fontWeight: '700' },
  passFoot: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ledger: { borderRadius: radius.xl, overflow: 'hidden' },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 12,
  },
});
