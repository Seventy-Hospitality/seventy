#!/usr/bin/env bash
# The Club70 MVP, end to end on an Android emulator against a local Clutch.
# See e2e/README.md for the one-time setup (Clutch stack, emulator, Maestro).
#
#   e2e/run.sh            seed, build, install, run the flow, check the database
#   SKIP_BUILD=1 e2e/run.sh   reuse the installed APK
set -euo pipefail
cd "$(dirname "$0")/.."

adb get-state >/dev/null || { echo "No emulator/device attached (adb get-state)." >&2; exit 1; }
curl -sf -o /dev/null http://localhost:3000/api/v1/clubs || { echo "Clutch web is not up on :3000." >&2; exit 1; }

node e2e/seed-club70.mjs > e2e/.env.e2e
set -a; . e2e/.env.e2e; set +a

if [ "${SKIP_BUILD:-}" != "1" ]; then
  export CLUB70_LOCAL_E2E=1 NODE_ENV=production
  CI=1 npx expo prebuild --platform android --no-install
  (cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64 --console=plain -q)
  adb install -r android/app/build/outputs/apk/release/app-release.apk
fi

# The app calls only Clutch (localhost:3000 on the device); forward it to this
# machine. The Maestro scripts run on this machine and reach the mail catcher
# (:54324) and Supabase (:54321) directly.
adb reverse tcp:3000 tcp:3000 >/dev/null
curl -sf -o /dev/null http://127.0.0.1:54324/api/v1/info || { echo "The mail catcher is not up on :54324 (supabase start)." >&2; exit 1; }

EMAIL="member+$(date +%s)@club70.test"
echo "Member: $EMAIL"
maestro test \
  -e EMAIL="$EMAIL" \
  -e PASSWORD="club70-member-password" \
  -e TIER_ID="$E2E_TIER_ID" \
  -e CLUB_ID="$EXPO_PUBLIC_CLUB_ID" \
  e2e/flows/mvp.yaml

node e2e/verify.mjs "$EMAIL"
