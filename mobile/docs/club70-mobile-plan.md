# Club70 mobile app: architecture on Clutch

The Expo app (`mobile/`) is a client of **Clutch** (we-are-clutch/club-management:
Supabase + Next.js). It no longer talks to `seventy/api`. Club 70 is the Clutch
club "Seventy" (slug `770`, id `15e24f5f-ee39-4154-8ad6-06942d06cb8a`,
America/New_York). There were no live members on seventy/api, so nothing was
migrated.

## Stack
Expo SDK 54, expo-router 6, RN 0.81, react-query 5, react-hook-form + zod 4,
@stripe/stripe-react-native 0.50.3. No identity-provider SDK. Tabs: Home /
Reserve / Groups / Account.

## One service
The app talks only to the **Clutch HTTP API** (`EXPO_PUBLIC_CLUTCH_API_URL`,
ending in `/api/v1`): sign-in through `/auth/*` and `/me/identities`, all
data with the member's access token as Bearer (RLS runs as the user).
Clutch's identity provider (Supabase) and its keys stay behind that API, and
the Stripe publishable key arrives with every payment intent. The app holds
no Supabase or Stripe key and receives no email links.

## Auth (`src/lib/auth-session.ts`, `session.tsx`, `secure-storage.ts`, `oauth.ts`)
- `auth-session.ts` owns the session `{access_token, refresh_token,
  expires_at, user}`: one JSON value in a chunked SecureStore adapter
  (SecureStore caps a value near 2 KB) under `club70-session`.
  `getAccessToken()` refreshes through `POST /auth/refresh` when under 60 s
  remain; the client forces one `refresh()` after a 401. Refreshes are
  single-flight (refresh tokens rotate). A refresh Clutch refuses (4xx) ends
  the session (SIGNED_OUT); one that could not run (offline, 5xx, 429) keeps
  it. A stale refresh never overwrites or clears a session signed in
  meanwhile. `SessionProvider` refreshes ahead of expiry while the app is in
  the foreground and clears the query cache on sign-out or a user change.
- Every emailed step is a **6-digit code** (`POST /auth/otp`, then
  `/auth/otp/verify`): email sign-in (creates the account if new), sign-up
  (code with `create_user` and the name, then `POST /auth/password` with the
  chosen password; if that fails the member is held on set-password), an
  unconfirmed address on password sign-in (a fresh code is sent), and
  password reset (a code signs in, the member is held on
  `/auth/set-password` until `POST /auth/password`; the flag is persisted so
  an app kill cannot skip it). Clutch answers `/auth/otp` the same whether
  or not the address has an account, so the app never says either.
- Password sign-in: `POST /auth/token`.
- Google: the iOS / Android OAuth client with code + PKCE through the
  reversed client id scheme (registered by `app.config.js`), nonce kept;
  Apple: native, iOS only. The ID token and raw nonce go to
  `POST /auth/id-token`. Apple's first-sign-in name is written to the Clutch
  profile; onboarding asks for a name whenever the profile has none.
- Sign-out: `POST /auth/signout` (local scope) when Clutch answers within
  4 s, then the session is forgotten on the device regardless. Every
  sign-out path unregisters this install's push token first.
- Sign-in methods: `GET /me/identities`, link Google or Apple with
  `POST /me/identities` (answers the session that carries the identity,
  which the app adopts), unlink with `DELETE /me/identities/{id}`.
- Step-up before account deletion: a fresh sign-in by the member's own
  method (password, code, Google, Apple). The fresh session is adopted only
  when it names the signed-in member; another account's is dropped, so the
  session never switches person.

## Clutch client (`src/lib/clutch/`)
- `contract.gen.ts` is GENERATED (`npm run contract:pull && npm run
  contract:gen`) from Clutch's `docs/api/openapi.json`, snapshotted in
  `clutch/openapi.json` with its source in `clutch/openapi.source.json`
  (today: `origin/feat/api-sign-in-codes`, we-are-clutch #188; regenerate
  from main once it merges). zod 4 schemas that ignore unknown
  fields, respect nullability and brand ids; `contract.gen.test.ts` fails when
  it is stale. Never edit it by hand.
