'use client';

import type { MouseEvent } from 'react';
import { Moon, Sun } from 'lucide-react';
import { setThemePreference, useTheme, type Theme } from '@/lib/settings/theme';

/** The new theme spreads out from the centre of the control that chose it. */
function choose(theme: Theme, event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  setThemePreference(theme, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
}

/**
 * One button, two themes. The product's own theme store does the work — including the circular
 * reveal that spreads the new theme out from the button that chose it.
 */
export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      onClick={(event) => choose(next, event)}
      className="grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {theme === 'dark' ? (
        <Sun className="size-[18px]" aria-hidden="true" />
      ) : (
        <Moon className="size-[18px]" aria-hidden="true" />
      )}
    </button>
  );
}
