import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Children, Fragment, useEffect, useState, type ReactNode } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { queryKeys } from '@vehicle-os/api-client/react';
import type { Garage, UpdateUserProfile, UserProfile } from '@vehicle-os/contracts';
import { deleteAccount, signOut } from '@/lib/auth';
import { haptic, Pop, PressableScale, Pulse, Rise, useReduceMotion } from '@/lib/motion';
import { dialog } from '@/lib/dialog';
import { flagUrl } from '@/lib/locale-options';
import { clearQueue, enqueue, flush, pendingCount } from '@/lib/offline';
import type { ListOption } from '@/lib/pickers';
import { figure, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

/*
 * The pieces every settings screen is built from, so the tree reads as one place: a soft card of
 * rows under a quiet name, hairlines between them, and a row that names a thing — a line icon, the
 * word — and shows its value, a control or the way in.
 */

export type IconName = keyof typeof Ionicons.glyphMap;
export type RowTone = 'success' | 'warning' | 'destructive';

/**
 * A pushed settings screen: the stack's header above, the home indicator's room below. With a
 * `title` it draws the settings' own header instead — its route hides the stack's.
 */
export function SettingsPage({ title, children }: { title?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      // The app's backdrop shows through, as on every screen.
      style={{ backgroundColor: 'transparent' }}
      // A row under the search field takes the first tap, not the keyboard.
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.page,
        title ? { paddingTop: insets.top + spacing.sm } : null,
        { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
      ]}
    >
      {title ? <SettingsHeader title={title} /> : null}
      {children}
    </ScrollView>
  );
}

/**
 * A settings screen's own header, where it draws one: the way back in a soft round key, the title
 * beside it, large, and at the far side the screen's one action, if it has one. Back goes where
 * the person came from — or home, with nowhere to go back. No title leaves the key alone.
 */
export function SettingsHeader({ title, trailing }: { title?: string; trailing?: ReactNode }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Rise style={styles.header}>
      <HeaderKey
        icon="arrow-back"
        label="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
      />
      {title ? (
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[styles.title, { flexShrink: 1, color: theme.foreground }]}
        >
          {title}
        </Text>
      ) : null}
      {trailing ? <View style={styles.headerAction}>{trailing}</View> : null}
    </Rise>
  );
}

/**
 * A header's round key — back, and the screen's own actions beside the title — so every key in a
 * header is the same soft disc. `color` tints the icon alone: delete in red.
 */
export function HeaderKey({
  icon,
  label,
  onPress,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      scaleTo={0.9}
      style={[styles.back, groupSurface(theme)]}
    >
      <Ionicons name={icon} size={19} color={color ?? theme.foreground} />
    </PressableScale>
  );
}

/**
 * The stack's own header, for every pushed screen that shows one: the settings' header — back in
 * its round key, the title large beside it, the screen's actions at the far side — rather than the
 * platform's bar, so a form, a document or an entry wears the same head as Settings. On the page's
 * backdrop, so it reads as part of the page. Set once, on the root stack.
 */
export function StackHeader({
  options,
}: {
  options: {
    title?: string;
    headerRight?: (props: { canGoBack: boolean; tintColor?: string }) => ReactNode;
  };
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.stackHeader, { paddingTop: insets.top + spacing.sm }]}>
      <SettingsHeader
        title={options.title || undefined}
        trailing={options.headerRight?.({ canGoBack: true })}
      />
    </View>
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

/**
 * A card's surface on a settings screen: plain white on the white page by day, edged by a hairline
 * (user asked for a white settings view); at night the resting card, a little of the page through.
 */
export const groupSurface = (theme: ReturnType<typeof useTheme>) =>
  theme.dark
    ? { backgroundColor: `${theme.card}E8`, borderColor: theme.hairline }
    : { backgroundColor: theme.cardRaised, borderColor: theme.border };

/** A currency's flag, as a small picture; see `flagUrl`. */
export function Flag({ currency, large = false }: { currency: string; large?: boolean }) {
  const theme = useTheme();
  return (
    <Image
      source={{ uri: flagUrl(currency) }}
      style={[large ? styles.flagLarge : styles.flag, { backgroundColor: theme.muted }]}
      contentFit="cover"
      cachePolicy="disk"
      accessibilityIgnoresInvertColors
    />
  );
}

/**
 * What a choice screen holds now, at its top: the picture, the name, a line about it, and its
 * figure in the mono at the right — the currency's code, the zone's clock.
 */