- `contract.pending.ts` is the only hand-written contract: operations of
  branches not in that document yet, mirrored from their schema code (P1
  devices, P5 account and check-in, P2 billing, P4 booking parity, main's
  legacy checkout). Delete each block when its routes reach the document.
- `capabilities.ts` is ONE map of which server capabilities this build may
  use. A call whose capability is off refuses locally
  (`ClutchUnavailableError`) and its screen shows `FeatureUnavailable`
  ("not available in the app yet") instead of an error or a dead end. Flip an
  entry when its branch is deployed.
- `client.ts`: one typed function per endpoint, grouped as `auth`, `club`,
  `bookings`, `groups`, `membership`, `paymentMethods`, `me`. Sign-in calls
  are anonymous: no Bearer, and no refresh after a 401. Transport rules: strict
  envelope, `ClutchError.code: ErrorCode | 'unknown'`, one shared refresh
  after a 401 and a NEW Idempotency-Key for that retry (Clutch caches the 401
  under the first key), an Idempotency-Key on every mutation (the logical
  mutation's, `useMutationKey`; confirm-style calls also rotate after a 5xx;
  multipart sends always get a fresh one), `409 request_in_flight` waits with
  the same key, the club bound at construction with a startup slug check,
  `/me/groups` filtered to the club, midnight sent as `00:00`.
- `membership-view.ts`: `entitlement()` is the one reading of "may this member
  use the club" (club standing today, the P2 billing view later); booking and
  onboarding both use it, so a canceled / past_due / unpaid member is lapsed.
- Tests mock at the client boundary (`testing.ts`) and build every response
  with `fixtures.ts`, whose builders parse through the contract schemas.

