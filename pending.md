# Pending — mobile release

What is left before the app ships, from the pre-release sweeps of 2026-11-14. The code side is
done and verified (typecheck, lint, unit tests, API suite, production bundles for both
platforms); everything below needs a decision, an account, or a phone.

Nothing from those sweeps is committed yet.

## Blockers — decide before the first store build

- [ ] **Production API URL.** With no `extra.apiUrl` in `apps/mobile/app.json`, the app falls
      back to the dev machine's LAN address on port 3001 (`lib/api.ts`). A store build must set
      `extra.apiUrl` to the deployed API, or every request goes nowhere.
- [ ] **Paid plans and store billing.** Upgrades open Stripe Checkout (`app/upgrade.tsx`). Apple
      (Guideline 3.1.1) and Google Play both require their own in-app purchase for digital
      subscriptions bought in the app, so this is a likely rejection. Options: StoreKit / Play
      Billing (e.g. RevenueCat) for the mobile apps, or a reader-style flow with no purchase
      button in the app.
- [ ] **Bundle id.** Still `dev.vehicleos.app` (iOS `bundleIdentifier`, Android `package`). It
      cannot change after the first upload to either store. Decide whether it should name Garaj.

## EAS setup — run in `apps/mobile`

- [ ] `eas init` — creates the EAS project and writes `extra.eas.projectId`. Push tokens need it;
      until then every reminder silently never arrives, and crash reporting logs
      "No EAS projectId".
- [ ] `eas update:configure` — writes `updates.url` and turns over-the-air updates on. Channels
      (`preview`, `production`) are already in `eas.json`.
- [ ] **Rule from now on:** bump `version` in `app.json` with every native change (a new
      native module, a config plugin change). Runtime is `appVersion`, so an update built for new
      native code would otherwise reach old installs.

## Crash reporting (Sentry)

- [ ] Put the project DSN in `app.json` → `extra.sentryDsn`. Without it Sentry stays off.
- [ ] For readable stack traces: set `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` as EAS
      secrets, then remove `SENTRY_DISABLE_AUTO_UPLOAD` from `eas.json`.

## Deploy

- [ ] **API first, then the app.** The new app needs the new endpoints and behaviour: per-vehicle
      spend on the dashboard, `DELETE /users/me` (account deletion), duplicate-safe retries for
      service records, documents and photos, and response compression. No migration needed.

## Test on a phone

Rebuild the development build first: Sentry, the splash screen, the image manipulator and
expo-updates all added native code.

- [ ] Sign in, sign out, and a session that expires (the "expired" note on sign-in).
- [ ] Android autofill on sign-in (Google Password Manager); Return moves name → email →
      password.
- [ ] Delete account (Settings → Account), then confirm the account is gone on the web.
- [ ] Tap a push notification with the app closed and with it open; a notification arriving
      while the app is open updates the bell.
- [ ] Half-filled form: swipe back on iOS, Back on Android, drag the + sheet down — each asks
      "Discard changes?"; a saved form leaves without asking.
- [ ] Save entries offline (aeroplane mode), reconnect, watch them send.
- [ ] A long PDF on Android (pages draw as they scroll in); a PDF on iOS.
- [ ] Return from Stripe checkout with the app killed: lands on Plan, Back works.
- [ ] Cold start shows the splash straight into the garage, light and dark.

## Later — deliberately left, revisit if needed

- [ ] **Virtualise the activity feed.** It is memoised, not virtualised; fine at current sizes.
      Needs the vehicle page rebuilt around a list.
- [ ] **Embed fonts at build time** instead of loading them at startup (the splash hides the
      load today). Needs the font family names reconciled per platform.
- [ ] **Requests on opening a vehicle (~15).** Stats, Planned and Documents load in the background
      so tabs switch instantly. Revisit only if data costs show up.
- [ ] **End-to-end tests** with Maestro: sign in, save offline then sync, open a document.
- [ ] **Admin typecheck:** 4 errors from a missing `Readings` export in
      `@/components/ui/overview` (admin pages). Predates this work.
- [ ] **iPad:** support is off (`supportsTablet: false`) because there is no iPad layout. Turn it
      back on if one is ever built.
