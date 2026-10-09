'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, type KeyboardEvent } from 'react';
import { setThemePreference, useThemePreference, type ThemePreference } from '@/lib/settings/theme';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const satisfies readonly { value: ThemePreference; label: string; icon: unknown }[];

/**
 * System, light or dark, as one segmented control.
 *
 * Three states, not a switch: "light theme: off" cannot say "follow my device", which is the
 * choice most people actually want, and a switch has no honest position for it.
 *
 * A radio group with roving focus — one tab stop, arrows move and choose — because that is what
 * a set of mutually exclusive buttons is to a screen reader. The theme spreads out from the
 * button that was pressed, so the change visibly comes from the control that made it.
 */
export function ThemePicker({ labelledBy }: { labelledBy?: string }) {
  const preference = useThemePreference();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const choose = (value: ThemePreference, from: HTMLElement | null | undefined) => {
    const rect = from?.getBoundingClientRect();
    setThemePreference(
      value,
      rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined,
    );
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = (index + delta + OPTIONS.length) % OPTIONS.length;
    const button = buttons.current[next];
    button?.focus();
    choose(OPTIONS[next]!.value, button);
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : 'Theme'}
      className="inline-flex gap-0.5 rounded-xl bg-muted p-1"
    >
      {OPTIONS.map((option, index) => {
        const checked = preference === option.value;
        const OptionIcon = option.icon;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // The label is hidden on phones, so each option names itself.
            aria-label={option.label}
            tabIndex={checked ? 0 : -1}
            onClick={(event) => choose(option.value, event.currentTarget)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'relative isolate flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold transition-colors',
              checked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {checked ? (
              <motion.span
                layoutId="theme-picker-active"
                className="absolute inset-0 -z-10 rounded-lg bg-card shadow-float"
                transition={{ type: 'spring', bounce: 0.15, duration: 0.28 }}
                aria-hidden="true"
              />
            ) : null}
            <OptionIcon className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
