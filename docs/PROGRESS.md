# Build progress and handoff

Where the implementation stands, and what a new session needs to know to continue.
Product definition is `PRD.md`; technical design is `Architecture.md`; decisions taken
during the build that neither covers are in `adr/`.

**Last updated:** 2026-09-08. Phases 3 to 7 done except OCR and advanced analytics, and the
mobile app is now real: sign-in, tabs, quick entry and an offline write queue, bundling on
both platforms. OCR needs a vision provider key; Phases 8 and 9 need an LLM key and hardware.

---

## Orientation for a new session

Read this file, then `Architecture.md` §110 (implementation order) and §6 (module layout).

```bash
pnpm install
pnpm test            # unit suites; integration is `pnpm --filter @vehicle-os/api test:integration`
                     # 238 integration tests, no database needed — they run on PGlite
pnpm typecheck       # 19 workspaces
pnpm dev             # api :3001, web :3000
pnpm --filter @vehicle-os/worker dev   # background jobs, needs Redis
```

`.env` at the repo root is gitignored and already configured with Neon Postgres, Upstash
Redis and Upstash Blob. Nothing needs installing locally — `pnpm dev` works on a fresh clone
once `.env` is in place, and the test suite needs no services at all.

**Run `pnpm db:migrate` after pulling a phase that added a migration.** The test suite runs
every migration against its own PGlite instance, so the suite is always up to date and a
migration nobody applied to Neon still passes everything before 500ing in the browser — which
is exactly how `documents.uploaded_at` shipped missing. `pnpm db:generate` producing no diff
means the migration *files* are current, not the database.

The API now refuses to start against a database that is behind (`assertNoMigrationDrift` in
`server.ts`), so that failure is a boot error naming the missing migration rather than a 500
on one route.

---

## Status by phase

| Phase | Scope | State |
| --- | --- | --- |
| 1 — Foundation | monorepo, schema, API skeleton, auth, authz, errors, jobs, CI | **Done** |
| 2 — Core domain | garages, members, vehicles, photos, timeline, web app, Expo scaffold | **Done** |
| 3 — Maintenance | plans, records, due calculation, tasks, notifications, scheduler | **Done** |
| 4 — Financials | expenses, ownership cost, cost analytics | **Done** |
| 5 — Documents | object storage, signed uploads, file processing | **Done** |
| 6 — Product experience | dashboard, search, health, garage overview, mobile quick actions, offline | **Done** |
| 7 — V1.5 | condition, valuations, sharing, passport | **Done**; OCR and advanced analytics not started |
| 8 — Intelligence | AI module, domain tools, natural-language questions | **Done**, unverified against a live provider — no key yet |
| 9 — Connected vehicle | telemetry, BLE, OBD, diagnostics | Not started; needs hardware |

### Verified running

- API against Neon: `GET /api/v1/health` → `{"database":"up","redis":"up"}`
- Worker against Upstash Redis: starts, registers the daily scan, 10 queues live
- Photos against Upstash Blob: ticket → direct client PUT → finalize → signed read, with the
  uploaded bytes coming back identical and the storage key never leaving the server
- Web: 21 routes build and serve; both theme token sets compile
- Garage sharing driven end to end against Neon: add a member by email → they see the garage
  with their role → role changed → removed → the garage disappears for them
- Full journey driven through the live API: sign up → garage → vehicle → 4 timeline events
  → odometer carried forward → back-dated entry did not drag it back → regression warned

---

## Phase 3 — what is done

### Backend

- **`modules/maintenance`** — plans with compound intervals, records, completion.
  `computeNextDue()` and `baselineAfterCompletion()` are pure, in `domain/next-due.ts`,
  with 26 unit tests. 22 integration tests.
- **`modules/tasks`** — CRUD, filters, and the §29 task centre. `domain/buckets.ts` is pure,
  13 unit tests. 22 integration tests.
- **`modules/notifications`** — the due scan, dedupe, in-app notification rows and read
  endpoints. 15 integration tests.
- **`workers/worker`** — `scheduler.ts` registers the daily scan as a BullMQ repeatable job;
  handlers in `handlers/maintenance.ts`.
- **Icons** — 42 Solar `bold-duotone` glyphs inlined at `apps/web/src/components/icons.tsx`.

### Web UI

- **`packages/api-client`** — `maintenance`, `tasks` and `notifications` sections, with
  `maintenancePlansQuery`, `maintenanceRecordsQuery`, `dueQuery`, `tasksQuery`,
  `taskBucketsQuery`, `notificationsQuery` and `unreadCountQuery` alongside the existing
  builders. The maintenance and task keys sit under the `vehicles` prefix so one
  invalidation after a completion reaches the plan, the timeline and the odometer.
- **Maintenance tab** — `vehicles/[vehicleId]/maintenance`. Plans overdue-first with their
  status badge, the add-schedule form, the complete-service form, and the history list.
- **Tasks tab** — `vehicles/[vehicleId]/tasks`, open by default, completed behind a toggle.
- **Task centre** — `/tasks`, rendering the server's buckets and counts as-is.
- **Notification bell** — in `app-shell.tsx`, badge from `/notifications/unread-count`; the
  list is only fetched once the panel opens.
- **Dashboard "attention required"** — overdue and due-soon work across every garage, plus
  the overdue task count, with the "Needs attention" stat now populated.
- `components/due-badge.tsx` holds the status→colour map and `describeDue()`; `task-item.tsx`
  and `task-form.tsx` are shared by the two task screens.

### Small contract change made for the UI

`DueItem` gained `odometerUnit`. The dashboard shows a plan's remaining distance without
loading the vehicle, and `nextDueOdometer` is in the vehicle's unit — without it, a
miles vehicle rendered as kilometres.

### Not built in Phase 3

All four of these were built later — see "The edit and delete controls" below.

---

## Phase 4 — what is done

### Backend

- **`modules/expenses`** — list (filtered by category and date window, cursor-paged), create,
  read, correct, delete, and the cost summary at `GET /vehicles/:id/cost`.
  `domain/cost.ts` is pure, 19 unit tests. 26 integration tests.
- **Timeline costs are mirrored into expenses.** A cost typed on the timeline writes an
  expense in the same transaction, linked by `event_id`; correcting the event moves it,
  clearing the cost deletes it, deleting the event deletes it. `domain/event-category.ts`
  maps event type to expense category.
- **Deleting an expense is a hard delete** and is audited, with the whole row in the entry —
  after the transaction it exists nowhere else.

### Web UI

- **Costs tab** — `vehicles/[vehicleId]/costs`. Five stats (spent, ownership cost, per year,
  per distance, fuel consumption), a category breakdown, the expense list, and the record-an-expense form.
  Window buttons for all time / 12 months / 3 months.
- `packages/api-client` gained an `expenses` section with `expensesQuery` and `costQuery`.

### The cost definitions, and why

Neither document pins these down, so they are settled here.

- **Ownership cost** is the vehicle's purchase price plus every non-`PURCHASE` expense ever
  recorded. `PURCHASE` expenses are excluded because the purchase price already comes from
  the vehicle — someone who filed it in both places would otherwise be charged for the car
  twice, and the error looks only like an expensive car.
- **Cost per year** divides the ownership cost by the years since the purchase date, using a
  mean Gregorian year. Null without a purchase date, and null for a date in the future — a
  typo must not produce a negative annual cost.
- **Cost per distance** is running spend (the purchase excluded) over the distance between
  the lowest and highest odometer readings on record. Not from zero: nothing stores the
  odometer at purchase, so a used vehicle's `currentOdometer` includes tens of thousands of
  kilometres this owner neither drove nor paid for. Null until there are two readings.
- **One currency, never converted.** The summary is quoted in the purchase currency, or
  failing that the currency with the most spend against the vehicle — by amount, not by row
  count, or one tank of fuel abroad outvotes a gearbox rebuild at home. Everything else is
  summed per currency into `otherCurrencies` and shown as "not included". An FX rate this
  application invented would make every total a guess nobody could reproduce.
- **The window moves `totalSpent` and the breakdown only.** "What has this vehicle cost me"
  is not a question about the last 90 days, so the lifetime figures ignore it.

### Not built in Phase 4

- Cross-vehicle cost rollup arrived in Phase 6, on the dashboard.
- Editing and deleting an expense were built later — see "The edit and delete controls".
- Fuel consumption is derived — see below.
- Vehicle valuations (PRD §19) are untouched; only the purchase price exists.

### Spend per month

`GET /vehicles/:id/cost/monthly?months=12` and a chart on the Costs tab. `domain/monthly.ts`
is pure, 5 unit tests, plus one integration test for the SQL bucketing.

- **A month with no spending is a zero, not a gap.** A series built only from the months that
  had expenses puts January next to July and reports a quiet summer as a busy one.
- **The window ends at the current month, inclusive** — `months: 12` read in March means this
  March and the eleven before it, which is what "the last year" means to the person reading
  the chart, not the twelve months ending last December.
- **`PURCHASE` is excluded**, as it is from every other running-cost figure. One bar an order
  of magnitude above the rest flattens every other month into the axis, and the chart then
  shows only that the car was bought.
- **Bucketed in UTC**, matching how `occurred_at` is stored. Bucketing in the reader's zone
  moves the boundary and makes a month gain or lose its first day on a trip.
- **The currency is resolved by the same rule the summary uses**, from the same lifetime sums.
  A chart quoted in a different currency from the totals above it is two answers to one
  question with nothing on screen saying which is which.
