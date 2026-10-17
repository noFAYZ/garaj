import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@vehicle-os/api-client';
import { pricesQuery, queryKeys } from '@vehicle-os/api-client/react';
import type { PlanPrice, PlanState, UserProfile } from '@vehicle-os/contracts';
import {
  ENTITLEMENT_COPY,
  ENTITLEMENTS,
  formatPlanPrice,
  hasEntitlement,
  limitsFor,
  PLAN_NAMES,
  PLAN_RANK,
  PLAN_TIERS,
  type PlanTier,
} from '@vehicle-os/domain';
import {
  Group,
  groupSurface,
  Row,
  SettingsHeader,
  SettingsWash,
  useProfileUpdate,
} from '@/components/settings-kit';
import { api } from '@/lib/api';
import { Icon, Segmented } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { TierMark } from '@/lib/plan-kit';
import { BILLING_RETURN, usePlan } from '@/lib/upgrade';
import { useProfile } from '@/lib/vehicle-units';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Empty, Face, Skeleton } from '@/lib/ui';

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Why each plan, in one line: what it gives that the one below does not. */
const PITCH: Record<PlanTier, string> = {
  FREE: 'A full history for up to three vehicles.',
  PLUS: 'Room for six vehicles and three garages, and a passport to share each one.',
  BUSINESS: 'Income, mileage reports and drivers — your garage, run as a business.',
};

/**
 * The plan, as the page that sells the next one. You lead — your face with the plan you hold
 * pinned to it, and how full it is — under the one line that matters: what the next plan is and
 * what it gives. The plans sit in one card as choices, the next one picked and marked, what the
 * picked one includes listed under them (what it adds to yours marked new); then one big way to
 * it, with the reassurance beside it. Running the plan you have — billing, use, cancelling —
 * waits quietly below, in the settings' own rows.
 *
 * It never decides a plan changed. Paying happens in the browser; going down happens on its own
 * confirm screen; either way the plan shown is the one the server read back from the provider, and
 * this screen asks again whenever the app comes back to the front.
 */
