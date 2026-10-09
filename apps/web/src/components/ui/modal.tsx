'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * A modal that opens by being mounted and closes by being unmounted.
 *
 * A native `<dialog>` with `showModal()`, for the focus trap, the inert page behind it, Escape
 * and the backdrop. Callers render it only while it should be open, which also resets the form
 * inside: reopening "Record a value" never shows the last amount somebody typed and abandoned.
 */
export function Modal({
  title,
  description,
  size = 'md',
  icon,
  fill = false,
  header,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  /**
   * `xl` is for the sectioned settings modals: a sidebar and a panel side by side need the
   * room of a small window, and at `lg` the plan cards and the unit pickers wrapped.
   */
  size?: 'md' | 'lg' | 'xl';
  /**
   * A fixed height, with the content filling it. For a modal whose sections differ in length:
   * sized to its content, it grew and shrank as the sections changed, and the centred frame
   * jumped under the pointer.
   */
  fill?: boolean;
  /** A glyph in a tile beside the title, for a modal that creates or changes a thing. */
  icon?: IconName;
  /**
   * Draws the head in place of the icon, title and description — for a modal that is a view of one
   * thing, whose head is that thing. Given the id the dialog is labelled by, which its heading
   * must carry; `title` is then unused.
   */
  header?: (titleId: string) => ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    // Guarded: strict mode runs this twice, and a second `showModal()` on an open dialog throws.
    if (!dialog || dialog.open) return;
    dialog.showModal();
    /*
     * Into the first field. `showModal()` focuses the first focusable element, which is the close
     * button — and React's `autoFocus` cannot help, because it calls `focus()` itself before this
     * effect rather than writing the attribute `showModal()` looks for. A modal with no field, a
     * confirmation, keeps the close button.
     */
    dialog
      .querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), textarea')
      ?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      /*
       * Escape arrives here as well as the close button, so the caller's state cannot drift from
       * whether the dialog is actually showing. Only this dialog's own close: React carries a
       * nested dialog's `close` up through its parents, so closing a confirmation opened from
       * inside this one would otherwise close both.
       */
      onClose={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className={cn(
        'm-auto overscroll-contain rounded-3xl bg-card p-0 text-left text-foreground shadow-float backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-pop',
        size === 'xl'
          ? 'w-[min(60rem,calc(100vw-2rem))]'
          : size === 'lg'
            ? 'w-[min(44rem,calc(100vw-2rem))]'
            : 'w-[min(32rem,calc(100vw-2rem))]',
        fill &&
          (size === 'xl' ? 'h-[min(46rem,calc(100dvh-2rem))]' : 'h-[min(38rem,calc(100dvh-2rem))]'),
      )}
    >
      <div className={cn('flex flex-col gap-5 p-6', fill && 'h-full')}>
        <div className="flex items-start justify-between gap-4">
          {header ? (
            <div className="min-w-0 flex-1">{header(titleId)}</div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              {icon ? (
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-foreground"
                >
                  <Icon name={icon} size={22} />
                </span>
              ) : null}
              <div className="min-w-0">
                <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                  {title}
                </h2>
                {description ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                ) : null}
              </div>
            </div>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </Button>
        </div>

        {children}
      </div>
    </dialog>
  );
}

/**
 * The foot of a `fill` modal: pinned under its scrolling body, on the card, with a soft shadow
 * cast up onto what scrolls beneath it. For a container that already runs edge to edge (the body's
 * `-mx-6 -mb-6`), so the bar meets the dialog's rounded bottom corners. See `dialog.md`.
 */
export const MODAL_BAR =
  'flex shrink-0 items-center justify-end gap-2 rounded-b-3xl bg-card px-6 py-4 shadow-[0_-12px_20px_-18px_var(--color-shadow)]';

/**
 * The row every dialog ends on, so they all end the same way: the action at the right, Cancel (a
 * ghost) before it in reading and tab order, and — when there is something to say — a status at the
 * left: what changed, where it goes. `bar` pins it as `MODAL_BAR` in a `fill` modal.
 */
export function ModalActions({
  aside,
  bar = false,
  className,
  children,
}: {
  aside?: ReactNode;
  bar?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(bar ? MODAL_BAR : 'flex items-center justify-end gap-2 pt-1', className)}>
      {aside ? (
        <div className="mr-auto min-w-0 truncate text-xs text-muted-foreground">{aside}</div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * A form's error that is not one field's — the server refused, the network dropped — on its own
 * status tint, the pair the contrast test checks. A field's own error stays under the field.
 */
export function FormError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-xl bg-destructive-soft px-3.5 py-2.5 text-sm text-destructive',
        className,
      )}
    >
      {children}
    </p>
  );
}
