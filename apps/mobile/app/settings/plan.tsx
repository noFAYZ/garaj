import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PlanState, UserProfile } from '@vehicle-os/contracts';
import {
  ENTITLEMENT_COPY,
  ENTITLEMENTS,
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
  useProfileUpdate,
} from '@/components/settings-kit';
import { Icon, Segmented } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { PlanBadge, PlanTag as Tag, tierLook } from '@/lib/plan-kit';
import {
  CADENCE_LABEL,
  loadOffers,
  openStoreManagement,
  storeAvailable,
  storeBilled,
  storeName,
  webBilled,
} from '@/lib/store';
import { usePlan } from '@/lib/upgrade';
import { useProfile } from '@/lib/vehicle-units';
import { figure, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { Button, Empty, Face, Skeleton } from '@/lib/ui';
import { shortDate } from '@/lib/format';

/** A price as the store shows it, and what it is per. */
interface Reading {
  readonly amount: string;
  readonly per: string;
}

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
 * It never decides a plan changed. Paying happens in the phone's store, and so does changing or
 * cancelling what was bought there; the plan shown is the one the server read back, and this
 * screen asks again whenever the app comes back to the front. A plan billed on the web is shown,
 * never sold or managed here — the store's rules keep the app to its own billing.
 */
export default function PlanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, plan } = usePlan();
  const profile = useProfile();
  const userId = profile.data?.id;
  // The same query the upgrade screen reads, so the prices are already there when it opens.
  const offers = useQuery({
    queryKey: ['store', 'offers', userId],
    queryFn: () => loadOffers(userId!),
    enabled: Boolean(userId) && storeAvailable(),
    staleTime: 10 * 60_000,
  });
  const update = useProfileUpdate();
  // The plan picked; until one is, the one above yours.
  const [picked, setPicked] = useState<PlanTier | null>(null);
  const inStore = storeBilled(data);
  const elsewhere = webBilled(data);
  const store = storeName(data?.store);
  const manage = () => void openStoreManagement(data);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void plan.refetch();
    });
    return () => subscription.remove();
  }, [plan]);

  const current: PlanTier = data?.plan ?? 'FREE';
  const next = PLAN_TIERS.find((tier) => PLAN_RANK[tier] === PLAN_RANK[current] + 1);
  const shown = picked ?? next ?? current;
  // Bought in the store with a period to run out, so there is a subscription to end there.
  const cancellable = Boolean(inStore && current !== 'FREE' && data?.currentPeriodEnd);
  /** A tier's cheapest way to pay, as the store prices it. */
  const priceOf = (tier: PlanTier): Reading | null => {
    const offer = (offers.data ?? []).find((way) => way.tier === tier);
    return offer ? { amount: offer.price, per: CADENCE_LABEL[offer.cadence].short } : null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      {/* Its own header, as the settings root draws one: this page is a pitch, not a form. */}
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={[
          styles.page,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl,
          },
        ]}
      >
        {plan.isError && !data ? (
          <>
            <View style={{ height: 40 }} />
            <Empty title="Couldn't load your plan" description={(plan.error as Error).message} />
            <Button label="Try again" onPress={() => void plan.refetch()} />
          </>
        ) : !data ? (
          <View style={{ gap: spacing.lg, marginTop: 52 }}>
            <Skeleton width="100%" height={150} style={leaf('md')} />
            <Skeleton width="100%" height={250} style={leaf('md')} />
          </View>
        ) : (
          <>
            <Rise index={1}>
              <Hero me={profile.data} plan={data} next={next} />
            </Rise>

            {inStore && data.status === 'PAST_DUE' ? (
              <Notice
                tone="destructive"
                icon="card-outline"
                text="Payment failed"
                action={`Fix in ${store}`}
                busy={false}
                onPress={manage}
              />
            ) : inStore && data.cancelAtPeriodEnd ? (
              <Notice
                tone="warning"
                icon="time-outline"
                text={data.currentPeriodEnd ? `Ends ${shortDate(data.currentPeriodEnd)}` : 'Ending'}
                action={`Renew in ${store}`}
                busy={false}
                onPress={manage}
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
                elsewhere={elsewhere}
                store={store}
                onUpgrade={() => {
                  haptic.selection();
                  router.push({ pathname: '/upgrade', params: { plan: shown } });
                }}
                // The second press is a screen of its own: the change drawn as a diff, then the store.
                onDowngrade={() => {
                  haptic.selection();
                  router.push({ pathname: '/plan-change', params: { to: shown } });
                }}
              />
            </Rise>

            <Group title="Manage" index={4}>
              {inStore ? (
                <Row
                  icon="card-outline"
                  label={`Manage in ${store}`}
                  chevron={false}
                  onPress={manage}
                >
                  <Ionicons name="open-outline" size={15} color={theme.mutedForeground} />
                </Row>
              ) : elsewhere ? (
                // Shown, not linked: the app may not send anyone to another way of paying.
                <Row icon="globe-outline" label="Billed on the Garaj website" chevron={false} />
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
      {/* No title (user asked): the headline names the page. The way back floats beside the
          portrait rather than taking a row of its own. */}
      <View style={[styles.floatingBack, { top: insets.top + spacing.sm }]}>
        <SettingsHeader />
      </View>
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
  const look = tierLook(plan.plan, theme);
  const vehiclesFull = plan.usage.vehicles >= plan.limits.vehicles;
  const garagesFull = plan.usage.garages >= plan.limits.garages;
  return (
    <View style={styles.hero}>
      <View style={styles.portrait}>
        {/* Ringed in the plan's own colour, its badge pinned under the face. */}
        <View style={[styles.ring, { borderColor: look.edge }]}>
          <Face user={me} size={60} />
        </View>
        <View style={[styles.pin, { backgroundColor: theme.background }]}>
          <PlanBadge tier={plan.plan} />
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
  priceOf: (tier: PlanTier) => Reading | null;
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
        const reading = priceOf(tier);
        const tierLimits = limitsFor(tier);
        return (
          <View key={tier}>
            {place > 0 ? <View style={[styles.rule, { backgroundColor: theme.border }]} /> : null}
            <PressableScale
              onPress={() => onPick(tier)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${PLAN_NAMES[tier]}${tier === current ? ', your plan' : ''}${
                tier === 'FREE' ? ', free' : reading ? `, ${reading.amount} ${reading.per}` : ''
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
                  <PlanBadge tier={tier} />
                  {tier === current ? (
                    <Tag label="Current" fill={theme.muted} ink={theme.mutedForeground} />
                  ) : tier === next ? (
                    <Tag label="Recommended" fill={theme.primarySoft} ink={theme.primary} />
                  ) : null}
                </View>
                <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                  {tierLimits.vehicles} vehicles · {tierLimits.garages}{' '}
                  {tierLimits.garages === 1 ? 'garage' : 'garages'}
                </Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={[figure, styles.price, { color: theme.foreground }]}>
                  {tier === 'FREE' ? 'Free' : (reading?.amount ?? '')}
                </Text>
                {reading ? (
                  <Text style={[figure, styles.per, { color: theme.mutedForeground }]}>
                    {' '}
                    {reading.per}
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
            <Ionicons name="checkmark-circle" size={16} color={theme.foreground} />
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
/**
 * The one way to the plan picked: up, as the big copper key with its price on it and the
 * reassurance under it; down, as a plain key that opens the confirm; nothing, when it is yours.
 */
function Way({
  plan,
  shown,
  price,
  cancellable,
  elsewhere,
  store,
  onUpgrade,
  onDowngrade,
}: {
  plan: PlanState;
  shown: PlanTier;
  price: Reading | null;
  cancellable: boolean;
  /** Billed on the web: the app shows it, and leaves changing it to the web. */
  elsewhere: boolean;
  store: string;
  onUpgrade: () => void;
  onDowngrade: () => void;
}) {
  const theme = useTheme();
  const current = plan.plan;
  const reading = price;
  const above = PLAN_RANK[shown] > PLAN_RANK[current];
  if (elsewhere && shown !== current) {
    return (
      <Text style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}>
        Your plan is billed through the Garaj website — change it there.
      </Text>
    );
  }
  // A smaller tier is a press away while paying; Free is not, once already cancelled.
  const below =
    cancellable &&
    PLAN_RANK[shown] < PLAN_RANK[current] &&
    !(shown === 'FREE' && plan.cancelAtPeriodEnd);

  if (above) {
    return (
      <View style={styles.way}>
        <Button
          label={`Upgrade to ${PLAN_NAMES[shown]}${reading ? ` · ${reading.amount} ${reading.per}` : ''}`}
          variant="primary"
          size="md"
          onPress={onUpgrade}
        />
        <View style={styles.reassure}>
          <Ionicons name="lock-closed-outline" size={12} color={theme.mutedForeground} />
          <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
            Renews automatically · cancel anytime in {store}
          </Text>
        </View>
      </View>
    );
  }
  if (below) {
    return (
      <View style={styles.way}>
        <Button label={`Switch to ${PLAN_NAMES[shown]}`} size="md" onPress={onDowngrade} />
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
  page: { paddingHorizontal: spacing.lg, gap: spacing.md },
  floatingBack: { position: 'absolute', left: spacing.lg },

  hero: { alignItems: 'center', gap: 4 },
  portrait: { alignItems: 'center', marginBottom: 14 },
  ring: { borderRadius: 999, borderWidth: 2.5, padding: 2.5 },
  // The page's colour round the badge, so it cuts cleanly into the ring.
  pin: { position: 'absolute', bottom: -13, borderRadius: 999, padding: 3 },
  headline: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  pitch: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  usage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  usageText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  usageRule: { width: StyleSheet.hairlineWidth, height: 14, marginHorizontal: 4 },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    ...leaf('sm'),
  },

  card: { ...leaf('md'), borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: spacing.lg },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 9, height: 9, borderRadius: 4.5 },
  choiceWords: { flex: 1, minWidth: 0, gap: 2 },
  // A narrow phone sends the tag under the name rather than into the price.
  choiceName: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 3,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline' },
  price: { fontSize: 15.5, lineHeight: 20, fontWeight: '700', letterSpacing: -0.3 },
  per: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  includes: {
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  include: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  includeText: { flexShrink: 1, fontSize: 13.5, lineHeight: 18, fontWeight: '500' },

  way: { gap: 6 },
  reassure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  use: { width: 172 },
});
