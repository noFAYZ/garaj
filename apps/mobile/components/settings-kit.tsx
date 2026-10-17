import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Children, Fragment, useEffect, useState, type ReactNode } from 'react';
import { Animated, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { queryKeys } from '@vehicle-os/api-client/react';
import type { Garage, UpdateUserProfile, UserProfile } from '@vehicle-os/contracts';
import { signOut, useSession } from '@/lib/auth';
import { haptic, Pop, PressableScale, Pulse, Rise, useReduceMotion } from '@/lib/motion';
import { clearQueue, enqueue, flush } from '@/lib/offline';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';

/*
 * The pieces every settings screen is built from, so the tree reads as one place: a soft card of
 * rows under a quiet name, hairlines between them, and a row that names a thing — a line icon, the
 * word — and shows its value, a control or the way in.
 */

export const pad = (value: number) => String(value).padStart(2, '0');

export type IconName = keyof typeof Ionicons.glyphMap;
export type RowTone = 'success' | 'warning' | 'destructive';

/** A pushed settings screen: the stack's header above, the home indicator's room below. */
export function SettingsPage({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[
        styles.page,
        { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
      ]}
    >
      {children}
    </ScrollView>
  );
}

/**
 * A settings screen's own header, where it draws one: the way back in a soft round key, the title
 * beside it, large, and at the far side the screen's one action, if it has one. Back goes where
 * the person came from — or home, with nowhere to go back.
 */
export function SettingsHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Rise style={styles.header}>
      <PressableScale
        onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={6}
        scaleTo={0.9}
        style={[styles.back, groupSurface(theme)]}
      >
        <Ionicons name="arrow-back" size={19} color={theme.foreground} />
      </PressableScale>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.title, { flexShrink: 1, color: theme.foreground }]}
      >
        {title}
      </Text>
      {trailing ? <View style={styles.headerAction}>{trailing}</View> : null}
    </Rise>
  );
}

/**
 * The warm wash a settings screen sits on: copper light from the top corner and a softer peach
 * from the other, gone well before the middle — the cards over it let a little through.
 */
export function SettingsWash() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  return (
    <Svg
      pointerEvents="none"
      width={width}
      height={520}
      style={styles.wash}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient id="wash-copper" cx="100%" cy="0%" rx="85%" ry="75%">
          <Stop offset="0" stopColor={theme.primary} stopOpacity={theme.dark ? 0.24 : 0.17} />
          <Stop offset="1" stopColor={theme.primary} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="wash-peach" cx="0%" cy="10%" rx="70%" ry="60%">
          <Stop offset="0" stopColor={theme.warning} stopOpacity={theme.dark ? 0.08 : 0.1} />
          <Stop offset="1" stopColor={theme.warning} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={width} height={520} fill="url(#wash-peach)" />
      <Rect width={width} height={520} fill="url(#wash-copper)" />
    </Svg>
  );
}

