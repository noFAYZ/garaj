# Vehicle OS — Architecture

## 1. Document Status

**Project:** Vehicle OS / Digital Garage
**Document:** `architecture.md`
**Status:** Proposed / Implementation Baseline
**Architecture Style:** Modular Monolith + Shared TypeScript Packages
**Primary Backend:** Fastify + TypeScript
**Primary Database:** PostgreSQL

This document defines the technical architecture for the Vehicle OS platform described in `PRD.md`.

The architecture is designed around four principles:

1. **The backend owns the domain and is the source of truth.**
2. **The product starts as a modular monolith, not microservices.**
3. **The architecture must support future connected-vehicle and AI capabilities without requiring a rewrite.**
4. **Mobile and web are clients of the same API and domain model.**

---

# 2. Product Architecture

Vehicle OS is a multi-platform application consisting of:

- Web application
- Mobile application
- REST API
- Background worker system
- PostgreSQL database
- Object/file storage
- Redis
- AI services
- Notification services
- Analytics and observability

High-level architecture:

```text
                         ┌─────────────────────┐
                         │      Web App        │
                         │ Next.js + React     │
                         └──────────┬──────────┘
                                    │
                                    │ HTTPS / REST
                                    │
┌─────────────────────┐             ▼
│   Mobile App        │      ┌──────────────────┐
│ React Native + Expo │─────▶│  Fastify API     │
└─────────────────────┘      │  TypeScript      │
                             └────────┬─────────┘
                                      │
                    ┌─────────────────┼──────────────────┐
                    │                 │                  │
                    ▼                 ▼                  ▼
             ┌────────────┐    ┌────────────┐    ┌─────────────┐
             │ PostgreSQL │    │   Redis    │    │ Object      │
             │            │    │            │    │ Storage     │
             └────────────┘    └─────┬──────┘    │ R2 / S3     │
                                     │             └─────────────┘
                                     ▼
                              ┌──────────────┐
                              │ Worker       │
                              │ BullMQ       │
                              └──────┬───────┘
                                     │
                  ┌──────────────────┼────────────────────┐
                  ▼                  ▼                    ▼
             ┌──────────┐      ┌──────────┐       ┌────────────┐
             │ AI       │      │ OCR      │       │ Notifications│
             │ Services │      │ Pipeline │       │ / Emails    │
             └──────────┘      └──────────┘       └────────────┘
```

---

# 3. Technology Stack

## 3.1 Core

| Layer               | Technology                                        |
| ------------------- | ------------------------------------------------- |
| Language            | TypeScript                                        |
| Package manager     | pnpm                                              |
| Monorepo            | Turborepo                                         |
| API                 | Fastify                                           |
| Database            | PostgreSQL                                        |
| ORM / Query Builder | Drizzle ORM                                       |
| API contracts       | TypeBox + JSON Schema                             |
| API documentation   | OpenAPI / Swagger                                 |
| Authentication      | Auth provider behind application auth abstraction |
| Object storage      | S3-compatible storage, initially Cloudflare R2    |
| Cache / queues      | Redis                                             |
| Background jobs     | BullMQ                                            |
| Web                 | Next.js + React                                   |
| Mobile              | React Native + Expo                               |
| Web UI              | Tailwind CSS + shadcn/ui                          |
| Mobile navigation   | Expo Router                                       |
| Client server state | TanStack Query                                    |
| Local UI state      | Zustand                                           |
| Forms               | React Hook Form                                   |
| Analytics           | PostHog                                           |
| Error monitoring    | Sentry                                            |
| Payments            | Stripe                                            |
| AI                  | OpenAI API                                        |
| CI/CD               | GitHub Actions                                    |
| Web hosting         | Vercel                                            |
| API/worker hosting  | Container-based platform                          |
| Testing             | Vitest + Playwright + mobile E2E tooling          |

---

# 4. Architectural Style

Vehicle OS uses a **modular monolith**.

The backend is deployed initially as one Fastify application with logically separated domain modules.

It is intentionally **not**:

- Microservices
- Event-sourced
- GraphQL-first
- Serverless-only
- Database-driven from clients
- AI-driven
- Fleet-management architecture

The modular monolith provides clear domain boundaries while keeping:

- development simple
- deployments simple
- transactions straightforward
- debugging straightforward
- infrastructure inexpensive
- local development easy

Individual modules can later be extracted into services if scale genuinely requires it.

---

# 5. Monorepo

Recommended repository structure:

```text
vehicle-os/
│
├── apps/
│   │
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   │
│   │   │   ├── config/
│   │   │   ├── plugins/
│   │   │   ├── middleware/
│   │   │   ├── infrastructure/
│   │   │   │
│   │   │   └── modules/
│   │   │       ├── auth/
│   │   │       ├── users/
│   │   │       ├── garages/
│   │   │       ├── vehicles/
│   │   │       ├── events/
│   │   │       ├── maintenance/
│   │   │       ├── tasks/
│   │   │       ├── ideas/
│   │   │       ├── components/
│   │   │       ├── expenses/
│   │   │       ├── documents/
│   │   │       ├── photos/
│   │   │       ├── condition/
│   │   │       ├── valuations/
│   │   │       ├── notifications/
│   │   │       ├── search/
│   │   │       ├── passport/
│   │   │       ├── billing/
│   │   │       ├── ai/
│   │   │       └── telemetry/
│   │   │
│   │   └── package.json
│   │
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── package.json
│   │
│   └── mobile/
│       ├── app/
│       ├── components/
│       ├── lib/
│       └── package.json
│
├── packages/
│   │
│   ├── contracts/
│   ├── domain/
│   ├── database/
│   ├── api-client/
│   ├── ui/
│   ├── config/
│   └── utils/
│
├── workers/
│   └── worker/
│       └── src/
│
├── tooling/
│   ├── eslint/
│   ├── typescript/
│   └── prettier/
│
├── docs/
│   ├── architecture.md
│   ├── PRD.md
│   └── adr/
│
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

# 6. Backend Architecture

The Fastify API is organized by domain rather than technical type.

Each module follows a lightweight layered architecture:

```text
module/
│
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── policies/
│   └── types/
│
├── application/
│   ├── commands/
│   ├── queries/
│   └── services/
│
├── infrastructure/
│   ├── repositories/
│   ├── mappers/
│   └── integrations/
│
└── http/
    ├── routes/
    ├── schemas/
    └── serializers/
```

Example:

```text
vehicles/
├── domain/
│   ├── vehicle.ts
│   ├── vehicle-type.ts
│   └── vehicle-policy.ts
│
├── application/
│   ├── create-vehicle.ts
│   ├── update-vehicle.ts
│   ├── archive-vehicle.ts
│   └── get-vehicle.ts
│
├── infrastructure/
│   └── vehicle-repository.ts
│
└── http/
    ├── vehicle.routes.ts
    └── vehicle.schemas.ts
