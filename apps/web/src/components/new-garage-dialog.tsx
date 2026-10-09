'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { openUpgrade, usePlan } from '@/lib/upgrade';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Garage } from '@vehicle-os/contracts';
import { ApiError } from '@vehicle-os/api-client';
import { queryKeys } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/components/icons';
import { CURRENCY_OPTIONS, useProfile } from '@/components/settings-panel';
import { FormError, Modal, ModalActions } from '@/components/ui/modal';
import { Button } from '@/components/ui/primitives';
import { Select } from '@/components/ui/select';
import { useStableReducedMotion } from '@/lib/hooks/use-stable-reduced-motion';
import { cn } from '@/lib/utils';

/** Names people actually give a second garage — one tap instead of a blank field. */
const NAME_IDEAS: readonly { name: string; icon: IconName }[] = [
  { name: 'Daily drivers', icon: 'car' },
  { name: 'Project cars', icon: 'maintenance' },
  { name: 'Track toys', icon: 'speedometer' },
  { name: 'Family', icon: 'people' },
  { name: 'Two wheels', icon: 'motorcycle' },
];

const BAYS = 4;
const pad = (value: number) => String(value).padStart(2, '0');
const DOOR = { type: 'spring', bounce: 0.18, visualDuration: 0.5 } as const;

/**
 * Anything that opens the new-garage dialog: a primary button on one screen, a tile at the end
 * of the garage rail on another. The trigger's look belongs to where it sits; the dialog does not.
 */
export function NewGarageButton({
  className,
  children,
  onCreated,
}: {
  className?: string;
  children: ReactNode;
  onCreated?: (garage: Garage) => void;
}) {
  const [open, setOpen] = useState(false);
  const { limitWall } = usePlan();

  // The plans instead of a form that would be refused — see `AddVehicleButton`.
  const start = () => {
    const wall = limitWall('garages');
    if (wall) openUpgrade(wall);
    else setOpen(true);
  };

  return (
    <>
      <button type="button" className={className} onClick={start}>
        {children}
      </button>
      {/* Mounted only while open, so a second garage starts from an empty form. */}
      {open ? <NewGarageDialog onClose={() => setOpen(false)} onCreated={onCreated} /> : null}
    </>
  );
}

/**
 * Creating a garage without leaving the page you were on — and watching it get built.
 *
 * Beside the questions stands the garage itself: its name painted on the sign as it is typed,
 * a roller door over four empty bays, the currency it counts in. The door lifts a hand's width
 * once there is a name, and rolls all the way up when the garage is made, so the last thing seen
 * before the dialog goes is the empty floor the first vehicle will park on.
 */
