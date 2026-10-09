/**
 * MCP: Garaj as a set of tools an AI client can call (Model Context Protocol, Streamable HTTP).
 *
 * Stateless. Every POST builds a server, answers the JSON-RPC message in it, and is done — no
 * session to keep, nothing held between requests, so it scales like any other route and survives
 * a restart mid-conversation. `enableJsonResponse` answers with plain JSON rather than an SSE
 * stream: every tool is one request and one reply, and there is nothing to stream.
 *
 * Authentication is the API's own: a personal API key (`Authorization: Bearer gk_…`) or a
 * session. Each tool call is replayed into the REST route it names through `inject`, carrying the
 * caller's credentials, so the tool is exactly as allowed as that route is for that person.
 */

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '@vehicle-os/config';
import { INSTRUCTIONS, TOOLS } from './tools';

/** Past this, a reply is cut: a model reads a summary better than a wall, and tokens cost. */
const MAX_RESULT_CHARS = 60_000;

function buildServer(fastify: FastifyInstance, request: FastifyRequest): Server {
  const server = new Server(
    { name: 'garaj', title: 'Garaj', version: '1.0.0' },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: 'object' },
      annotations: {
        title: tool.title,
        readOnlyHint: tool.readOnly,
        destructiveHint: false,
        openWorldHint: false,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (call) => {
    const tool = TOOLS.find((candidate) => candidate.name === call.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${call.params.name}` }],
      };
    }
    const target = tool.route((call.params.arguments ?? {}) as Record<string, unknown>);

    const response = await fastify.inject({
      method: target.method,
      url: `/api/v1${target.url}`,
      headers: {
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
        // The caller's address, not this process's: the rate limit and the audit log read it.
        'x-forwarded-for': request.ip,
        ...(target.body ? { 'content-type': 'application/json' } : {}),
      },
      payload: target.body ? JSON.stringify(target.body) : undefined,
    });

    const text =
      response.body.length > MAX_RESULT_CHARS
        ? `${response.body.slice(0, MAX_RESULT_CHARS)}\n… (truncated — narrow the request, e.g. a smaller limit)`
        : response.body || '{}';

    if (response.statusCode >= 400) {
      // The API's own error, word for word: it names the field or the permission that failed.
      let message = text;
      try {
        const parsed = JSON.parse(response.body) as {
          error?: { message?: string; fields?: unknown };
        };
        if (parsed.error?.message) {
          message = parsed.error.fields
            ? `${parsed.error.message} ${JSON.stringify(parsed.error.fields)}`
            : parsed.error.message;
        }
      } catch {
        // ponytail: a non-JSON error body is passed through as it came.
      }
      return {
        isError: true,
        content: [{ type: 'text', text: `${response.statusCode}: ${message}` }],
      };
    }
    return { content: [{ type: 'text', text }] };
  });

  return server;
}

export const mcpRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post(
    '/',
    // JSON-RPC, not REST: documented on its own page rather than as one opaque operation here.
    { schema: { hide: true } },
    async (request, reply) => {
      if (!request.actor) {
        reply.header('www-authenticate', 'Bearer realm="garaj", error="invalid_token"');
        return reply.status(401).send({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message:
              'Authentication required. Send a Garaj API key as "Authorization: Bearer gk_…" — create one in Settings → API & MCP.',
          },
          id: null,
        });
      }

      const server = buildServer(fastify, request);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);

      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
      }
      try {
        const response = await transport.handleRequest(
          new Request(new URL(request.url, env().AUTH_URL), {
            method: 'POST',
            headers,
            body: JSON.stringify(request.body ?? {}),
          }),
          { parsedBody: request.body },
        );
        reply.status(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));
        return reply.send(response.body ? await response.text() : null);
      } finally {
        await server.close();
      }
    },
  );

  // Stateless: there is no stream to open and no session to end.
  const notAllowed = async (_: FastifyRequest, reply: FastifyReply) => {
    reply.header('allow', 'POST');
    return reply.status(405).send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This server is stateless; POST only.' },
      id: null,
    });
  };
  fastify.get('/', { schema: { hide: true } }, notAllowed);
  fastify.delete('/', { schema: { hide: true } }, notAllowed);

  fastify.get(
    '/tools',
    {
      schema: {
        tags: ['mcp'],
        summary: 'The MCP tools this server offers',
        description:
          'Public: the same catalogue an MCP client receives from `tools/list`, for documentation. Calling a tool needs an API key.',
        security: [],
        response: {
          200: Type.Array(
            Type.Object({
              name: Type.String(),
              title: Type.String(),
              description: Type.String(),
              readOnly: Type.Boolean(),
              inputSchema: Type.Unknown(),
            }),
          ),
        },
      },
    },
    async () =>
      TOOLS.map(({ name, title, description, readOnly, inputSchema }) => ({
        name,
        title,
        description,
        readOnly,
        inputSchema,
      })),
  );
};
