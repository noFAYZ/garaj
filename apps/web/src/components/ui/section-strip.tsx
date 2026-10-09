'use client';

import { Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A page's strip of sections, under its header: a vehicle's Activity · Statistics · Documents, a
 * garage's Vehicles · Drivers. One look and one behaviour for every strip, so going from a garage
 * into one of its vehicles never changes how a section is chosen.
 *
 * The sections are links, not a `tablist`: each is an address (a route, or `?tab=`), so the back
 * button and a shared link land on it, and Tab reaches them like any other link — arrow keys that
 * loaded a page per press were the old strip's worst habit.
 *
 * It sticks under the app header so a long section never has to be scrolled back up to change it;
 * at rest it sits on the page, stuck it turns to glass with a shadow to lift it off what scrolls
 * beneath. At the end of the row, the shown section's one action.
 *
 * Laid out as: `<div ref={sentinelRef} className="-mb-6 h-0" />` (the negative margin cancels the
 * column's gap), then `STRIP_ROW` › `STRIP_SCROLLER` › `<nav className={stripClass(stuck)}>` of
 * links in `stripTabClass(active)` with a `StripPill` in the active one, then the action.
 */

/** The app header's height (`h-16`). The strip sticks directly beneath it. */
const HEADER_HEIGHT = 64;

/**
 * Whether the strip is stuck under the header, from a zero-height marker where it rests — an
 * observer rather than a scroll listener, so nothing runs per frame.
 *
 * A switch made from deep in a page (`markSwitch` on the click, while still stuck) brings the new
 * section to its top, directly under the strip, rather than leaving it scrolled to wherever the
 * last one was. A switch from the top moves nothing, which is why the links opt out of Next's
 * own scroll.
 */
export function useStrip(section: string) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const stuckAtClick = useRef(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(Boolean(entry && entry.boundingClientRect.top < HEADER_HEIGHT)),
      { rootMargin: `-${HEADER_HEIGHT}px 0px 0px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!stuckAtClick.current) return;
    stuckAtClick.current = false;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    window.scrollTo({
      top: sentinel.getBoundingClientRect().top + window.scrollY - HEADER_HEIGHT,
      behavior: 'instant',
    });
  }, [section]);

  return {
    sentinelRef,
    stuck,
    markSwitch: () => {
      stuckAtClick.current = stuck;
    },
  };
}

/** The sticky row: the strip, then the section's action pushed to the end. */
export const STRIP_ROW = 'sticky top-16 z-10 -mx-4 -my-2 flex items-center gap-2 pr-4';

/**
 * Padding, not margin, around the strip: the scroller clips, and the floating shadow needs room
 * inside it. On a phone it scrolls sideways.
 */
export const STRIP_SCROLLER =
  'scroll-fade-x min-w-0 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

export function stripClass(stuck: boolean) {
  return cn(
    'flex w-max gap-0.5 rounded-2xl p-1 transition-[background-color,box-shadow] duration-300',
    stuck ? 'bg-popover shadow-float backdrop-blur-xl' : 'bg-card',
  );
}

export function stripTabClass(active: boolean) {
  return cn(
    'relative isolate flex h-10 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-sm font-semibold transition-colors',
    active ? 'text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );
}

/** The selection: one soft pill that slides between sections, like the main navigation's. */
export function StripPill({ layoutId }: { layoutId: string }) {
  return (
    <motion.span
      layoutId={layoutId}
      className="absolute inset-0 -z-10 rounded-xl bg-primary-soft"
      transition={{ type: 'spring', bounce: 0.15, duration: 0.28 }}
      aria-hidden="true"
    />
  );
}

/** The action at the end of the strip: `buttonClass('primary', 'md', STRIP_ACTION)` — the tabs' own height. */
export const STRIP_ACTION = 'ml-auto shrink-0 gap-2 pl-2 pr-3.5 print:hidden max-sm:pr-2';

/** The action's plus, in a coin of the button's own ink that turns under the pointer. */
export function PlusCoin() {
  return (
    <span
      aria-hidden="true"
      className="grid size-5 place-items-center rounded-full bg-primary-foreground text-primary transition-transform duration-300 group-hover:rotate-90"
    >
      <Plus className="size-3" strokeWidth={3} />
    </span>
  );
}