```

The goal is not strict enterprise DDD.

The goal is to prevent business logic from becoming scattered across HTTP handlers, database queries, and frontend applications.

---

# 7. API Responsibilities

The Fastify API is the authoritative application boundary.

Clients must **never directly access PostgreSQL**.

```text
Web ───────┐
           │
Mobile ────┼──▶ API ──▶ Domain ──▶ Database
           │
Future ────┘
```

The API owns:

- authentication
- authorization
- validation
- domain rules
- database transactions
- file authorization
- business calculations
- notifications
- AI orchestration
- billing webhooks
- telemetry ingestion
- audit logging

---

# 8. API Style

The initial API is REST.

Base URL:

```text
/api/v1
```

Examples:

```http
GET    /api/v1/garages
POST   /api/v1/garages

GET    /api/v1/vehicles
POST   /api/v1/vehicles
GET    /api/v1/vehicles/:vehicleId
PATCH  /api/v1/vehicles/:vehicleId
DELETE /api/v1/vehicles/:vehicleId

GET    /api/v1/vehicles/:vehicleId/events
POST   /api/v1/vehicles/:vehicleId/events

GET    /api/v1/vehicles/:vehicleId/tasks
POST   /api/v1/vehicles/:vehicleId/tasks
PATCH  /api/v1/vehicles/:vehicleId/tasks/:taskId

GET    /api/v1/vehicles/:vehicleId/maintenance
POST   /api/v1/vehicles/:vehicleId/maintenance

GET    /api/v1/vehicles/:vehicleId/expenses
POST   /api/v1/vehicles/:vehicleId/expenses

GET    /api/v1/vehicles/:vehicleId/documents
POST   /api/v1/vehicles/:vehicleId/documents

GET    /api/v1/vehicles/:vehicleId/condition
POST   /api/v1/vehicles/:vehicleId/condition

GET    /api/v1/vehicles/:vehicleId/valuations
POST   /api/v1/vehicles/:vehicleId/valuations
```

Future:

```http
GET    /api/v1/vehicles/:vehicleId/health
GET    /api/v1/vehicles/:vehicleId/passport
GET    /api/v1/vehicles/:vehicleId/diagnostics
GET    /api/v1/vehicles/:vehicleId/telemetry
POST   /api/v1/vehicles/:vehicleId/telemetry
```

---

# 9. API Versioning

All public application APIs use an explicit version:

```text
/api/v1/...
```

Breaking changes require a new version.

Non-breaking additions may be introduced inside the existing version.

The API must maintain backwards compatibility with supported mobile application versions wherever practical.

This is particularly important because users may not update the mobile application immediately.

---

# 10. API Contract System

Fastify request and response schemas use **TypeBox / JSON Schema**.

Schemas define:

- request body
- query parameters
- route parameters
- response shape
- validation
- OpenAPI documentation

Example conceptual structure:

```text
Route
  ↓
TypeBox schema
  ↓
Fastify validation
  ↓
Application service
  ↓
Domain
  ↓
Repository
```

The API contract package can expose generated TypeScript types to clients.

Recommended flow:

```text
Fastify schemas
       ↓
OpenAPI
       ↓
Generated client/types
       ↓
Web + Mobile
```

This avoids manually maintaining separate API types in three applications.

---

# 11. Error Handling

All API errors use a consistent structure.

Conceptual format:

```json
{
  "error": {
    "code": "VEHICLE_NOT_FOUND",
    "message": "Vehicle not found",
    "requestId": "..."
  }
}
```

Validation errors should provide structured field information.

Example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "fields": {
      "purchasePrice": "Must be greater than or equal to 0"
    }
  }
}
```

Internal errors must not expose:

- database details
- stack traces
- credentials
- internal service information
- sensitive user information

---

# 12. Authentication

Authentication is separated from authorization.

The system requires an authentication abstraction so the identity provider can change without changing vehicle-domain logic.

Conceptually:

```text
Authentication Provider
        ↓
Auth Adapter
        ↓
Fastify Request
        ↓
ActorContext
        ↓
Authorization Policies
```

Every authenticated request should produce an `ActorContext` similar to:

```text
ActorContext
├── userId
├── sessionId
├── garageMemberships
└── permissions
```

Web authentication should use secure HTTP-only sessions where appropriate.

Mobile authentication should use secure platform storage.

Authentication implementation must support:

- email/password
- password reset
- email verification
- session management
- optional social login
- future passkeys
- account deletion

---

# 13. Authorization

Authentication answers:

> Who are you?

Authorization answers:

> What are you allowed to do?

The garage is the primary tenant boundary.

Initial garage roles:

```text
OWNER
ADMIN
MEMBER
DRIVER
VIEWER
```

Permissions should be defined by capability rather than scattered role checks.

Examples:

```text
vehicle.read
vehicle.write
vehicle.delete
maintenance.write
expense.write
document.write
garage.manage_members
garage.manage_settings
billing.manage
```

Every protected request must verify access to the target resource.

The backend must never trust a client-provided:

```text
garageId
userId
ownerId
```

as proof of authorization.

---

# 14. Multi-Tenancy

A garage represents a collaborative workspace.

Conceptually:

```text
User
 │
 ├── Garage A
 │    ├── Vehicle 1
 │    ├── Vehicle 2
 │    └── Vehicle 3
 │
 └── Garage B
      ├── Vehicle 4
      └── Vehicle 5
```

Core tenant relationship:

```text
garages
   │
   ├── garage_members
   │
   └── vehicles
          │
          ├── events
          ├── maintenance
          ├── tasks
          ├── expenses
          ├── documents
          └── ...
```

Application-level tenant isolation is mandatory.

Database-level defense-in-depth may be introduced if the deployment architecture makes PostgreSQL row-level security practical.

---

# 15. Database

PostgreSQL is the system of record.

The database stores:

- users
- garages
- vehicles
- events
- maintenance
- tasks
- expenses
- components
- documents metadata
- photos metadata
- condition records
- valuations
- notifications
- subscriptions
- audit logs
- telemetry
- AI metadata

PostgreSQL is preferred because Vehicle OS requires:

- relational integrity
- transactions
- flexible JSONB
- full-text search
- reporting queries
- historical data
- strong consistency
- extensibility

---

# 16. Database Principles

## IDs

Use sortable globally unique IDs, preferably UUIDv7 where supported.

IDs should be generated server-side.

## Timestamps

Store timestamps in UTC.

Use explicit date fields for date-only concepts such as:

```text
registrationExpiryDate
inspectionDate
purchaseDate
```

Store timezone preferences separately.

## Money

Never store money using floating-point values.

Use:

```text
amountMinor
currency
```

Example:

```text
amountMinor = 125000
currency = USD
```

represents:

```text
$1,250.00
```

## Distance

Distance values must retain their unit.

Canonical normalized values may be stored for analytics.

Never silently interpret miles as kilometers or vice versa.

## Enumerations

Stable domain enumerations should be represented explicitly and validated at the application boundary.

---

# 17. Core Data Model

The initial domain model includes:

