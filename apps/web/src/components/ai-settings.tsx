'use client';

import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Switch } from '@/components/motion/switch';
import { Modal } from '@/components/ui/modal';
import { SettingToggle } from '@/components/ui/setting-row';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { AI_NAME, setAiSettings, useAiSettings, type AiSettings } from '@/lib/settings/ai';
import { cn } from '@/lib/utils';

/** What each offered model is good for, in a word. Unknown ids still show, just without one. */
const MODEL_NOTES: Record<string, string> = {
  'gemini-3.1-flash-lite': 'Balanced',
  'gemini-3.5-flash-lite': 'Fastest',
  'gemini-3.8-flash': 'Thorough',
};

/** The three kinds of work, as tiles. The full sentence is the tooltip, not the tile. */
const ABILITIES: readonly {
  key: keyof Pick<AiSettings, 'canAsk' | 'canLog' | 'canPlan' | 'canManage' | 'canDelete'>;
  label: string;
  icon: IconName;
  hint: string;
}[] = [
  { key: 'canAsk', label: 'Answer', icon: 'search', hint: 'Reads records, never writes' },
  { key: 'canLog', label: 'Log', icon: 'edit', hint: 'Fill-ups, services, trips' },
  { key: 'canPlan', label: 'Plan', icon: 'calendar', hint: 'Reminders and schedules' },
  { key: 'canManage', label: 'Vehicles', icon: 'car', hint: 'Vehicles and garages' },
  { key: 'canDelete', label: 'Delete', icon: 'trash', hint: 'Two presses each' },
];

/** "gemini-3.1-flash-lite" → ["Gemini", "3.1 Flash Lite"]: the family over the model. */
function modelParts(model: string): [string, string] {
  const [family = model, ...rest] = model
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return [family, rest.join(' ')];
}

export function useAiModels() {
  return useQuery({
    queryKey: ['ai', 'models'],
    queryFn: () => api.ai.models(),
    // The operator's list changes with a deploy, not while a page is open.
    staleTime: Infinity,
  });
}

/** GarajAI's settings: three rows of tiles and two switches. */
export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useAiSettings();
  const models = useAiModels();
  const data = models.data;
  // A saved choice the operator has since withdrawn reads as the default, as the console sends it.
  const current =
    settings.model && data?.choices.includes(settings.model) ? settings.model : data?.default;

  return (
    <Modal title={`${AI_NAME} settings`} icon="settings" onClose={onClose}>
      <div className="flex flex-col gap-6">
        <Group label="Model">
          <div role="radiogroup" aria-label="Model" className="grid grid-cols-3 gap-2">
            {data
              ? data.choices.map((model) => {
                  const selected = model === current;
                  const [family, name] = modelParts(model);
                  return (
                    <Tile
                      key={model}
                      on={selected}
                      label={`${family} ${name}`}
                      onClick={() =>
                        setAiSettings({ model: model === data.default ? null : model })
                      }
                    >
                      <span className="text-xs text-muted-foreground">{family}</span>
                      <span className="text-sm font-semibold leading-tight text-foreground">
                        {name}
                      </span>
                      <span className="mt-auto pt-2 text-xs text-muted-foreground">
                        {MODEL_NOTES[model] ?? (model === data.default ? 'Default' : '')}
                      </span>
                      {selected ? (
                        <span className="absolute right-2.5 top-2.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                        </span>
                      ) : null}
                    </Tile>
                  );
                })
              : [0, 1, 2].map((tile) => <Skeleton key={tile} className="h-24 rounded-2xl" />)}
          </div>
        </Group>

        {/* One list, hairlines between rows: icon, what it may do, a few words of scope, a switch. */}
        <Group label="Can">
          <ul className="flex flex-col gap-px overflow-hidden rounded-2xl bg-border/60">
            {ABILITIES.map((ability) => {
              const on = settings[ability.key];
              return (
                <li key={ability.key} className="flex items-center gap-3 bg-muted/60 px-3 py-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-popover">
                    <Icon
                      name={ability.icon}
                      size={18}
                      className={on ? 'text-foreground' : 'text-muted-foreground'}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm font-semibold',
                        on ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {ability.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {ability.hint}
                    </span>
                  </span>
                  <Switch
                    checked={on}
                    onCheckedChange={(checked) => setAiSettings({ [ability.key]: checked })}
                    ariaLabel={ability.label}
                  />
                </li>
              );
            })}
          </ul>
        </Group>

        <Group label="Behaviour">
          <div className="-my-1 flex flex-col">
            <SettingToggle
              title="Follow the page"
              checked={settings.followPage}
              onCheckedChange={(followPage) => setAiSettings({ followPage })}
            />
            <SettingToggle
              title="Ctrl J to open"
              checked={settings.shortcut}
              onCheckedChange={(shortcut) => setAiSettings({ shortcut })}
            />
          </div>
        </Group>
      </div>
    </Modal>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-label uppercase text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

/** A model drawn as a tile: lit in the selection fill when chosen, a quiet fill when not. */
function Tile({
  on,
  label,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'relative flex min-h-24 min-w-0 flex-col items-stretch rounded-2xl p-3 text-left transition-colors active:scale-[0.98]',
        on ? 'bg-primary-soft' : 'bg-muted/60 hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}