- **The chart is flex boxes with a percentage height** — not a charting library, not even SVG.
  It is a bar per month, a baseline and a hover readout; Recharts is ~90 kB gzipped to draw
  twelve rectangles, and its default styling would be overridden back to these tokens anyway.
- **Bars, not a smoothed curve.** The value is a discrete monthly total, and a curve between
  two of them draws spending on days nothing was spent.
- **A zero-height bar and a tiny bar must not look the same**, so a real amount clamps to a
  visible minimum and an empty month draws a flat rule instead.
- The same numbers are in a visually hidden table: a chart with no text alternative is a
  picture of data to a screen reader, and one `aria-label` loses every month but the total.
- Its query key sits under the `cost` prefix, so recording an expense invalidates the chart
  with the totals — two views of the same money must not disagree after a write.

### Fuel consumption

`GET /vehicles/:id/cost` carries a `fuelConsumption` block, and the Costs tab shows it as a
fifth stat — mpg for a vehicle read in miles, l/100 km for one read in kilometres.
`domain/fuel.ts` is pure, 6 unit tests, plus one integration test for the wiring.

- **Full tank to full tank.** A tank is only a known quantity when it is full, so a segment
  runs between two full-ups: everything poured in after the first, up to and including the
  second, over the distance between their odometer readings. The partial fills in between
  count towards the fuel; the first full tank's own litres do not.
- **Null until two full tanks with readings exist.** An average over one measurement is a
  guess, and quoting it as a figure invites the owner to act on it.
- **A full tank with no odometer still contributes its fuel**, it just cannot close a
  segment — dropping it would undercount the litres and report consumption better than it is.
- **An odometer that went backwards drops that segment** and re-anchors. A cluster swap is
  not a car driven in reverse, and dividing a tank by a negative distance is not a figure.
- **The window does not apply.** Consumption is a property of the vehicle; a window cutting
  a segment in half would divide one tank by two months of driving.
- **Rounded server-side** (2 dp for l/100 km, 1 for mpg) so two clients cannot round the same
  float into two different figures for the same car.

### Vehicle thumbnails, background removed

The `image-processing` queue had a `process-photo` job enqueued on every finalize since
Phase 2 and no handler; `workers/worker/src/handlers/images.ts` is that handler, with
`process-photo` and `delete-photo-objects`. 4 tests against PGlite.

- **The cutout is made for the vehicle's primary photo only.** Every photo enqueues the job,
  and the handler drops the ones that are not primary — a gallery of receipts and engine-bay
  shots would otherwise each cost a background removal, for an image no card ever draws.
  Promoting a photo (`PATCH /vehicles/:id` with `primaryPhotoId`) enqueues the same job, so a
  photo that becomes primary later still gets one.
- **`vehicle_photos.cutout_key`**, migration `0004_far_moondragon.sql`, applied to Neon.
  Null until a cutout exists, which is what makes the fallback automatic.
- **`VehiclePhoto` gained `thumbnailUrl` and `isCutout`.** `thumbnailUrl` is the cutout where
  there is one and the original otherwise — never null when `url` is not — so nothing on the
  client has to know whether processing has happened. `isCutout` is what lets a card draw the
  cutout `object-contain` (a car and nothing else, cropping it takes the roof off) and a
  photograph `object-cover`.
- **The provider is Pixelcut**, one HTTP call (`BG_REMOVAL_URL`, `BG_REMOVAL_API_KEY`), and
  the photo goes over as a **signed storage URL rather than an upload** — storage already
  mints one, so the worker never moves the original's bytes. Pixelcut answers with a
  `result_url`; the cutout is fetched from there and PUT to the bucket. An ONNX runtime and a
  40 MB model inside the worker image is a lot of machinery for a picture of a car, and a
  different vendor is an adapter change rather than a variable — the URL exists for a region
  or a proxy, not for a second provider.
- **A private photo does reach a third party** through that signed URL, unavoidably for any
  hosted remover. It is short-lived (10 minutes, so a slow fetch on their side does not fail
  a job for a reason nothing in the response explains) and unguessable, and a self-hosted
  remover is the only way to avoid it.
- **No key configured is not a failure.** The handler logs and returns; the thumbnail stays
  the original. The feature being off must not turn every upload into a failed job.
- **The worker moves bytes through signed URLs**, the same path a browser takes, so
  `StoragePort` needs no byte-level methods and the worker holds no bucket credentials.
  `createStorage()` was lifted out of the Fastify plugin into
  `apps/api/src/infrastructure/storage/factory.ts` and exported as `@vehicle-os/api/storage`.
- **The row is written after the bytes are stored.** A `cutout_key` pointing at an object
  that does not exist is a broken thumbnail on every card that vehicle appears on.
- **Idempotent**: a photo that already has a cutout returns immediately, so BullMQ's
  at-least-once delivery cannot buy the same removal twice.
- **Placeholder when there is no photo at all** — a car glyph on a muted tile, on the web
  card, the vehicle header and now the mobile list, which drew an empty box.

---

## Phase 5 — what is done

### Backend

- **`modules/documents`** — the three-step upload (ticket → direct PUT → finalize), list with
  type and expiring filters, metadata edit, soft delete, and a `/download` endpoint that
  mints a short-lived signed URL. `domain/expiry.ts` is pure, 9 unit tests. 21 integration
  tests.
- **`GET /api/v1/documents/expiring`** — expired or expiring within 60 days, across every
  garage the caller belongs to, each row naming its vehicle and its days remaining.
- **The expiry scan** — `modules/notifications/application/services/expiry-scan.ts`, exported
  as `@vehicle-os/api/expiry-scan`, registered as a daily repeatable job at 08:00 UTC (an
  hour after the maintenance sweep, so the two do not spike the database together).
- **One schema change**: `documents.uploaded_at`, migration `0001_slim_zzzax.sql`. It is what
  separates a pending row from a finalized one — the row is written when the ticket is issued
  so the storage key comes from a committed id, and a client that abandons the PUT leaves a
  row every read ignores.

### Web UI

- **Documents tab** — `vehicles/[vehicleId]/documents`. Upload form, the list with type, size,
  issue and expiry (coloured by urgency), an Open button and a delete.
- **Dashboard** — expiring documents join "attention required" and the "Needs attention"
  count.
- `packages/api-client` gained a `documents` section, `uploadDocument`, `documentsQuery` and
  `expiringDocumentsQuery`.

### Decisions worth keeping

- **No URL in the document metadata.** A signed URL lives about five minutes; one minted with
  the list would be dead before anyone clicked it, and minting one per row hands out fifty
  live links to open none of them. `/download` mints one per request, after the
  authorization check.
- **A closed list of MIME types.** The bucket is served back to people, and an arbitrary type
  is how a stored `text/html` becomes a page hosted on a signed URL.
- **Expiry is compared as date strings, never as timestamps.** A registration that runs out on
  31 March runs out on 31 March wherever you are; subtracting `Date`s would expire it a day
  early for anyone west of UTC.
- **The scan runs in UTC; the screens answer in the reader's timezone.** The sweep runs once
  for everyone and a few hours either side of local midnight is not what makes a reminder
  useful — but "is this expired today?" on a page is answered in the reader's own zone,
  reusing `localDateIn` from the task centre rather than growing a second answer.
- **The dedupe key carries the expiry date and whether it has passed.** A certificate left
  alone is mentioned once; renewing it moves the date, so the next cycle notifies afresh, and
  "expiring" and "expired" are two things worth being told, once each.

### Not built in Phase 5

- No OCR or AI extraction — the `ocr` and `ai` queues exist with no handler (Phase 7).
- Collection built later: `collect-document-objects` runs daily at 03:00 UTC on the
  `image-processing` queue. It deletes the bytes, then the row, for documents soft-deleted
  more than 30 days ago (the restore window) and for pending uploads more than a day old.
- Image documents carry a signed thumbnail; PDFs and office files still show a file tile.
- Attaching to a timeline event built later: "Belongs to" on the upload form, and the tile
  names the event. Re-attaching an existing document has no UI (PATCH takes `eventId`).

---

## Design decisions worth not re-litigating

**`next-due.ts`**

- **"Soon" thresholds are absolute, not proportional.** 500 km is about a fortnight of
  driving whether it precedes an oil change or a timing belt. A proportional window stays
  silent 500 km from a belt change — the one you least want to be surprised by. A
  quarter-of-interval cap stops a 1,000 km chain lube warning from the moment it resets.
- **Urgencies are normalised before comparison.** "151 days overdue" and "6,000 km overdue"
  are not comparable as raw numbers; both are expressed as how many "soon" windows have
  elapsed, so the reported trigger does not depend on evaluation order.
- **A dimension with no reading does not vote.** A distance plan on a vehicle with no
  odometer reports `UNSCHEDULED`, not `OK` — saying "fine" when nothing was checked is a lie.
- **Completion resets from the reading at completion.** Logging last month's service at
  38,000 km schedules from there, not from today's 42,000 km.
- **Status is computed on read, never stored.** The cached `next_due_*` columns exist only so
  the scan can filter in SQL. A plan becomes overdue as the calendar advances, with no write
  to refresh a stored status.

**Elsewhere in Phase 3**

- **Task bucketing is server-side** because "today" depends on the user's timezone, read from
  their profile — not from a request header, or a browser in a hotel abroad re-buckets their
  whole list.