```text
users
garages
garage_members

vehicles
vehicle_specs
vehicle_photos
vehicle_documents

vehicle_events

maintenance_plans
maintenance_records

tasks
ideas

components
component_records

expenses

condition_assessments
condition_items

valuations

notifications
notification_preferences

subscriptions
billing_events

audit_logs

outbox_messages
```

Future:

```text
telemetry_connections
telemetry_readings
diagnostic_codes
trip_records
service_providers
parts
market_listings
vehicle_integrations
```

---

# 18. Vehicle Model

`vehicles` contains stable identity information.

Conceptually:

```text
vehicles
├── id
├── garage_id
├── vehicle_type
├── nickname
├── make
├── model
├── year
├── VIN
├── registration_identifier
├── purchase_date
├── purchase_price
├── current_odometer
├── odometer_unit
├── status
├── created_at
└── updated_at
```

Vehicle type should be extensible.

Initial types:

```text
CAR
MOTORCYCLE
SCOOTER
BICYCLE
BOAT
ATV
TRAILER
VAN
RV
OTHER
```

The architecture must not assume that every vehicle has:

- an engine
- fuel
- OBD
- odometer
- VIN
- registration
- tires
- battery

Vehicle capabilities should be modeled independently.

---

# 19. Vehicle Capabilities

Instead of hardcoding automotive assumptions, the domain should support capabilities.

Example:

```text
Vehicle
├── engine
├── odometer
├── fuelSystem
├── electricSystem
├── battery
├── transmission
├── registration
├── insurance
├── tires
├── trailer
└── telemetry
```

A bicycle might support:

```text
odometer
components
maintenance
expenses
documents
photos
```

An EV might support:

```text
battery
charging
odometer
telemetry
maintenance
```

A boat might support:

```text
engineHours
fuel
maintenance
registration
components
```

This prevents the entire system from becoming car-specific.

---

# 20. Vehicle Events

The timeline is one of the core architectural concepts.

`vehicle_events` represents things that happened to or around a vehicle.

Examples:

```text
PURCHASE
MAINTENANCE
REPAIR
MODIFICATION
INSPECTION
ACCIDENT
FUEL
CHARGE
CLEANING
REGISTRATION
INSURANCE
TRIP
EXPENSE
NOTE
VALUATION
CONDITION_CHECK
DOCUMENT_ADDED
PART_INSTALLED
PART_REMOVED
```

The event table is a **timeline model**, not an event-sourcing system.

Important distinction:

```text
Vehicle Event
=
historical product timeline

Domain Event
=
internal software message

Audit Log
=
security/accountability record
```

These must not be conflated.

---

# 21. Event Architecture

A vehicle event may contain:

```text
vehicle_id
event_type
occurred_at
odometer
engine_hours
title
description
source
created_by
created_at
updated_at
```

Specialized information belongs in related tables where appropriate.

Example:

```text
vehicle_event
      │
      ├── maintenance_record
      ├── expense
      ├── condition_assessment
      └── valuation
```

This allows the timeline to remain unified while preserving structured domain data.

---

# 22. Maintenance Architecture

Maintenance consists of two separate concepts:

```text
Maintenance Plan
        +
Maintenance Record
```

A maintenance plan defines when something is due.

Examples:

```text
Oil change
Every 5,000 km
OR every 6 months

Brake inspection
Every 10,000 km
OR every 12 months

Boat engine service
Every 100 engine hours
OR every 12 months
```

A maintenance record represents completion.

---

# 23. Maintenance Scheduling

Intervals may be based on:

```text
distance
time
engine_hours
calendar_date
usage
```

The system should support compound rules.

Example:

```text
5,000 km OR 6 months
```

The earliest applicable due condition should determine the next due state.

Maintenance calculations belong in domain/application services, not frontend code.

---

# 24. Tasks

Tasks are broader than maintenance.

Examples:

```text
Fix brake light
Buy helmet
Research tires
Call insurance
Install GPS
Wash vehicle
Take registration photo
Order oil
```

Task lifecycle:

```text
TODO
IN_PROGRESS
BLOCKED
COMPLETED
CANCELLED
```

Tasks may optionally reference:

```text
vehicle
component
maintenance_plan
idea
document
expense
```

---

# 25. Ideas / Build Board

Ideas are future actions rather than confirmed tasks.

Lifecycle:

```text
IDEA
   ↓
RESEARCH
   ↓
PLANNED
   ↓
ORDERED
   ↓
INSTALLED
   ↓
HISTORY
```

An idea can later produce:

```text
task
expense
component installation
vehicle event
```

This creates a natural bridge between planning and historical vehicle data.

---

# 26. Components

Vehicle components are modeled as a hierarchy.

Example:

```text
Vehicle
│
├── Engine
│   ├── Oil
│   ├── Air Filter
│   └── Spark Plugs
│
├── Brakes
│   ├── Front Pads
│   └── Rear Pads
│
├── Wheels
│   ├── Front Left
│   ├── Front Right
│   ├── Rear Left
│   └── Rear Right
│
└── Electrical
    ├── Battery
    └── Alternator
```

Component records can track:

- installation
- replacement
- inspection
- repair
- mileage
- hours
- cost
- supplier
- part number
- warranty
- notes

This enables future component-level health and maintenance intelligence.

---

# 27. Expenses

Expenses are a first-class financial record.

Categories include:

```text
PURCHASE
MAINTENANCE
REPAIR
FUEL
CHARGING
INSURANCE
REGISTRATION
TAX
MODIFICATION
PART
ACCESSORY
STORAGE
CLEANING
TRANSPORT
OTHER
```

An expense may optionally reference a vehicle event.

Financial calculations should be performed server-side.

Examples:

```text
Total ownership cost
Cost per year
Cost per kilometer
Maintenance spend
Modification spend
Fuel spend
```

---

# 28. Documents

Documents are stored as metadata in PostgreSQL and binary content in object storage.

Database:

```text
documents
├── id
├── vehicle_id
├── document_type
├── filename
├── mime_type
├── storage_key
├── size
├── checksum
├── uploaded_by
├── created_at
└── metadata
```

Binary data does not belong in PostgreSQL.

---

# 29. Object Storage

Use S3-compatible object storage.

Initial recommendation:

```text
Cloudflare R2
```

The architecture should remain compatible with:

```text
Amazon S3
Cloudflare R2
Supabase Storage
MinIO
```

Files should be uploaded directly from clients using short-lived signed URLs.

Flow:

```text
Client
  │
  │ request upload URL
  ▼
Fastify
  │
  │ signed URL
  ▼
Client
  │
  │ direct upload
  ▼
Object Storage
  │
  │ finalize
  ▼
Fastify
```

This prevents large media files from unnecessarily passing through the API server.

---

# 30. File Security

Storage keys must be tenant-scoped.

Example:

```text
garages/{garageId}/vehicles/{vehicleId}/documents/{documentId}
```

Files should not be publicly accessible by default.

Downloads should use:

- authenticated API authorization
- short-lived signed URLs

Future file processing may include:

- virus scanning
- metadata extraction
- OCR
- thumbnail generation
- image compression
- EXIF processing
- document classification

