'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/motion/switch';

interface SettingRowProps {
  title: string;
  description?: string;
  /** The control, rendered on the right. Receives the id and text of the title to label itself. */
  children?: (label: { id: string; text: string }) => ReactNode;
  className?: string;
}

/**
 * Title, optional description, control on the right.
 *
 * The row owns the label association. A settings title is not a `<label>` — it sits beside
 * the control, not around it — so the row generates an id, puts it on the title, and hands
 * it to the child for `aria-labelledby`. Without that a screen reader announces "switch"
 * and nothing else.
 *
 * The title text is passed alongside the id because the vendored beUI Switch destructures
 * its props explicitly and takes `ariaLabel` rather than `aria-labelledby` — an unknown
 * prop would be dropped silently, leaving the control unlabelled with no visible symptom.
 * Naming it here beats forking the component over one attribute.
 */
export function SettingRow({ title, description, children, className }: SettingRowProps) {
  const titleId = useId();

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 rounded-xl px-4 py-3 transition-colors',
        'hover:bg-muted',
        className,
      )}
    >
      {/*
       * `min-w-0` is what makes the truncation work. Flex children default to
       * `min-width: auto`, so without it a long description refuses to shrink and pushes
       * the control off the right edge of the row instead.
       */}
      <div className="min-w-0 flex-1">
        <div id={titleId} className="text-sm font-medium text-foreground">
          {title}
        </div>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>

      {/* `shrink-0` keeps the control at its intended width no matter how long the text is. */}
      {children ? <div className="shrink-0">{children({ id: titleId, text: title })}</div> : null}
    </div>
  );
}

interface SettingToggleProps {
  title: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

/** The common case: a row whose only control is a switch. */
export function SettingToggle({
  title,
  description,
  checked,
  onCheckedChange,
  className,
}: SettingToggleProps) {
  return (
    <SettingRow title={title} description={description} className={className}>
      {(label) => (
        <Switch checked={checked} onCheckedChange={onCheckedChange} ariaLabel={label.text} />
      )}
    </SettingRow>
  );
}
