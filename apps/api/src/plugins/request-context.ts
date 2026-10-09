/**
 * Request identity and structured logging (Architecture.md §58).
 *
 * Every log line, error body and audit row carries the same request id, so one value found
 * in a user's error message pulls up the whole request in the logs.
 */

import fp from 'fastify-plugin';

export default fp(
  (fastify) => {
    fastify.addHook('onSend', async (request, reply, payload) => {
      reply.header('x-request-id', request.id);
      return payload;
    });
  },
  { name: 'request-context' },
);
