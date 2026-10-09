import type { Metadata } from 'next';
import { CodeBlock } from '../../components/code';
import { PageHead, Prose, Section } from '../../components/page';

export const metadata: Metadata = { title: 'Errors and limits' };

const STATUSES = [
  ['400', 'VALIDATION_ERROR', 'The body or a parameter is wrong. `fields` names each one and why.'],
  ['401', 'UNAUTHORIZED', 'No key, an unknown key, or a revoked or expired one.'],
  ['402', 'PLAN_REQUIRED', 'Your plan does not include this. The body names the cheapest plan that does.'],
  ['403', 'FORBIDDEN', 'Your role in this garage does not allow it — or a key tried to manage keys.'],
  ['404', '…_NOT_FOUND', 'No such thing — or it is in a garage you are not in. The two answer alike.'],
  ['409', 'PLAN_LIMIT, CONFLICT', 'A limit is reached, or the change conflicts with the current state.'],
  ['429', 'RATE_LIMITED', 'Too many requests. The message says when to retry.'],
  ['500', 'INTERNAL_ERROR', 'Our fault. Send the requestId if you contact support.'],
];

export default function Errors() {
  return (
    <div className="flex flex-col gap-12">
      <PageHead
        eyebrow="Guides · Errors and limits"
        title="When a request fails"
        lead="Every error has the same shape: a stable code to branch on, a sentence for a person, and the request's id for tracing it."
      />

      <Section title="The error body" id="shape">
        <CodeBlock
          code={`{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "requestId": "01a0cc2e-5d1b-7c6a-9f3e-2b8d4c1a7e90",
    "fields": { "title": "must have required property 'title'" }
  }
}`}
          label="JSON"
        />
        <Prose>
          <p>
            Branch on <code>code</code>, show <code>message</code>, log <code>requestId</code>. The
            HTTP status and the code always agree.
          </p>
        </Prose>
      </Section>

      <Section title="Status codes" id="codes">
        <div className="scrollbar-slim overflow-x-auto rounded-2xl bg-card/60">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-border/60">
              {STATUSES.map(([status, code, meaning]) => (
                <tr key={status}>
                  <td className="whitespace-nowrap px-4 py-3 font-mono font-bold text-foreground">{status}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">{code}</td>
                  <td className="px-4 py-3 text-muted-foreground">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Rate limits" id="limits">
        <Prose>
          <p>
            <strong>300 requests a minute</strong>, counted per caller. Past it the API answers{' '}
            <code>429</code> until the minute turns. A script that pages through a long history
            should follow the cursor rather than fan out in parallel.
          </p>
        </Prose>
      </Section>

      <Section title="Pagination" id="pagination">
        <Prose>
          <p>
            Lists take <code>limit</code> (default 25, at most 100) and <code>cursor</code>, and
            answer with the page and where the next one starts. Keep asking with{' '}
            <code>nextCursor</code> until <code>hasMore</code> is false.
          </p>
        </Prose>
        <CodeBlock
          code={`{
  "data": [ … ],
  "pagination": { "nextCursor": "eyJpZCI6…", "hasMore": true }
}`}
          label="JSON"
        />
      </Section>

      <Section title="Safe retries" id="retries">
        <Prose>
          <p>
            Creating an entry, an expense or a task accepts an optional <code>id</code> — a UUIDv7
            you generate. Send the same id twice and there is one record, so a request that timed out
            can simply be sent again.
          </p>
        </Prose>
      </Section>
    </div>
  );
}
