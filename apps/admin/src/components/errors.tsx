import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ago, fullStamp } from '../lib/format';
import { CopyButton } from './ui';

export interface Failure {
  at: string | null;
  message: string | null;
  who?: string | null;
  /** A short label for where it came from: "Email · Recall", "notifications · deliver". */
  source?: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * What makes two failures the same failure: the message, with the parts that differ every time
 * (ids, long quoted values) worn away. Status codes stay — a 429 and a 503 are different news.
 */
export const fingerprint = (message: string | null) =>
  (message ?? 'No reason recorded')
    .replace(UUID, '<id>')
    .replace(/"[^"]{24,}"/g, '"…"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);

interface Group {
  key: string;
  message: string;
  count: number;
  latest: Failure;
  all: Failure[];
}

export function groupFailures(rows: readonly Failure[]): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = `${row.source ?? ''}|${fingerprint(row.message)}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.all.push(row);
    } else {
      groups.set(key, {
        key,
        message: row.message ?? 'No reason recorded',
        count: 1,
        latest: row,
        all: [row],
      });
    }
  }
  return [...groups.values()];
}

/**
 * Failures as their distinct causes, most recent first: the same 429 three times is one row that
 * says ×3, and opening it shows the whole message and each time it happened.
 */
export function FailureGroups({ rows, empty }: { rows: readonly Failure[]; empty: ReactNode }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {groupFailures(rows).map((group) => (
        <li key={group.key}>
          <details className="group/failure rounded-xl bg-destructive-soft">
            <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl p-3 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="mt-0.5 size-4 shrink-0 text-destructive transition-transform group-open/failure:rotate-90"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 break-words font-mono text-xs text-destructive">
                  {group.message}
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {[group.latest.source, group.latest.who, group.latest.at && ago(group.latest.at)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {group.count > 1 ? (
                <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-destructive-foreground">
                  ×{group.count}
                </span>
              ) : null}
            </summary>
            <div className="flex flex-col gap-2 px-3 pb-3 pl-10">
              <div className="relative">
                <pre className="scrollbar-slim max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-card p-3 pr-10 font-mono text-xs text-foreground">
                  {group.message}
                </pre>
                <CopyButton
                  value={group.message}
                  label="Copy the message"
                  className="absolute right-1.5 top-1.5"
                />
              </div>
              <ul
                className={cn(
                  'flex flex-col gap-0.5',
                  group.all.length > 1 && 'border-l border-border pl-3',
                )}
              >
                {group.all.slice(0, 8).map((row, i) => (
                  <li key={i} className="flex justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{row.who ?? 'No account'}</span>
                    {row.at ? (
                      <time dateTime={row.at} title={fullStamp(row.at)} className="shrink-0">
                        {ago(row.at)}
                      </time>
                    ) : null}
                  </li>
                ))}
                {group.all.length > 8 ? (
                  <li className="text-xs text-muted-foreground">and {group.all.length - 8} more</li>
                ) : null}
              </ul>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
