/**
 * Error handler (Architecture.md §11).
 *
 * One response shape for every failure, so a client has exactly one branch to write.
 */

import fp from 'fastify-plugin';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../infrastructure/errors';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    fields?: Record<string, string>;
  };
}

/**
 * Fastify reports schema failures as `body/purchasePrice must be >= 0`. Clients need the
 * field name to put the message next to the input, so the path is split back out here
 * rather than every form parsing English error strings.
 */
function fieldsFromValidation(error: FastifyError): Record<string, string> | undefined {
  if (!error.validation?.length) return undefined;
  const fields: Record<string, string> = {};
  for (const issue of error.validation) {
    const raw =
      (issue.params as { missingProperty?: string } | undefined)?.missingProperty ??
      issue.instancePath.replace(/^\//, '').replace(/\//g, '.');
    fields[raw || '_'] = issue.message ?? 'Invalid value';
  }
  return fields;
}

export default fp(
  (fastify) => {
    fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.id;

      if (error instanceof AppError) {
        request.log.info({ err: error, code: error.code }, 'Handled application error');
        const body: ErrorBody = {
          error: { code: error.code, message: error.message, requestId },
        };
        if (error.fields) body.error.fields = error.fields;
        return reply.status(error.statusCode).send(body);
      }

      if (error.validation) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            requestId,
            fields: fieldsFromValidation(error),
          },
        } satisfies ErrorBody);
      }

      // Fastify's own 4xx (unsupported media type, body too large, rate limit) already
      // carry a safe message; only 5xx bodies need to be replaced.
      const statusCode = error.statusCode ?? 500;
      if (statusCode < 500) {
        return reply.status(statusCode).send({
          error: { code: error.code ?? 'BAD_REQUEST', message: error.message, requestId },
        } satisfies ErrorBody);
      }

      /*
       * Everything below here is unexpected. The full error goes to the logs with the
       * request id; the client gets that id and nothing else, because a stack trace or a
       * constraint name in the response body maps out the schema for free.
       */
      request.log.error({ err: error }, 'Unhandled error');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          requestId,
        },
      } satisfies ErrorBody);
    });

    fastify.setNotFoundHandler((request, reply) =>
      reply.status(404).send({
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: `Route ${request.method} ${request.url} not found`,
          requestId: request.id,
        },
      } satisfies ErrorBody),
    );
  },
  { name: 'error-handler' },
);
