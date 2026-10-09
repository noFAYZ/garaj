'use client';

import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/motion/popover';
import { cn } from '@/lib/utils';
import { buttonClass } from './button-class';
import { FormError, Modal, ModalActions } from './modal';
import { Button } from './primitives';

export interface RowMenuItem {
  label: string;
  icon: IconName;
  onSelect: () => void;
  destructive?: boolean;
}

/**
 * A row's occasional actions, behind one ⋯.
 *
 * Plain buttons in the panel, not `role="menu"` — a menu role promises arrow-key roving focus, and a
 * role that promises behaviour the element lacks is worse for a screen reader than none. Each item
 * opens a dialog; nothing edits in place.
 */
export function RowMenu({
  label,
  items,
  className,
}: {
  /** The trigger's accessible name — name the row, since every row has one: "More for Rotate tyres". */
  label: string;
  items: readonly RowMenuItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" sideOffset={8}>
      <PopoverTrigger>
        <button
          type="button"
          aria-label={label}
          className={buttonClass('ghost', 'icon-sm', className)}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1.5">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              setOpen(false);
              item.onSelect();
            }}
            className={cn(
              'flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left text-sm font-semibold transition-colors',
              item.destructive
                ? 'text-destructive hover:bg-destructive-soft'
                : 'text-foreground hover:bg-muted',
            )}
          >
            <Icon
              name={item.icon}
              size={16}
              className={cn('shrink-0', !item.destructive && 'text-muted-foreground')}
            />
            {item.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The second press of a delete: a dialog whose button says exactly what goes.
 *
 * Replaces `window.confirm`, which is the one dialog people click through without reading and
 * which cannot say what else is lost with the thing being deleted.
 */
export function ConfirmDelete({
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} description={description} icon="trash" onClose={onClose}>
      <div className="flex flex-col gap-4">
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
