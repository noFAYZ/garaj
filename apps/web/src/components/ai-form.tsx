'use client';

/**
 * The pieces every GarajAI approve card is built from.
 *
 * A card is a frame (what it is, where it goes, Cancel and Approve), a headline, and an
 * instrument panel of fields — hairlines between cells, the label over the value, figures in
 * mono — with the rarely-needed ones folded under "More". Files show as tiles: a picture's own
 * thumbnail, a paper's type.
 */

import { Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { symbolOf } from '@vehicle-os/ui';
import { Icon } from '@/components/icons';
import { DatePicker } from '@/components/ui/date-picker';
import { isImage } from '@/components/onboard-uploads';
import { Button } from '@/components/ui/primitives';
import { Select, type SelectOption } from '@/components/ui/select';
import { useObjectUrl } from '@/lib/ai-files';
import { cn } from '@/lib/utils';

export type FieldSpec = {
  key: string;
  label: string;
  /** Spans the panel's width. */
  wide?: boolean;
  /** Folded under "More" unless it holds a value. */
  more?: boolean;
} & (
  | { type: 'text'; placeholder?: string }
  | { type: 'number'; suffix?: string; placeholder?: string }
  | { type: 'date' }
  | { type: 'money'; currencyKey: string }
  | { type: 'select'; options: readonly SelectOption[] }
  | { type: 'notes'; placeholder?: string }
);

export type Values = Record<string, string>;

const control =
  'h-7 w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none';

/**
 * The fields, laid out as a panel. `was` shows the value an edit replaces, struck through over
 * the new one, so an edit reads as a change and not a fresh form.
 */
export function FieldGrid({
  specs,
  values,
  onChange,
  was,
}: {
  specs: readonly FieldSpec[];
  values: Values;
  onChange: (key: string, value: string) => void;
  was?: Values;
}) {
  const hidden = specs.filter((spec) => spec.more && !values[spec.key]);
  const [more, setMore] = useState(false);
  const shown = more ? specs : specs.filter((spec) => !hidden.includes(spec));
  if (shown.length === 0 && hidden.length === 0) return null;

  // A cell left without a partner in its row takes the row, so the panel never shows a hole.
  const full = new Set<string>();
  let alone: string | null = null;
  for (const spec of shown) {
    if (spec.wide || spec.type === 'notes') {
      if (alone) full.add(alone);
      alone = null;
    } else {
      alone = alone ? null : spec.key;
    }
  }
  if (alone) full.add(alone);

  return (
    <div className="grid grid-cols-2 gap-px border-y border-border/60 bg-border/60">
      {shown.map((spec) => (
        <label
          key={spec.key}
          className={cn(
            'flex min-w-0 flex-col gap-0.5 bg-card px-3.5 py-2 transition-colors focus-within:bg-muted',
            (spec.wide || spec.type === 'notes' || full.has(spec.key)) && 'col-span-2',
          )}
        >
          <span className="flex items-baseline gap-2">
            <span className="text-label uppercase text-muted-foreground">{spec.label}</span>
            {was?.[spec.key] ? (
              <span className="truncate text-xs text-muted-foreground line-through">
                {was[spec.key]}
              </span>
            ) : null}
          </span>
          <Control spec={spec} values={values} onChange={onChange} />
        </label>
      ))}
      {hidden.length > 0 && !more ? (
        <button
          type="button"
          onClick={() => setMore(true)}
          className="col-span-2 flex items-center gap-2 bg-card px-3.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          <span className="font-semibold">More</span>
          <span className="truncate">{hidden.map((spec) => spec.label).join(' · ')}</span>
        </button>
      ) : null}
    </div>
  );
}

function Control({
  spec,
  values,
  onChange,
}: {
  spec: FieldSpec;
  values: Values;
  onChange: (key: string, value: string) => void;
}) {
  const value = values[spec.key] ?? '';
  const set = (next: string) => onChange(spec.key, next);

  switch (spec.type) {
    case 'text':
      return (
        <input
          value={value}
          onChange={(event) => set(event.target.value)}
          placeholder={spec.placeholder ?? '—'}
          size={1}
          className={control}
        />
      );
    case 'number':
      return (
        <span className="flex items-baseline gap-1">
          <input
            value={value}
            onChange={(event) => set(event.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder={spec.placeholder ?? '—'}
            size={1}
            className={cn(control, 'font-mono tabular-nums')}
          />
          {spec.suffix ? (
            <span className="font-mono text-xs text-muted-foreground">{spec.suffix}</span>
          ) : null}
        </span>
      );
    case 'date':
      return (
        <DatePicker
          label={spec.label}
          value={value}
          onChange={set}
          placeholder="—"
          hideIcon
          triggerClassName="h-7 bg-transparent px-0 hover:bg-transparent aria-expanded:bg-transparent focus-visible:outline-none"
        />
      );
    case 'money': {
      const code = values[spec.currencyKey] ?? '';
      return (
        <span className="flex items-baseline gap-1">
          <span className="font-mono text-sm text-muted-foreground">
            {code.length === 3 ? symbolOf(code) : ''}
          </span>
          <input
            value={value}
            onChange={(event) => set(event.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="0.00"
            size={1}
            className={cn(control, 'font-mono tabular-nums')}
          />
          <input
            value={code}
            onChange={(event) =>
              onChange(spec.currencyKey, event.target.value.replace(/[^a-z]/gi, '').toUpperCase())
            }
            maxLength={3}
            size={3}
            aria-label={`${spec.label} currency`}
            className="h-7 w-[3.5ch] shrink-0 bg-transparent text-right font-mono text-xs uppercase text-muted-foreground focus-visible:text-foreground focus-visible:outline-none"
          />
        </span>
      );
    }
    case 'select':
      return (
        <Select
          value={value}
          onValueChange={set}
          options={spec.options}
          ariaLabel={spec.label}
          placeholder="—"
          // The trigger drawn as a value in the cell, like its neighbours, not as a field in one.
          className="w-full [&>button]:!h-7 [&>button]:!bg-transparent [&>button]:!px-0"
        />
      );
    case 'notes':
      return (
        <textarea
          value={value}
          onChange={(event) => set(event.target.value)}
          placeholder={spec.placeholder ?? 'Anything worth remembering'}
          rows={1}
          className="min-h-7 w-full resize-none bg-transparent py-1 text-sm text-foreground [field-sizing:content] placeholder:text-muted-foreground focus-visible:outline-none"
        />
      );
  }
}

/** A file as a tile: a picture's thumbnail, or a paper's type, with a way to drop it. */
export function FileTile({
  file,
  onRemove,
  className,
}: {
  file: File;
  onRemove?: () => void;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const url = useObjectUrl(isImage(file) && !broken ? file : null);
  const extension = file.name.split('.').pop()?.slice(0, 4) ?? 'file';

  return (
    <div
      title={file.name}
      className={cn(
        'group/file relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-inset ring-border/60',
        className,
      )}
    >
      {url ? (
        <img
          src={url}
          alt={file.name}
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-1 px-1">
          <Icon name="document" size={20} />
          <span className="w-full truncate text-center font-mono text-[10px] uppercase text-muted-foreground">
            {extension}
          </span>
        </span>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${file.name}`}
          className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-popover/90 text-foreground transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/file:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** The files a card will upload on approve: those attached to the line, and any added here. */
export function FilesField({
  label,
  files,
  accept,
  onChange,
}: {
  label: string;
  files: readonly File[];
  accept: string;
  onChange: (files: File[]) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2 px-3.5 py-2.5">
      <span className="text-label uppercase text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">
        {files.map((file, index) => (
          <FileTile
            key={`${file.name}-${index}`}
            file={file}
            onRemove={() => onChange(files.filter((_, at) => at !== index))}
          />
        ))}
        <button
          type="button"
          onClick={() => picker.current?.click()}
          aria-label={`Add ${label.toLowerCase()}`}
          className="grid size-16 shrink-0 place-items-center rounded-xl border border-dashed border-border-strong text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Paperclip className="size-4" aria-hidden="true" />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={accept}
          hidden
          onChange={(event) => {
            onChange([...files, ...Array.from(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

export type Tone = 'create' | 'edit' | 'delete';
const BADGE = { create: Plus, edit: Pencil, delete: Trash2 } as const;

/**
 * The frame: a badge saying what kind of change it is and where it lands, the headline, the
 * body, then Cancel and Approve. A delete is a destructive zone and takes a second press that
 * says exactly what happens.
 */
export function ActionCard({
  tone,
  badge,
  context,
  heading,
  children,
  pending,
  canApprove = true,
  error,
  confirmLabel,
  onApprove,
  onCancel,
}: {
  tone: Tone;
  badge: string;
  context?: ReactNode;
  heading: ReactNode;
  children?: ReactNode;
  pending: boolean;
  canApprove?: boolean;
  error?: string;
  /** For a delete: the second press, e.g. "Delete for good". */
  confirmLabel?: string;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const BadgeIcon = BADGE[tone];
  const approve = () => {
    if (!canApprove || pending) return;
    if (tone === 'delete' && !confirming) return setConfirming(true);
    onApprove();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        approve();
      }}
      className={cn(
        'overflow-hidden rounded-2xl ring-1 ring-inset',
        tone === 'delete' ? 'bg-destructive-soft ring-transparent' : 'bg-card ring-border/60',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-3.5 pt-3">
        <span
          className={cn(
            'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold',
            tone === 'delete'
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-primary-soft text-foreground',
          )}
        >
          <BadgeIcon className="size-3" strokeWidth={3} aria-hidden="true" />
          {badge}
        </span>
        {context ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {context}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-3 px-3.5 pb-3 pt-2.5">{heading}</div>
      {children}
      {error ? (
        <p role="alert" className="px-3.5 pt-2.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2 px-2.5 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={confirming ? () => setConfirming(false) : onCancel}
        >
          {confirming ? 'Keep it' : 'Cancel'}
        </Button>
        <Button
          type="submit"
          variant={tone === 'delete' ? 'danger' : 'primary'}
          size="sm"
          loading={pending}
          disabled={!canApprove}
        >
          {confirming
            ? (confirmLabel ?? 'Delete for good')
            : tone === 'delete'
              ? 'Delete'
              : 'Approve'}
        </Button>
      </div>
    </form>
  );
}

/** The headline's title, typed in place. */
export function TitleInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label="Title"
      size={1}
      className="h-8 min-w-0 flex-1 bg-transparent text-base font-semibold text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
    />
  );
}
