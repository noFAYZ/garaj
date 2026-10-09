import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './harness';

describe('GET /api/v1/health', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });

  afterAll(async () => {
    await context.close();
  });

  it('reports the database up and Redis deliberately disabled', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: { database: 'up', redis: 'disabled' },
    });
  });

  it('echoes the request id, so a user-reported error maps to a log line', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers an unknown route in the standard error envelope', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/v1/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'ROUTE_NOT_FOUND', requestId: expect.any(String) },
    });
  });
});
