# Pending — mobile release

What is left before the app ships on Google Play. The code side of the 2026-11-14 sweep and of
the 2026-11-18 release pass is done and verified (typecheck, lint, unit tests, API suite, an
Android production bundle on Expo SDK 54); everything below needs a decision, an account, or a
phone.

Nothing from either pass is committed yet.

## Blockers — decide before the first store build

- [ ] **Production API URL.** With no `extra.apiUrl` in `apps/mobile/app.json`, the app falls
      back to the dev machine's LAN address on port 3001 (`lib/api.ts`). A store build must set
      `extra.apiUrl` to the deployed API (https), or every request goes nowhere.
- [x] **Bundle id.** `app.garajjos` since 2026-11-22 (iOS `bundleIdentifier`, Android
      `package`). It cannot change after the first upload to either store, and Play's products
      and RevenueCat's Play app are tied to it.
- [ ] **Push on Android needs Firebase.** Expo's push tokens on Android come through Firebase
      Cloud Messaging, and there is no `google-services.json`: a store build registers no phone,
      so no reminder ever arrives (it is reported to crash reporting, not shown). Create a
      Firebase project, add the Android app under the final package name, put the file in
      `apps/mobile/`, set `"googleServicesFile": "./google-services.json"` under `android` in
      `app.json`, and upload the FCM V1 service-account key to EAS (`eas credentials`).
- [ ] **Contact address** on the privacy and deletion pages: `CONTACT_EMAIL` in
      `apps/landing/src/components/legal-page.tsx` is `support@garaj.app`. Make it a mailbox
      someone reads, and have the privacy page read by whoever answers for it.

## Store billing (RevenueCat → Google Play) — set up in the dashboards

The code sells through RevenueCat (`apps/mobile/lib/store.ts`), and the API reads what was bought
from RevenueCat's API (`apps/api/src/infrastructure/revenuecat.ts`). Web purchases stay on Stripe.

- [ ] **Play Console:** upload one AAB to the internal testing track (Play will not let you create
      products before a build exists), then create the products: subscriptions for Plus and
      Business with monthly and yearly base plans, and any one-time "lifetime" product. Add
      license testers.
- [ ] **RevenueCat project `proj0b00acd0`** (currently empty):
  - add the Google Play app (package name from the bundle id above, plus the Play service
    account credentials so RevenueCat can validate purchases and get real-time notifications);
  - entitlements with lookup keys exactly `plus` and `business`, each attached to its products;
  - one **current** offering whose packages are named `plus_monthly`, `plus_annual`,
    `plus_lifetime`, `business_monthly`, `business_annual` (any missing one is simply not offered);
  - **Integrations → Webhooks:** URL `https://<api>/api/v1/billing/revenuecat/webhook`, and the
    Authorization header value set to `REVENUECAT_WEBHOOK_AUTH` from the root `.env`.
- [ ] **Public SDK key** (`goog_…`, Project settings → API keys) into `apps/mobile/app.json` →
      `extra.revenuecat.android`. Never the secret `sk_…` key — that one lives only in the API's
      env (`REVENUECAT_SECRET_KEY`, `REVENUECAT_PROJECT_ID`, `REVENUECAT_WEBHOOK_AUTH`).
- [ ] **Production env** for the API: the three `REVENUECAT_*` values, and `TRUST_PROXY_HOPS`
      (1 behind one load balancer, 2 behind a CDN and a load balancer, 0 with no proxy at all).
- [ ] **Email:** set `RESEND_API_KEY` in production — password resets and email confirmation go
      out through it. Without it they are only logged.

## Play Console — listing

- [ ] **Privacy policy URL:** `<landing>/privacy`. **Account deletion URL:** `<landing>/delete-account`.
- [ ] **App access:** a demo account for reviewers (sign-in is required to use the app). Give it
      Business from the admin console, so every gated screen opens without a purchase.
- [ ] **Data safety form:** account info (name, email), photos and files, app activity (records),
      device ids (push token), crash logs, purchase history; nothing sold or shared for ads;
      deletion available in the app and on the web. Text and photos sent to an AI feature are
      processed by Google Gemini on Garaj's behalf (a service provider, not "shared").
- [ ] **Advertising ID:** none of the app's own libraries declares `AD_ID`; after the first upload,
      check App bundle explorer → Permissions, and answer the Advertising ID question to match.
- [ ] **Financial features, target audience and content rating** questionnaires (Console forms;
      Garaj offers no financial services).

## EAS setup — run in `apps/mobile`

