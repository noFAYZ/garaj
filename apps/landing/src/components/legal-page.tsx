import type { ReactNode } from 'react';
import { LEGAL, LEGAL_UPDATED } from '../site';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

/**
 * A page of policy: the site's header and footer round one readable column — its title, the date
 * it last changed, and the other policies at its foot. Plain on purpose: these are read by store
 * reviewers and by someone deciding whether to trust the product.
 */
export function LegalPage({
  title,
  intro,
  path,
  children,
}: {
  title: string;
  /** One line under the title: what the page is for. */
  intro: string;
  /** This page's own path, left out of the links to the others. */
  path: string;
  children: ReactNode;
}) {
  return (
    <div className="grain-page min-h-dvh overflow-x-clip bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 pb-8 pt-32 sm:px-6 sm:pt-[9.5rem]">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-primary">
          Last updated {LEGAL_UPDATED}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{title}</h1>
        <p className="mt-4 text-pretty text-lg text-muted-foreground">{intro}</p>
        <div className="legal mt-10 flex flex-col gap-4 text-[15px] leading-relaxed text-muted-foreground [&_a]:font-semibold [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-8 [&_h2]:scroll-mt-24 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-2 [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ol>li]:list-decimal [&_strong]:text-foreground [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
          {children}
        </div>
        <nav
          aria-label="Policies"
          className="mt-16 flex flex-wrap gap-2 border-t border-border pt-8 text-sm"
        >
          {LEGAL.filter((link) => link.href !== path).map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full bg-muted px-4 py-2 font-semibold transition-colors hover:bg-border"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </main>
      <SiteFooter />
    </div>
  );
}
