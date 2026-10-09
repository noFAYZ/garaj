'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Crown,
  Database,
  KeyRound,
  Monitor,
  Ruler,
  Shuffle,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ComponentType } from 'react';
import {
  avatarFor,
  avatarSeeds,
  avatarUrl,
  type Garage,
  type NotificationPreference,
} from '@vehicle-os/contracts';
import { DISTANCE_UNITS, NOTIFICATION_TYPES, type DistanceUnit } from '@vehicle-os/domain';
import { queryKeys } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { SectionCard } from '@/components/ui/primitives';
import { buttonClass } from '@/components/ui/button-class';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingRow, SettingToggle } from '@/components/ui/setting-row';
import { ThemePicker } from '@/components/theme-picker';
import { ToastPositionPicker } from '@/components/toast-position-picker';
import { setReduceMotion, useReduceMotion } from '@/lib/settings/motion';
import { setGlass, useGlass } from '@/lib/settings/theme';
import { Select } from '@/components/ui/select';
import { DataSettings } from '@/components/transfer-panel';
import { PlanSettings } from '@/components/plan-settings';
import { DeveloperSettings } from '@/components/developer-settings';

const DISTANCE_OPTIONS = DISTANCE_UNITS.map((unit) => ({
  value: unit,
  label: unit === 'KM' ? 'Kilometres' : 'Miles',
}));

/**
 * Every currency the runtime can actually format, which is the same list the server validates
 * against (`assertCurrency`) — so the select cannot offer a code the API will refuse. From ICU
 * rather than a hand-kept array: a list of three hundred codes maintained by hand is a list
 * that is wrong.
 */
export const CURRENCY_OPTIONS = (() => {
  const names = new Intl.DisplayNames(['en'], { type: 'currency' });
  const codes =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : ['USD'];
  return codes.map((code) => ({
    value: code,
    // The code first, because it is what the user is looking for and what typeahead matches on.
    label: `${code} · ${names.of(code) ?? code}`,
    icon: <CurrencyFlag code={code} />,
  }));
})();

/**
 * The flag for a currency.
 *
 * An image rather than a flag emoji, which Windows does not draw at all — Segoe UI Emoji has
 * no flag glyphs, so `🇺🇸` renders as the letters "US". The phone's picker uses the same
 * source for the same reason.
 *
 * An ISO 4217 code opens with its country's ISO 3166 code, which is how flagcdn names its
 * files. The codes that are not countries — XAU for gold, XDR, the regional units — have no
 * flag to fetch, so the box is held and hidden on error and the labels stay in line.
 */
export function CurrencyFlag({ code }: { code: string }) {
  return (
    // Plain `img`: `next/image` would need flagcdn in `remotePatterns` and buys nothing for a
    // 20px flag the browser already caches.
    <img
      src={`https://flagcdn.com/w40/${code.slice(0, 2).toLowerCase()}.png`}
      alt=""
      width={20}
      height={14}
      loading="lazy"
      onError={(event) => {
        event.currentTarget.style.visibility = 'hidden';
      }}
      className="h-3.5 w-5 shrink-0 rounded-[3px] bg-muted object-cover"
    />
  );
}

/**
 * Settings are composed rows, not forty bespoke flex containers.
 *
 * Device preferences (theme, motion, toast position) live in `localStorage` and never reach the server —
 * they are per-browser, and syncing them would make one machine's choice override another's.
 * Account preferences (units, currency) are server state, because they change how data is
 * interpreted everywhere including on mobile.
 */

/** The profile, from the same cache entry wherever a section reads it. */
export function useProfile() {
  return useQuery({ queryKey: queryKeys.me(), queryFn: () => api.users.me() });
}

export function AppearanceSettings() {
  const reduceMotion = useReduceMotion();
  const glass = useGlass();

  return (
    <div className="flex flex-col">
      <SettingRow title="Theme" description="System follows your device, and changes when it does.">
        {(label) => <ThemePicker labelledBy={label.id} />}
      </SettingRow>
      <SettingToggle
        title="Liquid Glass"
        description="Frosted, translucent surfaces, light or dark with the theme above."
        checked={glass}
        onCheckedChange={(on) => setGlass(on)}
      />
      <SettingToggle
        title="Reduce motion"
        description="Turns off animation across the app, including animated controls."
        checked={reduceMotion}
        onCheckedChange={setReduceMotion}
      />
      <SettingRow title="Toasts" description="Where saves and errors are confirmed.">
        {(label) => <ToastPositionPicker labelledBy={label.id} />}
      </SettingRow>
    </div>
  );
}

