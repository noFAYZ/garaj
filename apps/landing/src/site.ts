import type { Metadata } from 'next';

/*
 * The site's facts in one place: its name, where it lives, where its buttons go, and who answers.
 * `@/` is apps/web's source (tsconfig paths), so this app's own modules are imported relatively.
 */
export const BRAND = 'Garajj';
/** next.config fills these from the root .env, with the production address as the fallback. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL!;
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || null;
/** The developer docs; where they are not published, their links are left out. */
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || null;
/*
 * ponytail: until the web app is deployed (no NEXT_PUBLIC_APP_URL), "Start free" and "Sign in"
 * lead to Support. Set the variable on the host and they go to the product.
 */
export const SIGN_UP = APP_URL ? `${APP_URL}/sign-up` : '/support';
export const SIGN_IN = APP_URL ? `${APP_URL}/sign-in` : '/support';
/** Where privacy questions, deletion requests and support go. The one address on the site. */
export const CONTACT_EMAIL = 'support@fayzan.xyz';
/** The legal pages' date. Change it with their text. */
export const LEGAL_UPDATED = '27 November 2026';

/** The sections the header and footer link to — from any page, so `/#…` rather than `#…`. */
export const NAV = [
  { href: '/#how', label: 'How it works' },
  { href: '/#features', label: 'Features' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
];

export const LEGAL = [
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms of use' },
  { href: '/support', label: 'Support' },
  { href: '/delete-account', label: 'Delete account' },
];

/**
 * A page's own metadata: title, description, canonical, and the same for link previews — set
 * per page, because Next replaces the root's `openGraph` rather than merging into it.
 */
export function pageMetadata(path: string, title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: BRAND,
      url: path,
      title: `${title} · ${BRAND}`,
      description,
    },
    twitter: { card: 'summary_large_image', title: `${title} · ${BRAND}`, description },
  };
}
