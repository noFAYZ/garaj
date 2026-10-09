# Vehicle OS

A digital garage: every vehicle gets a persistent identity carrying its timeline,
maintenance, tasks, expenses, documents, condition and value.

Product definition is in [`docs/PRD.md`](docs/PRD.md); the technical design is in
[`docs/Architecture.md`](docs/Architecture.md). Decisions taken during implementation that
those documents do not cover are recorded in [`docs/adr/`](docs/adr).

## Status

**Phase 1 — Foundation: complete.** Monorepo, database schema, API skeleton,
authentication, authorization, error handling, background-job infrastructure and CI.

**Phase 2 — Core domain: complete.** Garages and members, vehicles across ten types,
signed-URL photo upload, the timeline — plus the web app and an Expo scaffold on the same
API.

Phases 3–6 (maintenance, financials, documents, dashboard) follow the order in
`Architecture.md` §110.

## Requirements

- Node 20+
- pnpm 11+
- **Postgres.** That is the only hard dependency. Redis and object storage are optional
  and the app degrades cleanly without them — see the table below.

| Service        | Used for                                       | Without it                                                    |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Postgres       | everything; it is the system of record         | The API will not start                                        |
| Redis          | shared rate-limit counter across API instances | Rate limiting is per-process. Nothing else uses it            |
| Object storage | photos and documents                           | Those endpoints return 503; the rest of the API is unaffected |

## Getting started

Point `DATABASE_URL` at any Postgres. Two common choices:

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL and AUTH_SECRET
pnpm db:migrate
pnpm dev                      # api :3001, web :3000
```

**Hosted (Neon, Supabase, …)** — paste the connection string into `.env` and you are done.
Nothing to install.

**Local, everything** — `docker compose up -d` brings up Postgres :5432, Redis :6379 and
MinIO :9000 (console :9001) with the credentials `.env.example` already contains. This is
the setup `Architecture.md` §68 describes, and the one Phases 3 and 5 assume.

Then:

- `http://localhost:3000` — the web app
- `http://localhost:3001/api/v1/health` — service health
- `http://localhost:3001/docs` — OpenAPI explorer

- `http://localhost:3002` — the admin console (`pnpm dev` starts it too). Sign in with a
  normal account; the first time it shows that account's id — add it to `ADMIN_USER_IDS`
  in `.env` and restart the API. Ids rather than emails, because sign-up does not verify
  email, so an allowlisted address nobody had registered yet could be claimed by anyone.

- `http://localhost:3003` — the landing page. Its sign-up and sign-in buttons go to
  `NEXT_PUBLIC_APP_URL` (default `http://localhost:3000`). The screenshots in
  `apps/landing/src/assets` are real, taken from a seeded demo garage in both themes.

Mobile runs separately, against the same API:

```bash
pnpm --filter @vehicle-os/mobile start
```

The test suite needs nothing at all: integration tests run on PGlite, an in-process
PostgreSQL, so `pnpm test` works on a clean checkout with no database, no containers and no
connection string.

## Layout

```
apps/api          Fastify API — the authoritative application boundary
apps/web          Next.js web client
apps/admin        Vite + React admin console (reuses apps/web's components via `@/`)
apps/landing      Next.js marketing site, separate from the product (same `@/` reuse)
apps/mobile       Expo mobile client
packages/contracts  TypeBox schemas, shared by API and clients
packages/domain     Enums and value objects (Money, units, capabilities)
packages/database   Drizzle schema, migrations, client
packages/api-client Typed client + TanStack Query keys
packages/ui         Cross-platform design tokens
packages/config     Environment schema, feature flags
packages/utils      Ids, dates, assertions
workers/worker      Job runner over the Postgres outbox, and the schedules
tooling/            Shared tsconfig, ESLint and Prettier configuration
```

Each API module follows `domain/` → `application/` → `infrastructure/` → `http/`
(`Architecture.md` §6). Dependencies point inward; external providers sit behind adapters.

## Commands

| Command                 | What it does                                      |
| ----------------------- | ------------------------------------------------- |
| `pnpm dev`              | Run every app in watch mode                       |
| `pnpm typecheck`        | Typecheck all workspaces (`noUnusedLocals` is on) |
| `pnpm lint`             | ESLint, with type-aware rules                     |
| `pnpm test:unit`        | Domain logic, calculations, authorization matrix  |
| `pnpm test:integration` | Full app through `app.inject()` on PGlite         |
| `pnpm db:generate`      | Generate a migration from a schema change         |
| `pnpm db:migrate`       | Apply pending migrations                          |
| `pnpm db:studio`        | Browse the database                               |
| `pnpm format`           | Prettier over the repo (`docs/` is excluded)      |

## Conventions worth knowing before contributing

- **Money is never a float.** `amount_minor` (bigint) plus an ISO 4217 `currency`. The
  currency carries its own decimal exponent, so JPY and KWD are correct without special
  cases. Use the helpers in `@vehicle-os/domain`.
- **Distances carry their unit.** No reading is stored as a bare number, and conversion is
  always explicit.
- **The garage is the tenant boundary.** A `garageId` from a client is an argument to be
  checked, never proof of access. Permissions are capability strings, not role checks.
- **A resource in someone else's garage returns 404, not 403** — a 403 would confirm it
  exists.
- **Background work goes through the outbox**, written in the same transaction as the domain
  change, so data and its follow-up work cannot diverge.
- **Schema changes need a migration.** CI fails if `pnpm db:generate` produces a diff.
- **Nullable request fields use `Nullable()` from `@vehicle-os/contracts`,** not
  `Type.Union([X, Type.Null()])`. The union compiles to `anyOf`, and Ajv's type coercion
  turns an explicit `null` into `""` on the string branch — so "clear this field" silently
  becomes an empty string.

## Web UI

The web app follows the zunoUI system: Tailwind v4 CSS-first with no `tailwind.config.js`,
every colour a token in the `@theme` block, surfaces separated by contrast rather than
borders, and one focus-ring definition. Interactive primitives are vendored from
[beUI](https://beui.dev) via the shadcn CLI into `src/components/motion/` — keep those paths,
since a later `shadcn add` writes to them.

```bash
pnpm --filter @vehicle-os/web exec npx shadcn@latest add @beui/<component>
```
