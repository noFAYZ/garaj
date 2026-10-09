import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { queryKeys } from '@vehicle-os/api-client/react';
import {
  ENTITLEMENT_COPY,
  ENTITLEMENTS,
  hasEntitlement,
  PLAN_NAMES,
  PLAN_RANK,
} from '@vehicle-os/domain';
import { api } from '@/lib/api';
import { Eyebrow } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { LimitLedger, PassChip } from '@/lib/plan-kit';
import { usePlan } from '@/lib/upgrade';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Empty } from '@/lib/ui';

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Moving to a smaller plan, as a diff (the web's `DowngradeDialog`): from this pass to that one,
 * every ceiling old → new with any the account is already over flagged in place, and the features
 * that stop. The second press is the button pinned at the bottom; the first was the row that
 * opened this. Nothing is deleted either way, and it says so.
 */
export default function PlanChangeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ to?: string }>();
  const to = params.to === 'PLUS' ? 'PLUS' : 'FREE';
  const { data } = usePlan();

  const change = useMutation({
    mutationFn: () => api.billing.downgrade(to),
    onSuccess: async () => {
      haptic.success();
      await queryClient.invalidateQueries({ queryKey: queryKeys.plan() });
      router.back();
    },
  });

  const close = (
    <PressableScale
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={8}
      scaleTo={0.9}
      style={[styles.close, { backgroundColor: theme.card }]}
    >
      <Ionicons name="close" size={22} color={theme.foreground} />
    </PressableScale>
  );

  if (!data || PLAN_RANK[to] >= PLAN_RANK[data.plan]) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.background, paddingTop: insets.top + spacing.sm },
        ]}
      >
        <View style={{ paddingHorizontal: spacing.md }}>{close}</View>
        {data ? (
          <Empty title="Nothing to change" description={`You are on ${PLAN_NAMES[data.plan]}.`} />
        ) : (
          <ActivityIndicator color={theme.mutedForeground} style={{ marginTop: spacing.xl }} />
        )}
      </View>
    );
  }

  const from = data.plan;
  const cancel = to === 'FREE';
  const until = data.currentPeriodEnd ? longDate(data.currentPeriodEnd) : null;
  const lost = ENTITLEMENTS.filter(
    (entitlement) => hasEntitlement(from, entitlement) && !hasEntitlement(to, entitlement),
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: insets.top + spacing.sm }]}
        showsVerticalScrollIndicator={false}
      >
        {close}

        <Rise style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={[typeScale.display, { color: theme.foreground }]}>
            {cancel ? `Cancel ${PLAN_NAMES[from]}?` : `Switch to ${PLAN_NAMES[to]}?`}
          </Text>
          <Text style={[typeScale.body, { color: theme.mutedForeground }]}>
            {cancel
              ? `You keep ${PLAN_NAMES[from]} until ${until ?? 'the end of the period'}. Then it moves to Free, and nothing is charged again.`
              : `Switches now. What is left of ${PLAN_NAMES[from]} is credited to your next bill.`}
          </Text>
        </Rise>

        <Rise index={1}>
          <View
            style={[styles.strip, { backgroundColor: theme.card }]}
            accessible
            accessibilityLabel={`${PLAN_NAMES[from]} to ${PLAN_NAMES[to]}, ${cancel ? `on ${until ?? 'the period end'}` : 'now'}`}
          >
            <PassChip tier={from} />
            <View style={styles.when}>
              <Ionicons name="arrow-forward" size={16} color={theme.mutedForeground} />
              <Text
                style={[
                  typeScale.overline,
                  figure,
                  { color: theme.mutedForeground, textTransform: 'uppercase' },
                ]}
              >
                {cancel
                  ? data.currentPeriodEnd
                    ? shortDay(data.currentPeriodEnd)
                    : 'later'
                  : 'now'}
              </Text>
            </View>
            <PassChip tier={to} />
          </View>
        </Rise>

        <Rise index={2} style={{ gap: spacing.sm }}>
          <Eyebrow>Limits</Eyebrow>
          <LimitLedger from={from} to={to} usage={data.usage} />
        </Rise>

        {lost.length > 0 ? (
          <Rise index={3} style={{ gap: spacing.sm }}>
            <Eyebrow>
              {cancel ? `Stops ${until ? `on ${until}` : 'at the period end'}` : 'Stops now'}
            </Eyebrow>
            <View style={styles.chips}>
              {lost.map((entitlement) => (
                <View key={entitlement} style={[styles.chip, { backgroundColor: theme.card }]}>
                  <View style={[styles.minus, { backgroundColor: theme.destructiveSoft }]}>
                    <Ionicons name="remove" size={12} color={theme.destructive} />
                  </View>
                  <Text style={[typeScale.label, { color: theme.foreground }]}>
                    {ENTITLEMENT_COPY[entitlement].name}
                  </Text>
                </View>
              ))}
            </View>
          </Rise>
        ) : null}

        <Rise index={4} style={styles.safe}>
          <Ionicons name="shield-checkmark-outline" size={16} color={theme.mutedForeground} />
          <Text style={[typeScale.caption, { flex: 1, color: theme.mutedForeground }]}>
            Every vehicle, record and document stays. Nothing is deleted.
          </Text>
        </Rise>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, spacing.md), backgroundColor: theme.background },
        ]}
      >
        {change.isError ? (
          <Text
            accessibilityRole="alert"
            style={[typeScale.caption, { color: theme.destructive, textAlign: 'center' }]}
          >
            {change.error instanceof Error ? change.error.message : 'Your plan was not changed.'}
          </Text>
        ) : null}
        <PressableScale
          onPress={() => {
            haptic.selection();
            change.mutate();
          }}
          disabled={change.isPending}
          accessibilityRole="button"
          accessibilityLabel={cancel ? 'Cancel plan' : `Switch to ${PLAN_NAMES[to]}`}
          accessibilityState={{ busy: change.isPending }}
          scaleTo={0.98}
          style={[
            styles.cta,
            cancel
              ? { backgroundColor: theme.destructive }
              : {
                  backgroundColor: theme.primary,
                  borderTopWidth: 1,
                  borderBottomWidth: 1.5,
                  borderTopColor: theme.primarySheen,
                  borderBottomColor: theme.primaryEdge,
                },
          ]}
        >
          {change.isPending ? (
            <ActivityIndicator
              color={cancel ? theme.destructiveForeground : theme.primaryForeground}
            />
          ) : (
            <Text
              style={[
                typeScale.headline,
                { color: cancel ? theme.destructiveForeground : theme.primaryForeground },
              ]}
            >
              {cancel ? 'Cancel plan' : `Switch to ${PLAN_NAMES[to]}`}
            </Text>
          )}
        </PressableScale>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.keep}
        >
          <Text style={[typeScale.label, { color: theme.mutedForeground }]}>
            Keep {PLAN_NAMES[from]}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.lg },
  close: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderRadius: radius.xl + 4,
    paddingVertical: spacing.lg + 2,
    paddingHorizontal: spacing.md,
  },
  when: { alignItems: 'center', gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
  },
  minus: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safe: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  cta: {
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keep: { alignSelf: 'center', paddingVertical: 6 },
});
