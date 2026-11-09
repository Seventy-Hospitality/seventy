// The club puts the new member on a tier, as Clutch's admin app does
// (bulkUpdateMemberTier: a service-role update of the membership's tier).
// Runs inside Maestro (runScript): EMAIL, PASSWORD, TIER_ID, CLUB_ID come from
// `maestro test -e`. Local stack only: the member signs in through Clutch's
// API (the password the app set), and the write uses the Supabase demo
// service key, as the admin app's server action does.
var CLUTCH = 'http://localhost:3000/api/v1';
var SUPABASE = 'http://127.0.0.1:54321';
var SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

var signIn = http.post(CLUTCH + '/auth/token', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (signIn.status !== 200) throw new Error('member sign-in failed: ' + signIn.status + ' ' + signIn.body);
var userId = json(signIn.body).data.user.id;

var update = http.request(
  SUPABASE + '/rest/v1/club_memberships?club_id=eq.' + CLUB_ID + '&user_id=eq.' + userId,
  {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      Authorization: 'Bearer ' + SERVICE,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ membership_tier_id: TIER_ID }),
  },
);
var rows = json(update.body);
if (update.status !== 200 || rows.length !== 1) {
  throw new Error('tier assignment failed: ' + update.status + ' ' + update.body);
}
output.memberId = userId;
