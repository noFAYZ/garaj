# Garaj patterns

Recipes lifted from shipped screens. Copy the structure; the reasoning is in the comments of the files named.

## Overview page (home, garage detail)

Reference: `apps/web/src/app/page.tsx`, `apps/web/src/app/garages/[garageId]/page.tsx`.

```tsx
<div className="flex flex-col gap-10">
  <div className="flex flex-col gap-6">
    <div className="flex animate-rise flex-wrap items-center justify-between gap-4">
      {/* title block: optional icon tile (size-14 rounded-2xl bg-card) + h1 text-3xl */}
      <div className="flex items-center gap-2">{/* secondary action, then primary */}</div>
    </div>
    <Readings
      className="stagger animate-rise [--i:1]"
      readings={[
        { label: 'Vehicles', value: pad(count), href: '/vehicles' },
        { label: 'Needs attention', value: pad(total), tone: overdue ? 'destructive' : total ? 'warning' : 'success' },
        { label: 'Ownership cost', value: cost ?? '—' },
      ]}
    />
  </div>

  <section aria-labelledby="x-vehicles" className="flex flex-col gap-4">
    <SectionHeading id="x-vehicles" title="Vehicles" count={isPending ? undefined : list.length} action={…} />
    {/* grid grid-cols-1 gap-4 sm:grid-cols-2, items with stagger animate-rise style={{ '--i': index }} */}
  </section>
</div>
```

- `value: undefined` / `count: undefined` renders the label with a skeleton figure — never hide the label while loading.
- Zero-pad counts with `pad = (n) => String(n).padStart(2, '0')`.
- Garage detail is the plate variant: one `rounded-3xl bg-card/60` panel over the greeting's `Ground` — mono eyebrow
  (`GARAGE · USD · SHARED AS DRIVER`, role only when not Owner), title, actions top-right; second line the members as a
  face stack (opens settings at Members) and two inline `Stat`s (Needs you · Running cost) — compact, two lines, no
  `Readings` cluster. Below, the section strip (`section-strip.tsx`, the vehicle page's) Vehicles | Drivers via `?tab=`,
  each with its mono count (the counts live there, not on the plate), and the section's action at its end (Add vehicle /
  Assign driver — Add vehicle is not on the plate). Drivers: member rows with vehicle chips, then a dashed "No driver" row; assigning is a `Modal` of tick tiles.
- Home greeting: mono uppercase date eyebrow + `Good morning/afternoon/evening, {first name}` (client-only; the page waits for the session).
- No hero of an arbitrary "featured" record — it duplicates the grid and is meaningless with more than one item.
  The home "Up next" bento is next service (or "All clear") + health briefing, plus a full-width attention list only when it has rows.

## Dashboard (admin overview)

Reference: `apps/admin/src/pages/overview.tsx`. Top to bottom, each block earning its place:

1. Greeting (mono date eyebrow + `h1`) with the page's one `WindowPicker` on the right.
2. App keys: icon, name, live status dot (`no-cors` probe of a static file); the host is the `title`.
3. Growth card: the totals *are* the tabs — label, mono total, `+N` + delta chip, `Spark` of the level in
   that measure's trend tone; the selected tab lit in ink along the top. One non-tab cell for a live figure
   (Online, with a bar of its share of today). Below: the label + its chip, and `DayChart` in the same trend
   tone with a `Total | Daily` toggle — the chip explains the line's colour.
4. Service strip: dot, name, one mono figure; only trouble is coloured.
5. Bento of one-job panels: a daily count (`Sparkbars`), and part-to-whole `Donut`s (engagement by recency,
   users by plan). Panel = title + one mono aside (`DAU/MAU 13%`, `50 paid`), no subtitle.
6. Lists (newest, latest changes) and chips (features), each with a `MoreLink` to its page.

## Admin console shell and pages

Reference: `apps/admin/src/app.tsx`, `components/list.tsx`, `components/metrics.tsx`, `components/palette.tsx`.

- **Six top-level places**: Overview · Management (Users / Garages / Vehicles as count tabs under the header)
  · Analytics · System · Settings · Logs. Labels from `xl`, icons below with the current one named. Old
  routes alias (`usage`→`analytics`, `audit`→`logs`); a new section adds a `PAGES` entry and a `NAV` group.
