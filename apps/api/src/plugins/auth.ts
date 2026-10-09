/**
 * Authentication (Architecture.md §12).
 *
 * Better Auth owns sessions, password hashing, verification and reset. Architecture.md §90
 * forbids building a custom auth system, and this is why: password storage and session
 * rotation are exactly the code where a subtle mistake is invisible until it is exploited.
 *
 * It is mounted behind an adapter — routes never import `auth` directly, they read
 * `request.actor` (see `actor-context.ts`). Swapping the provider means rewriting this file
 * and nothing else.
 */

import fp from 'fastify-plugin';
import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { env } from '@vehicle-os/config';
import { schema, type Database } from '@vehicle-os/database';
import { newId } from '@vehicle-os/utils';

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(db: Database) {
  const config = env();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
      usePlural: true,
    }),
    secret: config.AUTH_SECRET,
    baseURL: config.AUTH_URL,
    basePath: '/api/auth',
    // Better Auth's default id is a random string; the columns here are `uuid`, and the
    // rest of the system assumes sortable v7 ids everywhere.
    advanced: { database: { generateId: () => newId() } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      // Left off for local development so a fresh clone can sign up without an SMTP
      // server. Turn on together with the email sender in Phase 3.
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      /*
       * The session travels in a signed cookie rather than being read back from the
       * database on every request.
       *
       * Without it, `getSession` costs two round trips — one for `sessions`, one for
       * `users` — on every single API call, which against a hosted Postgres in another
       * region is most of the time a request takes. `compact` keeps only the ids in the
       * cookie, and the signature is what makes it trustworthy.
       *
       * The cost is revocation lag: a session invalidated server-side is still accepted
       * until the cookie's own five minutes are up. Sign-out clears the cookie outright,
       * so that lag only applies to revocation from somewhere else.
       */
      cookieCache: {
        enabled: true,
        strategy: 'compact',
        maxAge: 60 * 5,
      },
    },
    // The browser client sends credentials cross-origin from the web app; an origin absent
    // from this list is rejected, which is what stops another site from riding the cookie.
    trustedOrigins: [config.WEB_URL, config.ADMIN_URL],
    /*
     * The bearer plugin is what makes the mobile app possible.
     *
     * A React Native app has no cookie jar it can rely on across restarts, so it holds the
     * session token in the platform keystore and sends it as `Authorization: Bearer …`.
     * Without this plugin the header is simply ignored and every mobile request is
     * anonymous — which is exactly what it was doing before.
     *
     * The web app is unaffected: it never sends the header, and its cookie keeps working.
     */
    plugins: [bearer()],
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    auth: Auth;
  }
}

export default fp(
  async (fastify) => {
    const auth = createAuth(fastify.db);
    fastify.decorate('auth', auth);

    /*
     * Better Auth speaks the Web `Request`/`Response` API, Fastify speaks Node streams, so
     * this route translates between them. Registered as a wildcard because Better Auth owns
     * every path under its base — sign-in, sign-up, callbacks, reset — and the set grows
     * with each plugin enabled above.
     */
    fastify.route({
      method: ['GET', 'POST', 'OPTIONS'],
      url: '/api/auth/*',
      // Documented as the provider's surface, not ours; the shapes live in its own docs.
      schema: { hide: true },
      async handler(request, reply) {
        const url = new URL(request.url, env().AUTH_URL);

        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
          else headers.append(key, value);
        }

        const response = await auth.handler(
          new Request(url, {
            method: request.method,
            headers,
            body:
              request.method === 'GET' || request.method === 'OPTIONS'
                ? undefined
                : JSON.stringify(request.body ?? {}),
          }),
        );

        reply.status(response.status);
        /*
         * `headers.forEach` rather than spreading into an object: a sign-in reply carries
         * several `set-cookie` headers, and collapsing them into one key drops all but the
         * last, which silently breaks the session.
         */
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() === 'set-cookie') reply.header('set-cookie', value);
          else reply.header(key, value);
        });

        return reply.send(response.body ? await response.text() : null);
      },
    });
  },
  { name: 'auth', dependencies: ['database'] },
);
