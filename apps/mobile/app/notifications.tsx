import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Notification } from '@vehicle-os/contracts';
import { notificationsQuery, queryKeys, unreadCountQuery } from '@vehicle-os/api-client/react';
import { dayBucket, shortAge } from '@vehicle-os/ui';
import { Group, groupSurface, SettingsHeader, SettingsWash } from '@/components/settings-kit';
import { api } from '@/lib/api';
import { jobEmoji, NOTICE } from '@/lib/emoji';
import { Glyph, Segmented, type Tone } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

const FILTERS = { limit: 50 };

function describe(notification: Notification): { emoji: string; label: string; tone: Tone } {
  const kind = NOTICE[notification.notificationType] ?? NOTICE.GARAGE_BRIEFING;
  const days = notification.payload.daysRemaining;
  const expired = typeof days === 'number' && days < 0;
  return {
    emoji: notification.notificationType.startsWith('MAINTENANCE')
      ? jobEmoji(notification.title)
      : kind.emoji,
    label: expired ? 'Expired' : kind.label,
    tone: expired ? 'destructive' : kind.tone,
  };
}

/**
 * Notifications, in the settings' own clothes: the way back, the title and one action — read
 * them all — then all or only the unread, and the notices by day, each day one soft card of slim
 * rows. A row is the notice's glyph on a quiet tile (a copper dot on it while unread), what it is
 * about with its age, and one line under it — its kind in the colour of how pressing it is, then
 * what it says. A press reads it and opens the vehicle it is about; a long press only reads it.
 * Reading is optimistic: the dot goes under the thumb, and comes back only if the server refuses.
 */