- **Notification dedupe key includes the due point and the status**, so a plan overdue for six
  weeks notifies once, but notifies again after the next service moves the cycle.
- **Completion is one transaction**: record + timeline event + expense + outbox message.
- **Deleting a plan keeps its records** (`plan_id` is `set null`) — removing a schedule must
  not erase the evidence the work was done.

**Phase 4**

- **Money entered anywhere reaches the totals.** The timeline, a maintenance completion and
  the costs tab all write to `expenses`; a figure visible on one screen and missing from
  another is the fragmentation the product exists to remove (PRD §4).
- **An expense derived from an event dies with it.** `event_id` is `set null` on delete,
  which would leave a row nobody can see and every total still counts.
- **`numeric` quantities stay strings end to end.** Litres and kWh are summed into
  consumption figures; parsing "48.7215" into a float to put it on the wire reintroduces
  exactly the error the column type exists to avoid.

**Phase 5**

- **The bytes never pass through the API.** Both photos and documents use the same three-step
  flow, and the row is written before the upload so the storage key comes from an id that is
  already committed — a key invented client-side would be a way to write outside the tenant
  prefix.
- **Finalize verifies against storage.** A row offering a download of nothing is worse than
  no row: the insurance certificate looks filed when it is not.

---

## Phase 6 — what is done

### Backend

- **`modules/health`** — `GET /vehicles/:id/health`. `domain/health.ts` is pure, 13 unit tests.
- **`modules/search`** — `GET /search?q=`, across vehicles, events, tasks, maintenance,
  documents and expenses, with per-type filtering and counts.
- **`modules/dashboard`** — `GET /dashboard`. Summary, attention, recent activity and the
  briefing from six bulk queries issued together. 17 integration tests cover all three.

### Web UI

- **Dashboard** rewritten onto the one endpoint: stat strip, the briefing beside a health
  dial, attention required, recent activity, then the vehicle grid.
- **`/search`** — a debounced box that keeps the query in the URL, results grouped by type.
- **Health card** on the vehicle overview: the dial, the category scores with their basis,
  and every deduction listed with what it cost.
- **Garage overview** — `/garages` lists them with your role in each; `/garages/[garageId]`
  shows the stats, the settings form, the member list with role changes and removal, and the
  vehicles in that garage. No backend work: those endpoints existed from Phase 2 with no UI.
- `components/health-dial.tsx` is shared by the dashboard and the vehicle overview.

### Decisions worth keeping

- **Health scores only the three categories the system can observe** — maintenance, tasks and
  documentation. §33 also lists mechanical, exterior, interior and electrical; those need
  condition assessments and diagnostics, which no table holds. A number invented for them
  would be one the user cannot question, which is the opposite of §33's "explainable".
- **A category with no inputs scores null, not 100.** "Nothing is wrong" and "nothing has been
  checked" are different answers and only one is reassuring — so a brand-new vehicle reports
  no score at all, and the garage average skips it rather than counting it as perfect.
- **Deductions are flat, not proportional.** Recording twenty schedules must not make one
  overdue item look less serious, nor make a well-documented vehicle look sicker.
- **Search is `ILIKE`, not full text.** §40 says start with Postgres and do not add a search
  service; a garage holds hundreds of rows, and tsvector would add a migration, generated
  columns and rank tuning to answer the same question. The ceiling is a sequential scan per
  table, and the upgrade path — `pg_trgm` GIN, then tsvector — sits behind the same function.
  Marked with a `ponytail:` comment in `search-repository.ts`.
- **Relevance is computed in code, not by `ts_rank`.** Results from six tables have to sort
  against each other, and a Postgres rank is only comparable within one query shape.
- **The scope filter is inside the SQL** (§83). Filtering after the fact means the rows were
  read, and are one bug away from being returned.
- **The garage overview gates its controls on `capabilitiesFor(garage.role)`**, the same table
  the server enforces with — so a DRIVER is not shown a member list they cannot change. The
  server still checks; this only stops the UI offering a button that always fails.
- **The owner's own member row has no controls.** The server refuses to demote or remove them,
  because a garage with no owner has nobody who can delete it.
- **The dashboard is one endpoint, not five.** Every figure is a garage-wide calculation, so
  §27 puts them on the server — and against a database in another region, five browser round
  trips cost five times what one does. Per-vehicle health is computed from the same bulk reads
  rather than by calling the health endpoint per vehicle.

### Not built in Phase 6

**Two of §110's six Phase 6 items were not attempted, both on mobile:**

- **Mobile quick actions** and **offline basics.** `apps/mobile` is an Expo scaffold that has
  never run on a device or simulator, and neither item can be built — let alone verified —
  without one. They need a session at a machine with a simulator, not more code written blind.

Also outstanding:

- No garage-level health history or trend — health is computed on read and never stored, so
  there is nothing to plot yet.
- Vehicle valuations (PRD §19) beyond the purchase price: "total estimated value" on the
  dashboard is the sum of purchase prices.
- Search covers ideas (`IDEA`), though nothing creates ideas yet. Components and notes have
  no tables at all; PRD §16–17 are unbuilt.
- No keyboard-shortcut palette for search; it is a page in the nav.

---

## Phase 7 — what is done

Two of §110's six V1.5 items. OCR needs a vision provider and a key that is not in `.env`;
passport and sharing both depend on a public-link model that does not exist yet; advanced
analytics is not defined anywhere concretely enough to build against.

### Backend

- **`modules/condition`** — assessments with per-category items, the current standing, and
  deletion. `domain/condition.ts` is pure, 10 unit tests.
- **`modules/valuations`** — the history plus the current figure against the purchase price.
- **Migration `0002_productive_zemo.sql`**: `condition_assessments`, `condition_items`,
  `valuations`, and a `valuation_source` enum. **Applied to Neon**, and the endpoints driven
  against it afterwards.
- 18 integration tests.

### Web UI

- **Value tab** — `vehicles/[vehicleId]/value`. Purchase / current value / change, the
  valuation history, the condition standing as bars with each judgement's age, and forms for
  both. The assessment form scores only the categories you tick, because a blank is not a zero.

### What this unlocked

- **Health gained a `CONDITION` axis.** §33 asked for mechanical, exterior, interior and
  electrical; those are condition *categories* now rather than four separate health scores —
  one axis per kind of evidence, not one per noun.
- **The dashboard's "total value" is what the vehicles are worth**, from the most recent
  valuation each, falling back to the purchase price for one nobody has valued.

### Decisions worth keeping

- **The condition summary is the latest score per category, not the newest assessment.** Tyres
  checked last week and a frame checked two years ago are both current knowledge about their
  own category; showing only the newest assessment would drop every category it did not cover
  and report a partial inspection as a full one.
- **Condition scores older than a year stop counting towards health.** A judgement from two
  years and 30,000 km ago is not evidence about the vehicle now, and letting it prop up a
  score would be the system reassuring the owner about something nobody has checked since.
  The UI still shows those rows, struck through, rather than hiding them.
- **An unscored item is excluded from the average, not counted as zero.** "Looked at it, could
  not judge" is not "it is ruined" — the other way round makes a careful inspector's report
  score worse than a careless one's.
- **Condition enters health as one deduction, not one per category.** Per-category factors
  would sum past the shortfall and break the invariant every other category obeys: the score
  shown is exactly 100 minus the deductions listed beside it. That invariant is what §33's
  "explainable" means, and there is a test for it.
- **Valuations are separate from the purchase price** (§34). The price paid is one fact that
  never changes; what a vehicle is worth is a series of estimates, each with its own source
  and confidence. One "current value" column would overwrite the history on every lookup.
- **No change is computed across currencies.** A gain built on an exchange rate this
  application invented is a number nobody can check.

## Sharing and the passport

`GET /api/v1/public/passport/:token` is **the only unauthenticated read path in the system**,
which is why it is under its own prefix and why the rules around it are narrow. Migration
`0003_equal_klaw.sql` adds `share_links`; applied to Neon and driven against it.

- **The database never stores the token, only its SHA-256.** A token is a bearer credential:
  plain text means a database dump, a stray log line or a support engineer with read access
  hands over every live link at once. The plaintext is returned exactly once, at creation —
  a lost link is replaced, not looked up, and the UI says so before you close it.
- **256 bits from `randomBytes`, base64url.** Not a uuid: v4 is 122 bits in a recognisable
  shape, and the only thing between a stranger and someone's history is that it cannot be
  guessed.
- **Unknown, revoked and expired all answer 404.** Distinguishing them turns the endpoint into
  an oracle for "did this link ever exist", which is what someone enumerating tokens wants.
- **Revocation and expiry are separate.** An expiry is a promise made at creation; revocation
  is the owner changing their mind, and it wins. Neither deletes the row — the owner should
  still see the link existed and how often it was opened.
- **Creating a link needs `garage.manage_settings`,** not a read capability: handing a
  vehicle's whole history to somebody outside the garage is not a read.
- **The passport is an allowlist, not a projection.** No people at all — no owner, no member
  names, no email addresses, no "recorded by". No document files, only their titles and types:
  a registration certificate carries an address, a signature and an identity number. No
  free-text notes, which is where people write what they never meant to publish. There is a
  test asserting the serialised response contains none of it.
- **The VIN and the money are included** — PRD §23 asks for them, and a history nobody can
  verify against the car in front of them is not a passport. The share dialog says plainly
  what the link exposes before it is created.
