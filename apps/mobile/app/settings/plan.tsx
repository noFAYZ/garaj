import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@vehicle-os/api-client';
import { pricesQuery, queryKeys } from '@vehicle-os/api-client/react';
import {
  ENTITLEMENT_COPY,
  ENTITLEMENTS,
  hasEntitlement,
  limitsFor,
  PLAN_NAMES,
  PLAN_RANK,
  PLAN_TIERS,
  tierForEntitlement,
  type PlanTier,
} from '@vehicle-os/domain';
import { Bays, Group, Row, SettingsPage, useProfileUpdate } from '@/components/settings-kit';
import { api } from '@/lib/api';
import { Eyebrow, Segmented } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { PlanPass, TierMark } from '@/lib/plan-kit';
import { BILLING_RETURN, FEATURE_ICON, priceLabel, usePlan } from '@/lib/upgrade';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Empty, Skeleton } from '@/lib/ui';

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * The plan, managed: what it is and what it costs, how full it is, what it includes and what the
 * next one adds, and the billing — in that order, because that is the order of the questions.
 *
 * It never decides a plan changed. Paying happens in the browser; going down — a smaller tier,
 * or cancelling to Free — happens here, and either way the plan shown is the one the server
 * read back from the provider. This screen asks again whenever the app comes back to the front.
 */
