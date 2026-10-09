'use client';

import './globals.css';
import { THEME_SCRIPT } from '@/lib/settings/theme-script';

/**
 * An error in the root layout itself — the providers or the shell. It replaces the whole
 * document, so it brings its own `<html>` and stylesheet and depends on nothing that might be
 * what just failed.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* It replaces the root layout, script included — without its own copy it is always dark. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-xl font-semibold text-foreground">Garaj could not load</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Something failed before the page could draw. Trying again usually clears it.
          </p>
          <button
            type="button"
            onClick={reset}
            className="key h-10 rounded-xl px-4 text-sm font-semibold"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