---

# 31. Photos

Photos are first-class vehicle assets.

Possible relationships:

```text
vehicle
event
condition assessment
component
document
```

Photos should retain:

```text
capture date
upload date
location metadata if explicitly permitted
caption
category
source
```

EXIF location should not automatically become visible to other garage members without appropriate permission.

---

# 32. Condition Tracking

Condition assessments represent a vehicle's physical state at a point in time.

Categories:

```text
Mechanical
Exterior
Interior
Electrical
Tires
Fluids
Body
Documentation
```

An assessment may contain:

```text
condition score
notes
photos
issues
created_at
odometer
```

Historical assessments enable future:

```text
condition timeline
before/after comparison
AI image comparison
health score
resale preparation
```

---

# 33. Vehicle Health

Vehicle Health is a derived system.

It should never become the primary source of truth.

Conceptually:

```text
Maintenance
       │
Condition ──────┐
       │        │
Tasks ──────────┤
       │        ├──▶ Health Engine ──▶ Health Score
Diagnostics ────┤
       │        │
Telemetry ──────┘
```

Initial health can be rule-based.

Future inputs:

- overdue maintenance
- unresolved repairs
- condition assessments
- diagnostic trouble codes
- battery health
- tire information
- telemetry
- usage patterns

Health calculations must be explainable.

Example:

```text
Health: 82

Maintenance       91
Mechanical        86
Exterior          78
Interior          88
Electrical        82
Documentation     95
```

The user should be able to understand why the score changed.

---

# 34. Valuation

Valuation history is modeled separately from purchase price.

A valuation record may include:

```text
vehicle_id
estimated_value
currency
valuation_date
source
confidence
notes
```

Future valuation sources can include:

- user-entered estimates
- market data
- third-party APIs
- AI-assisted estimates
- marketplace data

Historical values should never be overwritten.

---

# 35. Vehicle Passport

The Vehicle Passport is a generated representation of the vehicle's history.

It can combine:

```text
Identity
Specifications
Ownership
Maintenance
Repairs
Modifications
Condition
Documents
Expenses
Valuations
Timeline
Photos
```

Passport generation should use structured data.

Possible outputs:

```text
PDF
Shareable web page
Printable report
Export archive
```

Sensitive information must be explicitly excluded unless the user chooses to include it.

---

# 36. Notifications

Notifications are generated from domain conditions.

Examples:

```text
Maintenance due
Maintenance overdue
Registration expiring
Insurance expiring
Task due
Document expiring
Warranty expiring
AI insight available
Vehicle health changed
```

Notifications should support:

```text
in-app
push
email
```

Notification preferences belong to users.

The notification system must avoid duplicate delivery.

---

# 37. Background Jobs

Long-running or asynchronous work must not block Fastify requests.

Use:

```text
Redis
+
BullMQ
+
Dedicated Worker
```

Initial queues:

```text
notifications
email
push
ocr
image-processing
ai
valuation
maintenance
analytics
telemetry
```

Architecture:

```text
Fastify
   │
   ├── DB transaction
   │
   └── Outbox message
          │
          ▼
    Queue Dispatcher
          │
          ▼
        BullMQ
          │
          ▼
       Worker
```

---

# 38. Outbox Pattern

Important asynchronous actions should use an outbox pattern.

Example:

```text
POST maintenance completion
        │
        ▼
Database Transaction
   ├── maintenance record
   ├── vehicle event
   ├── expense
   └── outbox message
        │
        ▼
Transaction committed
        │
        ▼
Worker receives message
        │
        ├── notification
        ├── analytics
        └── recalculation
```

This prevents the system from successfully committing data while silently losing the corresponding background job.

---

# 39. Job Reliability

Workers must support:

- retries
- exponential backoff
- idempotency
- dead-letter handling
- structured logging
- job correlation IDs

A job must be safe to run more than once.

For example:

```text
Send maintenance notification
```

must not produce five identical notifications because a worker retried five times.

---

# 40. Search

Initial search should use PostgreSQL.

Search targets:

```text
vehicles
events
tasks
maintenance
documents
components
expenses
notes
ideas
```

Possible technologies:

```text
PostgreSQL full-text search
pg_trgm
GIN indexes
```

Do not introduce Elasticsearch or another search service initially.

If search volume eventually requires it, introduce:

```text
PostgreSQL
      ↓
Search indexing pipeline
      ↓
Dedicated search engine
```

without changing the public search API.

---

# 41. AI Architecture

AI is an intelligence layer, not the system of record.

The architecture is:

```text
User
  │
  ▼
Fastify AI Module
  │
  ├── Structured Query Layer
  ├── Domain Tools
  ├── Retrieval
  ├── AI Provider
  └── Response Formatter
  │
  ▼
User
```

The model should never be given unrestricted database access.

Instead, expose controlled tools such as:

```text
getVehicleProfile()
getMaintenanceHistory()
getUpcomingMaintenance()
getRecentRepairs()
getExpenses()
getConditionHistory()
getVehicleTimeline()
getComponentHistory()
getCurrentHealth()
```

---

# 42. AI Source-of-Truth Rule

For questions such as:

> What did I spend on this vehicle last year?

The AI should not guess.

Flow:

```text
User question
      ↓
Intent detection
      ↓
Structured domain query
      ↓
Actual database results
      ↓
AI summarizes results
```

The database remains authoritative.

AI-generated claims should be traceable to underlying application data where practical.

---

# 43. AI Data Provenance

AI-generated records should store metadata such as:

```text
provider
model
prompt/version
created_at
source_record_ids
confidence where applicable
```

This is especially important for:

- OCR
- vehicle specifications
- valuation
- maintenance recommendations
- AI-generated summaries

AI-extracted information should be marked as:

```text
AI suggested
```

until confirmed where the information materially changes the user's records.

---

# 44. OCR Architecture

Invoice/document OCR runs asynchronously.

Flow:

```text
Upload document
       ↓
Object Storage
       ↓
OCR Job
       ↓
OCR Provider
       ↓
Structured extraction
       ↓
Validation
       ↓
User confirmation
       ↓
Database
```

OCR may extract:

```text
date
vendor
vehicle
odometer
items
labor
tax
total
currency
part numbers
```

The user remains the authority for final confirmation.

---

# 45. Telemetry / OBD Architecture

Connected vehicle functionality is intentionally abstracted.

The API should not depend directly on one OBD adapter.

Define a conceptual interface:

```text
VehicleTelemetryProvider

connect()
disconnect()
getConnectionStatus()
readMetrics()
readDiagnosticCodes()
getVehicleInfo()
```

Potential providers:

```text
OBD-II Bluetooth adapter
BLE sensor
Manufacturer API
EV API
GPS device
Future connected-car platform
```

---

# 46. OBD Data Flow

For mobile OBD:

```text
OBD Adapter
     │
     │ Bluetooth
     ▼
Mobile App
     │
     │ canonical telemetry
     ▼
Fastify API
     │
     ├── PostgreSQL
     ├── Health Engine
     ├── Diagnostics
     └── Analytics
```

