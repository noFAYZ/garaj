'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface StoryStep {
  question: string;
  figure: string;
  caption: string;
  tone?: 'over' | 'good';
  url: string;
  /** What on the screen answers the question, in percent of the screen: the spotlight's window. */
  focus: { x: number; y: number; w: number; h: number; label: string };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A browser window, its address bar following the story. */
function Frame({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="rounded-3xl bg-card p-2 shadow-float">
      <div className="flex items-center gap-3 px-3 pb-2.5 pt-1.5" aria-hidden="true">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
        </span>
        <span
          key={url}
          className="mx-auto animate-rise truncate rounded-full bg-muted px-4 py-1 font-mono text-xs text-muted-foreground"
        >
          {url}
        </span>
        <span className="w-10" />
      </div>
      <div className="relative aspect-[2240/1520] overflow-hidden rounded-2xl bg-background">
        {children}
      </div>
    </div>
  );
}

/** The lit window over the screenshot, and the label pinned to its edge. */
function Spotlight({ focus }: { focus: StoryStep['focus'] }) {
  return (
    <div
      aria-hidden="true"
      className="spotlight"
      style={{
        left: `${focus.x}%`,
        top: `${focus.y}%`,
        width: `${focus.w}%`,
        height: `${focus.h}%`,
      }}
    >
      <span
        key={focus.label}
        className="absolute left-3 top-0 -translate-y-1/2 animate-pop whitespace-nowrap rounded-full bg-primary px-2.5 py-1 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-primary-foreground"
      >
        {focus.label}
      </span>
    </div>
  );
}

/**
 * Three questions, one window. The screenshot, its address and the spotlight follow whichever
 * question sits in the middle of the viewport: the spotlight glides to the part of the screen that
 * answers it, the rest of the screen dims, and the other questions fade back so the eye has one
 * place to be. A rail beside the questions fills as you read down them.
 *
 * On a phone there is no room for a window beside the text, so each question carries its own
 * screenshot instead. Without JavaScript the first slide simply stays — every question and its
 * figure are in the markup either way.
 */
export function Story({ steps, slides }: { steps: StoryStep[]; slides: ReactNode[] }) {
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      // A thin band across the middle of the screen: the step crossing it is the one on stage.
      { rootMargin: '-48% 0px -48% 0px' },
    );
    items.current.forEach((item) => item && observer.observe(item));
    return () => observer.disconnect();
  }, []);

  const step = steps[active]!;

  return (
    <div className="grid grid-cols-1 gap-x-16 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
      <ol className="steps relative flex flex-col lg:pl-10">
        {/* The rail, and its fill. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-[12vh] left-[7px] hidden w-0.5 overflow-hidden rounded-full bg-border lg:block"
        >
          <span className="rail-fill block size-full bg-foreground" />
        </span>

        {steps.map((item, i) => (
          <li
            key={item.question}
            ref={(element) => {
              items.current[i] = element;
            }}
            data-step={i}
            className="flex flex-col justify-center py-12 lg:min-h-[72vh] lg:py-0"
          >
            <div
              className={cn(
                'relative flex flex-col gap-4 transition-opacity duration-500',
                active === i ? 'lg:opacity-100' : 'lg:opacity-30',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'absolute -left-10 top-0.5 hidden size-4 rounded-full ring-4 ring-background transition-[background-color,scale] duration-500 lg:block',
                  active === i ? 'scale-110 bg-foreground' : 'bg-border-strong',
                )}
              />
              <p className="font-mono text-xs tracking-[0.18em] text-muted-foreground">
                <span className="text-foreground">{pad(i + 1)}</span> / {pad(steps.length)}
              </p>
              <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-5xl">
                {item.question}
              </h2>
              <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className={cn(
                    'font-mono text-4xl font-semibold tabular-nums tracking-tight',
                    item.tone === 'over' && 'text-destructive',
                    item.tone === 'good' && 'text-success',
                  )}
                >
                  {item.figure}
                </span>
                <span className="text-sm text-muted-foreground">{item.caption}</span>
              </p>
            </div>
            <div className="mt-8 lg:hidden">
              <Frame url={item.url}>
                {slides[i]}
                <Spotlight focus={item.focus} />
              </Frame>
            </div>
          </li>
        ))}
      </ol>

      <div className="hidden lg:block">
        <div className="sticky top-[calc(50vh-17rem)]">
          <Frame url={step.url}>
            {slides.map((slide, i) => (
              <div
                key={i}
                aria-hidden={i !== active}
                className={cn(
                  'story-slide absolute inset-0',
                  i === active
                    ? 'opacity-100'
                    : 'pointer-events-none translate-y-3 opacity-0 blur-sm',
                )}
              >
                {slide}
              </div>
            ))}
            <Spotlight focus={step.focus} />
          </Frame>
          {/* Where you are in the story, as the stepper shows it in the app. */}
          <div className="mt-5 flex items-center justify-center gap-2" aria-hidden="true">
            {steps.map((item, i) => (
              <span
                key={item.question}
                className={cn(
                  'h-1 rounded-full transition-all duration-500',
                  i === active ? 'w-10 bg-foreground' : 'w-4 bg-border-strong',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
