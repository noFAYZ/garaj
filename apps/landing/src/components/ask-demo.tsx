'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface Exchange {
  /** The chip that replays it. */
  chip: string;
  question: string;
  answer: string;
  /** A change Garaj would make — shown for the person to approve, never made by itself. */
  proposal?: { title: string; fields: [label: string, value: string][]; action: string };
  /** Named as the console names them (`SOURCES` in the web app's ask-console). */
  sources: string[];
}

/** Every answer is read from the demo garage the screenshots above show. */
const EXCHANGES: Exchange[] = [
  {
    chip: 'What’s due?',
    question: 'What’s due on the Daily Driver, and what has it cost this year?',
    answer:
      'The brake fluid change is overdue by 3 months. Next, rotate the tyres — due in 490 km — ' +
      'and the engine oil and filter in 7 months. Over the last 12 months it has cost $1,041: ' +
      '$673 on services and $368 on fuel.',
    sources: ['Due list', 'Costs'],
  },
  {
    chip: 'Which needs me first?',
    question: 'Which of my vehicles needs me first?',
    answer:
      'The Daily Driver: its brake fluid change is 3 months overdue. Then the Project Vehicle’s ' +
      'oil and filter, 2 months over. And the Weekend Bike may be under a recall for its exterior ' +
      'lighting.',
    sources: ['Due list', 'Vehicles'],
  },
  {
    chip: 'Is the MX-5 worth more?',
    question: 'Is the Project Vehicle worth more than I paid for it?',
    answer:
      'Yes — $3,300 more. You paid $4,200, and the appraisal on 1 August 2026 valued it at ' +
      '$7,500: up 78.6%.',
    sources: ['Profile'],
  },
  {
    chip: 'Log a fill-up',
    question: 'Filled up the Daily Driver at BP, $59.80, odometer 92,310',
    answer: 'Here it is, ready for the Daily Driver’s logbook:',
    proposal: {
      title: 'Daily Driver · Fuel',
      fields: [
        ['Cost', '$59.80'],
        ['Where', 'BP'],
        ['Odometer', '92,310 km'],
      ],
      action: 'Add entry',
    },
    sources: ['Vehicles'],
  },
];

type Phase = 'idle' | 'asking' | 'thinking' | 'answering' | 'done';

const said = (exchange: Exchange) =>
  `Question: ${exchange.question} Answer: ${exchange.answer}` +
  (exchange.proposal
    ? ` ${exchange.proposal.title}: ${exchange.proposal.fields.map((f) => f.join(' ')).join(', ')}. Nothing is added until you approve it.`
    : '');

/**
 * Ask Garaj, replayed: the question types itself, the answer arrives a word at a time, and a
 * line that records something comes back as a proposal to approve — as the real console does.
 *
 * The server renders the first exchange finished, so it reads without JavaScript and to a crawler.
 * On the client it rewinds and plays once when it first scrolls into view; the chips replay any
 * of the others. For anyone who asked for less motion, every exchange simply appears finished.
 */
export function AskDemo() {
  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<Phase>('done');
  const [typed, setTyped] = useState(Infinity);
  const [words, setWords] = useState(Infinity);
  const ref = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const moving = useRef(false);
  const started = useRef(false);

  const play = useCallback((index: number) => {
    started.current = true;
    timers.current.forEach(window.clearTimeout);
    // Emptied in place: the unmount cleanup holds this same array.
    timers.current.length = 0;
    setCurrent(index);
    if (!moving.current) {
      setPhase('done');
      setTyped(Infinity);
      setWords(Infinity);
      return;
    }
    const { question, answer } = EXCHANGES[index]!;
    const at = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms));
    setPhase('asking');
    setTyped(0);
    setWords(0);
    for (let char = 1; char <= question.length; char++) at(200 + char * 24, () => setTyped(char));
    const asked = 200 + question.length * 24;
    at(asked + 250, () => setPhase('thinking'));
    at(asked + 1250, () => setPhase('answering'));
    const total = answer.split(' ').length;
    for (let word = 1; word <= total; word++) at(asked + 1250 + word * 40, () => setWords(word));
    at(asked + 1350 + total * 40, () => setPhase('done'));
  }, []);

  useEffect(() => {
    const reduce =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.hasAttribute('data-reduce-motion');
    moving.current = !reduce;
    const node = ref.current;
    const pending = timers.current;
    if (reduce || !node) return;

    setPhase('idle');
    setTyped(0);
    setWords(0);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        if (!started.current) play(0);
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      pending.forEach(window.clearTimeout);
    };
  }, [play]);

  const exchange = EXCHANGES[current]!;
  const showAnswer = phase === 'answering' || phase === 'done';

  return (
    <div ref={ref} className="flex flex-col gap-3">
      {/* The whole exchange is announced once, finished — not a word at a time. */}
      <p className="sr-only" aria-live="polite">
        {said(exchange)}
      </p>

      <div role="group" aria-label="Example questions" className="flex flex-wrap gap-1.5">
        {EXCHANGES.map((item, i) => (
          <button
            key={item.chip}
            type="button"
            aria-pressed={i === current}
            onClick={() => play(i)}
            className={cn(
              'h-8 rounded-full px-3 text-xs font-semibold transition-colors duration-200',
              i === current
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-border hover:text-foreground',
            )}
          >
            {item.chip}
          </button>
        ))}
      </div>

      <div aria-hidden="true" className="flex items-center gap-2 rounded-xl bg-muted/60 p-1.5 pl-4">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {exchange.question.slice(0, typed)}
          {phase === 'asking' || phase === 'idle' ? (
            <span className="landing-caret ml-px inline-block h-4 w-px translate-y-0.5 bg-foreground" />
          ) : null}
        </span>
        <span className="grid h-9 shrink-0 place-items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground">
          Ask
        </span>
      </div>

      <div aria-hidden="true" className="min-h-52 rounded-xl bg-muted/60 p-4">
        {phase === 'thinking' ? (
          <div className="flex flex-col gap-2 pt-1">
            <span className="text-shimmer text-xs font-semibold">Reading the garage…</span>
            <Skeleton className="mt-1 h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ) : showAnswer ? (
          <>
            <p className="text-sm leading-relaxed text-foreground">
              {exchange.answer.split(' ').slice(0, words).join(' ')}
            </p>
            {exchange.proposal && phase === 'done' ? (
              <div className="mt-3 animate-pop rounded-xl bg-card p-3">
                <p className="text-label uppercase text-muted-foreground">Add to the logbook</p>
                <p className="mt-1 text-sm font-semibold">{exchange.proposal.title}</p>
                <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border/60">
                  {exchange.proposal.fields.map(([label, value]) => (
                    <div key={label} className="bg-muted px-2.5 py-2">
                      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="mt-0.5 truncate font-mono text-xs font-semibold tabular-nums">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 flex gap-2">
                  <span className="key grid h-8 place-items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground">
                    {exchange.proposal.action}
                  </span>
                  <span className="grid h-8 place-items-center rounded-lg px-3 text-xs font-semibold text-muted-foreground">
                    Change
                  </span>
                </div>
              </div>
            ) : null}
            <div
              className={cn(
                'mt-4 flex flex-wrap items-center gap-2 transition-opacity duration-500',
                phase === 'done' ? 'opacity-100' : 'opacity-0',
              )}
            >
              <span className="text-label uppercase text-muted-foreground">Read from</span>
              {exchange.sources.map((source) => (
                <span
                  key={source}
                  className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-semibold"
                >
                  <span className="size-1.5 rounded-full bg-muted-foreground" />
                  {source}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
