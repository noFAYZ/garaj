import type { Metadata, Viewport } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Urbanist } from 'next/font/google';
import type { ReactNode } from 'react';
import { ArrowUpRight, BookOpen, Bot, KeyRound, TriangleAlert } from 'lucide-react';
import { THEME_COLORS, THEME_SCRIPT } from '@/lib/settings/theme-script';
import { buttonClass } from '@/components/ui/button-class';
import logoText from '@/public/logo-text.png';
import logoTextLight from '@/public/logo-text-light.png';
import { NavLink } from '../components/code';
import { APP_URL, chapters, loadSpec, titleOf } from '../lib/openapi';
import './globals.css';

const urbanist = Urbanist({ subsets: ['latin'], variable: '--font-urbanist', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3004'),
  title: { default: 'Garaj API', template: '%s · Garaj API' },
  description:
    'The Garaj REST API and MCP server: read and record your vehicles from your own code or from an AI assistant.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
};

const GUIDES = [
  { href: '/', label: 'Introduction', icon: BookOpen },
  { href: '/authentication', label: 'Authentication', icon: KeyRound },
  { href: '/errors', label: 'Errors and limits', icon: TriangleAlert },
  { href: '/mcp', label: 'MCP for AI', icon: Bot },
];

/** The contents: the guides, then one chapter per area of the API, from the spec's own tags. */
function Contents({ reference }: { reference: { slug: string; name: string; count: number }[] }) {
  return (
    <nav aria-label="Documentation" className="flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <p className="mb-1 px-2.5 text-label uppercase text-muted-foreground">Guides</p>
        {GUIDES.map(({ href, label, icon: Glyph }) => (
          <NavLink key={href} href={href}>
            <Glyph className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="mb-1 px-2.5 text-label uppercase text-muted-foreground">API reference</p>
        <NavLink href="/reference">All endpoints</NavLink>
        {reference.map((chapter) => (
          <NavLink key={chapter.slug} href={`/reference/${chapter.slug}`}>
            <span className="flex-1">{chapter.name}</span>
            <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
              {String(chapter.count).padStart(2, '0')}
            </span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const spec = await loadSpec();
  const reference = spec.ok
    ? chapters(spec.value).map((chapter) => ({
        slug: chapter.slug,
        name: titleOf(chapter.tag.name),
        count: chapter.operations.length,
      }))
    : [];

  return (
    <html lang="en" data-theme="dark" className={urbanist.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
            <Link href="/" aria-label="Garaj API home" className="flex items-center gap-2.5">
              <Image src={logoText} alt="" priority className="h-6 w-auto dark:hidden" />
              <Image src={logoTextLight} alt="" priority className="hidden h-6 w-auto dark:block" />
              <span className="rounded-full bg-card px-2 py-0.5 font-mono text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
                API
              </span>
            </Link>
            <div className="ml-auto flex items-center gap-1">
              <Link href="/reference" className={buttonClass('ghost', 'sm', 'hidden sm:inline-flex')}>
                Reference
              </Link>
              <Link href="/mcp" className={buttonClass('ghost', 'sm', 'hidden sm:inline-flex')}>
                MCP
              </Link>
              <a href={APP_URL} className={buttonClass('primary', 'sm')}>
                Open Garaj
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-4 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
          {/* On a phone the contents fold into one row above the page; wide, they stand beside it. */}
          <details className="group mt-4 rounded-2xl bg-card/60 lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-foreground">
              Contents
              <span className="text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <div className="px-2 pb-3">
              <Contents reference={reference} />
            </div>
          </details>
          <aside className="hidden lg:block">
            <div className="scrollbar-slim sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-8">
              <Contents reference={reference} />
            </div>
          </aside>
          <main className="min-w-0 py-8 lg:py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
