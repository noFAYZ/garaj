# Competitive gaps

Nine things Garaj does not do that comparable vehicle-maintenance products generally do, written
to be picked up one at a time in separate sessions.

Each entry says what is missing, the evidence it is missing, why it is worth doing, what to build
and roughly where it lands. The order at the bottom is a recommendation, not a constraint.

**On method.** Every *absence* here was verified against this codebase. The claim that competitors
have these is category knowledge rather than a live survey — worth a spot-check against two or
three current apps before planning a quarter around it.

**What is already competitive**, and should not be rebuilt while chasing this list: multi-vehicle
garages with roles and sharing, non-car types with type-specific specs, an offline-first phone
client with idempotent replay, explainable health scoring, document expiry tracking, full-to-full
fuel consumption, cost-per-distance, AI ask, and an audit trail.

## Status (2026-09-19)

Items 1–8 are built on the API, web and phone, with unit and integration tests; 9 is deferred.
Migrations 0008–0012 are applied. The web screens were checked in Chrome (dark and light at
1280px, dark at 400px). The phone screens have not been run on a device.

---

## 1. Data export and import

**Missing.** `grep -ril csv apps/api/src/modules` returns nothing. There is no export route of any
kind, and no importer.

**Why it matters most.** It blocks adoption in both directions: people will not migrate *to* a
product without an importer, and will not commit *to* one without an exporter. PRD §6.5 says data
is the source of truth — an export is what makes that true rather than stated. It is also the
cheapest item here, because every read model it needs already exists.

**Build.**
- `GET /vehicles/:vehicleId/export?format=csv` and a garage-wide equivalent. Events, expenses,
  maintenance records, documents index. Reuse the existing serializers.
- A CSV importer accepting at minimum Fuelly and Drivvo column shapes, mapping to `events` and
  `expenses`. Client-chosen ids make the import idempotent for free (see
  `apps/api/src/infrastructure/idempotency.ts`) — a re-run of the same file must not double the
  history.
- Web: a download in settings and on the vehicle. Mobile: share-sheet export.

**Lands in** `apps/api/src/modules/expenses`, `.../events`, a new `import` module, plus
`packages/contracts`.

**Watch for.** Import is the one place a bad mapping silently corrupts a record that the owner
believes is authoritative. It wants a dry-run that reports what it would create before it creates
anything.

---

## 2. Notification delivery (email and push)

**Missing.** `apps/api/src/modules/notifications/application/services/` has `due-scan.ts` and
`expiry-scan.ts` producing real in-app rows, and `workers/worker/src/handlers/` has no sender.
`docs/PROGRESS.md` states plainly: email and push are stubbed, the handler logs.

**Why.** A reminder that only fires while the app is open is not a reminder. This is the feature
the category is named for, and the scans that feed it are already written and tested — only the
last hop is absent.

**Build.**
- Push: `expo-notifications` in `apps/mobile` (not currently a dependency), a device-token
  endpoint, tokens on the user, and a worker handler that sends on the notification outbox.
- Email: one transactional provider behind a port, as `ai-port.ts` does for the model — so the
  vendor is one adapter file.
- Respect `notification_preferences`, which already exists per channel.

**Lands in** `workers/worker/src/handlers/`, `apps/api/src/modules/notifications`, `apps/mobile`.

**Watch for.** Quiet hours and the user's timezone — the scans already bucket in the user's zone,
and delivery must not undo that by firing at 03:00 local.

---

## 3. VIN decode

**Missing.** VIN is stored and normalised (`normaliseIdentifier` in
`apps/api/src/modules/vehicles/application/commands/create-vehicle.ts`) and never decoded.

**Why.** Competitors auto-fill make, model, year and engine from the VIN. It removes most of the
add-vehicle form — the longest form in the product — and improves data quality, because a decoded
model is spelled one way.

**Build.** NHTSA vPIC (`vpic.nhtsa.dot.gov/api`) is free and unauthenticated. A `POST
/vehicles/decode-vin` that returns candidate fields for the client to accept or edit — never
silently overwrite what someone typed. Cache by VIN; the answer never changes.

**Lands in** a new adapter beside `apps/api/src/infrastructure/fx.ts`, which is the pattern to
copy: cached, timeout-bounded, and returning null rather than failing the request.

**Watch for.** vPIC is US-market. A European or Japanese VIN returns little or nothing, so the
feature must degrade to the manual form rather than appear broken.

---

## 4. Recall lookup

**Missing.** Nothing in the codebase. The only `recall` match is the English word in a comment in
`apps/api/src/modules/sharing/application/services/passport.ts`.