- **The environment is always in the header**; production is a red `Live` pill — you know before you press.
- **⌘K / Ctrl+K / `/`** opens search over pages, people, garages and vehicles (the list endpoints, 5 each).
  Page names filter on the live input; only the server search is deferred, so Enter never lags.
- **Lists are tables**: `ListBody columns head` — one grid template for header and rows, columns dropping
  from the right as it narrows (hide a head cell and its row cells together), figures right-aligned mono,
  dates `shortDate`. Search in a `Toolbar` that shows `N found` while searching. No per-row stagger.
- **Filters must be the server's**, never a sieve over the loaded page: Logs' chips are action prefixes
  fed to the search, and `#/logs/<prefix>` opens pre-filtered.
- **Readouts**: `Panel` (title + one mono aside), `Figure` (label over mono value, `tone` bad/warn),
  `RankBars` for who-uses-most, `FailureList` for errors. System leads with one verdict line (all clear /
  N to look at, worst first) before any figure.
- **Each page sits in a `PageBoundary`**: a page that throws shows its error with Try again; the header works.

## Horizontal rail (garages on home)

```tsx
<ul className="scroll-fade-x -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
  <li className="w-64 shrink-0 snap-start">…</li>
  <li className="w-64 shrink-0 snap-start">{/* "New …" tile: bg-muted/40, icon circle rotates 90° on hover */}</li>
</ul>
```

`scroll-px-4` is required — snapping ignores padding and the first card otherwise sits under the edge fade.

## Garage card (bays)

`components/garage-card.tsx`: the garage's floor first — four numbered bays (`01`–`04`, mono, painted on the
floor) with dashed painted lines between them. Each holds a vehicle: its photo (a cutout stands on the floor with a
shadow), else its `BrandLogo` filling a small tile, else the type icon; the last bay shows `+N` when there are more.
Empty bays keep their number. Vehicles that need something park first, with a status light (`bg-destructive` /
`bg-warning`) over their bay — the only place attention shows; no tag row. Then the name and
"`03` vehicles · description|currency · Role" (role **only when not Owner**), and an arrow that turns ↗ on hover. Attention comes from the dashboard's list via
`attentionByGarage`. The link's `aria-label` says all of it. "New garage" beside the rail is a dashed outline.

## Home greeting

`components/greeting.tsx`, compact: a panel (`rounded-3xl bg-card/60`) over a dot-grid ground fading out before the
words. Mono date and live clock, then a one-line greeting with the first name in `muted-foreground`. Under it the
add line (`QuickLine`, `components/add-menu.tsx`) — one input: a question goes to Ask and is answered in place; anything
else is read by `lib/quick-entry` + `lib/add-intent` (which vehicle it names) and Enter opens that vehicle's add dialog
with the line in it (`?add=done|planned&say=…`). Its outline: inset hairline at rest, firmer on hover, 2px `ring` with a
soft halo on focus. At the line's end the round `+` (`AddMenu`): a goo popover of three emoji tiles — Garage, Vehicle,
Activity (asks which vehicle when there are several); dialogs open after the panel closes; plan limits open the plans.
On the right from `md`, the person's vehicles as a fanned hand of up to three cards (best picture in front, only it
named), spreading on hover. Then "Needs you" as one-line pills linking to the vehicle; nothing when nothing is.

## Filter chips

`h-9 rounded-full px-3.5 text-sm font-semibold`, selected `bg-primary text-primary-foreground`, otherwise
`bg-muted text-muted-foreground hover:bg-border`; label + mono count. `role="group"` with `aria-label`, each chip
`aria-pressed`. Only render a filter when there are ≥ 2 options.

## Modal

`components/ui/modal.tsx`. **Opens by mounting, closes by unmounting** — render it conditionally so each opening
starts with a fresh form. Native `<dialog>` + `showModal()` (focus trap, inert page, Escape, backdrop).

```tsx
{open ? (
  <Modal title="Add a member" description="…" icon="people" onClose={() => setOpen(false)}>
    <form className="flex flex-col gap-4" onSubmit={…}>
      <Field … />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={m.isPending} disabled={!valid}>Add member</Button>
      </div>
    </form>
  </Modal>
) : null}
```

- `size="md"` (32rem) default, `"lg"` (44rem). `fill` = fixed height `min(38rem, 100dvh-2rem)`; children fill it.
- It focuses the first text input after opening (React `autoFocus` does not work with `showModal`).
- On success: invalidate the queries the change affects (`queryKeys.garages()`, `queryKeys.dashboard()`, …), then close.
- Trigger components own their open state (`NewGarageButton`, `AddVehicleButton`) and accept a `className` so the
  same dialog can hang off a primary button or a rail tile.

