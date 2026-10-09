'use client';

import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

function useCopy(value: string) {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async () => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        // ponytail: clipboard refused (insecure context); the code stays selectable.
      }
    },
  };
}

/** Code as it is pasted: mono, scrollable sideways, copied whole by one press. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const { copied, copy } = useCopy(code);
  return (
    <div className="overflow-hidden rounded-2xl bg-background ring-1 ring-inset ring-border">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2">
        <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
          {label ?? 'Example'}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? 'Copied' : `Copy ${label ?? 'code'}`}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <pre className="scrollbar-slim overflow-x-auto p-4 font-mono text-[0.8125rem] leading-relaxed text-foreground">
        {code}
      </pre>
    </div>
  );
}

/** One snippet per client or language, a pill track to switch between them. */
export function SnippetTabs({
  snippets,
}: {
  snippets: readonly { value: string; label: string; code: string; note?: string }[];
}) {
  const [active, setActive] = useState(snippets[0]!.value);
  const current = snippets.find((snippet) => snippet.value === active) ?? snippets[0]!;
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Client" className="flex w-fit flex-wrap gap-1 rounded-full bg-card p-1">
        {snippets.map((snippet) => (
          <button
            key={snippet.value}
            type="button"
            aria-pressed={snippet.value === active}
            onClick={() => setActive(snippet.value)}
            className={cn(
              'h-8 rounded-full px-3.5 text-sm font-semibold transition-colors',
              snippet.value === active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {snippet.label}
          </button>
        ))}
      </div>
      {current.note ? <p className="text-sm text-muted-foreground">{current.note}</p> : null}
      <CodeBlock code={current.code} label={current.label} />
    </div>
  );
}

/** A sidebar link that knows when it is the page being read. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
        active
          ? 'bg-primary-soft font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}

const METHOD_TONE: Record<string, string> = {
  get: 'bg-success-soft text-success',
  post: 'bg-primary-soft text-foreground',
  put: 'bg-warning-soft text-warning',
  patch: 'bg-warning-soft text-warning',
  delete: 'bg-destructive-soft text-destructive',
};

/** The HTTP method as a badge, each on its own soft tint so a column of them scans by kind. */
export function MethodBadge({ method, small = false }: { method: string; small?: boolean }) {
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-md font-mono font-bold uppercase',
        small ? 'h-5 w-12 text-[0.625rem]' : 'h-6 w-16 text-[0.6875rem]',
        METHOD_TONE[method] ?? 'bg-muted text-foreground',
      )}
    >
      {method}
    </span>
  );
}
