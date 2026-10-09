import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Animated, AppState, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { garagesQuery, unreadCountQuery } from '@vehicle-os/api-client/react';
import { PLAN_NAMES, PLAN_RANK, PLAN_TIERS } from '@vehicle-os/domain';
import { useDockSpace } from '@/components/dock';
import { Bays, Group, Row } from '@/components/settings-kit';
import { api } from '@/lib/api';
import { Eyebrow, ToneChip, type Tone } from '@/lib/instrument';
import { haptic, PressableScale, Rise, useScrollY } from '@/lib/motion';
import { pendingCount } from '@/lib/offline';
import { usePlan } from '@/lib/upgrade';
import { useProfile } from '@/lib/vehicle-units';
import { radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { CompactHeader, Face, LargeHeader, Skeleton } from '@/lib/ui';

const DISTANCE = { KM: 'km', MI: 'mi' } as const;
const VOLUME = { LITER: 'L', US_GALLON: 'US gal', IMP_GALLON: 'UK gal' } as const;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * You, as a tree: the root shows who is signed in, the plan at a glance, and one row per branch
 * with its current value on the right — never the controls themselves. Every control lives one
 * level down, on a screen about only that thing, so this page stays a map rather than a form.
 *
 * The values are the point of the root: "km · L · GBP", "All sent", "3 garages" answer most
 * visits without opening anything.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dockSpace = useDockSpace();
  const { y, onScroll } = useScrollY();

  const profile = useProfile();
  const garages = useQuery(garagesQuery(api));
  const unread = useQuery({ ...unreadCountQuery(api), staleTime: 60_000 });
  const { data: planState, plan } = usePlan();
  const [pending, setPending] = useState<number | null>(null);

  // Read again whenever the tree comes back into view: a branch may have just sent the queue.
  useFocusEffect(
    useCallback(() => {
      void pendingCount().then(setPending);
    }, []),
  );

  // Back from paying in the browser is exactly when the plan changes; ask again then.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void plan.refetch();
    });
    return () => subscription.remove();
  }, [plan]);

  const me = profile.data;
  const garageCount = garages.data?.length;
  const unreadCount = unread.data?.unread ?? 0;
  const zone = me?.timezone.split('/').at(-1)?.replaceAll('_', ' ');

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + spacing.sm, paddingBottom: dockSpace },
        ]}
      >
        <Rise>
          <LargeHeader eyebrow="Account" title="You" y={y} />
        </Rise>

        {/* --- who: the way into the account branch ------------------------------------------ */}
        <Rise index={1}>
          <PressableScale
            onPress={() => {
              haptic.selection();
              router.push('/settings/account');
            }}
            accessibilityRole="button"
            accessibilityLabel={`Account: ${me?.name ?? 'signed in'}`}
            scaleTo={0.98}
            style={[styles.identity, { backgroundColor: theme.card }, rimmed(theme)]}
          >
            <Face user={me} size={56} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              {profile.isPending ? (
                <>
                  <Skeleton width={140} height={18} />
                  <Skeleton width={180} height={13} />
                </>
              ) : (
                <>
                  <Text numberOfLines={1} style={[typeScale.headline, { color: theme.foreground }]}>
                    {me?.name || 'Signed in'}
                  </Text>
                  <View style={styles.emailRow}>
                    <Text
                      numberOfLines={1}
                      style={[typeScale.caption, { flexShrink: 1, color: theme.mutedForeground }]}
                    >
                      {me?.email ?? ''}
                    </Text>
                    {me?.emailVerified ? (
                      <Ionicons name="checkmark-circle" size={13} color={theme.success} />
                    ) : null}
                  </View>
                </>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
          </PressableScale>
        </Rise>

        {/* --- the plan at a glance: what it is, how full, the way up ----------------------- */}
        <Rise index={2}>
          <PressableScale
            onPress={() => {
              haptic.selection();
              router.push('/settings/plan');
            }}
            accessibilityRole="button"
            accessibilityLabel={
              planState ? `Plan: ${PLAN_NAMES[planState.plan]}. Manage plan` : 'Plan'
            }
            scaleTo={0.985}
            style={[styles.planCard, { backgroundColor: theme.card }, rimmed(theme)]}
          >
            <View style={styles.planTop}>
              <View style={{ flex: 1, gap: 2 }}>
                <Eyebrow>Plan</Eyebrow>
                {planState ? (
                  <Text style={[typeScale.display, { color: theme.foreground }]}>
                    {PLAN_NAMES[planState.plan]}
                  </Text>
                ) : plan.isError ? (
                  <Text style={[typeScale.label, { color: theme.destructive }]}>Couldn't load</Text>
                ) : (
                  <Skeleton width={90} height={26} />
                )}
              </View>
              {planState ? <PlanStatus state={planState} /> : null}
            </View>

            {planState ? (
              <View style={styles.planUsage}>
                <View style={{ flex: 1 }}>
                  <Bays
                    label="Vehicles"
                    used={planState.usage.vehicles}
                    limit={planState.limits.vehicles}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Bays
                    label="Garages"
                    used={planState.usage.garages}
                    limit={planState.limits.garages}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.planFoot}>
              <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                {planState && PLAN_TIERS.some((tier) => PLAN_RANK[tier] > PLAN_RANK[planState.plan])
                  ? 'Compare plans, billing, what’s included'
                  : 'Billing and what’s included'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
            </View>
          </PressableScale>
        </Rise>

        {/* --- the branches -------------------------------------------------------------------- */}
        <Group title="Preferences" index={3}>
          <Row
            icon="options-outline"
            label="Units & region"
            value={
              me
                ? `${DISTANCE[me.distanceUnit]} · ${VOLUME[me.volumeUnit]} · ${me.defaultCurrency}`
                : undefined
            }
            hint={zone}
            mono
            onPress={() => router.push('/settings/units')}
          />
        </Group>

        <Group title="This phone" index={4}>
          <Row
            icon={pending ? 'cloud-upload-outline' : 'cloud-done-outline'}
            label="Sync & device"
            value={pending === null ? undefined : pending === 0 ? 'All sent' : `${pending} waiting`}
            tone={pending === null ? undefined : pending === 0 ? 'success' : 'warning'}
            onPress={() => router.push('/settings/device')}
          />
          <Row
            icon="notifications-outline"
            label="Notifications"
            badge={unreadCount}
            onPress={() => router.push('/notifications')}
          />
        </Group>

        <Group title="Data" index={5}>
          <Row
            icon="archive-outline"
            label="Export & garages"
            value={
              garageCount === undefined
                ? undefined
                : `${garageCount} ${garageCount === 1 ? 'garage' : 'garages'}`
            }
            onPress={() => router.push('/settings/data')}
          />
        </Group>

        <Rise index={6}>
          <Text
            style={[typeScale.caption, styles.version, { color: theme.mutedForeground }]}
            accessibilityLabel={`Garaj version ${Constants.expoConfig?.version ?? ''}`}
          >
            Garaj {Constants.expoConfig?.version}
          </Text>
        </Rise>
      </Animated.ScrollView>
      <CompactHeader title="You" y={y} />
    </View>
  );
}

/** The one thing about the plan's state worth a colour: renewing, ending, or unpaid. */
function PlanStatus({ state }: { state: NonNullable<ReturnType<typeof usePlan>['data']> }) {
  const [tone, label]: [Tone, string] =
    state.status === 'PAST_DUE'
      ? ['destructive', 'Payment failed']
      : state.cancelAtPeriodEnd && state.currentPeriodEnd
        ? ['warning', `Ends ${shortDate(state.currentPeriodEnd)}`]
        : state.currentPeriodEnd
          ? ['success', `Renews ${shortDate(state.currentPeriodEnd)}`]
          : ['neutral', state.plan === 'FREE' ? 'Free forever' : 'Comped'];
  return <ToneChip tone={tone} label={label} />;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, gap: spacing.xl },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderRadius: radius.xxl,
    padding: spacing.lg,
  },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  planCard: {
    borderRadius: radius.xxl,
    padding: spacing.lg + 2,
    gap: spacing.lg,
  },
  planTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  planUsage: { flexDirection: 'row', gap: spacing.lg },
  planFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  version: { textAlign: 'center' },
});
