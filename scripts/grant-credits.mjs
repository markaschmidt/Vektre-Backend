import { randomUUID } from 'node:crypto';

const emails = process.argv.slice(2);
if (emails.length === 0) {
  console.error('Usage: node scripts/grant-credits.mjs <email> [...]');
  process.exit(1);
}

const GRANT_CENTS = Number(process.env.GRANT_CENTS ?? 100_000);
const REF_ID =
  process.env.GRANT_REF_ID ??
  `admin-grant-${GRANT_CENTS}c-${new Date().toISOString().slice(0, 10)}`;
const periodKey = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function rpc(name, body) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${name} failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function selectLedger(userId, filters) {
  const params = new URLSearchParams({
    select: 'id,balance_after_cents',
    user_id: `eq.${userId}`,
    ...filters,
    limit: '1',
  });
  const response = await fetch(`${url}/rest/v1/usage_credit_ledger?${params}`, {
    headers: { ...headers, Prefer: 'return=representation' },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`select ledger failed (${response.status}): ${text}`);
  }
  const rows = text ? JSON.parse(text) : [];
  return rows[0] ?? null;
}

async function getBalance(userId) {
  const params = new URLSearchParams({
    select: 'balance_after_cents',
    user_id: `eq.${userId}`,
    order: 'created_at.desc',
    limit: '1',
  });
  const response = await fetch(`${url}/rest/v1/usage_credit_ledger?${params}`, {
    headers,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`balance failed (${response.status}): ${text}`);
  }
  const rows = text ? JSON.parse(text) : [];
  return rows[0]?.balance_after_cents ?? 0;
}

async function insertLedger(row) {
  const response = await fetch(`${url}/rest/v1/usage_credit_ledger`, {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`insert failed (${response.status}): ${text}`);
  }
}

async function grant(email) {
  const userId = await rpc('find_user_id_by_email', {
    lookup_email: email.trim().toLowerCase(),
  });
  if (!userId) return { email, status: 'not_found' };

  const uid = String(userId);
  const existing = await selectLedger(uid, {
    reason: 'eq.adjust',
    ref_id: `eq.${REF_ID}`,
  });
  if (existing) {
    return {
      email,
      status: 'already_granted',
      userId: uid,
      balance_cents: existing.balance_after_cents,
    };
  }

  const prior = await getBalance(uid);
  const balanceAfter = prior + GRANT_CENTS;
  await insertLedger({
    id: `ucl_${randomUUID()}`,
    user_id: uid,
    delta_cents: GRANT_CENTS,
    balance_after_cents: balanceAfter,
    reason: 'adjust',
    ref_type: 'admin',
    ref_id: REF_ID,
    period_key: periodKey,
    created_at: new Date().toISOString(),
  });

  return {
    email,
    status: 'granted',
    userId: uid,
    prior_balance_cents: prior,
    granted_cents: GRANT_CENTS,
    balance_cents: balanceAfter,
  };
}

const results = [];
for (const email of emails) {
  results.push(await grant(email));
}
console.log(JSON.stringify(results, null, 2));