export default function NotificationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'all' | 'unread'>('all');

  const list = useQuery(notificationsQuery(api, FILTERS));
  const count = useQuery(unreadCountQuery(api));
  const unread = count.data?.unread ?? (list.data ?? []).filter((item) => !item.readAt).length;

  function markLocally(target: 'all' | string) {
    const listKey = queryKeys.notifications(FILTERS);
    const countKey = queryKeys.unreadCount();
    const previous = {
      list: queryClient.getQueryData<Notification[]>(listKey),
      count: queryClient.getQueryData<{ unread: number }>(countKey),
    };
    const now = new Date().toISOString();
    queryClient.setQueryData<Notification[]>(listKey, (items) =>
      items?.map((item) =>
        !item.readAt && (target === 'all' || item.id === target) ? { ...item, readAt: now } : item,
      ),
    );
    queryClient.setQueryData<{ unread: number }>(countKey, (current) =>
      current ? { unread: target === 'all' ? 0 : Math.max(0, current.unread - 1) } : current,
    );
    return () => {
      queryClient.setQueryData(listKey, previous.list);
      queryClient.setQueryData(countKey, previous.count);
    };
  }

  const settle = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      return markLocally(id);
    },
    onError: (_error, _id, rollback) => rollback?.(),
    onSettled: settle,
  });
  const markAll = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      haptic.success();
      return markLocally('all');
    },
    onError: (_error, _variables, rollback) => rollback?.(),
    onSettled: settle,
  });

  const all = list.data ?? [];
  const shown = view === 'unread' ? all.filter((item) => !item.readAt) : all;
  const days: { title: string; items: Notification[] }[] = [];
  for (const item of shown) {
    const title = dayBucket(item.createdAt);
    if (days.at(-1)?.title !== title) days.push({ title, items: [] });
    days.at(-1)!.items.push(item);
  }

  const open = (notification: Notification) => {
    if (!notification.readAt) markRead.mutate(notification.id);
    if (notification.vehicleId) {
      router.push({ pathname: '/vehicle/[id]', params: { id: notification.vehicleId } });
    }
  };
  const read = (notification: Notification) => {
    haptic.selection();
    markRead.mutate(notification.id);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Its own header, as the settings draw theirs: back, the title, and read-all beside it. */}
      <Stack.Screen options={{ headerShown: false }} />
      <SettingsWash />
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={list.isFetching && !list.isPending}
            onRefresh={() => {
              void list.refetch();
              void count.refetch();
            }}
            tintColor={theme.mutedForeground}
            progressViewOffset={insets.top}
          />
        }
        contentContainerStyle={[
          styles.page,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl,
          },
        ]}
      >
        <SettingsHeader
          title="Notifications"
          trailing={
            unread > 0 ? (
              <PressableScale
                onPress={() => markAll.mutate()}
                accessibilityRole="button"
                accessibilityLabel={`Mark all ${unread} read`}
                hitSlop={6}
                scaleTo={0.94}
                style={[styles.readAll, groupSurface(theme)]}
              >
                <Ionicons name="checkmark-done" size={16} color={theme.foreground} />
                <Text style={[typeScale.label, { color: theme.foreground }]}>Read all</Text>
              </PressableScale>
            ) : null
          }
        />

        <Rise index={1}>
          <Segmented
            small
            value={view}
            options={[
              { value: 'all', label: 'All', said: `All, ${all.length}` },
              {
                value: 'unread',
                label: unread > 0 ? `Unread · ${unread}` : 'Unread',
                said: `Unread, ${unread}`,
              },
            ]}
            onChange={setView}
          />
        </Rise>

        {list.isPending ? (
          <Rise index={2}>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Loading notifications"
              style={[styles.card, groupSurface(theme)]}
            >
              {Array.from({ length: 4 }, (_, index) => (
                <View key={index} style={styles.notice}>
                  <Skeleton width={38} height={38} radius={12} />
                  <View style={{ flex: 1, gap: 7 }}>
                    <Skeleton width="58%" height={13} />
                    <Skeleton width="82%" height={11} />
                  </View>
                </View>
              ))}
            </View>
          </Rise>
        ) : list.isError ? (
          <Quiet
            icon="cloud-offline-outline"
            title="Couldn’t load notifications"
            line={(list.error as Error).message}
            action="Try again"
            onAction={() => void list.refetch()}
          />
        ) : days.length === 0 ? (
          view === 'unread' && all.length > 0 ? (
            <Quiet
              icon="mail-open-outline"
              title="Nothing unread"
              line="Everything here has been seen."
              action={`Show all ${all.length}`}
              onAction={() => setView('all')}
            />
          ) : (
            <Quiet
              icon="notifications-outline"
              title="You’re all caught up"
              line="Due services, late tasks and expiring papers land here."
            />
          )
        ) : (
          days.map((day, place) => (
            <Group key={day.title} title={day.title} index={place + 2}>
              {day.items.map((item) => (
                <NoticeRow
                  key={item.id}
                  notification={item}
                  onOpen={() => open(item)}
                  onRead={() => read(item)}
                />
              ))}
            </Group>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/**
 * One notice, slim: its glyph on a quiet tile with a copper dot while unread, what it is about —
 * bold until read — and its age, then one line: its kind, coloured by how pressing it is, and what
 * it says. A press opens it; a long press, or a screen reader's action, only reads it.
 */
function NoticeRow({
  notification,
  onOpen,
  onRead,
}: {
  notification: Notification;
  onOpen: () => void;
  onRead: () => void;
}) {
  const theme = useTheme();
  const { emoji, label, tone } = describe(notification);
  const unread = !notification.readAt;
  const ink =
    tone === 'destructive'
      ? theme.destructive
      : tone === 'warning'
        ? theme.warning
        : tone === 'success'
          ? theme.success
          : theme.mutedForeground;

  return (
    <PressableScale
      onPress={onOpen}
      onLongPress={unread ? onRead : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${label}: ${notification.title}. ${notification.body}`}
      accessibilityHint={notification.vehicleId ? 'Opens the vehicle' : undefined}
      accessibilityActions={unread ? [{ name: 'read', label: 'Mark read' }] : undefined}
      onAccessibilityAction={unread ? onRead : undefined}
      scaleTo={0.99}
      style={styles.notice}
    >
      <View style={[styles.tile, { backgroundColor: theme.muted }]}>
        <Glyph size={18}>{emoji}</Glyph>
        {unread ? (
          <View style={[styles.dot, { backgroundColor: theme.primary, borderColor: theme.card }]} />
        ) : null}
      </View>
      <View style={styles.words}>
        <View style={styles.top}>
          <Text
            numberOfLines={1}
            style={[
              styles.title,
              unread
                ? { color: theme.foreground, fontWeight: '600' }
                : { color: theme.mutedForeground, fontWeight: '500' },
            ]}
          >
            {notification.title}
          </Text>
          <Text style={[figure, styles.age, { color: theme.mutedForeground }]}>
            {shortAge(notification.createdAt)}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.line, { color: theme.mutedForeground }]}>
          {/* Its own weight: a nested Text is given the regular face unless it names one. */}
          <Text style={{ fontWeight: '600', color: ink }}>{label}</Text>
          {` · ${notification.body}`}
        </Text>
      </View>
    </PressableScale>
  );
}

/** Nothing to show, said once, quietly: an icon in a soft circle, a line, and maybe a way on. */
function Quiet({
  icon,
  title,
  line,
  action,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  line: string;
  action?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <Rise index={2} style={styles.quiet}>
      <View style={[styles.quietMark, groupSurface(theme)]}>
        <Ionicons name={icon} size={26} color={theme.mutedForeground} />
      </View>
      <Text style={[typeScale.headline, { color: theme.foreground, textAlign: 'center' }]}>
        {title}
      </Text>
      <Text style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}>
        {line}
      </Text>
      {action && onAction ? (
        <PressableScale
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={action}
          scaleTo={0.94}
          style={[styles.readAll, groupSurface(theme), { marginTop: spacing.xs }]}
        >
          <Text style={[typeScale.label, { color: theme.foreground }]}>{action}</Text>
        </PressableScale>
      ) : null}
    </Rise>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, gap: spacing.lg + 2 },
  readAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: { borderRadius: radius.xl + 2, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 62,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  tile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
  },
  words: { flex: 1, minWidth: 0, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  title: { flex: 1, fontSize: 14.5, lineHeight: 20, letterSpacing: -0.1 },
  age: { fontSize: 11.5, lineHeight: 16, fontWeight: '500' },
  line: { fontSize: 12.5, lineHeight: 17 },
  quiet: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl * 2,
  },
  quietMark: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