The mobile application owns the Bluetooth connection.

The backend owns:

- normalized telemetry
- vehicle association
- storage
- processing
- diagnostics
- historical analysis

---

# 47. Telemetry Storage

High-frequency telemetry should not automatically become one PostgreSQL row per sensor reading forever.

Initial architecture may use PostgreSQL for:

- connection metadata
- diagnostic codes
- aggregated readings
- low-frequency telemetry

As volume increases, telemetry storage can move toward:

```text
PostgreSQL + TimescaleDB
```

or a dedicated time-series system.

The domain API should remain unchanged.

---

# 48. Offline Architecture

Offline capability should be considered from the beginning.

The first implementation should support:

- cached vehicle data
- cached timeline
- offline quick notes
- offline task creation
- offline photo capture
- offline event creation

Mobile local storage can use:

```text
Expo SQLite
```

with an outbox.

Conceptually:

```text
Mobile Local DB
      │
      ├── local records
      └── outbox
             │
             ▼
          Sync API
             │
             ▼
         PostgreSQL
```

---

# 49. Synchronization

Each locally created mutation should receive an idempotency key.

Example:

```text
clientMutationId
```

The server uses it to prevent duplicate records after retries.

Conflict strategies:

### Append-only records

Prefer merge.

Examples:

```text
events
expenses
maintenance records
photos
```

### Editable records

Use optimistic concurrency.

Examples:

```text
vehicle profile
task
idea
component
```

Possible implementation:

```text
version
updated_at
```

The server rejects stale updates when necessary.

Critical conflicts may require explicit user resolution.

---

# 50. API Idempotency

Mutation endpoints that may be retried should support idempotency.

Example:

```http
Idempotency-Key: <client-generated-key>
```

This is particularly important for:

- expense creation
- maintenance completion
- payments
- document finalization
- telemetry ingestion

---

# 51. Transactions

Transactions should be used whenever multiple domain records must remain consistent.

Example:

Completing maintenance may create:

```text
maintenance_record
vehicle_event
expense
odometer update
next_due calculation
outbox message
```

These should be committed atomically when appropriate.

---

# 52. Repository Design

Repositories should be domain-specific.

Good:

```text
VehicleRepository
MaintenanceRepository
ExpenseRepository
EventRepository
```

Avoid:

```text
GenericRepository<T>
```

for everything.

Domain-specific repositories allow queries to express actual business requirements.

---

# 53. Domain Logic

Business rules should not live inside:

- React components
- API route handlers
- SQL files
- random utility functions

Instead:

```text
HTTP
 ↓
Application Service
 ↓
Domain Logic
 ↓
Repository
```

Frontend applications may calculate purely presentational values, but authoritative business calculations belong to the backend.

---

# 54. Caching

Redis may be used for:

- temporary cache
- rate limiting
- sessions where appropriate
- job queues
- short-lived locks
- expensive computed results

Redis is never the source of truth.

If Redis disappears, the product must be able to recover from PostgreSQL.

---

# 55. Rate Limiting

API rate limiting should exist at multiple levels.

Examples:

```text
IP
User
Garage
Endpoint
AI operation
Authentication operation
```

AI and expensive operations require stricter limits.

Examples:

```text
AI requests
OCR processing
large exports
telemetry ingestion
```

---

# 56. Security

Security requirements include:

- TLS everywhere
- secure cookies where applicable
- encrypted secrets
- server-side authorization
- object storage authorization
- input validation
- output validation
- rate limiting
- audit logging
- dependency scanning
- secure headers
- protection against injection
- protection against IDOR
- safe file handling
- account deletion
- data export
- least-privilege service credentials

The backend must assume the client is untrusted.

---

# 57. Audit Logs

Audit logs are separate from vehicle events.

Audit examples:

```text
User invited
User removed
Vehicle deleted
Document deleted
Expense edited
Vehicle ownership changed
Billing plan changed
Permission changed
Account deleted
```

Audit records should include:

```text
actor
action
resource
resource_id
timestamp
metadata
request_id
```

Audit logs should be append-oriented and difficult to modify accidentally.

---

# 58. Observability

Fastify should use structured logging.

Every request should have:

```text
request_id
user_id when available
garage_id when available
route
status
duration
```

Use:

```text
Pino
+
Sentry
```

for logs and errors.

Future:

```text
OpenTelemetry
```

for distributed traces if system complexity warrants it.

---

# 59. Analytics

Product analytics should use PostHog.

Track product behavior rather than sensitive raw data.

Examples:

```text
garage_created
vehicle_created
vehicle_profile_completed
event_created
maintenance_created
maintenance_completed
task_completed
document_uploaded
passport_generated
ai_question_asked
subscription_started
subscription_cancelled
```

Analytics must not become the source of business truth.

---

# 60. Billing

Stripe handles payments and subscriptions.

The backend owns entitlement state.

Flow:

```text
User
 ↓
Stripe Checkout
 ↓
Stripe
 ↓
Webhook
 ↓
Fastify
 ↓
Billing tables
 ↓
Entitlement checks
```

Never rely solely on client-side Stripe state.

Webhook processing must be idempotent.

---

# 61. Subscription Architecture

Conceptual plans:

```text
FREE
PRO
CONNECTED
```

Exact feature limits belong in configuration rather than being scattered throughout the codebase.

Examples:

```text
maxVehicles
maxStorage
maxPassportExports
maxAIRequests
telemetryEnabled
advancedAnalyticsEnabled
```

The backend should enforce entitlements.

---

# 62. Web Architecture

Next.js is the web application framework.

Web responsibilities:

- dashboards
- garage management
- vehicle profiles
- deep timeline browsing
- analytics
- documents
- configuration
- billing
- passport
- administration

Web should use:

```text
TanStack Query
```

for API/server state.

Do not duplicate backend business logic inside Next.js server actions.

Next.js is a client of the Fastify API.

---

# 63. Mobile Architecture

React Native + Expo.

Recommended:

```text
Expo Router
TanStack Query
Zustand
Expo SQLite
Expo Secure Store
Expo Camera
Expo Notifications
Expo File System
```

Mobile is optimized for:

- quick actions
- photos
- maintenance completion
- task management
- notifications
- vehicle status
- offline operation
- future BLE/OBD connectivity

---

# 64. State Management

Use three distinct categories.

### Server State

Use:

```text
TanStack Query
```

Examples:

```text
vehicles
events
maintenance
expenses
documents
notifications
```

### Local UI State

Use:

```text
Zustand
```

Examples:

```text
filters
modal state
temporary UI preferences
navigation state
```

### Persistent Offline State

Use:

```text
SQLite
```

for mobile offline data and mutations.

Do not put the entire server database into Zustand.

---

# 65. Shared Packages

## `packages/contracts`

Contains:

- API types
- generated OpenAPI types
- request/response contracts

## `packages/domain`

Contains shared domain concepts that genuinely need to be shared.

Examples:

