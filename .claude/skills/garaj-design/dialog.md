# Dialogs in Garaj (web)

Every dialog in `apps/web`, the rules they all follow, and what each one is. Read this before adding
or changing a dialog; update the inventory when you do. Audited 2026-10-05.

## The parts

All dialogs are built from three components in `components/ui/` — never a hand-made `<dialog>`.

| Part | What it is |
|---|---|
| `Modal` (`modal.tsx`) | Native `<dialog>` + `showModal()`: focus trap, inert page, Escape and backdrop close. **Opens by mounting, closes by unmounting** — callers render it only while open, which also resets the form inside. Focus goes to the first text input; a dialog with none keeps the close button. |
| `SettingsModal` (`settings-modal.tsx`) | `Modal` at `xl` + `fill`, with a sidebar of sections (a scrolling row on phones). For settings that grow a section at a time. |
| `ConfirmDelete` (`row-actions.tsx`) | The second press of a delete: `Modal` at `md`, trash icon, ghost **Keep it** and a danger action. |
| `ModalActions` (`modal.tsx`) | The row every dialog ends on. Action at the right, **Cancel as a ghost before it** (reading and tab order), optional `aside` status at the left. `bar` pins it in a `fill` modal. |
| `MODAL_BAR` (`modal.tsx`) | The pinned foot of a `fill` modal: card background, rounded bottom corners, a soft shadow up onto what scrolls under it. Put it in a container that already runs edge to edge (`-mx-6 -mb-6`). |
| `FormError` (`modal.tsx`) | A form's own error (server refused, network dropped), on the destructive soft tint. A field's error stays under the field (`text-xs text-destructive`). |

## Sizes

Width comes from the content's columns, not from how important the dialog feels.

| `size` | Width | For |
|---|---|---|
| `md` (default) | 32rem | One or two columns of fields; every confirmation; small pickers. |
| `lg` | 44rem | Three columns; side-by-side panels (a preview beside a form); galleries; instrument panels; wizards. |
| `xl` | 60rem | `SettingsModal` only — a sidebar and a panel side by side. |

On a phone every size is `100vw − 2rem`.

**Height** follows the content (`auto`) unless the body changes length while the dialog is open
(tabs, steps, sections). Then `fill`: a fixed 38rem (46rem at `xl`), the body scrolls inside, and the
foot is a `MODAL_BAR` that never moves. A dialog that jumps in height under the pointer is a bug.

## Head

- **Title**: sentence case, says what the dialog does or asks ("Record income", "Archive the MX-5?").
- **Description**: one line, only when it says something the form does not ("Amounts in USD.",
  "The next due point counts from this service, not from today."). Never restate the title.
- **Icon tile** beside the title — **a dialog that makes or changes a record wears one**: create,
  record, log, edit, upload, export, share, archive, delete (trash). Views (cockpit panels) and the
  billing flows (which lead with their own visual) do not.
- **Custom head** (`header`) — only when the dialog is a view of one thing whose head *is* that thing
  (entry details), or a wizard whose head is the choice it makes (add to activity, add a vehicle). The
  heading must carry the `titleId` it is given.
- The close button is always top right; it is part of `Modal`, never re-added.

## Body

- Stacks at `gap-4` (`flex flex-col gap-4`). Dense instrument forms (add to activity, edit schedule)
  may tighten to `gap-3`; richer views (billing) open up to `gap-5`.
- Fields are `Field`, `SelectField`, `DateField`/`DateRangeField` — never native date inputs.
- Grid tracks holding inputs are `minmax(0,1fr)`; field grids collapse to one column below `sm`.
- Surfaces inside a card-coloured dialog: rows and panels on `bg-muted/60`, inner tiles on `bg-card`.

## Foot

- **Always `ModalActions`** (or `ModalActions bar` / `MODAL_BAR` in a `fill` modal). Order: Cancel
  (ghost) → primary action. Confirmations: **Keep it** (ghost) → danger action.
