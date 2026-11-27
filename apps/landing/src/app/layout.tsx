import type { Metadata, Viewport } from 'next';
import { Albert_Sans, Cascadia_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { PLAN_LIMITS } from '@vehicle-os/domain';
import { THEME_COLORS, THEME_SCRIPT } from '@/lib/settings/theme-script';
import { BRAND, CONTACT_EMAIL, SITE_URL } from '../site';
import './globals.css';

/*
 * The app's type: Albert Sans, and Cascadia Mono for figures — under the variable names the
 * shared stylesheet reads (`--font-urbanist` is the web app's name for its sans).
 */
const sans = Albert_Sans({ subsets: ['latin'], variable: '--font-urbanist', display: 'swap' });
const mono = Cascadia_Mono({ subsets: ['latin'], variable: '--font-figures', display: 'swap' });

const TITLE = `${BRAND} — Vehicle maintenance, fuel and cost tracker`;
const DESCRIPTION = `Log fuel, services, parts and costs for every car, bike and boat you own, and get reminded before anything is due. Free for ${PLAN_LIMITS.FREE.vehicles} vehicles.`;

/*
 * Every page's defaults: each page sets its own title (through the template), description and
 * canonical; the link preview is `opengraph-image.tsx`, shared by every route under it.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s · ${BRAND}` },
  description: DESCRIPTION,
  applicationName: BRAND,
  alternates: { canonical: '/' },
  category: 'automotive',
  openGraph: {
    type: 'website',
    siteName: BRAND,
    locale: 'en_US',
    url: '/',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
};

/** Who publishes the site and what it is, for search engines: on every page. */
const SITE_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: BRAND,
      url: SITE_URL,
      logo: `${SITE_URL}/icon.png`,
      email: CONTACT_EMAIL,
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: BRAND,
      url: SITE_URL,
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
  ],
};

/** The web app's theme script and key: a theme chosen on one site holds on the other's origin too. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_LD) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
