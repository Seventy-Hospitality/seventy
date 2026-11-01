#!/usr/bin/env node
/**
 * After the Maestro flow: what the app did must be in Clutch's database.
 * The member exists and belongs to Club 70 on its tier; they hold exactly one
 * confirmed, paid booking there; and one succeeded payment is recorded for it.
 *
 * Usage: node e2e/verify.mjs <member email>   (reads e2e/.env.e2e)
 */
import { readFileSync } from 'node:fs';

const email = process.argv[2];
if (!email) throw new Error('usage: node e2e/verify.mjs <member email>');

const env = Object.fromEntries(
  readFileSync(new URL('./.env.e2e', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const CLUB = env.EXPO_PUBLIC_CLUB_ID;

const failures = [];
const check = (ok, what, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(what);
};

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'club70-member-password' }),
});
const session = await signIn.json();
check(signIn.status === 200, 'the member signed up in the app can sign in', email);
const userId = session.user?.id;
if (!userId) process.exit(1);

const [profile] = await rest(`profiles?id=eq.${userId}&select=full_name`);
check(profile?.full_name === 'Alex Morgan', 'their profile has the name they typed', profile?.full_name);

const memberships = await rest(
  `club_memberships?club_id=eq.${CLUB}&user_id=eq.${userId}&select=status,role,membership_tier_id`,
);
check(memberships.length === 1 && memberships[0].status === 'active', 'they are an active member of Club 70');
check(memberships[0]?.membership_tier_id === env.E2E_TIER_ID, 'on the tier the club gave them');

const bookings = await rest(
  `bookings?club_id=eq.${CLUB}&user_id=eq.${userId}&select=id,status,payment_status,date,start_time,end_time,price_cents,stripe_payment_intent_id`,
);
check(bookings.length === 1, 'they hold exactly one booking', String(bookings.length));
const booking = bookings[0];
if (booking) {
  check(booking.status === 'confirmed', 'the booking is confirmed', booking.status);
  check(booking.payment_status === 'paid', 'and paid', booking.payment_status);
  console.log(`     ${booking.date} ${booking.start_time}-${booking.end_time}`);

  // Clutch's ledger: one succeeded payment for the booking, its price plus the
  // tax Clutch priced at payment (the booking's own paid_cents is not where
  // money is kept; dues are derived from these rows).
  const payments = await rest(
    `payment_history?reference_id=eq.${booking.id}&select=amount_cents,tax_cents,status,payment_type,stripe_payment_intent_id`,
  );
  const paid = payments.filter((p) => p.status === 'succeeded');
  check(paid.length === 1, 'one succeeded payment is recorded for it', JSON.stringify(payments));
  const [payment] = paid;
  if (payment) {
    check(
      payment.amount_cents === booking.price_cents + payment.tax_cents,
      'for the court price plus the tax',
      `${payment.amount_cents} = ${booking.price_cents} + ${payment.tax_cents}`,
    );
    check(payment.stripe_payment_intent_id === booking.stripe_payment_intent_id, 'through the intent the booking names');
  }
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
