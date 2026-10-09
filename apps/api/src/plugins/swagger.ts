/**
 * OpenAPI (Architecture.md §10, §100).
 *
 * Generated from the TypeBox schemas already attached to each route, so the document
 * cannot drift from what the server actually validates. `packages/api-client` is generated
 * from this output, which is what keeps web, mobile and API on one set of types.
 */

import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env, isProduction } from '@vehicle-os/config';

export default fp(
  async (fastify) => {
    await fastify.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Garaj API',
          description: 'REST API for the Garaj digital garage.',
          version: '1.0.0',
        },
        servers: [{ url: env().AUTH_URL, description: 'Current environment' }],
        components: {
          securitySchemes: {
            /*
             * What an integration or an AI client sends: a personal API key from Settings →
             * API & MCP. The app's own session token also works here.
             */
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              description: 'A personal API key (`gk_…`), or a session token.',
            },
            sessionCookie: {
              type: 'apiKey',
              in: 'cookie',
              name: 'better-auth.session_token',
            },
          },
        },
        security: [{ bearerAuth: [] }, { sessionCookie: [] }],
        // Named and described once here, so the docs site can present each area as a chapter.
        tags: [
          { name: 'vehicles', description: 'The vehicles in your garages, and what each one is.' },
          {
            name: 'garages',
            description: 'Garages group vehicles and the people they are shared with.',
          },
          {
            name: 'events',
            description: 'What happened to a vehicle: fill-ups, services, repairs, trips, notes.',
          },
          {
            name: 'activity',
            description: 'The timeline: what is planned and what was done, in one feed.',
          },
          {
            name: 'maintenance',
            description: 'Repeating services with live due status, and the service history.',
          },
          {
            name: 'expenses',
            description: 'Money spent, costs, monthly spend, trends and fuel prices.',
          },
          { name: 'income', description: 'What a vehicle earns, against what it costs.' },
          {
            name: 'valuations',
            description: 'What a vehicle is worth, and what it has been worth.',
          },
          { name: 'health', description: 'A score out of 100 with the reasons for it.' },
          { name: 'condition', description: 'Condition assessments, by category.' },
          {
            name: 'documents',
            description: 'Insurance, registration and other papers, with expiry.',
          },
          { name: 'photos', description: 'The gallery, uploaded straight to storage.' },
          { name: 'tasks', description: 'One-off jobs, with due dates and priorities.' },
          { name: 'notifications', description: 'What the app tells you, and where.' },
          { name: 'sharing', description: 'Share links and the public vehicle passport.' },
          { name: 'transfer', description: 'Export a history, or import a log from another app.' },
          { name: 'search', description: 'Everything you can see, by text.' },
          { name: 'dashboard', description: 'The home screen, in one response.' },
          { name: 'users', description: 'You: profile, preferences, plan and capabilities.' },
          {
            name: 'api-keys',
            description: 'Personal API keys, for scripts, integrations and AI clients.',
          },
          { name: 'mcp', description: 'The Model Context Protocol server for AI clients.' },
          { name: 'ai', description: 'Ask questions about your vehicles.' },
          { name: 'billing', description: 'Plans and checkout.' },
          { name: 'system', description: 'Service health.' },
        ],
      },
    });

    // The JSON stays available in every environment because the client generator reads it
    // in CI; only the interactive explorer is withheld from production.
    if (!isProduction()) {
      await fastify.register(swaggerUi, {
        routePrefix: '/docs',
        uiConfig: { docExpansion: 'list', deepLinking: true },
      });
    }
  },
  { name: 'swagger' },
);
