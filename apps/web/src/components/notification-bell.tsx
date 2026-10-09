'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Bell } from 'lucide-react';
import type { Notification } from '@vehicle-os/contracts';
import type { NotificationType } from '@vehicle-os/domain';
import { notificationsQuery, queryKeys, unreadCountQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { Emoji, type EmojiName } from '@/components/emoji';
import { Icon } from '@/components/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/motion/popover';
import { scheduleEmoji } from '@/components/vehicle/schedule-row';
import { Button, buttonClass } from '@/components/ui/primitives';
import { Loading, Skeleton } from '@/components/ui/skeleton';
import { raise } from '@/components/ui/toaster';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const LIST_FILTERS = { limit: 30 };
const pad = (value: number) => String(value).padStart(2, '0');

type Tone = 'destructive' | 'warning' | 'neutral';

/** What each kind of notice looks like: its glyph, its name in a word or two, and how loud it is. */
const KINDS: Record<NotificationType, { emoji: EmojiName; label: string; tone: Tone }> = {
  MAINTENANCE_DUE: { emoji: 'maintenance', label: 'Service due', tone: 'warning' },
  MAINTENANCE_OVERDUE: { emoji: 'maintenance', label: 'Overdue', tone: 'destructive' },
  TASK_DUE: { emoji: 'calendar', label: 'Task due', tone: 'warning' },
  TASK_OVERDUE: { emoji: 'calendar', label: 'Task late', tone: 'destructive' },
  DOCUMENT_EXPIRING: { emoji: 'note', label: 'Expiring', tone: 'warning' },
  REGISTRATION_EXPIRING: { emoji: 'registration', label: 'Registration', tone: 'warning' },
  INSURANCE_EXPIRING: { emoji: 'insurance', label: 'Insurance', tone: 'warning' },
  WARRANTY_EXPIRING: { emoji: 'purchase', label: 'Warranty', tone: 'warning' },
  HEALTH_CHANGED: { emoji: 'inspection', label: 'Health', tone: 'neutral' },
  GARAGE_BRIEFING: { emoji: 'note', label: 'Briefing', tone: 'neutral' },
  MEMBER_INVITED: { emoji: 'note', label: 'Invite', tone: 'neutral' },
  RECALL: { emoji: 'inspection', label: 'Possible recall', tone: 'warning' },
};

const TILE: Record<Tone, string> = {
  destructive: 'bg-destructive-soft',
  warning: 'bg-warning-soft',
  neutral: 'bg-muted',
};

const CHIP: Record<Tone, string> = {
  destructive: 'bg-destructive-soft text-destructive',
  warning: 'bg-warning-soft text-warning',
  neutral: 'bg-muted text-muted-foreground',
};

/**
 * The notice as it should read. An expiry notice that has already passed is louder than its type
 * says, and a service notice takes the glyph of the job it is about.
 */
function describe(notification: Notification) {
  const kind = KINDS[notification.notificationType] ?? KINDS.GARAGE_BRIEFING;
  const days = notification.payload.daysRemaining;
  const expired = typeof days === 'number' && days < 0;
  const service = notification.notificationType.startsWith('MAINTENANCE');
  return {
    emoji: service ? scheduleEmoji(notification.title) : kind.emoji,
    label: expired ? 'Expired' : kind.label,
    tone: expired ? ('destructive' as const) : kind.tone,
  };
}

/** Where pressing the notice goes: the thing it is about, as near as the notice can say. */
function destination(notification: Notification): string | null {
  const { vehicleId, garageId, payload } = notification;
  if (vehicleId && typeof payload.documentId === 'string')
    return `/vehicles/${vehicleId}/documents`;
  if (vehicleId) return `/vehicles/${vehicleId}`;
  if (garageId) return `/garages/${garageId}`;
  return null;
}

const DAY = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", "This week", "Earlier" — counted between local midnights. */
function dayGroup(iso: string): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor((today - new Date(iso).getTime()) / DAY) + 1;
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

/** A clock-sized age for the corner of a row: `now`, `12m`, `3h`, `2d`, then the date. */
function age(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'all' | 'unread'>('all');

  const count = useQuery({
    ...unreadCountQuery(api),
    // The scan that produces these runs daily, so a minute of staleness costs nothing and
    // saves a request on every navigation.
    staleTime: 60_000,
  });
  // The list is only fetched once the panel is actually opened.
  const notifications = useQuery({ ...notificationsQuery(api, LIST_FILTERS), enabled: open });

  /*
   * Reading is optimistic. The row and the badge change on the press — waiting a round trip to
   * un-bold a line reads as the press being missed — and both roll back if the server refuses.
   * The result is the screen, so the global toast stays quiet unless it fails.
   */
  function markLocally(ids: 'all' | string) {
    const listKey = queryKeys.notifications(LIST_FILTERS);
    const countKey = queryKeys.unreadCount();
    const previous = {
      list: queryClient.getQueryData<Notification[]>(listKey),
      count: queryClient.getQueryData<{ unread: number }>(countKey),
    };
    const now = new Date().toISOString();
    queryClient.setQueryData<Notification[]>(listKey, (list) =>
      list?.map((item) =>
        !item.readAt && (ids === 'all' || item.id === ids) ? { ...item, readAt: now } : item,
      ),
    );
    queryClient.setQueryData<{ unread: number }>(countKey, (current) =>
      current ? { unread: ids === 'all' ? 0 : Math.max(0, current.unread - 1) } : current,
    );
    return () => {
      queryClient.setQueryData(listKey, previous.list);
      queryClient.setQueryData(countKey, previous.count);
    };
  }

  const settle = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const fail = (error: Error, _variables: unknown, rollback: (() => void) | undefined) => {
    rollback?.();
    raise('error', error.message);
  };

  const markRead = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    meta: { toast: false },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      return markLocally(id);
    },
    onError: fail,
    onSettled: settle,
  });
  const markAllRead = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    meta: { toast: false },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      return markLocally('all');
    },
    onError: fail,
    onSettled: settle,
  });

  const unread = count.data?.unread ?? 0;
  const all = notifications.data ?? [];
  const shown = view === 'unread' ? all.filter((item) => !item.readAt) : all;
  const groups = groupByDay(shown);

  return (
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="end">
      <PopoverTrigger>
        <button
          type="button"
          // The count belongs in the name, not only in the badge — the badge is a visual
          // affordance a screen reader has no reason to read as a number beside the icon.
          aria-label={unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`}
          className={buttonClass('ghost', 'icon', 'group rounded-full')}
        >
          {/* Swings from its hanger on hover, the way a bell would. */}
          <Bell
            className="size-4 origin-top transition-transform duration-300 ease-out group-hover:rotate-12"
            aria-hidden="true"
          />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              // The ring is the header's own colour, cutting the badge out of the bell so the
              // two shapes do not merge into one blob at 16px.
              className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 tabular-nums text-destructive-foreground ring-2 ring-background"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-80 max-w-[calc(100vw-1.5rem)] p-1.5 sm:w-[23rem]">
        <div className="flex items-start justify-between gap-2 px-2.5 pb-2 pt-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Notifications
            </h2>
            <p className="mt-0.5 font-mono text-xs uppercase tabular-nums text-muted-foreground">
              {unread > 0 ? `${pad(unread)} unread` : 'All caught up'}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={unread === 0}
            onClick={() => markAllRead.mutate()}
          >
            <Icon name="check" size={16} />
            Mark all read
          </Button>
        </div>

        <div className="px-2.5 pb-2">
          <div role="group" aria-label="Show" className="flex gap-0.5 rounded-full bg-muted p-1">
            {(['all', 'unread'] as const).map((option) => {
              const selected = view === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setView(option)}
                  className={cn(
                    'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full text-xs font-semibold transition-colors',
                    selected
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option === 'all' ? 'All' : 'Unread'}
                  {option === 'unread' && unread > 0 ? (
                    <span className="font-mono tabular-nums">{unread}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/*
         * A fixed height, so the panel does not grow and shrink under the pointer as it loads or
         * as the view changes between all and unread.
         */}
        <div className="scrollbar-slim h-[min(26rem,60dvh)] overflow-y-auto overscroll-contain">
          {notifications.isPending ? (
            <Loading label="Loading notifications">
              <ul className="flex flex-col gap-1 p-1">
                {Array.from({ length: 4 }, (_, index) => (
                  <li key={index} className="flex gap-3 p-2.5">
                    <Skeleton className="size-10 shrink-0 rounded-xl" />
                    <div className="flex flex-1 flex-col gap-2 pt-0.5">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-4 w-20 rounded-full" />
                    </div>
                  </li>
                ))}
              </ul>
            </Loading>
          ) : notifications.isError ? (
            <Quiet
              emoji="note"
              title="Could not load notifications"
              description={(notifications.error as Error).message}
              action={
                <Button size="sm" onClick={() => void notifications.refetch()}>
                  <Icon name="refresh" size={16} />
                  Try again
                </Button>
              }
            />
          ) : shown.length === 0 ? (
            view === 'unread' && all.length > 0 ? (
              <Quiet
                emoji="calendar"
                title="Nothing unread"
                description="Everything here has been seen."
                action={
                  <Button size="sm" onClick={() => setView('all')}>
                    Show all {all.length}
                  </Button>
                }
              />
            ) : (
              <Quiet
                emoji="maintenance"
                title="You're all caught up"
                description="Services coming due, tasks running late and documents about to expire land here."
              />
            )
          ) : (
            <div className="flex flex-col gap-2 pb-1">
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h3 className="sticky top-0 z-10 bg-popover/90 px-2.5 py-1.5 text-label uppercase text-muted-foreground backdrop-blur">
                    {group.label}
                  </h3>
                  <ul className="flex flex-col gap-0.5">
                    {group.items.map((notification, index) => (
                      <NotificationRow
                        key={notification.id}
                        notification={notification}
                        index={index}
                        onRead={() => markRead.mutate(notification.id)}
                        onOpen={() => {
                          if (!notification.readAt) markRead.mutate(notification.id);
                          setOpen(false);
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  notification,
  index,
  onRead,
  onOpen,
}: {
  notification: Notification;
  index: number;
  onRead: () => void;
  onOpen: () => void;
}) {
  const { emoji, label, tone } = describe(notification);
  const href = destination(notification);
  const unread = !notification.readAt;

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn('relative grid size-10 shrink-0 place-items-center rounded-xl', TILE[tone])}
      >
        <Emoji name={emoji} size={22} />
        {unread ? (
          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-foreground ring-2 ring-popover" />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              'min-w-0 truncate text-sm',
              unread ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
            )}
          >
            {unread ? <span className="sr-only">Unread: </span> : null}
            {notification.title}
          </span>
          <time
            dateTime={notification.createdAt}
            title={formatRelative(notification.createdAt)}
            className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-muted-foreground"
          >
            {age(notification.createdAt)}
          </time>
        </span>
        <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {notification.body}
        </span>
        <span className="mt-1.5 flex items-center gap-2">
          <span
            className={cn('rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold', CHIP[tone])}
          >
            {label}
          </span>
          {href ? (
            <span className="inline-flex items-center gap-0.5 text-[0.6875rem] font-semibold text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:hidden">
              Open
              <Icon name="chevronRight" size={12} />
            </span>
          ) : null}
        </span>
      </span>
    </>
  );

  const rowClass = cn(
    'flex w-full gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-muted',
    unread && href && 'pr-10',
  );

  return (
    <li className="stagger group relative animate-rise" style={{ '--i': index } as CSSProperties}>
      {href ? (
        <Link href={href} onClick={onOpen} className={rowClass}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onOpen} className={rowClass}>
          {body}
        </button>
      )}

      {/*
       * A sibling laid over the row, not a button inside the link: marking read without leaving is
       * its own action. Shown on hover where hovering exists, always where it does not.
       */}
      {unread && href ? (
        <button
          type="button"
          onClick={onRead}
          aria-label={`Mark “${notification.title}” read`}
          title="Mark read"
          className={buttonClass(
            'ghost',
            'icon-sm',
            'absolute right-1.5 top-2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        >
          <Icon name="check" size={16} />
        </button>
      ) : null}
    </li>
  );
}

/** An empty or error state sized for the panel: a tile, a line, a sentence, maybe a way out. */
function Quiet({
  emoji,
  title,
  description,
  action,
}: {
  emoji: EmojiName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span
        aria-hidden="true"
        className="grid size-14 animate-pop place-items-center rounded-2xl bg-muted"
      >
        <Emoji name={emoji} size={28} />
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mx-auto mt-1 max-w-64 text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Consecutive runs by day bucket; the list arrives newest first, so order is kept as it comes. */
function groupByDay(items: readonly Notification[]) {
  const groups: { label: string; items: Notification[] }[] = [];
  for (const item of items) {
    const label = dayGroup(item.createdAt);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1)!.items.push(item);
  }
  return groups;
}
