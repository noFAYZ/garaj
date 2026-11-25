import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import errorHandler from './error-handler';
import { rateLimitResponse } from './security';

describe('rate limit', () => {
  it('refuses with a 429 and a Retry-After once the limit is spent, not a 500', async () => {
    const app = Fastify();
    await app.register(errorHandler);
    await app.register(rateLimit, {
      max: 1,
      timeWindow: '1 minute',
      errorResponseBuilder: rateLimitResponse,
    });
    app.get('/', async () => 'ok');

    expect((await app.inject('/')).statusCode).toBe(200);
    const refused = await app.inject('/');
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('RATE_LIMITED');
    expect(refused.headers['retry-after']).toBeDefined();
  });
});
