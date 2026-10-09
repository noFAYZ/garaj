import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownUp,
  BadgeCheck,
  BadgeX,
  Copy,
  MailCheck,
  ExternalLink,
  Fingerprint,
  Laptop,
  Mail,
  Smartphone,
  Star,
  Trash2,
  UserX,
  Warehouse,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button, EmptyState, Field } from '@/components/ui/primitives';
import { Readings } from '@/components/ui/overview';
import { SelectField } from '@/components/ui/select-field';
import { ListSkeleton, Loading, Skeleton } from '@/components/ui/skeleton';
import { raise } from '@/components/ui/toaster';
import { formatDate, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import { adminApi, get, type Plan, type UserDetail, type UserRow } from '../lib/api';
import { ago, formatCount, formatExact, shortDate } from '../lib/format';
import { useDeleteUser, useRevokeSessions, useSetPlan, useVerifyEmail } from '../lib/mutations';
import { useOverview } from '../lib/queries';
import { remember } from '../lib/recent';
import { closeDetail, href, setParams, useRoute } from '../lib/route';
import {
  DataTable,
  downloadCsv,
  ExportButton,
  fetchEvery,
  RowLink,
  rowClass,
  SearchField,
  Toolbar,
  useAdminList,
} from '../components/list';
import { SelectMenu } from '../components/menu';
import { openPalette } from '../components/palette';
import { Sheet, SheetHead, SheetSection } from '../components/sheet';
import {
  Chip,
  Confirm,
  CopyButton,
  Dot,
  Face,
  PageHeader,
  RowActions,
  Segmented,
} from '../components/ui';

/** Person · plan · garages · last seen · joined · ⋯ — the columns drop from the right as it narrows. */
const COLUMNS =
  'grid-cols-[minmax(0,1fr)_auto_2rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_4rem_8.5rem_2rem] lg:grid-cols-[minmax(0,1fr)_5.5rem_4rem_8.5rem_6rem_2rem]';

const DAY = 86_400_000;

const PLAN_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'FREE', label: 'Free' },
  { value: 'PLUS', label: 'Plus' },
  { value: 'BUSINESS', label: 'Business' },
  { value: 'PAID', label: 'Paid' },
] as const;
const STATUS_FILTERS = [
  { value: 'any', label: 'Any' },
  { value: 'true', label: 'Verified' },
  { value: 'false', label: 'Unverified' },
] as const;
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'seen', label: 'Recently seen' },
  { value: 'name', label: 'Name, A to Z' },
] as const;

type Pending = { kind: 'revoke' | 'delete'; user: Pick<UserRow, 'id' | 'name' | 'email'> } | null;

