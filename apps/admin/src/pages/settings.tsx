import { ArrowUpRight, KeyRound, RotateCcw, ShieldCheck, ToggleRight } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { API_URL, authClient } from '../lib/api';
import { ago } from '../lib/format';
import { useSetFlags } from '../lib/mutations';
import { FLAG_LABELS, FLAG_NOTES } from '../lib/names';
import { useAdmins, useFlags, useOverview } from '../lib/queries';
import { href } from '../lib/route';
import { APPS } from '../components/palette';
import { Aside, Chip, CopyButton, Dot, Face, PageHeader, Panel, Segmented } from '../components/ui';

type Choice = 'default' | 'on' | 'off';

export function SettingsPage() {
  const flags = useFlags();
  const update = useSetFlags();
  const overridden = flags.data?.filter((flag) => flag.override !== null) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Configure"
        title="Settings"
        description="Switches the API enforces on web and mobile, and who can open this console."
      />

      <Panel
        title="Features"
        icon={ToggleRight}
        className="stagger animate-rise [--i:1]"
        aside={
          <span className="flex items-center gap-3">
            {flags.data ? (
              <Aside>
                {flags.data.filter((flag) => flag.enabled).length} of {flags.data.length} on
              </Aside>
            ) : null}
            {overridden.length ? (
              <Button
                size="sm"
                variant="ghost"
                loading={
                  update.isPending && Object.values(update.variables ?? {}).every((v) => v === null)
                }
                onClick={() =>
                  update.mutate(Object.fromEntries(overridden.map((flag) => [flag.flag, null])))
                }
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Reset {overridden.length} to default
              </Button>
            ) : null}
          </span>
        }
      >
        <p className="-mt-2 text-xs text-muted-foreground">
          Auto follows the environment: a feature whose key is missing stays off. A pinned switch
          holds until it is set back to Auto.
        </p>
        {flags.isError ? (
          <EmptyState
            title="Couldn't load features"
            description={flags.error.message}
            action={<Button onClick={() => void flags.refetch()}>Try again</Button>}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {flags.isPending
              ? Array.from({ length: 6 }, (_, i) => (
                  <li key={i}>
                    <Skeleton className="h-[7.5rem] w-full rounded-xl" />
                  </li>
                ))
              : flags.data.map((flag) => {
                  const note = FLAG_NOTES[flag.flag];
                  const choice: Choice =
                    flag.override === null ? 'default' : flag.override ? 'on' : 'off';
                  const pending = update.isPending && flag.flag in (update.variables ?? {});
                  return (
                    <li
                      key={flag.flag}
                      aria-busy={pending || undefined}
                      className={cn(
                        'flex flex-col gap-3 rounded-xl p-4 transition-colors aria-busy:animate-pulse',
                        flag.enabled ? 'bg-muted/60' : 'bg-muted/30',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <Dot tone={flag.enabled ? 'success' : 'muted'} />
                            <span id={`flag-${flag.flag}`} className="text-sm font-semibold">
                              {FLAG_LABELS[flag.flag] ?? flag.flag}
                            </span>
                            <span className="sr-only">{flag.enabled ? 'on' : 'off'}</span>
                            {flag.override !== null ? <Chip tone="ink">Pinned</Chip> : null}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{note?.what}</p>
                        </div>
                        <Chip tone={flag.enabled ? 'success' : 'muted'}>
                          {flag.enabled ? 'On' : 'Off'}
                        </Chip>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Segmented
                          label={FLAG_LABELS[flag.flag] ?? flag.flag}
                          size="sm"
                          value={choice}
                          onChange={(next) => {
                            if (next === choice || (next === 'on' && !flag.available)) return;
                            update.mutate({
                              [flag.flag]: next === 'default' ? null : next === 'on',
                            });
                          }}
                          options={[
                            { value: 'default', label: `Auto · ${flag.default ? 'on' : 'off'}` },
                            {
                              value: 'on',
                              label: 'On',
                              title: flag.available
                                ? undefined
                                : `Needs ${note?.needs ?? 'its key'} first`,
                            },
                            { value: 'off', label: 'Off' },
                          ]}
                        />
                        {!flag.available && note?.needs ? (
                          <Chip
                            tone="warning"
                            title="Set this on the API to make the feature available"
                          >
                            <KeyRound className="size-3" aria-hidden="true" />
                            <span className="font-mono">{note.needs}</span>
                          </Chip>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
          </ul>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ConsoleAccess />
        <Environment />
      </div>
    </div>
  );
}

function ConsoleAccess() {
  const admins = useAdmins();
  const session = authClient.useSession() as { data: { user: { id: string } } | null };
  const me = session.data?.user.id;
  return (
    <Panel
      title="Console access"
      icon={ShieldCheck}
      className="stagger animate-rise [--i:2]"
      aside={
        <a
          href={href('logs', undefined, { action: 'admin.' })}
          className="group inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          Console changes
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
      }
    >
      <p className="-mt-2 text-xs text-muted-foreground">
        Admins are the user ids in <code className="font-mono text-foreground">ADMIN_USER_IDS</code>{' '}
        on the API. Nothing in the product can grant it; edit the variable and restart.
      </p>
      {admins.isPending ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : admins.isError ? (
        <p className="text-sm text-destructive">{admins.error.message}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {admins.data.map((admin) =>
            admin.email ? (
              <li key={admin.id}>
                <a
                  href={href('users', admin.id)}
                  className="flex items-center gap-3 rounded-xl bg-muted/50 p-2.5 transition-colors hover:bg-muted"
                >
                  <Face id={admin.id} image={admin.image} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {admin.name || admin.email}
                      </span>
                      {admin.id === me ? <Chip tone="ink">You</Chip> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {admin.email}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {admin.lastSeenAt ? `seen ${ago(admin.lastSeenAt)}` : 'never seen'}
                  </span>
                </a>
              </li>
            ) : (
              <li
                key={admin.id}
                className="flex items-center gap-3 rounded-xl bg-warning-soft p-2.5"
              >
                <span className="grid size-[34px] place-items-center rounded-full bg-warning/20 text-warning">
                  ?
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{admin.id}</span>
                  <span className="block text-xs text-warning">
                    In the list, but no account has this id.
                  </span>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </Panel>
  );
}

function Environment() {
  const overview = useOverview();
  const environment = overview.data?.environment;
  const rows = [
    { label: 'NODE_ENV', value: environment ?? '…' },
    { label: 'API', value: API_URL },
    ...APPS.filter((app) => app.probe).map((app) => ({ label: app.name, value: app.url })),
  ];
  return (
    <Panel title="Environment" className="stagger animate-rise [--i:3]">
      <dl className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 border-t border-border/60 py-2 first:border-t-0"
          >
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span
                className={cn(
                  'truncate font-mono text-xs',
                  row.label === 'NODE_ENV' &&
                    environment === 'production' &&
                    'font-bold text-destructive',
                )}
              >
                {row.value}
              </span>
              <CopyButton value={row.value} label={`Copy ${row.label}`} />
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
