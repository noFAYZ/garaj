/**
 * The API's own OpenAPI document, read from the running API.
 *
 * Generated there from the TypeBox schemas every route validates against, so what is documented
 * here is what the server accepts — no hand-kept copy to fall behind. Re-read every five minutes;
 * a page that cannot reach the API says so instead of showing a stale guess.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
export const MCP_URL = `${API_URL}/api/v1/mcp`;

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export const METHODS: readonly Method[] = ['get', 'post', 'put', 'patch', 'delete'];

export interface Schema {
  type?: string | string[];
  format?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  allOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | Schema;
}

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: Schema;
}

export interface Operation {
  method: Method;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>;
  security?: unknown[];
}

export interface Tag {
  name: string;
  description?: string;
}

export interface Spec {
  info: { title: string; version: string; description?: string };
  tags?: Tag[];
  paths: Record<string, Partial<Record<Method, Omit<Operation, 'method' | 'path'>>>>;
}

export type Loaded<T> = { ok: true; value: T } | { ok: false; reason: string };

async function load<T>(path: string): Promise<Loaded<T>> {
  try {
    const response = await fetch(`${API_URL}${path}`, { next: { revalidate: 300 } });
    if (!response.ok) return { ok: false, reason: `The API answered ${response.status}.` };
    return { ok: true, value: (await response.json()) as T };
  } catch {
    return { ok: false, reason: `The API at ${API_URL} could not be reached.` };
  }
}

export const loadSpec = () => load<Spec>('/api/v1/openapi.json');

export interface McpTool {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  inputSchema: Schema;
}

export const loadTools = () => load<McpTool[]>('/api/v1/mcp/tools');

/** Internal areas the public docs leave out. */
const HIDDEN_TAGS = new Set(['admin']);

/** Every documented operation, grouped under its first tag, in the spec's tag order. */
export function chapters(spec: Spec): { tag: Tag; slug: string; operations: Operation[] }[] {
  const byTag = new Map<string, Operation[]>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const tag = operation.tags?.[0] ?? 'other';
      if (HIDDEN_TAGS.has(tag)) continue;
      byTag.set(tag, [...(byTag.get(tag) ?? []), { ...operation, method, path }]);
    }
  }
  const order = (spec.tags ?? []).map((tag) => tag.name);
  const names = [...byTag.keys()].sort(
    (a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999),
  );
  return names.map((name) => ({
    tag: spec.tags?.find((tag) => tag.name === name) ?? { name },
    slug: name,
    operations: byTag.get(name)!,
  }));
}

/** A path as it is read, without the version prefix and trailing slash every route shares. */
export const displayPath = (path: string) => path.replace(/\/$/, '') || '/';

/** A stable anchor for one operation: `get-vehicles-vehicleid`. */
export const anchorOf = (operation: Pick<Operation, 'method' | 'path'>) =>
  `${operation.method}-${operation.path
    .replace(/^\/api\/v1\//, '')
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+$/, '')
    .toLowerCase()}`;

export const titleOf = (name: string) =>
  name
    .split('-')
    .map((word) => (word === 'api' || word === 'mcp' || word === 'ai' ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ');