```text
VehicleType
TaskStatus
EventType
Currency
DistanceUnit
```

Avoid putting server-specific database logic here.

## `packages/database`

Contains:

- Drizzle schema
- migrations
- database helpers
- database types

This package should only be consumed by server-side applications.

## `packages/api-client`

Contains typed API client functionality used by:

```text
web
mobile
```

## `packages/ui`

Contains genuinely cross-platform design primitives where practical.

Do not force identical UI architecture between React Native and web.

## `packages/config`

Contains shared configuration conventions.

---

# 66. Database Migrations

Drizzle migrations are version-controlled.

Rules:

- migrations are immutable once deployed
- schema changes require migrations
- production migrations run automatically through controlled deployment
- destructive migrations require explicit review
- data migrations are separated from schema migrations when useful

Every production database must be reproducible from:

```text
schema
+
migration history
```

---

# 67. Seed Data

Development environments should have deterministic seed data.

Example:

```text
Demo Garage
 ├── Daily Driver
 ├── Motorcycle
 ├── Bicycle
 └── Project Vehicle
```

Seed data should demonstrate:

- maintenance
- tasks
- events
- expenses
- documents
- photos
- valuations
- condition history

No production customer data should be used for development.

---

# 68. Local Development

Local infrastructure should be runnable with Docker Compose.

Initial services:

```text
PostgreSQL
Redis
MinIO
```

Example:

```text
docker compose up
```

Applications:

```text
pnpm dev
```

Developers should not need production cloud credentials for normal local development.

---

# 69. Environments

Maintain at least:

```text
local
development
staging
production
```

Preview environments may be created for web pull requests.

Production credentials must never be used locally.

---

# 70. Deployment

Recommended initial deployment:

```text
                    ┌─────────────┐
                    │   Vercel    │
                    │   Next.js   │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Fastify   │
                    │ API Service │
                    └──────┬──────┘
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
       PostgreSQL        Redis           R2
             │             │
             │             ▼
             │          Worker
             │
             └───────────────────────
```

The API and worker should be containerized.

The exact container host may be:

```text
Railway
Fly.io
AWS
Google Cloud
Azure
```

The application should not become tightly coupled to one hosting provider.

---

# 71. CI/CD

GitHub Actions should run:

```text
lint
typecheck
unit tests
integration tests
build
migration validation
```

Pull requests should be blocked on failed checks.

Deployment pipeline:

```text
Pull Request
      ↓
CI
      ↓
Merge
      ↓
Build
      ↓
Deploy staging
      ↓
Smoke tests
      ↓
Production
```

Database migrations should be explicitly controlled.

---

# 72. Testing Strategy

Testing follows the pyramid:

```text
             E2E
            /   \
       Integration
        /         \
       Unit Tests
```

## Unit Tests

Test:

- domain rules
- maintenance calculations
- health calculations
- financial calculations
- permission policies
- validators

## Integration Tests

Test:

- PostgreSQL repositories
- API routes
- authentication
- authorization
- transactions
- background jobs

Use isolated test databases.

## Web E2E

Use Playwright for critical workflows:

```text
signup
create garage
create vehicle
add maintenance
complete maintenance
add expense
generate passport
```

## Mobile E2E

Use a mobile E2E framework such as Maestro for critical flows.

---

# 73. Performance Targets

Initial targets:

### API

Typical authenticated read requests:

```text
p95 < 300 ms
```

Typical writes:

```text
p95 < 500 ms
```

Long-running operations should become asynchronous.

### Web

Prioritize:

- fast initial load
- responsive navigation
- cached server state
- optimized images

### Mobile

Prioritize:

- instant local interactions
- minimal network dependency
- efficient image loading
- battery-conscious background behavior

Targets should be measured rather than treated as guarantees.

---

# 74. Image Optimization

Vehicle photos can become one of the largest data sources.

Processing pipeline:

```text
Original
   ↓
Validation
   ↓
Resize
   ↓
Thumbnail
   ↓
Optimized display version
```

The original should be retained when appropriate.

Client applications should generally display optimized derivatives rather than original full-resolution images.

---

# 75. Data Export

Users should be able to export their data.

Export should eventually include:

```text
Vehicle data
Timeline
Maintenance
Tasks
Expenses
Documents
Photos
Condition
Valuations
```

Preferred format:

```text
ZIP
 ├── data.json
 ├── vehicles.csv
 ├── expenses.csv
 ├── maintenance.csv
 ├── events.csv
 └── files/
```

The export architecture should be asynchronous for large accounts.

---

# 76. Account Deletion

Account deletion must be designed from the beginning.

The system must define what happens to:

```text
personal account
garage
shared garage
vehicle records
documents
photos
audit records
billing records
```

Deletion should distinguish between:

- user-owned data
- shared garage data
- legally required billing/audit records

The exact retention policy should be defined before production launch.

---

# 77. Data Integrity

Important records should be historical rather than destructively overwritten.

For example:

Bad:

```text
vehicle.currentValue = 15000
```

with no history.

Better:

```text
valuation #1 → 17000
valuation #2 → 16000
valuation #3 → 15000
```

Similarly:

```text
maintenance history
expense history
condition history
ownership history
```

should preserve meaningful historical information.

---

# 78. Eventual Consistency

Most user-facing domain records should be strongly consistent.

Examples:

```text
vehicle profile
expense
maintenance completion
task completion
document metadata
```

Derived systems may be eventually consistent:

```text
notifications
analytics
search indexes
AI summaries
health recalculation
valuation refresh
```

The UI should communicate asynchronous states when necessary.

---

# 79. Domain Event Bus

The application may emit internal domain events such as:

```text
VehicleCreated
MaintenanceCompleted
ExpenseCreated
DocumentUploaded
ConditionAssessmentCreated
SubscriptionChanged
```

These are internal application events.

They should initially be handled through the outbox/worker architecture.

There is no requirement for Kafka or another distributed event bus at MVP scale.

---

# 80. Health Calculation Architecture

Health should be implemented as a service:

```text
HealthService
```

It receives structured vehicle state:

```text
maintenance
tasks
condition
diagnostics
telemetry
documents
```

and returns:

```text
overall score
category scores
factors
warnings
```

Example:

```json
{
  "overall": 82,
  "categories": {
    "mechanical": 86,
    "maintenance": 91,
    "exterior": 78,
    "interior": 88,
    "electrical": 82,
    "documentation": 95
  }
}
```

The calculation version should be tracked so historical changes can be explained.

---

# 81. Garage Dashboard Architecture

The dashboard is a composition of domain queries.

It should not create a giant database query that tries to represent the entire application.

Conceptually:

```text
GarageDashboardService
   ├── vehicle summary
   ├── overdue maintenance
   ├── upcoming tasks
   ├── recent activity
   ├── spending summary
   ├── health summary
   └── notifications
```

The API can provide a dashboard-specific endpoint where necessary.

---

# 82. Global Search Architecture

Search should provide one unified interface:

```text
/search?q=...
```

Results may be categorized:

