import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppWindow,
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  Braces,
  Car,
  ChevronRight,
  CornerDownLeft,
  Copy,
  Globe,
  Keyboard,
  LoaderCircle,
  LogOut,
  Moon,
  RefreshCw,
  Search,
  Smartphone,
  Star,
  Sun,
  ToggleRight,
  UserX,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { raise } from '@/components/ui/toaster';
import { Modal } from '@/components/ui/modal';
import { humanise } from '@/lib/format';
import { setThemePreference, useTheme } from '@/lib/settings/theme';
import { cn } from '@/lib/utils';
import {
  API_URL,
  authClient,
  get,
  withQuery,
  type FlagState,
  type GarageRow,
  type Page,
  type Plan,
  type UserRow,
  type VehicleRow,
} from '../lib/api';
import { GO_TO, isMac, isTyping } from '../lib/keys';
import { useRevokeSessions, useSetFlags, useSetPlan, useVerifyEmail } from '../lib/mutations';
import { useFlags } from '../lib/queries';
import { href } from '../lib/route';
import { FLAG_LABELS, vehicleName } from '../lib/names';
import { NAV_ICONS } from '../lib/nav';
import { Chip, Face, Kbd } from './ui';

/*
 * One box for everything: ⌘K (Ctrl+K) or `/` from anywhere. It finds people, garages, vehicles
 * and pages — and it does things. An action that needs a who or a which asks for it in the same
 * box, a step at a time ("Set someone's plan" → a person → a plan), so a change the console makes
 * often is three keystrokes from anywhere, never a hunt through screens.
 */

interface Person {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export type Step =
  | { kind: 'root' }
  | { kind: 'pick'; purpose: 'plan' | 'verify' | 'revoke' }
  | { kind: 'plan'; person: Person & { plan: Plan } }
  | { kind: 'revoke'; person: Person }
  | { kind: 'flags' }
  | { kind: 'flag'; flag: FlagState };

const STEP_TITLE: Record<Exclude<Step['kind'], 'root'>, string> = {
  pick: 'Choose a person',
  plan: 'Plan',
  revoke: 'Sign out everywhere',
  flags: 'Features',
  flag: 'Feature',
};

const PICK_PROMPT = {
  plan: 'Whose plan? Type a name or an email…',
  verify: 'Whose email? Type a name or an email…',
  revoke: 'Sign out whom? Type a name or an email…',
} as const;

const PALETTE_EVENT = 'admin:palette';

/** Opens the palette from anywhere, optionally partway into an action. */
export function openPalette(step?: Step): void {
  window.dispatchEvent(new CustomEvent<Step | undefined>(PALETTE_EVENT, { detail: step }));
}

const SHORTCUTS_EVENT = 'admin:shortcuts';
export const openShortcuts = () => {
  window.dispatchEvent(new Event(SHORTCUTS_EVENT));
};

const env = import.meta.env;
/** Every app in the monorepo. The URLs default to the dev ports; a deployed console sets them. */
export const APPS: { name: string; url: string; probe?: string; icon: LucideIcon }[] = [
  {
    name: 'Web app',
    url: env.VITE_WEB_URL ?? 'http://localhost:3000',
    probe: '/icon.png',
    icon: AppWindow,
  },
  {
    name: 'Landing',
    url: env.VITE_LANDING_URL ?? 'http://localhost:3003',
    probe: '/icon.png',
    icon: Globe,
  },
  {
    name: 'Docs',
    url: env.VITE_DOCS_URL ?? 'http://localhost:3004',
    probe: '/icon.png',
    icon: BookOpen,
  },
  { name: 'API reference', url: `${API_URL}/docs`, icon: Braces },
  {
    name: 'Mobile',
    url: env.VITE_MOBILE_URL ?? 'http://localhost:8081',
    probe: '/status',
    icon: Smartphone,
  },
];

const PLANS: { value: Plan; note: string }[] = [
  { value: 'FREE', note: 'The limits every new account starts on' },
  { value: 'PLUS', note: 'More vehicles and garages, the paid extras' },
  { value: 'BUSINESS', note: 'Fleets: drivers, income and trip purpose' },
];

/** The trigger, for the sidebar and the phone header: it looks like a search box because it is one. */
export function PaletteTrigger({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const mac = isMac();
  return (
    <button
      type="button"
      onClick={() => openPalette()}
      aria-label="Search and commands"
      aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
      className={cn(
        'group flex h-9 shrink-0 items-center gap-2.5 rounded-xl bg-muted/70 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      {compact ? null : (
        <>
          <span className="flex-1 truncate text-left">Search or run…</span>
          <span className="flex items-center gap-0.5">
            <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </>
      )}
    </button>
  );
}

/**
 * The palette's controller: mounted once in the shell. It owns the console's keyboard — ⌘K and `/`
 * open it, `G` then a letter goes to a page, `R` refreshes what is on screen, `?` lists all of it.
 */
export function CommandPalette() {
  const [open, setOpen] = useState<Step | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let pendingG = 0;
    const onKey = (event: KeyboardEvent) => {
      const chord = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
      if (chord) {
        event.preventDefault();
        setOpen((current) => (current ? null : { kind: 'root' }));
        return;
      }
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const key = event.key.toLowerCase();
      if (pendingG && Date.now() - pendingG < 1200 && GO_TO[key]) {
        event.preventDefault();
        pendingG = 0;
        window.location.hash = href(GO_TO[key]!.section);
        return;
      }
      pendingG = 0;
      if (event.key === '/') {
        event.preventDefault();
        setOpen({ kind: 'root' });
      } else if (event.key === '?') {
        event.preventDefault();
        setShortcuts(true);
      } else if (key === 'g') {
        pendingG = Date.now();
      } else if (key === 'r') {
        event.preventDefault();
        void queryClient
          .refetchQueries({ type: 'active' })
          .then(() => raise('success', 'Refreshed'));
      }
    };
    const onOpen = (event: Event) =>
      setOpen((event as CustomEvent<Step | undefined>).detail ?? { kind: 'root' });
    const onShortcuts = () => setShortcuts(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    window.addEventListener(SHORTCUTS_EVENT, onShortcuts);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
      window.removeEventListener(SHORTCUTS_EVENT, onShortcuts);
    };
  }, [queryClient]);