export default function PlanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { data, plan } = usePlan();
  const prices = useQuery(pricesQuery(api));
  const update = useProfileUpdate();
  const queryClient = useQueryClient();

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

  if (plan.isError && !data) {
    return (
      <SettingsPage>
        <Empty title="Couldn't load your plan" description={(plan.error as Error).message} />
        <Button label="Try again" onPress={() => void plan.refetch()} />
      </SettingsPage>
    );
  }

  const current: PlanTier = data?.plan ?? 'FREE';
  const price = current === 'FREE' ? null : (prices.data?.[current] ?? null);
  const hasBilling = Boolean(data && (data.plan !== 'FREE' || data.currentPeriodEnd));
  const next = PLAN_TIERS.find((tier) => PLAN_RANK[tier] === PLAN_RANK[current] + 1);

  // Paid through the provider, so there is a subscription to end. A comped plan has no period.
  const cancellable = Boolean(data && current !== 'FREE' && data.currentPeriodEnd);

  // The second press is a screen of its own: the change drawn as a diff, not an alert.
  const confirmDowngrade = (to: 'FREE' | 'PLUS') => {
    haptic.selection();
    router.push({ pathname: '/plan-change', params: { to } });
  };

  const upgrade = (tier: PlanTier, extra: Record<string, string> = {}) => {
    haptic.selection();
    router.push({ pathname: '/upgrade', params: { plan: tier, ...extra } });
  };

  return (
    <SettingsPage>
      {/* --- what you hold: the pass ------------------------------------------------------ */}
      <Rise>
        {data ? (
          <PlanPass plan={data} price={price}>
            {hasBilling ? (
              <PressableScale
                onPress={() => portal.mutate()}
                disabled={portal.isPending}
                accessibilityRole="button"
                accessibilityLabel="Card and invoices"
                hitSlop={6}
                style={styles.passAction}
              >
                {portal.isPending ? (
                  <ActivityIndicator
                    size="small"
                    color={current === 'FREE' ? theme.foreground : theme.primaryForeground}
                  />
                ) : (
                  <>
                    <Text
                      style={[
                        typeScale.label,
                        { color: current === 'FREE' ? theme.foreground : theme.primaryForeground },
                      ]}
                    >
                      Card & invoices
                    </Text>
                    <Ionicons
                      name="open-outline"
                      size={14}
                      color={current === 'FREE' ? theme.foreground : theme.primaryForeground}
                    />
                  </>
                )}
              </PressableScale>
            ) : null}
          </PlanPass>
        ) : (
          <Skeleton width="100%" height={168} radius={20} />
        )}
      </Rise>

      {/* --- how full it is ------------------------------------------------------------------ */}
      {data ? (
        <Rise index={1} style={[styles.usage, { backgroundColor: theme.card }]}>
          <Bays label="Vehicles" used={data.usage.vehicles} limit={data.limits.vehicles} />
          <Bays label="Garages" used={data.usage.garages} limit={data.limits.garages} />
          <View style={styles.members}>
            <Eyebrow>People per garage</Eyebrow>
            <Text style={[typeScale.caption, figure, { color: theme.foreground }]}>
              up to {data.limits.members}
            </Text>
          </View>
        </Rise>
      ) : null}

      {/* --- what needs doing, when something does ------------------------------------------- */}
      {data?.status === 'PAST_DUE' ? (
        <Rise index={2} style={[styles.banner, { backgroundColor: theme.destructiveSoft }]}>
          <Ionicons name="card-outline" size={20} color={theme.destructive} />
          <Text style={[typeScale.caption, { flex: 1, color: theme.foreground }]}>
            The last payment failed. Update the card to keep {PLAN_NAMES[current]}.
          </Text>
          <Button
            label="Update"
            variant="danger"
            loading={portal.isPending}
            onPress={() => portal.mutate()}
          />
        </Rise>
      ) : data?.cancelAtPeriodEnd ? (
        <Rise index={2} style={[styles.banner, { backgroundColor: theme.warningSoft }]}>
          <Ionicons name="time-outline" size={20} color={theme.warning} />
          <Text style={[typeScale.caption, { flex: 1, color: theme.foreground }]}>
            Cancelled. {PLAN_NAMES[current]} stays until{' '}
            {data.currentPeriodEnd ? longDate(data.currentPeriodEnd) : 'the period end'}.
          </Text>
          <Button
            label={`Keep ${PLAN_NAMES[current]}`}
            loading={resume.isPending}
            onPress={() => resume.mutate()}
          />
        </Rise>
      ) : null}

      {/* --- what it includes, and what is one plan away ------------------------------------- */}
      <Group title="Included" index={2}>
        {ENTITLEMENTS.map((entitlement) => {
          const has = hasEntitlement(current, entitlement);
          const tier = tierForEntitlement(entitlement);
          return (
            <Row
              key={entitlement}
              icon={`${FEATURE_ICON[entitlement]}-outline` as const}
              label={ENTITLEMENT_COPY[entitlement].name}
              value={has ? 'Included' : PLAN_NAMES[tier]}
              tone={has ? 'success' : undefined}
              onPress={has ? undefined : () => upgrade(tier, { reason: 'feature', entitlement })}
            />
          );
        })}
      </Group>

      {/* --- the ladder: every plan, this one marked, the ones above a press away ------------ */}
      <Rise index={3} style={{ gap: spacing.sm }}>
        <Eyebrow>Plans</Eyebrow>
        <View style={{ gap: spacing.sm }}>
          {PLAN_TIERS.map((tier) => {
            const limits = limitsFor(tier);
            const here = tier === current;
            const above = PLAN_RANK[tier] > PLAN_RANK[current];
            // A smaller tier is a press away while paying; Free is not, once already cancelled.
            const below =
              cancellable &&
              PLAN_RANK[tier] < PLAN_RANK[current] &&
              !(tier === 'FREE' && data?.cancelAtPeriodEnd);
            const pressable = above || below;
            const tierPrice = tier === 'FREE' ? null : (prices.data?.[tier] ?? null);
            return (
              <PressableScale
                key={tier}
                disabled={!pressable}
                onPress={() => (above ? upgrade(tier) : confirmDowngrade(tier as 'FREE' | 'PLUS'))}
                accessibilityRole="button"
                accessibilityLabel={`${PLAN_NAMES[tier]}${here ? ', your plan' : ''}${tierPrice ? `, ${priceLabel(tierPrice)}` : ''}`}
                accessibilityState={{ disabled: !pressable, selected: here }}
                scaleTo={0.985}
                style={[
                  styles.tier,
                  {
                    backgroundColor: here ? theme.primarySoft : theme.card,
                    borderColor: here ? theme.primary : theme.card,
                    opacity: !here && !pressable ? 0.6 : 1,
                  },
                ]}
              >
                {tier === next ? (
                  <View style={[styles.tierBadge, { backgroundColor: theme.primary }]}>
                    <Text style={[typeScale.overline, { color: theme.primaryForeground }]}>
                      Next up
                    </Text>
                  </View>
                ) : null}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={styles.tierName}>
                    <TierMark tier={tier} color={theme.foreground} />
                    <Text style={[typeScale.headline, { color: theme.foreground }]}>
                      {PLAN_NAMES[tier]}
                    </Text>
                    {here ? (
                      <View style={[styles.current, { backgroundColor: theme.primary }]}>
                        <Ionicons name="checkmark" size={11} color={theme.primaryForeground} />
                        <Text style={[typeScale.overline, { color: theme.primaryForeground }]}>
                          Current
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[typeScale.caption, figure, { color: theme.mutedForeground }]}
                  >
                    {limits.vehicles} vehicles · {limits.garages} garages · {limits.members} people
                  </Text>
                </View>
                <Text style={[typeScale.label, figure, { color: theme.foreground }]}>
                  {tier === 'FREE' ? 'Free' : tierPrice ? priceLabel(tierPrice) : '—'}
                </Text>
                {pressable ? (
                  <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
                ) : null}
              </PressableScale>
            );
          })}
        </View>
        {cancellable ? (
          <Text style={[typeScale.caption, { color: theme.mutedForeground, paddingHorizontal: 4 }]}>
            Free keeps this plan to the end of the period. Nothing is ever deleted.
          </Text>
        ) : null}
      </Rise>

      <Group
        title="Use"
        index={4}
        footer="Business shows trip purpose, income and drivers. It never changes the price."
      >
        <Row icon="briefcase-outline" label="What you use Garaj for" stacked>
          {data ? (
            <Segmented
              value={data.accountKind}
              options={[
                { value: 'PERSONAL', label: 'Personal' },
                { value: 'BUSINESS', label: 'Business' },
              ]}
              onChange={(accountKind) => update.mutate({ accountKind })}
            />
          ) : (
            <Skeleton width="100%" height={44} radius={999} />
          )}
        </Row>
      </Group>

      <Group title="Billing" index={5}>
        {hasBilling ? (
          <Row
            icon="card-outline"
            label="Manage billing"
            hint="Card and invoices"
            onPress={() => portal.mutate()}
          >
            {portal.isPending ? (
              <ActivityIndicator size="small" color={theme.mutedForeground} />
            ) : null}
          </Row>
        ) : null}
        {cancellable && !data?.cancelAtPeriodEnd ? (
          <Row
            icon="close-circle-outline"
            label={`Cancel ${PLAN_NAMES[current]}`}
            hint="Kept to the end of the period, then Free"
            destructive
            onPress={() => confirmDowngrade('FREE')}
          ></Row>
        ) : null}
        <Row
          icon="refresh-outline"
          label="Check again"
          hint="Just paid? Plans update once the payment lands."
          onPress={() => void plan.refetch()}
        >
          {plan.isFetching ? (
            <ActivityIndicator size="small" color={theme.mutedForeground} />
          ) : null}
        </Row>
      </Group>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  usage: { borderRadius: radius.xl, padding: spacing.md + 2, gap: spacing.md },
  passAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 8,
  },
  current: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: 2,
  },
  members: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  tier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.xl,
    borderWidth: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  tierBadge: {
    position: 'absolute',
    top: -10,
    left: spacing.md,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  tierName: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
