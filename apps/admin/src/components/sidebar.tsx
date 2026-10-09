import {
  ArrowUpRight,
  Car,
  ChevronsUpDown,
  Copy,
  Keyboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Warehouse,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { ThemePicker } from '@/components/theme-picker';
import { FullScreenStatus } from '@/components/ui/full-screen-status';
import { raise } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import logoMark from '@/public/Logo.png';
import logoText from '@/public/logo-text.png';
import logoTextLight from '@/public/logo-text-light.png';
import { formatCount } from '../lib/format';
import { GO_TO, isMac, isTyping } from '../lib/keys';
import { NAV_GROUPS, NAV_ICONS } from '../lib/nav';
import { useFlags, useHealth, useOverview, useSystem, useUsage } from '../lib/queries';
import { useRecent, type Recent } from '../lib/recent';
import { href } from '../lib/route';
import { useSignOut } from '../lib/session';
import { partsOf, worst, type Tone } from '../lib/status';
import { Menu } from './menu';
import { openPalette, openShortcuts, PaletteTrigger } from './palette';
import { Dot, Face, Kbd, SNAP } from './ui';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

// --- The rail ------------------------------------------------------------------------------

/*
 * The sidebar folds to a rail of icons — `[` or its button — for a wide table or a small screen,
 * and stays how it was left. A per-browser preference, so `localStorage`, read defensively.
 */
const RAIL_KEY = 'garaj.admin.rail';
const railListeners = new Set<() => void>();
let railed = (() => {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
})();

function setRail(next: boolean) {
  railed = next;
  try {
    localStorage.setItem(RAIL_KEY, next ? '1' : '0');
  } catch {
    // The choice holds for this visit.
  }
  railListeners.forEach((listener) => listener());
}

const useRail = () =>
  useSyncExternalStore(
    (listener) => {
      railListeners.add(listener);
      return () => railListeners.delete(listener);
    },
    () => railed,
  );

// --- What the chrome shows ---------------------------------------------------------------------

/** The shared reads the chrome is drawn from: counts, flags, and a verdict on every part. */
export function useConsoleStatus() {
  const overview = useOverview();
  const flags = useFlags();
  const health = useHealth();
  const system = useSystem();
  const usage = useUsage(30);
  const parts = partsOf({
    health: health.data,
    healthFailed: health.isError,
    system: system.data,
    systemFailed: system.isError,
    overview: overview.data,
    usage: usage.data,
  });
  return {
    overview: overview.data,
    flags: flags.data,
    parts,
    tone: worst(parts),
    checking: parts.some((part) => part.state === 'Checking'),
    trouble: parts.filter((part) => part.tone === 'warning' || part.tone === 'destructive'),
  };
}

const SEGMENT: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground/30',
};

/** Each section's `G` shortcut letter. */
const LETTER = Object.fromEntries(
  Object.entries(GO_TO).map(([key, page]) => [page.section, key.toUpperCase()]),
);

const SECTION_OF: Record<Recent['kind'], string> = {
  user: 'users',
  garage: 'garages',
  vehicle: 'vehicles',
};

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center', className)}>
      <img src={logoText} alt="Garaj" className="h-6 w-auto dark:hidden" />
      <img src={logoTextLight} alt="Garaj" className="hidden h-6 w-auto dark:block" />
    </span>
  );
}

/** The environment, always in view: production is the one that says so loudly. */
export function EnvironmentBadge({ environment }: { environment: string | undefined }) {
  if (!environment) return null;
  const live = environment === 'production';
  return (
    <span
      title={`NODE_ENV=${environment}`}
      className={cn(
        'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider',
        live ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground',
      )}
    >
      {live ? 'Live' : environment.slice(0, 3)}
    </span>
  );
}

/** The label beside an icon in the rail: shown on hover or focus, beside the icon. */
function Tip({ children }: { children: ReactNode }) {
  return (
    <span className="rail-tip z-50 flex items-center gap-2 whitespace-nowrap rounded-lg bg-popover px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-float">
      {children}
    </span>
  );
}

// --- The sidebar ----------------------------------------------------------------------------