- **`primaryPhotoUrl` is deliberately null.** A signed storage URL would outlive revocation,
  because object storage mints it and this application cannot recall it.

### Not built in Phase 7

- **OCR** — needs a vision provider and an API key. The `ocr` queue and the outbox have
  existed since Phase 1, so this is a handler and a provider adapter, not an infrastructure
  change.
- **Advanced analytics** beyond the per-vehicle cost summary, the dashboard and the spend
  chart below. The rest is not specified concretely enough anywhere to build against.
- Sharing a whole garage rather than one vehicle: `SHARE_SCOPES` has one member on purpose.
- Built later: `PATCH /vehicles/:id/condition/:assessmentId` (sent `items` replace the set
  and recompute the score) and photos on an assessment (`vehicle_photos.condition_assessment_id`,
  migration 0006, set at photo finalize). The value page lists assessments with edit and delete.

## PDF export, and the migration guard

- **The passport prints to PDF through the browser, not a PDF library.** Every browser and
  every phone already renders the page and already knows how to save it as a file; a renderer
  would mean a second layout to maintain, a font pipeline, and a server holding a headless
  browser open to produce the same document. What was missing was a stylesheet, so
  `globals.css` has a `@media print` block: light on paper regardless of theme (a dark page
  prints as a black rectangle), surfaces separated by a hairline instead of contrast, controls
  hidden, and `break-inside: avoid` so a service record is not split across a page.
- **`assertNoMigrationDrift` runs at startup**, after the pool opens and before `listen`, so a
  process in that state never takes traffic. It compares the journal on disk against
  `drizzle.__drizzle_migrations` and names what is missing. A database *ahead* of the checkout
  is fine — the guard only asks whether anything is missing. 7 unit tests, including one that
  runs it against this repository's own migrations.

---

## The mobile app

Built after the web, against the same API, and **run on Android** — LDPlayer 9 (Android 9,
x86_64) with Expo Go, driven over `adb`. Sign-in, the tab bar, the garage list and the
briefing all render, and the session survives as a bearer token in the keystore.

Running it on a real Android image is how the last three bugs below were found; none of them
were visible from a bundle that built cleanly.

**To run it again:** LDPlayer's own adb is at `F:\LDPlayer\LDPlayer9db.exe`, and the
instance needs `basicSettings.adbDebug = 1` in `vms/config/leidian0.config` (the GUI's
Settings → Other → ADB debugging) before `adb connect 127.0.0.1:5555` works. Expo Go for
SDK 52 is version 2.32.20 — the APK the Play Store serves is for the current SDK and will
refuse this project.

### What it does

- **Sign in / sign up**, with the session token in `expo-secure-store` (Keychain on iOS,
  EncryptedSharedPreferences on Android).
- **Four tabs** — Garage, Vehicles, Tasks, Settings — in a floating pill, with a separate
  round **+** beside it. Not a mirror of the web's navigation: PRD §6.6 puts mobile on quick
  entry, reminders and checking tasks, and leaves depth to the web. Garage answers "what is
  happening" (briefing, attention, recent); Vehicles answers "which one".
- **The + opens a sheet**: Cost, Task, Document, Vehicle — each its own form.
- **Quick entry** on a vehicle: fuel, odometer, service. Three taps, prefilled with the last
  known reading.
- **Offline**: the query cache is persisted to AsyncStorage so the garage opens in a car park,
  and writes go to a queue on disk before the network is involved.

### Navigation shape

Navigation and action are deliberately different shapes: the pill is "where am I", the circle
is "add something". The usual centre-tab pattern makes the most frequent action on a phone
look like a fifth place to visit, and pushes the other tabs off the thumb's arc.

The pill's colours are `foreground`/`background` rather than a fixed black, so it inverts with
the theme and keeps full contrast either way.

The + is a sheet, not a screen: choosing what to add is not somewhere you navigate to, and a
back button afterwards would return you to a menu you had finished with.

### Four bugs the scaffold was carrying

The first three were found by building on it; the fourth only appeared once it ran:

1. **The API never read the bearer token.** `lib/api.ts` had been sending
   `Authorization: Bearer …` since Phase 2 and Better Auth was configured without the `bearer`
   plugin, so every mobile request was anonymous. One line in `plugins/auth.ts`. Verified:
   sign-up returns `set-auth-token`, and that token alone gets a 200 from `/users/me` with no
   cookie.
2. **Every colour would have failed to parse.** The shared tokens are authored in `oklch`,
   which CSS understands and React Native 0.76 does not — its normaliser handles hex, rgb,
   hsl and hwb. On a device that is a black surface, not an error. `packages/ui/src/color.ts`
   now converts oklch to hex from the same source, so the two platforms cannot drift; 10 unit
   tests against known values.
3. **Metro could not resolve anything.** `disableHierarchicalLookup = true` is standard
   monorepo advice for *hoisted* layouts and exactly backwards for pnpm, where a package's
   dependencies are symlinked into its own `node_modules` and resolution has to walk up from
   the requiring file. With `unstable_enablePackageExports` for the `@vehicle-os/*` subpaths.
4. **`"extra": { "apiUrl": null }` in `app.json` crashed every screen.** Expo serialises a
   JSON `null` in `extra` as `{}` in the manifest it serves, and `{}` is truthy — so
   `resolveBaseUrl` returned an object, and `createApiClient` died at import with
   "options.baseUrl.replace is not a function". Every route then reported itself as missing a
   default export, which points nowhere near the cause. The key is gone from `app.json`, and
   the resolver now requires a non-empty *string* rather than anything truthy.

**A fifth, found by running it again:** `expo-document-picker`'s native module is not in this
Expo Go build. A static import of it threw `Cannot read property 'EventEmitter' of undefined`
*while the module graph was loading*, so `AppRegistry.registerComponent` never ran and every
screen went blank behind Expo Go's spinner — one unavailable feature took out the whole app.
`lib/file-picker.ts` now requires it lazily, at the moment of use, and turns its absence into
a sentence on the document screen instead of a crash. Attaching files needs a development
build; everything else is unaffected.

Version drift also had to be settled before Expo Go would run it: `expo install --fix` moved
React 19 → 18.3.1, `react-native` → 0.76.9 and `async-storage` 2.1.0 → 1.23.1. The last one
mattered most — Expo Go ships a fixed native module version, and 2.1.0 would have failed on
the first cache read despite bundling perfectly.

### Decisions worth keeping

- **A quick action never awaits the network.** It writes to the queue and returns; the queue
  drains on launch, on foreground, and after any successful send. The moment quick entry is
  most useful — a pump, an underground car park — is exactly where there is no signal.
- **No connectivity library.** A failed send stays queued for the next attempt, which is the
  same outcome as asking first and being told there is no network — for one fewer dependency
  and one fewer thing to be wrong about.
- **The queue sends in order and stops at the first retryable failure.** A fill-up and the
  odometer reading after it are not independent; out of order gives the vehicle a reading it
  has to un-learn. A 4xx is dropped — the server has judged it invalid, and keeping it blocks
  every later entry forever. 11 unit tests, because none of this can be seen on a screen.
- **The pending count is visible in Settings.** An app that quietly holds unsent entries is
  one you cannot trust with a reading taken at a pump.
- **The cache is cleared on sign-in and sign-out.** It is persisted to disk and outlives the
  session, so the next person to sign in on a shared phone would otherwise see the last one's
  garage.

---

## Why requests feel slow, measured

Numbers from this machine on 2026-09-08, against the hosted `.env` (Neon `us-east-2`, Upstash).
Re-measure before acting on them from anywhere else; the whole picture is a function of one
number — the distance to the database.

| | before | after |
| --- | --- | --- |
| One `select 1` to Neon, warm | 245 ms | — |
| First query after idle (cold start) | 2,459 ms | — |
| A parameterised query (what Drizzle issues) | ~490 ms | — |
| `GET /api/v1/garages` | 2,210 ms | 1,000 ms |
| `GET /api/v1/vehicles/:id` | ~2,300 ms | 995 ms |
| `GET /api/v1/vehicles/:id/maintenance` | ~2,300 ms | 1,490 ms |
| `GET /api/v1/health` (no auth) | 570 ms | — |
| First visit to a route in `next dev` | 700–1,400 ms compile | ~0 with Turbopack |
| Second visit to the same route in dev | 53 ms | 53 ms |

**The cause is distance, not code.** Every database query costs ~0.5 s because the database
is in Ohio. Request time is that number multiplied by the number of *sequential* queries, so
the work here was cutting the multiplier:

- **Session was two queries per request.** Better Auth read `sessions` and `users` on every
  call. `session.cookieCache` (compact, 5 minutes) puts the session in a signed cookie:
  2,210 → 1,340 ms. Memberships are still read from the database on every request — those are
  the authorization decision and must not be cached in something the client holds.
- **Rate limiting was a round trip to Upstash on every request** (~250 ms), including reads.
  The shared counter now applies in production only; development uses the in-process LRU,
  which is accurate for one process: 1,340 → 1,090 ms.
- **The access guard read the vehicle, then the route read it again.** `requireVehicleAccess`
  now returns the row it had to fetch anyway, and the read routes use it: one round trip saved
  on every vehicle-scoped GET. Write routes still re-read deliberately — completing a service
  moves the odometer, and the response has to show the state after the write.
