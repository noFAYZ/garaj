import type { Metadata, Viewport } from 'next';
import { Albert_Sans, Cascadia_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import { AppShell } from '@/components/app-shell';
import { THEME_COLORS, THEME_SCRIPT } from '@/lib/settings/theme-script';
import './globals.css';

/*
 * Self-hosted at build time by `next/font` — no request to Google at runtime, so no
 * third-party connection on every page load and no flash while a stylesheet resolves.
 * The variable font carries every weight in one file, which is why no `weight` is listed.
 */
const urbanist = Albert_Sans({
  subsets: ['latin'],
  variable: '--font-urbanist',
  display: 'swap',
});

/*
 * Figures: Cascadia Mono, the file the phone bundles too, so a number is the same shape on every
 * screen. Left to the system's monospace it was Cascadia on Windows and SF Mono on a Mac.
 */
const mono = Cascadia_Mono({
  subsets: ['latin'],
  variable: '--font-figures',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Garaj',
  description: 'Your vehicles. Their entire story. One place.',
};

/*
 * The browser's own chrome — a phone's address bar — in the page's colour, for the first paint.
 * An explicit choice that differs from the device is applied by `setThemePreference`.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${urbanist.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