- [ ] `eas init` — creates the EAS project and writes `extra.eas.projectId`. Push tokens need it;
      until then every reminder silently never arrives, and crash reporting logs
      "No EAS projectId".
- [ ] `eas update:configure` — writes `updates.url` and turns over-the-air updates on. Channels
      (`preview`, `production`) are already in `eas.json`.
- [ ] **Rule from now on:** bump `version` in `app.json` with every native change (a new
      native module, a config plugin change). Runtime is `appVersion`, so an update built for new
      native code would otherwise reach old installs. The SDK 58 upgrade, RevenueCat and
      `expo-intent-launcher` are native changes: the next build needs a new version.

## Crash reporting (Sentry)

- [x] Project DSN (`benzapps/garaj-mobile`) is in `app.json` → `extra.sentryDsn`; a test error
      from the app arrived on 2026-11-19.
- [ ] For readable stack traces: org and project are in the plugin config, so only
      `SENTRY_AUTH_TOKEN` is missing. Set it as a sensitive EAS env var for `preview` and
      `production`, then remove `SENTRY_DISABLE_AUTO_UPLOAD` from `eas.json`.

## Deploy

- [ ] **API first, then the app.** Migration `0024_billing_provider` (additive) must run before
      the new API starts. The new app needs the new endpoints: `/billing/revenuecat/webhook`,
      `/billing/sync` without Stripe, `provider`/`store`/`managementUrl` on `/users/me/plan`,
      report pages of 500, and the vehicle list at 100.
- [ ] **Worker too:** it now handles `delete-objects` (stored files of a deleted garage or
      account). An old worker would dead-letter those jobs.

## Test on a phone

Rebuild the development build first: Expo SDK 54 (RN 0.81, React 19.1), RevenueCat and the intent
launcher are all native changes.

- [ ] Sign in, sign out, and a session that expires (the "expired" note on sign-in). Signed out,
      the garage must not flash before sign-in (the stack is now `Stack.Protected`).
- [ ] Forgot password from sign-in → email → web reset page → sign in on the phone.
- [ ] Android autofill on sign-in (Google Password Manager); Return moves name → email →
      password.
- [ ] **Keyboard on Android:** SDK 54 draws edge-to-edge. Check every form (sign-in, the + sheet,
      add vehicle, edit) still lifts above the keyboard.
- [ ] Buy Plus as a license tester, then switch to Business (prorated now), then to Plus (at
      renewal), cancel in Play, restore on a second phone. The plan on You follows each.
- [ ] Delete account (Settings → Account) with a Play plan: the warning shows; the account is
      gone on the web; the photos are gone from storage once the worker runs.
- [ ] Tap a push notification with the app closed and with it open; a notification arriving
      while the app is open updates the bell.
- [ ] Half-filled form: swipe back on iOS, Back on Android, drag the + sheet down — each asks
      "Discard changes?"; a saved form leaves without asking.
- [ ] Save entries offline (aeroplane mode), reconnect, watch them send.
- [ ] A long PDF on Android (pages draw as they scroll in); offline, "Open in another app" opens it
      in the phone's PDF viewer. A PDF on iOS.
- [ ] Cold start shows the splash straight into the garage, light and dark.

## Later — deliberately left, revisit if needed

- [ ] **Expo SDK after 54.** Play will move the target API to 37 (Android 17) around August 2027;
      SDK 54 targets 36. Upgrade before then.
- [ ] **Reanimated for the dock and sheets.** They animate on the JS thread (springs on layout
      props, `PanResponder` drags), worked around with settle delays. Move them only if a device
      shows jank.
- [ ] **Request cancellation.** The API client does not take React Query's abort signal, so
      leaving a screen lets its requests finish. Threading a signal through every client method
      is wide; worth it only if data costs show up.
- [ ] **Virtualise the activity feed.** It is memoised, not virtualised; fine at current sizes.
      Needs the vehicle page rebuilt around a list.
- [ ] **Embed fonts at build time** instead of loading them at startup (the splash hides the
      load today). Needs the font family names reconciled per platform.
- [ ] **Requests on opening a vehicle (~15).** Stats, Planned and Documents load in the background
      so tabs switch instantly; each now costs one database round trip before its work instead
      of two. Revisit only if data costs show up.
- [ ] **End-to-end tests** with Maestro: sign in, save offline then sync, open a document.
- [ ] **Terms of service page.** Not required by Play, but expected beside a subscription (and
      required by Apple once there is an iOS build). The purchase screen already states the
      price, the period, that it renews, and where to cancel.
- [ ] **iPad:** support is off (`supportsTablet: false`) because there is no iPad layout. Turn it
      back on if one is ever built.
