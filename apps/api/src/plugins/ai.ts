/**
 * AI plugin. Decorates the app with an `AiProviderPort`; the concrete adapter is chosen
 * here and nowhere else, so no route or service knows which model is answering.
 */

import fp from 'fastify-plugin';
import { env } from '@vehicle-os/config';
import {
  createGeminiProvider,
  createUnconfiguredAiProvider,
} from '../modules/ai/infrastructure/gemini-provider';
import type { AiProviderPort } from '../modules/ai/infrastructure/ai-port';

declare module 'fastify' {
  interface FastifyInstance {
    ai: AiProviderPort;
  }
}

export interface AiPluginOptions {
  /** Supplied by integration tests, which must never reach a provider. */
  ai?: AiProviderPort;
}

export default fp<AiPluginOptions>(
  (fastify, options) => {
    if (options.ai) {
      fastify.decorate('ai', options.ai);
      return;
    }

    const config = env();
    if (!config.AI_API_KEY) {
      fastify.log.warn('No AI provider configured. /ai/ask will return 503.');
      fastify.decorate('ai', createUnconfiguredAiProvider());
      return;
    }

    fastify.decorate(
      'ai',
      createGeminiProvider({
        apiKey: config.AI_API_KEY,
        baseUrl: config.AI_BASE_URL,
        model: config.AI_MODEL,
        fallbackModel: config.AI_FALLBACK_MODEL || undefined,
      }),
    );
    fastify.log.info(
      { model: config.AI_MODEL, fallbackModel: config.AI_FALLBACK_MODEL || null },
      'AI provider configured',
    );
  },
  { name: 'ai' },
);