export default function PlanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, plan } = usePlan();
  const prices = useQuery(pricesQuery(api));
  const profile = useProfile();
  const update = useProfileUpdate();
  const queryClient = useQueryClient();
  // The plan picked; until one is, the one above yours.
  const [picked, setPicked] = useState<PlanTier | null>(null);

  const onChanged = () => {
    haptic.success();
    return queryClient.invalidateQueries({ queryKey: queryKeys.plan() });
  };
  const failed = (error: unknown) =>
    Alert.alert('Your plan was not changed', error instanceof Error ? error.message : undefined);

  const resume = useMutation({
    mutationFn: () => api.billing.resume(),
    onSuccess: onChanged,
    onError: failed,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void plan.refetch();
    });
    return () => subscription.remove();
  }, [plan]);

  const portal = useMutation({
    mutationFn: async () => {
      const { url } = await api.billing.portal({ returnPath: BILLING_RETURN });
      await Linking.openURL(url);
    },
    onError: (error) =>
      Alert.alert(
        'Could not open billing',
        error instanceof ApiError && error.code === 'NO_BILLING'
          ? 'Billing is not switched on yet.'
          : error instanceof Error
            ? error.message
            : undefined,
      ),
  });

  const current: PlanTier = data?.plan ?? 'FREE';
  const next = PLAN_TIERS.find((tier) => PLAN_RANK[tier] === PLAN_RANK[current] + 1);
  const shown = picked ?? next ?? current;
  const hasBilling = Boolean(data && (data.plan !== 'FREE' || data.currentPeriodEnd));
  // Paid through the provider, so there is a subscription to end. A comped plan has no period.
  const cancellable = Boolean(data && current !== 'FREE' && data.currentPeriodEnd);
  const priceOf = (tier: PlanTier) => (tier === 'FREE' ? null : (prices.data?.[tier] ?? null));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Its own header, as the settings root draws one: this page is a pitch, not a form. */}
      <Stack.Screen options={{ headerShown: false }} />
      <SettingsWash />
      <ScrollView
        contentContainerStyle={[
          styles.page,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl,
          },
        ]}
      >
        <SettingsHeader title="Plan" />

        {plan.isError && !data ? (
          <>
            <Empty title="Couldn't load your plan" description={(plan.error as Error).message} />
            <Button label="Try again" onPress={() => void plan.refetch()} />
          </>
        ) : !data ? (
          <View style={{ gap: spacing.lg }}>
            <Skeleton width="100%" height={210} radius={radius.xxl} />
            <Skeleton width="100%" height={300} radius={radius.xxl} />
          </View>
        ) : (
          <>
            <Rise index={1}>
              <Hero me={profile.data} plan={data} next={next} />
            </Rise>

            {data.status === 'PAST_DUE' ? (
              <Notice
                tone="destructive"
                icon="card-outline"
                text="Payment failed"
                action="Update card"
                busy={portal.isPending}
                onPress={() => portal.mutate()}
              />
            ) : data.cancelAtPeriodEnd ? (
              <Notice
                tone="warning"
                icon="time-outline"
                text={data.currentPeriodEnd ? `Ends ${shortDate(data.currentPeriodEnd)}` : 'Ending'}
                action={`Keep ${PLAN_NAMES[current]}`}
                busy={resume.isPending}
                onPress={() => resume.mutate()}
              />
            ) : null}

            <Rise index={2}>
              <Choices
                current={current}
                next={next}
                shown={shown}
                priceOf={priceOf}
                onPick={(tier) => {
                  haptic.selection();
                  setPicked(tier);
                }}
              />
            </Rise>

            <Rise index={3}>
              <Way
                plan={data}
                shown={shown}
                price={priceOf(shown)}
                cancellable={cancellable}
                onUpgrade={() => {
                  haptic.selection();
                  router.push({ pathname: '/upgrade', params: { plan: shown } });
                }}
                // The second press is a screen of its own: the change drawn as a diff, not an alert.
                onDowngrade={() => {
                  haptic.selection();
                  router.push({ pathname: '/plan-change', params: { to: shown } });
                }}
              />
            </Rise>

            <Group title="Manage" index={4}>
              {hasBilling ? (
                <Row
                  icon="card-outline"
                  label="Billing"
                  chevron={false}
                  onPress={() => portal.mutate()}
                >
                  {portal.isPending ? (
                    <ActivityIndicator size="small" color={theme.mutedForeground} />
                  ) : (
                    <Ionicons name="open-outline" size={15} color={theme.mutedForeground} />
                  )}
                </Row>
              ) : null}
              <Row icon="briefcase-outline" label="Use">
                <View style={styles.use}>
                  <Segmented
                    small
                    value={data.accountKind}
                    options={[
                      { value: 'PERSONAL', label: 'Personal' },
                      {
                        value: 'BUSINESS',
                        label: 'Business',
                        said: 'Business: trips, income, drivers',
                      },
                    ]}
                    onChange={(accountKind) => update.mutate({ accountKind })}
                  />
                </View>
              </Row>
              <Row
                icon="refresh-outline"
                label="Check again"
                chevron={false}
                onPress={() => void plan.refetch()}
              >
                {plan.isFetching ? (
                  <ActivityIndicator size="small" color={theme.mutedForeground} />
                ) : null}
              </Row>
              {cancellable && !data.cancelAtPeriodEnd ? (
                <Row
                  icon="close-circle-outline"
                  label={`Cancel ${PLAN_NAMES[current]}`}
                  destructive
                  chevron={false}
                  onPress={() => {
                    haptic.selection();
                    router.push({ pathname: '/plan-change', params: { to: 'FREE' } });
                  }}
                />
              ) : null}
            </Group>
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * You, and the one line that matters: your face ringed in copper with the plan you hold pinned
 * under it, the headline — the plan above yours, or that you are at the top — its pitch, and how
 * full what you have is, amber where it is full: the reason to read on.
 */
function Hero({
  me,
  plan,
  next,
}: {
  me: UserProfile | undefined;
  plan: PlanState;
  next: PlanTier | undefined;
}) {
  const theme = useTheme();
  const paid = plan.plan !== 'FREE';
  const vehiclesFull = plan.usage.vehicles >= plan.limits.vehicles;
  const garagesFull = plan.usage.garages >= plan.limits.garages;
  return (
    <View style={styles.hero}>
      <View style={styles.portrait}>
        <View style={[styles.ring, { borderColor: paid ? theme.primary : theme.border }]}>
          <Face user={me} size={84} />
        </View>
        <View
          style={[
            styles.pin,
            {
              backgroundColor: paid ? theme.primary : theme.cardRaised,
              borderColor: theme.background,
            },
          ]}
        >
          <TierMark tier={plan.plan} color={paid ? theme.primaryForeground : theme.foreground} />
          <Text
            style={[
              figure,
              styles.pinText,
              { color: paid ? theme.primaryForeground : theme.foreground },
            ]}
          >
            {PLAN_NAMES[plan.plan].toUpperCase()}
          </Text>
        </View>
      </View>

      <Text accessibilityRole="header" style={[styles.headline, { color: theme.foreground }]}>
        {next ? `Upgrade to ${PLAN_NAMES[next]}` : `You’re on ${PLAN_NAMES[plan.plan]}`}
      </Text>
      <Text style={[styles.pitch, { color: theme.mutedForeground }]}>
        {next ? PITCH[next] : 'Everything Garaj does, for every vehicle.'}
      </Text>

      <View
        accessible
        accessibilityLabel={`Using ${plan.usage.vehicles} of ${plan.limits.vehicles} vehicles and ${plan.usage.garages} of ${plan.limits.garages} garages`}
        style={[styles.usage, groupSurface(theme)]}
      >
        <Ionicons name="car-sport-outline" size={15} color={theme.mutedForeground} />
        <Text
          style={[
            figure,
            styles.usageText,
            { color: vehiclesFull ? theme.warning : theme.foreground },
          ]}
        >
          {plan.usage.vehicles}/{plan.limits.vehicles}
        </Text>
        <View style={[styles.usageRule, { backgroundColor: theme.border }]} />
        <Icon name="garage" size={15} color={theme.mutedForeground} />
        <Text
          style={[
            figure,
            styles.usageText,
            { color: garagesFull ? theme.warning : theme.foreground },
          ]}
        >
          {plan.usage.garages}/{plan.limits.garages}
        </Text>
      </View>
    </View>
  );
}

/**
 * The plans as choices on one card: each a row with its radio, its name, what it holds and its
 * price — yours marked current, the next one up recommended — and under them what the picked one
 * includes, a tick for each, new against yours where it adds.
 */
function Choices({
  current,
  next,
  shown,
  priceOf,
  onPick,
}: {
  current: PlanTier;
  next: PlanTier | undefined;
  shown: PlanTier;
  priceOf: (tier: PlanTier) => PlanPrice | null;
  onPick: (tier: PlanTier) => void;
}) {
  const theme = useTheme();
  const limits = limitsFor(shown);
  const includes = [
    {
      key: 'room',
      text: `${limits.vehicles} vehicles · ${limits.garages} ${limits.garages === 1 ? 'garage' : 'garages'}`,
      added: limits.vehicles > limitsFor(current).vehicles,
    },
    {
      key: 'people',
      text: `${limits.members} people per garage`,
      added: limits.members > limitsFor(current).members,
    },
    ...ENTITLEMENTS.filter((entitlement) => hasEntitlement(shown, entitlement)).map(
      (entitlement) => ({
        key: entitlement,
        text: ENTITLEMENT_COPY[entitlement].name,
        added: !hasEntitlement(current, entitlement),
      }),
    ),
  ];

  return (
    <View style={[styles.card, groupSurface(theme)]}>
      {PLAN_TIERS.map((tier, place) => {
        const on = tier === shown;
        const price = priceOf(tier);
        const reading = price ? formatPlanPrice(price) : null;
        const tierLimits = limitsFor(tier);
        return (
          <View key={tier}>
            {place > 0 ? <View style={[styles.rule, { backgroundColor: theme.border }]} /> : null}
            <PressableScale
              onPress={() => onPick(tier)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${PLAN_NAMES[tier]}${tier === current ? ', your plan' : ''}${
                reading ? `, ${reading.amount} per ${reading.per}` : ', free'
              }`}
              scaleTo={0.99}
              style={[styles.choice, on ? { backgroundColor: theme.primarySoft } : null]}
            >
              <View
                style={[styles.radio, { borderColor: on ? theme.primary : theme.borderStrong }]}
              >
                {on ? <View style={[styles.radioDot, { backgroundColor: theme.primary }]} /> : null}
              </View>
              <View style={styles.choiceWords}>
                <View style={styles.choiceName}>
                  <Text style={[styles.choiceTitle, { color: theme.foreground }]}>
                    {PLAN_NAMES[tier]}
                  </Text>
                  {tier === current ? (
                    <Tag label="Current" fill={theme.muted} ink={theme.mutedForeground} />
                  ) : tier === next ? (
                    <Tag label="Recommended" fill={theme.primary} ink={theme.primaryForeground} />
                  ) : null}
                </View>
                <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                  {tierLimits.vehicles} vehicles · {tierLimits.garages}{' '}
                  {tierLimits.garages === 1 ? 'garage' : 'garages'}
                </Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={[figure, styles.price, { color: theme.foreground }]}>
                  {reading ? reading.amount : 'Free'}
                </Text>
                {reading ? (
                  <Text style={[figure, styles.per, { color: theme.mutedForeground }]}>
                    /{reading.per}
                  </Text>
                ) : null}
              </View>
            </PressableScale>
          </View>
        );
      })}

      <View style={[styles.includes, { borderTopColor: theme.border }]}>
        {includes.map((item) => (
          <View
            key={item.key}
            accessible
            accessibilityLabel={`${item.text}${item.added ? ', more than you have now' : ''}`}
            style={styles.include}
          >
            <Ionicons name="checkmark-circle" size={18} color={theme.foreground} />
            <Text style={[styles.includeText, { color: theme.foreground }]}>{item.text}</Text>
            {item.added && shown !== current ? (
              <Tag label="New" fill={theme.primarySoft} ink={theme.primary} />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/** A small tag in a row: Current, Recommended, New. */
function Tag({ label, fill, ink }: { label: string; fill: string; ink: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: fill }]}>
      <Text style={[styles.tagText, { color: ink }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

/**
 * The one way to the plan picked: up, as the big copper key with its price on it and the
 * reassurance under it; down, as a plain key that opens the confirm; nothing, when it is yours.
 */
function Way({
  plan,
  shown,
  price,
  cancellable,
  onUpgrade,
  onDowngrade,
}: {
  plan: PlanState;
  shown: PlanTier;
  price: PlanPrice | null;
  cancellable: boolean;
  onUpgrade: () => void;
  onDowngrade: () => void;
}) {
  const theme = useTheme();
  const current = plan.plan;
  const reading = price ? formatPlanPrice(price) : null;
  const above = PLAN_RANK[shown] > PLAN_RANK[current];
  // A smaller tier is a press away while paying; Free is not, once already cancelled.
  const below =
    cancellable &&
    PLAN_RANK[shown] < PLAN_RANK[current] &&
    !(shown === 'FREE' && plan.cancelAtPeriodEnd);

  if (above) {
    return (
      <View style={styles.way}>
        <Button
          label={`Upgrade to ${PLAN_NAMES[shown]}${reading ? ` · ${reading.amount}/${reading.per}` : ''}`}
          variant="primary"
          size="lg"
          onPress={onUpgrade}
        />
        <View style={styles.reassure}>
          <Ionicons name="lock-closed-outline" size={12} color={theme.mutedForeground} />
          <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
            Paid securely in the browser · cancel anytime
          </Text>
        </View>
      </View>
    );
  }
  if (below) {
    return (
      <View style={styles.way}>
        <Button label={`Switch to ${PLAN_NAMES[shown]}`} size="lg" onPress={onDowngrade} />
        <Text style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}>
          {PLAN_NAMES[current]} stays until the end of the period.
        </Text>
      </View>
    );
  }
  return null;
}

/** Something about the plan that needs doing, with its one way out. */
function Notice({
  tone,
  icon,
  text,
  action,
  busy,
  onPress,
}: {
  tone: 'destructive' | 'warning';
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  action: string;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: tone === 'destructive' ? theme.destructiveSoft : theme.warningSoft },
      ]}
    >
      <Ionicons name={icon} size={17} color={theme[tone]} />
      <Text style={[typeScale.label, { flex: 1, color: theme.foreground }]}>{text}</Text>
      <Button
        label={action}
        size="sm"
        variant={tone === 'destructive' ? 'danger' : 'secondary'}
        loading={busy}
        onPress={onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, gap: spacing.lg + 2 },

  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  portrait: { alignItems: 'center', marginBottom: spacing.md },
  ring: { borderRadius: 999, borderWidth: 3, padding: 3 },
  pin: {
    position: 'absolute',
    bottom: -12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    borderRadius: 999,
    borderWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pinText: { fontSize: 10.5, lineHeight: 14, fontWeight: '700', letterSpacing: 1.2 },
  headline: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.7,
    textAlign: 'center',
  },
  pitch: {
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  usage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  usageText: { fontSize: 13, lineHeight: 17, fontWeight: '700' },
  usageRule: { width: StyleSheet.hairlineWidth, height: 14, marginHorizontal: 4 },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.xl,
  },

  card: { borderRadius: radius.xxl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: spacing.lg },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  choiceWords: { flex: 1, minWidth: 0, gap: 2 },
  // A narrow phone sends the tag under the name rather than into the price.
  choiceName: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 3,
  },
  choiceTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline' },
  price: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3 },
  per: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  includes: {
    gap: 12,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  include: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  includeText: { flexShrink: 1, fontSize: 14.5, lineHeight: 20, fontWeight: '500' },
  tag: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  tagText: { fontSize: 9.5, lineHeight: 13, fontWeight: '700', letterSpacing: 0.8 },

  way: { gap: 10 },
  reassure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  use: { width: 172 },
});
