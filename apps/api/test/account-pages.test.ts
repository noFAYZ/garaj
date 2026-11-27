import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { createTestContext, signUp, type SignedUpUser, type TestContext } from './harness';

describe('account pages', () => {
  let context: TestContext;
  let user: SignedUpUser;

  beforeAll(async () => {
    context = await createTestContext();
    user = await signUp(context, 'Rae');
  });
  afterAll(() => context.close());

  const submit = (fields: Record<string, string>) =>
    context.app.inject({
      method: 'POST',
      url: '/account/reset-password',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(fields).toString(),
    });

  it('resets a password through the form, once', async () => {
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      payload: { email: user.email },
    });
    const [row] = await context.database.db
      .select({ identifier: schema.verifications.identifier })
      .from(schema.verifications)
      .where(like(schema.verifications.identifier, 'reset-password:%'));
    const token = row!.identifier.slice('reset-password:'.length);

    const form = await context.app.inject({ url: `/account/reset-password?token=${token}` });
    expect(form.statusCode).toBe(200);
    expect(form.headers['cache-control']).toBe('no-store');
    expect(form.body).toContain(`value="${token}"`);

    const password = 'a-brand-new-long-password';
    const mismatch = await submit({ token, password, confirm: `${password}!` });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.body).toContain('match');

    const done = await submit({ token, password, confirm: password });
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain('Password changed');

    const signIn = await context.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: user.email, password },
    });
    expect(signIn.statusCode).toBe(200);

    const again = await submit({ token, password, confirm: password });
    expect(again.body).toContain('expired');
  });

  it('says whether a confirmation link worked', async () => {
    expect((await context.app.inject({ url: '/account/email-confirmed' })).body).toContain(
      'Email confirmed',
    );
    const failed = await context.app.inject({
      url: '/account/email-confirmed?error=INVALID_TOKEN',
    });
    expect(failed.statusCode).toBe(400);
  });
});
