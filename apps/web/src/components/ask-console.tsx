'use client';

import { useQuery } from '@tanstack/react-query';
import { vehicleQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import type { AiAnswer, AiAttachment, AiProposal, Vehicle } from '@vehicle-os/contracts';
import { ArrowUp, ArrowUpRight, Check, Copy, Eraser, Paperclip, Settings2, X } from 'lucide-react';
import { AnimatePresence, motion, type TargetAndTransition } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react';
import { BrandLogo } from '@/components/brand-logo';
import { FileTile } from '@/components/ai-form';
import { ProposalCard, type ProposalStatus, type Settled } from '@/components/ai-proposal';
import { AiSettingsDialog, useAiModels } from '@/components/ai-settings';
import { Icon, type IconName } from '@/components/icons';
import { buttonClass } from '@/components/ui/button-class';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { findVehicle, readIntent } from '@/lib/add-intent';
import { toBlocks, tokenize, type NamedVehicle } from '@/lib/answer-format';
import { toAttachment } from '@/lib/ai-files';
import { proposalFromLine } from '@/lib/line-proposal';
import { ATTACH_TYPES, attachable } from '@/lib/save-entry';
import { abilitiesOf, AI_NAME, useAiSettings } from '@/lib/settings/ai';
import { formatDate, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import logoMark from '@/public/Logo.png';

export const ASK_EXAMPLES = [
  'What has my car cost me so far?',
  'What needs doing soon?',
  'When was the last service, and at what mileage?',
  'How much fuel am I using?',
];

const NAME = AI_NAME;
/*
 * Quick and nearly critically damped: the surface arrives in about a quarter second and settles
 * without a visible wobble. `visualDuration` times the arrival, not the spring's long tail.
 */
const MORPH = { type: 'spring', bounce: 0.06, visualDuration: 0.26 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** What each tool read, in the words the rest of the app uses for it. */
const SOURCES: Record<string, { label: string; icon: IconName }> = {
  list_vehicles: { label: 'Vehicles', icon: 'car' },
  get_vehicle_profile: { label: 'Profile', icon: 'registration' },
  get_vehicle_costs: { label: 'Costs', icon: 'money' },
  get_vehicle_timeline: { label: 'History', icon: 'timeline' },
  get_attention_required: { label: 'Due list', icon: 'dueSoon' },
};

/** What an empty console offers, one of each kind of work; every line works exactly as typed. */
const SUGGESTIONS: readonly {
  kind: 'ask' | 'log' | 'plan' | 'vehicle';
  icon: IconName;
  line: string;
}[] = [
  { kind: 'ask', icon: 'dueSoon', line: 'What needs doing soon?' },
  { kind: 'log', icon: 'fuel', line: 'Filled up 40 L, $62.40' },
  { kind: 'vehicle', icon: 'car', line: 'I bought a 2024 Honda Civic' },
  { kind: 'plan', icon: 'calendar', line: 'Rotate tyres every 10,000 km' },
];

/** The setting that allows each kind of work. */
const ABILITY = { ask: 'canAsk', log: 'canLog', plan: 'canPlan', vehicle: 'canManage' } as const;

/** What a line asks for, guessed as it is typed, so the chip can say what Enter will do. */
function guessMode(line: string, owned: readonly Vehicle[]) {
  const said = line.trim();
  if (!said) return null;
  if (/\b(delete|remove|archive|sold|scrapped|get rid of)\b/i.test(said)) {
    return { label: 'Delete', icon: 'trash', ability: 'canDelete' } as const;
  }
  if (/^(rename|change|update|edit|correct|fix|set|move)\b/i.test(said)) {
    return { label: 'Edit', icon: 'edit', ability: 'canManage' } as const;
  }
  if (
    /\b(bought|purchased|got|picked up|new)\b.*\b(car|vehicle|bike|motorcycle|scooter|truck|van|suv)\b/i.test(
      said,
    ) ||
    /\b(new|add|create)\b.*\bgarage\b/i.test(said)
  ) {
    return { label: 'Add', icon: 'add', ability: 'canManage' } as const;
  }
  const intent = readIntent(said, owned);
  if (intent.kind === 'ask') return { label: 'Ask', icon: 'search', ability: 'canAsk' } as const;
  if (intent.kind === 'log' && intent.planned) {
    return { label: 'Plan', icon: 'calendar', ability: 'canPlan' } as const;
  }
  return { label: 'Log', icon: 'edit', ability: 'canLog' } as const;
}

/** One thing said in the console: a question and its answer, a change to approve, or a refusal. */
type Entry =
  | {
      readonly type: 'ask';
      readonly id: number;
      /** What was typed. */
      readonly line: string;
      readonly files: readonly File[];
      readonly started: number;
      readonly ms?: number;
      readonly answer?: AiAnswer;
      readonly error?: string;
      /** Rises in as it lands; drawn still once the console has been closed on it. */
      readonly fresh: boolean;
      /** The option tapped, when the answer was a question back. */
      readonly chosen?: string;
    }
  | {
      readonly type: 'proposal';
      readonly id: number;
      readonly line: string;
      readonly files: readonly File[];
      readonly proposal: AiProposal;
      readonly status: ProposalStatus;
      readonly outcome?: string;
      readonly href?: string;
      /** Said above the card, e.g. that it was read without the model. */
      readonly note?: string;
    }
  | {
      readonly type: 'notice';
      readonly id: number;
      readonly line: string;
      readonly files: readonly File[];
      readonly text: string;
    };

type KnownVehicle = NamedVehicle & { make: string | null };

/**
 * GarajAI: a pill at the foot of every page that morphs into a console for questions and entries.
 *
 * One surface throughout: the pill *is* the console folded up, and its ink key
 * travels to become the send button, so opening reads as one thing growing rather than a
 * second thing appearing. Non-modal on purpose — the figures being asked about stay readable
 * beside it. The transcript lives here, not in the panel, so closing keeps it, and an answer
 * that lands while closed shows on the pill instead of vanishing.
 */
export function AskConsole() {
  const settings = useAiSettings();
  const models = useAiModels();
  const pathname = usePathname();
  // On a vehicle's pages the question is about that vehicle unless it names another.
  const pageVehicleId = settings.followPage
    ? /^\/vehicles\/([0-9a-f-]{36})/i.exec(pathname)?.[1]
    : undefined;
  const vehicle = useQuery(
    vehicleQuery(api, pageVehicleId ?? '', { enabled: Boolean(pageVehicleId) }),
  );
  const focus = pageVehicleId ? vehicle.data : undefined;
  // Sent only while the operator still offers it; otherwise the default answers.
  const model =
    settings.model && models.data?.choices.includes(settings.model) ? settings.model : undefined;

  // The person's vehicles: to read which one a line names, and to draw the ones an answer names.
  const list = useQuery(vehiclesQuery(api));
  const owned = useMemo(() => list.data?.data ?? [], [list.data]);
  const vehicles = useMemo<KnownVehicle[]>(
    () =>
      owned.map((item) => ({
        id: item.id,
        make: item.make,
        names: [
          item.displayName,
          item.nickname,
          [item.make, item.model].filter(Boolean).join(' '),
        ].filter((name): name is string => Boolean(name)),
      })),
    [owned],
  );

  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [seen, setSeen] = useState(0);
  const nextId = useRef(0);
  const returnFocus = useRef(false);

  // Only a question waits on anything; an entry to approve or a refusal is settled as it appears.
  const waiting = (entry: Entry) => entry.type === 'ask' && !entry.answer && !entry.error;
  const settled = entries.filter((entry) => !waiting(entry)).length;
  const pending = entries.some(waiting);
  const unread = !open && settled > seen;

  const show = () => {
    setSeen(settled);
    setOpen(true);
  };
  const hide = () => {
    returnFocus.current = Boolean(document.activeElement?.closest('[data-ask-console]'));
    setEntries((items) =>
      items.map((entry) =>
        entry.type === 'ask' && entry.fresh ? { ...entry, fresh: false } : entry,
      ),
    );
    setSeen(settled);
    setOpen(false);
  };

  /*
   * One line, and whatever is attached to it. With GarajAI on, the model reads it and either
   * answers or proposes a change; the local reading is the fallback when the model cannot be
   * reached, so a fill-up still becomes a card. What the settings do not allow is said, not
   * silently dropped.
   */
  const submit = (line: string, files: readonly File[]) => {
    const intent = readIntent(line, owned);
    const id = nextId.current++;
    const refuse = (text: string) =>
      setEntries((items) => [...items, { type: 'notice', id, line, files, text }]);
    const allow = abilitiesOf(settings);

    if (!settings.canAsk && allow.length === 0) {
      return refuse(`Everything is switched off in ${NAME} settings.`);
    }
    if (intent.kind === 'ask' && !settings.canAsk && files.length === 0) {
      return refuse(`Answering questions is off in ${NAME} settings.`);
    }

    // The vehicle the line names, else the one in view, else the only one; otherwise the card asks.
    const named = findVehicle(line, owned).vehicle;
    const only = owned.length === 1 ? owned[0] : undefined;
    const local = () => {
      if (intent.kind !== 'log') return null;
      if (intent.planned ? !settings.canPlan : !settings.canLog) return null;
      return proposalFromLine(
        intent.line,
        intent.planned,
        named?.id ?? focus?.id ?? only?.id ?? null,
      );
    };

    const started = Date.now();
    setEntries((items) => [...items, { type: 'ask', id, line, files, started, fresh: false }]);
    const settle = (result: { answer?: AiAnswer; error?: string }) =>
      setEntries((items) =>
        items.map((entry) => {
          if (entry.id !== id || entry.type !== 'ask') return entry;
          // A proposal turns the pending line into the card that makes the change.
          if (result.answer?.proposal) {
            return {
              type: 'proposal',
              id,
              line,
              files,
              proposal: result.answer.proposal,
              status: 'open',
            };
          }
          // The model out of reach: read the line here, and say so over the card.
          const fallback = result.error ? local() : null;
          if (fallback) {
            return {
              type: 'proposal',
              id,
              line,
              files,
              proposal: fallback,
              status: 'open',
              note: `${NAME} couldn’t be reached, so this was read on your device.`,
            };
          }
          return { ...entry, ...result, ms: Date.now() - started, fresh: true };
        }),
      );

    void (async () => {
      try {
        const attachments = (await Promise.all(files.map(toAttachment))).filter(
          (file): file is AiAttachment => file !== null,
        );
        settle({
          answer: await api.ai.ask({
            // A line with only files says what to do with them.
            question: line || 'Read the attached files and propose what to record.',
            ...(pageVehicleId ? { vehicleId: pageVehicleId } : {}),
            ...(model ? { model } : {}),
            allow,
            ...(attachments.length > 0 ? { attachments } : {}),
          }),
        });
      } catch (error) {
        settle({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  };

  /*
   * A tapped answer to a question back: marked on that line, then the original line goes again
   * with the choice said after it, so the model reads both as one request.
   */
  const choose = (id: number, question: string, label: string) => {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry || entry.type !== 'ask') return;
    setEntries((items) =>
      items.map((item) =>
        item.id === id && item.type === 'ask' ? { ...item, chosen: label } : item,
      ),
    );
    submit(`${entry.line} (${question} ${label})`, entry.files);
  };

  const settleProposal = (id: number, status: Exclude<ProposalStatus, 'open'>, settled?: Settled) =>
    setEntries((items) =>
      items.map((entry) =>
        entry.id === id && entry.type === 'proposal' ? { ...entry, status, ...settled } : entry,
      ),
    );

  // Ctrl/⌘ J, the key that toggles an editor's terminal panel. Unadvertised; the pill is the way in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!settings.shortcut) return;
      if (event.key.toLowerCase() !== 'j' || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      // A modal owns the page; the console would open underneath it, out of reach.
      if (document.querySelector('dialog:modal')) return;
      event.preventDefault();
      if (open) hide();
      else show();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    // By attribute, not a ref: popLayout hands its children its own ref in place of ours.
    document.querySelector<HTMLElement>('[data-ask-pill]')?.focus({ preventScroll: true });
  }, [open]);

  return (
    <>
      {/* A centring rail that lets clicks through; only the pill and the panel take them. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 pb-2 sm:pb-6 print:hidden">
        <AnimatePresence initial={false} mode="popLayout">
          {open ? (
            <Panel
              key="panel"
              entries={entries}
              pending={pending}
              focus={focus}
              vehicles={vehicles}
              owned={owned}
              onSubmit={submit}
              onSettleProposal={settleProposal}
              onChoose={choose}
              onClear={() => {
                setEntries([]);
                setSeen(0);
              }}
              onOpenSettings={() => setSettingsOpen(true)}
              onClose={hide}
            />
          ) : (
            <motion.button
              key="pill"
              data-ask-pill=""
              layoutId="ask-console"
              transition={MORPH}
              type="button"
              onClick={show}
              aria-expanded={false}
              aria-keyshortcuts="Control+J Meta+J"
              aria-label={
                pending ? `${NAME}, checking your records` : unread ? `${NAME}, answer ready` : NAME
              }
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              style={{ borderRadius: 24 }}
              className="pointer-events-auto mb-2 flex h-12 items-center gap-2.5 bg-popover pl-3.5 pr-5 text-sm font-semibold text-foreground shadow-float sm:mb-0"
            >
              <GarajMark state={pending ? 'busy' : unread ? 'done' : 'idle'} className="w-10" />
              {NAME}
              {unread ? (
                <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground" />
              ) : null}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      {/* Outside the rail: a dialog there would inherit its `pointer-events: none`. */}
      {settingsOpen ? <AiSettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
    </>
  );
}

function Panel({
  ref,
  entries,
  pending,
  focus,
  vehicles,
  owned,
  onSubmit,
  onSettleProposal,
  onChoose,
  onClear,
  onOpenSettings,
  onClose,
}: {
  /** From `AnimatePresence mode="popLayout"`, which measures the panel to lift it out on exit. */
  ref?: Ref<HTMLElement>;
  entries: readonly Entry[];
  pending: boolean;
  focus?: { displayName: string; make: string | null };
  vehicles: readonly KnownVehicle[];
  owned: readonly Vehicle[];
  onSubmit: (line: string, files: readonly File[]) => void;
  onChoose: (id: number, question: string, label: string) => void;
  onSettleProposal: (
    id: number,
    status: Exclude<ProposalStatus, 'open'>,
    settled?: Settled,
  ) => void;
  onClear: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // How far back through earlier lines ↑ has gone; -1 is the line being typed.
  const cursor = useRef(-1);
  const history = entries.map((entry) => entry.line);

  // Files for the next line: picked, pasted or dropped. Four at most, as the model takes them.
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const attach = (incoming: Iterable<File>) =>
    setFiles((current) => [...current, ...Array.from(incoming).filter(attachable)].slice(0, 4));

  const canSend = (draft.trim().length >= 3 || files.length > 0) && !pending;
  const settings = useAiSettings();
  // What it may do, less what was already said: a hint repeating the last line reads as unsent.
  const suggestions = SUGGESTIONS.filter(
    (suggestion) => settings[ABILITY[suggestion.kind]] && !history.includes(suggestion.line),
  );

  // The suggestion the empty input shows, turning over every few seconds.
  const [turn, setTurn] = useState(0);
  const hint = suggestions.length > 0 ? suggestions[turn % suggestions.length] : undefined;
  useEffect(() => {
    if (draft || suggestions.length < 2) return;
    const timer = setInterval(() => setTurn((value) => value + 1), 3200);
    return () => clearInterval(timer);
  }, [draft, suggestions.length]);

  const guess = guessMode(draft, owned);
  const mode = guess ? { ...guess, allowed: settings[guess.ability] } : null;

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const send = (value: string) => {
    const question = value.trim();
    input.current?.focus({ preventScroll: true });
    // A terminal habit worth honouring; nobody asks their records the single word "clear".
    if (question.toLowerCase() === 'clear') {
      onClear();
      setDraft('');
      return;
    }
    if ((question.length < 3 && files.length === 0) || pending) return;
    setDraft('');
    setFiles([]);
    cursor.current = -1;
    onSubmit(question, files);
  };

  return (
    <motion.section
      ref={ref}
      layoutId="ask-console"
      transition={MORPH}
      role="dialog"
      aria-label={NAME}
      data-ask-console=""
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // An open list in an entry card takes Escape first; the console closes on the next one.
        if (event.currentTarget.querySelector(':popover-open')) return;
        event.stopPropagation();
        onClose();
      }}
      // Files dropped anywhere on the console attach to the next line.
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        setDragging(false);
        attach(event.dataTransfer.files);
        input.current?.focus({ preventScroll: true });
      }}
      style={{ borderRadius: 24 }}
      className="pointer-events-auto relative flex h-[min(36rem,calc(100dvh-5rem))] w-full flex-col overflow-hidden bg-popover shadow-float sm:w-[36rem]"
    >
      {dragging ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-[20px] border-2 border-dashed border-border-strong bg-popover/90"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Paperclip className="size-4" />
            Drop to attach
          </span>
        </div>
      ) : null}
      {/* Held back until the surface has mostly grown, so nothing is seen squashed mid-morph. */}
      <motion.div
        className="flex min-h-0 flex-1 flex-col"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.07, duration: 0.16, ease: EASE_OUT } }}
        exit={{ opacity: 0, transition: { duration: 0.05 } }}
      >
        {/* One line: the mark, the name and its state as a dot. The vehicle in view is the input's to say. */}
        <header className="relative flex h-12 shrink-0 items-center gap-2.5 border-b border-border/60 pl-4 pr-1.5">
          <GarajMark state={pending ? 'busy' : 'idle'} className="w-9" />
          <h2 className="shrink-0 text-sm font-semibold text-foreground">{NAME}</h2>
          <span
            title={pending ? 'Reading your records' : 'Ready'}
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              pending ? 'animate-pulse bg-foreground' : 'bg-success',
            )}
          >
            <span className="sr-only">{pending ? 'Reading your records' : 'Ready'}</span>
          </span>
          <div className="ml-auto flex shrink-0 items-center">
            {entries.length > 0 ? (
              <button
                type="button"
                onClick={onClear}
                aria-label="Clear the conversation"
                title="Clear"
                className={buttonClass('ghost', 'icon-sm')}
              >
                <Eraser className="size-4" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label={`${NAME} settings`}
              title="Settings"
              className={buttonClass('ghost', 'icon-sm')}
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${NAME}`}
              title="Close"
              className={buttonClass('ghost', 'icon-sm')}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Column-reverse keeps the scroll pinned to the newest line as answers grow, with no script. */}
        <div className="scrollbar-slim flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-4">
          <div
            className={cn(
              'flex min-h-full flex-col gap-7 py-5',
              entries.length === 0 ? 'justify-center' : 'justify-end',
            )}
          >
            {entries.length === 0 ? (
              <div className="flex flex-col items-center gap-5 text-center">
                {/* The mark drives in, once per empty opening, and pulls up. */}
                <motion.div
                  initial={{ x: -40, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ type: 'spring', bounce: 0.35, visualDuration: 0.55 }}
                >
                  <GarajMark className="w-28" />
                </motion.div>
                <div>
                  <p className="text-lg font-semibold tracking-tight text-foreground">
                    {suggestions.length > 0 ? 'Ask, or log what you did' : 'Everything is off'}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {suggestions.length > 0
                      ? `From ${focus ? `the ${focus.displayName}’s` : 'your own'} records. Nothing is saved until you approve.`
                      : `Turn something on in ${NAME} settings.`}
                  </p>
                </div>
                {/* Each one works as typed, so a press is also a lesson in what can be said. */}
                <div className="grid w-full gap-2 text-left sm:grid-cols-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.line}
                      type="button"
                      onClick={() => send(suggestion.line)}
                      className="group flex items-center gap-3 rounded-xl bg-muted/60 p-2.5 text-left transition-colors hover:bg-muted"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-popover">
                        <Icon name={suggestion.icon} size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-label uppercase text-muted-foreground">
                          {suggestion.kind}
                        </span>
                        <span className="line-clamp-2 text-balance text-sm leading-snug text-foreground">
                          {suggestion.line}
                        </span>
                      </span>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div role="log" aria-label="Answers" className="flex flex-col gap-7 empty:hidden">
              {entries.map((entry) => (
                <Line
                  key={entry.id}
                  entry={entry}
                  vehicles={vehicles}
                  owned={owned}
                  onRetry={() => send(entry.line)}
                  onChoose={(question, label) => onChoose(entry.id, question, label)}
                  onSettleProposal={(status, settled) =>
                    onSettleProposal(entry.id, status, settled)
                  }
                  onOpenSettings={onOpenSettings}
                />
              ))}
            </div>
          </div>
        </div>

        {/* What goes with the next line: a picture's thumbnail, a paper's type. */}
        {files.length > 0 ? (
          <div className="scrollbar-slim mx-2 flex shrink-0 gap-2 overflow-x-auto px-1 pb-2 pt-1">
            {files.map((file, index) => (
              <FileTile
                key={`${file.name}-${index}`}
                file={file}
                className="size-14"
                onRemove={() => setFiles((current) => current.filter((_, at) => at !== index))}
              />
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
          className={cn(
            'mx-2 mb-2 flex shrink-0 items-center gap-2 rounded-2xl bg-muted py-1.5 pr-1.5 ring-ring transition-[padding,box-shadow] focus-within:ring-2',
            mode ? 'pl-1.5' : 'pl-4',
          )}
        >
          {/* What Enter will do with the line so far, read the way it will be read. */}
          <AnimatePresence initial={false} mode="popLayout">
            {mode ? (
              <motion.span
                key={mode.label}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.14, ease: EASE_OUT }}
                title={mode.allowed ? undefined : `Off in ${NAME} settings`}
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-popover pl-1.5 pr-2.5 text-xs font-semibold',
                  mode.allowed ? 'text-foreground' : 'text-muted-foreground line-through',
                )}
              >
                <Icon name={mode.icon} size={14} />
                {mode.label}
              </motion.span>
            ) : null}
          </AnimatePresence>
          <div className="relative min-w-0 flex-1">
            <input
              ref={input}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                cursor.current = -1;
              }}
              onKeyDown={(event) => {
                // Tab on an empty line takes the suggestion showing, as a command bar does.
                if (event.key === 'Tab' && !event.shiftKey && !draft && hint) {
                  event.preventDefault();
                  setDraft(hint.line);
                  return;
                }
                // ↑ and ↓ walk back through earlier lines, as a shell does.
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                if (history.length === 0) return;
                event.preventDefault();
                const step = event.key === 'ArrowUp' ? 1 : -1;
                cursor.current = Math.max(-1, Math.min(history.length - 1, cursor.current + step));
                setDraft(history[history.length - 1 - cursor.current] ?? '');
              }}
              // A screenshot or a copied photo pasted here attaches, rather than vanishing.
              onPaste={(event) => {
                if (event.clipboardData.files.length === 0) return;
                event.preventDefault();
                attach(event.clipboardData.files);
              }}
              aria-label="Ask or log"
              aria-describedby="ai-input-hint"
              maxLength={500}
              autoComplete="off"
              // 16px on phones: anything smaller and iOS zooms the page on focus.
              className="h-9 w-full min-w-0 bg-transparent text-base text-foreground focus-visible:outline-none sm:text-sm"
            />
            <span id="ai-input-hint" className="sr-only">
              A question, or what you did. Tab takes the suggestion.
            </span>
            {!draft && files.length > 0 ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center truncate text-base text-muted-foreground sm:text-sm"
              >
                Say what these are, or just send
              </span>
            ) : null}
            {/* The placeholder, cycling through things that work as typed. */}
            {!draft && hint && files.length === 0 ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center overflow-hidden"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={hint.line}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3, ease: EASE_OUT }}
                    className="truncate text-base text-muted-foreground sm:text-sm"
                  >
                    {hint.line}
                  </motion.span>
                </AnimatePresence>
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={files.length >= 4}
            aria-label="Attach files"
            title="Attach a receipt, photo or paper"
            className={buttonClass('ghost', 'icon', 'shrink-0 rounded-full')}
          >
            <Paperclip className="size-4" aria-hidden="true" />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            accept={ATTACH_TYPES}
            hidden
            onChange={(event) => {
              attach(event.target.files ?? []);
              event.target.value = '';
            }}
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="key grid size-9 shrink-0 place-items-center rounded-full disabled:bg-border disabled:text-muted-foreground"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
        </form>
      </motion.div>
    </motion.section>
  );
}

/** One line and its reply: the line as the person's own bubble, the reply under GarajAI's mark. */
function Line({
  entry,
  vehicles,
  owned,
  onRetry,
  onChoose,
  onSettleProposal,
  onOpenSettings,
}: {
  entry: Entry;
  vehicles: readonly KnownVehicle[];
  owned: readonly Vehicle[];
  onRetry: () => void;
  onChoose: (question: string, label: string) => void;
  onSettleProposal: (status: Exclude<ProposalStatus, 'open'>, settled?: Settled) => void;
  onOpenSettings: () => void;
}) {
  const busy = entry.type === 'ask' && !entry.answer && !entry.error;
  return (
    <article className="group/answer flex flex-col gap-3">
      {/* The person's own line: its files over its words, both to the right. */}
      {entry.files.length > 0 ? (
        <div className="ml-auto flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {entry.files.map((file, index) => (
            <FileTile key={`${file.name}-${index}`} file={file} className="size-20" />
          ))}
        </div>
      ) : null}
      {entry.line ? (
        <p className="ml-auto max-w-[85%] break-words rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm text-foreground">
          {entry.line}
        </p>
      ) : null}
      <div className="flex gap-3">
        <span aria-hidden="true" className="mt-1 grid w-8 shrink-0 place-items-center">
          <GarajMark state={busy ? 'busy' : 'idle'} className="w-8" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
          {entry.type === 'notice' ? (
            <p className="text-sm text-muted-foreground">
              {entry.text}{' '}
              <button
                type="button"
                onClick={onOpenSettings}
                className="font-semibold text-foreground underline-offset-2 hover:underline"
              >
                Open settings
              </button>
            </p>
          ) : entry.type === 'proposal' ? (
            <>
              {entry.note ? <p className="text-xs text-muted-foreground">{entry.note}</p> : null}
              {/*
               * No sentence from the model over the card: free prose can name a different vehicle
               * than the one the checked id points at. The card says what it does, from the ids.
               */}
              <ProposalCard
                proposal={entry.proposal}
                files={entry.files}
                vehicles={owned}
                status={entry.status}
                outcome={entry.outcome}
                href={entry.href}
                onSettle={onSettleProposal}
              />
            </>
          ) : entry.answer ? (
            <Answer
              answer={entry.answer}
              ms={entry.ms ?? 0}
              at={entry.started + (entry.ms ?? 0)}
              fresh={entry.fresh}
              vehicles={vehicles}
              chosen={entry.chosen}
              onChoose={onChoose}
            />
          ) : entry.error ? (
            <div
              title={entry.error}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-destructive-soft px-3.5 py-2.5 text-sm"
            >
              <span className="font-semibold text-destructive">Couldn’t answer just now.</span>
              <button
                type="button"
                onClick={onRetry}
                className="font-semibold text-foreground underline-offset-2 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : (
            <Pending since={entry.started} />
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * A reply, laid out: the lead sentence in full ink, any later prose a step quieter, a breakdown
 * as a readings panel, then what it was read from and how long it took. A fresh reply rises in
 * block by block; the screen reader gets it at once, as the log announces the whole article.
 */
function Answer({
  answer,
  ms,
  at,
  fresh,
  vehicles,
  chosen,
  onChoose,
}: {
  answer: AiAnswer;
  ms: number;
  /** When it landed, epoch ms. */
  at: number;
  fresh: boolean;
  vehicles: readonly KnownVehicle[];
  chosen?: string;
  onChoose: (question: string, label: string) => void;
}) {
  const blocks = toBlocks(answer.answer);
  const sources = [...new Set(answer.sources.map((source) => source.tool))].map(
    (tool) =>
      SOURCES[tool] ?? { label: humanise(tool.replace(/^get_/, '')), icon: 'info' as IconName },
  );
  const rise = (index: number) =>
    fresh
      ? { className: 'animate-rise stagger', style: { '--i': index } as CSSProperties }
      : { className: '' };

  return (
    <>
      {blocks.map((block, index) =>
        block.kind === 'prose' ? (
          <p
            key={index}
            style={rise(index).style}
            className={cn(
              'text-sm leading-relaxed',
              index === 0 ? 'text-foreground' : 'text-muted-foreground',
              rise(index).className,
            )}
          >
            <Rich text={block.text} vehicles={vehicles} />
          </p>
        ) : (
          <ul
            key={index}
            style={rise(index).style}
            className={cn(
              'flex flex-col gap-px overflow-hidden rounded-xl bg-border/60',
              rise(index).className,
            )}
          >
            {block.items.map((item, row) => (
              <li
                key={row}
                className="flex items-baseline justify-between gap-4 bg-card px-3.5 py-2.5 text-sm"
              >
                {item.label ? (
                  <span className="min-w-0 text-muted-foreground">
                    <Rich text={item.label} vehicles={vehicles} />
                  </span>
                ) : null}
                <span className={cn('min-w-0 text-foreground', item.label && 'text-right')}>
                  <Rich text={item.value} vehicles={vehicles} />
                </span>
              </li>
            ))}
          </ul>
        ),
      )}

      {/* A question back: its answers as cards to tap, the person's own vehicles by their badge. */}
      {answer.choices ? (
        <div
          role="group"
          aria-label={answer.choices.question}
          style={rise(blocks.length).style}
          className={cn('grid gap-2 sm:grid-cols-2', rise(blocks.length).className)}
        >
          {answer.choices.options.map((option) => {
            const picked = chosen === option.label;
            const vehicle = vehicles.find((candidate) =>
              candidate.names.some((name) => name.toLowerCase() === option.label.toLowerCase()),
            );
            return (
              <button
                key={option.label}
                type="button"
                disabled={chosen !== undefined}
                aria-pressed={picked}
                onClick={() => onChoose(answer.choices!.question, option.label)}
                className={cn(
                  'group flex min-w-0 items-center gap-3 rounded-xl p-2.5 text-left transition-colors',
                  picked ? 'bg-primary-soft' : 'bg-muted/60 enabled:hover:bg-muted',
                  chosen !== undefined && !picked && 'opacity-50',
                )}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-popover">
                  {vehicle ? (
                    <BrandLogo make={vehicle.make} size={22} className="rounded" />
                  ) : (
                    <Icon
                      name={/garage/i.test(answer.choices!.question) ? 'garage' : 'timeline'}
                      size={18}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {option.label}
                  </span>
                  {option.detail ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.detail}
                    </span>
                  ) : null}
                </span>
                {picked ? (
                  <Check className="size-4 shrink-0 text-foreground" aria-hidden="true" />
                ) : (
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-enabled:group-hover:opacity-100"
                  />
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      {/*
       * The stamp, torn off like a receipt's foot: what was read, how long the reading took and
       * when it landed. Copy waits for a hover, so a settled transcript is figures, not buttons.
       */}
      <footer
        style={rise(blocks.length).style}
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-dashed border-border pt-2 text-xs text-muted-foreground',
          rise(blocks.length).className,
        )}
      >
        {sources.length > 0 ? <span className="sr-only">Read from</span> : null}
        {sources.map((source) => (
          <span key={source.label} className="inline-flex items-center gap-1">
            <Icon name={source.icon} size={14} />
            {source.label}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <span title={answer.model} className="inline-flex items-center gap-1">
            <Icon name="stopwatch" size={14} />
            <span className="font-mono tabular-nums">{(ms / 1000).toFixed(1)}s</span>
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(at).toISOString()} className="font-mono tabular-nums">
            {new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
          <CopyButton text={answer.answer} />
        </span>
      </footer>
    </>
  );
}

/**
 * Text with Garaj's own things drawn as themselves: a vehicle as its badge, linked to its page;
 * money and distances as figures; dates in the app's date format.
 */
function Rich({ text, vehicles }: { text: string; vehicles: readonly KnownVehicle[] }) {
  return tokenize(text, vehicles).map((token, index) => {
    switch (token.kind) {
      case 'text':
        return <Fragment key={index}>{token.text}</Fragment>;
      case 'figure':
        return (
          <span
            key={index}
            className="whitespace-nowrap font-mono text-[0.92em] font-semibold tabular-nums text-foreground"
          >
            {token.text}
          </span>
        );
      case 'date':
        return (
          <time
            key={index}
            dateTime={token.iso}
            className="whitespace-nowrap font-semibold text-foreground"
          >
            {/* Local midnight: a bare date parsed as UTC is the day before, west of Greenwich. */}
            {token.iso ? formatDate(`${token.iso}T00:00:00`) : token.text}
          </time>
        );
      case 'vehicle':
        return (
          <Link
            key={index}
            href={`/vehicles/${token.vehicleId}`}
            className="mx-px inline-flex items-baseline gap-1 whitespace-nowrap rounded-md bg-muted px-1.5 font-semibold text-foreground transition-colors hover:bg-border"
          >
            <BrandLogo
              make={vehicles.find((vehicle) => vehicle.id === token.vehicleId)?.make}
              size={14}
              className="self-center rounded-[3px]"
            />
            {token.text}
          </Link>
        );
    }
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        )
      }
      aria-label={copied ? 'Copied' : 'Copy answer'}
      title={copied ? 'Copied' : 'Copy'}
      className={buttonClass(
        'ghost',
        'icon-sm',
        // Shown on the answer's hover or its own focus; always on a touch screen, which has no hover.
        cn(
          '-my-1 size-7 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/answer:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100',
          copied && '[@media(hover:hover)]:opacity-100',
        ),
      )}
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

function Pending({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  // The shape of a reply, not a promise of its content: a lead line, a shorter one, then a stamp.
  return (
    <div className="flex flex-col gap-2.5">
      <p className="flex items-center gap-2 text-sm">
        <span className="text-shimmer font-medium">Reading your records</span>
        <span aria-hidden="true" className="font-mono text-xs tabular-nums text-muted-foreground">
          {((now - since) / 1000).toFixed(1)}s
        </span>
      </p>
      <Skeleton className="h-3 w-full rounded-full" />
      <Skeleton className="h-3 w-4/5 rounded-full" />
      <Skeleton className="h-3 w-2/5 rounded-full" />
    </div>
  );
}

/*
 * GarajAI's mark is Garaj's own: the tyre and its speed lines. At rest it sits still; working,
 * it bobs like a car on the road; with an answer waiting, it hops once. Reduced motion stills it
 * (MotionConfig, app-wide).
 */
const DRIVE: Record<'idle' | 'busy' | 'done', TargetAndTransition> = {
  idle: { x: 0, y: 0 },
  busy: {
    y: [0, -1.2, 0, -0.6, 0],
    x: [0, 0.6, 0, -0.4, 0],
    transition: { duration: 0.42, repeat: Infinity, ease: 'easeInOut' },
  },
  done: { y: [0, -3, 0], transition: { duration: 0.45, ease: 'easeOut' } },
};

function GarajMark({
  state = 'idle',
  className,
}: {
  state?: keyof typeof DRIVE;
  className?: string;
}) {
  return (
    <motion.span
      aria-hidden="true"
      animate={DRIVE[state]}
      className={cn('inline-flex shrink-0', className)}
    >
      {/*
       * Black tyre on transparent, which vanishes on the dark theme. Inverted there — and the hue
       * turned back round, so the speed lines stay the brand's red rather than going cyan.
       */}
      <Image src={logoMark} alt="" className="h-auto w-full dark:hue-rotate-180 dark:invert" />
    </motion.span>
  );
}
