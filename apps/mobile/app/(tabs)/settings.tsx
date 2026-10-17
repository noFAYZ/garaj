import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  Image as Picture,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { garagesQuery, unreadCountQuery } from '@vehicle-os/api-client/react';
import type { PlanState, UserProfile } from '@vehicle-os/contracts';
import { PLAN_NAMES, PLAN_RANK, PLAN_TIERS } from '@vehicle-os/domain';
import logoTextLight from '@/assets/logo-text-light.png';
import logoText from '@/assets/logo-text.png';
import { useDockSpace } from '@/components/dock';
import {
  Group,
  groupSurface,
  Row,
  SettingsHeader,
  SettingsWash,
  useProfileUpdate,
  useSignOut,
} from '@/components/settings-kit';
import { api } from '@/lib/api';
import { Segmented } from '@/lib/instrument';
import { CURRENCIES, deviceTimeZone } from '@/lib/locale-options';
import { haptic, PressableScale, Rise, useScrollY } from '@/lib/motion';
import { pendingCount } from '@/lib/offline';
import { usePlan } from '@/lib/upgrade';
import { useProfile } from '@/lib/vehicle-units';
import { figure, radius, spacing, useTheme } from '@/lib/theme';
import { CompactHeader, Face, Skeleton } from '@/lib/ui';

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

/** The zone's own clock, as the phone keeps it; a zone it does not know gives no time. */
function clockIn(zone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    }).format(now);
  } catch {
    return null;
  }
}

