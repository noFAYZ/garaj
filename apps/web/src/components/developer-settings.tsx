'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import type { CreatedApiKey } from '@vehicle-os/contracts';
import { apiKeysQuery, queryKeys } from '@vehicle-os/api-client/react';
import { api, API_URL } from '@/lib/api';
import { FormError } from '@/components/ui/modal';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button, Field } from '@/components/ui/primitives';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const MCP_URL = `${API_URL}/api/v1/mcp`;
const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3004';

const EXPIRY = [
  { value: 'never', label: 'Never expires' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

/** How each client connects, with the key filled in when there is one to fill in. */
function snippets(key: string) {
  return [
    {
      value: 'claude-code',
      label: 'Claude Code',
      code: `claude mcp add --transport http garaj ${MCP_URL} \\\n  --header "Authorization: Bearer ${key}"`,
    },
    {
      value: 'cursor',
      label: 'Cursor',
      code: JSON.stringify(
        { mcpServers: { garaj: { url: MCP_URL, headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
    },
    {
      value: 'desktop',
      label: 'Claude Desktop',
      code: JSON.stringify(
        {
          mcpServers: {
            garaj: {
              command: 'npx',
              args: ['-y', 'mcp-remote', MCP_URL, '--header', `Authorization: Bearer ${key}`],
            },
          },
        },
        null,
        2,
      ),
    },
    {
      value: 'curl',
      label: 'REST',
      code: `curl ${API_URL}/api/v1/vehicles \\\n  -H "Authorization: Bearer ${key}"`,
    },
  ];
}

/**
 * Settings → API & MCP: keys for scripts and AI clients, and how to connect them.
 *
 * A new key is shown in full once, straight into the connection snippets, because pasting it
 * into a client is the next thing anyone does with it. The list afterwards only ever shows the
 * start of each key. Revoking takes two presses, like every other destructive action.
 */
export function DeveloperSettings() {
  const queryClient = useQueryClient();
  const keys = useQuery(apiKeysQuery(api));
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [client, setClient] = useState('claude-code');
  const [confirming, setConfirming] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.apiKeys.create({
        name: name.trim(),
        ...(expiry === 'never' ? {} : { expiresInDays: Number(expiry) }),
      }),
    meta: { toast: 'API key created' },
    onSuccess: (key) => {
      setCreated(key);
      setName('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys() });
    },
  });

  const revoke = useMutation({
    mutationFn: (keyId: string) => api.apiKeys.revoke(keyId),
    meta: { toast: 'API key revoked' },
    onSuccess: (_, keyId) => {
      setConfirming(null);
      if (created?.id === keyId) setCreated(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys() });
    },
  });

  const shown = snippets(created?.token ?? '<your API key>');
  const snippet = shown.find((entry) => entry.value === client) ?? shown[0]!;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Let an AI assistant read your garage and log to it for you, or reach it from your own
        scripts. A key acts as you, in every garage you belong to — keep it like a password.{' '}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-foreground underline-offset-4 hover:underline"
        >
          Read the API docs
        </a>
      </p>

      <form
        className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="min-w-0 flex-1">
          <Field
            label="New key"
            placeholder="What it is for — Claude Desktop"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Select
          value={expiry}
          onValueChange={setExpiry}
          ariaLabel="Expires"
          options={EXPIRY}
          className="sm:w-40"
        />
        <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}>
          <KeyRound className="size-4" aria-hidden="true" />
          Create key
        </Button>
      </form>
      {create.isError ? <FormError>{(create.error as Error).message}</FormError> : null}

      {created ? (
        <div role="status" className="flex flex-col gap-2 rounded-2xl bg-warning-soft p-4">
          <p className="text-sm font-semibold text-foreground">
            Copy “{created.name}” now — it is not shown again.
          </p>
          <CopyLine value={created.token} label="Copy API key" />
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-label uppercase text-muted-foreground">Connect</p>
          <div
            role="group"
            aria-label="Client"
            className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted p-1 [scrollbar-width:none]"
          >
            {shown.map((entry) => (
              <button
                key={entry.value}
                type="button"
                aria-pressed={client === entry.value}
                onClick={() => setClient(entry.value)}
                className={cn(
                  'h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors',
                  client === entry.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <CopyLine value={MCP_URL} label="Copy MCP server URL" />
        <pre className="scrollbar-slim overflow-x-auto rounded-xl bg-background p-4 font-mono text-xs leading-relaxed text-foreground">
          {snippet.code}
        </pre>
        <CopyButton value={snippet.code} label={`Copy ${snippet.label} setup`} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-label uppercase text-muted-foreground">Your keys</p>
        {keys.isPending ? (
          <Skeleton className="h-14 w-full rounded-xl" />
        ) : !keys.data || keys.data.length === 0 ? (
          <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
            No keys yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {keys.data.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{key.name}</p>
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    {key.prefix}… · made {formatDate(key.createdAt)} ·{' '}
                    {key.lastUsedAt ? `used ${formatDate(key.lastUsedAt)}` : 'never used'}
                    {key.expiresAt ? ` · expires ${formatDate(key.expiresAt)}` : ''}
                  </p>
                </div>
                {confirming === key.id ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => setConfirming(null)}
                      disabled={revoke.isPending}
                    >
                      Keep it
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={revoke.isPending && revoke.variables === key.id}
                      onClick={() => revoke.mutate(key.id)}
                    >
                      Revoke key
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Revoke ${key.name}`}
                    onClick={() => setConfirming(key.id)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function useCopy(value: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ponytail: clipboard refused (insecure context); the value stays selectable on screen.
    }
  };
  return { copied, copy };
}

/** A value on one line in mono, with a copy button at its end. */
function CopyLine({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy(value);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-background py-1 pl-4 pr-1">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{value}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? 'Copied' : label}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy(value);
  return (
    <Button size="sm" className="self-start" onClick={() => void copy()} aria-live="polite">
      {copied ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      {copied ? 'Copied' : label}
    </Button>
  );
}
