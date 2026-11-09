# Club70 end to end: the app on an emulator against a local Clutch

One run proves the MVP on a real build: a new member signs up in the app
with the 6-digit code Clutch emails (read from the local mail catcher) and a
password, onboarding joins them to Club 70, the club puts them on a tier, they
book a court and pay (simulated), and the booking is on Home. Then
`verify.mjs` reads Clutch's database and checks every row the app should have
written.

```
e2e/run.sh              # seed, build the release APK, install, run, verify
SKIP_BUILD=1 e2e/run.sh # same, with the APK already installed
```

## What runs where

| Piece | Where |
| --- | --- |
| Clutch (Supabase + Next.js web, `/api/v1`) | your `club-management` checkout, on this machine |
| Club 70 (club, courts, hours, rules, pricing, tier) | `seed-club70.mjs`: `POST /api/v1/clubs`, plus the two writes Clutch has no API for |
| The app | a release APK built with `CLUB70_LOCAL_E2E=1` (allows plain http) |
| Device to host | `adb reverse` for `:3000` (Clutch, the only service the app calls) |
| The sign-up code | `flows/read-code.js`, from the Supabase CLI's mail catcher (Mailpit, `:54324`) |
| UI | Maestro, `flows/mvp.yaml` |
| The club assigning the tier | `flows/assign-tier.js`, what the admin app's bulk tier change writes |

Payments are simulated: Clutch's web runs with `SIMULATE_PAYMENTS=1` and no
Stripe key, and the app completes the simulated checkout. The `nativePayments`
capability stays off (P2 is not merged), so membership is assigned by the
club rather than bought in the app.

## One-time setup (Linux)

- Node 22.23.4 and pnpm 9.15.9 (`corepack enable`); JDK 17; the Android SDK
  with `platform-tools`, `emulator`, `platforms;android-36`,
  `system-images;android-36;google_apis;x86_64`; your user in the `kvm` group.
- Supabase CLI 2.109.1 (the version Clutch's CI pins) and Maestro.
- An AVD: `avdmanager create avd -n club70 -k "system-images;android-36;google_apis;x86_64" -d pixel_7`,
  started with `emulator -avd club70 -no-window -gpu swiftshader_indirect`
  (drop `-no-window` to watch it).

## Start Clutch

In `club-management`, on the branch the app should run against:

```
pnpm install
supabase start
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase status> \
SUPABASE_SERVICE_ROLE_KEY=<service role key from supabase status> \
NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_WEB_APP_URL=http://localhost:3000 \
NEXT_PUBLIC_WEB_URL=http://localhost:3000 NEXT_PUBLIC_ADMIN_URL=http://localhost:3001 \
  npx turbo run build --filter=@club/web
cd apps/web && <the same env> SIMULATE_PAYMENTS=1 npx next start -p 3000
```

These are the settings Clutch's own e2e job uses (`.github/workflows/ci.yml`,
`e2e/playwright.config.ts`).
