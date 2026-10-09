---
name: garaj-design
description: Garaj's UI/UX and design system for the web app (apps/web) and the shared tokens (packages/ui) — the Carbon & Ink palette, surfaces, type, motion, and the house patterns (instrument-cluster readings, one-screen spec-sheet forms, garage bays, native-dialog modals, sidebar settings modal) and how charts, stats and dashboards are drawn (web and the admin console). Use when building or changing any screen, component, modal, form, empty state, chart, stat, dashboard, theme token or colour in Garaj; when asked to make UI "consistent", "polished", "modern", "match the app" or "like the rest"; and before calling UI work done.
---

# Garaj design system

Garaj is a garage app: vehicles, the garages that group them, and the people they are shared with.
The interface should read like a well-made instrument — calm, dense with real figures, and obvious about
the one thing to do next. It is **not** a gradient-and-glow SaaS template; that look is the failure mode.

Read [patterns.md](./patterns.md) before building a screen, modal or form, and [dialog.md](./dialog.md)
before adding or changing any dialog — its rules, sizes and the inventory of every one. Read [verify.md](./verify.md)
before calling UI work finished — it has the checks, the screenshot recipe, and the traps already hit.

## Point of view

- **Ink does the work.** Hierarchy comes from lightness and weight, not hue. The primary button is solid
  ink (near-white on dark, near-black on light) — the highest-contrast thing on screen is the thing to press.
- **The logo is the only colour.** Garaj's red speed lines are the brand. There is no brand/accent token on
  purpose: a red button or focus ring reads as an error. Everything else is neutral or a status — and a
  chart's marks follow the same rule: grey, or green/red for which way it is going.
- **Real figures, set as figures.** Counts, odometers, money and step numbers use `font-mono tabular-nums`,
  often zero-padded (`03`, `01 / 05`).
- **Ask, don't label.** Steps and empty states are phrased as the question or the outcome
  ("What are you adding?", "It's in the garage", "Nothing in Project cars yet").
- **The page reads; actions open over it.** Occasional jobs (edit, add member, create garage) live in
  modals, never as inline forms on an overview page.
