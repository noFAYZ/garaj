/**
 * Storage plugin. Decorates the app with a `StoragePort`; the concrete adapter is chosen
 * here and nowhere else, so no route or service knows which backend it is talking to.
 */

import fp from 'fastify-plugin';
import { createStorage } from '../infrastructure/storage/factory';
import { createUnconfiguredStorage } from '../infrastructure/storage/unconfigured-storage';
import type { StoragePort } from '../infrastructure/storage/storage-port';

declare module 'fastify' {
  interface FastifyInstance {
    storage: StoragePort;
  }
}

export interface StoragePluginOptions {
  /** Supplied by integration tests. */
  storage?: StoragePort;
}

export default fp<StoragePluginOptions>(
  (fastify, options) => {
    if (options.storage) {
      fastify.decorate('storage', options.storage);
      return;
    }

    const storage = createStorage();
    if (!storage) {
      fastify.log.warn(
        'Object storage is not configured. Photo and document endpoints will return 503.',
      );
      fastify.decorate('storage', createUnconfiguredStorage());
      return;
    }

    fastify.decorate('storage', storage);
    fastify.log.info('Object storage configured');
  },
  { name: 'storage' },
);