/** Rows that belong together, on one card under a quiet name, a hairline between each. */
export function Group({
  title,
  footer,
  index = 0,
  children,
}: {
  title?: string;
  footer?: string;
  index?: number;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Rise index={index} style={{ gap: spacing.sm }}>
      {title ? (
        <Text style={[styles.groupTitle, { color: theme.mutedForeground }]}>{title}</Text>
      ) : null}
      <View style={[styles.group, groupSurface(theme)]}>
        {/* Rows can be conditional: only the ones there get a hairline between them. */}
        {Children.toArray(children).map((child, place) => (
          <Fragment key={place}>
            {place > 0 ? <View style={[styles.rule, { backgroundColor: theme.border }]} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <Text style={[typeScale.caption, { color: theme.mutedForeground, paddingHorizontal: 4 }]}>
          {footer}
        </Text>
      ) : null}
    </Rise>
  );
}

/** A card's surface on a settings screen: the resting card, a little of the page through it. */
export const groupSurface = (theme: ReturnType<typeof useTheme>) => ({
  backgroundColor: `${theme.card}E8`,
  borderColor: theme.hairline,
});

/**
 * A settings row: a line icon, the label, and on the right its value, a control, or the way in.
 * `tone` colours the value's dot for a state (all sent, waiting, failing); `badge` is a count.
 * The icon is muted and bare — the label carries the row, colour is kept for state.
 */
export function Row({
  icon,
  label,
  hint,
  value,
  mono = false,
  tone,
  badge,
  destructive = false,
  stacked = false,
  chevron = true,
  onPress,
  children,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  value?: string;
  mono?: boolean;
  tone?: RowTone;
  badge?: number;
  destructive?: boolean;
  /** The control under the label, full width — for one with more options than fit beside it. */
  stacked?: boolean;
  /** The way in, at the right; off for a row that acts rather than opens — signing out. */
  chevron?: boolean;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const [pressed, setPressed] = useState(false);
  const toneColor = tone ? theme[tone] : undefined;
  const ink = destructive ? theme.destructive : theme.foreground;
  const tile = (
    <View style={styles.rowIcon}>
      <Ionicons name={icon} size={19} color={destructive ? ink : theme.mutedForeground} />
    </View>
  );

  if (stacked) {
    return (
      <View style={styles.stackedRow}>
        <View style={styles.stackedTop}>
          {tile}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.label, { color: ink }]}>{label}</Text>
            {hint ? (
              <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>{hint}</Text>
            ) : null}
          </View>
        </View>
        {children}
      </View>
    );
  }

  const body = (
    <>
      {tile}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.label, { color: ink }]}>
          {label}
        </Text>
        {hint ? (
          <Text numberOfLines={2} style={[typeScale.caption, { color: theme.mutedForeground }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
      {badge ? (
        // Keyed by the count, so a new one arrives with a pop.
        <Pop key={badge} style={[styles.badge, { backgroundColor: theme.primary }]}>
          <Text style={[typeScale.caption, figure, { color: theme.primaryForeground }]}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </Pop>
      ) : null}
      {value !== undefined ? (
        <View style={styles.valueRow}>
          {/* Waiting is live — it changes by itself — so its dot breathes; a settled state does not. */}
          {toneColor ? (
            tone === 'warning' ? (
              <Pulse color={toneColor} size={7} />
            ) : (
              <View style={[styles.dot, { backgroundColor: toneColor }]} />
            )
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              typeScale.caption,
              mono ? figure : null,
              { flexShrink: 1, color: theme.mutedForeground },
            ]}
          >
            {value}
          </Text>
        </View>
      ) : null}
      {onPress && chevron ? <Lean on={pressed} /> : null}
    </>
  );

  return onPress ? (
    <PressableScale
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={[label, value, badge ? `${badge} new` : null].filter(Boolean).join(', ')}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      scaleTo={0.99}
      // A wash short of the tile's own colour, so the tile still reads under the thumb.
      style={[styles.row, pressed ? { backgroundColor: `${theme.muted}A6` } : null]}
    >
      {body}
    </PressableScale>
  ) : (
    <View accessible style={styles.row}>
      {body}
    </View>
  );
}

/** A row's way in: a chevron that leans the way it goes while the row is held. */
function Lean({ on }: { on: boolean }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [lean] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return;
    Animated.spring(lean, {
      toValue: on ? 1 : 0,
      useNativeDriver: true,
      speed: on ? 40 : 18,
      bounciness: on ? 0 : 12,
    }).start();
  }, [lean, on, reduce]);
  return (
    <Animated.View
      style={{
        transform: [{ translateX: lean.interpolate({ inputRange: [0, 1], outputRange: [0, 3] }) }],
      }}
    >
      <Ionicons
        name="chevron-forward"
        size={15}
        color={on ? theme.foreground : theme.borderStrong}
      />
    </Animated.View>
  );
}

/**
 * Signing out, as one step: the session ends, this account's unsent writes go with it — left
 * behind they would go out under the next person's session on this phone, rejected and lost or
 * recorded as theirs — the cache on disk is cleared, and the sign-in screen takes over.
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { refresh } = useSession();
  const [leaving, setLeaving] = useState(false);
  const leave = async () => {
    setLeaving(true);
    try {
      await signOut();
      await clearQueue();
      queryClient.clear();
      await refresh();
      router.replace('/sign-in');
    } finally {
      setLeaving(false);
    }
  };
  return { leave, leaving };
}

/**
 * A preference, saved the moment it is picked: shown at once, queued like every other write (so
 * one set on a train sticks), and put back if the server refuses. Changing the currency moves the
 * garages this person owns with it — a garage's currency is what its totals are quoted in; shared
 * garages belong to someone else and keep theirs.
 *
 * `quiet` drops the saved buzz, for a switch that already ticked under the thumb: one feel a press.
 */
export function useProfileUpdate({ quiet = false }: { quiet?: boolean } = {}) {
  const queryClient = useQueryClient();

  const adoptCurrency = async (currency: string) => {
    const owned = (queryClient.getQueryData<Garage[]>(queryKeys.garages()) ?? []).filter(
      (garage) => garage.role === 'OWNER' && garage.defaultCurrency !== currency,
    );
    for (const garage of owned) {
      await enqueue({
        kind: 'garage-update',
        garageId: garage.id,
        body: { defaultCurrency: currency },
      });
    }
    void flush();
    void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  };

  return useMutation({
    mutationFn: async (body: UpdateUserProfile) => {
      await enqueue({ kind: 'profile-update', body });
      void flush();
      return body;
    },
    onMutate: (body) => {
      const previous = queryClient.getQueryData<UserProfile>(['me']);
      if (previous) queryClient.setQueryData<UserProfile>(['me'], { ...previous, ...body });
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(['me'], context.previous);
    },
    onSuccess: async (_next, body) => {
      if (!quiet) haptic.success();
      // The queue returns only the fields sent, not the profile: merge, never replace.
      queryClient.setQueryData<UserProfile>(['me'], (current) =>
        current ? { ...current, ...body } : current,
      );
      if (body.defaultCurrency) await adoptCurrency(body.defaultCurrency);
      // What the account is for changes what the plan screen shows.
      if (body.accountKind) void queryClient.invalidateQueries({ queryKey: ['me', 'plan'] });
    },
  });
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.lg + 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.6 },
  headerAction: { marginLeft: 'auto' },
  wash: { position: 'absolute', top: 0, left: 0 },
  groupTitle: { fontSize: 13, lineHeight: 17, fontWeight: '500', paddingHorizontal: 4 },
  group: { borderRadius: radius.xl + 2, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  stackedRow: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },
  stackedTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowIcon: { width: 22, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14.5, lineHeight: 20, fontWeight: '500', letterSpacing: -0.1 },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '52%',
    flexShrink: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 999 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 999,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