```text
Vehicles
Events
Tasks
Maintenance
Documents
Expenses
Components
Ideas
```

Each result should include:

```text
type
id
title
subtitle
vehicle
date
relevance
```

Search permissions must be enforced before results are returned.

---

# 83. Permission-Aware Search

Search must never reveal records the user cannot access.

Correct:

```text
Search
 ↓
Candidate records
 ↓
Authorization filter
 ↓
Results
```

Not:

```text
Search everything
 ↓
Hide unauthorized records in frontend
```

---

# 84. Notification Scheduling

Scheduled notifications should be generated from domain dates.

Examples:

```text
maintenance due in 7 days
registration expires in 30 days
insurance expires in 14 days
task due tomorrow
```

The scheduler should be idempotent.

User timezone preferences must be respected.

---

# 85. Future Service Provider Architecture

Future mechanic/service-provider functionality should be built as a separate capability.

Potential model:

```text
ServiceProvider
ServiceProviderUser
ServiceProviderVehicleAccess
WorkOrder
ServiceRecord
```

A mechanic should receive limited access to a vehicle rather than membership to the user's entire private garage.

Example:

```text
Owner
  ↓
Vehicle
  ↓
Temporary Service Access
  ↓
Mechanic
```

This should not be implemented as a core MVP assumption.

---

# 86. Future Marketplace Architecture

Future parts/marketplace functionality should remain external to the core domain.

Possible future flow:

```text
Vehicle
   ↓
Component
   ↓
Part Number
   ↓
Marketplace Search
   ↓
External Providers
```

The core product must remain useful without marketplace integrations.

---

# 87. Future VIN Enrichment

VIN decoding/enrichment should be implemented through an adapter.

```text
VinProvider
   ├── decode()
   ├── getSpecifications()
   └── getMetadata()
```

Provider-specific data must be normalized into the Vehicle domain.

Do not make the core vehicle model dependent on one VIN provider.

---

# 88. Future Manufacturer Integrations

Manufacturer integrations should follow the same adapter pattern.

```text
VehicleIntegration
├── authenticate()
├── getVehicleInfo()
├── getTelemetry()
├── getChargingData()
├── getDiagnostics()
└── disconnect()
```

This enables future support for:

```text
EV APIs
Connected-car platforms
OEM APIs
GPS systems
```

without coupling the domain to one manufacturer.

---

# 89. Scalability Strategy

The initial architecture should comfortably support a growing consumer SaaS application without premature distributed systems.

Scaling path:

### Stage 1

```text
1 API
1 Worker
1 PostgreSQL
1 Redis
1 Object Storage
```

### Stage 2

Scale horizontally:

```text
multiple API instances
multiple workers
read replicas if needed
CDN
Redis scaling
```

### Stage 3

Extract only proven bottlenecks:

```text
telemetry ingestion
AI processing
search
media processing
notifications
```

### Stage 4

Introduce specialized infrastructure only where justified.

---

# 90. What Must Not Be Done

Do not:

- build microservices initially
- expose PostgreSQL directly to clients
- put business logic in React components
- use GraphQL just because the product has many entities
- use MongoDB as the primary database
- store images in PostgreSQL
- store money as floating-point numbers
- make AI the source of truth
- allow AI unrestricted SQL access
- make the API responsible for Bluetooth
- store every high-frequency telemetry reading forever by default
- introduce Kafka at MVP
- introduce Elasticsearch at MVP
- build a custom authentication system unnecessarily
- create a generic repository abstraction for every table
- make every table a JSON document
- make the product car-only
- couple the core domain to one external provider

---

# 91. Architectural Boundaries

The most important boundaries are:

```text
Frontend
   │
   ▼
API
   │
   ▼
Application / Domain
   │
   ▼
Persistence
```

And:

```text
Core Domain
   │
   ├── External Providers
   ├── AI
   ├── Storage
   ├── Payments
   └── Telemetry
```

External providers must be replaceable through adapters.

---

# 92. Dependency Direction

Dependencies should flow inward.

Preferred:

```text
HTTP
 ↓
Application
 ↓
Domain
```

Infrastructure implements interfaces required by application/domain layers.

Avoid:

```text
Domain
 ↓
Stripe
```

Instead:

```text
Domain/Application
       ↓
Billing Interface
       ↓
Stripe Adapter
```

Same principle applies to:

```text
AI
Storage
OCR
VIN
Valuation
Telemetry
Email
Push
Payments
```

---

# 93. Configuration

Environment configuration should be validated at application startup.

Examples:

```text
DATABASE_URL
REDIS_URL
OBJECT_STORAGE_ENDPOINT
OBJECT_STORAGE_BUCKET
OBJECT_STORAGE_ACCESS_KEY
OBJECT_STORAGE_SECRET
AUTH_SECRET
STRIPE_SECRET_KEY
OPENAI_API_KEY
POSTHOG_KEY
SENTRY_DSN
```

Application startup should fail clearly if required configuration is missing.

Secrets must never be committed to Git.

---

# 94. Feature Flags

Feature flags may be used for:

```text
AI
OCR
Passport
Advanced Analytics
OBD
Experimental UI
```

Flags should be controlled centrally.

The backend must enforce server-side availability for protected features.

---

# 95. API Security for Mobile

Mobile applications should assume that their API credentials can eventually be inspected.

Therefore:

- never embed permanent secrets in the app
- never trust client-side feature flags
- never rely on hidden API endpoints
- never treat mobile app attestation as authorization
- enforce all permissions server-side

---

# 96. Privacy

Vehicle data may contain sensitive information such as:

- registration identifiers
- VINs
- location metadata
- purchase prices
- insurance documents
- personal notes
- financial information

Privacy should follow data minimization.

Only collect data required for a useful feature.

Sensitive data should not appear in:

- analytics events
- application logs
- AI prompts unnecessarily
- error messages
- public URLs

---

# 97. Localization and Units

The architecture must support:

```text
metric
imperial
```

Examples:

```text
km / mi
L / gal
°C / °F
bar / PSI
kg / lb
```

Unit conversion belongs in a shared domain utility layer.

The stored record should retain enough information to prevent ambiguity.

User preferences determine presentation.

---

# 98. Internationalization

All user-facing strings should be translatable.

Do not hardcode user-facing text throughout domain logic.

The backend should return stable error codes.

The frontend translates those codes into localized messages where appropriate.

---

# 99. Accessibility

Web and mobile interfaces should target WCAG-aligned accessibility practices.

Requirements include:

- keyboard navigation
- screen-reader labels
- sufficient contrast
- focus states
- semantic controls
- accessible forms
- accessible charts
- non-color-only status indicators
- scalable text
- reduced-motion support

Accessibility is part of the component architecture, not a final polish step.

---

# 100. API Documentation

The API must expose generated OpenAPI documentation in non-production or protected environments.

Documentation should include:

- endpoints
- authentication
- request schemas
- response schemas
- errors
- examples
- pagination
- idempotency

This becomes the primary contract between backend and clients.

---

# 101. Pagination