- The primary says what it will do ("Log service", "Archive vehicle", "Add schedule · every 10,000
  km"), never "OK" or "Submit". With nothing to do it says so and is disabled ("Nothing to save").
- `aside` holds a status, not a control: "2 changes · interval, priority", the Enter hint.
- **Billing exception**: the plan switch, upgrade wall and payment confirmation use large buttons
  that stack full width on phones (`flex-col-reverse … sm:flex-row sm:justify-end`) — a decision
  about money gets the bigger target. Keep the three consistent with each other.
- **Settings exception**: `SettingsModal`'s `footer` sits in the frame under the panel, bordered
  (vehicle details: change count left, Discard/Close + Save right).

## Behaviour

- Mounted only while open; closing drops half-finished state.
- Escape and the backdrop close; a nested dialog (a confirmation over a form) closes only itself.
- Popovers opened inside a dialog (`Select`, date pickers, `RowMenu`) are native popovers in the top
  layer, so a dialog's scroll box never clips them.
- Mutations name their toast (`meta: { toast }`); the dialog closes on success.
- A destructive action is never the dialog's only action and always takes a second press.

## Inventory

`md` 32rem · `lg` 44rem · `xl` 60rem · height `auto` unless `fill`. Foot: **A** = `ModalActions`,
**B** = `MODAL_BAR`, **S** = settings footer, **$** = billing row, — = none (applies as it changes).

### Records and forms

| Dialog | Where | Size | Icon | Foot |
|---|---|---|---|---|
| Log *job* (complete a schedule) | `components/vehicle/schedule-row.tsx` | md | maintenance | A |
| Edit schedule | `components/vehicle/schedule-row.tsx` | lg | edit | A + aside (changes) |
| Record income | `components/vehicle/report-tabs.tsx` | md | income | A |
| Record an expense / Correct this entry | `components/vehicle/spending-panel.tsx` | md | money | A |
| Record a value | `components/vehicle/value-panel.tsx`, `vehicle-menu.tsx` | md | chart | A |
| Assess the condition / Correct the assessment | `components/vehicle/value-panel.tsx`, `vehicle-menu.tsx` | lg | inspection | A |
| Add a document | `app/vehicles/[vehicleId]/documents/page.tsx` | md | upload | A |
| Edit task | `components/task-item.tsx` (`TaskForm bare`) | lg | edit | A |
| New garage | `components/new-garage-dialog.tsx` | lg (preview beside form) | garage | A |
| Who drives what? / What does *name* drive? | `app/garages/[garageId]/page.tsx` | md | people | A |
| Who drives the *vehicle*? | `app/vehicles/[vehicleId]/drivers/page.tsx` | md | people | A |
| Filter | `components/vehicle-filters-dialog.tsx` | md | filter | A (Clear / Show results) |
| GarajAI settings | `components/ai-settings.tsx` | md | settings | — |

### Wizards and views (`fill` or custom head)

| Dialog | Where | Size | Head | Foot |
|---|---|---|---|---|
| Add to activity (Done / Reminder) | `components/vehicle/add-entry.tsx` | lg · fill | custom: the Done/Reminder switch | B (Enter hint, Cancel, action) |
| Add a vehicle | `components/add-vehicle-dialog.tsx` | lg · fill | custom: photo tile + name | B (garage, Cancel, Add vehicle) |
| Entry details | `components/vehicle/entry-details.tsx` | lg · fill | custom: `KindIcon` tile, kind · date, title | B (trash, logged, Newer/Older segmented) |
| Odometer / Spending | `components/vehicle/cockpit.tsx` | lg | standard, no icon (a view) | inside the panel |
| Photos | `app/vehicles/[vehicleId]/layout.tsx` (`PhotoManager`) | lg | gallery | — |
| Export or import | `components/vehicle/vehicle-menu.tsx` (`VehicleTransferPanel`) | lg | document | A |
| Share this vehicle | `components/vehicle/vehicle-menu.tsx` (`SharePanel`) | lg | share | — (the panel's own controls) |

### Settings (`SettingsModal`, xl · fill)

| Dialog | Where | Icon | Foot |
|---|---|---|---|
| Settings | `components/settings-dialog.tsx` | settings | — (each row applies itself) |
| Garage settings | `app/garages/[garageId]/page.tsx` | settings | — |
| *Vehicle* details | `components/vehicle/vehicle-details-modal.tsx` | car | S (changes · Discard/Close · Save) |

### Confirmations (md)

| Dialog | Where | Icon | Foot |
|---|---|---|---|
| Delete *schedule* | `components/vehicle/schedule-row.tsx` | trash | `ConfirmDelete` |
| Delete *task* | `components/task-item.tsx` | trash | `ConfirmDelete` |
| Delete *entry* | `components/vehicle/entry-details.tsx` | trash | `ConfirmDelete` |
| Delete *expense* | `components/vehicle/spending-panel.tsx` | trash | `ConfirmDelete` |
| Delete *document* | `app/vehicles/[vehicleId]/documents/page.tsx` | trash | `ConfirmDelete` |
| Remove *member* | `app/garages/[garageId]/page.tsx` | trash | `ConfirmDelete` |
| Archive *vehicle*? | `components/vehicle/vehicle-menu.tsx` | archive | A (Keep it / Archive vehicle) |

### Billing (md, no icon — each leads with its own visual)

| Dialog | Where | Visual | Foot |
|---|---|---|---|
| Upgrade wall | `components/upgrade-dialog.tsx` | the limit reached, tier tickets | $ |
| Payment confirmation | `components/upgrade-dialog.tsx` | payment seal, the new pass | $ |
| Cancel *plan* / Switch to *plan* | `components/plan-settings.tsx` | from → to pass chips, limit ledger | $ |

## What the 2026-10-05 audit changed

- `ModalActions`, `MODAL_BAR` and `FormError` added; every dialog's action row, fill foot and form
  error moved onto them (six action-row variants, two error styles, three foot styles before).
- Filter rebuilt on `Modal` (it was a hand-made `<dialog>` at 28rem, unlabelled by its heading).
- Archive made a real confirmation: ghost **Keep it**, archive icon, the shared row.
- Icons added where a dialog makes or changes a record: Record a value, Assess the condition, Share,
  Photos, Archive, Edit schedule (`archive` and `share` glyphs added to the icon set).
- Sizes by columns: Log service and Add a document `lg` → `md`.
- Cancel is a ghost everywhere (valuation and assessment had a secondary one); TaskForm's dialog
  buttons in the shared order.
- Add a vehicle's foot became the pinned bar, with Cancel beside the action on desktop.
