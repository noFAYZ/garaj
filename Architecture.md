# Garaj (Vehicle OS): Architecture

How the system is actually built: the components, how they talk, the tech and tools in each
layer, and why each was chosen. It describes **the code as it stands**.

| Document                                                               | What it is                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Architecture.md` (this file)                                          | As-built architecture and tech stack                                    |
| [`docs/Architecture.md`](docs/Architecture.md)                         | The original design spec. Code comments cite it as `Architecture.md §N` |
| [`docs/PRD.md`](docs/PRD.md)                                           | Product definition                                                      |
| [`docs/adr/`](docs/adr)                                                | Decisions taken during the build (auth provider, PGlite for tests)      |
| [`docs/GAPS.md`](docs/GAPS.md), [`docs/PROGRESS.md`](docs/PROGRESS.md) | Competitive gaps, build log and handoff notes                           |

> **Naming.** The product is called **Garaj**. The codebase started out as "Vehicle OS", so
> workspace packages are `@vehicle-os/*`, the database is `vehicleos` and the mobile bundle id
> is `dev.vehicleos.app`. Both names refer to the same system.

Section 20 lists where the build departs from the original spec in `docs/Architecture.md`.

---

## Contents

1. [System at a glance](#1-system-at-a-glance)
2. [Guiding principles](#2-guiding-principles)
3. [Repository layout](#3-repository-layout)
4. [Technology stack](#4-technology-stack)
5. [Workspace dependency graph](#5-workspace-dependency-graph)
6. [The API (`apps/api`)](#6-the-api-appsapi)
7. [Identity, authorization and plans](#7-identity-authorization-and-plans)
8. [Data layer (`packages/database`)](#8-data-layer-packagesdatabase)
9. [Background work (`workers/worker`)](#9-background-work-workersworker)
10. [Files and object storage](#10-files-and-object-storage)
11. [External providers (ports and adapters)](#11-external-providers-ports-and-adapters)
12. [AI assistant and MCP server](#12-ai-assistant-and-mcp-server)
13. [Clients](#13-clients)
14. [Shared packages](#14-shared-packages)
15. [Configuration and feature flags](#15-configuration-and-feature-flags)
16. [Security model](#16-security-model)
17. [Observability](#17-observability)
18. [Testing](#18-testing)
19. [Tooling, CI and local development](#19-tooling-ci-and-local-development)
20. [Where the build departs from the original spec](#20-where-the-build-departs-from-the-original-spec)
21. [Deliberate ceilings and their upgrade paths](#21-deliberate-ceilings-and-their-upgrade-paths)

---

## 1. System at a glance

Garaj is a digital garage. Every vehicle (car, motorcycle, bicycle, boat, trailer and so on)
gets a persistent record holding its timeline, maintenance, tasks, expenses, documents,
photos, condition, value and health.

It is a **modular monolith**: one Fastify API that owns every rule, one Postgres database as
the system of record, one worker process for background jobs, and five thin clients.

```text
 ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
 │  Web app     │ │ Mobile app   │ │ Admin console│ │ Landing site │ │ Developer    │
 │  Next.js 15  │ │ Expo SDK 52  │ │ Vite+React 19│ │ Next.js 15   │ │ docs Next.js │
 │  :3000       │ │ (Metro)      │ │ :3002        │ │ :3003        │ │ :3004        │
 └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────────────┘ └──────┬───────┘
        │ cookie         │ bearer         │ cookie     (static; links      │ reads
        │ session        │ token          │ session     to the web app)    │ /openapi.json
        └────────────────┴───────┬────────┴─────────────────────────────────┘
                                 │  HTTPS · REST · JSON · /api/v1/*   (+ /api/auth/*)
            AI clients ─────────▶│  MCP over HTTP · /api/v1/mcp  (personal API key gk_…)
                                 ▼
                ┌───────────────────────────────────┐
                │           Fastify API :3001       │  the only thing that talks to
                │   plugins → modules → Drizzle     │  the database
                └───┬──────────────┬──────────┬─────┘
                    │              │          │
       SQL (tx:     │              │ signed   │ rate-limit counter
       rows+outbox) │              │ URLs     │ (production only)
                    ▼              ▼          ▼
            ┌──────────────┐ ┌───────────┐ ┌─────────┐
            │ PostgreSQL   │ │ Object    │ │ Redis   │  optional
            │ system of    │ │ storage   │ └─────────┘
            │ record +     │ │ S3/R2/    │
            │ job queue    │ │ MinIO/    │◀── clients PUT/GET directly
            └──────┬───────┘ │ Upstash   │    with short-lived signed URLs
                   │         └─────▲─────┘
      claim due    │               │
      outbox rows  ▼               │
            ┌──────────────────────┴───┐      ┌──────────────────────────────────┐
            │ Worker (Node process)    │─────▶│ Resend (email) · Expo Push ·     │
            │ outbox runner+scheduler  │      │ Pixelcut (bg removal) · NHTSA    │
            └──────────────────────────┘      └──────────────────────────────────┘

   API → external: Gemini (AI) · Stripe (billing) · NHTSA vPIC (VIN) · FX rates API
```

**Only Postgres is required.** Every other dependency is optional, and the system degrades
per feature rather than refusing to start:

| Dependency                   | Used for                                       | When absent                                                 |
| ---------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| PostgreSQL                   | All data, and the job queue (outbox)           | API and worker refuse to start                              |
| Redis                        | Shared rate-limit counter across API instances | Rate limiting is per process                                |
| Object storage               | Photos and documents                           | Those endpoints return 503; everything else works           |
| `AI_API_KEY` (Gemini)        | `/ai/ask`, the `ai`/`ocr` flags                | `/ai/ask` returns 503, flag stays off                       |
| `STRIPE_SECRET_KEY`          | Paid plans, checkout, customer portal          | Everyone is on the free plan; billing reports "unavailable" |
| `RESEND_API_KEY`             | Email delivery of notifications                | Channel skipped and logged; in-app still works              |
| `EXPO_ACCESS_TOKEN`          | Push delivery                                  | Channel skipped and logged                                  |
| `BG_REMOVAL_API_KEY`         | Cut-out thumbnail of a vehicle's primary photo | The original photo is used                                  |
| `NEXT_PUBLIC_LOGO_DEV_TOKEN` | Manufacturer logos in pickers                  | The make's initial is drawn instead                         |

---

## 2. Guiding principles

These show up all over the code. Most files open with a comment explaining which one they
apply.

1. **The API owns the domain.** Clients never touch Postgres, and Next.js is a client of the
   API rather than a backend-for-frontend. Business rules such as due dates, costs, health,
   permissions and plan limits are computed server-side.
2. **Modular monolith.** One deployable API with domain modules. No microservices, Kafka,
   Elasticsearch or Kubernetes.
3. **Postgres is the only hard dependency.** It is the database _and_ the queue. Everything
   else is behind a port and can be absent.
4. **The garage is the tenant boundary.** A `garageId` from a client is an argument to check,
   never proof of access. A resource in someone else's garage returns **404**, not 403.
5. **Capabilities, not roles.** Routes ask "may this actor do `expense.write` here?" and never
   "is this user an ADMIN?".
6. **Money is integers, distance carries its unit.** `amount_minor` plus an ISO 4217 currency.
   An odometer reading always has `km` or `mi` next to it.
7. **History is kept, not overwritten.** Valuations, condition assessments and the timeline
   are append-oriented, and audit logs are append-only by construction.
8. **Side effects go through the outbox**, written in the same transaction as the change, so
   data and its follow-up work cannot diverge.
9. **External providers sit behind adapters** (storage, AI, payments, email, push, VIN,
   recalls, FX, background removal). Each fails soft.
10. **Least code that works.** Deliberate simplifications are marked `ponytail:` in code,
    together with their ceiling and upgrade path (§21).

---

## 3. Repository layout

A pnpm workspace orchestrated by Turborepo. Workspace globs are `apps/*`, `packages/*`,
`workers/*` and `tooling/*`.

```text
myGarage/
├── apps/
│   ├── api/          @vehicle-os/api       Fastify REST API + MCP server          :3001
│   ├── web/          @vehicle-os/web       Next.js 15 product web app             :3000
│   ├── admin/        @vehicle-os/admin     Vite + React 19 operator console       :3002
│   ├── landing/      @vehicle-os/landing   Next.js marketing site                 :3003
│   ├── docs/         @vehicle-os/docs      Next.js developer docs (API + MCP)     :3004
│   └── mobile/       @vehicle-os/mobile    Expo / React Native app                Metro
├── packages/
│   ├── contracts/    TypeBox request/response schemas (API ⇄ clients)
│   ├── domain/       Pure domain: enums, Money, units, authz, plans, vehicle capabilities/specs
│   ├── database/     Drizzle schema, migrations, client, drift check, PGlite test DB
│   ├── api-client/   Typed fetch client + TanStack Query keys/builders
│   ├── ui/           Cross-platform design tokens + pure presentation helpers
│   ├── config/       Env schema (TypeBox), .env loader, feature flags
│   └── utils/        UUIDv7 ids, date-only helpers, assertions
├── workers/
│   └── worker/       @vehicle-os/worker    Outbox job runner + daily/weekly scheduler
├── tooling/
│   ├── typescript/   Shared tsconfig bases (base / node / react)
│   ├── eslint/       Flat ESLint config (+ react variant)
│   └── prettier/     Prettier config
├── docs/             PRD, original architecture spec, ADRs, progress, gaps
├── docker-compose.yml  Local Postgres 16, Redis 7, MinIO (+ bucket init)
├── turbo.json · pnpm-workspace.yaml · package.json
└── .env / .env.example   ONE env file for the whole repo, at the root
```

**Internal packages ship TypeScript source.** Their `build` script is a no-op
(`"consumed as TypeScript source"`). Consumers compile them: Next through
`transpilePackages`, Vite and Metro natively, and the API and worker through `tsx`/`tsc`.
That removes a build step between editing a contract and seeing it in every app.

---

## 4. Technology stack

### 4.1 Platform and build

| Concern         | Tool                                                     | Notes                                                                                   |
| --------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Language        | **TypeScript 5.7** (strict)                              | `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`, ES2022 |
| Runtime         | **Node ≥ 20** (CI runs 22)                               | ESM everywhere (`"type": "module"`)                                                     |
| Package manager | **pnpm 11**                                              | `allowBuilds` allowlist for postinstall scripts (esbuild, sharp, oxide, …)              |
| Monorepo tasks  | **Turborepo 2**                                          | `build`, `dev`, `typecheck`, `lint`, `test:unit`, `test:integration`                    |
| Lint / format   | **ESLint 9** (flat, typescript-eslint 8), **Prettier 3** | Type-aware lint rules; `eslint-config-prettier`                                         |
| Tests           | **Vitest 2**, **PGlite**                                 | Integration tests run real Postgres (WASM) in-process                                   |
| CI              | **GitHub Actions**                                       | Format → typecheck → lint → unit → integration → build → migration diff check           |
| Local infra     | **Docker Compose**                                       | Postgres 16, Redis 7, MinIO. Optional, since hosted Neon/Upstash work too               |

### 4.2 Backend

| Concern          | Tool                                                                  | Why                                                                                   |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| HTTP framework   | **Fastify 5**                                                         | Schema-first validation, plugin encapsulation, `inject()` for tests                   |
| Schemas / types  | **TypeBox 0.34** + `@fastify/type-provider-typebox`                   | One schema is the runtime validator, the TS type _and_ the OpenAPI doc                |
| Validation       | **Ajv 8** + `ajv-formats`                                             | Formats restricted to `uuid`, `email`, `date`, `date-time`; `removeAdditional: false` |
| API docs         | `@fastify/swagger` + `@fastify/swagger-ui`                            | OpenAPI 3.1 generated from route schemas; `/docs` UI, `/api/v1/openapi.json`          |
| Auth             | **Better Auth 1.x** (Drizzle adapter, `bearer` plugin)                | Email + password, sessions, cookie cache; custom auth is forbidden by spec §90        |
| ORM / SQL        | **Drizzle ORM 0.38** + **drizzle-kit 0.30**                           | Typed SQL builder, SQL migration files, driver-agnostic types                         |
| Postgres driver  | **postgres.js 3.4**                                                   | `prepare: false` (PgBouncer-safe), `fetch_types: false`                               |
| Security headers | `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`             | CORS allowlist = web + admin origins, with credentials                                |
| Redis client     | **ioredis 5**                                                         | Rate-limit store only, fail-fast settings                                             |
| Object storage   | **AWS SDK v3** (`client-s3`, `s3-request-presigner`), `@upstash/blob` | Presigned PUT/GET; S3, R2, MinIO or Upstash Blob                                      |
| Payments         | **Stripe SDK 22**                                                     | Checkout, customer portal, signature-verified webhooks                                |
| AI               | **Gemini** via REST (`fetch`) behind `AiProviderPort`                 | `gemini-3.1-flash-lite`, falls back to `gemini-3.5-flash-lite`                          |
| MCP              | **@modelcontextprotocol/sdk 1.30**                                    | Stateless Streamable HTTP server at `/api/v1/mcp`                                     |
| Logging          | **Pino** (Fastify's logger), `pino-pretty` in dev                     | JSON lines in production, secret redaction                                            |
| IDs              | **UUIDv7** (`uuidv7`)                                                 | Sortable, generated in app, shared with request ids                                   |
| Dev runner       | **tsx** (`tsx watch`)                                                 | Build is `tsc` → `dist/`, run with `node`                                             |

### 4.3 Web and admin

| Concern      | Tool                                                      | Notes                                                                 |
| ------------ | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Framework    | **Next.js 15** App Router, Turbopack dev; **React 19**    | Experimental `viewTransition` for route cross-fades                   |
| Server state | **TanStack Query 5**                                      | Shared query keys from `@vehicle-os/api-client/react`                 |
| Local state  | `useSyncExternalStore` over plain modules                 | Theme, motion preference. No Zustand or Redux                         |
| Styling      | **Tailwind CSS v4** (CSS-first `@theme`, no config file)  | Colours are tokens; parity with `packages/ui` is enforced by a test   |
| Components   | Own primitives + **beUI** vendored via shadcn CLI         | `src/components/motion/*` (popover, tabs, switch, tooltip, loader)    |
| Motion       | **motion** (Framer Motion 11)                             | Honours reduced-motion                                                |
| Icons        | **lucide-react**, Iconify Solar (generated), emoji set    | `scripts/generate-icons.mjs`, `generate-emoji.mjs`                    |
| Auth client  | `better-auth/react`                                       | Points at the API's `/api/auth`; no Next auth routes                  |
| Admin build  | **Vite 7** + `@vitejs/plugin-react` + `@tailwindcss/vite` | Aliases `@/` to `apps/web/src` and shims `next/link` and `next/image` |

### 4.4 Mobile

| Concern        | Tool                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Runtime        | **Expo SDK 52**, **React Native 0.76** (New Architecture on), **React 18.3**                                          |
| Navigation     | **Expo Router 4** (file-based, typed routes)                                                                          |
| Server state   | TanStack Query 5, persisted to **AsyncStorage** (24 h) via `PersistQueryClientProvider`                               |
| Offline writes | Own queue in AsyncStorage (`lib/offline.ts`) + NetInfo                                                                |
| Auth storage   | **expo-secure-store** (bearer token in the keystore)                                                                  |
| Device APIs    | expo-notifications, expo-image-picker, expo-document-picker, expo-file-system, expo-sharing, expo-haptics, expo-image |
| Rendering      | react-native-svg (charts), react-native-webview, Urbanist font                                                        |
| Builds         | EAS (Turbo's `build` is a no-op for mobile)                                                                           |

### 4.5 Third-party services

| Service                        | Role                                 | Where                                         |
| ------------------------------ | ------------------------------------ | --------------------------------------------- |
| Neon / any Postgres            | Primary database                     | `DATABASE_URL`                                |
| Upstash Redis                  | Rate-limit counter (optional)        | `REDIS_URL`                                   |
| Upstash Blob / R2 / S3 / MinIO | Object storage                       | `UPSTASH_BLOB_TOKEN` or `OBJECT_STORAGE_*`    |
| Google Gemini                  | AI assistant                         | `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_FALLBACK_MODEL`|
| Stripe                         | Subscriptions                        | `STRIPE_*`                                    |
| Resend                         | Email                                | `RESEND_API_KEY`, `EMAIL_FROM`                |
| Expo Push                      | Mobile push                          | `EXPO_ACCESS_TOKEN`                           |
| NHTSA vPIC / Recalls           | VIN decode, safety recalls           | `VPIC_URL`, `RECALLS_URL` (no key)            |
| fxratesapi.com                 | Exchange rates for _reporting only_  | `FX_RATES_URL`                                |
| Pixelcut                       | Background removal for thumbnails    | `BG_REMOVAL_URL`, `BG_REMOVAL_API_KEY`        |
| logo.dev                       | Manufacturer logos (publishable key) | `NEXT_PUBLIC_LOGO_DEV_TOKEN`, `EXPO_PUBLIC_…` |

`POSTHOG_KEY`, `SENTRY_DSN` and `OPENAI_API_KEY` exist in the env schema and `.env.example`
but are **not wired** to anything yet (§17, §20).

---

## 5. Workspace dependency graph

Arrows point from consumer to dependency. Nothing points back up, and `domain` and `utils`
depend on nothing internal.

```text
                        ┌──────────── apps/web ◀─────┐ (@/ alias: source reuse)
                        │   apps/mobile              ├── apps/admin
                        │   apps/admin ──────────────┤── apps/landing
                        │                            └── apps/docs
                        ▼
                  api-client ─────▶ contracts ─────▶ domain
                        ▲                               ▲
   ui ──────────────────┼───────────────────────────────┘ (clients also use ui)
                        │
   apps/api ──▶ contracts, domain, database, config, utils
   workers/worker ──▶ database, config, domain, utils, **apps/api** (scan/deliver/storage services)
   database ──▶ domain, utils, config
   config ──▶ (TypeBox, dotenv)
   utils ──▶ (uuidv7)
```

Two cross-app edges are intentional:

- **worker → api.** `apps/api` exports its notification services and storage factory
  (`@vehicle-os/api/maintenance-scan`, `/expiry-scan`, `/recall-scan`, `/deliver`,
  `/storage`), so scheduled scans run the same code the API would, with no duplication.
- **admin/landing/docs → web source.** They import `apps/web/src` through the `@/` alias, so
  every surface wears the same components and stylesheet. Marked `ponytail:`: once a fourth
  consumer appears, those components move into `packages/ui`.

---

## 6. The API (`apps/api`)

### 6.1 Boot

`src/server.ts` only starts and stops the process. What the app _is_ lives in `src/app.ts`
(`buildApp`), which tests call directly.

```text
loadEnvFile()                 walk up to the repo-root .env
env()                         TypeBox-validate + cache config; fail loudly on bad/missing values
buildApp()                    register plugins and routes (below)
assertNoMigrationDrift(db)    refuse to serve if the DB is behind the migration journal
app.listen(API_HOST:API_PORT)
SIGINT/SIGTERM → app.close()  drain requests, close DB pool and Redis, exit
```

Fastify is configured with:

- `genReqId: newId()`, so request ids are UUIDv7 and sort alongside the rows they wrote.
- `trustProxy` in production, so the rate limiter and audit log see the real client IP.
- `bodyLimit: 1 MiB`. Files never pass through the API (§10).
- Ajv with `removeAdditional: false` (unknown fields are **rejected**, not silently
  stripped), `coerceTypes: 'array'` and `useDefaults: true`.
- Pino redaction of `authorization`, `cookie`, `set-cookie`, `password`, `newPassword` and
  `token`.

### 6.2 Plugin chain (order matters)

| #   | Plugin            | Decorates / does                                                                                    |
| --- | ----------------- | --------------------------------------------------------------------------------------------------- |
| 1   | `error-handler`   | One error envelope for everything (§6.5). Registered first so it catches all                        |
| 2   | `request-context` | Echoes `x-request-id` on every response                                                             |
| 3   | `database`        | `app.db`: one postgres.js pool per process, closed on shutdown                                      |
| 4   | `redis`           | `app.redis`: ioredis or `null`                                                                      |
| 5   | `security`        | helmet, CORS allowlist, rate limit (300/min prod, 10k/min dev; Redis-backed in prod, `skipOnError`) |
| 6   | `swagger`         | OpenAPI 3.1 doc with `bearerAuth` + `sessionCookie` schemes; Swagger UI                             |
| 7   | `storage`         | `app.storage: StoragePort` (S3 / Upstash / "unconfigured" 503 stub)                                 |
| 8   | `ai`              | `app.ai: AiProviderPort` (Gemini or "unconfigured")                                                 |
| 9   | `auth`            | Better Auth mounted at `/api/auth/*`                                                                |
| 10  | `actor-context`   | `requireAuth`, `requireCapability` → `request.actor`                                                |
| 11  | `plan-access`     | `planFor`, `planForGarage`, entitlement and limit checks (402)                                      |
| 12  | `vehicle-access`  | `requireVehicleAccess(req, vehicleId, capability)` (tenant check + returns the row)                 |

All product routes then register under the `/api/v1` prefix.

### 6.3 Module layout

Code is organised by **domain**, not by technical type. Each module uses whichever of four
layers it needs, and dependencies point inward:

```text
modules/<name>/
├── domain/          pure rules and types: no Fastify, no SQL (e.g. next-due.ts, health.ts)
├── application/     commands/ queries/ services/: orchestrate a use case in a transaction
├── infrastructure/  repositories/ mappers/: Drizzle queries, row ↔ entity mapping
└── http/            routes/ schemas/ serializers/: TypeBox schemas, auth checks, response shape
```

Small modules skip layers they do not need (e.g. `valuations` is only `http/`). Repositories
are domain-specific (`findVehicleById`, `listPlans`). There is no `GenericRepository<T>`.

| Module          | Mounted at                 | Responsibility                                                               |
| --------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `users`         | `/users`                   | Profile (locale, timezone, currency, units), account, device tokens          |
| `garages`       | `/garages`                 | Garages, members, invitations, roles                                         |
| `vehicles`      | `/vehicles`                | Identity, specs, status/archive, VIN decode, primary photo                   |
| `events`        | `/vehicles`                | The timeline (fuel, charge, trips, repairs, notes, …); mileage reports       |
| `activity`      | `/vehicles`                | Merged activity feed                                                         |
| `photos`        | `/vehicles`                | Signed-upload photo flow, gallery                                            |
| `maintenance`   | `/vehicles`                | Plans (distance / time / engine-hour intervals), records, due status         |
| `expenses`      | `/vehicles`                | Costs, categories, cost summaries and trends, fuel prices                    |
| `income`        | `/vehicles`                | What a vehicle earns (Business plan)                                         |
| `documents`     | `/vehicles`, `/documents`  | Signed-upload documents, expiry tracking                                     |
| `health`        | `/vehicles`                | Derived, explainable health score (never stored)                             |
| `condition`     | `/vehicles`                | Condition assessments per category, with photos                              |
| `valuations`    | `/vehicles`                | Append-only value history                                                    |
| `sharing`       | `/vehicles`, `/public`     | Revocable passport links; the **only unauthenticated** read path (`/public`) |
| `transfer`      | `/vehicles`, `/garages`    | Export archive (CSV/JSON) and CSV import                                     |
| `tasks`         | `/tasks`                   | To-dos, buckets, priorities                                                  |
| `dashboard`     | `/dashboard`               | Composition of domain queries for the garage overview                        |
| `search`        | `/search`                  | Permission-filtered global search                                            |
| `notifications` | `/notifications`           | In-app list, preferences; scan and delivery services used by the worker      |
| `billing`       | `/billing`                 | Plans, Stripe checkout, portal, webhook, downgrade                           |
| `ai`            | `/ai`                      | Tool-using question answering (§12)                                          |
| `api-keys`      | `/api-keys`                | Personal API keys (`gk_…`)                                                   |
| `mcp`           | `/mcp`                     | Model Context Protocol server (§12)                                          |
| `admin`         | `/admin`                   | Operator console API (overview, users, garages, logs, flags)                 |
| (root)          | `/health`, `/openapi.json` | Service health, OpenAPI document                                             |

### 6.4 A request, end to end

```text
Client ──▶ helmet/CORS/rate-limit ──▶ Ajv validates params/query/body against TypeBox schema
      ──▶ route handler
            actor   = await app.requireAuth(req)                        401 if no session/key
            access  = await app.requireVehicleAccess(req, id, 'expense.write')
                        ├─ vehicle not found          → 404
                        └─ actor not a member there   → 404  (never 403: don't confirm it exists)
                        └─ member lacks capability    → 403
            plan    = await app.planForGarage(req, access.garageId)     402 not entitled · 409 over limit
      ──▶ application command:  db.transaction(tx =>
                                   domain rows
                                 + recordAudit(tx, …)       same tx: no change without its audit row
                                 + enqueue(tx, outbox msg)  same tx: no change without its job
                                 )
      ──▶ serializer → response schema → JSON   (x-request-id header on every response)
```

### 6.5 Error model

Every deliberate failure is an `AppError` subclass with a stable machine-readable `code`:

| Class                     | HTTP | Code (default)                                            |
| ------------------------- | ---- | --------------------------------------------------------- |
| `ValidationError`         | 400  | `VALIDATION_ERROR`                                        |
| `UnauthorizedError`       | 401  | `UNAUTHORIZED`                                            |
| `PaymentRequiredError`    | 402  | `PLAN_REQUIRED` (fields: `entitlement`, `requiredPlan`)   |
| `ForbiddenError`          | 403  | `FORBIDDEN`                                               |
| `NotFoundError`           | 404  | `<RESOURCE>_NOT_FOUND`                                    |
| `ConflictError`           | 409  | e.g. `ID_CONFLICT`                                        |
| `PlanLimitError`          | 409  | `PLAN_LIMIT` (fields: `limit`, `allowed`, `requiredPlan`) |
| `RateLimitError`          | 429  | `RATE_LIMITED`                                            |
| `ServiceUnavailableError` | 503  | e.g. `NO_BILLING`                                         |

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "requestId": "0192…",
    "fields": { "purchasePrice": "must be >= 0" }
  }
}
```

Schema failures are turned back into `fields` keyed by property path, so forms can place the
message next to the input. Anything that is not an `AppError` is a bug. It goes out as a
generic 500, with details only in the logs.

### 6.6 Cross-cutting API conventions

- **Versioning.** Everything is under `/api/v1`. Breaking changes need a new version, since
  mobile builds in the field lag behind.
- **Cursor pagination** (`infrastructure/pagination.ts`). Opaque base64url `(timestamp, id)`
  cursors, default 25 and max 100. The response is
  `{ data, pagination: { nextCursor, hasMore } }`. Cursors are validated, so a garbage cursor
  is a 400 rather than a silently empty page.
- **Idempotent creates** (`infrastructure/idempotency.ts`). Clients may choose the primary key
  (a UUIDv7). A replay hits `ON CONFLICT DO NOTHING`, skips the once-only side effects (audit,
  outbox, odometer bump) and returns the existing row. If the id belongs to a row the caller
  cannot see, the result is `409 ID_CONFLICT`. This is what makes the mobile offline queue safe
  to retry.
- **Nullable fields** use `Nullable()` from `@vehicle-os/contracts`, never
  `Type.Union([X, Type.Null()])`. With Ajv coercion the union turns an explicit `null` into
  `""`.
- **Audit log** (`infrastructure/audit.ts`). Written in the same transaction as the change.
  It is append-only because no update or delete helper exists.
- **Outbox** (`infrastructure/outbox.ts`). `enqueue(tx, { queue, jobName, payload, jobKey })`
  inside the domain transaction. `jobKey` is the idempotency identity of the _work_ (for
  example `process-photo:{id}:finalize`).

### 6.7 Domain logic that lives on the server

| Logic              | File                                                      | Shape                                                                                                                                            |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Maintenance due    | `maintenance/domain/next-due.ts`                          | Pure. Each interval (distance/time/engine-hours) gives a due point and the **earliest** wins. States: `OK`, `DUE_SOON`, `OVERDUE`, `UNSCHEDULED` |
| Health score       | `health/domain/health.ts`                                 | Pure, rule-based, explainable (score + factors). **Never stored**, recomputed on read                                                            |
| Condition standing | `condition/domain/condition.ts`                           | Latest fresh score per category, overall score                                                                                                   |
| Passport           | `sharing/application/services/passport.ts`                | Built from an explicit **allowlist** of fields, per shared section                                                                               |
| Search             | `search/infrastructure/repositories/search-repository.ts` | `ILIKE` over chosen columns, membership filter **inside the SQL**                                                                                |
| Dashboard          | `dashboard/application/services/dashboard.ts`             | Composition of per-domain queries, not one giant query                                                                                           |
| Export / import    | `transfer/…/export-archive.ts`, `import-csv.ts`           | Values leave exactly as stored (minor units, original currency/unit)                                                                             |
| FX (reporting)     | `infrastructure/fx.ts`                                    | Converts summaries only. Stored amounts are never converted                                                                                      |

---

## 7. Identity, authorization and plans

Three separate questions, each answered in one place:

| Question                             | Answered by                          | Failure                     |
| ------------------------------------ | ------------------------------------ | --------------------------- |
| _Who are you?_                       | Better Auth → `actor-context.ts`     | 401                         |
| _May you do this, in this garage?_   | `domain/authz.ts` capabilities       | 404/403                     |
| _Is this included in what was paid?_ | `domain/plans.ts` → `plan-access.ts` | 402 (feature) / 409 (limit) |

### 7.1 Authentication

Better Auth runs **inside the API** at `/api/auth/*`, with Drizzle tables `users`, `sessions`,
`accounts` and `verifications` and UUIDv7 ids (see [ADR 010](docs/adr/010-authentication-provider.md)).
Routes never import it. They read `request.actor`, so replacing the provider touches only
`plugins/auth.ts` and `plugins/actor-context.ts`.

| Client                    | Credential                                                                                     | Where it's kept                             |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Web, admin                | HTTP-only session cookie (`better-auth.session_token`) + 5-min signed **compact cookie cache** | Browser                                     |
| Mobile                    | Bearer token (Better Auth `bearer` plugin, from the `set-auth-token` header)                   | `expo-secure-store`                         |
| Integrations / AI clients | Personal API key `gk_<32 random bytes base64url>`                                              | Only its **SHA-256** is stored (`api_keys`) |

- Sessions last 30 days and refresh daily. Email + password needs at least 12 characters.
  Email verification is **off** for now (no SMTP needed on a fresh clone).
- `trustedOrigins` and CORS both use exactly `[WEB_URL, ADMIN_URL]`.
- To avoid two DB round trips per mobile request, the actor plugin keeps a **per-process
  identity cache** (60 s TTL, 5,000 entries) for bearer sessions and API keys. It caches
  identity only, **never memberships**: those are read fresh on every request, so access
  changes take effect immediately. Signing out or revoking a key through the API evicts at
  once. Revocation made on another instance lags by at most 60 s.

### 7.2 Authorization: roles → capabilities

`ActorContext = { userId, email, sessionId, memberships[], … }` is built per request, with
memberships loaded from `garage_members`. Permissions are capability strings, and roles are
just sets of them:

| Role     | Capabilities                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OWNER`  | Everything                                                                                                                                                                                      |
| `ADMIN`  | Everything except `billing.manage` and `garage.delete`                                                                                                                                          |
| `MEMBER` | All reads + write vehicles, events, maintenance plans and records, tasks, ideas, expenses, documents, photos, components, condition, valuations (+ deletes for events, tasks, expenses, photos) |
| `DRIVER` | All reads + `event.write`, `maintenance.record.write`, `task.write`, `expense.write`, `photo.write`, `condition.write`: records what happened, reshapes nothing, deletes nothing, no documents  |
| `VIEWER` | All `*.read`                                                                                                                                                                                    |

The same module is shared with clients so the UI can hide actions the server would refuse.
The server re-checks every request.

### 7.3 Plans and entitlements

The subscription belongs to the **account**. A garage's entitlements are **its owner's**
(`garages.owner_id` is the billed party and moves with ownership transfer).

| Tier       | Vehicles | Garages | Members / garage | Adds                                                    |
| ---------- | -------- | ------- | ---------------- | ------------------------------------------------------- |
| `FREE`     | 3        | 1       | 2                | All record-keeping, import and export (never paywalled) |
| `PLUS`     | 6        | 3       | 5                | Paid features by tier (e.g. `passport.share`)           |
| `BUSINESS` | 100      | 25      | 25               | `income.track`, `mileage.report`, `driver.assign`, …    |

- Paid features are **entitlements** (`passport.share`, `income.track`, `mileage.report`,
  `driver.assign`), mapped to the minimum tier in `domain/plans.ts`.
- A missing feature is **402 `PLAN_REQUIRED`** (a door with a price on it). Hitting a count
  limit is **409 `PLAN_LIMIT`** (nothing is locked, there is just already as much as the plan
  holds, and removing one also fixes it). Both name the cheapest tier that fits. Clients
  handle both centrally with `planWall(error)` from `api-client` and open the upgrade dialog,
  in one place instead of on every screen.
- **Stripe is the only writer of plan state.** Checkout only redirects. The signature-verified
  webhook and `syncFromProvider` (run on the return from checkout, in case the webhook is late
  or missing) both feed one idempotent `applySubscription`.

---

## 8. Data layer (`packages/database`)

### 8.1 Stack

- **Drizzle ORM** schema in `src/schema/*.ts`, one file per domain.
- **postgres.js** pool (`createDatabase`), with `prepare: false` so it works behind
  transaction-mode poolers (PgBouncer, Neon), and `fetch_types: false`.
  `SQL_DEBUG=1` logs every statement.
- **`Database` is typed as the driver-agnostic `PgDatabase`**, so identical repository code
  runs on postgres.js in production and on PGlite in tests.
  `Executor = Database | Transaction` lets a repository method run standalone or inside a
  unit of work.
- **drizzle-kit** generates SQL migrations into `migrations/` (with `meta/` snapshots and a
  journal). `src/migrate.ts` applies them.

### 8.2 Column conventions (`schema/_shared.ts`)

| Concern     | Convention                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primary key | `uuid` **v7 generated in the app** (`primaryId()`), so ids exist before INSERT (storage keys are built in the same tx) and inserts stay index-friendly |
| Timestamps  | `timestamptz` only (`createdAt()`, `updatedAt()` with `$onUpdate`)                                                                                     |
| Date-only   | `date` columns for expiry, purchase and due dates                                                                                                      |
| Money       | `amount_minor` (bigint) + `currency` (ISO 4217); the exponent comes from the currency (JPY 0, KWD 3)                                                   |
| Distance    | Value + `distance_unit` enum (`km` / `mi`); volume/energy/mass via `volume_unit` / `quantity_unit`                                                     |
| Soft delete | `deleted_at` **only** on tables where the domain needs it (vehicles, documents, photos, tasks, ideas)                                                  |
| Enums       | Postgres enums generated from the `as const` arrays in `@vehicle-os/domain`                                                                            |

### 8.3 Tables

| Area                   | Tables                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Identity (Better Auth) | `users`, `sessions`, `accounts`, `verifications`                                                                                    |
| Identity (product)     | `user_profiles` (locale, timezone, currency, units), `api_keys`, `device_tokens`                                                    |
| Tenancy                | `garages` (owner = billed party, `cost_reporting` mode), `garage_members` (role)                                                    |
| Vehicles               | `vehicles` (type, identity, odometer + unit, status, primary photo), `vehicle_photos`                                               |
| Timeline               | `vehicle_events` (typed events: fuel/charge with quantity, unit, price, location; trips with purpose and driver; repairs; notes; …) |
| Work                   | `maintenance_plans`, `maintenance_records`, `tasks`, `ideas`                                                                        |
| Money                  | `expenses`, `vehicle_income`, `valuations`, `subscriptions`                                                                         |
| Records                | `documents` (type, storage key, expiry), `condition_assessments`, `condition_items`                                                 |
| Sharing                | `share_links` (token, scope/sections, revocable)                                                                                    |
| Notifications          | `notifications`, `notification_preferences`, `notification_deliveries` (per channel)                                                |
| Platform               | `outbox_messages` (job queue), `audit_logs` (append-only), `app_settings` (flag overrides), `ai_requests` (usage/tokens)            |

### 8.4 Migration safety

Three layers stop "schema changed but the database didn't":

1. **CI** runs `pnpm db:generate` and fails if it produces a diff (schema edited without a
   migration).
2. **Tests** apply the real migration files to PGlite, not a schema push.
3. **Startup** runs `assertNoMigrationDrift` (`src/drift.ts`), which compares the journal with
   the database's applied migrations and **refuses to boot**, naming the missing one. The
   motivation: a column shipped missing once, passed every test, and 500'd in the browser.

Migrations are immutable once applied. `pnpm db:migrate` applies pending ones.

---

## 9. Background work (`workers/worker`)

### 9.1 The outbox _is_ the queue

There is no Redis or BullMQ in the job path. The API writes a row to `outbox_messages` in
the same transaction as the domain change, and the worker runs rows directly from that
table. (It used to copy them into BullMQ. Removing that removed the whole Redis bill, since
every poll and lock renewal was a billed command.)

```text
API request tx ─┬─ INSERT domain rows
                └─ INSERT outbox_messages (queue, job_name, payload, job_key, available_at=now)
                          │  committed together, or not at all
                          ▼
Worker runner loop:
  claimDue():  UPDATE outbox SET available_at = now()+5 min, attempts = attempts+1
               WHERE id IN (SELECT id … WHERE processed_at IS NULL AND dead_lettered_at IS NULL
                                        AND available_at <= now()
                            ORDER BY available_at LIMIT n  FOR UPDATE SKIP LOCKED)
               RETURNING *                     ← one statement: claim + lease, no held tx
  run handler (lease renewed every 60 s while running)
    ├─ success          → processed_at = now()
    ├─ error            → last_error, available_at = now() + 2s·2^(attempts-1)   (2, 4, 8, 16 s…)
    ├─ PermanentError   → dead_lettered_at = now()   (no pointless retries)
    └─ attempts ≥ 5     → dead_lettered_at = now()   (kept for a human, visible in admin)
```

- **At-least-once.** A crashed worker's lease simply expires and the row runs again, so
  **every handler is idempotent** (it checks state before acting, e.g. "cutout already
  exists", or relies on unique delivery rows).
- Uses the **database clock** (`now()`), so replicas agree on what is due. `SKIP LOCKED` makes
  multiple worker replicas safe.
- A partial index (`outbox_pending_idx … WHERE processed_at IS NULL AND dead_lettered_at IS
NULL`) keeps the claim query the size of the backlog, not the size of history.
- `available_at` has three jobs: back-off, the running lease, and **delayed delivery** (quiet
  hours).
- A job with no registered handler is a deploy mismatch. It is dead-lettered immediately.

### 9.2 Scheduler

In-process timers write ordinary outbox rows. The job key is the time slot
(`scheduled:<name>:<ISO slot>`), and a slot already in the table is not written again, so
several replicas or a restart's catch-up add nothing.

| Job                        | When (UTC)         | Does                                                         |
| -------------------------- | ------------------ | ------------------------------------------------------------ |
| `scan-recalls`             | Mon 06:00 (weekly) | NHTSA recalls by make/model/year → notifications             |
| `scan-due-maintenance`     | daily 07:00        | Plans turning due/overdue → notifications                    |
| `scan-expiring-documents`  | daily 08:00        | Documents nearing expiry → notifications                     |
| `collect-document-objects` | daily 03:00        | Garbage-collect orphaned storage objects (batched)           |
| `prune-outbox`             | daily 04:00        | Delete processed rows older than 14 days (dead letters kept) |

### 9.3 Handlers

| Job name                                                                    | Handler                   | Enqueued by                              |
| --------------------------------------------------------------------------- | ------------------------- | ---------------------------------------- |
| `scan-due-maintenance`, `maintenance-completed`                             | `handlers/maintenance.ts` | Scheduler; completing maintenance        |
| `scan-expiring-documents`, `collect-document-objects`                       | `handlers/documents.ts`   | Scheduler                                |
| `scan-recalls`                                                              | `handlers/recalls.ts`     | Scheduler                                |
| `deliver-maintenance-reminder`, `deliver-document-expiry`, `deliver-recall` | `handlers/delivery.ts`    | The scans                                |
| `process-photo`, `delete-photo-objects`                                     | `handlers/images.ts`      | Photo finalize / primary change / delete |
| `prune-outbox`                                                              | `handlers/index.ts`       | Scheduler                                |

### 9.4 Notification pipeline

```text
scan (daily, UTC) ──tx──▶ notifications row (in-app; visible at once in the bell)
                     └──▶ outbox "deliver-…" job
deliver job ──▶ read notification_preferences (per type × channel)
            ──▶ hold until 08:00 in the recipient's own timezone (available_at)   ← quiet hours
            ──▶ email via Resend  ·  push via Expo Push (device_tokens)
            ──▶ notification_deliveries row per channel (dedupe on retry)
```

A single UTC schedule never wakes anyone at 03:00, because delivery is shifted per recipient.
Provider 4xx responses (other than 408/429) are `DeliveryRefusedError`, so they fail once and
are not retried five times. Reserved test domains (`.test`, `.example`, …) are never mailed.

---

## 10. Files and object storage

Binary content never passes through the API and never goes into Postgres.

```text
1. Client ──POST /vehicles/:id/photos (name, type, size)──▶ API
            API: capability + plan check, create row (unfinalized), key =
                 garages/{garageId}/vehicles/{vehicleId}/photos/{photoId}
            ◀── { photoId, uploadUrl (presigned PUT, short-lived) }
2. Client ──PUT bytes──────────────────────────────────▶ Object storage
3. Client ──POST …/photos/:photoId/finalize──────────────▶ API
            API: HEAD the object (exists? real size/type/checksum) → mark finalized
                 + outbox "process-photo"   (same tx)
4. Worker: if this is the primary photo and no cutout exists yet →
            signed GET URL → Pixelcut → PNG cutout stored at "{key}-cutout"
```

- **`StoragePort`** (`createUploadUrl`, `createDownloadUrl`, `head`, `delete…`) has these
  adapters: **S3** (R2, MinIO, AWS; path- or virtual-host style), **Upstash Blob** (one token,
  self-refreshing credentials; wins if set), **unconfigured** (throws 503), and **memory**
  (tests). `infrastructure/storage/factory.ts` is the only place one is chosen, and the worker
  uses the same factory.
- Keys are **tenant-scoped**, and **nothing in the bucket is public**. Reads use presigned GET
  URLs: photos 1 h (they sit in cached galleries), documents shorter. Clients key their image
  cache by photo id, not by URL.
- A row whose object never arrives stays unfinalized and is invisible to every read. The daily
  `collect-document-objects` job and `delete-photo-objects` clean storage after deletes.

---

## 11. External providers (ports and adapters)

Every integration follows the same pattern: a small interface or module, `fetch` with a
deadline (no vendor SDK unless it earns its place), and **null or a typed "unavailable"
instead of a crash**.

| Provider                      | Module                                                            | Failure behaviour                                                            |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Object storage                | `infrastructure/storage/*` (`StoragePort`)                        | 503 on file endpoints only                                                   |
| AI (Gemini)                   | `modules/ai/infrastructure/gemini-provider.ts` (`AiProviderPort`) | 503 on `/ai/ask`                                                             |
| Stripe                        | `infrastructure/stripe.ts`                                        | Free plan for all; `NO_BILLING` 503 on billing actions                       |
| Email (Resend), Push (Expo)   | `notifications/application/services/deliver.ts`                   | Channel skipped, logged; in-app unaffected                                   |
| VIN decode (NHTSA vPIC)       | `infrastructure/vin.ts`                                           | `null`: the user types make and model themselves                             |
| Recalls (NHTSA)               | `infrastructure/recalls.ts`                                       | `null`: try again next week. Results mean "vehicles like yours", not "yours" |
| FX rates                      | `infrastructure/fx.ts` (1 h in-process cache)                     | Summary shows per-currency totals without conversion                         |
| Background removal (Pixelcut) | `workers/worker/src/background-removal.ts`                        | Original photo used; permanent vs retryable errors separated                 |

---

## 12. AI assistant and MCP server

### 12.1 `/api/v1/ai/ask`: tool-using Q&A

```text
question ─▶ Gemini (system prompt + fixed tool catalogue) ─▶ tool calls
         ─▶ tool-runner executes them AS THE CALLER (same garages, same capabilities)
         ─▶ real rows back to the model ─▶ … at most 5 rounds ─▶ answer, proposal or choices
```

- The model **never touches the database or SQL**. It can only call a fixed list of
  **read-only** tools (`list_vehicles`, `get_vehicle_profile`, `get_vehicle_costs`, …) defined
  in `modules/ai/domain/tools.ts`. The worst a prompt injection can do is ask a question the
  caller was already allowed to ask.
- It may **propose** a change (`propose_*` tools: add a vehicle, log an entry, rename a
  garage, delete an entry…) or **ask the person to choose** (`ask_to_choose`). Neither writes:
  the server checks every id against the caller's garages, refuses to let the model pick
  between several of the person's things the line never named (`guardGuess`), and returns the
  proposal as data. The web console shows it as a form; Approve is the person's own request to
  the ordinary endpoint. Which kinds may be proposed is the person's choice (`allow`).
- There is a hard cap of 5 tool rounds per question and a per-account rate limit
  (6/min in production) on top of the global one, so one account cannot drain the shared
  provider quota.
- Token usage for each answer is written to `ai_requests` and shown in the admin console.

### 12.2 `/api/v1/mcp`: Garaj as MCP tools

- A **stateless** Streamable HTTP MCP server (`@modelcontextprotocol/sdk`). Each POST builds a
  server, answers one JSON-RPC message with plain JSON (`enableJsonResponse`, no SSE) and is
  done, so it scales like any route and survives restarts.
- Auth is the API's own: `Authorization: Bearer gk_…` (a personal API key from Settings → API
  & MCP) or a session.
- Each tool maps to a REST route. The call is **replayed through `fastify.inject()` with the
  caller's credentials**, so a tool is exactly as permitted as the route behind it, and reuses
  its validation, authz, plan checks and audit. Replies over 60k chars are truncated.
- `apps/docs` documents the endpoint (`/mcp` page) next to the REST reference.

---

## 13. Clients

All clients are **thin**. They render server state and send commands, and any "business"
figure they show comes from the API. The pure helpers they share (`domain`, `ui`) are for
presentation and early UI feedback only.

### 13.1 Web (`apps/web`, Next.js 15, :3000)

- **App Router with client-side data.** Pages are client components fetching through TanStack
  Query from the API. The browser calls the API **directly** (`NEXT_PUBLIC_API_URL`) with its
  cookie. There are no Next route handlers, server actions or middleware in the data path, and
  the few server `page.tsx` files are redirects kept for old links.
- **Routes:** `/` (garage), `/garages/[garageId]`, `/vehicles/[vehicleId]/{history,
maintenance, tasks, documents, photos, statistics, value, details}`, `/tasks`, `/search`,
  `/ask` (AI), `/settings`, `/sign-in`, `/sign-up`, and `/p/[token]` (public passport, no
  session).
- **Auth gating** happens in `AppShell` with `useSession()` from `better-auth/react`, which
  redirects to `/sign-in`. The API remains the real gate.
- **One `QueryClient` policy** (`app/providers.tsx`): 60 s `staleTime`; never retry 4xx; a
  global `MutationCache` raises a success/error toast for every mutation (opt out with
  `meta: { toast: false }`) and opens the **upgrade dialog on any plan wall**
  (`PLAN_REQUIRED` / `PLAN_LIMIT`).
- **Design system.** "Carbon & Ink" tokens in Tailwind v4's `@theme` (`globals.css`), kept
  identical to `packages/ui/src/tokens.ts` by `theme-tokens.test.ts`. Surfaces are separated by
  contrast rather than borders, and there is one focus ring. Primitives live in
  `components/ui/*`, animated beUI pieces in `components/motion/*`.
- **Preferences** (theme, reduced motion) are plain modules read with `useSyncExternalStore`.
  An inline `theme-script` prevents a flash of the wrong theme.
- `next.config.mjs` loads the **root** `.env`, transpiles workspace packages, and deliberately
  has **no `images.remotePatterns`** (signed URLs are drawn with `<img>`, so `/_next/image`
  cannot become an open resize proxy).

### 13.2 Admin console (`apps/admin`, Vite + React 19, :3002)

- A single-page operator console with hash routing (`#/section/id?filters`) through a
  `useSyncExternalStore` hook, and no router library. A list's search and filters are the query
  (server-side filters, so a filtered list is a link); the id opens a record in a side sheet
  over its list, walked with J/K. Sections: overview, analytics (AI and delivery), system,
  logs (audit changes, and one stream of AI, email, push and outbox failures), users, garages,
  vehicles, settings (feature flags, who has access).
- A command palette (⌘K or `/`) searches people, garages and vehicles and runs actions — set a
  plan, verify an email, sign someone out, flip a flag — a step at a time. `G` then a letter
  goes to a section, `R` refreshes what is on screen, `?` lists the shortcuts.
- Charts are hand-drawn SVG against the web app's tokens (no chart library), each with a table
  behind it for screen readers.
- Talks to `/api/v1/admin/*` with a small `fetch` helper and cookie auth. Access requires the
  user id to be in `ADMIN_USER_IDS` (ids, not emails, because sign-up does not verify email).
- Reuses the web app's components through the `@/` alias, with `next/link` and `next/image`
  shimmed to plain elements. Vite `dedupe` keeps a single React, motion and Query instance.

### 13.3 Landing (`apps/landing`, Next.js, :3003)

A marketing site on its own origin, so it can be cached and indexed independently. It is built
from the product's own components and stylesheet via `@/` (`externalDir` + Turbopack root at
the repo). Screenshots in `src/assets` are real captures of a seeded garage in both themes.
It also has `opengraph-image.tsx`, `robots.ts` and `sitemap.ts`. Its CTAs link to
`NEXT_PUBLIC_APP_URL`.

### 13.4 Developer docs (`apps/docs`, Next.js, :3004)

The API reference is **rendered from the running API's `/api/v1/openapi.json`** (re-read every
5 minutes), so the docs cannot drift from what the server validates. Pages: overview,
authentication, errors, reference, MCP.

### 13.5 Mobile (`apps/mobile`, Expo SDK 52)

- **Navigation:** Expo Router with typed routes. `(tabs)` (home, vehicles, tasks, settings)
  plus stacks for `vehicle/[id]`, `event/[id]`, `document/[id]`, `add/*` quick-entry flows,
  notifications, plan and upgrade screens.
- **Auth:** two plain `fetch` calls to Better Auth (no auth client in the bundle). The token is
  kept in SecureStore and sent as a bearer. `credentials: 'omit'`, because React Native's
  global cookie jar would otherwise trigger Better Auth's CSRF origin check.
- **API base URL:** `expo.extra.apiUrl` if set, otherwise the Metro host's LAN address
  (`localhost` on a phone means the phone).
- **Reads:** TanStack Query persisted to AsyncStorage for 24 h, so the app opens instantly
  with the last known data.
- **Writes: offline-first queue** (`lib/offline.ts`). Every write (event, maintenance, task,
  vehicle create/update/archive, profile, garage, document/photo upload) is stored as a
  **named action** rather than a raw HTTP request, shows in the feed immediately, and drains
  on launch, on foreground, on a timer, and right after it is queued. Creates carry
  **client-chosen UUIDv7 ids**, so replays are idempotent (§6.6) and later queued writes can
  refer to a vehicle created offline. Server 4xx refusals move to `failed` with the reason
  ("Not saved", discardable). Upload bytes are copied to durable app storage first (50 MB
  cap).
- **Push:** permission is requested after sign-in, not at launch. The Expo token is registered
  with the API (`device_tokens`), and failures are silent (in-app and email still work).
- **Monorepo bundling:** `metro.config.js` watches the workspace root, resolves both
  `node_modules` trees, and keeps hierarchical lookup **on** (pnpm's symlinked layout needs
  it).
- **React versions:** mobile runs React 18 (Expo 52), while the workspace pins
  `@types/react` to 19 so web has a single React type identity. Mobile therefore typechecks
  against React 19 types, and a 19-only API (`use()`, ref-as-prop) would typecheck but fail
  at runtime. Avoid them in `apps/mobile`.

---

## 14. Shared packages

| Package                  | Contents                                                                                                                                                                                                                                                                                                                           | Consumed by                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `@vehicle-os/contracts`  | TypeBox schemas per area (`vehicles.ts`, `expenses.ts`, …, `common.ts` with `Nullable`, `StandardErrors`). The API validates against them, and the clients import their `Static<>` types                                                                                                                                           | api, api-client, web, admin, mobile |
| `@vehicle-os/domain`     | Pure, dependency-free: enums (`VEHICLE_TYPES`, `GARAGE_ROLES`, `PLAN_TIERS`, …), `Money` (minor units, per-currency exponent), units and conversion, `authz` (capabilities/roles), `plans` (entitlements/limits), vehicle capabilities (`odometer`, `engineHours`, `hull`, `chain`, …, so nothing assumes "car") and vehicle specs | everything                          |
| `@vehicle-os/api-client` | `createApiClient({ baseUrl })`: typed methods over `fetch`, `ApiError`, `planWall()`, `Page<T>`. The `/react` entry has TanStack **query keys and query builders**, so a mutation anywhere invalidates the right caches everywhere                                                                                                 | web, admin, mobile                  |
| `@vehicle-os/database`   | Drizzle schema, migrations, `createDatabase`, `assertNoMigrationDrift`, and `/testing` → `createTestDatabase()` on PGlite                                                                                                                                                                                                          | api, worker                         |
| `@vehicle-os/ui`         | Design tokens as data (`DARK_TOKENS`/light), colour and contrast helpers, pure presentation logic (activity, health, report, vehicle facts, makes). Web mirrors the tokens in CSS, mobile builds StyleSheets from them. They share **values, not mechanism**                                                                       | web, admin, landing, docs, mobile   |
| `@vehicle-os/config`     | `env()`: TypeBox-validated, cached env with defaults. `loadEnvFile()` walks up to the root `.env`. `objectStorage()` resolves S3 vs Upstash (all-or-nothing S3 vars). Feature flags                                                                                                                                                | api, worker, database               |
| `@vehicle-os/utils`      | `newId()` (UUIDv7), date-only helpers (`addMonths`, `daysBetween`, `toDateOnly`), assertions                                                                                                                                                                                                                                       | api, worker, database, mobile       |

The contract flow that keeps three apps on one set of types:

```text
packages/contracts (TypeBox)
   ├──▶ apps/api route schemas ──▶ Ajv validation at runtime
   │                           └─▶ @fastify/swagger ──▶ /openapi.json ──▶ apps/docs
   └──▶ packages/api-client (Static<> types) ──▶ web · admin · mobile
A contract change is a compile error in every client, not a runtime surprise.
```

---

## 15. Configuration and feature flags

### 15.1 One `.env`, at the repo root

`@vehicle-os/config`'s `loadEnvFile()` walks up to find it for the API, worker and database
scripts. The Next apps load it explicitly in `next.config.mjs`. Only Expo reads its own
`apps/mobile/.env` (for `EXPO_PUBLIC_*`). The schema (`packages/config/src/env.ts`) is
**validated at startup**, so a missing `DATABASE_URL`, a short `AUTH_SECRET` (under 32 chars)
or a half-configured S3 block fails the boot with a clear message.

| Group       | Variables                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core        | `NODE_ENV`, `LOG_LEVEL`, `API_HOST`, `API_PORT`, `DATABASE_URL`, `DATABASE_POOL_MAX`                                                                              |
| Auth / URLs | `AUTH_SECRET`, `AUTH_URL`, `WEB_URL`, `ADMIN_URL`, `ADMIN_USER_IDS`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_DOCS_URL` |
| Redis       | `REDIS_URL`                                                                                                                                                       |
| Storage     | `UPSTASH_BLOB_TOKEN` **or** `OBJECT_STORAGE_{ENDPOINT,REGION,BUCKET,ACCESS_KEY,SECRET_KEY,FORCE_PATH_STYLE}`                                                      |
| AI          | `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_FALLBACK_MODEL`                                                                                                     |
| Billing     | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_BUSINESS`, `STRIPE_PORTAL_CONFIGURATION`                                         |
| Delivery    | `RESEND_API_KEY`, `EMAIL_FROM`, `EXPO_ACCESS_TOKEN`                                                                                                               |
| Lookups     | `VPIC_URL`, `RECALLS_URL`, `FX_RATES_URL`                                                                                                                         |
| Media       | `BG_REMOVAL_URL`, `BG_REMOVAL_API_KEY`, `NEXT_PUBLIC_LOGO_DEV_TOKEN`, `EXPO_PUBLIC_LOGO_DEV_TOKEN`                                                                |
| Reserved    | `POSTHOG_KEY`, `SENTRY_DSN`, `OPENAI_API_KEY` (declared, not yet used)                                                                                            |

### 15.2 Feature flags (`packages/config/src/flags.ts`)

`ai`, `ocr`, `passport`, `advancedAnalytics`, `obd`, `billing`, `experimentalUi`.

- **Defaults derive from configuration.** `ai` and `ocr` are on only when `AI_API_KEY` is set,
  `billing` only when `STRIPE_SECRET_KEY` is set, `passport` is on, and `experimentalUi` is on
  outside production.
- **Overrides** are set in the admin console and stored in `app_settings` (key `flags`). An
  override cannot switch on a flag whose dependency is missing (`flagAvailable`).
- **The server decides.** Clients receive flags only as hints for hiding UI, and gated routes
  check `isEnabled` themselves.

---

## 16. Security model

| Threat / concern           | Control                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Cross-tenant access (IDOR) | Memberships loaded server-side per request; `requireVehicleAccess` derives the garage from the DB row; non-members get **404** |
| Privilege creep            | Capability sets per role in one pure module, unit-tested as a matrix                                                           |
| Mass assignment            | Ajv `removeAdditional: false`: unknown body fields → 400                                                                       |
| Injection                  | Drizzle parameterised queries; filters are validated enums, never client SQL                                                   |
| Credential leakage in logs | Pino redaction of auth headers, cookies, passwords and tokens                                                                  |
| Session theft / CSRF       | HTTP-only cookies, explicit CORS + `trustedOrigins` allowlist with credentials, Better Auth origin checks                      |
| API keys                   | `gk_` prefix (scanner-friendly), 256-bit random, only SHA-256 stored, revocable                                                |
| Brute force / abuse        | Global rate limit (keyed by actor, else IP), stricter per-account AI limit (§12)                                               |
| Public data exposure       | Private bucket + short-lived signed URLs; passport built from an explicit field allowlist, per-section, revocable              |
| Open proxy                 | No `next/image` remote patterns                                                                                                |
| Headers                    | `@fastify/helmet` (CSP left to the web app)                                                                                    |
| Data integrity             | Transactions for multi-row writes; audit and outbox in the same tx; append-only audit                                          |
| Supply chain               | pnpm blocks dependency postinstall scripts except an explicit `allowBuilds` list                                               |
| Payments                   | Plan state written only from Stripe (verified webhook or server-side sync), never from the redirect                            |
| AI                         | Read-only tool catalogue executed with the caller's permissions; bounded rounds                                                |

---

## 17. Observability

- **Structured logs.** Pino JSON lines in production and pretty output in dev. Every log line,
  error body and audit row carries the same **UUIDv7 request id**, echoed as `x-request-id`,
  so an id from a user's error message finds the whole request.
- **Audit log** (`audit_logs`): actor, email (kept after account deletion), garage, action,
  resource, metadata, request id, IP.
- **Admin console:** overview metrics and the activation funnel, users and garages, the audit
  log with its volume by day, one stream of failures (AI, email, push, outbox dead letters), AI
  usage (`ai_requests` tokens), system status (DB, Redis, storage, providers) and flag management.
- **Health endpoint:** `GET /api/v1/health`.
- **Not yet wired:** Sentry (errors), PostHog (product analytics), OpenTelemetry. The env keys
  are reserved.

---

## 18. Testing

| Level       | Where                                                                                                                                                                  | How                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `packages/{domain,utils,ui,…}/src/*.test.ts`, `apps/api/src/**/*.test.ts`, `workers/worker/src/**/*.test.ts`, `apps/web/src/**/*.test.ts`, `apps/mobile/lib/*.test.ts` | Vitest. Pure logic: money, units, authz matrix, plans, next-due, health, condition, CSV, VIN, FX, dispatcher back-off, scheduler slots, offline queue, theme-token parity, contrast                                                                                           |
| Integration | `apps/api/test/*.test.ts` (+ `harness.ts`)                                                                                                                             | The **whole app** via `buildApp({ db: PGlite, redis: null, storage: memory, ai: fake })` driven with `app.inject()`: real routes, validation, Better Auth, authz, plans, transactions. **No containers or network** ([ADR 011](docs/adr/011-pglite-for-integration-tests.md)) |
| E2E (web)   | `pnpm test:e2e` → `playwright test`                                                                                                                                    | Script reserved; no Playwright config or specs in the repo yet                                                                                                                                                                                                                |

`pnpm test` works on a clean checkout with no database, no `.env` values and no Docker.

---

## 19. Tooling, CI and local development

### 19.1 Turborepo tasks (`turbo.json`)

| Task               | Depends on | Cached | Notes                                    |
| ------------------ | ---------- | ------ | ---------------------------------------- |
| `build`            | `^build`   | yes    | Outputs `dist/**`, `.next/**`            |
| `typecheck`        | `^build`   | yes    | `tsc --noEmit` in every workspace        |
| `lint`             | none       | yes    | ESLint flat config from `tooling/eslint` |
| `test:unit`        | `^build`   | yes    |                                          |
| `test:integration` | `^build`   | no     |                                          |
| `dev`              | none       | no     | Persistent                               |

### 19.2 CI (`.github/workflows/ci.yml`)

On push to `main` and on PRs (concurrency-cancelled). Ubuntu, Node 22, pnpm 11,
`--frozen-lockfile`:

```text
format:check → typecheck → lint → test:unit → test:integration → build → migrations-up-to-date
```

The last step runs `db:generate` and fails if `packages/database/migrations` changed. CI
needs no services, because integration tests use PGlite and dummy env vars satisfy config
validation.

### 19.3 Local development

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL and AUTH_SECRET at minimum
docker compose up -d          # optional: Postgres :5432, Redis :6379, MinIO :9000 (console :9001)
pnpm db:migrate
pnpm dev                      # runs every workspace's dev script via Turbo
pnpm --filter @vehicle-os/mobile start   # Expo / Metro
```

| Port                      | Service                                           | URL                                               |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| 3000                      | Web app                                           | `http://localhost:3000`                           |
| 3001                      | API · Swagger UI · OpenAPI                        | `/api/v1/health`, `/docs`, `/api/v1/openapi.json` |
| 3002                      | Admin console                                     | `http://localhost:3002`                           |
| 3003                      | Landing site                                      | `http://localhost:3003`                           |
| 3004                      | Developer docs                                    | `http://localhost:3004`                           |
| 5432 / 6379 / 9000 / 9001 | Postgres / Redis / MinIO / MinIO console (Docker) |                                                   |

Hosted alternatives work unchanged: Neon for Postgres, Upstash for Redis and Blob.

| Command                                     | Does                                             |
| ------------------------------------------- | ------------------------------------------------ |
| `pnpm typecheck` / `lint` / `format`        | Across all workspaces                            |
| `pnpm test` (= `test:unit`)                 | Unit suites                                      |
| `pnpm test:integration`                     | API integration suite on PGlite                  |
| `pnpm db:generate`                          | SQL migration from a schema change               |
| `pnpm db:migrate` / `db:studio` / `db:seed` | Apply migrations / browse / seed demo data       |
| `pnpm --filter @vehicle-os/web shadcn…`     | Vendor a beUI component into `components/motion` |

### 19.4 Deployment shape

The repo contains no deployment manifests. What the code assumes:

- **API** and **worker** are separate long-running Node processes (`build` → `dist/`,
  `start` → `node dist/…`), both handle SIGTERM gracefully, and both scale horizontally (rate
  limit via Redis, outbox via `SKIP LOCKED`, scheduler via slot keys).
- **Web, landing, docs** are standard Next.js builds. **Admin** is a static Vite bundle.
- **Mobile** ships through EAS, pointing `expo.extra.apiUrl` at the deployed API.
- **Postgres** must be migrated before the new API version boots (the drift check enforces
  it). Keep Redis in the same region as the API, since each rate-limit check is a round trip.

---

## 20. Where the build departs from the original spec

`docs/Architecture.md` was written before implementation. These are the places where the
code chose differently, and why:

| Spec said                        | Built                                                                               | Reason                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Redis + **BullMQ** for jobs      | **Postgres outbox is the queue** (`SKIP LOCKED` + lease)                            | Removed Redis from the job path and its per-command bill; one fewer moving part, same at-least-once semantics |
| Redis for cache, sessions, locks | Redis **only** for the production rate-limit counter                                | Everything else is Postgres or per-process                                                                    |
| OpenAI                           | **Gemini** behind a provider-neutral `AiProviderPort`                               | Free tier; vendor is one adapter, env named by role (`AI_*`)                                                  |
| Plans FREE / PRO / CONNECTED     | **FREE / PLUS / BUSINESS**, entitlements + limits                                   | Pay for scale and business reporting; record-keeping always free                                              |
| Client generated from OpenAPI    | Hand-written client typed by **shared TypeBox contracts**                           | Same guarantee (one source of types), no codegen step                                                         |
| Zustand for local UI state       | `useSyncExternalStore` over plain modules                                           | A few values; no dependency needed                                                                            |
| React Hook Form                  | Native forms + controlled inputs                                                    | Not needed so far                                                                                             |
| shadcn/ui                        | Own primitives + **beUI** vendored via shadcn CLI                                   | Matches the Garaj design system                                                                               |
| Expo SQLite + sync outbox        | **AsyncStorage** named-action queue + persisted Query cache                         | Enough for quick entry; ceiling documented                                                                    |
| Postgres full-text / `pg_trgm`   | `ILIKE` with membership filter in SQL                                               | Garage-scale data; upgrade path behind the same function                                                      |
| Sentry, PostHog                  | Env keys reserved, not wired                                                        | Pending                                                                                                       |
| Playwright / Maestro E2E         | Script only                                                                         | Pending                                                                                                       |
| Storage: R2 recommended          | S3-compatible adapter **plus Upstash Blob** adapter                                 | One-token setup in hosted dev                                                                                 |
| (not in spec)                    | **MCP server**, personal API keys, developer docs site, admin console, landing site | Integrations and operations                                                                                   |

Implemented from the roadmap: phases 1–7 (foundation, core domain, maintenance, financials,
documents, product experience, passport/condition/valuation/sharing/export), plus AI Q&A,
notification delivery, VIN decode, recalls, business mileage and income. Not built: OCR
(needs a vision provider), OBD/telemetry, service-provider access, marketplace.

---

## 21. Deliberate ceilings and their upgrade paths

The code marks intentional simplifications with `ponytail:` comments. List them all with
`grep -rn "ponytail:" --include=*.ts --include=*.tsx .`. The architecturally significant
ones:

| Simplification                                         | Ceiling                                                   | Upgrade when it bites                            |
| ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------ |
| Per-process identity cache (`actor-context.ts`)        | ≤60 s revocation lag across instances; each warms its own | Shared cache (Redis) if instances multiply       |
| Per-process FX cache (`fx.ts`)                         | One fetch per hour per instance                           | Cache in Postgres/Redis                          |
| `ILIKE` search (`search-repository.ts`)                | Sequential scan per table                                 | `pg_trgm` GIN indexes, then `tsvector`, same API |
| Mobile offline queue in AsyncStorage (`offline.ts`)    | Rewritten whole on each change (~hundreds of items)       | SQLite-backed queue                              |
| Mobile local file copies (`local-files.ts`)            | Flat 50 MB cap                                            | Per-vehicle quota / LRU                          |
| Admin, landing and docs import `apps/web/src` via `@/` | Cross-app coupling                                        | Move shared components into `packages/ui`        |
| Document object GC, one batch per daily run            | Large backlog drains over days                            | Loop until empty or run more often               |
| `react-canary.d.ts` for `<ViewTransition>`             | Relies on experimental React                              | Delete once `<ViewTransition>` is stable         |
