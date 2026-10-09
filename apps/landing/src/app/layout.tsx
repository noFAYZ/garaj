import type { Metadata, Viewport } from 'next';
import { Urbanist } from 'next/font/google';
import type { ReactNode } from 'react';
import { THEME_COLORS, THEME_SCRIPT } from '@/lib/settings/theme-script';
import './globals.css';

const urbanist = Urbanist({ subsets: ['latin'], variable: '--font-urbanist', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3003'),
  alternates: { canonical: '/' },
  title: 'Garaj — every vehicle, its whole story',
  description:
    'Services, costs, paperwork and value for every car, bike and boat you own, in one garage you can share. Garaj tells you what is due before it is late.',
  openGraph: {
    title: 'Garaj — every vehicle, its whole story',
    description: 'The logbook, the reminders and the running costs for everything you drive.',
    type: 'website',
    siteName: 'Garaj',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
};

/** The web app's theme script and key: a theme chosen on one site holds on the other's origin too. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={urbanist.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