  return (
    <>
      {open ? <Palette initial={open} onClose={() => setOpen(null)} /> : null}
      {shortcuts ? <ShortcutsDialog onClose={() => setShortcuts(false)} /> : null}
    </>
  );
}

interface Item {
  id: string;
  group: string;
  title: string;
  meta?: string;
  /** A glyph in a tile, or a face. */
  icon?: LucideIcon;
  lead?: ReactNode;
  hint?: ReactNode;
  /** Extra words it answers to, past its title. */
  keywords?: string;
  destructive?: boolean;
  /** Performs and closes, returns the next step, or `'back'` to the one before. */
  run: () => Step | 'back' | void;
}

const matches = (needle: string, ...haystack: (string | undefined)[]) => {
  const text = haystack.join(' ').toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
};

function Palette({ initial, onClose }: { initial: Step; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [stack, setStack] = useState<Step[]>(
    initial.kind === 'root' ? [initial] : [{ kind: 'root' }, initial],
  );
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const step = stack.at(-1)!;
  const q = useDeferredValue(query.trim());
  const theme = useTheme();
  const session = authClient.useSession() as { data: { user: { id: string } } | null };
  const queryClient = useQueryClient();

  const setPlan = useSetPlan();
  const verify = useVerifyEmail();
  const revoke = useRevokeSessions();
  const setFlags = useSetFlags();
  const flags = useFlags();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // Into the box, not onto the Back chip `showModal()` would focus first.
    input.current?.focus();
  }, []);

  const search = useQuery({
    queryKey: ['admin', 'palette', q],
    queryFn: async () => {
      const params = { q, limit: 5 };
      const [users, garages, vehicles] = await Promise.all([
        get<Page<UserRow>>(withQuery('/users', params)),
        get<Page<GarageRow>>(withQuery('/garages', params)),
        get<Page<VehicleRow>>(withQuery('/vehicles', params)),
      ]);
      return { users: users.data, garages: garages.data, vehicles: vehicles.data };
    },
    enabled: step.kind === 'root' && q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  // Choosing a person: the newest accounts before anything is typed, then the matches.
  const people = useQuery({
    queryKey: ['admin', 'palette', 'people', q],
    queryFn: () => get<Page<UserRow>>(withQuery('/users', { q, limit: 8 })),
    enabled: step.kind === 'pick',
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const go = (next: Step | 'back' | void) => {
    if (next === 'back') {
      back();
    } else if (next) {
      setStack((current) => [...current, next]);
      setQuery('');
      setActive(0);
      input.current?.focus();
    } else {
      dialog.current?.close();
    }
  };
  const back = () => {
    if (stack.length > 1) {
      setStack((current) => current.slice(0, -1));
      setQuery('');
      setActive(0);
    }
  };
  const visit = (target: string) => () => {
    window.location.hash = target;
  };
  const person = (user: UserRow): Person => ({
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
  });

  const needle = query.trim();
  let items: Item[] = [];

  if (step.kind === 'root') {
    const actions: Item[] = [
      {
        id: 'plan',
        group: 'Actions',
        title: "Set someone's plan…",
        icon: Star,
        keywords: 'comp upgrade downgrade plus business free subscription',
        run: () => ({ kind: 'pick', purpose: 'plan' }),
      },
      {
        id: 'verify',
        group: 'Actions',
        title: "Verify someone's email…",
        icon: BadgeCheck,
        keywords: 'confirm address',
        run: () => ({ kind: 'pick', purpose: 'verify' }),
      },
      {
        id: 'revoke',
        group: 'Actions',
        title: 'Sign someone out everywhere…',
        icon: UserX,
        keywords: 'sessions revoke log out devices',
        run: () => ({ kind: 'pick', purpose: 'revoke' }),
      },
      {
        id: 'flags',
        group: 'Actions',
        title: 'Turn a feature on or off…',
        icon: ToggleRight,
        keywords: 'flags toggle switch enable disable',
        run: () => ({ kind: 'flags' }),
      },
      {
        id: 'refresh',
        group: 'Actions',
        title: 'Check the system again',
        icon: RefreshCw,
        keywords: 'refresh redis queues health status',
        run: () => {
          window.location.hash = href('system');
          void Promise.all([
            queryClient.refetchQueries({ queryKey: ['admin', 'system'] }),
            queryClient.refetchQueries({ queryKey: ['admin', 'health'] }),
          ]).then(() => raise('success', 'System checked'));
        },
      },
      {
        id: 'copy-id',
        group: 'Actions',
        title: 'Copy my user id',
        icon: Copy,
        keywords: 'admin_user_ids clipboard',
        run: () => {
          const id = session.data?.user.id;
          if (id)
            void navigator.clipboard
              .writeText(id)
              .then(() => raise('success', 'Your id is copied'));
        },
      },
      {
        id: 'theme',
        group: 'Actions',
        title: theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
        icon: theme === 'dark' ? Sun : Moon,
        keywords: 'appearance mode colour',
        run: () => setThemePreference(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'shortcuts',
        group: 'Actions',
        title: 'Keyboard shortcuts',
        icon: Keyboard,
        keywords: 'keys help hotkeys',
        hint: <Kbd>?</Kbd>,
        run: openShortcuts,
      },
      ...APPS.map((app) => ({
        id: `app-${app.name}`,
        group: 'Open',
        title: `Open ${app.name === 'Mobile' ? 'the Expo dev server' : `the ${app.name.toLowerCase()}`}`,
        meta: new URL(app.url).host,
        icon: app.icon,
        keywords: 'launch app',
        run: () => void window.open(app.url, '_blank', 'noreferrer'),
      })),
      {
        id: 'sign-out',
        group: 'Open',
        title: 'Sign out of the console',
        icon: LogOut,
        keywords: 'log out leave',
        run: () => void authClient.signOut().then(() => window.location.reload()),
      },
    ];
    const pages: Item[] = Object.entries(GO_TO).map(([key, page]) => ({
      id: `page-${page.section}`,
      group: 'Go to',
      title: page.label,
      icon: NAV_ICONS[page.section],
      hint: (
        <span className="flex items-center gap-0.5">
          <Kbd>G</Kbd>
          <Kbd>{key.toUpperCase()}</Kbd>
        </span>
      ),
      run: visit(href(page.section)),
    }));
    const found = q.length >= 2 ? search.data : undefined;
    items = [
      ...(needle ? [] : actions.slice(0, 5)),
      ...(needle
        ? [...actions, ...pages].filter((item) => matches(needle, item.title, item.keywords))
        : pages),
      ...(found?.users ?? []).map((user) => ({
        id: `user-${user.id}`,
        group: 'People',
        title: user.name || user.email,
        meta: user.email,
        lead: <Face id={user.id} image={user.image} size={32} />,
        hint: user.plan === 'FREE' ? undefined : <Chip tone="ink">{humanise(user.plan)}</Chip>,
        run: visit(href('users', user.id)),
      })),
      ...(found?.garages ?? []).map((garage) => ({
        id: `garage-${garage.id}`,
        group: 'Garages',
        title: garage.name,
        meta: `${garage.ownerEmail} · ${garage.vehicles} vehicle${garage.vehicles === 1 ? '' : 's'}`,
        icon: Warehouse,
        run: visit(href('garages', garage.id)),
      })),
      ...(found?.vehicles ?? []).map((vehicle) => ({
        id: `vehicle-${vehicle.id}`,
        group: 'Vehicles',
        title: vehicleName(vehicle),
        meta: [vehicle.registrationIdentifier, vehicle.garageName].filter(Boolean).join(' · '),
        icon: Car,
        run: visit(href('vehicles', vehicle.id)),
      })),
    ];
  } else if (step.kind === 'pick') {
    items = (people.data?.data ?? []).map((user) => ({
      id: `pick-${user.id}`,
      group: q ? 'Matches' : 'Newest',
      title: user.name || user.email,
      meta: user.email,
      lead: <Face id={user.id} image={user.image} size={32} />,
      hint:
        step.purpose === 'plan' ? (
          <Chip tone={user.plan === 'FREE' ? 'muted' : 'ink'}>{humanise(user.plan)}</Chip>
        ) : step.purpose === 'verify' ? (
          <Chip tone={user.emailVerified ? 'success' : 'warning'}>
            {user.emailVerified ? 'Verified · undo' : 'Unverified'}
          </Chip>
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        ),
      run: () => {
        if (step.purpose === 'plan')
          return { kind: 'plan', person: { ...person(user), plan: user.plan } };
        if (step.purpose === 'revoke') return { kind: 'revoke', person: person(user) };
        verify.mutate({ person: person(user), verified: !user.emailVerified });
      },
    }));
  } else if (step.kind === 'plan') {
    items = PLANS.filter((plan) => matches(needle, plan.value, plan.note)).map((plan) => ({
      id: `plan-${plan.value}`,
      group: `${step.person.name || step.person.email} — choose a plan`,
      title: humanise(plan.value),
      meta: plan.note,
      icon: Star,
      hint: plan.value === step.person.plan ? <Chip>Current</Chip> : undefined,
      run: () => {
        if (plan.value !== step.person.plan)
          setPlan.mutate({ person: step.person, plan: plan.value });
      },
    }));
  } else if (step.kind === 'revoke') {
    items = [
      {
        id: 'revoke-confirm',
        group: `${step.person.name || step.person.email} — every device`,
        title: `Sign ${step.person.name || step.person.email} out everywhere`,
        meta: 'Takes up to five minutes to reach a device mid-session',
        icon: UserX,
        destructive: true,
        run: () => revoke.mutate({ person: step.person }),
      },
      {
        id: 'revoke-cancel',
        group: '',
        title: 'Keep them signed in',
        icon: ArrowLeft,
        run: () => 'back',
      },
    ];
  } else if (step.kind === 'flags') {
    items = (flags.data ?? [])
      .filter((flag) => matches(needle, FLAG_LABELS[flag.flag] ?? flag.flag, flag.flag))
      .map((flag) => ({
        id: `flag-${flag.flag}`,
        group: 'Features',
        title: FLAG_LABELS[flag.flag] ?? flag.flag,
        meta:
          flag.override === null
            ? `Follows its default (${flag.default ? 'on' : 'off'})`
            : 'Pinned here',
        icon: ToggleRight,
        hint: <Chip tone={flag.enabled ? 'success' : 'muted'}>{flag.enabled ? 'On' : 'Off'}</Chip>,
        run: () => ({ kind: 'flag', flag }),
      }));
  } else {
    const { flag } = step;
    const choices: { value: boolean | null; title: string; meta: string }[] = [
      { value: null, title: 'Follow the default', meta: `On here: ${flag.default ? 'on' : 'off'}` },
      {
        value: true,
        title: 'Force on',
        meta: flag.available ? 'For everyone, on web and mobile' : 'Needs its key first',
      },
      { value: false, title: 'Force off', meta: 'For everyone, on web and mobile' },
    ];
    items = choices.map((choice) => ({
      id: `choice-${String(choice.value)}`,
      group: FLAG_LABELS[flag.flag] ?? flag.flag,
      title: choice.title,
      meta: choice.meta,
      icon: ToggleRight,
      hint: flag.override === choice.value ? <Chip>Current</Chip> : undefined,
      run: () => {
        if (choice.value === true && !flag.available) {
          raise(
            'error',
            `${FLAG_LABELS[flag.flag] ?? flag.flag} needs its key before it can be on`,
          );
        } else if (flag.override !== choice.value) {
          setFlags.mutate({ [flag.flag]: choice.value });
        }
      },
    }));
  }

  const current = Math.min(active, Math.max(items.length - 1, 0));
  useEffect(() => {
    document.getElementById(`palette-${current}`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const loading =
    (step.kind === 'root' && search.isFetching) || (step.kind === 'pick' && people.isFetching);
  const placeholder =
    step.kind === 'root'
      ? 'Search people, garages, vehicles — or type a command'
      : step.kind === 'pick'
        ? PICK_PROMPT[step.purpose]
        : step.kind === 'flags'
          ? 'Which feature?'
          : 'Choose…';

  return (
    <dialog
      ref={dialog}
      aria-label="Search and commands"
      onClose={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
      className="mx-auto mt-[12vh] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-3xl bg-popover p-0 text-foreground shadow-float backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-pop"
    >
      <div className="flex items-center gap-3 px-5">
        {stack.length > 1 ? (
          <button
            type="button"
            onClick={back}
            aria-label="Back"
            className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-primary-soft pl-1.5 pr-2.5 text-xs font-semibold text-foreground hover:bg-primary/20"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {STEP_TITLE[step.kind as Exclude<Step['kind'], 'root'>]}
          </button>
        ) : (
          <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items.length ? `palette-${current}` : undefined}
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const by = event.key === 'ArrowDown' ? 1 : -1;
              setActive((current + by + items.length) % Math.max(items.length, 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const item = items[current];
              if (item) go(item.run());
            } else if (event.key === 'Backspace' && query === '' && stack.length > 1) {
              event.preventDefault();
              back();
            }
          }}
          className="h-16 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {loading ? (
          <LoaderCircle
            className="size-4 shrink-0 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="scrollbar-slim max-h-[min(28rem,60vh)] overflow-y-auto border-t border-border/60 p-2">
        <ul id="palette-list" role="listbox" aria-label="Results">
          {items.map((item, index) => (
            <li key={item.id} role="presentation">
              {item.group && (index === 0 || items[index - 1]!.group !== item.group) ? (
                <div
                  role="presentation"
                  className="px-3 pb-1.5 pt-3 text-label uppercase text-muted-foreground"
                >
                  {item.group}
                </div>
              ) : null}
              <div
                id={`palette-${index}`}
                role="option"
                aria-selected={index === current}
                onPointerMove={() => setActive(index)}
                onClick={() => go(item.run())}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2',
                  index === current && (item.destructive ? 'bg-destructive-soft' : 'bg-muted'),
                )}
              >
                {item.lead ?? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-lg',
                      item.destructive ? 'bg-destructive-soft text-destructive' : 'bg-card',
                    )}
                  >
                    {item.icon ? <item.icon className="size-4" /> : null}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm font-semibold',
                      item.destructive && 'text-destructive',
                    )}
                  >
                    {item.title}
                  </span>
                  {item.meta ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.meta}
                    </span>
                  ) : null}
                </span>
                {item.hint ?? null}
                {index === current && !item.hint ? (
                  <CornerDownLeft
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {loading ? 'Searching…' : needle ? `Nothing matches “${needle}”` : 'Nothing here yet.'}
          </p>
        ) : null}
        {step.kind === 'root' && q.length === 1 ? (
          <p className="px-3 pb-2 pt-1 text-xs text-muted-foreground">
            One more letter to search people, garages and vehicles.
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-4 border-t border-border/60 px-5 py-2.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> choose
        </span>
        {stack.length > 1 ? (
          <span className="flex items-center gap-1">
            <Kbd>⌫</Kbd> back
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <Kbd>esc</Kbd> close
        </span>
      </div>
    </dialog>
  );
}

const SHORTCUTS: { keys: string[][]; what: string }[] = [
  { keys: [['⌘', 'K'], ['/']], what: 'Search, or run a command' },
  { keys: [['G', 'O']], what: 'Go to the overview — or A, S, L, U, G, V, F for the rest' },
  { keys: [['J'], ['K']], what: 'Next or previous record, in a detail sheet' },
  { keys: [['←'], ['→']], what: 'Read a chart a day at a time, once it has focus' },
  { keys: [['R']], what: 'Refresh everything on screen' },
  { keys: [['?']], what: 'This list' },
  { keys: [['Esc']], what: 'Close what is open' },
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const mac = isMac();
  return (
    <Modal
      title="Keyboard shortcuts"
      description="The console, without the mouse."
      onClose={onClose}
    >
      <dl className="flex flex-col">
        {SHORTCUTS.map((row) => (
          <div
            key={row.what}
            className="flex items-center justify-between gap-4 border-t border-border/60 py-3 first:border-t-0"
          >
            <dt className="text-sm text-muted-foreground">{row.what}</dt>
            <dd className="flex shrink-0 items-center gap-2">
              {row.keys.map((combo, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  {i > 0 ? <span className="mr-1.5 text-xs text-muted-foreground">or</span> : null}
                  {combo.map((key) => (
                    <Kbd key={key} className="h-6 min-w-6 text-[11px]">
                      {key === '⌘' && !mac ? 'Ctrl' : key}
                    </Kbd>
                  ))}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