export function Sidebar({ page, user }: { page: string; user: SessionUser }) {
  const rail = useRail();
  const status = useConsoleStatus();
  const recent = useRecent();
  const counts = status.overview?.counts;

  useEffect(() => {
    document.documentElement.toggleAttribute('data-rail', rail);
  }, [rail]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== '[' ||
        isTyping(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      setRail(!railed);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const badge = (section: string, active: boolean): ReactNode => {
    if (section === 'system') {
      return status.tone === 'muted' || status.tone === 'success' ? null : (
        <Dot tone={status.tone} />
      );
    }
    const value =
      section === 'users'
        ? counts && formatCount(counts.users)
        : section === 'garages'
          ? counts && formatCount(counts.garages)
          : section === 'vehicles'
            ? counts && formatCount(counts.vehicles)
            : section === 'settings' && status.flags
              ? `${status.flags.filter((flag) => flag.enabled).length}/${status.flags.length}`
              : undefined;
    return value ? (
      <span
        className={cn(
          'rounded-md px-1.5 py-px font-mono text-[11px] tabular-nums transition-colors',
          active ? 'bg-muted text-foreground/80' : 'text-muted-foreground',
        )}
      >
        {value}
      </span>
    ) : null;
  };

  return (
    <aside
      aria-label="Console"
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-width)] flex-col border-r border-border/60 bg-background transition-[width] duration-200 ease-[cubic-bezier(0.2,0.9,0.1,1)] lg:flex',
        rail ? 'overflow-visible' : 'overflow-hidden',
      )}
    >
      {/* Brand ------------------------------------------------------------------------- */}
      <div
        className={cn('flex h-16 shrink-0 items-center gap-2', rail ? 'justify-center' : 'px-4')}
      >
        <a
          href={href('overview')}
          aria-label="Admin overview"
          className="flex shrink-0 items-center rounded-lg"
        >
          {rail ? <img src={logoMark} alt="" className="h-6 w-auto" /> : <Wordmark />}
        </a>
        {rail ? null : (
          <>
            <span className="rounded-md bg-primary-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
              Admin
            </span>
            <EnvironmentBadge environment={status.overview?.environment} />
            <button
              type="button"
              onClick={() => setRail(true)}
              aria-label="Collapse the sidebar"
              title="Collapse the sidebar ( [ )"
              className="ml-auto grid size-8 place-items-center rounded-lg text-muted-foreground transition-[background-color,color,scale] duration-100 hover:bg-muted hover:text-foreground active:scale-90"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {/* Search ------------------------------------------------------------------------ */}
      <div className={cn(rail ? 'flex justify-center' : 'px-3')}>
        {rail ? (
          <button
            type="button"
            onClick={() => openPalette()}
            aria-label="Search and commands"
            className="relative grid size-10 place-items-center rounded-xl bg-muted/70 text-muted-foreground transition-[background-color,color,scale] duration-100 hover:bg-muted hover:text-foreground active:scale-95"
          >
            <Search className="size-[18px]" aria-hidden="true" />
            <Tip>
              Search <Kbd>{isMac() ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>K</Kbd>
            </Tip>
          </button>
        ) : (
          <PaletteTrigger className="w-full" />
        )}
      </div>

      {/* Sections ------------------------------------------------------------------------ */}
      <nav
        aria-label="Sections"
        className={cn(
          'mt-4 flex flex-1 flex-col gap-4 pb-3',
          rail ? 'items-center px-0' : 'scrollbar-slim overflow-y-auto px-3',
        )}
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className={cn('flex flex-col gap-0.5', rail && 'items-center')}>
            {rail ? (
              <span aria-hidden="true" className="mb-1.5 h-px w-6 bg-border" />
            ) : (
              <p className="px-2.5 pb-1 text-[11px] font-semibold text-muted-foreground/70">
                {group.label}
              </p>
            )}
            <ul className={cn('flex flex-col gap-0.5', rail && 'items-center')}>
              {group.items.map((item) => {
                const Icon = NAV_ICONS[item.section]!;
                const active = item.section === page;
                const letter = LETTER[item.section];
                return (
                  <li key={item.section}>
                    <a
                      href={href(item.section)}
                      aria-current={active ? 'page' : undefined}
                      aria-label={rail ? item.label : undefined}
                      className={cn(
                        'group relative isolate flex h-9 items-center gap-2.5 rounded-xl text-sm font-medium transition-colors duration-100',
                        rail ? 'w-10 justify-center' : 'px-2.5',
                        active
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="nav-pill"
                          aria-hidden="true"
                          className="absolute inset-0 -z-10 rounded-xl bg-card shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_var(--color-shadow)]"
                          transition={SNAP}
                        />
                      ) : null}
                      <Icon
                        className={cn(
                          'size-[18px] shrink-0 transition-[scale,color] duration-150 group-hover:scale-110 group-active:scale-90',
                          active && 'text-primary',
                        )}
                        strokeWidth={active ? 2.1 : 1.8}
                        aria-hidden="true"
                      />
                      {rail ? (
                        <>
                          {item.section === 'system' &&
                          status.tone !== 'muted' &&
                          status.tone !== 'success' ? (
                            <Dot
                              tone={status.tone}
                              className="absolute right-1.5 top-1.5 size-2 ring-2 ring-background"
                            />
                          ) : null}
                          <Tip>
                            {item.label}
                            {letter ? (
                              <span className="flex gap-0.5">
                                <Kbd>G</Kbd>
                                <Kbd>{letter}</Kbd>
                              </span>
                            ) : null}
                          </Tip>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 truncate">{item.label}</span>
                          {/* The count gives way to the shortcut under the pointer. */}
                          {letter ? (
                            <span
                              aria-hidden="true"
                              className="hidden items-center gap-0.5 group-hover:flex"
                            >
                              <Kbd>G</Kbd>
                              <Kbd>{letter}</Kbd>
                            </span>
                          ) : null}
                          <span className={cn('flex items-center', letter && 'group-hover:hidden')}>
                            {badge(item.section, active)}
                          </span>
                        </>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {recent.length ? (
          <div className={cn('flex flex-col gap-0.5', rail && 'items-center')}>
            {rail ? (
              <span aria-hidden="true" className="mb-1.5 h-px w-6 bg-border" />
            ) : (
              <p className="px-2.5 pb-1 text-[11px] font-semibold text-muted-foreground/70">
                Recent
              </p>
            )}
            <ul className={cn('flex flex-col gap-0.5', rail && 'items-center')}>
              {recent.slice(0, rail ? 3 : 5).map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <a
                    href={href(SECTION_OF[item.kind], item.id)}
                    aria-label={rail ? item.label : undefined}
                    className={cn(
                      'group relative flex h-9 items-center gap-2.5 rounded-xl text-sm text-muted-foreground transition-colors duration-100 hover:bg-muted/60 hover:text-foreground',
                      rail ? 'w-10 justify-center' : 'px-2.5',
                    )}
                  >
                    {item.kind === 'user' ? (
                      <Face id={item.id} image={item.image} size={20} />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="grid size-5 shrink-0 place-items-center rounded-md bg-muted"
                      >
                        {item.kind === 'garage' ? (
                          <Warehouse className="size-3" />
                        ) : (
                          <Car className="size-3" />
                        )}
                      </span>
                    )}
                    {rail ? (
                      <Tip>{item.label}</Tip>
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>

      {/* Systems and the account ------------------------------------------------------------ */}
      <div
        className={cn('flex flex-col gap-2 border-t border-border/60 p-3', rail && 'items-center')}
      >
        {rail ? (
          <>
            <a
              href={href('system')}
              aria-label="Systems"
              className="relative grid size-10 place-items-center rounded-xl transition-colors duration-100 hover:bg-muted/60"
            >
              <Dot
                tone={status.checking ? 'muted' : status.tone === 'muted' ? 'success' : status.tone}
                className="size-2.5"
              />
              <Tip>
                {status.trouble.length
                  ? `${status.trouble.length} systems want a look`
                  : 'All systems normal'}
              </Tip>
            </a>
            <button
              type="button"
              onClick={() => setRail(false)}
              aria-label="Expand the sidebar"
              className="relative grid size-10 place-items-center rounded-xl text-muted-foreground transition-[background-color,color,scale] duration-100 hover:bg-muted hover:text-foreground active:scale-90"
            >
              <PanelLeftOpen className="size-[18px]" aria-hidden="true" />
              <Tip>
                Expand <Kbd>[</Kbd>
              </Tip>
            </button>
          </>
        ) : (
          <a
            href={href('system')}
            className="group block rounded-2xl bg-card/50 p-3 transition-colors duration-150 hover:bg-card"
          >
            <span className="flex items-center gap-2 text-xs font-semibold">
              <Dot
                tone={status.checking ? 'muted' : status.tone === 'muted' ? 'success' : status.tone}
              />
              <span className="min-w-0 flex-1 truncate">
                {status.checking
                  ? 'Checking every system…'
                  : status.trouble.length
                    ? `${status.trouble.length} ${status.trouble.length === 1 ? 'system wants' : 'systems want'} a look`
                    : 'All systems normal'}
              </span>
              <ArrowUpRight
                className="size-3.5 text-muted-foreground transition-transform duration-150 group-hover:-translate-y-px group-hover:translate-x-px"
                aria-hidden="true"
              />
            </span>
            <span aria-hidden="true" className="mt-2.5 grid grid-cols-10 gap-[3px]">
              {status.parts.map((part) => (
                <span
                  key={part.key}
                  title={`${part.name}: ${part.state}`}
                  className={cn(
                    'h-1.5 rounded-full transition-colors duration-300',
                    SEGMENT[part.tone],
                  )}
                />
              ))}
            </span>
            <span className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Dot
                tone={counts?.online ? 'success' : 'muted'}
                pulse={Boolean(counts?.online)}
                className="size-1.5"
              />
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {counts ? formatCount(counts.online) : '··'}
              </span>
              online now
            </span>
          </a>
        )}
        <AccountMenu user={user} variant={rail ? 'rail' : 'full'} />
      </div>
    </aside>
  );
}

/** The header and section strip on a phone or a narrow window, where the sidebar does not fit. */
export function MobileHeader({ page, user }: { page: string; user: SessionUser }) {
  const status = useConsoleStatus();
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-md lg:hidden">
      <div className="flex h-14 items-center gap-2 px-4">
        <a
          href={href('overview')}
          aria-label="Admin overview"
          className="flex items-center gap-2 rounded-lg"
        >
          <img src={logoMark} alt="" className="h-6 w-auto" />
        </a>
        <span className="rounded-md bg-primary-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
          Admin
        </span>
        <EnvironmentBadge environment={status.overview?.environment} />
        <PaletteTrigger compact className="ml-auto size-9 justify-center px-0" />
        <AccountMenu user={user} variant="compact" />
      </div>
      <nav
        aria-label="Sections"
        className="scroll-fade-x flex gap-1 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none]"
      >
        {NAV_GROUPS.flatMap((group) => group.items).map((item) => {
          const Icon = NAV_ICONS[item.section]!;
          const active = item.section === page;
          return (
            <a
              key={item.section}
              href={href(item.section)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-semibold transition-[background-color,color,scale] duration-100 active:scale-95',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </a>
          );
        })}
      </nav>
    </header>
  );
}

/** Who is signed in, the theme, and the way out — on the console's dropdown. */
function AccountMenu({
  user,
  variant,
}: {
  user: SessionUser;
  variant: 'full' | 'rail' | 'compact';
}) {
  const { pending, signOut } = useSignOut();
  return (
    <>
      {pending ? <FullScreenStatus message="Signing you out…" /> : null}
      <Menu
        label="Account"
        align={variant === 'compact' ? 'end' : 'start'}
        width={272}
        header={
          <div className="flex flex-col gap-3 px-2.5 pb-3 pt-2">
            <div className="flex min-w-0 items-center gap-3">
              <Face id={user.id} image={user.image} size={36} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{user.name}</div>
                <div className="truncate text-xs text-muted-foreground">{user.email}</div>
              </div>
            </div>
            <div>
              <div id="admin-theme" className="mb-1.5 text-label uppercase text-muted-foreground">
                Theme
              </div>
              <ThemePicker labelledBy="admin-theme" />
            </div>
          </div>
        }
        sections={[
          {
            items: [
              {
                label: 'Copy my user id',
                icon: Copy,
                onSelect: () =>
                  void navigator.clipboard
                    .writeText(user.id)
                    .then(() => raise('success', 'Your id is copied')),
              },
              {
                label: 'Keyboard shortcuts',
                icon: Keyboard,
                hint: <Kbd>?</Kbd>,
                onSelect: openShortcuts,
              },
            ],
          },
          {
            items: [
              {
                label: 'Sign out',
                icon: LogOut,
                destructive: true,
                onSelect: () => void signOut(),
              },
            ],
          },
        ]}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            aria-label={`Account: ${user.name || user.email}`}
            className={cn(
              'group relative flex shrink-0 items-center gap-2.5 rounded-xl text-left transition-[background-color,scale] duration-100 hover:bg-muted/60 active:scale-[0.98] aria-expanded:bg-muted/60',
              variant === 'full' ? 'w-full px-2 py-1.5' : 'p-1',
            )}
          >
            <Face id={user.id} image={user.image} size={variant === 'full' ? 32 : 30} />
            {variant === 'full' ? (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{user.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
                <ChevronsUpDown
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </>
            ) : variant === 'rail' ? (
              <Tip>{user.name || user.email}</Tip>
            ) : null}
          </button>
        )}
      />
    </>
  );
}
