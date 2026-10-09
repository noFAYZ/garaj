# ADR 010 — Better Auth as the authentication provider

**Status:** Accepted
**Date:** 2026-09-07

## Context

`Architecture.md` §12 requires email/password, password reset, email verification, session
management, optional social login, future passkeys and account deletion. §90 explicitly
forbids building a custom authentication system unnecessarily.

Password hashing parameters, session rotation, token entropy and reset-link expiry are the
parts of an application where a subtle mistake stays invisible until it is exploited. They
are also solved problems.

## Decision

Use **Better Auth** with its Drizzle adapter, mounted on the Fastify API at `/api/auth/*`.

It is placed behind the `ActorContext` adapter §12 asks for: routes read `request.actor` and
never import the auth library. Replacing the provider means rewriting
`apps/api/src/plugins/auth.ts` and `actor-context.ts`, and nothing else.

Product-owned user data (locale, timezone, currency, units) lives in `user_profiles`, not in
the provider's `users` table, so a provider upgrade cannot collide with product columns.

## Alternatives

- **Hand-rolled sessions** — rejected by §90, and the failure modes are security bugs.
- **Clerk / Auth0** — a hosted identity provider adds a per-MAU cost and an external
  dependency in the sign-in path, for capabilities this product does not need yet.
- **Supabase Auth** — would pull a second platform in alongside the Postgres this project
  already owns and operates.

## Consequences

- The `users`, `sessions`, `accounts` and `verifications` tables follow Better Auth's
  contract rather than this codebase's naming conventions. This is documented in
  `packages/database/src/schema/auth.ts`.
- Better Auth's default id format is overridden to UUIDv7 so ids stay sortable and the
  columns stay `uuid`, consistent with every other table.
- Social login and passkeys are configuration changes, not new subsystems.
- Email verification is off by default so a fresh clone can sign up without SMTP; it turns
  on together with the email sender in Phase 3.
