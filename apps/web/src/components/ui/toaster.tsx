'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useToastPosition, type ToastPosition } from '@/lib/settings/toast';
import { cn } from '@/lib/utils';
import { dismiss, EMPTY, hold, snapshot, subscribe, type Toast } from './toast-store';

export { raise } from './toast-store';

/** How much of each older toast shows behind the front one, and the gap once fanned out. */
const PEEK = 9;
const GAP = 8;

/*
 * Top positions sit under the 64px header; bottom ones above the GarajAI pill, which holds the
 * foot of the screen. `top-auto`/`bottom-auto` undo the UA popover's `inset: 0`.
 */
const PLACE: Record<ToastPosition, string> = {
  'top-center': 'top-20 bottom-auto items-center',
  'top-right': 'top-20 bottom-auto items-end',
  'bottom-left': 'top-auto bottom-20 sm:bottom-24 items-start',
  'bottom-center': 'top-auto bottom-20 sm:bottom-24 items-center',
  'bottom-right': 'top-auto bottom-20 sm:bottom-24 items-end',
};

/**
 * What just happened, for the moment after it happened.
 *
 * Every save already has a spinner while it runs, but nothing said it landed: the dialog closed,
 * the row changed, and whether that was the save or a coincidence was anybody's guess. This is the
 * receipt — and for a failure it is where the reason goes when the form that raised it has closed.
 *
 * A deck, not a column: the newest toast sits in front and older ones peek out behind it, so three
 * cost one toast's room. Pointing at it (or tabbing in) fans it out and stops the clock. Swipe one
 * sideways to throw it away.
 *
 * `role="status"` on the region, not per toast: it exists from first paint, so a toast added to it
 * is announced. A region that appears at the same moment as its content is often missed.
 *
 * A manual popover, so it lives in the top layer: most saves happen in a `showModal()` dialog,
 * which no z-index can beat. The top layer stacks by arrival, so every change re-shows the region
 * to put it above any dialog opened since. While a dialog is up the toast shows but is inert —
 * it dismisses on its own.
 */
