import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { queryKeys } from '@vehicle-os/api-client/react';
import type { Garage, UpdateUserProfile, UserProfile } from '@vehicle-os/contracts';
import { Eyebrow } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { enqueue, flush } from '@/lib/offline';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';

/*
 * The pieces every settings screen is built from, so the tree reads as one place: a group of
 * rows under an eyebrow, a row that names a thing and shows its value, and the usage meter.
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

/** Rows that belong together, under a name; hairlines between them are the gaps. */
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
      {title ? <Eyebrow>{title}</Eyebrow> : null}
      <View style={[styles.group, { backgroundColor: theme.border, borderColor: theme.hairline }]}>
        {children}
      </View>
      {footer ? (
        <Text style={[typeScale.caption, { color: theme.mutedForeground, paddingHorizontal: 4 }]}>
          {footer}
        </Text>
      ) : null}
    </Rise>
  );
}

/**
 * A settings row: an icon tile, the label, and on the right its value, a control, or the way in.
 * `tone` colours the value's dot for a state (all sent, waiting, failing); `badge` is a count.
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
  onPress?: () => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const toneColor = tone ? theme[tone] : undefined;
  const ink = destructive ? theme.destructive : theme.foreground;
  const tile = (
    <View
      style={[
        styles.rowIcon,
        { backgroundColor: destructive ? theme.destructiveSoft : theme.muted },
      ]}
    >
      <Ionicons name={icon} size={17} color={ink} />
    </View>
  );

  if (stacked) {
    return (
      <View style={[styles.stackedRow, { backgroundColor: theme.card }]}>
        <View style={styles.stackedTop}>
          {tile}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[typeScale.label, { fontWeight: '600', color: ink }]}>{label}</Text>
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
        <Text numberOfLines={1} style={[typeScale.label, { fontWeight: '600', color: ink }]}>
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
        <View style={[styles.badge, { backgroundColor: theme.primary }]}>
          <Text style={[typeScale.caption, figure, { color: theme.primaryForeground }]}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
      {value !== undefined ? (
        <View style={styles.valueRow}>
          {toneColor ? <View style={[styles.dot, { backgroundColor: toneColor }]} /> : null}
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
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.borderStrong} /> : null}
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
      scaleTo={0.99}
      style={[styles.row, { backgroundColor: theme.card }]}
    >
      {body}
    </PressableScale>
  ) : (
    <View accessible style={[styles.row, { backgroundColor: theme.card }]}>
      {body}
    </View>
  );
}

/**
 * How much of a ceiling is used, drawn as the garage it is: a bay per place, the taken ones
 * filled, the free ones dashed. Past a dozen places bays stop being countable, so it becomes a
 * bar. Full reads amber — the next one needs a bigger plan.
 */
export function Bays({ used, limit, label }: { used: number; limit: number; label: string }) {
  const theme = useTheme();
  const full = used >= limit;
  const fill = full ? theme.warning : theme.foreground;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}: ${used} of ${limit}`}
      accessibilityValue={{ min: 0, max: limit, now: Math.min(used, limit) }}
      style={{ gap: 6 }}
    >
      <View style={styles.baysTop}>
        <Eyebrow>{label}</Eyebrow>
        <Text
          style={[typeScale.caption, figure, { color: full ? theme.warning : theme.foreground }]}
        >
          {pad(used)}
          <Text style={{ color: theme.mutedForeground }}> / {pad(limit)}</Text>
        </Text>
      </View>
      {limit <= 12 ? (
        <View style={styles.bays}>
          {Array.from({ length: limit }, (_, index) => (
            <View
              key={index}
              style={[
                styles.bay,
                index < used
                  ? { backgroundColor: fill }
                  : { borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.borderStrong },
              ]}
            />
          ))}
        </View>
      ) : (
        <View style={[styles.track, { backgroundColor: theme.muted }]}>
          <View
            style={[
              styles.trackFill,
              {
                width: `${Math.max(Math.min(used / limit, 1) * 100, used ? 2 : 0)}%`,
                backgroundColor: fill,
              },
            ]}
          />
        </View>
      )}
    </View>
  );
}

/**
 * A preference, saved the moment it is picked: shown at once, queued like every other write (so
 * one set on a train sticks), and put back if the server refuses. Changing the currency moves the
 * garages this person owns with it — a garage's currency is what its totals are quoted in; shared
 * garages belong to someone else and keep theirs.
 */
export function useProfileUpdate() {
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
      haptic.success();
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
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xl },
  group: {
    borderRadius: radius.xxl,
    overflow: 'hidden',
    gap: StyleSheet.hairlineWidth,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
  },
  stackedRow: {
    gap: spacing.md,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
  },
  stackedTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  baysTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bays: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  bay: { width: 18, height: 18, borderRadius: 6 },
  track: { height: 8, borderRadius: 999, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 999 },
});
