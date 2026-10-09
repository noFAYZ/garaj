import Link from 'next/link';
import { ArrowRight, Bot, Braces, KeyRound } from 'lucide-react';
import { CodeBlock } from '../components/code';
import { PageHead, Prose, Section, Step } from '../components/page';
import { API_URL, APP_URL } from '../lib/openapi';

const DOORS = [
  {
    href: '/authentication',
    icon: KeyRound,
    title: 'Get a key',
    body: 'One personal API key reads and records everything you can in the app.',
  },
  {
    href: '/mcp',
    icon: Bot,
    title: 'Connect an AI',
    body: 'Claude, Cursor and any MCP client can read your garage and log to it for you.',
  },
  {
    href: '/reference',
    icon: Braces,
    title: 'Browse the API',
    body: 'Every endpoint, read live from the server — what is documented is what it accepts.',
  },
];

export default function Introduction() {
  return (
    <div className="flex flex-col gap-12">
      <PageHead
        eyebrow="Garaj API · v1"
        title="Your garage, from your own code"
        lead="Read every vehicle's record — services, costs, value, what is due — and add to it, from a script, an integration or an AI assistant. The same API the Garaj apps are built on."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {DOORS.map(({ href, icon: Glyph, title, body }, index) => (
          <Link
            key={href}
            href={href}
            style={{ '--i': index } as React.CSSProperties}
            className="group stagger flex animate-rise flex-col gap-3 rounded-2xl bg-card/60 p-5 transition-[background-color,translate] hover:-translate-y-0.5 hover:bg-card"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-muted text-foreground">
              <Glyph className="size-5" aria-hidden="true" />
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              {title}
              <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-[opacity,translate] group-hover:translate-x-0 group-hover:opacity-100" aria-hidden="true" />
            </span>
            <span className="text-sm text-muted-foreground">{body}</span>
          </Link>
        ))}
      </div>

      <Section title="Quickstart" id="quickstart">
        <ol className="flex flex-col">
          <Step n={1} title="Create a key">
            <Prose>
              <p>
                In Garaj, open <strong>Settings → API &amp; MCP</strong> and create a key. It is shown
                once — copy it into your environment:
              </p>
            </Prose>
            <CodeBlock code={'export GARAJ_API_KEY="gk_…"'} label="shell" />
            <a href={`${APP_URL}/settings`} className="w-fit text-sm font-semibold text-foreground underline-offset-4 hover:underline">
              Open settings →
            </a>
          </Step>
          <Step n={2} title="Read your vehicles">
            <CodeBlock
              code={`curl ${API_URL}/api/v1/vehicles \\\n  -H "Authorization: Bearer $GARAJ_API_KEY"`}
              label="curl"
            />
          </Step>
          <Step n={3} title="Record something">
            <Prose>
              <p>
                A fill-up, with what it cost and where the odometer stood. Money is sent in minor
                units — <code>7840</code> is 78.40.
              </p>
            </Prose>
            <CodeBlock
              code={`curl -X POST ${API_URL}/api/v1/vehicles/<vehicleId>/events \\
  -H "Authorization: Bearer $GARAJ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "eventType": "FUEL",
    "title": "Filled up",
    "occurredAt": "2026-09-23T09:30:00.000Z",
    "odometer": 36900,
    "costAmountMinor": 7840,
    "costCurrency": "EUR"
  }'`}
              label="curl"
            />
          </Step>
        </ol>
      </Section>

      <Section title="Conventions" id="conventions">
        <dl className="grid gap-px overflow-hidden rounded-2xl bg-border/60 sm:grid-cols-2">
          {[
            ['Base URL', `${API_URL}/api/v1`],
            ['Format', 'JSON in, JSON out; UTF-8'],
            ['Dates', 'ISO 8601 — 2026-09-23T09:30:00.000Z, or 2026-09-23 for a day'],
            ['Money', 'Integer minor units with an ISO 4217 code — 7840 + EUR'],
            ['Distance', "In the vehicle's own unit, its odometerUnit (KM or MI)"],
            ['Ids', 'UUIDv7 — sortable by creation time'],
            ['Lists', 'limit (max 100) and cursor; follow pagination.nextCursor'],
            ['Retries', 'Creates take an optional id you choose: send it twice, get one record'],
          ].map(([term, value]) => (
            <div key={term} className="bg-card p-4">
              <dt className="text-label uppercase text-muted-foreground">{term}</dt>
              <dd className="mt-1 break-words font-mono text-[0.8125rem] text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
