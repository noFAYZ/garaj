# Verifying Garaj UI work

A change is not done until it has passed the checks **and** been looked at in a real browser, in both themes and at
phone width. Tests prove contrast and types; only a screenshot shows a clipped button or a jumping modal.

## Checks (from the repo root)

```bash
node_modules/.bin/prettier --write <changed files>
pnpm --filter @vehicle-os/web typecheck
pnpm --filter @vehicle-os/web lint
pnpm --filter @vehicle-os/ui --filter @vehicle-os/web test:unit   # token parity + contrast
pnpm --filter @vehicle-os/mobile typecheck                        # when tokens changed
```

If typecheck complains about `.next/types/app/<deleted route>/…`, that is a stale generated file from a route you
removed — delete that folder under `apps/web/.next/types/app/` and re-run.

## Look at it

The dev servers are usually already running (web :3000, API :3001, API routes under `/api/v1`). Don't kill the
user's processes. Drive the real app with `playwright-core` installed in a scratch directory (not the repo) and the
system Chrome:

```js
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: 'state.json' });
await ctx.addInitScript((t) => localStorage.setItem('vehicleos.theme', t), 'dark'); // theme key
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
```

- **Auth:** sign up a throwaway account through `/sign-up` (`theme<timestamp>@example.test`), save
  `ctx.storageState({ path: 'state.json' })`, reuse it. Say in the report that test data was created.
- **Seed through the API** with the page's request context and `Origin: http://localhost:3000`
  (`POST /api/v1/garages {name}`, `POST /api/v1/vehicles {garageId, vehicleType, …}`).
- **Run dark 1280, light 1280, dark 400.** Screenshot the states you changed (open the modal, switch each section,
  open the select), then Read the PNGs and actually look.
- **Measure what you claim:** element counts (`main form` = 0), `dialog.boundingBox()` height per section,
  `scrollLeft` of a rail, `document.activeElement` label, `:popover-open`, console errors.
- **Locators:** prefer role + exact name. The spec-sheet rail and the account menu repeat names ("Mazda", "Settings"),
  so non-exact locators hit two elements.

## Traps already hit

| Symptom | Cause | Fix |
|---|---|---|
| Five callers broke after "creating" a component | Overwrote an existing file without reading it | Always Read/grep for importers before Write. Recover a lost file from `apps/web/.next/**/*.map` `sourcesContent`. |
| Button/toggle pushed outside a dialog or page | Grid `1fr` track grew to its content's min width; `<input>` default `size=20` at large type | `minmax(0,1fr)`, `min-w-0` on the column, `size={1}` on big inputs |
| First card in a snap rail looks cut off | `scroll-snap` ignores padding | `scroll-px-*` matching the padding |
| Modal jumps between tabs | Height follows content | `Modal fill` / `SettingsModal` (fixed frame, scrolling panel) |
| Focus lands on the close button | React `autoFocus` calls `focus()` before `showModal()` | `Modal` focuses the first text input after opening; don't rely on `autoFocus` |
| Dropdown hidden behind a modal | Absolutely positioned list is below the top layer | Use `Select` / `SelectField` (native `popover`) |
| Page shows markup from edits ago + hydration error | Turbopack dev server serving stale SSR for that route | Code is fine if the error's `+` side shows the new markup; tell the user to restart `pnpm dev` |
| Two "Settings" buttons, tests/screen readers can't tell them apart | Duplicate accessible names | `aria-label` naming what it opens |
| Readings not announced as pairs | `<a>` directly inside `<dl>` | `div` with `dt`/`dd`, link overlaid `absolute inset-0` |
| Icon "fits the type" but means something else | Guessed a glyph by its name (Solar `delivery` is a hand truck) | Render and look before mapping; better a shared fallback than a wrong label |
| `humanise` prints "Atv", "Rv" | Title-casing acronyms | Special-case acronyms (`typeLabel`) |
| Shell edits via `sed`/heredoc mangled regex backslashes | Shell escaping | Write scripts with the Write tool, or use line-anchored patterns without backslashes |
| Faint circles over something laid on the header; popover surface left where its trigger was | `Popover` draws its trigger pill in a `z-[9999]` body portal, re-measured only on resize/scroll; under reduced motion every element gets a 0.01ms `all` transition, so a flex change eases for a frame and gets measured mid-way | Never cover or move the bell/account triggers; `transition-none` on anything whose size change shifts them |

## Report

Say what was checked (commands + which screenshots/measurements), what was not (e.g. a destructive action never
clicked), any test data created, and anything the user must do (restart `pnpm dev`, run a migration).
