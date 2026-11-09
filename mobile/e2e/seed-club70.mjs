#!/usr/bin/env node
/**
 * Club 70 on a LOCAL Clutch stack, for the end-to-end run on an emulator.
 *
 * Clutch's own doors where it has them: accounts through GoTrue's admin API,
 * the club through POST /api/v1/clubs (one transaction: courts, hours,
 * booking rules, pricing). Clutch has no API for platform roles or
 * membership tiers (the admin app writes them with the service role), so
 * those two are written the same way here.
 *
 * Idempotent: a second run finds the accounts, club and tier it made.
 * Prints the mobile build's env (EXPO_PUBLIC_*) on stdout; logs go to stderr.
 *
 * Usage: node e2e/seed-club70.mjs > e2e/.env.e2e
 * Env:   SUPABASE_URL (default http://127.0.0.1:54321),
 *        SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (default: the local
 *        stack's well-known demo keys), CLUTCH_URL (default http://localhost:3000)
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const CLUTCH_URL = process.env.CLUTCH_URL ?? 'http://localhost:3000';

if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(SUPABASE_URL)) {
  throw new Error(`Refusing to seed a non-local Supabase: ${SUPABASE_URL}`);
}

const PASSWORD = 'club70-e2e-password';
const PROVISIONER = 'provisioner@club70.test';
const OWNER = 'owner@club70.test';
const SLUG = '770';

const log = (...args) => console.error('[seed]', ...args);

async function http(method, url, { headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

const service = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };

async function rest(method, path, body, prefer = 'return=representation') {
  const { status, json } = await http(method, `${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ...service, prefer },
    body,
  });
  if (status >= 300) throw new Error(`${method} ${path}: ${status} ${JSON.stringify(json)}`);
  return json;
}

/** A confirmed account with a name, made once. */
async function ensureUser(email, fullName) {
  const created = await http('POST', `${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: service,
    body: { email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } },
  });
  if (created.status < 300) {
    log('created', email);
    return created.json.id;
  }
  const page = await http('GET', `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: service });
  const user = page.json.users.find((u) => u.email === email);
  if (!user) throw new Error(`Could not create or find ${email}: ${JSON.stringify(created.json)}`);
  return user.id;
}

async function signIn(email) {
  const { status, json } = await http('POST', `${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY },
    body: { email, password: PASSWORD },
  });
  if (status !== 200) throw new Error(`sign in ${email}: ${status} ${JSON.stringify(json)}`);
  return json.access_token;
}

const provisionerId = await ensureUser(PROVISIONER, 'Club 70 Provisioner');
const ownerId = await ensureUser(OWNER, 'Club 70 Owner');

const roles = await rest('GET', `platform_admins?user_id=eq.${provisionerId}&select=id`);
if (roles.length === 0) {
  await rest('POST', 'platform_admins', { user_id: provisionerId, role: 'provisioner' });
  log('granted provisioner');
}

let [club] = await rest('GET', `clubs?slug=eq.${SLUG}&select=id,stripe_account_id`);
if (!club) {
  const token = await signIn(PROVISIONER);
  const days = [0, 1, 2, 3, 4, 5, 6];
  const { status, json } = await http('POST', `${CLUTCH_URL}/api/v1/clubs`, {
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': `seed-club70-${SLUG}` },
    body: {
      name: 'Seventy',
      slug: SLUG,
      timezone: 'America/New_York',
      currency: 'USD',
      email: 'frontdesk@club70.test',
      address: '70 Court Street, New York, NY',
      courts: [1, 2, 3, 4].map((n) => ({ name: `Court ${n}`, court_type: 'badminton', is_indoor: true })),
      // Open all day, every day, so a run at any hour finds a free slot.
      operating_hours: days.map((day_of_week) => ({ day_of_week, open_time: '00:00', close_time: '00:00' })),
      booking_rules: {
        slot_duration_minutes: 60,
        min_duration_minutes: 60,
        max_duration_minutes: 120,
        advance_booking_days: 14,
        cancellation_hours: 24,
      },
      pricing: { default_price_cents: 3000 },
      owner_user_id: ownerId,
    },
  });
  if (status !== 201) throw new Error(`POST /clubs: ${status} ${JSON.stringify(json)}`);
  club = { id: json.data.id, stripe_account_id: null };
  log('created club', club.id);
}

// Charges land on the platform account in a simulated deployment; the admin
// app refuses to make a tier for a club with no Stripe account at all.
if (!club.stripe_account_id) {
  await rest('PATCH', `clubs?id=eq.${club.id}`, { stripe_account_id: 'platform' }, 'return=minimal');
}

let [tier] = await rest('GET', `membership_tiers?club_id=eq.${club.id}&name=eq.Member&select=id`);
if (!tier) {
  [tier] = await rest('POST', 'membership_tiers', {
    club_id: club.id,
    name: 'Member',
    description: 'Book courts up to 14 days ahead.',
    price_cents: 7000,
    currency: 'USD',
    interval: 'monthly',
    advance_booking_days: 14,
    is_active: true,
    stripe_product_id: `prod_sim_club70`,
    stripe_price_id: `price_sim_club70`,
  });
  log('created tier', tier.id);
}

process.stdout.write(
  [
    `E2E_SUPABASE_URL=${SUPABASE_URL}`,
    `EXPO_PUBLIC_CLUTCH_API_URL=http://localhost:3000/api/v1`,
    `EXPO_PUBLIC_CLUB_ID=${club.id}`,
    `EXPO_PUBLIC_CLUB_SLUG=${SLUG}`,
    `E2E_TIER_ID=${tier.id}`,
    '',
  ].join('\n'),
);
