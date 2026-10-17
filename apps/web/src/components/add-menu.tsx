'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CornerDownLeft, Plus } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AiAnswer, Vehicle } from '@vehicle-os/contracts';
import { api } from '@/lib/api';
import { BrandLogo } from '@/components/brand-logo';
import { Emoji, type EmojiName } from '@/components/emoji';
import { Icon } from '@/components/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/motion/popover';
import { NewGarageDialog } from '@/components/new-garage-dialog';
import { typeIcon } from '@/components/vehicle-hero';
import { readIntent } from '@/lib/add-intent';
import { eventEmoji } from '@/lib/event-emoji';
import { formatDate, formatMoney, humanise, toMinorUnits } from '@/lib/format';
import { openHere } from '@/lib/open-add';
import { parseDone } from '@vehicle-os/ui';
import { openUpgrade, useOwnPlanGoverns, usePlan } from '@/lib/upgrade';
import { cn } from '@/lib/utils';

// Loaded on first use: the wizard inlines the make logos (see `AddVehicleButton`).
const AddVehicleDialog = dynamic(
  () => import('@/components/add-vehicle-dialog').then((module) => module.AddVehicleDialog),
  { ssr: false },
);

type AskBody = { question: string; vehicleId?: string };

const EXAMPLES = ['Filled up 40 L, €62 at Shell', 'What did I spend this year?'];

/** An amount as it was written: in its currency when the line named one. */
function money(amount: string, currency: string | null) {
  if (!currency || currency === '$') return `${currency ?? ''}${amount}`;
  return formatMoney({ amountMinor: toMinorUnits(Number(amount), currency), currency });
}

/**
 * One line to type anything into, on the home screen itself.
 *
 * A question — "what did the Mazda cost this year?" — is asked of Ask and answered here, from the
 * person's own records. Anything else is something to put on a vehicle's record: read as it is
 * typed (`quick-entry`, shared with the phone), the vehicle it names found (`lib/add-intent`), and
 * Enter opens that vehicle's add dialog with the line already in it to check — "remind me to…", or
 * an interval, opens it on Reminder. Nothing is saved from here; the dialog is where it is confirmed.
 *
 * What Enter will do is said under the line before it does it. `aside` sits at the line's end.
 */