export function ChoiceHero({
  leading,
  title,
  caption,
  reading,
  loading = false,
}: {
  leading: ReactNode;
  title: string;
  caption: string;
  reading: string;
  loading?: boolean;
}) {
  const theme = useTheme();
  return (
    <Rise index={1}>
      <View
        accessible
        accessibilityLabel={loading ? 'Loading' : `${title}, ${caption}, ${reading}`}
        style={[styles.hero, groupSurface(theme)]}
      >
        <View style={styles.heroLead}>{leading}</View>
        {loading ? (
          <View style={{ flex: 1, gap: 7 }}>
            <Skeleton width={140} height={16} />
            <Skeleton width={180} height={11} />
          </View>
        ) : (
          <>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={1} style={[styles.heroTitle, { color: theme.foreground }]}>
                {title}
              </Text>
              <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
                {caption}
              </Text>
            </View>
            <Text style={[figure, styles.heroFigure, { color: theme.foreground }]}>{reading}</Text>
          </>
        )}
      </View>
    </Rise>
  );
}

/**
 * A long list to choose one from, on its own page: a search field, then the options on one card,
 * the chosen one ticked. `extra` turns a search that matches nothing into an option of its own,
 * for a value the list does not carry (the server still has the final say on it).
 */
export function ChoiceList({
  title,
  options,
  value,
  placeholder,
  leading,
  trailing,
  extra,
  onPick,
}: {
  title: string;
  options: readonly ListOption[];
  value: string | undefined;
  placeholder: string;
  leading: (option: ListOption) => ReactNode;
  trailing?: (option: ListOption) => string | null;
  extra?: (query: string) => ListOption | null;
  onPick: (value: string) => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? options.filter((option) =>
        [option.label, option.hint, option.value].some((text) =>
          text?.toLowerCase().includes(needle),
        ),
      )
    : options;
  const typed = needle && matches.length === 0 ? (extra?.(query.trim()) ?? null) : null;
  const shown = typed ? [typed] : matches;

  return (
    <>
      <Rise index={2}>
        <View style={[styles.search, groupSurface(theme)]}>
          <Ionicons name="search" size={16} color={theme.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder}
            placeholderTextColor={theme.mutedForeground}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel={placeholder}
            style={[styles.searchInput, { color: theme.foreground }]}
          />
          {query ? (
            <PressableScale
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={17} color={theme.mutedForeground} />
            </PressableScale>
          ) : null}
        </View>
      </Rise>

      {shown.length === 0 ? (
        <Text style={[typeScale.caption, styles.none, { color: theme.mutedForeground }]}>
          {`Nothing matches “${query.trim()}”`}
        </Text>
      ) : (
        <Group title={needle ? undefined : title} index={3}>
          {shown.map((option) => {
            const on = option.value === value;
            const time = trailing?.(option);
            return (
              <PressableScale
                key={option.value}
                onPress={() => {
                  haptic.selection();
                  onPick(option.value);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={[option.label, option.hint, time].filter(Boolean).join(', ')}
                scaleTo={0.99}
                style={[styles.row, on ? { backgroundColor: theme.primarySoft } : null]}
              >
                <View style={styles.choiceLead}>{leading(option)}</View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.label,
                      { color: theme.foreground, fontWeight: on ? '600' : '500' },
                    ]}
                  >
                    {option.label}
                  </Text>
                  {option.hint ? (
                    <Text
                      numberOfLines={1}
                      style={[typeScale.caption, { color: theme.mutedForeground }]}
                    >
                      {option.hint}
                    </Text>
                  ) : null}
                </View>
                {time ? (
                  <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>
                    {time}
                  </Text>
                ) : null}
                <View style={styles.check}>
                  {on ? <Ionicons name="checkmark" size={18} color={theme.primary} /> : null}
                </View>
              </PressableScale>
            );
          })}
        </Group>
      )}
    </>
  );
}

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
 * Asks before signing out, and says what it costs: entries still on this phone go with the session.
 * The same question from the settings root and from Account.
 */
export async function askToSignOut(leave: () => Promise<void>): Promise<void> {
  haptic.selection();
  const waiting = await pendingCount();
  dialog(
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
    { icon: 'log-out-outline' },
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
  const [leaving, setLeaving] = useState(false);
  /*
   * The local half runs whatever happened to the network half: `signOut` never throws, and a
   * refused deletion throws before anything here is touched — the account is still there.
   */
  const end = async (how: () => Promise<void>) => {
    setLeaving(true);
    try {
      await how();
      await clearQueue().catch(() => undefined);
      router.replace('/sign-in');
      queryClient.clear();
    } finally {
      setLeaving(false);
    }
  };
  return {
    leave: () => end(signOut),
    /** Deletes the account for good; rejects with the server's reason when it cannot. */
    remove: () => end(deleteAccount),
    leaving,
  };
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
  headerAction: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stackHeader: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  flag: { width: 24, height: 16, borderRadius: 3 },
  flagLarge: { width: 40, height: 28, borderRadius: 5 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
    ...leaf('md'),
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroLead: { width: 44, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.2 },
  heroFigure: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  none: { textAlign: 'center', paddingVertical: spacing.md },
  choiceLead: { width: 26, alignItems: 'center', justifyContent: 'center' },
  check: { width: 18, alignItems: 'center' },
  groupTitle: { fontSize: 13, lineHeight: 17, fontWeight: '500', paddingHorizontal: 4 },
  group: { ...leaf('md'), overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
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
