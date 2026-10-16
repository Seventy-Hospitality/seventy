# Club70 mobile app: architecture on Clutch

The Expo app (`mobile/`) is a client of **Clutch** (we-are-clutch/club-management:
Supabase + Next.js). It no longer talks to `seventy/api`. Club 70 is the Clutch
club "Seventy" (slug `770`, id `15e24f5f-ee39-4154-8ad6-06942d06cb8a`,
America/New_York). There were no live members on seventy/api, so nothing was
migrated.

## Stack
Expo SDK 54, expo-router 6, RN 0.81, react-query 5, react-hook-form + zod 4,
supabase-js 2 (auth only), @stripe/stripe-react-native 0.50.3. Tabs: Home /
Reserve / Groups / Account.

## Two services
- **Supabase GoTrue** (`EXPO_PUBLIC_SUPABASE_URL` + anon key) for every auth
  flow, on the device through supabase-js. The app never calls Clutch's
  `/api/v1/auth/*` proxy.
- **Clutch HTTP API** (`EXPO_PUBLIC_CLUTCH_API_URL`, ending in `/api/v1`) for
  all data, with the Supabase access token as Bearer (RLS runs as the user).

## Auth (`src/lib/supabase.ts`, `secure-storage.ts`, `session.tsx`, `oauth.ts`)
- supabase-js owns the session: `flowType: 'pkce'`, `detectSessionInUrl: false`,
  storage key `club70-auth` in a chunked SecureStore adapter (a session
  outgrows SecureStore's ~2 KB value limit; operations are serialised per
  key), auto refresh started/stopped with AppState.
- Email links (magic link, signup confirmation, password reset) land on
  `seventy://auth/callback?code=...&sb_flow_id=...`; `exchangeCodeForSession`
  completes them with the PKCE verifier only this device holds, and the flow
  id (`experimental.appendPkceFlowIdToRedirects`) keeps an earlier link valid
  after a second email. Each email also carries a 6-digit code (`verifyOtp`)
  for a link opened on another device; that case says so.
- Password recovery signs in in recovery mode (`PASSWORD_RECOVERY`); the flag
  is persisted so an app kill cannot skip it, and the root layout holds the
  user on `/auth/set-password` until `updateUser`.
- Sign-up to an existing address (GoTrue answers a user with no identities)
  says so; a password sign-in to an unconfirmed address offers the code and a
  resend; a failed reset email is reported, never shown as sent.
- Google: the iOS / Android OAuth client with code + PKCE through the
  reversed client id scheme (registered by `app.config.js`), nonce kept.
  Apple: native, iOS only. Apple's first-sign-in name is written to the Clutch
  profile; onboarding asks for a name whenever the profile has none.
- Sign-out always works: when GoTrue cannot be reached (an expired token
  offline) the app forgets the stored session and the cache itself. Every
  sign-out path unregisters this install's push token first.

## Clutch client (`src/lib/clutch/`)
- `contract.gen.ts` is GENERATED (`npm run contract:pull && npm run
  contract:gen`) from Clutch's `docs/api/openapi.json`, snapshotted in
  `clutch/openapi.json` with its source in `clutch/openapi.source.json`
  (today: `origin/feat/api-contract`). zod 4 schemas that ignore unknown
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
- `client.ts`: one typed function per endpoint, grouped as `club`, `bookings`,
  `groups`, `membership`, `paymentMethods`, `me`. Transport rules: strict
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
`clientSecret` + `stripeAccount` + optional customer/ephemeral key, or
`simulated`). The only way to show a sheet is `presentConnectedSheet(intent)`,
which re-initialises the SDK with `{publishableKey, stripeAccountId}` behind a
lock and returns the completed intent id. The app never reports success: it
hands the intent id to Clutch (`confirm` / `save`) and shows Clutch's answer.
`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the Clutch platform key. Physical venue
memberships use Stripe, never IAP (App Store 3.1.3(e)).

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
  resume (P2), sign-in methods (link/unlink through supabase-js), delete
  account with a fresh sign-in as step-up.

## What is gated, and why (capabilities.ts)
All five Clutch branches are pushed; none is deployed. The merge order
(#156, P1, P5, P4, P3, P2) ends with regenerating `contract.gen.ts` from the
final `openapi.json`.

| Capability | Clutch branch | State | What it unlocks |
|---|---|---|---|
| `pushDevices` | P1 feat/expo-push | on | register / unregister this install (device_secret) |
| `checkinToken` | P5 feat/account-deletion-and-checkin | on | signed member QR |
| `accountDeletion` | P5 | on | deletion preview, delete with step-up |
| `bookingParity` | P4 feat/member-booking-parity | off | quote with tax, per-sport booking rules, accept/decline, remove/leave, member search, reschedule quote and paid moves, players paying their share, pending-only hold release |
| `nativePayments` | P2 feat/native-payments | off | subscribe / confirm / change / cancel / resume, add card, set default, remove card, booking checkout with saved cards |

P2 and P4 stay off until they are merged behind P3's contract: their payment
fields are being renamed to snake_case (client_secret, customer_id,
ephemeral_key_secret, stripe_account, intent_type) and P4's `charge` field is
not published yet. While off, the app says plainly that the action is not
available yet; booking still works through main's checkout (no saved cards).

Still missing in Clutch (not on any branch):
- A list of bookings the member plays in (accepted invitations). The app keeps
  the ids it accepted on this device and reads each booking; Clutch should
  add `include=playing` (or similar) to `/me/bookings`.
- A web page for group invite links: shared links are the app's
  `seventy://groups/join?token=` deep link and need the app installed.

## Supabase dashboard setup
- Auth > URL configuration: add `seventy://auth/callback` and the glob `seventy://**` to the redirect URLs (the links carry an `sb_flow_id` query).
- Auth > Providers > Google: enable; authorized client ids = the iOS and
  Android OAuth client ids used by the app (comma separated); "skip nonce
  check" off. In Google Cloud, the Android client needs "custom URI scheme"
  enabled.
- Auth > Providers > Apple: enable; authorized client ids = bundle id
  `club.seventy.mobile`.
- Auth > Email templates: keep `{{ .Token }}` in the magic link, confirmation
  and recovery templates so the 6-digit code fallback works.
- Auth > Settings: enable manual identity linking (Sign-in methods screen).
- EAS: set `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` and the
  Stripe, Google and Apple values as EAS environment variables per profile.

## Verification (honest limits)
No iOS/Android simulator here. Gate: `npm run typecheck`, `npm test` (jest,
mocked at the client boundary). The owner runs it on a device against a
Clutch deployment.