Collection endpoints should use cursor-based pagination for large datasets.

Example:

```http
GET /vehicles?limit=25&cursor=...
```

Responses:

```json
{
  "data": [],
  "pagination": {
    "nextCursor": "...",
    "hasMore": true
  }
}
```

Offset pagination may be used for small administrative datasets where appropriate.

---

# 102. Sorting and Filtering

Collection APIs should support predictable filtering.

Example:

```http
GET /vehicles/:id/events
  ?type=maintenance
  &from=2026-01-01
  &to=2026-12-31
  &sort=-occurredAt
```

Filters must be validated.

Clients must not be able to construct arbitrary SQL expressions.

---

# 103. Soft Deletion

Soft deletion should be used selectively.

Good candidates:

```text
vehicles
documents
tasks
ideas
```

depending on product requirements.

Financial and historical records should generally preserve history rather than disappearing silently.

Deletion behavior must be defined at the domain level rather than adding `deleted_at` to every table automatically.

---

# 104. Data Retention

Retention policies should be explicitly defined for:

```text
audit logs
notifications
telemetry
AI requests
temporary files
deleted accounts
billing events
```

Temporary processing data should not be retained indefinitely.

---

# 105. Reliability Principles

The system should assume:

```text
network failures happen
workers restart
requests retry
mobile apps disappear offline
external APIs fail
AI providers fail
Redis can restart
uploads can fail
users double-tap buttons
```

Therefore:

- mutations are idempotent where appropriate
- important workflows use transactions
- asynchronous work uses retries
- external calls use timeouts
- external integrations are isolated
- user data is persisted before derived processing
- clients can safely retry

---

# 106. External Integration Rules

Every external provider must have:

```text
timeout
retry policy
failure handling
logging
metrics
rate limits
fallback behavior
```

An external provider must never be able to corrupt the core domain.

Example:

If a valuation provider fails:

```text
Vehicle data remains available.
Historical valuations remain available.
The latest valuation simply remains unchanged.
```

---

# 107. Disaster Recovery

Production PostgreSQL must have:

- automated backups
- point-in-time recovery where available
- tested restoration procedures

Object storage must have appropriate durability/versioning policies.

Redis should be treated as recoverable infrastructure rather than permanent storage.

Recovery objectives should be defined before production launch.

---

# 108. Backup Philosophy

Critical user data:

```text
PostgreSQL
Object Storage
```

must have backup/recovery plans.

Derived data:

```text
cache
search indexes
AI summaries
analytics
```

should be rebuildable where possible.

---

# 109. Architecture Decision Records

Major architectural decisions should be recorded in:

```text
docs/adr/
```

Examples:

```text
001-modular-monolith.md
002-postgresql.md
003-rest-api.md
004-fastify.md
005-object-storage.md
006-background-jobs.md
007-offline-sync.md
008-ai-architecture.md
009-telemetry-architecture.md
```

An ADR should explain:

```text
Context
Decision
Alternatives
Consequences
```

---

# 110. Initial Implementation Order

Implementation should proceed in this order.

## Phase 1 — Foundation

```text
Monorepo
TypeScript
Fastify
PostgreSQL
Drizzle
API contracts
Authentication
Authorization
Logging
Error handling
CI/CD
```

## Phase 2 — Core Domain

```text
Users
Garages
Garage members
Vehicles
Vehicle types
Vehicle profiles
Photos
Events
Timeline
```

## Phase 3 — Maintenance

```text
Maintenance plans
Maintenance records
Due calculations
Tasks
Notifications
```

## Phase 4 — Financials

```text
Expenses
Ownership cost
Cost analytics
```

## Phase 5 — Documents

```text
Object storage
Signed uploads
Documents
Photos
File processing
```

## Phase 6 — Product Experience

```text
Dashboard
Search
Vehicle health
Garage overview
Mobile quick actions
Offline basics
```

## Phase 7 — V1.5

```text
OCR
Passport
Condition tracking
Valuation history
Sharing
Advanced analytics
```

## Phase 8 — Intelligence

```text
AI
Natural language queries
AI recommendations
Smart briefing
```

## Phase 9 — Connected Vehicle

```text
Telemetry abstraction
BLE
OBD
Diagnostics
Predictive maintenance
```

---

# 111. MVP Architecture

The MVP should deploy as:

```text
                ┌───────────────┐
                │    Next.js    │
                │      Web      │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │    Fastify    │
                │      API      │
                └───────┬───────┘
                        │
             ┌──────────┼──────────┐
             ▼          ▼          ▼
        PostgreSQL    Redis       R2
             │          │
             │          ▼
             │        Worker
             │
             └────────────────

                React Native
                     │
                     ▼
                  Fastify
```

No:

```text
microservices
Kafka
Elasticsearch
Kubernetes
dedicated telemetry database
complex event sourcing
```

unless a measured requirement appears.

---

# 112. Definition of Architectural Success

The architecture is successful if a developer can add a new capability such as:

```text
Boat engine-hour maintenance
```

without rewriting:

- authentication
- garage architecture
- timeline
- task system
- expense system
- notification system
- mobile API architecture

Similarly, adding:

```text
OBD diagnostics
```

should not require replacing the vehicle model.

Adding:

```text
AI vehicle assistant
```

should not require changing PostgreSQL into an AI database.

Adding:

```text
mechanic access
```

should extend authorization rather than replacing garage ownership.

---

# 113. Long-Term Architecture

The intended evolution is:

```text
                         VEHICLE OS
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
        Garage            Vehicle           Intelligence
          │                  │                  │
          │          ┌───────┼────────┐         │
          │          │       │        │         │
       Members    History  Health  Telemetry    AI
          │          │       │        │         │
          │          │       │        │         │
          └──────────┴───────┴────────┴─────────┘
                             │
                             ▼
                      Vehicle Data Graph
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
       Service           Marketplace          Resale
       Providers          / Parts             / Passport
```

The database remains the durable foundation.

The API remains the primary application boundary.

AI, telemetry, integrations, and marketplaces remain replaceable layers around the core.

---

# 114. Core Architectural Philosophy

The most important architectural decision is not Fastify, PostgreSQL, React Native, or any individual library.

It is this:

> **Vehicle OS is a structured vehicle-data platform first, with intelligence layered on top.**

The system should capture reality:

```text
What vehicle is this?
What happened to it?
What was done?
When was it done?
Who did it?
What did it cost?
What condition is it in?
What needs to happen next?
What components does it contain?
What documents prove its history?
What is it worth?
```

Then intelligence can answer:

```text
What should I do next?
Why is my vehicle health declining?
What have I spent?
What maintenance is coming?
What changed?
What should I investigate?
What should I buy?
What is this vehicle's story?
```

The structured data is the foundation.

The timeline is the memory.

The health system is the state.

The task system is the action layer.

The AI is the intelligence layer.

Telemetry is the future sensing layer.

The Vehicle Passport is the portable identity layer.

Together these form the technical foundation of the **Vehicle OS / Digital Garage**.