- **Page navigation was webpack, not the network.** `next dev` compiles each route on first
  visit; `--turbopack` is now in the dev script. Production builds do not pay this at all.

**What is left, in order of what it would buy:**

1. **Move the Neon project (and the Redis) to a region near the users.** 490 ms → ~30 ms per
   query would take these endpoints under 100 ms. Everything above is trimming a multiplier
   on a number that is worth fixing directly.
2. Neon scale-to-zero costs 2.5 s on the first request after idle. A paid always-on compute,
   or accepting it, is a choice to make deliberately.
3. Two queries per authenticated request remain (memberships, then the route's own). Folding
   memberships into the route query would save another ~490 ms per request.

`SQL_DEBUG=1` on the API prints every statement, which is how the counts above were taken.

---

## Traps that have already cost time

Each was a real bug found by a test.

**Ajv coerces `null` to `""`.** `Type.Union([X, Type.Null()])` compiles to `anyOf`, and
`coerceTypes` — which Fastify needs so `?limit=25` arrives as a number — coerces `null` on
the string branch. Use `Nullable()` from `packages/contracts/src/common.ts`. It emits
`type: ['string','null']` for concrete types and passes a literal union through unchanged,
because a union of `const` branches has nothing for null to be coerced into (verified).

**Fastify defaults `removeAdditional: true`**, turning `additionalProperties: false` from a
rejection into a silent strip. Explicitly off in `app.ts`.

**Ajv knows no formats by default.** `format: 'uuid'` does nothing until `ajv-formats` is
registered — it is, restricted to the four formats the contracts use.

**`Math.round` does not fix binary float error.** `1.005 * 100` is 100.49999999999999.
`packages/domain/src/money.ts` nudges by one ulp first. Money never crosses the wire as a
decimal — always `amountMinor` plus an ISO 4217 currency.

**`setMonth` overflows.** 31 Jan + 1 month gives 3 March. Use `addMonths` from
`packages/utils`, which clamps.

**`dotenv/config` only looks at `process.cwd()`.** Use `loadEnvFile()` from
`@vehicle-os/config`, which walks up to `pnpm-workspace.yaml`.

**Comparing a `jsonb` column to an object needs `@>`, not `eq`.** Equality requires the whole
document to match; containment asks the question you actually meant.

**drizzle-kit cannot resolve `.js` import extensions.** All workspace imports are
extensionless; keep them that way.

---

## Architecture rules being followed

- The garage is the tenant boundary. A `garageId` from a request is an argument to be
  checked, never evidence. `requireVehicleAccess` resolves it from the database.
- **A resource in someone else's garage returns 404, not 403.** A 403 confirms it exists and
  turns an id leak into an enumeration oracle. A member who merely lacks the capability does
  get a 403 — they already know the garage exists.
- Permissions are capability strings, not role checks. `maintenance.plan.write` and
  `maintenance.record.write` are separate so a DRIVER can log a completed service without
  editing schedules — covered by a test.
- Background work goes through the outbox, in the same transaction as the domain change.
- Soft delete only on `vehicles`, `documents`, `tasks`, `ideas` (§103).
- Modules are `domain/` → `application/` → `infrastructure/` → `http/`.
- The worker imports shared application code from `@vehicle-os/api` through an explicit
  `exports` entry. Two deployables over one codebase is what a modular monolith is (§4).

---

## Deviations from the documents

| Document says | Built as | Why |
| --- | --- | --- |
| Auth provider unspecified (§12) | Better Auth behind `ActorContext` | §90 forbids custom auth. ADR 010 |
| Test DBs via Docker (§68, §72) | PGlite in-process | Suite runs anywhere. ADR 011 |
| `maintenance.write` (§13) | `.plan.write` + `.record.write` | DRIVER logs work without editing schedules |
| `Database` = concrete driver | `PgDatabase` base type | Same repositories on postgres-js and PGlite |
| Docker Compose required (§68) | Postgres only; Redis and storage optional | Hosted services work with zero local install |

`docker-compose.yml` is still correct and still the fastest route to MinIO.

---

## Phase 8 — Intelligence

`POST /api/v1/ai/ask`, `modules/ai`, and an **Ask** screen on the web. 9 integration tests.
**Not verified against a live provider** — there is no key in `.env`, so every test drives a
scripted provider and the Gemini request shape has never had a real answer come back.

- **The model is never given database access** (§41). It gets five read-only tools —
  `list_vehicles`, `get_vehicle_profile`, `get_vehicle_costs`, `get_vehicle_timeline`,
  `get_attention_required` — and nothing else, so the worst a prompt injection achieves is a
  call this application was already willing to answer for this caller. There is no write
  tool, so no prompt can change a record.
- **`tool-runner.ts` is the security boundary.** Every `vehicle_id` the model supplies is
  resolved to its garage and checked against the caller's memberships, exactly as a route
  would — the model's arguments are untrusted input, and a service note it has read can try
  to name somebody else's vehicle. "Not found" and "not yours" are the same answer. The test
  that matters asserts a vehicle from another user's garage comes back refused, with no
  vehicle attributed in `sources`.
- **The answer carries its provenance** (§43). `sources` lists the tools that ran and the
  vehicle each answered for, and the Ask screen shows them rather than hiding them — an
  answer built from records the reader can name is checkable; a bare one is a claim.
- **The system prompt forbids filling gaps.** Every fact must come from a tool result in the
  conversation; where the tools do not cover the question the model says what is missing. A
  plausible invented service interval is worse than an admission, because only the second
  can be checked.
- **Four rounds, then it answers.** An unbounded tool loop is a model that can bill
  indefinitely on one request; the ceiling is a returned sentence, not an error, and the
  sources still show what was read.
- **Provider-agnostic port, Gemini adapter.** `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` —
  named by role because the vendor is one file (`gemini-provider.ts`, plain `fetch`, as with
  every other outbound call here). `OPENAI_API_KEY` is gone; the `ai` flag now reads
  `AI_API_KEY`, and Architecture.md §106's "OpenAI API" is out of date.
- No key configured is a **503 naming the missing configuration**, not a 500.
- `garageDefaultCurrency` moved into the expense repository so the cost route and the cost
  tool quote money the same way rather than by two similar-looking code paths.

---

## Two bugs that kept the cutout from ever appearing

Reported as "I uploaded the image but it didn't remove the background". Neither raised an
error anywhere, which is why they lasted.

- **No client ever sent `setAsPrimary`.** `uploadPhoto` accepted it, the photos page and the
  onboarding step both omitted it, and the cutout job runs for the primary photo only — so a
  vehicle finished onboarding with photos, no primary, a glyph on its card, and a job that
  correctly did nothing. **Now the server decides**: `finalizeUpload` sets `primary_photo_id`
  where it is still null, so the first photo becomes the primary one on its own and every
  client benefits. `where primary_photo_id is null` makes it a no-op afterwards, so it never
  takes the choice back from someone who picked a different photo. One integration test.
- **Promoting a photo re-used finalize's job key.** BullMQ dedupes on the job id and keeps a
  completed job for an hour, so the enqueue from "set as primary" collided with the one from
  finalize — which had already run, before the photo was primary, and done nothing. The queue
  was empty, the photo was primary, there was no cutout and no error. Job keys now name the
  reason: `process-photo:{id}:finalize` and `:primary`. Running twice is harmless — the
  handler returns early once a cutout exists.
- The onboarding grid marks the first photo **Featured**, because a rule the server applies
  silently is one the user has no way to know about.

---

## The outbox never dispatched anything

Found when the first cutout never appeared. **BullMQ refuses a custom job id containing
`:`** — it delimits its own Redis keys with one — and every `jobKey` in this system is
colon-delimited (`process-photo:{photoId}`, `maintenance-due:{planId}:{dueOdometer}`). Every
dispatch failed with `Custom Id cannot contain :`, retried five times and dead-lettered. No
queued job had ever run: not a maintenance reminder, not a document expiry, not a photo.

- `jobIdFor()` in `dispatcher.ts` substitutes `__` for `:` at the one point the key has to
  satisfy a queue's naming rules. The key in the database keeps its colons — it is the
  system's own dedupe identity and reads better that way.
- **The fake queue in `dispatcher.test.ts` now enforces the same rule.** Its absence is the
  whole reason this shipped: 15 tests passed against a queue that accepted anything.
- The messages already dead-lettered were revived by hand (clear `dead_lettered_at`, reset
  `attempts`) once the fix was in.
- A **permanent 4xx from the remover no longer retries**: a 1x1 test PNG is "too small" on
  the fifth attempt too, so `BackgroundRemovalError.permanent` is logged and swallowed, and
  the card keeps the original. A 429 or 5xx still retries, because there the same request
  later is exactly what fixes it.

**The worker has to be running for any of this.** `pnpm --filter @vehicle-os/worker dev`,
alongside `pnpm dev`. Nothing in the API says so when it is not.

---

## Seven queues nobody consumed

Upstash returned `ERR max requests limit exceeded. Limit: 500000` and the worker could not
reach Redis at all. The cause was not traffic — it was idling.

`QUEUE_NAMES` declares ten queues; three have a producer and a handler (`notifications`,
`image-processing`, `maintenance`). The other seven were created in Phase 1 so a later phase
could add a handler rather than an infrastructure layer. But `index.ts` spawned a BullMQ
worker per name, and **every worker polls Redis on a loop whether or not anything will ever
arrive** — so seven empty queues polled continuously for as long as the worker ran. Cheap to
write, expensive to run, and invisible until someone reads the bill.

- **`ACTIVE_QUEUES`** is the subset that gets a worker. `QUEUE_NAMES` stays as the outbox's
  contract — it is what the API validates against.
- **Forgetting to activate a queue is loud, not silent.** `createQueues` builds only the active
  ones, so the dispatcher finds no queue for the name and dead-letters the message with
  `Unknown queue: …` instead of handing it to Redis to sit unread. One test covers it, and
  `registerScheduledJobs` throws rather than registering a repeatable nothing will run.
- **`drainDelay: 60`** (from 5). It is how long the blocking read waits before asking again —
  12 requests a minute per queue became one.
- **`stalledInterval: 300_000`** (from 30_000). This trades recovery time for requests: a
  crashed worker's in-flight photo now waits up to five minutes to be reclaimed rather than
  thirty seconds. Right for background image processing; wrong for anything a user waits on.
- **The outbox dispatcher polls at 2.5s, not 1s.** Every tick is a Postgres round trip whether
  or not there is anything to send, and nothing here is interactive.

Together: three workers instead of ten, each polling a twelfth as often — roughly a 97% cut in
idle Redis traffic.

---

## Repository map

```
apps/api          Fastify. 4-layer modules under src/modules/
apps/web          Next.js 15, app router, src/ dir, zunoUI + beUI
apps/mobile       Expo Router scaffold — typechecks, never run on a device
packages/contracts  TypeBox schemas, shared by API and clients
packages/domain     Enums, Money, units, authz, vehicle capabilities and specs
packages/database   Drizzle schema, migrations, client, PGlite test harness
packages/api-client Typed client + TanStack Query keys
packages/ui         Design tokens as data (web reads CSS, RN reads objects)
packages/config     Env schema, .env discovery, feature flags
packages/utils      UUIDv7, UTC date maths, assertions
workers/worker      BullMQ consumers, outbox dispatcher, scheduled jobs
```

22 tables, five migrations. CI fails if `pnpm db:generate` produces a diff.

---

## The design language

Set from three references the owner supplied, and it is one language on both platforms: a
cutout vehicle as the hero, one saturated accent, soft surfaces, big figures under the hero,
square action tiles, a floating pill for navigation on the phone.

- **`#ffd60a`, and it is the only saturated colour on the screen.** Anything wearing it is
  the thing to act on — the primary button, the active tab, the live status pill. Its
  foreground is near-black in *both* themes, because yellow is a light colour and white text
  on it fails contrast at any size; a `primaryForeground` that flipped with the theme was the
  bug the old `#ff9500` was already carrying in light mode.
- **The focus ring is not the brand colour.** A ring must clear 3:1 against what sits behind
  it and `#ffd60a` on white is about 1.4:1 — an indicator nobody can see is an accessibility
  failure that looks like a design choice. Dark keeps the yellow; light uses the same hue
  pushed to `oklch(0.55 0.15 75)`.
- **The light page is not white** (`oklch(0.965 0.002 250)`). White cards on a white page have
  nothing to separate them and the layout collapses into one sheet of paper.
- Radius went to `1.25rem`, with `--radius-3xl` for the hero.

---

## The vehicle screen

- **Four tabs, not eight**: Overview, History, Value, Documents. Maintenance, tasks, costs and
  photos kept their screens but lost their tabs — as tabs they were four places to open before
  knowing whether any of them needed attention. They are summary cards on Overview now, each
  answering that question in place and linking through for the full picture.
- **Quick actions sit above the tabs**, six across. Recording something is why most visits to
  a vehicle happen, so it is not behind one of them. The same component serves the dashboard
  rail at three across (`variant="rail"`); a square tile at a sixth of a 1152px page is 190px
  tall, which is a button the size of a card.
- **`timeline` was renamed `history`**, route and label. A URL that disagrees with the tab it
  serves is a small thing that costs someone an afternoon later.
- **History is a dated rail, not a list of rows.** What a history has to show is *when*, and
  rows of equal weight say only "in this order". Entries group under a sticky month heading —
  scrolling a long history, "which month am I in" is the question the page must keep
  answering — with a continuous line behind a marker per entry, stopped short on the last row
  of a group so it does not trail off. Every entry is stamped with the date, the kind of thing
  it was and the odometer it happened at: the three facts that place it in a vehicle's life.
- **Grouping walks consecutive runs rather than keying a map.** The list arrives newest-first
  from the server; a map read back would reorder by insertion and quietly re-sort the history.
- **The type filter is a select, not chips.** There are twenty event types, so the chip strip
  showed eight and scrolled the rest out of sight — hiding exactly the uncommon type someone
  was filtering for.

---

## Editing a vehicle

`PATCH /vehicles/:id` and its validation existed since Phase 2 with no UI; the form is on the
Overview page's Identity card (`vehicles/[vehicleId]/edit-identity.tsx`), which toggles
between the definition list and the form rather than taking over a route of its own.

- **Only what changed is sent.** A PATCH echoing the whole form back would overwrite anything
  edited elsewhere between the page loading and the save — silently: someone changes a colour
  and clobbers an odometer a garage member had just corrected.
- **An emptied box means "clear this"**, so the nullable fields send `null`. The odometer is
  the exception and is left alone: a vehicle without a reading is one nobody has entered, not
  one that has been zeroed, and the contract has no null for it.
- **Price and currency move together.** An amount sent without the currency it was typed in
  would be reinterpreted in whatever the row already held — the same number, a different
  amount of money, and nothing on screen to show it changed.
- **Minor units come from `minorUnitExponent` in `@vehicle-os/domain`**, the same table the
  server stores against, rather than a second `× 100` in the web app. `formatMoney`'s
  counterparts `toMinorUnits` / `fromMinorUnits` are in `lib/format.ts`.
- Engine hours are only offered for a type whose capabilities include the meter, so a car
  never shows a blank hours field.

---

## The units every entry form writes

Five write paths were hard-coding `'USD'`, `× 100` and `'KM'`. Both are silent: the number
still reads like money and 36,000 still reads like an odometer, so nothing on screen ever
said a euro garage was recording dollars or that a miles vehicle had been logged in
kilometres — and every derived figure (cost per distance, a distance-based service interval)
was then wrong by 1.6, or by 100 in a zero-decimal currency.

- **`lib/vehicle-units.ts` resolves both from the vehicle**, with the same precedence the
  server's `primaryCurrency` uses (§27): the price it was bought at, then the garage's own
  default. `'USD'` is the last resort, not the default.
- **`toMinorUnits` everywhere**, so ¥1,000 stores as 1000 and not 100000.
- **Fixed on the web in**: the history quick-add (currency *and* odometer unit), the expense
  form, the maintenance completion form (parts and labour), the valuation form, and the
  create-vehicle form — which now **asks** for the odometer unit instead of assuming
  kilometres at the one moment the answer is unrecoverable later.
- **And on mobile**, where it mattered more: `add/cost` (all three), the vehicle screen's
  quick-log, and `add/vehicle`, which now has a unit picker. Quick entry is the screen used
  at the pump, which is exactly where a fill-up abroad happens. `lib/vehicle-units.ts` is the
  mobile twin of the web resolver, taking the vehicle it already has rather than refetching.
- **Audited the live database afterwards**: every garage USD, every vehicle KM, every event's
  odometer unit matching its vehicle. Nothing was mis-stamped — the bug was real but had not
  yet bitten, so the fix prevents rather than repairs.
- **The expense form takes a per-entry currency override.** One tank of fuel abroad is real,
  and the cost summary already reports what it could not add up rather than converting it.
  Every other form follows the vehicle, which is right for almost every row.

---

## The edit and delete controls

Four things had API and client support since Phases 3 and 4 with nothing driving them.

- **Editing a schedule** (`maintenance/edit-plan.tsx`). Until now a wrong interval could only
  be fixed by deleting the plan and adding it back, which threw the last-done baseline away
  with it — the next due date was then recomputed from nothing and the schedule silently
  restarted. It also carries `isActive`, so a schedule that does not apply this season can be
  paused instead of deleted; deleting it to silence it loses the record of how often the work
  is due.
- **Logging an unscheduled repair** (`maintenance/log-repair.tsx`). The timeline quick-add
  wrote an event but no maintenance record, and the maintenance history is what a buyer reads
  and what the passport prints — a repair that exists only as a timeline note is missing from
  both.
- **Editing and deleting an expense**, and **editing and deleting a task**. Both reuse the
  form that creates them rather than adding a second copy: the fields are identical, and a
  separate correction form drifts from the entry form the first time a field is added.
- **Deletes confirm, and say what is lost.** An expense is a hard delete server-side — after
  the transaction the row exists nowhere else and every total on the page moves.
- **Row controls are always in the DOM and always focusable**, revealed by opacity on hover
  and focus-within. Rendering them only on hover makes them unreachable by keyboard and
  invisible on touch.

---

## Adding a vehicle

A four-step dialog (`components/add-vehicle-dialog.tsx`) replaced the `/vehicles/new` page,
which is deleted rather than kept alongside — two implementations of one form drift, and this
session had already fixed the same odometer-unit bug in both separately.

- **A native `<dialog>` with `showModal()`.** It traps focus, makes the page behind it inert,
  closes on Escape and gives a `::backdrop` — four things a hand-rolled modal gets wrong,
  usually the focus trap.
- **Steps, because the page asked eleven things at once** and most were optional, so nothing
  signalled what actually mattered. Type → make → details → odometer, and the type answer
  narrows what follows.
- **All ten vehicle types** are offered as tiles, not a select.
- **205 manufacturers, with logos from logo.dev.** `lib/vehicle-makes.ts` is a name-to-domain
  map — cars, motorcycles, trucks, bicycles, boats, caravans and machinery, from Japan, Korea,
  Europe, the US, China, India and elsewhere. It is **3.5 kB gzipped for 205 makes**, where
  bundling SVGs was 42 kB for 39; a logo API is addressed by domain, so the app carries the
  domain and not the artwork.
- **The list is filtered by the type already chosen.** A motorcycle owner should not scroll
  past two hundred car marques, and the type is answered before the make is asked. Vans and
  RVs borrow the car list, ATVs the motorcycle one, rather than each keeping a list that
  would go stale separately.
- **Three ordinary things fall back to the make's initial**: a make not in the map, a
  deployment with no `NEXT_PUBLIC_LOGO_DEV_TOKEN`, and a request that fails at the CDN. The
  fallback is a letter rather than a stand-in glyph — borrowing a similar mark would label a
  vehicle as another company's. Typing any make is accepted; the list is a shortcut, not the
  set of valid answers.
- **The token is publishable** (`pk_...`), so the URL is built on the client and there is no
  proxy route. Without it the picker is plainer, not broken.
- **`next.config.mjs` loads the repo-root `.env`.** The monorepo keeps one env file — what
  `loadEnvFile` walks up to, and what the API and worker read — but Next loads env from its
  own directory, so `NEXT_PUBLIC_LOGO_DEV_TOKEN` added to the root file was never seen and
  the feature looked broken for no visible reason. `process.loadEnvFile` is Node's own, so
  this needs no dotenv import, and `apps/web/.env.local` still wins for web-specific values.
- **All 205 domains were checked against the live API**: 204 returned a real logo. Lucid's
  `lucidmotors.com` came back as a 294-byte placeholder and was changed to `lucid.com`.
- **The dialog is still a dynamic import**, now because a wizard is dead weight on every page
  that never opens one rather than because of its size.
- **The manufacturer's mark appears on the vehicle card too**, where the type glyph used to
  be — a logo identifies a vehicle faster than any label does.
- **The number plate is asked for at onboarding.** It is `registrationIdentifier`, the column
  that already existed — relabelled to the name people actually use. No schema change: a
  second plate column would be the same fact stored twice.
- **Photos and documents are a fifth step, after the vehicle is created.** Both are addressed
  by vehicle id, so there was nothing to attach them to before that — which is also why that
  step has no Back and no Cancel, only Done, and why dismissing the dialog from there still
  lands on the new vehicle rather than the list. Uploads run one file at a time: the
  ticket-then-PUT-then-finalize handshake is three round trips each, and ten in parallel is
  how a phone on a slow connection times them out. Everything on the step is optional.
- **The nickname is asked for as "Name it"**, with the make and model as its placeholder,
  because that is what `displayName` falls back to anyway.

---

## The vehicle hero's gallery

- **The hero image is the vehicle's whole gallery**, not just its primary photo. The primary
  leads, because it is the one chosen to represent the vehicle and the only one with a cutout
  behind it.
- **Arrows appear on hover but never leave the tab order**, and `focus-within` brings them
  back for the keyboard. Controls that exist only on hover do not exist on a touchscreen.
- **The dots stretch rather than brighten**: the active one becomes a pill, so position in the
  set reads at a glance instead of having to count filled circles.
- **The photos are passed in, not fetched by the hero.** The garage screen shows the same
  hero for a vehicle whose photos it has no other reason to load, and a component that
  quietly issues a request per instance is how a list of six becomes six requests.
- **The year moved to the subtitle beside the variant**, and the figure it vacated is the
  number plate. Year is identity and never changes; a figure slot belongs to something that
  does.

---

## The header

- **Two nav items, not six.** Search became the header's own control, so a link to it was a
  second route to what is already on screen. Tasks and Ask are places you arrive at from what
  you are looking at — the dashboard's task card, a vehicle's quick actions — not places you
  set out for; their routes are unchanged. Settings became a dialog: it is a detour from
  whatever you were doing, and a modal returns you to it where a route does not.
- **Search is a real combobox** (`components/header-search.tsx`) — `role="combobox"`,
  `aria-activedescendant`, a `listbox` of `option`s. The ARIA pattern is what makes the arrow
  keys walk the results while focus stays in the box; a div with a click handler gets the look
  and none of that. Debounced at 200 ms, Escape closes without clearing, and Enter with
  nothing highlighted falls through to `/search`, which is still better for a long list.
- **Outside clicks close it on `pointerdown`, not `click`** — otherwise choosing a result is
  cancelled by the close that the later click triggers first.
- **`SEARCH_KINDS` moved to `lib/search-kinds.ts`.** It lived on the search page, and when the
  timeline route was renamed to `history` it kept pointing at the old one: every timeline hit
  was a 404 nothing tested. Now one map, two callers.
- **Settings is one panel, two hosts.** `components/settings-panel.tsx` is rendered by the
  dialog and by `/settings`, so a setting added to one is in the other by construction. The
  theme toggle moved into it, beside the other preferences.

### The notification dropdown had no background

`bg-popover` was on the vendored beUI popover, and **`--color-popover` was never defined**.
Tailwind resolves an undefined colour token to nothing, so the panel rendered transparent with
no error anywhere — exactly the failure the theme block warns about: these token names belong
to the vendored components, not to us. Defined now in both themes, a step above `card` because
a popover floats over cards. Every other token used in `components/` and `app/` was audited
against the `@theme` block; this was the only one missing.

---

## Selects come from beUI, not the platform

All 17 native `<select>` elements are gone. zunoUI rule 4 is explicit — switch, select, tabs,
slider, tooltip, popover come from beUI, pulled not written — and every one of these carried a
hand-written `focus-visible:ring-2 focus-visible:ring-ring` on a bare `<select>`, which is the
ring string being maintained by hand in seventeen places.

- **`components/ui/select-field.tsx`** assembles trigger, value, content and items the same way
  every time. Seventeen inline copies is how two of them end up subtly different.
- **`SelectTrigger` gained an `ariaLabel` prop.** Its accessible name is whatever value is
  showing, so without it a screen reader announces "Kilometres, button" and never says what
  that is a choice of. A local addition to a vendored component — noted in the file so it
  survives the next `shadcn add`.
- **`ANY_VALUE`, because the vendored select has no empty option.** It registers options by
  value and shows the label of the current one, so an option carrying `''` cannot be told from
  "nothing selected". The sentinel keeps them distinct and callers map it back at the boundary.
- **The ring is gone entirely** — see below.

---

## Focus is one base rule, not 44 class strings

`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` appeared 44 times
across 25 files: the same decision maintained by hand in 44 places, and drifting in three of
them. All of it is deleted. `globals.css` carries one `:focus-visible` rule instead.

- **A thin outline on the element's own edge**, not a coloured halo around it. The ring read as
  a heavy band in the accent colour, and the accent's whole job is to mark the one thing worth
  acting on — a focus indicator wearing it competes with that.
- **`--color-ring` is neutral now**, not the brand yellow. Grey in both themes, dark enough on
  paper-white to clear 3:1.
- **`:focus-visible`, not `:focus`**, so a mouse click never draws it and only keyboard
  navigation does. This is what makes a quiet indicator acceptable: it is never seen by someone
  who does not need it.
- **The indication itself stays.** Removing it would leave a keyboard user with no idea where
  they are — WCAG 2.4.7. The ring is gone; being able to see where focus is, is not.
- Components carry no focus classes at all now, including the vendored beUI ones, so there is
  nothing left to drift.

---

## The hydration mismatch in the vendored motion components

React reported "some attributes of the server rendered HTML didn't match the client
properties" at `select.tsx` `SelectItem`, on `variants={ctx.reduce ? undefined : ...}`.

`useReducedMotion()` reads `prefers-reduced-motion`, a media query the server does not have —
so it returns false there and can return true on the client's very first render. Every
`motion.*` element whose `variants` depend on it then writes different `style` attributes than
the server sent. The in-app toggle has the same shape: `MotionConfig reducedMotion` is fed from
`localStorage`, which the server cannot read either.

- **`lib/hooks/use-stable-reduced-motion.ts`** makes the first client render agree with the
  server — motion allowed — and lets the real preference take effect on the commit after
  hydration. Nothing is animating in that frame: these components animate on open, hover or
  value change, all of which happen after mount.
- **All seven call sites** across `loader`, `popover`, `select`, `switch`, `tabs` and `tooltip`
  go through it; no raw `useReducedMotion()` remains. Local edits to vendored components, one
  import and one call each, so re-applying after a `shadcn add` is mechanical.
- The settings stores were already correct: `useSyncExternalStore` with a server snapshot, so
  React uses that during hydration rather than reading `localStorage` too early.
- **The header had the same shape.** The session is not knowable on the server, but often is on
  the client's first render — better-auth resolves it from the cookie synchronously — so the
  header rendered three more children than the server sent (search, bell, sign-out) and React
  reported the mismatch against the first stable element it found, the brand link. `signedIn`
  now waits one commit.
- **`lib/hooks/use-hydrated.ts`** is the shared piece: false during the server render and the
  client's first pass, true from the commit after. Anything the server cannot know — a media
  query, `localStorage`, a session from a cookie — is unsafe to render on directly, and this
  defers the difference by exactly one commit. It is not a way to silence the warning: the
  value still has to be one nobody misses for a frame.

**The hydration fix then exposed a second bug, in the component itself.** Making `reduce` flip
after mount turned `variants={ctx.reduce ? undefined : ITEM_VARIANTS}` from a constant into a
change — and an element whose `variants` are removed keeps whatever styles it last had. While
closed that is the hidden state, `opacity: 0`, so opening the select changed nothing and the
list rendered blank. The variants stay on now and only the transition goes to zero:
**reduced motion means no movement, not no state.** The other `reduce ? undefined` sites drop
an animation or a filter rather than a state definition, so none of them strand an element.

---

## The select's closing animation

Opening already morphed — the panel unfolds out of the trigger, corners flatten then round,
and the items stagger in top-down. Closing did not: `LIST_VARIANTS.hidden` was empty, so every
item left at once while the box collapsed under them. The list vanished and *then* the panel
folded, which reads as two unrelated events rather than one thing folding away.

- **The exit stagger runs bottom-up** (`staggerDirection: -1`), so the items retreat towards
  the trigger just ahead of the collapse and the panel folds back into the control it came out
  of.
- **The exit is faster than the entry** (18ms per item against 35ms). Leaving should get out of
  the way; a close that takes as long as an open feels like the control is arguing.
- **Items exit upward**, towards the trigger. Drifting down on the way out looks like falling
  off the list rather than folding into it.
- **The height collapse trails the items rather than racing them**, so the box is still there
  to fold while the last row is still leaving.

---

## The vehicles page header

- **One combo button**: add a vehicle, and the filter that changes what is on screen, joined
  rather than spaced. Separated they read as two unrelated buttons competing for the same
  corner. The seam is a hairline in the foreground colour so it reads against the accent.
- **The filters live in a dialog.** They were two rows of controls permanently occupying the
  space between the heading and the thing the page is about. Filtering is occasional; the
  vehicles are not.
- **The button says when filters are on**, with a count badge, and its `aria-label` says so
  too — a filtered grid that looks like an unfiltered one is how "where did my vehicle go"
  happens.
- **The count is gone from the page but not from the announcement.** `StatusRegion` gained a
  `className` so it can be `sr-only`: a filter that changes the grid still tells a screen
  reader user how many results it left, where removing it outright would leave them with
  silence and a changed page.

---

## Web UI conventions

- Tailwind v4 CSS-first. **No `tailwind.config.js`** — the theme is the `@theme` block in
  `src/app/globals.css`. Next has no Vite, so `@tailwindcss/postcss` is the entry point.
- Token names are shadcn's, which the vendored beUI components are classed against —
  renaming one loses their styling silently, with no type error.
- Surfaces separated by contrast, not borders: a card is `bg-card/50`. Never nest two.
- One focus ring: `focus-visible:ring-2 focus-visible:ring-ring`.
- beUI primitives vendored into `src/components/motion/`. Keep those paths.
  `pnpm --filter @vehicle-os/web exec npx shadcn@latest add @beui/<name>`
- **Urbanist** through `next/font/google` in `layout.tsx`, self-hosted at build time and
  exposed as `--font-urbanist`, which `--font-sans` points at. The system stack behind it is
  what renders during the swap, so it stays in the token. The variable font carries every
  weight, which is why no `weight` list is passed.
- **The vehicle is the hero.** `components/vehicle-hero.tsx` puts the cutout on the card with
  no frame, no crop and no ground under it, above a strip of three large figures separated by
  hairlines — readings off one object, not three boxed facts. This is where the background
  removal earns its cost: a car floating on a surface only works because the photo has no
  background to box in. A vehicle whose photo has not been cut out gets the same composition
  with the picture in a rounded frame, so there are not two designs depending on whether a
  worker has run. The same hero opens the garage screen and every vehicle tab, so moving
  between them is one object staying still.
- **The dashboard is 8/4**: the vehicle and its briefing on the left, quick actions and what
  needs attention on the right — what you are looking at, then what to do about it. The
  summary figures that used to sit on top are gone; they restated what the cards below
  already say, in the position that should carry the answer to "what needs doing".
- **Quick actions are square tiles, not a list** (`components/quick-actions.tsx`). They are
  peers — a stacked list implies a ranking nobody intended.
- **The next service is lifted out of the attention list, not repeated above it.** The server
  already sorts overdue-first, so `attention.maintenance[0]` is the job to act on; it gets a
  card with the screen's only primary button and the list below shows `slice(1)`. A second
  accent-coloured button would leave neither meaning "act here". On the phone the same card
  is inverted with an accent pill, which is what makes it read as an action rather than
  another row to scroll past.
- `TileRow` (a list row that is really a card, with a status rule down its leading edge) is
  in `ui/primitives.tsx`.
- **Status is an accent rule, never a tinted surface.** A row stays on the same ground as
  everything else; only its leading rule and its badge carry colour. Tinted cards make a mild
  warning shout louder than the value it qualifies.
- **Nothing is printed over a vehicle photo.** Text on an image needs a scrim, the scrim
  darkens the half of the car it covers, and the result is a caption competing with its own
  subject — and a cutout has no dark ground to put text on at all. The name sits under the
  image with the type as a glyph beside it, and three labelled figures (odometer, year, paid)
  on a fixed grid pushed to the bottom, so a row of cards reads across and a name that wraps
  does not knock its numbers out of line. Same card on mobile, same three figures in the same
  order.
- **Icons**: `<Icon name="maintenance" />` from `@/components/icons`. To add one, edit the
  list in `scripts/generate-icons.mjs` and run `pnpm --filter @vehicle-os/web icons`.
  `@iconify-json/solar` is a devDependency — the full 10.5 MB set must never reach the bundle.
- **No page waits behind the word "Loading".** Everything that does not depend on the
  response — headings, the tab strip, filter chips, the button that opens a form — renders
  immediately, and only the unknown part is drawn as a placeholder of the shape it will take.
  `components/ui/skeleton.tsx` holds `Skeleton`, the `Loading` wrapper (one `role="status"`
  announcement for a whole region, with the blocks themselves `aria-hidden`) and the shared
  shapes: `ListSkeleton`, `StatsSkeleton`, `CardGridSkeleton`. Match the real heights — a
  placeholder of a different size moves the page under the reader when the data lands.
- **Gate on `isPending`, never `isLoading`.** With `placeholderData: keepPreviousData` —
  used wherever a filter changes the query (timeline, vehicles, vehicle tasks, costs) —
  `isPending` is false while previous data is on screen, so pressing a filter chip changes
  the list instead of emptying the page and refilling it.
- Settings state uses `useSyncExternalStore` over a module, not context.
- `<MotionConfig reducedMotion>` in `providers.tsx` is what makes the in-app toggle reach
  vendored components at all.

**Urbanist on mobile** is `lib/fonts.tsx`. React Native has no cascade, so a font set on a
container reaches nothing below it — the choice was a `fontFamily` on all 30-odd text styles
or one patch of `Text.render`, which inserts the family *under* each call's own style so
nothing already written is overridden. Each weight is its own family in expo-google-fonts
(`fontWeight` does nothing to a custom family), so the patch maps the weight already on the
style to the right file. The root layout renders nothing until the font is in memory: RN has
no `font-display: swap`, and text drawn first in the system font re-lays-out the screen under
the reader. Upgrade path, if it ever fights a RN release: an `<AppText>` wrapper and a lint
rule banning bare `<Text>`.

**Known adaptation:** the vendored beUI `Switch` destructures its props and takes
`ariaLabel`, not `aria-labelledby`. `SettingRow` passes the title text instead of the id.

- **Due status is never recomputed client-side.** `DueBadge` maps the server's status to a
  colour and nothing more; `describeDue()` reads `daysRemaining` / `distanceRemaining` rather
  than subtracting dates itself. Same for the task buckets — the server bucketed them in the
  user's timezone, and re-deriving "today" in the browser makes a laptop abroad disagree.

---

## Open items

- **Rotate the Neon password, the Upstash Redis token and the Upstash Blob token.** All
  three were pasted into a chat transcript. `.env` is gitignored, but the credentials
  themselves have been shared.
- **Object storage is live** on Upstash Blob (`UPSTASH_BLOB_TOKEN`), which is S3-compatible
  and R2-backed. Its credentials are short-lived, so
  `infrastructure/storage/upstash-blob-storage.ts` clamps every presigned URL's TTL to the
  credential's remaining life — a 15-minute upload URL signed five minutes before expiry
  would otherwise die early and 403 an upload the client had no reason to doubt. A raw S3,
  R2 or MinIO bucket still works through the `OBJECT_STORAGE_*` variables.
- `apps/mobile` runs on an Android emulator: sign-in, tabs, garage list and briefing verified
  on screen. **iOS has never been run** — it bundles and typechecks, nothing more. Quick entry
  and the offline queue have not been exercised by hand on the device yet either; the queue's
  logic has 11 unit tests behind it.
- Email and push delivery are stubbed; the handler logs. In-app notifications are real.
- **The Pixelcut key in `.env` was pasted into a chat transcript**, like the Neon, Upstash
  Redis and Upstash Blob credentials above. Rotate it with the rest.
- Neon's first query was 2.2 s (cold start plus cross-region latency to `us-east-2`).
