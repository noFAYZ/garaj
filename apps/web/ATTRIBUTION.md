# Attribution

Third-party artwork shipped in this app.

## Fluent Emoji

The emoji in activity entries are Microsoft's [Fluent Emoji](https://github.com/microsoft/fluentui-emoji),
the "Color" style, taken through [Iconify](https://iconify.design/).

- **MIT** licence — Copyright (c) Microsoft Corporation. Full text:
  https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE
- The SVGs are inlined into `src/components/emoji.tsx` and `apps/mobile/lib/emoji-art.ts` by
  `scripts/generate-emoji.mjs` (`pnpm --filter @vehicle-os/web emoji`); nothing is fetched at
  runtime.

## Solar icons

The interface icons are [Solar](https://icon-sets.iconify.design/solar/) (bold duotone), **CC-BY
4.0**, via `@iconify-json/solar` as a dev dependency. Inlined by `scripts/generate-icons.mjs`
(`pnpm --filter @vehicle-os/web icons`).

## Manufacturer marks

Vehicle make logos come from [logo.dev](https://logo.dev) at runtime and are the property of their
respective owners; they are shown to identify a vehicle's manufacturer, never as an endorsement.
