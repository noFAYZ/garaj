import type { Metadata } from 'next';
import { Eye, PencilLine } from 'lucide-react';
import { CodeBlock, SnippetTabs } from '../../components/code';
import { Callout, PageHead, Prose, Section, Unavailable } from '../../components/page';
import { Rich } from '../../components/rich';
import { SchemaTree } from '../../components/schema';
import { APP_URL, MCP_URL, loadTools, type McpTool } from '../../lib/openapi';

export const metadata: Metadata = { title: 'MCP for AI' };
export const revalidate = 300;

const KEY = 'gk_your_key';

const SETUP = [
  {
    value: 'claude-code',
    label: 'Claude Code',
    note: 'One command, then /mcp in a session to check it is connected.',
    code: `claude mcp add --transport http garaj ${MCP_URL} \\\n  --header "Authorization: Bearer ${KEY}"`,
  },
  {
    value: 'cursor',
    label: 'Cursor',
    note: 'In ~/.cursor/mcp.json, or .cursor/mcp.json in a project.',
    code: JSON.stringify(
      { mcpServers: { garaj: { url: MCP_URL, headers: { Authorization: `Bearer ${KEY}` } } } },
      null,
      2,
    ),
  },
  {
    value: 'vscode',
    label: 'VS Code',
    note: 'In .vscode/mcp.json, for Copilot agent mode.',
    code: JSON.stringify(
      { servers: { garaj: { type: 'http', url: MCP_URL, headers: { Authorization: `Bearer ${KEY}` } } } },
      null,
      2,
    ),
  },
  {
    value: 'desktop',
    label: 'Claude Desktop',
    note: 'In claude_desktop_config.json. mcp-remote bridges the desktop app to a remote server with a header.',
    code: JSON.stringify(
      {
        mcpServers: {
          garaj: {
            command: 'npx',
            args: ['-y', 'mcp-remote', MCP_URL, '--header', `Authorization: Bearer ${KEY}`],
          },
        },
      },
      null,
      2,
    ),
  },
];

const PROMPTS = [
  'What is due on my cars in the next month?',
  'Log a fill-up on the M3: 52 litres, €96.40 at Shell, odometer 36,900.',
  'How much has the 911 cost me this year, and on what?',
  'Is my fuel consumption getting worse?',
  'Mark "book the MOT" as done.',
];

function ToolCard({ tool }: { tool: McpTool }) {
  return (
    <li className="rounded-2xl bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-sm font-semibold text-foreground">{tool.name}</code>
        <span className="text-sm text-muted-foreground">{tool.title}</span>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        <Rich text={tool.description} />
      </p>
      {Object.keys(tool.inputSchema.properties ?? {}).length > 0 ? (
        <details className="group mt-3 rounded-xl bg-background">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-foreground">
            Inputs · {Object.keys(tool.inputSchema.properties ?? {}).length}
            <span className="text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="px-3 pb-3">
            <SchemaTree schema={tool.inputSchema} />
          </div>
        </details>
      ) : null}
    </li>
  );
}

export default async function Mcp() {
  const tools = await loadTools();

  return (
    <div className="flex flex-col gap-12">
      <PageHead
        eyebrow="Guides · MCP for AI"
        title="Talk to your garage"
        lead="Garaj is a Model Context Protocol server. Connect Claude, Cursor or any MCP client, and ask about your vehicles in plain words — or have it log a fill-up for you."
      />

      <Section title="The server" id="server">
        <dl className="grid gap-px overflow-hidden rounded-2xl bg-border/60 sm:grid-cols-3">
          {[
            ['URL', MCP_URL],
            ['Transport', 'Streamable HTTP, stateless'],
            ['Auth', 'Authorization: Bearer gk_…'],
          ].map(([term, value]) => (
            <div key={term} className="bg-card p-4">
              <dt className="text-label uppercase text-muted-foreground">{term}</dt>
              <dd className="mt-1 break-all font-mono text-[0.8125rem] text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <Prose>
          <p>
            Create a key in{' '}
            <a href={`${APP_URL}/settings`} className="font-semibold text-foreground underline-offset-4 hover:underline">
              Settings → API &amp; MCP
            </a>{' '}
            — the settings page fills your key into these snippets for you.
          </p>
        </Prose>
      </Section>

      <Section title="Connect a client" id="connect">
        <SnippetTabs snippets={SETUP} />
      </Section>

      <Section title="Things to ask" id="prompts">
        <ul className="flex flex-col gap-2">
          {PROMPTS.map((prompt) => (
            <li key={prompt} className="rounded-xl bg-card/60 px-4 py-3 text-sm text-foreground">
              “{prompt}”
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Tools" id="tools">
        {!tools.ok ? (
          <Unavailable reason={tools.reason} />
        ) : (
          <div className="flex flex-col gap-8">
            {[
              { title: 'Read', icon: Eye, list: tools.value.filter((tool) => tool.readOnly) },
              { title: 'Record', icon: PencilLine, list: tools.value.filter((tool) => !tool.readOnly) },
            ].map(({ title, icon: Glyph, list }) => (
              <div key={title} className="flex flex-col gap-3">
                <p className="flex items-center gap-2 text-label uppercase text-muted-foreground">
                  <Glyph className="size-3.5" aria-hidden="true" />
                  {title} · {String(list.length).padStart(2, '0')}
                </p>
                <ul className="grid gap-3 lg:grid-cols-2">
                  {list.map((tool) => (
                    <ToolCard key={tool.name} tool={tool} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="What it can and cannot do" id="safety">
        <Callout>
          The assistant acts as you, through the same routes as the app: your role in each garage,
          your plan&apos;s limits and the audit log all apply. It can read everything you can and record
          entries, expenses, services and tasks — but no tool deletes anything. Revoke its key and it
          stops at once.
        </Callout>
      </Section>

      <Section title="Under the hood" id="protocol">
        <Prose>
          <p>
            Any client that speaks MCP over HTTP works. The server answers JSON-RPC on{' '}
            <code>POST</code> with plain JSON responses and keeps no session between requests.
          </p>
        </Prose>
        <CodeBlock
          code={`curl -X POST ${MCP_URL} \\
  -H "Authorization: Bearer $GARAJ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_vehicles","arguments":{}}}'`}
          label="curl"
        />
      </Section>
    </div>
  );
}