export function UsersPage() {
  const { id, params } = useRoute();
  const filters = {
    q: params.get('q') ?? '',
    plan: params.get('plan') ?? undefined,
    verified: params.get('verified') ?? undefined,
    sort: params.get('sort') ?? undefined,
  };
  const { list, rows, searching } = useAdminList<UserRow>('users', filters);
  const overview = useOverview().data;
  const counts = overview?.counts;
  const plans = overview?.plans;
  const [pending, setPending] = useState<Pending>(null);
  const verify = useVerifyEmail();
  const filtered = Boolean(filters.plan || filters.verified || searching);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Manage"
        title="Users"
        description={
          counts
            ? `${formatExact(counts.users)} accounts · ${formatCount(counts.newUsers)} joined in the last 7 days`
            : 'Every account on Garaj.'
        }
        actions={
          <ExportButton
            onExport={async () => {
              const all = await fetchEvery<UserRow>('users', filters);
              downloadCsv(
                'garaj-users',
                ['id', 'name', 'email', 'plan', 'verified', 'garages', 'joined', 'last seen'],
                all.map((u) => [
                  u.id,
                  u.name,
                  u.email,
                  u.plan,
                  u.emailVerified ? 'yes' : 'no',
                  u.garages,
                  u.createdAt,
                  u.lastSeenAt,
                ]),
              );
            }}
          />
        }
      />

      <Readings
        className="stagger animate-rise [--i:1]"
        readings={[
          {
            label: 'Accounts',
            value: counts ? formatExact(counts.users) : undefined,
            caption: 'all time',
            href: href('users'),
          },
          {
            label: 'New this week',
            value: counts ? formatCount(counts.newUsers) : undefined,
            caption: 'last 7 days',
            href: href('users', undefined, { sort: 'newest' }),
          },
          {
            label: 'Paid',
            value:
              plans && counts ? formatCount((plans.PLUS ?? 0) + (plans.BUSINESS ?? 0)) : undefined,
            caption: 'Plus and Business',
            href: href('users', undefined, { plan: 'PAID' }),
          },
          {
            label: 'Unverified',
            value: counts ? formatCount(counts.unverified) : undefined,
            tone: counts?.unverified ? 'warning' : undefined,
            caption: 'email not confirmed',
            href: href('users', undefined, { verified: 'false' }),
          },
          {
            label: 'Online now',
            value: counts ? formatCount(counts.online) : undefined,
            tone: counts?.online ? 'success' : undefined,
            caption: 'last 5 minutes',
            href: href('users', undefined, { sort: 'seen' }),
          },
        ]}
      />

      <Toolbar className="stagger [--i:2]">
        <SearchField
          label="Search by name or email"
          value={filters.q}
          onChange={(q) => setParams({ q })}
          className="min-w-56 flex-1"
        />
        <Segmented
          label="Plan"
          value={filters.plan ?? 'all'}
          onChange={(plan) => setParams({ plan: plan === 'all' ? null : plan })}
          options={PLAN_FILTERS}
        />
        <SelectMenu
          label="Email"
          icon={MailCheck}
          value={filters.verified ?? 'any'}
          onChange={(verified) => setParams({ verified: verified === 'any' ? null : verified })}
          options={STATUS_FILTERS}
        />
        <SelectMenu
          label="Sort"
          icon={ArrowDownUp}
          value={filters.sort ?? 'newest'}
          onChange={(sort) => setParams({ sort: sort === 'newest' ? null : sort })}
          options={SORTS}
        />
      </Toolbar>

      <DataTable
        label="users"
        list={list}
        rows={rows}
        rowKey={(user) => user.id}
        columns={COLUMNS}
        head={
          <>
            <span>Person</span>
            <span>Plan</span>
            <span className="text-right max-sm:hidden">Garages</span>
            <span className="max-sm:hidden">Last seen</span>
            <span className="text-right max-lg:hidden">Joined</span>
            <span />
          </>
        }
        empty={{
          title: filtered ? 'Nobody matches' : 'No users yet',
          description: filtered
            ? 'Try another search, or clear the filters.'
            : 'Accounts appear here as people sign up.',
          action: filtered ? (
            <Button onClick={() => setParams({ q: null, plan: null, verified: null })}>
              Clear filters
            </Button>
          ) : undefined,
        }}
      >
        {(user) => {
          // Seen today reads as live: a session moves at most once a day, so this is as fresh as it gets.
          const recent = user.lastSeenAt !== null && Date.now() - Date.parse(user.lastSeenAt) < DAY;
          return (
            <>
              <RowLink
                href={href('users', user.id, params)}
                label={`Open ${user.name || user.email}`}
              />
              <div className={cn(rowClass, COLUMNS)}>
                <span className="flex min-w-0 items-center gap-3">
                  <Face id={user.id} image={user.image} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {user.name || user.email}
                      </span>
                      {user.isAdmin ? <Chip tone="ink">Admin</Chip> : null}
                      {!user.emailVerified ? (
                        <span title="Email not verified" className="inline-flex">
                          <Dot tone="warning" className="size-1.5" />
                          <span className="sr-only">Email not verified</span>
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </span>
                </span>
                <span>
                  <Chip tone={user.plan === 'FREE' ? 'muted' : 'ink'}>{humanise(user.plan)}</Chip>
                </span>
                <span
                  className={cn(
                    'text-right font-mono text-sm tabular-nums max-sm:hidden',
                    user.garages === 0 && 'text-muted-foreground',
                  )}
                >
                  {user.garages}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground max-sm:hidden">
                  <Dot tone={recent ? 'success' : 'muted'} className="size-1.5" />
                  <span className="truncate">
                    {user.lastSeenAt ? ago(user.lastSeenAt) : 'Never'}
                  </span>
                </span>
                <span className="text-right font-mono text-xs tabular-nums text-muted-foreground max-lg:hidden">
                  {shortDate(user.createdAt)}
                </span>
                <RowActions
                  label={`Actions for ${user.name || user.email}`}
                  actions={[
                    {
                      label: 'Set plan…',
                      icon: Star,
                      onSelect: () => openPalette({ kind: 'plan', person: user }),
                    },
                    {
                      label: user.emailVerified ? 'Mark unverified' : 'Mark verified',
                      icon: user.emailVerified ? BadgeX : BadgeCheck,
                      onSelect: () =>
                        verify.mutate({ person: user, verified: !user.emailVerified }),
                    },
                    {
                      label: 'Copy email',
                      icon: Mail,
                      onSelect: () =>
                        void navigator.clipboard
                          .writeText(user.email)
                          .then(() => raise('success', 'Email copied')),
                    },
                    {
                      label: 'Copy id',
                      icon: Copy,
                      onSelect: () =>
                        void navigator.clipboard
                          .writeText(user.id)
                          .then(() => raise('success', 'Id copied')),
                    },
                    {
                      label: 'Sign out everywhere…',
                      icon: UserX,
                      onSelect: () => setPending({ kind: 'revoke', user }),
                    },
                    !user.isAdmin && {
                      label: 'Delete account…',
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => setPending({ kind: 'delete', user }),
                    },
                  ]}
                />
              </div>
            </>
          );
        }}
      </DataTable>

      {id ? <UserSheet id={id} rows={rows} onPending={setPending} /> : null}
      {pending ? <PendingAction pending={pending} onDone={() => setPending(null)} /> : null}
    </div>
  );
}

/** The confirmation behind a row's or a sheet's irreversible action. */
function PendingAction({ pending, onDone }: { pending: NonNullable<Pending>; onDone: () => void }) {
  const revoke = useRevokeSessions();
  const remove = useDeleteUser();
  const { user } = pending;
  const name = user.name || user.email;
  return pending.kind === 'revoke' ? (
    <Confirm
      title={`Sign ${name} out everywhere?`}
      description="Every device they are signed in on is signed out. Takes up to five minutes to reach a device mid-session."
      confirmLabel="Sign out everywhere"
      pending={revoke.isPending}
      error={revoke.error?.message}
      onClose={onDone}
      onConfirm={() => revoke.mutate({ person: user }, { onSuccess: onDone })}
    />
  ) : (
    <Confirm
      title={`Delete ${name}?`}
      description="Their sign-in, preferences, memberships and notifications go. The audit log keeps their email."
      confirmLabel="Delete for good"
      pending={remove.isPending}
      error={remove.error?.message}
      onClose={onDone}
      onConfirm={() =>
        remove.mutate(
          { person: user },
          {
            onSuccess: () => {
              onDone();
              if (window.location.hash.includes(user.id)) closeDetail();
            },
          },
        )
      }
    />
  );
}

// --- Detail ------------------------------------------------------------------------------

function UserSheet({
  id,
  rows,
  onPending,
}: {
  id: string;
  rows: UserRow[] | undefined;
  onPending: (pending: Pending) => void;
}) {
  const { params } = useRoute();
  const user = useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: () => get<UserDetail>(`/users/${id}`),
  });
  const verify = useVerifyEmail();
  const data = user.data;
  const index = rows?.findIndex((row) => row.id === id) ?? -1;
  const neighbour = (offset: number) => {
    const row = index === -1 ? undefined : rows?.[index + offset];
    return row ? href('users', row.id, params) : undefined;
  };
  const lastSeen = data?.sessions[0]?.updatedAt;

  useEffect(() => {
    if (data) {
      remember({
        kind: 'user',
        id: data.id,
        label: data.name || data.email,
        sub: data.email,
        image: data.image,
      });
    }
  }, [data]);

  return (
    <Sheet
      id={id}
      label={data ? data.name || data.email : 'User'}
      onClose={closeDetail}
      prev={index === -1 ? undefined : neighbour(-1)}
      next={index === -1 ? undefined : neighbour(1)}
    >
      {!data ? (
        user.isError ? (
          <div className="p-6">
            <EmptyState title="Couldn't load this user" description={user.error.message} />
          </div>
        ) : (
          <Loading label="Loading user">
            <div className="flex flex-col gap-4 p-6">
              <div className="flex items-center gap-4">
                <Skeleton className="size-14 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              </div>
              <ListSkeleton rows={4} />
            </div>
          </Loading>
        )
      ) : (
        <>
          <SheetHead
            lead={<Face id={data.id} image={data.image} size={56} />}
            title={data.name || data.email}
            subtitle={
              <>
                <span className="truncate">{data.email}</span>
                <CopyButton value={data.email} label="Copy email" />
              </>
            }
            badges={
              <>
                <Chip tone={(data.subscription?.plan ?? 'FREE') === 'FREE' ? 'muted' : 'ink'}>
                  {humanise(data.subscription?.plan ?? 'FREE')}
                </Chip>
                <Chip tone={data.emailVerified ? 'success' : 'warning'}>
                  {data.emailVerified ? 'Verified' : 'Unverified'}
                </Chip>
                {data.isAdmin ? <Chip tone="ink">Admin</Chip> : null}
                <span className="text-xs text-muted-foreground">
                  Joined {formatDate(data.createdAt)}
                  {lastSeen ? ` · seen ${ago(lastSeen)}` : ''}
                </span>
              </>
            }
            actions={
              <>
                <Button
                  size="sm"
                  loading={verify.isPending}
                  onClick={() => verify.mutate({ person: data, verified: !data.emailVerified })}
                >
                  {data.emailVerified ? (
                    <BadgeX className="size-4" aria-hidden="true" />
                  ) : (
                    <BadgeCheck className="size-4" aria-hidden="true" />
                  )}
                  {data.emailVerified ? 'Mark unverified' : 'Mark verified'}
                </Button>
                <Button
                  size="sm"
                  disabled={data.sessions.length === 0}
                  onClick={() => onPending({ kind: 'revoke', user: data })}
                >
                  <UserX className="size-4" aria-hidden="true" />
                  Sign out everywhere
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(data.id)
                      .then(() => raise('success', 'Id copied'))
                  }
                >
                  <Fingerprint className="size-4" aria-hidden="true" />
                  Copy id
                </Button>
              </>
            }
          />
          <PlanSection user={data} />
          <UsageSection user={data} />
          <SheetSection title="Garages" aside={<Count n={data.memberships.length} />}>
            {data.memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                They have not created or joined a garage yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.memberships.map((m) => (
                  <li key={m.garageId}>
                    <a
                      href={href('garages', m.garageId)}
                      className="flex items-center gap-3 rounded-xl bg-muted/50 p-3 transition-colors hover:bg-muted"
                    >
                      <span
                        aria-hidden="true"
                        className="grid size-9 shrink-0 place-items-center rounded-lg bg-card"
                      >
                        <Warehouse className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{m.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          <span className="font-mono tabular-nums">{m.vehicles}</span> vehicle
                          {m.vehicles === 1 ? '' : 's'}
                        </span>
                      </span>
                      <Chip tone={m.role === 'OWNER' ? 'ink' : 'muted'}>{humanise(m.role)}</Chip>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </SheetSection>
          <SheetSection title="Sessions" aside={<Count n={data.sessions.length} />}>
            {data.sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No device holds a live session for this account.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.sessions.map((s) => {
                  const what = device(s.userAgent);
                  return (
                    <li key={s.id} className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
                      <span
                        aria-hidden="true"
                        className="grid size-9 shrink-0 place-items-center rounded-lg bg-card"
                      >
                        {what.mobile ? (
                          <Smartphone className="size-4" />
                        ) : (
                          <Laptop className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{what.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.ipAddress ? (
                            <span className="font-mono">{s.ipAddress}</span>
                          ) : (
                            'No address'
                          )}{' '}
                          · signed in {formatDate(s.createdAt)}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        active {ago(s.updatedAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SheetSection>
          <SheetSection title="Phones for push" aside={<Count n={data.devices.length} />}>
            {data.devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None — reminders reach this account in the app and by email only.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {data.devices.map((phone, i) => (
                  <li key={i}>
                    <Chip>
                      <Smartphone className="size-3.5" aria-hidden="true" />
                      {phone.platform === 'ios' ? 'iPhone' : humanise(phone.platform)} · since{' '}
                      {shortDate(phone.createdAt)}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </SheetSection>
          <SheetSection title="Profile">
            <ProfileForm key={data.id} user={data} />
          </SheetSection>
          <SheetSection title="Danger zone">
            <DangerZone user={data} onDelete={() => onPending({ kind: 'delete', user: data })} />
          </SheetSection>
        </>
      )}
    </Sheet>
  );
}

const Count = ({ n }: { n: number }) => (
  <span className="font-mono text-xs tabular-nums text-muted-foreground">{n}</span>
);

const PLAN_NOTES: Record<Plan, string> = {
  FREE: 'The limits every new account starts on.',
  PLUS: 'More vehicles and garages, the paid extras.',
  BUSINESS: 'Fleets: drivers, income and trip purpose.',
};

function PlanSection({ user }: { user: UserDetail }) {
  const setPlan = useSetPlan();
  const current = user.subscription?.plan ?? 'FREE';
  const stripe = user.subscription?.stripeSubscriptionId;
  // Stripe is billing them: a plan set here would disagree with the bill, and the API refuses it.
  const billed = Boolean(
    stripe && ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(user.subscription?.status ?? ''),
  );
  const shown = setPlan.isPending ? setPlan.variables.plan : current;

  return (
    <SheetSection title="Plan" aside={billed ? <Chip tone="info">Billed by Stripe</Chip> : null}>
      <div
        className={cn(
          'flex flex-wrap items-center gap-3',
          billed && 'pointer-events-none opacity-60',
        )}
      >
        <Segmented
          label="Plan"
          value={shown}
          onChange={(plan) => {
            if (!billed && plan !== current) setPlan.mutate({ person: user, plan });
          }}
          options={(['FREE', 'PLUS', 'BUSINESS'] as const).map((plan) => ({
            value: plan,
            label: humanise(plan),
          }))}
        />
        <p className="text-xs text-muted-foreground">{PLAN_NOTES[shown]}</p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border/60 text-sm sm:grid-cols-4">
        {[
          ['Status', user.subscription ? humanise(user.subscription.status) : 'Never subscribed'],
          ['Billed through', stripe ? 'Stripe' : user.subscription ? 'Comped here' : '—'],
          [
            'Period ends',
            user.subscription?.currentPeriodEnd
              ? formatDate(user.subscription.currentPeriodEnd)
              : '—',
          ],
          ['Cancels at end', user.subscription?.cancelAtPeriodEnd ? 'Yes' : 'No'],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 bg-card p-3">
            <dt className="text-label uppercase text-muted-foreground">{label}</dt>
            <dd className="mt-1 truncate font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {billed ? (
        <p className="rounded-xl bg-info-soft p-3 text-sm text-info">
          Stripe bills this account, so its plan changes there — a plan set here would disagree with
          what they pay.{' '}
          {user.subscription?.stripeCustomerId ? (
            <a
              href={`https://dashboard.stripe.com/customers/${user.subscription.stripeCustomerId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
            >
              Open in Stripe
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </p>
      ) : null}
    </SheetSection>
  );
}

function UsageSection({ user }: { user: UserDetail }) {
  const { usage } = user;
  return (
    <SheetSection title="Last 30 days">
      <Readings
        readings={[
          {
            label: 'AI questions',
            value: formatCount(usage.aiRequests),
            caption: `${formatCount(usage.aiTokens)} tokens`,
          },
          { label: 'Emails', value: formatCount(usage.emails), caption: 'sent' },
          { label: 'Pushes', value: formatCount(usage.pushes), caption: 'sent' },
          { label: 'In-app', value: formatCount(usage.notifications), caption: 'notifications' },
        ]}
      />
    </SheetSection>
  );
}

/** "Chrome on Windows" from a user agent, or the raw string when it names neither. */
function device(agent: string | null): { name: string; mobile: boolean } {
  if (!agent) return { name: 'Unknown device', mobile: false };
  if (/okhttp|Expo|CFNetwork|Dalvik/i.test(agent))
    return { name: 'Garaj mobile app', mobile: true };
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Chrome\//.test(agent)
      ? 'Chrome'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Safari\//.test(agent)
          ? 'Safari'
          : null;
  const os = /Windows/.test(agent)
    ? 'Windows'
    : /Android/.test(agent)
      ? 'Android'
      : /iPhone|iPad/.test(agent)
        ? 'iOS'
        : /Mac OS/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : null;
  return {
    name: browser && os ? `${browser} on ${os}` : agent.slice(0, 60),
    mobile: /Android|iPhone|iPad/.test(agent),
  };
}

const DISTANCE = [
  { value: 'KM', label: 'Kilometres' },
  { value: 'MI', label: 'Miles' },
];
const VOLUME = [
  { value: 'LITER', label: 'Litres' },
  { value: 'US_GALLON', label: 'US gallons' },
  { value: 'IMP_GALLON', label: 'Imperial gallons' },
];
const KIND = [
  { value: 'PERSONAL', label: 'Personal' },
  { value: 'BUSINESS', label: 'Business' },
];

function ProfileForm({ user }: { user: UserDetail }) {
  const queryClient = useQueryClient();
  const initial = {
    name: user.name,
    locale: user.locale,
    timezone: user.timezone,
    defaultCurrency: user.defaultCurrency,
    distanceUnit: user.distanceUnit,
    volumeUnit: user.volumeUnit,
    accountKind: user.accountKind,
  };
  const [form, setForm] = useState(initial);
  const set =
    <K extends keyof typeof form>(key: K) =>
    (value: (typeof form)[K]) =>
      setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      // Only what changed: the API leaves an omitted field alone.
      const patch = Object.fromEntries(
        Object.entries(form).filter(
          ([key, value]) => initial[key as keyof typeof initial] !== value,
        ),
      );
      return adminApi('PATCH', `/users/${user.id}`, patch);
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'user', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
      ]),
    meta: { toast: 'Profile saved' },
  });
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const fields = (save.error as { fields?: Record<string, string> } | null)?.fields ?? {};

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Field
        label="Name"
        required
        maxLength={120}
        value={form.name}
        onChange={(e) => set('name')(e.target.value)}
        error={fields.name}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Locale"
          value={form.locale}
          onChange={(e) => set('locale')(e.target.value)}
          hint="e.g. en-GB"
          error={fields.locale}
        />
        <Field
          label="Time zone"
          value={form.timezone}
          onChange={(e) => set('timezone')(e.target.value)}
          hint="IANA, e.g. Europe/London"
          error={fields.timezone}
        />
        <Field
          label="Currency"
          maxLength={3}
          value={form.defaultCurrency}
          onChange={(e) => set('defaultCurrency')(e.target.value.toUpperCase())}
          error={fields.defaultCurrency}
        />
        <SelectField
          label="Account kind"
          value={form.accountKind}
          onChange={(v) => set('accountKind')(v as typeof form.accountKind)}
          options={KIND}
        />
        <SelectField
          label="Distance"
          value={form.distanceUnit}
          onChange={(v) => set('distanceUnit')(v as typeof form.distanceUnit)}
          options={DISTANCE}
        />
        <SelectField
          label="Volume"
          value={form.volumeUnit}
          onChange={(v) => set('volumeUnit')(v as typeof form.volumeUnit)}
          options={VOLUME}
        />
      </div>
      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty || save.isPending}
          onClick={() => setForm(initial)}
        >
          Reset
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

function DangerZone({ user, onDelete }: { user: UserDetail; onDelete: () => void }) {
  const owned = user.memberships.filter((m) => m.role === 'OWNER');
  const blocked: ReactNode = user.isAdmin
    ? 'Admins come off ADMIN_USER_IDS first.'
    : owned.length > 0
      ? `They own ${owned.map((m) => m.name).join(', ')}. Delete ${owned.length === 1 ? 'that garage' : 'those garages'} first — other members' records live there.`
      : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-destructive-soft p-4">
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-semibold">Delete this account</p>
        <p className="text-xs text-muted-foreground">
          {blocked ??
            'Their sign-in, preferences, memberships and notifications go. The audit log keeps their email.'}
        </p>
      </div>
      <Button variant="danger" size="sm" disabled={Boolean(blocked)} onClick={onDelete}>
        <Trash2 className="size-4" aria-hidden="true" />
        Delete account
      </Button>
    </div>
  );
}
