'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';
import { Select, type SelectOption } from './select';

export type { SelectOption };

/**
 * The value of an "any / none" option.
 *
 * Callers map it back to null or '' at the boundary, so "no garage chosen" and "chose the
 * option meaning any garage" stay two different things in their state.
 */
export const ANY_VALUE = '__any';

/**
 * A labelled select, shaped like `Field`.
 *
 * A real `<label htmlFor>`: clicking the label opens the select, and the association is what a
 * screen reader reads. The label used to be a bare `<span>` beside it, which looked the same and
 * did neither.
 */
export function SelectField({
  label,
  value,
  onChange,
  options,
  hideLabel = false,
  placeholder,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** For a control whose meaning is already stated beside it. It still names itself. */
  hideLabel?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-sm font-medium text-foreground'}>
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onValueChange={onChange}
        options={options}
        ariaLabel={label}
        placeholder={placeholder ?? label}
        disabled={disabled}
      />
    </div>
  );
}
