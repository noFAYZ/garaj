# ADR 011 — PGlite for integration tests

**Status:** Accepted
**Date:** 2026-09-07

## Context

`Architecture.md` §72 requires integration tests against isolated databases, covering
repositories, routes, authorization, transactions and background jobs. §68 provides Postgres
through Docker Compose for local development.

Requiring a running container for the test suite makes tests something developers skip: they
are slow to start, they fail on a machine without Docker, and shared state between suites
produces failures that only reproduce in one order.

## Decision

Integration tests run against **PGlite** — PostgreSQL compiled to WebAssembly, executing
inside the test process — via `drizzle-orm/pglite`. `createTestDatabase()` in
`packages/database/src/testing.ts` builds a fresh in-memory instance and applies the same
migration files production uses.

`buildApp({ db, redis })` accepts injected dependencies, so the suite drives the complete
application — plugins, TypeBox validation, the error handler, Better Auth and every
authorization check — through `app.inject()` with no socket and no container.

The `Database` type is the driver-agnostic `PgDatabase` base rather than
`PostgresJsDatabase`, which is what lets identical repository code run on both drivers.

## Alternatives

- **Docker Compose Postgres in CI and locally** — still available and used for development;
  rejected as the *test* dependency because it makes the suite unrunnable without Docker.
- **Testcontainers** — same container requirement, plus per-suite startup cost.
- **SQLite** — rejected outright. It has no enums, no `jsonb`, no partial indexes and
  different `on conflict` semantics, so it would accept schemas real Postgres rejects.
- **A shared test database with transaction rollback** — cannot test code that manages its
  own transactions, which includes the outbox writer.

## Consequences

- `pnpm test:integration` runs anywhere Node runs, with no infrastructure. CI needs no
  service containers.
- Constraints, enums, partial indexes and `for update skip locked` all behave as they do in
  production, because it is the same engine.
- PGlite is single-connection, so genuine concurrency between sessions cannot be tested here.
  Anything that depends on it needs a real Postgres — noted if and when such a test appears.
- Production and development remain on real PostgreSQL via `docker-compose.yml`; PGlite is a
  test-only dependency, exported from a separate entry point so application code cannot
  import it by accident.
