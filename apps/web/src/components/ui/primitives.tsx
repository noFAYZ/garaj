'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/utils';
import { buttonClass, type ButtonSize, type ButtonVariant } from './button-class';
import { Skeleton } from './skeleton';

/**
 * Surfaces are separated by contrast, not outlines: a card is `bg-card/50`, never a border.
 * Opacity suffixes are how depth is built — but nesting two `bg-card/50` surfaces flattens
 * both, so an inner surface uses `bg-card` or nothing.
 */
export function SectionCard({
  title,
  description,
  icon,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl bg-card/50 p-6', className)}>
      {title || action ? (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* The glyph sits in its own tile, so a section's icon reads as its badge rather
                than a stray mark floating beside the title. */}
            {icon ? (
              <span
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"
                aria-hidden="true"
              >
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? <h2 className="text-base font-semibold text-foreground">{title}</h2> : null}
              {description ? (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const ACCENTS = {
  default: 'bg-muted-foreground/25',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
} as const;

/**
 * A row in a list that is really a card: the whole thing is the link, the leading rule
 * carries the status, and the trailing slot holds a badge or a figure.
 */
export function TileRow({
  accent = 'default',
  leading,
  title,
  meta,
  trailing,
  className,
}: {
  accent?: keyof typeof ACCENTS;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex items-center gap-3 overflow-hidden rounded-xl bg-card p-3 pl-4 transition-colors group-hover:bg-muted',
        className,
      )}
    >
      <span
        className={cn('absolute inset-y-2 left-0 w-0.5 rounded-full', ACCENTS[accent])}
        aria-hidden="true"
      />
      {leading ? (
        <span className="shrink-0 text-muted-foreground" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        {meta ? <div className="truncate text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Disables the button and runs the working sweep along its bottom edge. The label stays — so
   * the button keeps its width and its name, a form row does not shift when the request starts,
   * and a second click cannot send it twice.
   */
  loading?: boolean;
};

// Re-exported for client callers. Server components import it from `./button-class` directly.
export { buttonClass };

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  className,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      // Defaults to "button". A bare <button> inside a form submits it, which is a
      // surprising page reload on what looked like a cancel control.
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {loading ? (
        <>
          {/*
           * The label keeps its place — so the button keeps its width — but steps aside for a
           * spinner in its own ink. It never swaps for "Saving…": the button is named for what it
           * does, and a screen reader already hears `aria-busy`.
           */}
          <span className="invisible inline-flex items-center gap-2">{children}</span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid place-items-center"
          >
            <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  suffix?: string;
};

/**
 * A labelled input. The label wraps nothing — it points at the input by id — so the hint
 * and error can sit outside it and still be announced, via `aria-describedby`.
 */
export function Field({ label, hint, error, suffix, className, id, ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
      </label>

      <div className="relative">
        <input
          id={inputId}
          // Only the messages that are actually rendered, or a screen reader announces the
          // id of an element that does not exist.
          aria-describedby={cn(hint && hintId, error && errorId) || undefined}
          aria-invalid={error ? true : undefined}
          className={cn(
            // The same height and radius as a `md` button and a select, so a field and the
            // control beside it line up without a per-form nudge.
            'h-10 w-full rounded-xl bg-input px-3 text-sm text-foreground transition-colors',
            'placeholder:text-muted-foreground hover:bg-border focus:bg-border',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error && 'ring-2 ring-destructive',
            suffix && 'pr-12',
          )}
          {...props}
        />
        {suffix ? (
          <span
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
            aria-hidden="true"
          >
            {suffix}
          </span>
        ) : null}
      </div>

      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-card/50 px-6 py-16 text-center">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/**
 * Async status, announced politely.
 *
 * `role="status"` with `aria-live="polite"` means a screen reader is told when a list
 * finishes loading or a count changes, without interrupting whatever it is reading.
 */
export function StatusRegion({
  children,
  className,
}: {
  children: ReactNode;
  /** `sr-only` where the count is announced but deliberately not shown. */
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('text-sm text-muted-foreground', className)}
    >
      {children}
    </div>
  );
}

/** Numbers that change in place. Proportional digits make a counter jitter as it updates. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  /**
   * `undefined` while it loads. The label is known before any request, so it is always drawn;
   * only the figure is a placeholder.
   */
  value: string | undefined;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}) {
  return (
    <div className="min-w-0">
      <div className="text-label uppercase text-muted-foreground">{label}</div>
      {value === undefined ? (
        // The figure's own line height, so nothing moves when the number lands.
        <Skeleton className="mt-1 h-7 w-20 max-w-full" />
      ) : (
        <div
          className={cn(
            'mt-1 truncate text-lg font-semibold tabular-nums',
            tone === 'success' && 'text-success',
            tone === 'warning' && 'text-warning',
            tone === 'destructive' && 'text-destructive',
            (!tone || tone === 'default') && 'text-foreground',
          )}
        >
          {value}
        </div>
      )}
    </div>
  );
}