**Why.** A genuine safety feature, and nearly free once VIN decode exists, since NHTSA exposes
recalls by make/model/year from the same service.

**Build.** A scheduled check per vehicle, surfaced as a `NOTIFICATION_TYPES` member and in the
attention list. Add `RECALL` to the domain enum tuple, which is the only place a new type is
introduced (`packages/domain/src/enums.ts`).

**Lands in** `apps/api/src/modules/notifications`, `workers/worker/src/scheduler.ts`.

**Watch for.** Do not state an open recall as fact on a vehicle whose VIN was never decoded — a
make/model/year match is a likelihood, not a finding, and must be worded as one.

---

## 5. Fuel price per unit

**Missing.** Expenses store `quantity`, `quantityUnit` and now `fuelType`, but never a unit price.

**Why.** Cost-per-litre trend and "which station is cheaper" are staples of fuel-log apps, and the
data is one derived column away from what is already stored.

**Build.** Either a stored `unitPriceMinor` or derive `amountMinor / quantity` at read time.
Deriving is honest and needs no migration; storing survives a later edit to either half. Surface
on the Statistics tab beside the spend chart.

**Lands in** `apps/api/src/modules/expenses/domain/cost.ts`, both Statistics views.

---

## 6. Business and tax mileage

**Missing.** `TRIP` exists in `EVENT_TYPES` with no business/personal split, no per-distance rate,
and no period report.

**Why.** For contractors and rideshare drivers this is not a feature, it is the entire reason to
keep a vehicle log. It is the largest single segment on this list that Garaj currently cannot
serve at all.

**Build.** A purpose flag and a rate on trip entries, then a period report (quarter, tax year)
exporting to CSV — which makes this depend on item 1. Consider start/end odometer rather than a
typed distance, since the readings are already the app's spine.

**Lands in** `packages/contracts`, `apps/api/src/modules/events`, a report route.

**Watch for.** Tax rates are jurisdictional and change yearly. Store the rate used on the record;
do not compute historical totals from today's rate.

---

## 7. Multi-currency totals

**Partial.** `GET /vehicles/:id/cost` returns `otherCurrenciesConverted` and `ratesAsOf`
(`apps/api/src/infrastructure/fx.ts`), but spend in another currency is still excluded from the
headline figures.

**Why.** Correct as a default — a total nobody can reproduce is worse than one that admits what it
left out — but a user with one foreign purchase sees a lifetime cost they know is wrong.

**Build.** A per-garage preference: report in one currency, converted, or keep the current strict
behaviour. Whichever is chosen must keep saying which rate and date produced the figure.

**Lands in** `apps/api/src/modules/expenses/domain/cost.ts`, garage settings.

---

## 8. Vehicle passport (built, switched off)

**Missing only as a flag.** `passport: false` in `packages/config/src/flags.ts`, while
`apps/api/src/modules/sharing` and `buildPassport` are implemented.

**Why.** A shareable, verifiable service history is the strongest resale argument for keeping
records in one place at all — and the differentiator hardest for a fuel-log app to copy. PRD §
notes the passport should export as PDF.

**Build.** Audit what exists against the PRD, add the PDF export, then turn the flag on. Likely
the highest ratio of user-visible value to work on this list.

**Watch for.** §1531 — a passport export must contain only what was selected for sharing. Verify
that before the flag moves, not after.

---

## 9. OBD / connected vehicle

**Deferred on purpose.** PRD §36 and the risk register both say delay it; `obd` is already a flag.

Listed for completeness. It is the largest build here and the least differentiating at this stage:
Bluetooth adapters, a pairing flow, live telemetry ingestion and a whole class of hardware support
questions. Revisit when items 1–8 are done and there is evidence users are asking.

---

## Suggested order

1. **Export and import** (1) — unblocks adoption both ways, cheapest, and item 6 needs it.
2. **Notification delivery** (2) — makes a feature that already exists actually work.
3. **VIN decode** (3) — then **recalls** (4) immediately after, sharing the adapter and cache.
4. **Passport** (8) — audit and enable; mostly verification rather than construction.
5. **Fuel unit price** (5) — small, visible, no migration if derived.
6. **Business mileage** (6) — a segment opener, once export exists.
7. **Multi-currency** (7) — a preference over machinery that is already built.
8. **OBD** (9) — not now.

## Before starting any of them

- `docs/PROGRESS.md` **Open items** lists credentials pasted into a transcript (Neon, Upstash
  Redis, Upstash Blob, Pixelcut). Rotate them; that outranks everything on this page.
- iOS has never been run. The mobile work assumes it bundles, nothing more.
- The offline queue and quick entry have unit tests but have not been exercised by hand on a
  device.
