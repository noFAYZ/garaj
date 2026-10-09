import { Check, Copy, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { avatarFor } from '@vehicle-os/contracts';
import { buttonClass } from '@/components/ui/button-class';
import { FormError, Modal, ModalActions } from '@/components/ui/modal';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { Part, Tone } from '../lib/status';
import { Menu } from './menu';

/*
 * The console's own pieces, built from the web app's tokens. Surfaces are `bg-card/50` panels on
 * the page; inside a panel, a surface is `bg-muted/60` or nothing — two translucent cards nested
 * flatten each other. Figures are mono, labels are the `text-label` caps, and colour is status.
 */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex animate-rise flex-wrap items-end justify-between gap-x-6 gap-y-4',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-1.5 text-3xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A card with one job: a title (with its glyph), one aside, and what it shows. */
export function Panel({
  title,
  icon: Glyph,
  aside,
  children,
  className,
  id,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('flex min-w-0 flex-col gap-4 rounded-2xl bg-card/50 p-5', className)}
    >
      <div className="flex min-h-7 items-center justify-between gap-4">
        <h2 id={id} className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {Glyph ? (
            <Glyph className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
          <span className="truncate">{title}</span>
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A mono figure set beside a panel's title: a count, a unit, a model name. */
export function Aside({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

export type ChipTone = 'muted' | 'ink' | 'primary' | 'success' | 'warning' | 'destructive' | 'info';

const CHIP: Record<ChipTone, string> = {
  muted: 'bg-muted text-muted-foreground',
  ink: 'bg-primary-soft text-foreground',
  primary: 'bg-primary text-primary-foreground',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  destructive: 'bg-destructive-soft text-destructive',
  info: 'bg-info-soft text-info',
};

export function Chip({
  children,
  tone = 'muted',
  className,
  title,
}: {
  children: ReactNode;
  tone?: ChipTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold',
        CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const DOT: Record<Tone | 'info', string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
  muted: 'bg-muted-foreground/40',
};

/** A status light. `pulse` rings it, for the one or two things on a screen that are live. */
export function Dot({
  tone,
  pulse = false,
  className,
}: {
  tone: Tone | 'info';
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn('relative inline-flex size-2 shrink-0', className)}>
      {pulse ? (
        <span className={cn('status-ping absolute inset-0 rounded-full', DOT[tone])} />
      ) : null}
      <span className={cn('relative size-full rounded-full', DOT[tone])} />
    </span>
  );
}

/** The console's spring: settles in about 150ms, with no wobble to wait out. */
export const SNAP = { type: 'spring', stiffness: 700, damping: 46, mass: 0.6 } as const;

/**
 * A row of mutually exclusive buttons, as one control: the range picker, a list's plan filter.
 * The lit one slides between them. Buttons with `aria-pressed` rather than radios — each is a
 * one-press action — inside a labelled group.
 */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode; count?: number; title?: string }[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pill = useId();
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-full bg-muted/70 p-1 [scrollbar-width:none]',
        className,
      )}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative isolate flex shrink-0 items-center gap-1.5 rounded-full font-semibold transition-[color,scale] duration-100 active:scale-[0.96]',
              size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-3.5 text-sm',
              on ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {on ? (
              <motion.span
                layoutId={pill}
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-full bg-primary"
                transition={SNAP}
              />
            ) : null}
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  'font-mono text-[11px] tabular-nums',
                  on ? 'text-primary-foreground/75' : 'text-muted-foreground',
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A page split into tabs: an underline that slides to the chosen one, a badge on each that says
 * what is inside before it is opened, and the arrow keys between them. The panel is keyed by the
 * tab, so a change of tab arrives with its own short rise.
 */
export function PageTabs<T extends string>({
  label,
  value,
  onChange,
  tabs,
  children,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  tabs: readonly { value: T; label: string; icon?: LucideIcon; badge?: ReactNode }[];
  children: ReactNode;
}) {
  const base = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const next =
      event.key === 'ArrowRight'
        ? index + 1
        : event.key === 'ArrowLeft'
          ? index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const at = (next + tabs.length) % tabs.length;
    buttons.current[at]?.focus();
    onChange(tabs[at]!.value);
  };

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label={label}
        className="scroll-fade-x -mx-1 flex gap-1 overflow-x-auto border-b border-border/70 px-1 [scrollbar-width:none]"
      >
        {tabs.map((tab, index) => {
          const on = tab.value === value;
          return (
            <button
              key={tab.value}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              id={`${base}-${tab.value}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`${base}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(tab.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'group relative flex h-11 shrink-0 items-center gap-2 rounded-t-xl px-3.5 text-sm font-semibold transition-colors duration-100',
                on
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              {tab.icon ? (
                <tab.icon
                  className={cn(
                    'size-4 transition-[color,scale] duration-150 group-active:scale-90',
                    on && 'text-primary',
                  )}
                  aria-hidden="true"
                />
              ) : null}
              {tab.label}
              {tab.badge}
              {on ? (
                <motion.span
                  layoutId={`${base}-line`}
                  aria-hidden="true"
                  className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary"
                  transition={SNAP}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        key={value}
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-${value}`}
        className="tab-in flex flex-col gap-6"
      >
        {children}
      </div>
    </div>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1 font-mono text-[10px] font-semibold text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * A person's face: the one they picked in the app, else the one their account id draws — the
 * same face the people in their garage see.
 */
export function Face({
  id,
  image,
  size = 36,
  className,
}: {
  id: string;
  image?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={avatarFor({ id, image })}
        alt=""
        loading="lazy"
        className="size-full object-cover"
      />
    </span>
  );
}

/** Copies a value and says so in place for a moment; the label names what is copied. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
      className={cn(buttonClass('ghost', 'icon-sm'), 'size-7 rounded-lg', className)}
    >
      {copied ? (
        <Check className="pop-in size-3.5 text-success" strokeWidth={2.75} aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

/** A share of a whole as a bar. Warm as it fills: amber past three quarters, red past nine tenths. */
export function Meter({
  value,
  tone,
  className,
}: {
  value: number;
  tone?: Tone | 'auto' | 'primary';
  className?: string;
}) {
  const share = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);
  const resolved =
    tone === 'auto' ? (share >= 0.9 ? 'destructive' : share >= 0.75 ? 'warning' : 'primary') : tone;
  return (
    <div
      aria-hidden="true"
      className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-out',
          resolved === 'success'
            ? 'bg-success'
            : resolved === 'warning'
              ? 'bg-warning'
              : resolved === 'destructive'
                ? 'bg-destructive'
                : resolved === 'muted'
                  ? 'bg-muted-foreground/50'
                  : 'bg-primary',
        )}
        style={{ width: `${share * 100}%` }}
      />
    </div>
  );
}

/** A figure in mono with its label over it: the unit of every readout. */
export function Figure({
  label,
  value,
  tone,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  tone?: 'bad' | 'warn' | 'good';
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="truncate text-label uppercase text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 truncate font-mono text-lg font-semibold tabular-nums tracking-tight',
          tone === 'bad' && 'text-destructive',
          tone === 'warn' && 'text-warning',
          tone === 'good' && 'text-success',
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

export function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>;
}

export interface RowAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** A row's quick actions behind one ⋯; the destructive ones sit apart at the foot. */
export function RowActions({
  label,
  actions,
  className,
}: {
  /** Names the row, since every row has one: "Actions for Bob Tester". */
  label: string;
  actions: (RowAction | null | false)[];
  className?: string;
}) {
  const items = actions.filter((action): action is RowAction => Boolean(action));
  return (
    <Menu
      label={label}
      sections={[
        { items: items.filter((item) => !item.destructive) },
        { items: items.filter((item) => item.destructive) },
      ]}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={label}
          className={cn(
            buttonClass('ghost', 'icon-sm'),
            'size-8 aria-expanded:bg-muted aria-expanded:text-foreground',
            className,
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      )}
    />
  );
}

/**
 * The second press of something that cannot be undone: a dialog whose button says exactly what
 * happens. Replaces `window.confirm`, the one dialog people click through without reading.
 */
export function Confirm({
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal title={title} description={description} icon="trash" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {children}
        {error ? <FormError>{error}</FormError> : null}
        <ModalActions>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Keep it
          </Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </ModalActions>
      </div>
    </Modal>
  );
}

/** A registration as it is read off the car: dark on a white plate, in both themes. */
export function Plate({ value }: { value: string | null }) {
  return value ? (
    <span className="inline-flex h-5 shrink-0 items-center rounded-[4px] border border-black/25 bg-[#f6f5ef] px-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-[#141414] shadow-[inset_0_-1px_0_rgb(0_0_0/0.12)]">
      {value}
    </span>
  ) : null;
}

const BADGE: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground/45',
};

/**
 * One part of the system: its glyph on a quiet tile, and its verdict as a badge on the corner.
 * Trouble tints the tile and colours the glyph; health is the badge alone, so a screen of parts
 * that are all fine stays calm and the one that is not is the only colour on it.
 */
export function StatusTile({
  part,
  size = 'md',
  className,
}: {
  part: Part;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const trouble = part.tone === 'warning' || part.tone === 'destructive';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative grid shrink-0 place-items-center rounded-xl transition-colors duration-200',
        size === 'lg' ? 'size-12 rounded-2xl' : 'size-9',
        part.tone === 'destructive'
          ? 'bg-destructive-soft text-destructive'
          : part.tone === 'warning'
            ? 'bg-warning-soft text-warning'
            : part.tone === 'muted'
              ? 'bg-muted/50 text-muted-foreground/60'
              : 'bg-muted text-foreground/85',
        className,
      )}
    >
      <part.icon className={size === 'lg' ? 'size-6' : 'size-[18px]'} strokeWidth={1.9} />
      <span
        className={cn(
          'absolute -right-0.5 -top-0.5 rounded-full ring-[2.5px] ring-[var(--tile-ring,var(--color-card))]',
          size === 'lg' ? 'size-3' : 'size-2.5',
          BADGE[part.tone],
          trouble && 'pop-in',
        )}
      />
    </span>
  );
}

/** The verdict's colour as text: only trouble is coloured, a healthy figure stays quiet. */
export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-muted-foreground',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
};