export function UnitsSettings() {
  const queryClient = useQueryClient();
  const profile = useProfile();

  const updateProfile = useMutation({
    mutationFn: (patch: { distanceUnit?: DistanceUnit; defaultCurrency?: string }) =>
      api.users.updateMe(patch),
    /*
     * Optimistic with rollback. A unit toggle that lags behind the click feels broken; one
     * that snaps back on failure is honest. Keeping a value the server refused is neither.
     */
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.me() });
      const previous = queryClient.getQueryData(queryKeys.me());
      queryClient.setQueryData(queryKeys.me(), (current: unknown) =>
        current ? { ...current, ...patch } : current,
      );
      return { previous };
    },
    onError: (_error, _patch, context) => {
      queryClient.setQueryData(queryKeys.me(), context?.previous);
    },
    onSuccess: async (_result, patch) => {
      if (patch.defaultCurrency) await adoptCurrency(patch.defaultCurrency);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
  });

  /*
   * A garage's currency is what the server quotes its totals in, so changing yours moves the
   * garages you own with it — the same rule the phone applies, because a preference that means
   * two different things depending on where it was set is not a preference.
   *
   * Shared garages belong to someone else and keep theirs. A garage the server refuses is left
   * as it was; the preference itself has already saved.
   */
  const adoptCurrency = async (defaultCurrency: string) => {
    const owned = (queryClient.getQueryData<Garage[]>(queryKeys.garages()) ?? []).filter(
      (garage) => garage.role === 'OWNER' && garage.defaultCurrency !== defaultCurrency,
    );
    await Promise.allSettled(
      owned.map((garage) => api.garages.update(garage.id, { defaultCurrency })),
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
  };

  /*
   * The rows, titles and descriptions are the same for everyone and are drawn at once.
   * Only the value on the right of each row waits for the profile — a placeholder the
   * size of the control, so nothing jumps when it lands.
   */
  return (
    <div className="flex flex-col">
      <SettingRow
        title="Distance"
        description="How odometer readings and intervals are shown. Stored values keep their own unit."
      >
        {() =>
          profile.isPending ? (
            <Skeleton className="h-10 w-40 rounded-xl" />
          ) : (
            <Select
              value={profile.data?.distanceUnit ?? 'KM'}
              onValueChange={(value) =>
                updateProfile.mutate({ distanceUnit: value as DistanceUnit })
              }
              ariaLabel="Distance unit"
              options={DISTANCE_OPTIONS}
              className="w-40"
            />
          )
        }
      </SettingRow>

      <SettingRow
        title="Currency"
        description="Default for new records. The garages you own move with it; shared ones keep theirs."
      >
        {() =>
          profile.isPending ? (
            <Skeleton className="h-10 w-40 rounded-xl" />
          ) : (
            <Select
              value={profile.data?.defaultCurrency ?? 'USD'}
              onValueChange={(value) => updateProfile.mutate({ defaultCurrency: value })}
              ariaLabel="Default currency"
              options={CURRENCY_OPTIONS}
              className="w-40"
            />
          )
        }
      </SettingRow>
    </div>
  );
}

/**
 * Email and push, one switch each.
 *
 * The server stores the full type × channel grid, but eleven rows of switches is a settings
 * page nobody reads. A channel is on when every type is on it, and flipping it writes every
 * type — so a finer screen can be added later without a migration.
 */
export function NotificationSettings() {
  const queryClient = useQueryClient();
  const preferences = useQuery({
    queryKey: queryKeys.notificationPreferences(),
    queryFn: () => api.notifications.preferences(),
  });

  const update = useMutation({
    mutationFn: (rows: NotificationPreference[]) => api.notifications.updatePreferences(rows),
    meta: { toast: false },
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences() }),
  });

  const channelOn = (channel: 'EMAIL' | 'PUSH') =>
    (preferences.data ?? []).filter((row) => row.channel === channel).every((row) => row.enabled);

  const set = (channel: 'EMAIL' | 'PUSH', enabled: boolean) =>
    update.mutate(
      NOTIFICATION_TYPES.map((notificationType) => ({ notificationType, channel, enabled })),
    );

  const pending = preferences.isPending;
  const value = (channel: 'EMAIL' | 'PUSH') =>
    update.isPending && update.variables?.[0]?.channel === channel
      ? update.variables[0].enabled
      : channelOn(channel);

  return (
    <div className="flex flex-col">
      {/*
       * A placeholder until the grid arrives: an "off" switch while loading states the wrong
       * answer, since a channel with no stored choice is on.
       */}
      {(
        [
          {
            channel: 'EMAIL',
            title: 'Email',
            description:
              'Reminders go to your sign-in address, never between 21:00 and 08:00 your time.',
          },
          {
            channel: 'PUSH',
            title: 'Phone',
            description: 'Push to every phone signed in to Garaj. The bell always keeps a copy.',
          },
        ] as const
      ).map((row) =>
        pending ? (
          <SettingRow key={row.channel} title={row.title} description={row.description}>
            {() => <Skeleton className="h-6 w-11 rounded-full" />}
          </SettingRow>
        ) : (
          <SettingToggle
            key={row.channel}
            title={row.title}
            description={row.description}
            checked={value(row.channel)}
            onCheckedChange={(checked) => set(row.channel, checked)}
          />
        ),
      )}
    </div>
  );
}

