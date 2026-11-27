import Image from 'next/image';
import type { CSSProperties } from 'react';
import logoMark from '@/public/Logo.png';
import { APP_URL, BRAND, DOCS_URL, LEGAL, NAV, SIGN_IN, SIGN_UP } from '../site';

type Link = { href: string; label: string };

const COLUMNS: [string, Link[]][] = [
  ['Product', NAV],
  // Only once the web app is live: until then both would lead to Support, which Legal has.
  ...(APP_URL
    ? [
        [
          'Account',
          [
            { href: SIGN_UP, label: 'Start free' },
            { href: SIGN_IN, label: 'Sign in' },
          ],
        ] as [string, Link[]],
      ]
    : []),
  ...(DOCS_URL
    ? [
        [
          'Developers',
          [
            { href: DOCS_URL, label: 'API reference' },
            { href: `${DOCS_URL}/mcp`, label: 'MCP server' },
          ],
        ] as [string, Link[]],
      ]
    : []),
  ['Legal', LEGAL],
];

/** Every page's foot: the links, the policies the stores ask for, and the wordmark on the floor. */
export function SiteFooter() {
  return (
    <footer className="mt-32 overflow-hidden sm:mt-40">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div aria-hidden="true" className="bay-line" />
        <div className="grid grid-cols-2 gap-10 py-12 sm:flex sm:justify-between">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <Image src={logoMark} alt={BRAND} className="h-7 w-auto self-start" />
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
              The logbook for
              <br />
              everything you drive.
            </p>
          </div>
          {COLUMNS.map(([title, links]) => (
            <nav key={title} aria-label={title} className="flex flex-col gap-2.5 text-sm">
              <p className="text-label uppercase text-muted-foreground">{title}</p>
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="self-start font-semibold underline-offset-4 hover:underline"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          ))}
        </div>
      </div>
      <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pb-6 font-mono text-xs text-muted-foreground sm:px-6">
        <span>
          © {new Date().getFullYear()} {BRAND}
        </span>
        <span className="uppercase tracking-[0.16em]">Made for the long haul</span>
      </div>
      <p
        aria-hidden="true"
        className="wordmark -mb-[0.08em] mt-4 select-none text-center text-[clamp(5rem,26vw,22rem)] font-bold leading-[0.8] tracking-[-0.06em] text-border"
      >
        {[...BRAND].map((letter, i) => (
          <span key={i} className="inline-block" style={{ '--i': i } as CSSProperties}>
            {letter}
          </span>
        ))}
      </p>
    </footer>
  );
}