export function QuickLine({
  vehicles,
  aside,
}: {
  vehicles: readonly Vehicle[];
  aside?: ReactNode;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const intent = useMemo(() => readIntent(text, vehicles), [text, vehicles]);
  const vehicle =
    intent.kind === 'log'
      ? (intent.vehicle ?? vehicles.find((item) => item.id === picked) ?? null)
      : null;
  const parsed = intent.kind === 'log' ? parseDone(intent.line) : null;

  const ask = useMutation<AiAnswer, Error, AskBody>({
    mutationFn: (body) => api.ai.ask(body),
    meta: { toast: false },
  });

  const submit = () => {
    if (intent.kind === 'ask') {
      if (intent.question.length < 3) return;
      ask.mutate({
        question: intent.question,
        ...(intent.vehicle ? { vehicleId: intent.vehicle.id } : {}),
      });
      return;
    }
    if (intent.kind !== 'log' || !vehicle) return;
    const mode = intent.planned ? 'planned' : 'done';
    openHere(router, `/vehicles/${vehicle.id}?add=${mode}&say=${encodeURIComponent(intent.line)}`);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          /*
           * The outline, in three weights: a hairline at rest so the field reads as a field on the
           * panel, a firmer one under the pointer, and the focus ring in ink with a soft halo of it
           * while typing — box shadows rather than a border, so nothing inside moves between them.
           */
          className="flex max-w-sm flex-1 items-center gap-2.5 rounded-2xl bg-input p-1.5 pl-2 shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-shadow duration-200 hover:shadow-[inset_0_0_0_1px_var(--color-muted-foreground)] "
        >
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-card"
          >
            <Emoji name="sparkles" size={20} />
          </span>
          <input
            ref={input}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (ask.data || ask.error) ask.reset();
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            aria-label="Type something to log, or a question"
            placeholder="Log anything, or ask…"
            className="h-9 max-w-sm flex-1 bg-transparent text-[0.9375rem] font-medium text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            aria-label={intent.kind === 'ask' ? 'Ask' : 'Continue'}
            disabled={
              intent.kind === 'empty' || ask.isPending || (intent.kind === 'log' && !vehicle)
            }
            className="key grid size-9 shrink-0 place-items-center rounded-xl disabled:opacity-30"
          >
            <CornerDownLeft className="size-4" aria-hidden="true" />
          </button>
        </form>
        {aside}
      </div>

      {/* What Enter will do, said before it does it. */}
      <div aria-live="polite" className="px-1">
        {intent.kind === 'empty' ? (
          // Examples only while the line is in use and still empty: otherwise the space is the page's.
          focused ? (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  // Before the blur, so the line keeps focus and the examples stay to be read.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setText(example)}
                  className="rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
          ) : null
        ) : intent.kind === 'ask' ? (
          <Answer ask={ask} vehicle={intent.vehicle} />
        ) : vehicles.length === 0 ? (
          <p className="text-xs text-muted-foreground">Add a vehicle first, from +.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                <Emoji
                  name={
                    intent.planned ? 'calendar' : parsed?.kind ? eventEmoji(parsed.kind) : 'note'
                  }
                  size={16}
                />
                {intent.planned
                  ? 'Remind'
                  : parsed?.kind
                    ? `Log ${humanise(parsed.kind).toLowerCase()}`
                    : 'Log it'}
              </span>
              {parsed?.amount ? (
                <span className="font-mono tabular-nums">
                  {money(parsed.amount, parsed.currency)}
                </span>
              ) : null}
              {parsed?.day ? <span>{formatDate(`${parsed.day}T12:00:00`)}</span> : null}
              {vehicle ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{vehicle.displayName}</span>
                  <span aria-hidden="true">· Enter</span>
                </span>
              ) : (
                <span>· which vehicle?</span>
              )}
            </p>
            {vehicle ? null : (
              // No vehicle named, and more than one to choose from: ask, never guess.
              <div className="flex flex-wrap gap-1.5">
                {vehicles.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setPicked(item.id);
                      input.current?.focus();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 py-1 pl-1 pr-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <VehicleMark vehicle={item} small />
                    {item.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const TILES = [
  { key: 'garage', emoji: 'garage', label: 'Garage', hint: 'Group vehicles' },
  { key: 'vehicle', emoji: 'vehicle', label: 'Vehicle', hint: 'Car, bike, boat' },
  { key: 'activity', emoji: 'logbook', label: 'Activity', hint: 'Done, or a reminder' },
] as const satisfies readonly { key: string; emoji: EmojiName; label: string; hint: string }[];

/**
 * The round key that opens into the three things to add by hand, each with its glyph: a garage,
 * a vehicle, an entry — the last asking which vehicle when there is more than one. The dialogs open
 * once the panel has closed, so the panel's light dismiss never takes a dialog down with it, and a
 * plan at its limit opens the plans instead of a form that would be refused, as the buttons do.
 */
export function AddMenu({ vehicles }: { vehicles: readonly Vehicle[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'menu' | 'pick'>('menu');
  const [dialog, setDialog] = useState<'garage' | 'vehicle' | null>(null);
  const { limitWall } = usePlan();
  const governs = useOwnPlanGoverns(undefined);

  const close = () => {
    setOpen(false);
    setStep('menu');
  };

  const go = (href: string) => {
    close();
    openHere(router, href);
  };

  function choose(key: (typeof TILES)[number]['key']) {
    if (key === 'activity') {
      if (vehicles.length === 0) return choose('vehicle');
      if (vehicles.length === 1) return go(`/vehicles/${vehicles[0]!.id}?add=done`);
      setStep('pick');
      return;
    }
    const wall = key === 'garage' ? limitWall('garages') : governs ? limitWall('vehicles') : null;
    close();
    if (wall) openUpgrade(wall);
    else setDialog(key);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        side="bottom"
        align="end"
        sideOffset={12}
        panelRadius={24}
      >
        <PopoverTrigger>
          <button
            type="button"
            aria-label={open ? 'Close the add menu' : 'Add'}
            className="key group grid size-11 shrink-0 place-items-center rounded-full"
          >
            <Plus
              aria-hidden="true"
              strokeWidth={2.5}
              className="size-5 transition-transform duration-300 ease-out group-data-[state=open]:rotate-45"
            />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] max-w-none p-2">
          {step === 'pick' ? (
            <div
              className="flex animate-step flex-col gap-1"
              style={{ '--step-dir': 1 } as CSSProperties}
            >
              <div className="flex items-center gap-2 px-1.5 pb-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => setStep('menu')}
                  aria-label="Back"
                  className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </button>
                <p className="text-sm font-semibold text-foreground">Log it for which vehicle?</p>
              </div>
              <ul className="scrollbar-slim flex max-h-72 flex-col gap-1 overflow-y-auto">
                {vehicles.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => go(`/vehicles/${item.id}?add=done`)}
                      className="group flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-muted/60"
                    >
                      <VehicleMark vehicle={item} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                        {item.displayName}
                      </span>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-1.5">
              {TILES.map((tile, index) => (
                <li key={tile.key}>
                  <button
                    type="button"
                    onClick={() => choose(tile.key)}
                    className="stagger group flex h-full w-full animate-rise flex-col items-start gap-3 rounded-2xl bg-muted/60 p-3 text-left transition-[background-color,scale] hover:bg-muted active:scale-[0.97]"
                    style={{ '--i': index } as CSSProperties}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-11 place-items-center rounded-xl bg-card transition-transform duration-300 ease-out group-hover:-translate-y-0.5 group-hover:-rotate-6"
                    >
                      <Emoji name={tile.emoji} size={26} />
                    </span>
                    <span className="w-full min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {tile.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {tile.hint}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      {dialog === 'garage' ? <NewGarageDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'vehicle' ? <AddVehicleDialog onClose={() => setDialog(null)} /> : null}
    </>
  );
}

/** Ask's answer, under the line: the words, and how many records they were drawn from. */
function Answer({
  ask,
  vehicle,
}: {
  ask: UseMutationResult<AiAnswer, Error, AskBody>;
  vehicle: Vehicle | null;
}) {
  if (ask.isPending) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
        Reading your records…
      </p>
    );
  }
  if (ask.error) {
    /*
     * Said plainly; the provider's own words, often a page of JSON, stay one hover away rather
     * than filling the panel.
     */
    return (
      <p title={ask.error.message} className="text-xs text-muted-foreground">
        <span className="font-semibold text-destructive">Ask couldn’t answer just now.</span> Try
        again in a moment, or log it instead.
      </p>
    );
  }
  if (ask.data) {
    const records = ask.data.sources.length;
    return (
      <div className="flex animate-rise flex-col gap-2 rounded-2xl bg-background/60 p-3">
        <p className="scrollbar-slim max-h-48 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-foreground">
          {ask.data.answer}
        </p>
        <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            From {records} {records === 1 ? 'record' : 'records'}
          </span>
          <Link
            href="/ask"
            className="inline-flex items-center gap-1 font-medium hover:text-foreground"
          >
            Open Ask
            <ArrowRight className="size-3" aria-hidden="true" />
          </Link>
        </p>
      </div>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">Ask</span>{' '}
      {vehicle ? `about the ${vehicle.displayName}` : 'from your records'}
      <span aria-hidden="true"> · Enter</span>
    </p>
  );
}

/** A vehicle's badge, or its kind, in a small tile. */
export function VehicleMark({ vehicle, small = false }: { vehicle: Vehicle; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden bg-card text-muted-foreground',
        small ? 'size-5 rounded-full' : 'size-9 rounded-xl',
      )}
    >
      {vehicle.make ? (
        <BrandLogo
          make={vehicle.make}
          size={small ? 20 : 36}
          fill
          className={cn(
            'text-foreground',
            small ? 'rounded-full text-[0.5rem]' : 'rounded-xl text-sm',
          )}
        />
      ) : (
        <Icon name={typeIcon(vehicle.vehicleType)} size={small ? 12 : 18} />
      )}
    </span>
  );
}