/**
 * A picture is one of DiceBear's adventurer-neutral faces: twelve to choose from, and shuffle for
 * twelve more. Picking one saves it — the grid is the whole control, so there is no Save to miss.
 */
function AvatarPicker() {
  const queryClient = useQueryClient();
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  const [seeds, setSeeds] = useState(() => avatarSeeds(12));

  const save = useMutation({
    mutationFn: (image: string) => api.users.updateMe({ image }),
    meta: { toast: 'Picture updated' },
    onSuccess: (me) => {
      queryClient.setQueryData(queryKeys.me(), me);
      setOpen(false);
    },
  });

  const me = profile.data;
  return (
    <div className="flex flex-col gap-3 rounded-xl px-4 py-3">
      <div className="flex items-center gap-4">
        {me ? (
          <img
            src={avatarFor(me)}
            alt=""
            className="size-12 shrink-0 rounded-full bg-primary-soft object-cover"
          />
        ) : (
          <Skeleton className="size-12 rounded-full" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">Picture</div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Shown beside your name to your garage.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          disabled={!me}
          onClick={() => setOpen(!open)}
          className={buttonClass('secondary', 'sm')}
        >
          {open ? 'Close' : 'Change'}
        </button>
      </div>

      {open && me ? (
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Pictures" className="grid grid-cols-6 gap-2">
            {seeds.map((seed) => (
              <button
                key={seed}
                type="button"
                aria-label="Use this picture"
                disabled={save.isPending}
                onClick={() => save.mutate(avatarUrl(seed))}
                className={cn(
                  'aspect-square overflow-hidden rounded-full bg-primary-soft ring-2 ring-transparent transition',
                  'hover:ring-primary focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50',
                  save.variables === avatarUrl(seed) && save.isPending && 'ring-primary',
                )}
              >
                <img
                  src={avatarUrl(seed)}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSeeds(avatarSeeds(12))}
            className={buttonClass('ghost', 'sm', 'self-start')}
          >
            <Shuffle aria-hidden="true" className="size-4" />
            Shuffle
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AccountSettings() {
  const profile = useProfile();

  return (
    <div className="flex flex-col">
      <AvatarPicker />
      <SettingRow title="Email">
        {() =>
          profile.isPending ? (
            <Skeleton className="h-5 w-48 max-w-full" />
          ) : (
            <span className="truncate text-sm text-muted-foreground">{profile.data?.email}</span>
          )
        }
      </SettingRow>
      <SettingRow title="Name">
        {() =>
          profile.isPending ? (
            <Skeleton className="h-5 w-28" />
          ) : (
            <span className="text-sm text-muted-foreground">{profile.data?.name}</span>
          )
        }
      </SettingRow>
    </div>
  );
}

/**
 * The sections, once. The header's dialog lays them out down a sidebar and the `/settings` route
 * stacks them — a setting added to a section is in both by construction.
 */
export const SETTINGS_SECTIONS: readonly {
  value: string;
  title: string;
  description: string;
  icon: LucideIcon;
  Content: ComponentType;
}[] = [
  {
    value: 'appearance',
    title: 'Appearance',
    description: 'Stored on this device.',
    icon: Monitor,
    Content: AppearanceSettings,
  },
  {
    value: 'units',
    title: 'Units and formats',
    description: 'Applies to your account everywhere, including mobile.',
    icon: Ruler,
    Content: UnitsSettings,
  },
  {
    value: 'notifications',
    title: 'Notifications',
    description: 'Where reminders reach you.',
    icon: Bell,
    Content: NotificationSettings,
  },
  {
    value: 'data',
    title: 'Your data',
    description: 'Take it with you, whole.',
    icon: Database,
    Content: DataSettings,
  },
  {
    value: 'developers',
    title: 'API & MCP',
    description: 'Keys for scripts and AI assistants.',
    icon: KeyRound,
    Content: DeveloperSettings,
  },
  {
    value: 'plan',
    title: 'Plan and billing',
    description: 'Usage, billing and tiers.',
    icon: Crown,
    Content: PlanSettings,
  },
  {
    value: 'account',
    title: 'Account',
    description: 'Who you are signed in as.',
    icon: UserRound,
    Content: AccountSettings,
  },
];

/** Every section stacked, for the `/settings` route. */
export function SettingsPanel() {
  return (
    <div className="flex flex-col gap-6">
      {SETTINGS_SECTIONS.map(({ value, title, description, icon: SectionIcon, Content }) => (
        <SectionCard
          key={value}
          title={title}
          description={description}
          icon={<SectionIcon className="size-5" />}
        >
          <Content />
        </SectionCard>
      ))}
    </div>
  );
}