export function Toaster() {
  const items = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const position = useToastPosition();
  const region = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const measure = useCallback(
    (id: number, height: number) =>
      setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height })),
    [],
  );

  useLayoutEffect(() => {
    const element = region.current;
    if (!element?.showPopover) return;
    if (element.matches(':popover-open')) element.hidePopover();
    element.showPopover();
  }, [items]);

  // The stack can empty under a resting pointer, which then never "leaves" it.
  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  const expanded = open && items.length > 0;
  useEffect(() => hold(expanded), [expanded]);

  const fromTop = position.startsWith('top');
  /** The direction the deck grows: away from the edge it is pinned to. */
  const away = fromTop ? 1 : -1;
  const side = position.endsWith('right') ? 1 : position.endsWith('left') ? -1 : 0;

  // Newest first: index 0 is the front of the deck.
  const deck = [...items].reverse();
  const front = heights[deck[0]?.id ?? -1] ?? 0;
  let reach = 0;
  const placed = deck.map((toast, index) => {
    const y = expanded ? reach + index * GAP : index * PEEK;
    reach += heights[toast.id] ?? 0;
    return { toast, index, y };
  });
  const height = deck.length
    ? expanded
      ? reach + (deck.length - 1) * GAP
      : front + (deck.length - 1) * PEEK
    : 0;

  return (
    <div
      ref={region}
      popover="manual"
      role="status"
      aria-live="polite"
      className={cn(
        // Undo the UA popover box, and the glass rule that frosts every `[popover]` and its backdrop.
        'pointer-events-none fixed inset-x-0 m-0 flex w-auto flex-col overflow-visible border-0 bg-transparent p-0 px-4 text-foreground shadow-none backdrop-filter-none backdrop:bg-transparent backdrop:backdrop-filter-none sm:px-6 print:hidden',
        PLACE[position],
      )}
    >
      <motion.ol
        // Glides the deck to its new corner when the setting changes, and only then.
        layout="position"
        layoutDependency={position}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
        style={{ height }}
        className={cn('relative w-[min(21rem,100%)]', deck.length > 0 && 'pointer-events-auto')}
      >
        <AnimatePresence initial={false}>
          {placed.map(({ toast, index, y }) => {
            const behind = !expanded && index > 0;
            return (
              <motion.li
                key={toast.id}
                initial={{ opacity: 0, y: away * -28, x: side * 20, scale: 0.9 }}
                animate={{
                  opacity: 1,
                  y: away * y,
                  x: 0,
                  scale: behind ? 1 - index * 0.05 : 1,
                  // Cards behind take the front one's height, so they peek by exactly PEEK.
                  height: behind && front ? front : 'auto',
                }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.16 } }}
                transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
                drag="x"
                dragSnapToOrigin
                dragElastic={0.5}
                onDragEnd={(_, info) => {
                  if (Math.abs(info.offset.x) > 80 || Math.abs(info.velocity.x) > 600) {
                    dismiss(toast.id);
                  }
                }}
                style={{ zIndex: deck.length - index }}
                className={cn(
                  'group absolute inset-x-0 cursor-grab touch-pan-y overflow-hidden rounded-2xl bg-popover ring-1 ring-border/70 active:cursor-grabbing',
                  // A lit top edge and a soft drop: the same machined plate as the primary key.
                  'shadow-[inset_0_1px_0_oklch(1_0_0/0.06),0_14px_36px_-18px_var(--color-shadow),0_3px_10px_-4px_var(--color-shadow)]',
                  fromTop ? 'top-0' : 'bottom-0',
                )}
              >
                <ToastBody toast={toast} hidden={behind} onMeasure={measure} />
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ol>
    </div>
  );
}

function ToastBody({
  toast,
  hidden,
  onMeasure,
}: {
  toast: Toast;
  hidden: boolean;
  onMeasure: (id: number, height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const error = toast.tone === 'error';

  // Its natural height, which the deck stacks by. Observed, so a rewrap on resize restacks.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const report = () => onMeasure(toast.id, element.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [toast.id, onMeasure]);

  return (
    <motion.div
      ref={ref}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ duration: 0.15 }}
      className="flex items-center gap-2.5 py-1.5 pl-1.5 pr-2"
    >
      <Mark error={error} />
      <span
        className={cn(
          'min-w-0 flex-1 text-sm font-semibold text-foreground',
          // A reason is read in full; a receipt is one line.
          error ? 'line-clamp-3 py-1' : 'truncate',
        )}
      >
        {toast.text}
      </span>
      {toast.count > 1 ? (
        <span className="flex h-5 shrink-0 items-center overflow-hidden rounded-full bg-muted px-1.5 font-mono text-xs tabular-nums text-muted-foreground">
          ×
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={toast.count}
              initial={{ y: '110%' }}
              animate={{ y: 0 }}
              exit={{ y: '-110%' }}
              transition={{ type: 'spring', bounce: 0.3, duration: 0.35 }}
            >
              {toast.count}
            </motion.span>
          </AnimatePresence>
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
        // Out of the way until wanted; always there on touch and to the keyboard.
        className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </motion.div>
  );
}

/** A check that draws itself in, or a mark that shakes once. */
function Mark({ error }: { error: boolean }) {
  return (
    <motion.span
      initial={error ? { x: 0 } : { scale: 0.5 }}
      animate={error ? { x: [0, -3, 3, -2, 2, 0] } : { scale: 1 }}
      transition={
        error ? { duration: 0.4, delay: 0.12 } : { type: 'spring', bounce: 0.5, duration: 0.4 }
      }
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full',
        error ? 'bg-destructive-soft text-destructive' : 'bg-success-soft text-success',
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {error ? (
          <>
            <path d="M8 3.5v5.25" />
            <path d="M8 12.25h.01" />
          </>
        ) : (
          <motion.path
            d="M3.5 8.5l3 3 6-7"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.35, delay: 0.12, ease: 'easeOut' }}
          />
        )}
      </svg>
    </motion.span>
  );
}
