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
  storage = a chunked SecureStore adapter (a session outgrows SecureStore's
  ~2 KB value limit), auto refresh started/stopped with AppState.
- Email links (magic link, signup confirmation, password reset) land on
  `seventy://auth/callback?code=...` and `exchangeCodeForSession` completes them
  with the PKCE verifier only this device holds, which also binds the link to
  the device (the old app-minted `state` is gone). Each email also carries a
  6-digit code (`verifyOtp`) for links opened on another device.
- Password recovery signs in in recovery mode (`PASSWORD_RECOVERY`) and the
  root layout holds the user on `/auth/set-password` until `updateUser`.
- Google / Apple: the app mints a raw nonce, the platform SDK gets
  `sha256(raw)`, and `signInWithIdToken({provider, token, nonce: raw})`.
- `onAuthStateChange`: `SIGNED_OUT` (and a different user signing in) clears
  the react-query cache.

## Clutch client (`src/lib/clutch/`)
- `contract.gen.ts`: zod response schemas + inferred types for every endpoint
  the app calls, in Clutch's words (booking, court, court_type, tier, group,
  user_id). Hand-written from the route code until Clutch's
  `feat/api-contract` publishes `docs/api/openapi.json`; then a generator
  replaces it. Fields from in-flight Clutch branches are marked PENDING.
- `client.ts`: `createClutchClient({ clubId, ... })`, one typed function per
  endpoint, grouped as `club`, `bookings`, `groups`, `membership`,
  `paymentMethods`, `me`. Transport rules:
  - strict envelope (`{data, count?}` / `{error, message, details?}`), data
    parsed by the endpoint's schema; drift is a `ClutchError` of kind
    `contract`;
  - `ClutchError.code` is `ErrorCode | 'unknown'` (`errors.ts`), screens branch
    only on the code;
  - 401 -> one shared `refreshSession()` -> retry once;
  - every mutation carries an `Idempotency-Key`; features pass the logical
    mutation's key (`useMutationKey`) so a retry replays instead of acting
    twice, and `409 request_in_flight` waits and retries with the same key;
  - the club is bound at construction; `club.verify()` checks at startup that
    the id resolves to the expected slug (`ClubCheck` blocks a misconfigured
    build). `/me/groups` is filtered to this club.
- `ids.ts`: branded `ClubId`, `GroupId`, `UserId`, `BookingId`, `CourtId`,
  `TierId`, ... so a group id can never stand in for a club id.
- `src/lib/queries.ts`: the shared query keys; every feature invalidates these.
- Tests mock at the client boundary (`testing.ts` `createMockClutch`,
  `fixtures.ts`).

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

## Features
- **Onboarding**: signed in -> join the club (`POST /clubs/{id}/join`, then
  re-read `/me`; membership is never inferred from the join) -> pick a tier ->
  subscribe (PaymentSheet) -> Clutch confirms. ID verification is dropped.
- **Reserve**: sports from the club's courts, the per-court availability grid
  for a day, a contiguous range, `pickCourt` chooses one court free for the
  whole range; quote, hold (15 minutes), payment intent, sheet, confirm. The
  hold and the intent are tracked separately.
- **Bookings**: detail with players and dues, cancel, reschedule, invite
  players or a group, accept/decline, leave, pay a balance due.
- **Home**: `/me/home` (profile, upcoming bookings, club announcements),
  booking and group invitations, the member QR card (signed check-in token).
- **Groups**: Clutch member groups (create, roster, owner transfer, invites,
  invite links, activity, join by link).
- **Account**: profile + avatar, notification preferences on Clutch's
  category x channel matrix, Expo push registration, payment history, saved
  cards, tier change / cancel / resume, sign-in methods (link/unlink through
  supabase-js), delete account with a fresh sign-in as step-up.

## Waiting on Clutch (coded against the design, verify when merged)
- P1 `feat/expo-push`: `POST/DELETE /me/devices`.
- P2 `feat/native-payments`: PaymentSheet bundle (customer + ephemeral key +
  account), subscribe / confirm / change / cancel / resume, setup-intent +
  save by `setup_intent_id`, booking payment intent with customer + key.
- P3 `feat/api-contract`: OpenAPI + ErrorCode export (replaces the
  hand-written contract), `/me` lists every membership with status + tier and
  fails instead of returning `[]` on a failed read, join returns the status,
  player names on booking detail.
- P4 `feat/member-booking-parity`: `POST /bookings/quote`, invite respond,
  player removal, member player search, dearer reschedule, payment clearing vs
  failed split, members-only and tier gating.
- P5 `feat/account-deletion-and-checkin`: `DELETE /me/account` with step-up,
  `GET /me/checkin-token`.

Until P3 lands, `/me` memberships `[]` and `/me/membership` `null` are treated
as "not known", never as proof of absence.

## Supabase dashboard setup
- Auth > URL configuration: add `seventy://auth/callback` to the redirect URLs.
- Auth > Providers > Google: enable; authorized client ids = the iOS, Android
  and web OAuth client ids used by the app (comma separated); "skip nonce
  check" off.
- Auth > Providers > Apple: enable; authorized client ids = bundle id
  `club.seventy.mobile` (and the services id if Android/web Apple sign-in is
  used).
- Auth > Email templates: keep `{{ .Token }}` in the magic link, confirmation
  and recovery templates so the 6-digit code fallback works.
- Auth > Settings: enable manual identity linking (Sign-in methods screen).
- EAS: set `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` and the
  Stripe, Google and Apple values as EAS environment variables per profile.

## Verification (honest limits)
No iOS/Android simulator here. Gate: `npm run typecheck`, `npm test` (jest,
mocked at the client boundary). The owner runs it on a device against a
Clutch deployment.
