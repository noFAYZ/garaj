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
import type { FastifyBaseLogger } from 'fastify';
import { env, isProduction } from '@vehicle-os/config';
import { schema, type Database } from '@vehicle-os/database';
import { newId } from '@vehicle-os/utils';
import {
  createResendEmail,
  isDeliverableAddress,
  type EmailMessage,
} from '../modules/notifications/application/services/deliver';

export type Auth = ReturnType<typeof createAuth>;

/**
 * The account's own mail — a reset link, an address to confirm — through the same provider as
 * reminders. Not awaited by the caller: how long a send takes must not tell anyone whether an
 * address has an account. With no provider (a development machine) the link is logged instead,
 * so a fresh clone can still reset a password and confirm an address.
 */
function sendAccountEmail(log: FastifyBaseLogger, message: EmailMessage, link: string): void {
  const config = env();
  if (!config.RESEND_API_KEY || !isDeliverableAddress(message.to)) {
    if (!isProduction(config))
      log.info({ to: message.to, link }, `Not emailed: ${message.subject}`);
    else log.warn({ subject: message.subject }, 'Account email skipped: no email provider');
    return;
  }
  void createResendEmail(config.RESEND_API_KEY, config.EMAIL_FROM)
    .send(message)
    .catch((error: unknown) => log.error({ err: error }, 'Account email failed'));
}

export function createAuth(db: Database, log: FastifyBaseLogger) {
  const config = env();
  const web = config.WEB_URL.replace(/\/$/, '');

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
      /*
       * Signing in does not wait on the inbox: someone logging a fill-up at the pump should not
       * be stopped by an unopened email. What an unconfirmed address cannot do is be added to
       * someone's garage (`addMember`) — that is where an address claimed by the wrong person
       * would do harm.
       */
      requireEmailVerification: false,
      /*
       * The link opens the web app's reset page with the token, wherever the request came from —
       * the phone has no page of its own to set a password on, and Better Auth's redirect only
       * goes to a trusted origin anyway. A reset ends every other session: whoever knew the old
       * password is signed out with it.
       */
      sendResetPassword: async ({ user, token }) => {
        const link = `${web}/reset-password?token=${encodeURIComponent(token)}`;
        sendAccountEmail(
          log,
          {
            to: user.email,
            subject: 'Reset your Garaj password',
            text: [
              'Someone asked to reset the password for this Garaj account.',
              '',
              'Choose a new one here (the link works for an hour):',
              link,
              '',
              "If it wasn't you, ignore this email — your password stays as it is.",
            ].join('\n'),
          },
          link,
        );
      },
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      // The API checks the token, then sends the person on to the web app's home.
      sendVerificationEmail: async ({ user, token }) => {
        const back = encodeURIComponent(`${web}/?verified=1`);
        const link = `${config.AUTH_URL.replace(/\/$/, '')}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${back}`;
        sendAccountEmail(
          log,
          {
            to: user.email,
            subject: 'Confirm your email for Garaj',
            text: [
              'Confirm this address for your Garaj account:',
              link,
              '',
              'Until it is confirmed, nobody can add you to their garage. The link works for a day.',
            ].join('\n'),
          },
          link,
        );
      },
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
    const auth = createAuth(fastify.db, fastify.log);
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