## Payments (`src/lib/stripe.tsx`)
Clutch charges are direct charges on the club's Stripe connected account.
Every payment result becomes a `SheetIntent` union (`stripe` with
`clientSecret` + `stripeAccount` + `publishableKey` + optional
customer/ephemeral key, or `simulated`). The only way to show a sheet is
`presentConnectedSheet(intent)`, which initialises the SDK with the intent's
own `{publishableKey, stripeAccountId}` behind a lock and returns the
completed intent id; an intent without a key resolves `unconfigured`. The key
is Clutch's platform key, sent as `publishable_key` next to every
`client_secret` (we-are-clutch #187). The app never reports success: it hands
the intent id to Clutch (`confirm` / `save`) and shows Clutch's answer. Physical venue
memberships use Stripe, never IAP (App Store 3.1.3(e)).

## Push (`src/features/account/usePushRegistration.ts`, `push-verification.ts`, `src/features/notifications/`)
- Register `{token, platform, device_secret}` at launch, after every sign-in
  and on token rotation; unregister (`DELETE /me/devices {token}`) on every
  sign-out path before the session ends.
- `202 verification_required`: the token was another account's and this
  install cannot show its secret. Clutch pushes a data-only
  `{type: "clutch.device_verification", code}`; the app catches it in the
  foreground listener or the background task (iOS `remote-notification`
  background mode, content-available; Android data message), never shows it,
  and posts `/me/devices/verify {token, code}`. `409
  device_verification_invalid` drops it; `503 device_verification_unavailable`
  or a code that never arrives: the next launch registers again for a new
  code.
- A tapped notice (`data: {notificationId, type, clubId, link}`) opens the
  in-app inbox (`/account/notifications`, GET/POST `/me/notifications`)
  focused on that notice and marks it read, also when the tap launched the
  app or arrived before sign-in.

## Legal and contact
`src/lib/links.ts` holds the privacy and terms URLs
(seventyhospitality.com/privacy.html, /terms.html, opened in the in-app
browser) and the contact address (mailto:contact@seventyhospitality.com).

## Features
- **Onboarding**: name (when the profile has none) -> join the club (then
  re-read `/me`) -> pick a tier -> subscribe through the sheet -> Clutch
  confirms; decided only by `entitlement()`, with a lapsed screen and sign-out
  on every error screen. ID verification is dropped. Paying waits on P2.
- **Reserve**: sports from the club's courts (per-sport rules with P4), the
  per-court availability grid for a day, a contiguous range (midnight as end
  of day), `pickCourt` chooses one court free for the whole range; booking
  needs an entitled membership. Quote with tax (P4), hold (15 minutes),
  payment intent reused per booking, sheet (one at a time), confirm with the
  completed intent; a transient confirm failure keeps the payer locked and
  re-reads, and a hold is released only while it is still pending.
- **Bookings**: detail with players and dues, cancel, reschedule (P4 quote and
  paid moves), invite players or a group, accept/decline and leave (P4),
  players paying their share (P4), bookings the member plays in.
- **Home**: `/me/home` (profile, upcoming bookings, announcements), booking and
  group invitations, the member QR card (signed check-in token).
- **Groups**: Clutch member groups (create, roster, owner transfer, invites,
  invite links, activity, join by link); member search waits on P4.
- **Account**: profile + avatar, notification preferences on Clutch's
  category x channel matrix, push registration (install secret, token
  rotation, retries), payment history, saved cards, tier change / cancel /
  resume (P2), sign-in methods (link/unlink through `/me/identities`), delete
  account with a fresh sign-in as step-up.

## What is gated, and why (capabilities.ts)
`contract.gen.ts` is generated from `feat/typed-api-contract` (we-are-clutch
#183: P3's typed contract on top of #181), which carries P1, P4 and P5. It
merges after #180 and #181; until then a Clutch deployment of main does not
answer this contract.

| Capability | Clutch | State | What it unlocks |
|---|---|---|---|
| `pushDevices` | #160, in main | on | register / unregister this install (device_secret); prove a taken token with the pushed code (`/me/devices/verify`) |
| `checkinToken` | #161, in main | on | signed member QR |
| `accountDeletion` | #161, in main | on | deletion preview, delete with step-up |
| `bookingParity` | #181 (+ #183's contract) | on | quote with tax, per-sport booking rules, accept/decline, remove/leave, member search, reschedule quote and paid moves, players paying their share, pending-only hold release |
| `nativePayments` | P2 feat/native-payments | off | subscribe / confirm / change / cancel / resume, add card, set default, remove card, booking checkout with saved cards |

Without P2 a member cannot pay for a membership in the app: the club gives
them their tier (the admin app), and the plan step says so with "Check
again". Booking checkout works without P2 through main's payment intent.

Club 70 prices tax at payment (`tax_status: at_checkout`): checkout names no
total until the payment intent states it, and the confirmation shows what was
charged.

Still missing in Clutch (not on any branch):
- A web page for group invite links: shared links are the app's
  `seventy://groups/join?token=` deep link and need the app installed.

## Clutch production settings the app relies on
These belong to Clutch (its `DEPLOYMENT.md` lists them); the app has no
dashboard of its own.
- The sign-in code emails: the "Magic Link" and "Confirm signup" templates
  carry `{{ .Token }}` (a new address gets the confirmation email).
- Google and Apple providers list the app's client ids (the iOS and Android
  OAuth client ids; bundle id `club.seventy.mobile` for Apple). In Google
  Cloud, the Android client needs "custom URI scheme" enabled.
- Manual identity linking on (Sign-in methods screen).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` set on the web deployment (it becomes
  `publishable_key`).
- No redirect URLs: the app never receives an email link.

## Verification
`npm run typecheck`, `npm test` (jest, mocked at the client boundary), and
`e2e/run.sh`: a release build on an Android emulator against a local Clutch,
driven by Maestro from a code sign-up (the code read from the local mail
catcher) to a paid booking, then checked in Clutch's database
(e2e/README.md). iOS is not run here (no macOS).
