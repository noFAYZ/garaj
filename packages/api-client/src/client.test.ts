import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, RequestTimeoutError } from './client';

/** A server that accepts the connection and never answers, until the request is aborted. */
const hanging: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('request timeouts', () => {
  it('gives up on a request the server never answers', async () => {
    const client = createApiClient({ baseUrl: 'http://api.test', fetch: hanging, timeoutMs: 20 });

    await expect(client.users.me()).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it('still reports what the server refused as an ApiError', async () => {
    const refusing: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: 'NOPE', message: 'No.', requestId: 'r1' } }), {
        status: 403,
      });
    const client = createApiClient({ baseUrl: 'http://api.test', fetch: refusing, timeoutMs: 20 });

    await expect(client.users.me()).rejects.toBeInstanceOf(ApiError);
  });
});