function useNow(every = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/**
 * Settings, laid out as a soft list on a warm wash: the way back and the title; you, as one card
 * that opens the account; then the groups under quiet names — the account's plan and
 * notifications, the preferences every record is read in (the units switched where they are), your
 * data and this phone — each row a line icon, a word and its value; and on its own card at the
 * foot, the way out, which asks first and says what an unsent entry would cost.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dockSpace = useDockSpace();
  const { y, onScroll } = useScrollY();
  const now = useNow();

  const profile = useProfile();
  const garages = useQuery(garagesQuery(api));
  const unread = useQuery({ ...unreadCountQuery(api), staleTime: 60_000 });
  const { data: planState, plan } = usePlan();
  const update = useProfileUpdate({ quiet: true });
  const { leave, leaving } = useSignOut();
  const [pending, setPending] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);

  // Read again whenever the screen comes back into view: a branch may have just sent the queue.
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

  const refresh = () => {
    setPulling(true);
    void Promise.allSettled([
      profile.refetch(),
      plan.refetch(),
      garages.refetch(),
      unread.refetch(),
      pendingCount().then(setPending),
    ]).finally(() => setPulling(false));
  };

  // Asks first, and says what is lost: entries still on this phone go with the session.
  const askToLeave = async () => {
    haptic.selection();
    const waiting = await pendingCount();
    Alert.alert(
      'Sign out?',
      waiting
        ? `${waiting} ${waiting === 1 ? 'entry has' : 'entries have'} not been sent and will be discarded.`
        : 'Your garage stays; this phone forgets it.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: waiting ? 'Discard and sign out' : 'Sign out',
          style: 'destructive',
          onPress: () => void leave(),
        },
      ],
    );
  };

  const me = profile.data;
  const garageCount = garages.data?.length;
  const currency = CURRENCIES.find((option) => option.value === me?.defaultCurrency);
  const city = me?.timezone.split('/').at(-1)?.replaceAll('_', ' ');
  const time = me ? clockIn(me.timezone, now) : null;
  const phone = deviceTimeZone();
  // The phone is somewhere the account is not: worth a look, not an alarm.
  const elsewhere = Boolean(me && phone && phone !== me.timezone);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SettingsWash />
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={refresh}
            tintColor={theme.mutedForeground}
            progressViewOffset={insets.top}
          />
        }
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + spacing.sm, paddingBottom: dockSpace },
        ]}
      >
        <SettingsHeader title="Settings" />

        <Rise index={1}>
          <You
            me={me}
            loading={profile.isPending}
            onPress={() => router.push('/settings/account')}
          />
        </Rise>

        <Group title="Account" index={2}>
          <PlanRow
            state={planState}
            failed={plan.isError && !planState}
            onPress={() =>
              plan.isError && !planState ? void plan.refetch() : router.push('/settings/plan')
            }
          />
          <Row
            icon="notifications-outline"
            label="Notifications"
            badge={unread.data?.unread ?? 0}
            onPress={() => router.push('/notifications')}
          />
        </Group>

        <Group title="Preferences" index={3}>
          <Row icon="speedometer-outline" label="Distance">
            {me ? (
              <View style={styles.distance}>
                <Segmented
                  small
                  value={me.distanceUnit}
                  options={[
                    { value: 'KM', label: 'km', said: 'Kilometres' },
                    { value: 'MI', label: 'mi', said: 'Miles' },
                  ]}
                  onChange={(distanceUnit) => update.mutate({ distanceUnit })}
                />
              </View>
            ) : (
              <Skeleton width={104} height={38} radius={999} />
            )}
          </Row>
          <Row icon="water-outline" label="Volume">
            {me ? (
              <View style={styles.volume}>
                <Segmented
                  small
                  value={me.volumeUnit}
                  options={[
                    { value: 'LITER', label: 'L', said: 'Litres' },
                    { value: 'US_GALLON', label: 'US gal', said: 'US gallons' },
                    { value: 'IMP_GALLON', label: 'UK gal', said: 'UK gallons' },
                  ]}
                  onChange={(volumeUnit) => update.mutate({ volumeUnit })}
                />
              </View>
            ) : (
              <Skeleton width={176} height={38} radius={999} />
            )}
          </Row>
          <Row
            icon="cash-outline"
            label="Currency"
            value={
              me ? `${me.defaultCurrency}${currency ? ` · ${currency.label}` : ''}` : undefined
            }
            onPress={() => router.push('/settings/units')}
          />
          <Row
            icon="time-outline"
            label="Time zone"
            value={city ? `${city}${time ? ` · ${time}` : ''}` : undefined}
            tone={elsewhere ? 'warning' : undefined}
            onPress={() => router.push('/settings/units')}
          />
        </Group>

        <Group title="Data & device" index={4}>
          <Row
            icon="folder-open-outline"
            label="Your data"
            value={garageCount === undefined ? undefined : plural(garageCount, 'garage')}
            onPress={() => router.push('/settings/data')}
          />
          <Row
            icon={pending ? 'cloud-upload-outline' : 'cloud-done-outline'}
            label="This phone"
            value={pending === null ? undefined : pending === 0 ? 'All sent' : `${pending} waiting`}
            tone={pending === null ? undefined : pending === 0 ? 'success' : 'warning'}
            onPress={() => router.push('/settings/device')}
          />
        </Group>

        <Group index={5}>
          <Row
            icon="log-out-outline"
            label={leaving ? 'Signing out…' : 'Sign out'}
            chevron={false}
            onPress={() => void askToLeave()}
          />
        </Group>

        <Rise index={6} style={styles.footer}>
          <Picture
            source={theme.dark ? logoTextLight : logoText}
            style={styles.footerMark}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <Text
            style={[figure, styles.version, { color: theme.mutedForeground }]}
            accessibilityLabel={`Garaj version ${Constants.expoConfig?.version ?? ''}`}
          >
            v{Constants.expoConfig?.version}
          </Text>
        </Rise>
      </Animated.ScrollView>
      <CompactHeader title="Settings" y={y} />
    </View>
  );
}

/** You, as one card: the face, the name, the email, and the way into the account. */
function You({
  me,
  loading,
  onPress,
}: {
  me: UserProfile | undefined;
  loading: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={me ? `${me.name || 'Signed in'}, ${me.email}` : 'Account, loading'}
      accessibilityHint="Opens your account"
      scaleTo={0.985}
      style={[styles.you, groupSurface(theme)]}
    >
      <Face user={me} size={46} />
      <View style={styles.who}>
        {loading ? (
          <View style={{ gap: 7 }}>
            <Skeleton width={130} height={15} />
            <Skeleton width={170} height={11} />
          </View>
        ) : (
          <>
            <Text numberOfLines={1} style={[styles.name, { color: theme.foreground }]}>
              {me?.name || 'Signed in'}
            </Text>
            <Text numberOfLines={1} style={[styles.email, { color: theme.mutedForeground }]}>
              {me?.email ?? ''}
            </Text>
          </>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.borderStrong} />
    </PressableScale>
  );
}

/**
 * The plan's row: its name, or the one thing worth a colour — a payment that failed, a plan
 * running out, or, full on Free, the copper way up.
 */
function PlanRow({
  state,
  failed,
  onPress,
}: {
  state: PlanState | undefined;
  failed: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  if (!state) {
    return (
      <Row
        icon={failed ? 'refresh' : 'diamond-outline'}
        label="Plan & billing"
        value={failed ? 'Retry' : undefined}
        onPress={onPress}
      />
    );
  }
  const full =
    (state.usage.vehicles >= state.limits.vehicles ||
      state.usage.garages >= state.limits.garages) &&
    PLAN_TIERS.some((tier) => PLAN_RANK[tier] > PLAN_RANK[state.plan]);
  const alert =
    state.status === 'PAST_DUE'
      ? { tone: 'destructive' as const, label: 'Payment failed' }
      : state.cancelAtPeriodEnd && state.currentPeriodEnd
        ? { tone: 'warning' as const, label: `Ends ${shortDate(state.currentPeriodEnd)}` }
        : null;
  const upgrade = !alert && full && state.plan === 'FREE';
  return (
    <Row
      icon="diamond-outline"
      label="Plan & billing"
      value={alert ? alert.label : upgrade ? undefined : PLAN_NAMES[state.plan]}
      tone={alert?.tone}
      onPress={onPress}
    >
      {upgrade ? (
        <View style={[styles.upgrade, { backgroundColor: theme.primary }]}>
          <Text style={[styles.upgradeText, { color: theme.primaryForeground }]}>Upgrade</Text>
        </View>
      ) : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, gap: spacing.lg + 2 },

  you: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.xl + 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  who: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.2 },
  email: { fontSize: 12.5, lineHeight: 17 },

  distance: { width: 104 },
  volume: { width: 176 },
  upgrade: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  upgradeText: { fontSize: 12, lineHeight: 15, fontWeight: '700' },

  footer: { alignItems: 'center', gap: 4, paddingTop: spacing.xs },
  footerMark: { width: 54, height: 15, opacity: 0.45 },
  version: { fontSize: 10.5, lineHeight: 14, letterSpacing: 0.6 },
});
