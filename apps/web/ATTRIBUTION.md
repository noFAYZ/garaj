# Attribution

Third-party artwork shipped in this app.

## Twemoji

The emoji in activity entries are [Twemoji](https://github.com/jdecked/twemoji) 15.1.0, the
community-maintained continuation of Twitter's set.

- Graphics: **CC-BY 4.0** (https://creativecommons.org/licenses/by/4.0/) — © Twitter, Inc and other
  contributors. Attribution is required, which is what this file is.
- The SVGs are inlined into `src/components/emoji.tsx` by `scripts/generate-emoji.mjs`
  (`pnpm --filter @vehicle-os/web emoji`); nothing is fetched at runtime.

## Solar icons

The interface icons are [Solar](https://icon-sets.iconify.design/solar/) (bold duotone), **CC-BY
4.0**, via `@iconify-json/solar` as a dev dependency. Inlined by `scripts/generate-icons.mjs`
(`pnpm --filter @vehicle-os/web icons`).

## Manufacturer marks

Vehicle make logos come from [logo.dev](https://logo.dev) at runtime and are the property of their
respective owners; they are shown to identify a vehicle's manufacturer, never as an endorsement.
