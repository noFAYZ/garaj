import type { ReactNode } from 'react';

/** Where privacy questions and deletion requests go. The one address on these pages. */
export const CONTACT_EMAIL = 'support@garaj.app';

/**
 * A page of policy: one readable column, its title and the date it last changed, and the way
 * back. Plain on purpose — these are read by store reviewers and by someone deciding whether
 * to trust the product, and neither wants the landing page's theatre.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
      <a href="/" className="text-sm font-semibold underline-offset-4 hover:underline">
        ← Garaj
      </a>
      <h1 className="mt-8 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
        Last updated {updated}
      </p>
      <div className="legal mt-10 flex flex-col gap-4 text-[15px] leading-relaxed text-muted-foreground [&_a]:font-semibold [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-foreground">
        {children}
      </div>
    </main>
  );
}
