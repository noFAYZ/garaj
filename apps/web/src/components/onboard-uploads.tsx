'use client';

import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/utils';

export const PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif';

/*
 * Windows reports no MIME type for HEIC, which is what an iPhone photo copied to a PC is — so
 * the extension counts too, or the most common phone photo is rejected as "not an image".
 */
export const isImage = (file: File) =>
  file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name);

/**
 * A file target you can click or drop onto.
 *
 * `aria-disabled` rather than `disabled` while an upload runs: a disabled button stops
 * receiving drag events, and a file dropped on something that ignores the drop is opened by
 * the browser — navigating away from the page it was dropped on.
 */
export function DropTile({
  icon,
  label,
  hint,
  busy,
  blocked,
  onPick,
  onFiles,
  compact = false,
  className,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  busy: boolean;
  blocked: boolean;
  onPick: () => void;
  onFiles: (files: File[]) => void;
  /** A field-height row rather than a tile, for a target sitting beside a select. */
  compact?: boolean;
  className?: string;
}) {
  const [over, setOver] = useState(false);

  return (
    <button
      type="button"
      aria-disabled={blocked || undefined}
      aria-busy={busy || undefined}
      onClick={() => {
        if (!blocked) onPick();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!blocked) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const files = Array.from(event.dataTransfer.files);
        if (!blocked && files.length) onFiles(files);
      }}
      className={cn(
        // Children ignore the pointer, or crossing the icon fires `dragleave` and the highlight
        // flickers under the file being dragged.
        'group flex items-center justify-center text-center transition-[background-color,color,scale] duration-200 [&>*]:pointer-events-none',
        compact ? 'h-10 gap-2 rounded-xl px-4' : 'flex-col gap-1 rounded-2xl p-4',
        over
          ? 'scale-[1.01] bg-primary-soft text-foreground ring-2 ring-inset ring-primary'
          : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
        blocked ? 'cursor-progress' : 'active:scale-[0.98]',
        blocked && !busy && 'opacity-60',
        className,
      )}
    >
      {busy ? (
        <LoaderCircle
          className={cn('animate-spin', compact ? 'size-4' : 'size-6')}
          aria-hidden="true"
        />
      ) : (
        <Icon
          name={icon}
          size={compact ? 16 : 26}
          className="transition-transform duration-200 group-hover:-translate-y-0.5"
        />
      )}
      <span className={cn('text-sm font-semibold text-foreground', !compact && 'mt-1')}>
        {busy ? 'Uploading…' : label}
      </span>
      {hint && !compact ? <span className="text-xs">{hint}</span> : null}
    </button>
  );
}