## Settings modal (sidebar sections)

`components/ui/settings-modal.tsx`, used by garage settings and the app Settings dialog.

```tsx
<SettingsModal
  title="Garage settings"
  description={garage.name}
  icon="settings"
  onClose={onClose}
  sections={[
    ...(canEdit ? [{ value: 'general', label: 'General', description: '…', icon: <Icon name="settings" size={16} />, content: <GeneralSettings /> }] : []),
    { value: 'members', label: 'Members', description: '…', icon: <Icon name="people" size={16} />, badge: count, content: … },
  ]}
/>
```

- Fixed-height frame; the panel scrolls with `scrollbar-slim`; sidebar folds into a row under `sm`.
- Sections a role cannot use are omitted, not disabled; `defaultValue` falls to the first section present.
- Save inside a settings section keeps the modal open. Garage General shows the save as a bar that appears only
  once something differs (`sticky bottom-0`, `bg-popover shadow-float`: "Unsaved changes · Discard · Save changes"),
  then a `role="status"` "Saved" once the data catches up — no disabled Save sitting there on every visit.
- A choice whose effect is easier seen than said is tick tiles (`has-[:checked]:bg-primary-soft`), each with a small
  "e.g." preview of the result (garage currency mode). Roles are explained in a native `<details>` key, folded.
- App settings sections come from `SETTINGS_SECTIONS` in `components/settings-panel.tsx`, which `/settings` also stacks —
  add a setting there once and it appears in both.

## Activity rows (Coming up + Done)

Reference: `components/vehicle/schedule-row.tsx`, `components/task-item.tsx`, `app/vehicles/[vehicleId]/page.tsx`.

- **One column of leading slots.** Every Coming up row starts with a `size-12` slot (gap-4) — a status-tinted
  `rounded-2xl` tile with a 26px icon for a schedule, a centred 28px checkbox for a task — so titles line up down the list.
- **Schedules read like a gauge.** Headline is the distance to due in words from the server's `daysRemaining` /
  `distanceRemaining` ("Due in 490 km", "Overdue by 2 months"; days become months past 60). A 6px meter shows the
  share of the interval used — distance or time, whichever is further along — with a mono `%`. Tone: destructive
  (overdue), warning (due soon), ink (on schedule). Meta: "Every … · last done … · next by … / was due …".
- **Tasks say when, like a person:** "3 days late", "Due today", "Due in 9 days", or the date; priority as a dot + word.
- **Actions:** the one everyday action stays a visible button (Log service; the checkbox). Edit and delete live in
  `RowMenu` and open `Modal` / `ConfirmDelete`. No form ever expands inside the list.
