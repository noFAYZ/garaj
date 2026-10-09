import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import type { Notification } from '@vehicle-os/contracts';
import { notificationsQuery, queryKeys, unreadCountQuery } from '@vehicle-os/api-client/react';
import { dayBucket, shortAge } from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { jobEmoji, NOTICE } from '@/lib/emoji';
import { Eyebrow, Glyph, Segmented, ToneChip, ToneTile, type Tone } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

const FILTERS = { limit: 50 };
const pad = (value: number) => String(value).padStart(2, '0');

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
 * Notifications, the web's panel as a screen: grouped by day, each notice a tinted glyph, what it
 * is about, how long ago, and a chip saying what kind. Pressing one reads it and opens the vehicle
 * it concerns. Reading is optimistic, so the badge and the row change under the thumb and roll
 * back only if the server refuses.
 */
export default function NotificationsScreen() {
  const theme = useTheme();
  const router = useRouter();
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
  const sections: { title: string; data: Notification[] }[] = [];
  for (const item of shown) {
    const title = dayBucket(item.createdAt);
    if (sections.at(-1)?.title !== title) sections.push({ title, data: [] });
    sections.at(-1)!.data.push(item);
  }

  const open = (notification: Notification) => {
    if (!notification.readAt) markRead.mutate(notification.id);
    if (notification.vehicleId) {
      router.push({ pathname: '/vehicle/[id]', params: { id: notification.vehicleId } });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerRight: () =>
            unread > 0 ? (
              <PressableScale
                onPress={() => markAll.mutate()}
                accessibilityRole="button"
                accessibilityLabel="Mark all read"
                style={[styles.headerButton, { backgroundColor: theme.muted }]}
              >
                <Text style={[typeScale.label, { color: theme.foreground }]}>Mark all read</Text>
              </PressableScale>
            ) : null,
        }}
      />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ padding: spacing.md, paddingTop: 0, gap: spacing.sm, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={list.isFetching && !list.isPending}
            onRefresh={() => {
              void list.refetch();
              void count.refetch();
            }}
            tintColor={theme.mutedForeground}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm }}>
            <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>
              {unread > 0 ? `${pad(unread)} UNREAD` : 'ALL CAUGHT UP'}
            </Text>
            <Segmented
              value={view}
              options={[
                { value: 'all', label: 'All' },
                { value: 'unread', label: unread > 0 ? `Unread ${unread}` : 'Unread' },
              ]}
              onChange={setView}
            />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: theme.background, paddingVertical: spacing.xs }}>
            <Eyebrow>{section.title}</Eyebrow>
          </View>
        )}
        renderItem={({ item, index }) => (
          <Rise index={index}>
            <NoticeRow
              notification={item}
              onOpen={() => open(item)}
              onRead={() => markRead.mutate(item.id)}
            />
          </Rise>
        )}
        ListEmptyComponent={
          list.isPending ? (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Loading notifications"
              style={{ gap: spacing.sm }}
            >
              {Array.from({ length: 4 }, (_, index) => (
                <View key={index} style={[styles.row, { backgroundColor: theme.card }]}>
                  <Skeleton width={44} height={44} radius={13} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Skeleton width="60%" height={14} />
                    <Skeleton width="90%" height={12} />
                    <Skeleton width={70} height={16} radius={999} />
                  </View>
                </View>
              ))}
            </View>
          ) : list.isError ? (
            <Quiet
              glyph="📝"
              title="Could not load notifications"
              description={(list.error as Error).message}
              action="Try again"
              onAction={() => void list.refetch()}
            />
          ) : view === 'unread' && all.length > 0 ? (
            <Quiet
              glyph="🗓️"
              title="Nothing unread"
              description="Everything here has been seen."
              action={`Show all ${all.length}`}
              onAction={() => setView('all')}
            />
          ) : (
            <Quiet
              glyph="🔧"
              title="You're all caught up"
              description="Due services, late tasks, expiring documents."
            />
          )
        }
      />
    </View>
  );
}

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

  return (
    <View style={[styles.row, { backgroundColor: theme.card }]}>
      <PressableScale
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Unread: ' : ''}${notification.title}. ${notification.body}`}
        accessibilityHint={notification.vehicleId ? 'Opens the vehicle' : undefined}
        scaleTo={0.98}
        style={styles.rowBody}
      >
        <ToneTile tone={tone} dot={unread}>
          <Glyph>{emoji}</Glyph>
        </ToneTile>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.titleRow}>
            <Text
              numberOfLines={1}
              style={[
                typeScale.label,
                {
                  flex: 1,
                  color: unread ? theme.foreground : theme.mutedForeground,
                  fontWeight: unread ? '700' : '500',
                },
              ]}
            >
              {notification.title}
            </Text>
            <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>
              {shortAge(notification.createdAt)}
            </Text>
          </View>
          <Text numberOfLines={2} style={[typeScale.caption, { color: theme.mutedForeground }]}>
            {notification.body}
          </Text>
          <View style={{ marginTop: 3 }}>
            <ToneChip tone={tone} label={label} />
          </View>
        </View>
      </PressableScale>

      {/* Reading without leaving is its own action, beside the row rather than inside it. */}
      {unread ? (
        <PressableScale
          onPress={() => {
            haptic.selection();
            onRead();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Mark ${notification.title} read`}
          scaleTo={0.85}
          hitSlop={8}
          style={[styles.readButton, { backgroundColor: theme.muted }]}
        >
          <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>✓</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

function Quiet({
  glyph,
  title,
  description,
  action,
  onAction,
}: {
  glyph: string;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.quiet}>
      <ToneTile tone="neutral" size={48}>
        <Glyph size={24}>{glyph}</Glyph>
      </ToneTile>
      <Text style={[typeScale.headline, { color: theme.foreground, textAlign: 'center' }]}>
        {title}
      </Text>
      <Text style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}>
        {description}
      </Text>
      {action && onAction ? (
        <PressableScale
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={action}
          style={[styles.headerButton, { backgroundColor: theme.muted, marginTop: spacing.xs }]}
        >
          <Text style={[typeScale.label, { color: theme.foreground }]}>{action}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.lg,
    padding: 12,
  },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  readButton: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButton: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quiet: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl * 2,
  },
});