- **Never decide for the user.** If there is a real choice (e.g. which garage), ask and pick nothing.
  Auto-choose only when there is exactly one option, or the context already knows (a garage's own page).
- **Say less, show exactly.** On any screen of figures the number and its mark carry the message. Labels,
  not sentences: no subtitle restating its title, no summary sentence over a row of stats, a caption only
  when the basis is not obvious and then in ≤ 3 words (`+23 this week`, `of 31 today`). Comparisons are a
  delta chip; the figure it compares against goes in the tooltip, not a line of prose.

## Tokens

Source of truth: `packages/ui/src/tokens.ts`, mirrored exactly in `apps/web/src/app/globals.css`
(`@theme` = dark, `html[data-theme='light']` = light). `apps/web/src/app/theme-tokens.test.ts` fails if they
differ; `packages/ui/src/contrast.test.ts` enforces contrast and elevation. **Change both files together,
then run the tests.** Mobile reads the same tokens via `toNativeTokens`.

| Role | Tokens | Rule |
|---|---|---|
| Surfaces | `background` → `card` → `popover` → `muted` → `border` | Dark theme steps up in lightness in that order (tested). Light: card lifts above page, fills sink below it. Warm neutrals, hue 70–85, chroma < 0.01. |
| Text | `foreground`, `muted-foreground` | ≥ 4.5:1 on every surface they sit on (tested). |
| Action | `primary` / `primary-hover` / `primary-foreground` | Ink. Solid hover colour, never `primary/90`. |
| Selection | `primary-soft` | Selected tile/pill; a step above the hover fill so selection never reads as hover. |
| Status | `success` `warning` `destructive` + `*-soft` + `destructive-hover`/`-foreground` | Hues spaced (red 25, amber 85–92, green 158). Soft tints are **solid**, never `bg-success/15`. Each status tested as text on its own soft tint. |
| Focus | `ring` | Neutral ink, ≥ 3:1 on page/card/popover. |
| Chart | `chart-service` `chart-refuel` `chart-income` `chart-trip` `chart-expense` `chart-neutral` | Categorical report groups in the web app only (spend by type). Dashboard measures use neutral / `success` / `destructive` (see Charts and stats). |
| Other | `border-strong`, `shadow` (a colour, used via `shadow-float`) | |

Adding a token: add to both theme objects in `tokens.ts`, both blocks in `globals.css`, and a contrast pair in
`contrast.test.ts` if it is ever text or a focus/graphic indicator.

## Surfaces, space, layout

- **Separate by contrast, not borders.** Cards are `bg-card/50` (hover `bg-card`); an inner surface on a card is
  `bg-card` or `bg-muted`, never another `/50`. Inside a card-coloured modal, rows use `bg-muted/60`.
- Hairlines only inside an instrument panel (`Readings` uses `gap-px` over `bg-border/60`).
- **Dark theme edges are lit, not drawn.** `globals.css` gives every `bg-card/50`·`/60` card a 1px gradient ring (bright along the top, a diagonal glint, fading down the sides) and every dialog and popover panel an inset rim. Never add a `border` to a card on top of it; glass and light themes keep their own edges.
- Radius: `rounded-2xl` cards, `rounded-3xl` dialogs, `rounded-xl` fields/rows/buttons, `rounded-full` pills/chips.
- The shell is `max-w-3xl` (768px). Design for that width: two-column grids (`sm:grid-cols-2`) by default. Vehicle
  cards are the exception — `VEHICLE_GRID` (`components/vehicle-grid.ts`) runs three across from `md`, and
  `VehicleCard` is drawn for that ~240px: two figures, not three, in a small panel.
- Page rhythm: `flex flex-col gap-10` between sections, `gap-6` inside a header group, `gap-4` section heading → content.
- Grid tracks that hold inputs or long text: `minmax(0,1fr)`, never bare `1fr`.

## Type

- Urbanist (small x-height), scale bumped one notch: body `text-sm` = 15px, meta `text-xs` = 13px.
- Page title `text-3xl font-bold tracking-tight`; section `text-lg font-semibold tracking-tight`; card/modal title `text-lg font-semibold`.
- Eyebrow/label: `text-label uppercase text-muted-foreground` (tracking and weight built in).
- Figures and step counters: `font-mono tabular-nums`. Dates on the home greeting: mono, uppercase, tracked.

## Motion

Utilities in `globals.css`: `animate-rise` (entrances), `animate-pop` (dialogs/popovers), `animate-step` with
`--step-dir` (wizard steps), `stagger` with `--i` (lists; capped at 8), `shadow-float`, `header-scroll`,
`scroll-fade-x`, `scrollbar-slim`. Hover lift on cards: `hover:-translate-y-1 hover:shadow-float`; press:
`active:scale-[0.97–0.99]`. All of it respects both `prefers-reduced-motion` and the app's own
`data-reduce-motion` toggle — add both guards to any new keyframe utility.

## Charts and stats

Load the `dataviz` skill before drawing one. Reference implementation: `apps/admin/src/pages/overview.tsx`
and `apps/admin/src/components/chart.tsx` (`DayChart`, `Spark`, `Sparkbars`, `Donut`).

- **Pick the form by the data's job, and nothing decorative.** A running total → line (scale from the
  window's low, low and high labelled). A count per day → columns from zero. Parts of one whole (≤ 5,
  mutually exclusive, summing to something real) → donut with every figure in its legend. This vs the last
  period → delta chip (arrow + %, never colour alone). **No gauges, dials or odometer drums for aggregate or
  platform stats** — they spend space to show one number imprecisely. The `Gauge`/`Odometer` instruments
  belong to one vehicle's cockpit and the landing's demo of it, nowhere else.
- **Colour means direction, nothing else.** Never a hue per measure — that reads as decoration. Three
  tones, the same on every chart, chip and mark on the page:
  - **neutral** `muted-foreground` — the data at rest, or nothing to compare against;
  - **up / good** `success` — this period beats the last by ≥ 5%, or a state that is good (active, paid, online);
  - **down / bad** `destructive` — trails the last by ≥ 5%, or trouble.
  One test (`trendOf` in the admin overview) colours both a measure's delta chip and its line/bars/spark,
  so they can never disagree. Tone always travels with an arrow (↗ ↘ →) and a sign or %, never colour alone.
  Parts of a whole: the good parts in a `success` ramp of alpha steps `1 / .75 / .55`
  (`color-mix(in oklab, var(--color-success) 75%, transparent)`), the "nothing" part (dormant, free) faint
  neutral grey. Selection (a lit tab) is ink, not a tone. Validated with the dataviz checker in both
  themes; re-run it (`validate_palette.js … --ordinal`) before adding a step.
  The `chart-*` tokens are for the web app's categorical report groups (spend by refuel/service/…), where
  the categories genuinely differ — not for measures on a dashboard.
- **Marks:** 2px lines with `vectorEffect="non-scaling-stroke"`, soft gradient fill under a line, 2px surface
  gaps between slices and segments. Hover by default: crosshair + tooltip on a line, per-column tooltip on bars,
  slice lift + share in the centre on a donut. Every chart carries a `sr-only` table or a text legend.
- **Totals double as controls.** Where a row of totals and a chart show the same things, the totals are the
  chart's tabs (selected one lit in ink along the top) — not a stat row above a chart repeating it.
- **One time range per page**, as `WindowPicker` in the page header, governing every chart on it.
- **A figure states its basis or it is wrong.** "Online" is people with a signed-in request in the last five
  minutes (`onlineCount()` in the API), not unexpired sessions — sessions live seven days and count devices.

## Reach for these first