- **Done is a logbook** (`components/timeline.tsx`, shared with home's Recent activity): grid `3rem rail ·
  minmax(0,1fr) card`. The rail is a dashed line with a desk-calendar leaf (weekday + mono day) on each day's first
  entry and a dot for the rest. The card: `KindIcon` (emoji on a `size-11 rounded-xl bg-muted` tile) beside the kind
  in **bold** mono caps over the title (regular weight; left out when it only repeats the kind) and the cost right;
  under them a one-line `NotePreview`, attachments, then `Facts` — badges for odometer (+delta), fill quantity
  (lifted off the note's front by `fillQuantity`), provider. The kind is the only bold word on the card.
- **Month headings** stick under the strip as the month's leaf (abbr band + year), a rule, and "Spent" when one
  currency — no month name beside the leaf (it said the month twice).
- A form reused inside a dialog renders **bare** (no `SectionCard` title) — the dialog owns the heading and buttons.

## Destructive zone

```tsx
<div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-destructive-soft p-4">
  <div><p className="text-sm font-semibold">Delete this garage</p><p className="text-xs text-muted-foreground">It goes for every member…</p></div>
  {confirming
    ? <><Button onClick={() => setConfirming(false)}>Keep it</Button><Button variant="danger" loading={…} onClick={remove}>Delete for everyone</Button></>
    : <Button variant="danger" onClick={() => setConfirming(true)}>Delete garage</Button>}
</div>
```

Two presses, second button says exactly what happens; never a browser `confirm()`.

## Spec sheet (add vehicle)

Reference: `components/add-vehicle-dialog.tsx`. One screen, not steps — or one sentence.

- `Modal size="lg" fill`. Its `header` is the vehicle assembling itself: a `size-14` portrait tile (cover photo →
  make logo → type icon, re-keyed so each change pops; press or drop photos on it) and the live name under a
  `NEW CAR` eyebrow.
- **The line comes first** and holds the cursor. Enter reads it (`POST /ai/vehicle-draft`: the sentence plus any
  chosen papers/photos, one forced tool call, held to `CreateVehicle`'s bounds server-side); once it names a type,
  make and model, `POST /ai/vehicle-lookup` follows on its own for the specs nobody types (oil, tank, tyres,
  gearbox) — Google Search grounding when the key has quota, the model's knowledge of published figures when not.
  A look-up only fills empty fields. Provenance on each tile's eyebrow: ✦ read from the line, 🌐 looked up — gone
  once a hand touches the field. The status line counts them in mono (`10 read · 11 looked up`); "Specs" has its
  own Look up for a sheet filled by hand. Nothing is written until Add.
- Fields are **rounded tiles**, not a hairline panel: `grid grid-cols-6 gap-1.5`, each `rounded-xl bg-muted/60
  px-3.5 py-2`, a `text-label` eyebrow over a borderless `h-7 text-sm` control. Focus is the tile's own inset
  ring (`has-[:focus-visible]:ring-2 ring-inset`), so it follows the corners — a square cell in a rounded panel
  drew square rings. The label's `after:absolute after:inset-0` makes the whole tile the target; controls sit
  above it with `relative z-10`. Three across on a desktop, two on a phone.
- The body scrolls between the pinned line and the pinned footer (`[&>*]:shrink-0`, or clipped children shrink;
  an 8px mask fade at each end). Sections: Specs (collapsed to filled ones + "N more"), Photos & papers (size-16
  thumbs and two size-16 `DropTile`s in one row, paper rows with a kind `Select` guessed from the filename).
- Choices are dropdowns: `Select` with `triggerClassName` to sit borderless in a tile; the make is a combobox
  (logos, exact → prefix → contains, Enter takes the top match, free text allowed). A make that builds one kind
  answers the type; the garage is never guessed.
- Domain inputs look like the thing: the plate as a plate, odometer mono with separators and a `km | mi` pill,
  price mono with a currency pill defaulting to the garage's, VIN mono with Decode (fills only empty fields).
- Files wait in the dialog and upload after create (they need the id); a failed file toasts, never fails the add.

## Acting: what a press looks like

- **The spinner is the state, not the words.** `<Button loading={m.isPending}>Save changes</Button>` keeps the
  label (and the button's width) and overlays a spinner; `aria-busy` comes with it. Never
  `{m.isPending ? 'Saving…' : 'Save'}` — the button resizes mid-press and says the same thing twice.
- **Only the row that is acting spins.** With one mutation behind a list, scope it:
  `loading={remove.isPending && remove.variables === photo.id}`.
- **Cancel stays `disabled`**, never `loading`: it is not the thing running.
- **A checkbox-style control** that mutates carries `aria-busy` and `aria-busy:animate-pulse` instead of a spinner —
  a spinner inside a 28px box is a smudge.
- **No app-wide bar.** The header carries no progress sweep: the control that started the work shows it, with its
  spinner (a ring in the button's own ink, centred over the label, which stays invisible to hold the width).
- **A save that keeps its dialog open** says so in place afterwards (`role="status"` "Saved"), as garage settings does.
- **Every mutation already reports its outcome.** The query client's `MutationCache` raises a toast on success and on
  failure, so nothing needs wiring per call. Give it words worth reading with `meta: { toast: 'Vehicle added' }`;
  use `meta: { toast: false }` only when the result *is* the screen (a filter, a tab, an optimistic toggle).
- **Auth is a full-screen moment, not a button state.** `FullScreenStatus` covers the gap where the form has gone and
  the next screen has not arrived: "Signing you in…" from the press, "Taking you to your garage…" once accepted,
  "Signing you out…" while the session clears. Sign-out is awaited and then navigates — never fire-and-forget.

## Empty and loading states

- Empty: `EmptyState` with a specific title ("Nothing in {garage} yet"), one sentence, and the action that fixes it
  (pre-scoped: `Add to {garage}`).
- Loading: draw every label, heading and button that is the same for everyone; skeleton only the data, at its final size.
- Errors: `EmptyState` with the message and a `Try again` that refetches.
