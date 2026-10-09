import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { buttonClass } from '@/components/ui/button-class';
import { cn } from '@/lib/utils';
import { isTyping } from '../lib/keys';
import { Kbd } from './ui';

/**
 * A record, open beside the list it came from: a native `<dialog>` pinned to the right edge, for
 * the focus trap, the inert page and Escape. It opens by being mounted and closes by navigating
 * away, so a person or a garage is a link, and Back closes it.
 *
 * `prev` and `next` walk the list it was opened from — J and K, the way a mail client does — so
 * a run of records can be read without closing anything.
 *
 * Nothing in a sheet opens a popover: those portal to `body`, which a modal dialog makes inert.
 */
export function Sheet({
  id,
  label,
  onClose,
  prev,
  next,
  children,
}: {
  /** The record shown: moving to another one starts its sheet at the top. */
  id: string;
  label: string;
  onClose: () => void;
  prev?: string;
  next?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [id]);

  useEffect(() => {
    const element = dialog.current;
    // Guarded: strict mode runs this twice, and a second `showModal()` on an open dialog throws.
    if (element && !element.open) element.showModal();
    // Onto the record itself, not the first button: Tab reaches the controls from there, and
    // nothing lights up a focus ring on a sheet opened with the pointer.
    body.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      // Only while this sheet is the top of the stack: not under a confirmation opened from it.
      if (document.querySelector('dialog[open]:not(.sheet)')) return;
      if (event.key === 'j' && next) window.location.hash = next;
      if (event.key === 'k' && prev) window.location.hash = prev;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next]);

  const step = (target: string | undefined, label: string, Icon: typeof ChevronUp, key: string) => (
    <a
      href={target}
      aria-label={label}
      aria-disabled={!target || undefined}
      title={`${label} (${key})`}
      className={cn(
        buttonClass('ghost', 'icon-sm'),
        'size-8',
        !target && 'pointer-events-none opacity-35',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </a>
  );

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      // Only this dialog's own close: React carries a nested dialog's `close` up through its
      // parents, so closing a confirmation opened from in here would otherwise close both.
      onClose={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      className="sheet bg-card p-0 text-foreground shadow-float"
    >
      <div className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4">
          <div className="flex items-center gap-1">
            {prev !== undefined || next !== undefined ? (
              <>
                {step(prev, 'Previous', ChevronUp, 'K')}
                {step(next, 'Next', ChevronDown, 'J')}
                <span className="ml-2 hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                  <Kbd>J</Kbd>
                  <Kbd>K</Kbd>
                  to move through the list
                </span>
              </>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialog.current?.close()}
            className={cn(buttonClass('ghost', 'icon-sm'), 'size-8')}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div
          ref={body}
          tabIndex={-1}
          className="scrollbar-slim min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
        >
          {children}
        </div>
      </div>
    </dialog>
  );
}

/** The head of a sheet: who or what it is, its badges, and its quick actions. */
export function SheetHead({
  lead,
  title,
  subtitle,
  badges,
  actions,
}: {
  lead: ReactNode;
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 px-6 pb-5 pt-6">
      <div className="flex min-w-0 items-start gap-4">
        {lead}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold tracking-tight">{title}</h2>
          {subtitle ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
              {subtitle}
            </div>
          ) : null}
          {badges ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{badges}</div>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** A titled block of a sheet's body. */
export function SheetSection({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3 border-t border-border/60 px-6 py-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-label uppercase text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