| Need | Use | File |
|---|---|---|
| Button / link styled as button | `Button`, `buttonClass(variant, size)` (`primary` `secondary` `ghost` `danger`; `sm` `md` `icon` `icon-sm`) | `components/ui/primitives.tsx`, `button-class.ts` |
| Labelled input | `Field` (label, hint, error, suffix) | `primitives.tsx` |
| Select | `SelectField` (labelled) / `Select` — native popover, works inside dialogs | `components/ui/select*.tsx` |
| Date / span of days | `DateField` / `DatePicker` (`triggerClassName` to sit in a cell or reading), `DateRangeField` / `DateRangePicker` (presets; `clearable` adds All time). `YYYY-MM-DD` strings. Never `<input type="date">` | `components/ui/date-picker.tsx` |
| Card section | `SectionCard`; list row with status rule: `TileRow` | `primitives.tsx` |
| Empty / error | `EmptyState` (title, description, action) | `primitives.tsx` |
| Loading (reading) | `Loading` + `Skeleton`, `CardGridSkeleton`, `ListSkeleton` — draw real labels, skeleton only the data | `components/ui/skeleton.tsx` |
| Loading (acting) | `Button loading={m.isPending}` — a centred spinner; the label never changes and keeps the width | `components/ui/primitives.tsx` |
| Result of an action | Automatic: the query client toasts every mutation. Name it with `meta: { toast: 'Vehicle added' }`, silence it with `meta: { toast: false }` | `components/ui/toaster.tsx`, `app/providers.tsx` |
| Signing in / out | `FullScreenStatus` — the mark in a turning ring, from the press until the next screen | `components/ui/full-screen-status.tsx` |
| Overview figures | `Readings` (instrument cluster) + `SectionHeading` (title + mono count, one fixed height, type only) + `SectionLink` (its action: text and an arrow) | `components/ui/overview.tsx` |
| Modal | `Modal` (`size` md/lg, `icon`, `fill` for fixed height), ending on `ModalActions` (`bar` in a fill modal); `FormError` for a form's own error. Rules in `dialog.md` | `components/ui/modal.tsx` |
| Sectioned settings | `SettingsModal` (sidebar sections, fixed height, scrolling panel) | `components/ui/settings-modal.tsx` |
| Row actions / delete confirm | `RowMenu` (⋯ popover of dialog-opening actions), `ConfirmDelete` (the second press) — never `window.confirm` | `components/ui/row-actions.tsx` |
| Activity entries | `ScheduleRow` (gauge row), `TaskItem`, the logbook `DoneRow` | `components/vehicle/schedule-row.tsx`, `components/task-item.tsx`, `app/vehicles/[vehicleId]/page.tsx` |
| Settings rows | `SettingRow`, `SettingToggle` | `components/ui/setting-row.tsx` |
| Page sections under a header | The section strip: `useStrip`, `STRIP_ROW`/`STRIP_SCROLLER`, `stripClass`, `stripTabClass`, `StripPill`, `STRIP_ACTION` + `PlusCoin`. Links with `aria-current` (a route or `?tab=`), sticky under the header, the section's action at the end. Vehicle and garage pages both use it — never a second look | `components/ui/section-strip.tsx` |
| Tabs inside a card or dialog | `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` | `components/motion/tabs.tsx` |
| Icons | `Icon` (Solar bold-duotone, generated — add names in `scripts/generate-icons.mjs`, run `pnpm --filter @vehicle-os/web icons`); `lucide-react` for crisp action glyphs (`Plus`) | `components/icons.tsx` |
| Emoji | `Emoji` (Twemoji, generated — add to `scripts/generate-emoji.mjs`, run `pnpm --filter @vehicle-os/web emoji`). Only where a list mixes unlike things and one glyph per kind is the point (activity entries). Never for UI chrome, and never a runtime emoji library; credit stays in `ATTRIBUTION.md` (CC-BY) | `components/emoji.tsx` |
| Manufacturer logo | `BrandLogo make=…` | `components/brand-logo.tsx` |
| Garage / vehicle cards | `GarageCard` (bays), `VehicleCard` | `components/` |
| Create garage / add vehicle | `NewGarageButton`, `AddVehicleButton garageId?` | `components/` |

## Hard rules

1. **Read a file before you overwrite it** — including one you think you are creating. `components/ui/modal.tsx`
   was once replaced blind and broke five callers.
2. No inline create/edit forms on overview pages — use `Modal` / `SettingsModal`.
3. Every colour through a token. No hex, no `bg-black/…` except the dialog backdrop, no opacity status tints.
4. Two controls with the same visible name need distinct accessible names (`aria-label="Garage settings"`).
5. A `<dl>` holds only `<div>`s of `<dt>`/`<dd>`; make a figure clickable with an overlaid link, not a wrapping one.
6. Destructive actions sit apart from the routine one, on `bg-destructive-soft`, and take two presses.
7. Verify in a browser, both themes and 400px wide, before saying it is done — see [verify.md](./verify.md).
