'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A feature card's insides: its words and a slider on the left, a phone showing both themes on
 * the right, the dark screen cut at the line the slider sets. Until it is touched the line sweeps
 * back and forth on its own (CSS, and only where motion is welcome). The slider is a native range
 * input, so keys and screen readers move it too; the phone is rendered by the server.
 */
export function ThemeSplit({ text, children }: { text: ReactNode; children: ReactNode }) {
  const [split, setSplit] = useState<number | null>(null);
  return (
    <>
      <div className="relative z-10 flex flex-col gap-6 p-7 sm:max-w-[15rem]">
        {text}
        <label className="flex w-full max-w-56 items-center gap-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">
          Light
          <input
            type="range"
            min={0}
            max={100}
            value={split ?? 50}
            onChange={(event) => setSplit(Number(event.target.value))}
            aria-label="Compare the light and dark themes"
            className="split-range min-w-0 flex-1"
          />
          Dark
        </label>
      </div>
      <div
        className={cn(
          'tile-rise absolute -bottom-[26%] right-[6%] w-[56%] rotate-[3deg] sm:-bottom-[34%] sm:w-[46%]',
          split === null && 'split-auto',
        )}
        style={split === null ? undefined : ({ '--split': `${split}%` } as CSSProperties)}
      >
        {children}
      </div>
    </>
  );
}
