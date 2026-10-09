import type { ReactNode } from 'react';

/** A page's heading: a mono eyebrow, the title, and the one sentence that says what it is for. */
export function PageHead({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: ReactNode }) {
  return (
    <header className="flex animate-rise flex-col gap-3">
      <p className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {eyebrow}
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h1>
      <p className="max-w-2xl text-base text-muted-foreground">{lead}</p>
    </header>
  );
}

export function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="flex scroll-mt-20 flex-col gap-4">
      <h2 id={id ? `${id}-title` : undefined} className="text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A numbered step, set as the house sets steps: a mono number, then what to do. */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3">
      <span className="font-mono text-sm font-bold tabular-nums text-muted-foreground">
        {String(n).padStart(2, '0')}
      </span>
      <div className="flex min-w-0 flex-col gap-3 pb-6">
        <p className="font-semibold text-foreground">{title}</p>
        {children}
      </div>
    </li>
  );
}

export function Callout({ tone = 'note', children }: { tone?: 'note' | 'warning'; children: ReactNode }) {
  return (
    <div
      className={
        tone === 'warning'
          ? 'rounded-2xl bg-warning-soft p-4 text-sm text-foreground'
          : 'rounded-2xl bg-card/60 p-4 text-sm text-muted-foreground'
      }
    >
      {children}
    </div>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3 text-sm leading-relaxed text-muted-foreground [&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8125rem] [&_code]:text-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
      {children}
    </div>
  );
}

export function Unavailable({ reason }: { reason: string }) {
  return (
    <div className="rounded-2xl bg-destructive-soft p-5">
      <p className="font-semibold text-foreground">The reference could not be loaded</p>
      <p className="mt-1 text-sm text-destructive">{reason}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        It is read live from the API, so it is always what the server accepts. Start the API, then
        reload.
      </p>
    </div>
  );
}