export function NewGarageDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (garage: Garage) => void;
}) {
  const queryClient = useQueryClient();
  const reduce = useStableReducedMotion();
  const profile = useProfile();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [noting, setNoting] = useState(false);
  const [currencySet, setCurrency] = useState<string | null>(null);
  const [made, setMade] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(leaving.current ?? undefined), []);

  // The person's own currency until they choose another: what their other records are in.
  const currency = currencySet ?? profile.data?.defaultCurrency ?? 'USD';
  const trimmed = name.trim();

  const create = useMutation({
    mutationFn: () =>
      api.garages.create({
        name: trimmed,
        defaultCurrency: currency,
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    meta: { toast: 'Garage created' },
    onSuccess: (garage) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
      // The dashboard counts garages too, and it is its own request.
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      setMade(true);
      // The door finishes rolling up before the dialog goes; at once, with reduced motion.
      leaving.current = setTimeout(
        () => {
          onClose();
          onCreated?.(garage);
        },
        reduce ? 0 : 700,
      );
    },
  });

  const fieldErrors = create.error instanceof ApiError ? create.error.fields : undefined;
  const door = made || create.isPending ? 'open' : trimmed ? 'ajar' : 'shut';

  return (
    <Modal title="New garage" icon="garage" size="lg" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed && !create.isPending && !made) create.mutate();
        }}
        className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]"
      >
        <GaragePreview name={trimmed} currency={currency} door={door} />

        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-3">
            <label htmlFor="garage-name" className="text-sm font-semibold text-foreground">
              What do you call it?
            </label>
            <input
              id="garage-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Weekend toys"
              required
              maxLength={120}
              autoComplete="off"
              aria-invalid={Boolean(fieldErrors?.name) || undefined}
              aria-describedby={fieldErrors?.name ? 'garage-name-error' : undefined}
              className="h-12 w-full min-w-0 rounded-xl bg-input px-4 text-lg font-semibold tracking-tight text-foreground placeholder:font-normal placeholder:text-muted-foreground"
            />
            {fieldErrors?.name ? (
              <p id="garage-name-error" role="alert" className="text-xs text-destructive">
                {fieldErrors.name}
              </p>
            ) : null}
            <div role="group" aria-label="Name ideas" className="flex flex-wrap gap-1.5">
              {NAME_IDEAS.map((idea) => {
                const selected = name === idea.name;
                return (
                  <button
                    key={idea.name}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setName(idea.name)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full pl-2 pr-3 text-xs font-semibold transition-[background-color,color,scale] duration-150 active:scale-95',
                      selected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-border hover:text-foreground',
                    )}
                  >
                    <Icon name={idea.icon} size={16} />
                    {idea.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span id="garage-currency" className="text-sm font-semibold text-foreground">
              What does it count in?
            </span>
            <Select
              value={currency}
              onValueChange={setCurrency}
              options={CURRENCY_OPTIONS}
              ariaLabel="Currency"
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">Its totals are kept in this.</p>
          </div>

          {/* The note is the one thing most garages never need, so it waits behind a press. */}
          {noting || description ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="garage-note" className="text-sm font-semibold text-foreground">
                A note
              </label>
              <textarea
                id="garage-note"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What lives here"
                maxLength={2000}
                rows={2}
                autoFocus
                className="min-h-20 w-full resize-none rounded-xl bg-input px-4 py-3 text-sm text-foreground [field-sizing:content] placeholder:text-muted-foreground"
              />
              {fieldErrors?.description ? (
                <p role="alert" className="text-xs text-destructive">
                  {fieldErrors.description}
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNoting(true)}
              className="-mt-2 self-start text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              + Add a note
            </button>
          )}

          {create.isError && !fieldErrors ? <FormError>{create.error.message}</FormError> : null}

          <ModalActions className="mt-auto">
            <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!trimmed || made}
            >
              Create garage
            </Button>
          </ModalActions>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The garage, standing: a sign with its name, a roller door, the floor behind it.
 *
 * Drawn as the garage card draws its floor — numbered bays, painted lines — so the thing made
 * here is recognisably the thing that appears in the rail. Decorative: every value in it is
 * also a field the form names.
 */
function GaragePreview({
  name,
  currency,
  door,
}: {
  name: string;
  currency: string;
  door: 'shut' | 'ajar' | 'open';
}) {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col gap-2.5 rounded-2xl bg-muted/60 p-3 md:self-start"
    >
      {/* The sign over the door, the name painted on it as it is typed. */}
      <div className="rounded-lg bg-popover px-3 py-2.5 text-center ring-1 ring-inset ring-border/70">
        <span
          className={cn(
            'block truncate font-mono text-xs font-semibold uppercase tracking-[0.2em]',
            name ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {name || 'Your garage'}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-xl bg-card">
        {/* The door's housing, which the door rolls up into. */}
        <span className="absolute inset-x-0 top-0 z-20 h-1.5 bg-border-strong" />

        {/* The floor: four bays, numbered, with painted lines between them. */}
        <div className="grid grid-cols-4 px-1 pt-3">
          {Array.from({ length: BAYS }, (_, bay) => (
            <div
              key={bay}
              className="relative flex aspect-[4/5] flex-col items-center justify-end pb-1"
            >
              {bay > 0 ? (
                <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-[repeating-linear-gradient(to_bottom,var(--color-border-strong)_0_5px,transparent_5px_9px)]" />
              ) : null}
              <span className="font-mono text-[0.5625rem] font-semibold tabular-nums tracking-wider text-muted-foreground">
                {pad(bay + 1)}
              </span>
            </div>
          ))}
        </div>

        {/* The roller door: slats, a handle, and how far up it is. */}
        <motion.div
          className="absolute inset-0 z-10 flex items-end justify-center bg-[repeating-linear-gradient(to_bottom,var(--color-muted)_0_7px,var(--color-border)_7px_9px)] pb-2"
          initial={false}
          animate={{ y: door === 'open' ? '-100%' : door === 'ajar' ? '-24%' : '0%' }}
          transition={DOOR}
        >
          <span className="h-1 w-8 rounded-full bg-border-strong" />
        </motion.div>
      </div>

      <p className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
        <span>
          <span className="font-mono font-semibold tabular-nums text-foreground">00</span> vehicles
        </span>
        <span className="font-mono font-semibold tabular-nums text-foreground">{currency}</span>
      </p>
    </div>
  );
}
