// RooftopOS staging runner (Deno). Drives the four deployed integration functions
// over real HTTP on a dedicated, synthetic-only staging project and records every
// result as JSON and markdown.
//
// ── What the staging project is ──────────────────────────────────────
// A brand-new, EMPTY Supabase / Lovable Cloud project. Never a copy of AutoLabels,
// never a replay of its migration history (38 historic migrations call
// cron.schedule or net.http_post and some hard-code the production ref).
// Only the files below are applied, each as its own migration / SQL-editor paste.
//
// ── Exact order ──────────────────────────────────────────────────────
//  1. supabase/tests/staging/00_isolation_check.sql   read-only, must return PASS
//  2. supabase/tests/staging/01_dependencies.sql      migration
//  3. supabase/migrations/20261030000000_rooftopos_spine.sql   migration, unchanged
//  4. supabase/tests/staging/00_isolation_check.sql   read-only, must return PASS again
//     supabase/tests/staging/04_verify_schema.sql     read-only, must return PASS
//  5. supabase/tests/staging/02_seed_synthetic.sql    seed (separate migration/paste)
//  6. Deploy the four functions (file list below) with ROOFTOP_INTEGRATIONS_ENABLED
//     unset or "false", then:  deno run -A supabase/tests/staging/run_staging.ts phase1
//     Expects 503 from every function and no inbox writes.
//  7. Ken sets the edge-function secret ROOFTOP_INTEGRATIONS_ENABLED=true.
//  8. deno run -A supabase/tests/staging/run_staging.ts phase2   (everything else)
//  9. supabase/tests/staging/03_rollback.sql          migration; returns PASS
// 10. Verify: 00_isolation_check.sql must PASS (spine_present = false).
// 11. Re-apply: the spine migration, then 00 and 04 (both PASS), then 02.
//
// ── Edge-function secrets (dashboard / Lovable Cloud secrets) ────────
//   ROOFTOP_INTEGRATIONS_ENABLED  unset/"false" for phase 1, "true" for phase 2
//   CRON_SHARED_SECRET            any long random value; also given to this runner
//                                 as STAGING_CRON_SECRET (sent as x-cron-secret)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by the platform
// All four functions must deploy with verify_jwt = false (supabase/config.toml):
// AutoFilm and the cron caller send no Supabase JWT. The runner sends ingest
// requests with no auth header at all, so a gateway 401 is reported as such.
//
// ── Files the four functions deploy from (diff each against the branch) ──
//   supabase/functions/integration-ingest/index.ts
//   supabase/functions/integration-apply/index.ts
//   supabase/functions/integration-dispatch/index.ts
//   supabase/functions/integration-health/index.ts
//   supabase/functions/_shared/supabase.ts
//   supabase/functions/_shared/http.ts
//   supabase/functions/_shared/integrations/envelope.ts
//   supabase/functions/_shared/integrations/signing.ts
//   supabase/functions/_shared/integrations/vin.ts
//   supabase/functions/_shared/integrations/backoff.ts
//   supabase/functions/_shared/integrations/ingestDecision.ts
//   supabase/functions/_shared/integrations/applyDecision.ts
//   supabase/functions/_shared/integrations/adapters/autofilmV1.ts
//   supabase/functions/_shared/integrations/handlers/ingest.ts
//   supabase/functions/_shared/integrations/handlers/apply.ts
//   supabase/functions/_shared/integrations/handlers/dispatch.ts
//   supabase/functions/_shared/integrations/handlers/health.ts
//   supabase/config.toml   ([functions.integration-*] verify_jwt = false)
// Remote imports: https://esm.sh/@supabase/supabase-js@2.45.4 (the four index.ts)
// and https://esm.sh/@supabase/supabase-js@2 (_shared/supabase.ts).
//
// ── Runner environment (nothing else is read) ────────────────────────
//   STAGING_URL          https://<staging-ref>.supabase.co
//   STAGING_ANON_KEY     the staging anon / publishable key
//   STAGING_CRON_SECRET  same value as the CRON_SHARED_SECRET function secret
//   STAGING_DB_URL       direct or SESSION-pooler Postgres URL of the staging DB
//                        (not the transaction pooler on :6543)
//   STAGING_PASSWORD_DEALER_A / STAGING_PASSWORD_DEALER_B / STAGING_PASSWORD_ADMIN
//                        optional; when absent the runner sets a fresh random
//                        password on each synthetic user through STAGING_DB_URL.
// Flags: phase1 | phase2, --out=<dir> (default ./rooftopos-staging-results),
//   --dispatch-base=<https url>: LOCAL VALIDATION ONLY, overrides the dispatch
//   target base (default STAGING_URL).
// The runner refuses to start if any URL or the anon key names a production
// project ref. It never prints or writes a secret, password or token.

import postgres from "npm:postgres@3.4.9";

const PROD_REFS = ["onnbmmdbrsgytfozfozn", "ptiwdwfdckfqivoocyvp", "hciluddranlphtekspzk"];

const T = {
  A: "5ea90000-0000-4000-8000-00000000000a",
  B: "5ea90000-0000-4000-8000-00000000000b",
};
const CONN = {
  A_NATIVE: "5ea90000-0000-4000-8000-0000000000a1",
  A_AF: "5ea90000-0000-4000-8000-0000000000a2",
  A_PAUSED: "5ea90000-0000-4000-8000-0000000000a3",
  B_NATIVE: "5ea90000-0000-4000-8000-0000000000b1",
  B_AF: "5ea90000-0000-4000-8000-0000000000b2",
};
const KEY = {
  A_NATIVE: "rooftopos-staging-a-native",
  A_AF: "rooftopos-staging-a-autofilm",
  A_PAUSED: "rooftopos-staging-a-paused",
  B_NATIVE: "rooftopos-staging-b-native",
  B_AF: "rooftopos-staging-b-autofilm",
};
const ROOFTOP = { A: "rooftopos-staging-rooftop-a", B: "rooftopos-staging-rooftop-b" };
const RO = { A: "staging-ro-a-1", B: "staging-ro-b-1" };
const VIN = "1HGCM82633A004352";
const VIN2 = "1FTFW1E51PFA00017";
const USERS = {
  dealerA: { email: "rooftopos-staging-dealer-a@example.test", env: "STAGING_PASSWORD_DEALER_A" },
  dealerB: { email: "rooftopos-staging-dealer-b@example.test", env: "STAGING_PASSWORD_DEALER_B" },
  admin: { email: "rooftopos-staging-admin@example.test", env: "STAGING_PASSWORD_ADMIN" },
} as const;
const SPINE_TABLES = [
  "vehicles", "vehicle_instances", "vehicle_external_refs", "integration_connections",
  "integration_connection_keys", "integration_inbox", "integration_source_versions",
  "integration_outbox", "integration_direction_flags", "inspection_evidence", "repair_items",
  "acquisition_records",
];
const TENANT_READ = new Set([
  "vehicle_instances", "vehicle_external_refs", "integration_connections", "integration_inbox",
  "integration_outbox", "integration_direction_flags", "inspection_evidence", "repair_items",
]);

// ── config ───────────────────────────────────────────────────────────
const args = Deno.args;
const phase = args.find((a) => a === "phase1" || a === "phase2");
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const env = (name: string) => (Deno.env.get(name) ?? "").trim();

const STAGING_URL = env("STAGING_URL").replace(/\/+$/, "");
const ANON = env("STAGING_ANON_KEY");
const CRON = env("STAGING_CRON_SECRET");
const DB_URL = env("STAGING_DB_URL");
const DISPATCH_BASE = (flag("dispatch-base") ?? STAGING_URL).replace(/\/+$/, "");
const OUT_DIR = flag("out") ?? "./rooftopos-staging-results";
const FN = `${STAGING_URL}/functions/v1`;
const RUN = crypto.randomUUID().slice(0, 8);

function refuse(msg: string): never {
  console.error(`REFUSED: ${msg}`);
  Deno.exit(2);
}

function jwtRef(key: string): string {
  const part = key.split(".")[1];
  if (!part) return "";
  try {
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.ref === "string" ? json.ref : "";
  } catch {
    return "";
  }
}

if (!phase) refuse("pass phase1 or phase2");
if (!STAGING_URL || !ANON || !DB_URL || (phase === "phase2" && !CRON)) {
  refuse("STAGING_URL, STAGING_ANON_KEY, STAGING_DB_URL (and STAGING_CRON_SECRET for phase2) are required");
}
for (const [label, value] of [
  ["STAGING_URL", STAGING_URL], ["STAGING_DB_URL", DB_URL], ["--dispatch-base", DISPATCH_BASE],
  ["STAGING_ANON_KEY ref", jwtRef(ANON)],
] as const) {
  const hit = PROD_REFS.find((r) => value.toLowerCase().includes(r));
  if (hit) refuse(`${label} names production project ${hit}`);
}
if (!/^https?:\/\//.test(STAGING_URL)) refuse("STAGING_URL must be an http(s) URL");

const isLocalDb = /@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL);
const sql = postgres(DB_URL, {
  max: 6,
  prepare: false,
  ssl: isLocalDb ? false : "require",
  onnotice: () => {},
  types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) } },
});

// ── crypto, built independently of the function code ─────────────────
const enc = new TextEncoder();
const toHex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
const sha256Hex = async (s: string) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

// RooftopOS native v1: HMAC over "rooftopos.v1\n<ts seconds>\n<key id>\n<sha256(body)>".
async function nativeHeaders(keyId: string, secret: string, body: string, tsSeconds?: number) {
  const ts = String(tsSeconds ?? Math.floor(Date.now() / 1000));
  const sig = await hmacHex(secret, `rooftopos.v1\n${ts}\n${keyId}\n${await sha256Hex(body)}`);
  return {
    "Content-Type": "application/json",
    "X-Rooftop-Key-Id": keyId,
    "X-Rooftop-Timestamp": ts,
    "X-Rooftop-Signature": `v1=${sig}`,
  };
}

// AutoFilm, exactly as its delivery loop builds a request (integrations.ts:199-211):
// body = JSON.stringify({event, event_id, schema_version:"1", tenant_id, data}),
// x-af-timestamp = String(Date.now()), x-af-signature = hex HMAC(secret, `${ts}.${body}`).
async function afRequest(secret: string, rooftopId: string, event: string, eventId: string, data: Record<string, unknown>) {
  const bodyStr = JSON.stringify({ event, event_id: eventId, schema_version: "1", tenant_id: rooftopId, data });
  const ts = String(Date.now());
  const sig = await hmacHex(secret, `${ts}.${bodyStr}`);
  return { body: bodyStr, headers: { "content-type": "application/json", "x-af-timestamp": ts, "x-af-signature": sig } };
}

function envelope(over: Record<string, unknown> = {}) {
  return {
    event_id: crypto.randomUUID(),
    event_type: "autofilm.inspection.completed",
    schema_version: "1.0.0",
    producer: "autofilm",
    source_record_id: `stg-${RUN}-${crypto.randomUUID().slice(0, 8)}`,
    source_version: 1,
    idempotency_key: `stg-${RUN}-${crypto.randomUUID()}`,
    correlation_id: `staging-${RUN}`,
    causation_id: null,
    occurred_at: new Date().toISOString(),
    observed_at: new Date().toISOString(),
    sent_at: new Date().toISOString(),
    vin: VIN,
    tenant_ref: "ADVISORY",
    instance_ref: null,
    visibility: "tenant_private",
    evidence_refs: ["staging-evidence:1"],
    payload: { inspection_id: `insp-${RUN}`, odometer_miles: 41250, measurements: { lf_tire_32nds: 7 }, technician_verified: false },
    ...over,
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────
interface Res { status: number; body: Record<string, unknown> | unknown[] | null; text: string }
async function http(url: string, init: RequestInit = {}): Promise<Res> {
  const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let body: Res["body"] = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}
const obj = (r: Res) => (r.body && !Array.isArray(r.body) ? r.body as Record<string, unknown> : {});
const gatewayHint = (r: Res) =>
  r.status === 401 && /missing authorization header|invalid jwt|jwt/i.test(r.text) && !/signature_invalid|not authorized|token/i.test(r.text)
    ? " (gateway rejected the call: deploy this function with verify_jwt = false)"
    : "";

const ingestNative = (body: string, headers: Record<string, string>) =>
  http(`${FN}/integration-ingest`, { method: "POST", body, headers });
const ingestAf = (connId: string, req: { body: string; headers: Record<string, string> }) =>
  http(`${FN}/integration-ingest?connection=${connId}`, { method: "POST", body: req.body, headers: req.headers });
const cronHeaders = () => ({ "Content-Type": "application/json", "x-cron-secret": CRON });
const apply = (limit = 100) =>
  http(`${FN}/integration-apply`, { method: "POST", body: JSON.stringify({ limit }), headers: cronHeaders() });
const dispatch = (limit = 25) =>
  http(`${FN}/integration-dispatch`, { method: "POST", body: JSON.stringify({ limit }), headers: cronHeaders() });
const restHeaders = (token?: string): Record<string, string> => {
  const h: Record<string, string> = { apikey: ANON, Accept: "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  else if (ANON.split(".").length === 3) h.Authorization = `Bearer ${ANON}`;
  return h;
};

// ── assertions + results ─────────────────────────────────────────────
class Fail extends Error {}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Fail(msg);
}
const eq = (actual: unknown, expected: unknown, msg: string) =>
  check(JSON.stringify(actual) === JSON.stringify(expected), `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

interface Result { name: string; ok: boolean; ms: number; detail: string[]; error?: string }
const results: Result[] = [];
async function test(name: string, fn: (note: (s: string) => void) => Promise<void>) {
  const detail: string[] = [];
  const t0 = performance.now();
  try {
    await fn((s) => detail.push(s));
    results.push({ name, ok: true, ms: Math.round(performance.now() - t0), detail });
    console.log(`PASS  ${name}`);
  } catch (e) {
    const error = e instanceof Fail ? e.message : `${(e as Error).name}: ${(e as Error).message}`;
    results.push({ name, ok: false, ms: Math.round(performance.now() - t0), detail, error });
    console.log(`FAIL  ${name}\n      ${error}`);
  }
}

// ── DB helpers (service-level setup and read-back over STAGING_DB_URL) ─
const secrets = new Map<string, string>();
async function loadSecrets() {
  const rows = await sql`select k.key_id, s.decrypted_secret
    from public.integration_connection_keys k join vault.decrypted_secrets s on s.name = k.vault_secret_name
    where k.key_id like 'rooftopos-staging-%'`;
  for (const r of rows) secrets.set(r.key_id as string, r.decrypted_secret as string);
}
const secret = (keyId: string) => {
  const s = secrets.get(keyId);
  if (!s) throw new Fail(`no Vault secret for ${keyId}; was 02_seed_synthetic.sql applied?`);
  return s;
};
const inboxByRecord = (record: string) =>
  sql`select * from public.integration_inbox where source_record_id = ${record} order by source_version, received_at`;
const inboxCount = async () =>
  Number((await sql`select count(*)::int n from public.integration_inbox where tenant_id in (${T.A}, ${T.B})`)[0].n);
const watermark = async (connId: string, record: string) =>
  (await sql`select latest_version from public.integration_source_versions where connection_id = ${connId} and source_record_id = ${record}`)[0]?.latest_version ?? null;
const readyNow = (ids: string[]) =>
  sql`update public.integration_inbox set next_attempt_at = now(), claimed_until = null where id in ${sql(ids)} and status in ('received','held')`;

async function applyUntilIdle(maxRounds = 20) {
  const totals: Record<string, number> = {};
  for (let i = 0; i < maxRounds; i++) {
    const r = await apply(100);
    check(r.status === 200, `apply returned ${r.status} ${r.text.slice(0, 200)}${gatewayHint(r)}`);
    const b = obj(r);
    for (const [k, v] of Object.entries((b.outcomes ?? {}) as Record<string, number>)) totals[k] = (totals[k] ?? 0) + v;
    if (Number(b.claimed ?? 0) === 0) break;
  }
  return totals;
}

async function signIn(user: keyof typeof USERS): Promise<string> {
  const u = USERS[user];
  let password = env(u.env);
  if (!password) {
    password = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const updated = await sql`update auth.users set encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf'))
      where email = ${u.email} returning id`;
    check(updated.length === 1, `synthetic user ${u.email} not found; apply 02_seed_synthetic.sql`);
  }
  const r = await http(`${STAGING_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, password }),
  });
  check(r.status === 200 && typeof obj(r).access_token === "string", `sign-in for ${u.email} failed with ${r.status}`);
  return obj(r).access_token as string;
}

async function rest(table: string, token?: string, query = "select=*") {
  return await http(`${STAGING_URL}/rest/v1/${table}?${query}`, { headers: restHeaders(token) });
}
const denied = (r: Res) => r.status === 401 || r.status === 403 || (r.status === 404 && /42501|permission/i.test(r.text)) ||
  /42501|permission denied/i.test(r.text);

async function runSqlFile(name: string) {
  const text = await Deno.readTextFile(new URL(`./${name}`, import.meta.url));
  const out = await sql.unsafe(text);
  const last = Array.isArray(out) && Array.isArray(out[out.length - 1]) ? out[out.length - 1] : out;
  return (last as unknown as Array<Record<string, unknown>>)[0] ?? {};
}

// ── phase 1: kill switch off ─────────────────────────────────────────
async function phase1() {
  await test("preflight: 00_isolation_check.sql passes on the target database", async (note) => {
    const row = await runSqlFile("00_isolation_check.sql");
    eq(row.isolation_check, "PASS", "isolation check");
    note(`database=${row.database} spine_present=${row.spine_present} public_tables=${row.public_tables}`);
  });
  await test("preflight: synthetic seed present and keys readable from Vault", async () => {
    await loadSecrets();
    for (const k of Object.values(KEY)) secret(k);
  });
  await test("kill switch off: all four functions answer 503 and nothing is written", async (note) => {
    const before = await inboxCount();
    const body = JSON.stringify(envelope());
    const n = await ingestNative(body, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), body));
    eq(n.status, 503, `ingest (native) ${gatewayHint(n)}`);
    const af = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", `evt-${RUN}-ks`, { ro_id: RO.A }));
    eq(af.status, 503, `ingest (autofilm) ${gatewayHint(af)}`);
    const ap = await http(`${FN}/integration-apply`, { method: "POST", body: "{}", headers: cronHeaders() });
    eq(ap.status, 503, `apply ${gatewayHint(ap)}`);
    const dp = await http(`${FN}/integration-dispatch`, { method: "POST", body: "{}", headers: cronHeaders() });
    eq(dp.status, 503, `dispatch ${gatewayHint(dp)}`);
    const hp = await http(`${FN}/integration-health`, { method: "GET", headers: { Authorization: `Bearer ${ANON}`, apikey: ANON } });
    eq(hp.status, 503, `health ${gatewayHint(hp)}`);
    eq(obj(n).error, "integrations_disabled", "ingest error code");
    eq(await inboxCount(), before, "inbox rows written while disabled");
    note("ingest(native), ingest(autofilm), apply, dispatch, health: 503 integrations_disabled");
  });
}

// ── phase 2: flag on ─────────────────────────────────────────────────
async function phase2() {
  let ok = true;
  await test("preflight: 00_isolation_check.sql and 04_verify_schema.sql pass", async (note) => {
    const iso = await runSqlFile("00_isolation_check.sql");
    eq(iso.isolation_check, "PASS", "isolation check");
    eq(iso.spine_present, true, "spine present");
    const ver = await runSqlFile("04_verify_schema.sql");
    note(`database=${iso.database}`);
    check(ver && Object.keys(ver).length > 0, "04_verify_schema.sql returned nothing");
  });
  await test("preflight: synthetic seed present and keys readable from Vault", async () => {
    await loadSecrets();
    for (const k of Object.values(KEY)) secret(k);
    await sql`update public.integration_connection_keys set status = 'active', revoked_at = null where key_id in ${sql(Object.values(KEY))}`;
  });
  if (results.some((r) => !r.ok)) return;

  await test("native: a valid signed event is accepted for the connection's tenant (202)", async (note) => {
    const env1 = envelope();
    const body = JSON.stringify(env1);
    const r = await ingestNative(body, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), body));
    if (r.status === 503) {
      ok = false;
      throw new Fail("503 integrations_disabled: set ROOFTOP_INTEGRATIONS_ENABLED=true before phase2");
    }
    eq(r.status, 202, `ingest ${r.text.slice(0, 200)}${gatewayHint(r)}`);
    const rows = await inboxByRecord(env1.source_record_id);
    check(rows.length === 1, "STAGING_DB_URL does not see the row STAGING_URL just accepted: they are different projects");
    eq([rows[0].tenant_id, rows[0].connection_id, rows[0].status, rows[0].visibility, rows[0].adapter],
      [T.A, CONN.A_NATIVE, "received", "tenant_private", "rooftop.v1"], "stored row");
    note(`inbox ${rows[0].id}`);
  });
  if (!ok) return;

  await test("native: bad signature, stale timestamp, unknown key and paused connection are 401", async (note) => {
    const before = await inboxCount();
    const body = JSON.stringify(envelope());
    const now = Math.floor(Date.now() / 1000);
    const cases: Array<[string, Record<string, string>]> = [
      ["bad signature", await nativeHeaders(KEY.A_NATIVE, "not-the-secret", body)],
      ["stale timestamp", await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), body, now - 3600)],
      ["future timestamp", await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), body, now + 3600)],
      ["unknown key", await nativeHeaders(`rooftopos-staging-unknown-${RUN}`, secret(KEY.A_NATIVE), body)],
      ["paused connection", await nativeHeaders(KEY.A_PAUSED, secret(KEY.A_PAUSED), body)],
    ];
    for (const [label, headers] of cases) {
      const r = await ingestNative(body, headers);
      eq(r.status, 401, label);
      eq(obj(r).error, "signature_invalid", `${label} error`);
    }
    const paused = await ingestAf(CONN.A_AF, await afRequest("not-the-secret", ROOFTOP.A, "mpi.report.published", `evt-${RUN}-bad`, { ro_id: RO.A }));
    eq(paused.status, 401, "autofilm bad signature");
    eq(await inboxCount(), before, "rows written by rejected requests");
    note(cases.map((c) => c[0]).join(", ") + ", autofilm bad signature: 401");
  });

  await test("native: duplicate event_id is 200 duplicate; same idempotency key with a changed payload is 409", async () => {
    const e = envelope();
    const body = JSON.stringify(e);
    eq((await ingestNative(body, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), body))).status, 202, "first");
    const again = await ingestNative(body, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), body));
    eq([again.status, obj(again).status], [200, "duplicate"], "replay");
    const changed = JSON.stringify({ ...e, event_id: crypto.randomUUID(), payload: { ...e.payload, odometer_miles: 1 } });
    const conflict = await ingestNative(changed, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), changed));
    eq(conflict.status, 409, "changed payload under the same idempotency key");
    eq((await inboxByRecord(e.source_record_id)).length, 1, "rows for the record");
  });

  await test("native: a tenant spoof in the body cannot reach the other dealer", async (note) => {
    const bBefore = Number((await sql`select count(*)::int n from public.integration_inbox where tenant_id = ${T.B}`)[0].n);
    const e = envelope({ tenant_ref: T.B });
    const body = JSON.stringify(e);
    const r = await ingestNative(body, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), body));
    eq(r.status, 202, `spoofed tenant_ref is advisory ${r.text.slice(0, 200)}`);
    const rows = await inboxByRecord(e.source_record_id);
    eq(rows.map((x) => x.tenant_id), [T.A], "stored tenant");
    const bAfter = Number((await sql`select count(*)::int n from public.integration_inbox where tenant_id = ${T.B}`)[0].n);
    eq(bAfter, bBefore, "dealer B inbox");
    const wrongProducer = JSON.stringify(envelope({ event_type: "autocurb.valuation.updated", producer: "autocurb", tenant_ref: T.B }));
    const p = await ingestNative(wrongProducer, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), wrongProducer));
    eq(p.status, 403, "producer not bound to the connection");
    note("tenant_ref=B stored under A; producer spoof 403");
  });

  await test("autofilm (live shape): report.published and decisions counts are accepted and resolved via the RO ref", async (note) => {
    const pub = await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", `evt-${RUN}-pub`,
      { ro_id: RO.A, ro_number: "RO-10442" });
    const r1 = await ingestAf(CONN.A_AF, pub);
    eq(r1.status, 202, `published ${r1.text.slice(0, 200)}${gatewayHint(r1)}`);
    const dec = await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.customer.decisions.submitted", `evt-${RUN}-dec`,
      { ro_id: RO.A, external_ro_id: "DMS-5521", approved: 2, declined: 1, total: 1180.5, authorization_id: `auth-${RUN}` });
    const r2 = await ingestAf(CONN.A_AF, dec);
    eq(r2.status, 202, `decisions ${r2.text.slice(0, 200)}`);
    const rows = await sql`select event_type, vin, adapter, tenant_id, status from public.integration_inbox
      where connection_id = ${CONN.A_AF} and envelope->>'correlation_id' in (${`af:evt-${RUN}-pub`}, ${`af:evt-${RUN}-dec`}) order by event_type`;
    eq(rows.map((r) => [r.event_type, r.vin, r.adapter, r.tenant_id, r.status]), [
      ["autofilm.inspection.completed", VIN, "autofilm.v1", T.A, "received"],
      ["autofilm.repair_order.decisions_submitted", VIN, "autofilm.v1", T.A, "received"],
    ], "inbox rows");
    const replay = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", `evt-${RUN}-pub`,
      { ro_id: RO.A, ro_number: "RO-10442" }));
    eq([replay.status, obj(replay).status], [200, "duplicate"], "AutoFilm retry of the same event_id");
    const msg = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.customer.message.created", `evt-${RUN}-msg`, { ro_id: RO.A }));
    eq([msg.status, obj(msg).status ?? obj(msg).code], [200, "ignored"], "message.created is ignored");
    const spoof = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.B, "mpi.report.published", `evt-${RUN}-spoof`, { ro_id: RO.B }));
    eq(spoof.status, 403, "rooftop spoof (A's key claiming B's rooftop)");
    note("published 202, decisions 202, retry duplicate, message ignored, rooftop spoof 403");
  });

  await test("autofilm (patched shape): VIN, external_ro_id, timestamps and approved/declined ids", async (note) => {
    const published = new Date(Date.now() - 60_000).toISOString();
    const pub = await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", `evt-${RUN}-ppub`,
      { ro_id: `ro-${RUN}-p`, ro_number: "RO-20001", vin: VIN2, external_ro_id: `DMS-${RUN}`, published_at: published, visibility: "shared" });
    eq((await ingestAf(CONN.A_AF, pub)).status, 202, "patched published");
    const dec = await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.customer.decisions.submitted", `evt-${RUN}-pdec`, {
      ro_id: `ro-${RUN}-p`, external_ro_id: `DMS-${RUN}`, vin: VIN2, decided_at: new Date().toISOString(),
      approved: 2, declined: 1, total: 640, authorization_id: `auth-${RUN}-p`,
      approved_ids: [`f-${RUN}-1`, `f-${RUN}-2`], declined_ids: [`f-${RUN}-3`],
    });
    eq((await ingestAf(CONN.A_AF, dec)).status, 202, "patched decisions");
    const rows = await sql`select event_type, source_record_id, source_version, vin, visibility, requested_visibility from public.integration_inbox
      where connection_id = ${CONN.A_AF} and envelope->>'correlation_id' in (${`af:evt-${RUN}-ppub`}, ${`af:evt-${RUN}-pdec`})
      order by event_type, source_record_id`;
    eq(rows.map((r) => r.event_type), [
      "autofilm.inspection.completed", "autofilm.repair.approved", "autofilm.repair.approved",
      "autofilm.repair.declined", "autofilm.repair_order.decisions_submitted",
    ], "events (summary + one per finding)");
    check(rows.every((r) => r.vin === VIN2), "payload VIN used");
    eq(rows[0].source_version, Date.parse(published), "published_at is the source version");
    eq([rows[0].visibility, rows[0].requested_visibility], ["custody_shared", "custody_shared"], "shared visibility");
    note(`${rows.length} inbox rows`);
  });

  await test("unmatched: an AutoFilm event with no VIN and an unknown RO is stored unmatched (202)", async () => {
    const r = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", `evt-${RUN}-um`,
      { ro_id: `ro-${RUN}-unknown`, ro_number: "RO-404" }));
    eq(r.status, 202, `unmatched ${r.text.slice(0, 200)}`);
    const rows = await sql`select status, vin from public.integration_inbox where connection_id = ${CONN.A_AF}
      and envelope->>'correlation_id' = ${`af:evt-${RUN}-um`}`;
    eq(rows.map((x) => [x.status, x.vin]), [["unmatched", null]], "stored row");
  });

  await test("apply (x-cron-secret): auth gate, then v2 before v1 leaves v2 applied and v1 superseded", async (note) => {
    const noSecret = await http(`${FN}/integration-apply`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    eq(noSecret.status, 401, `apply without x-cron-secret${gatewayHint(noSecret)}`);
    const wrong = await http(`${FN}/integration-apply`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json", "x-cron-secret": "wrong" } });
    eq(wrong.status, 401, "apply with a wrong x-cron-secret");
    const record = `stg-${RUN}-order`;
    for (const v of [2, 1]) {
      const e = envelope({ source_record_id: record, source_version: v, payload: { odometer_miles: 40000 + v, measurements: {}, technician_verified: false } });
      const b = JSON.stringify(e);
      eq((await ingestNative(b, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), b))).status, 202, `ingest v${v}`);
    }
    const totals = await applyUntilIdle();
    const rows = await inboxByRecord(record);
    eq(rows.map((r) => [r.source_version, r.status]), [[1, "superseded"], [2, "applied"]], "inbox statuses");
    const ev = await sql`select source_version, odometer_miles from public.inspection_evidence where source_record_id = ${record}`;
    eq(ev.map((r) => [r.source_version, r.odometer_miles]), [[2, 40002]], "evidence");
    eq(await watermark(CONN.A_NATIVE, record), 2, "watermark");
    note(`apply outcomes ${JSON.stringify(totals)}`);
  });

  await test("evidence classification: completed never becomes completed_verified; technician_verified defaults false; never customer_public", async (note) => {
    const send = async (over: Record<string, unknown>) => {
      const e = envelope(over);
      const b = JSON.stringify(e);
      const r = await ingestNative(b, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), b));
      eq(r.status, 202, `ingest ${String(over.event_type ?? "inspection")}`);
      return e.source_record_id;
    };
    const completed = await send({ event_type: "autofilm.repair.completed",
      payload: { finding_id: "f-c", item: "brake pads", severity: "red", verified_by: "tech-9", verified_evidence_ref: "film-evidence:9" } });
    const verifiedNoRef = await send({ event_type: "autofilm.repair.completed_verified", payload: { finding_id: "f-v0", item: "rotor" } });
    const correctedNoRef = await send({ event_type: "autofilm.repair.corrected", payload: { finding_id: "f-k", status: "completed_verified" } });
    const verified = await send({ event_type: "autofilm.repair.completed_verified",
      payload: { finding_id: "f-v1", item: "rotor", verified_by: "tech-9", verified_evidence_ref: "film-evidence:10" } });
    const techString = await send({ payload: { odometer_miles: 41000, measurements: {}, technician_verified: "true" } });
    const techTrue = await send({ payload: { odometer_miles: 41001, measurements: {}, technician_verified: true } });
    const publicAsk = await send({ visibility: "customer_public" });
    await applyUntilIdle();

    const repair = async (rec: string) => (await sql`select status, verified_by, verified_evidence_ref, visibility from public.repair_items where source_record_id = ${rec}`);
    const inbox = async (rec: string) => (await inboxByRecord(rec)).map((r) => [r.status, r.outcome_code]);
    eq((await repair(completed)).map((r) => [r.status, r.verified_by, r.verified_evidence_ref]), [["completed", null, null]], "completed stays completed");
    eq(await inbox(verifiedNoRef), [["rejected", "missing_verification_evidence"]], "completed_verified without evidence");
    eq((await repair(verifiedNoRef)).length, 0, "no repair row for an unproven completed_verified");
    eq(await inbox(correctedNoRef), [["rejected", "missing_verification_evidence"]], "corrected to completed_verified without evidence");
    eq((await repair(verified)).map((r) => [r.status, r.verified_evidence_ref]), [["completed_verified", "film-evidence:10"]], "verified with evidence");
    const tech = async (rec: string) => (await sql`select technician_verified from public.inspection_evidence where source_record_id = ${rec}`)[0]?.technician_verified;
    eq(await tech(techString), false, "technician_verified \"true\" (string)");
    eq(await tech(techTrue), true, "technician_verified true (boolean)");
    const afTech = await sql`select bool_or(technician_verified) v from public.inspection_evidence where source_app = 'autofilm'
      and source_record_id like 'inspection:%' and tenant_id = ${T.A}`;
    eq(afTech[0].v, false, "AutoFilm-adapted inspections are never technician_verified");
    const pub = await inboxByRecord(publicAsk);
    eq([pub[0].visibility, pub[0].requested_visibility, pub[0].status], ["tenant_private", "customer_public", "applied"], "public request");
    const leaks = await sql`select
      (select count(*)::int from public.inspection_evidence where visibility = 'customer_public') +
      (select count(*)::int from public.repair_items where visibility = 'customer_public') n`;
    eq(leaks[0].n, 0, "stored customer_public rows");
    note("completed, rejected x2, completed_verified with ref, technician_verified false/true, customer_public request stored tenant_private");
  });

  await test("race: 20 records x (v2, v3) under 2 concurrent apply workers end at v3 exactly once", async (note) => {
    const records = Array.from({ length: 20 }, (_, i) => `stg-${RUN}-race-${String(i).padStart(2, "0")}`);
    for (const record of records) {
      for (const v of [2, 3]) {
        const e = envelope({ source_record_id: record, source_version: v, payload: { odometer_miles: 50000 + v, measurements: {}, technician_verified: false } });
        const b = JSON.stringify(e);
        eq((await ingestNative(b, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), b))).status, 202, `ingest ${record} v${v}`);
      }
    }
    const worker = async () => {
      const outcomes: Record<string, number> = {};
      let calls = 0;
      for (let i = 0; i < 40; i++) {
        const r = await apply(5);
        calls++;
        check(r.status === 200, `apply ${r.status}`);
        const b = obj(r);
        for (const [k, v] of Object.entries((b.outcomes ?? {}) as Record<string, number>)) outcomes[k] = (outcomes[k] ?? 0) + v;
        if (Number(b.claimed ?? 0) === 0) break;
      }
      return { outcomes, calls };
    };
    const [w1, w2] = await Promise.all([worker(), worker()]);
    const rows = await sql`select source_record_id, source_version, status from public.integration_inbox
      where source_record_id in ${sql(records)} order by source_record_id, source_version`;
    eq(rows.length, 40, "inbox rows");
    for (const record of records) {
      const mine = rows.filter((r) => r.source_record_id === record);
      eq(mine.map((r) => r.status === "applied" || r.status === "superseded"), [true, true], `${record} statuses`);
      eq(mine[1].status, "applied", `${record} v3`);
    }
    const ev = await sql`select source_record_id, count(*)::int n, max(source_version) v, max(odometer_miles) o
      from public.inspection_evidence where source_record_id in ${sql(records)} group by 1`;
    eq(ev.length, 20, "one evidence row per record");
    check(ev.every((r) => r.n === 1 && r.v === 3 && r.o === 50003), "every evidence row is at v3");
    const wm = await sql`select count(*)::int n from public.integration_source_versions
      where connection_id = ${CONN.A_NATIVE} and source_record_id in ${sql(records)} and latest_version = 3`;
    eq(wm[0].n, 20, "watermarks at v3");
    note(`worker1 ${JSON.stringify(w1)} worker2 ${JSON.stringify(w2)}`);
  });

  await test("retry/backoff: an injected apply failure schedules a jittered 60s retry, then applies", async (note) => {
    const record = `stg-${RUN}-retry`;
    await sql.unsafe(`ALTER TABLE public.inspection_evidence DROP CONSTRAINT IF EXISTS rooftopos_staging_injected_failure`);
    await sql.unsafe(`ALTER TABLE public.inspection_evidence ADD CONSTRAINT rooftopos_staging_injected_failure
      CHECK (odometer_miles IS DISTINCT FROM 777) NOT VALID`);
    try {
      const e = envelope({ source_record_id: record, payload: { odometer_miles: 777, measurements: {}, technician_verified: false } });
      const b = JSON.stringify(e);
      eq((await ingestNative(b, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), b))).status, 202, "ingest");
      const first = await apply(100);
      eq(first.status, 200, "apply");
      const [row] = await inboxByRecord(record);
      eq([row.status, row.attempts, row.outcome_code], ["received", 1, "apply_error"], "after the failure");
      const delay = (Date.parse(String(row.next_attempt_at)) - Date.now()) / 1000;
      check(delay > 40 && delay <= 72, `retry delay ${delay.toFixed(1)}s is not 60s +/- 20%`);
      note(`retry scheduled in ${delay.toFixed(1)}s`);
    } finally {
      await sql.unsafe(`ALTER TABLE public.inspection_evidence DROP CONSTRAINT IF EXISTS rooftopos_staging_injected_failure`);
    }
    const [row] = await inboxByRecord(record);
    await readyNow([row.id as string]);
    await applyUntilIdle();
    const [after] = await inboxByRecord(record);
    eq([after.status, after.attempts], ["applied", 2], "after the retry (attempt 1 failed, attempt 2 applied)");
    const ev = await sql`select odometer_miles from public.inspection_evidence where source_record_id = ${record}`;
    eq(ev.map((r) => r.odometer_miles), [777], "evidence");
  });

  await test("dead-letter: a poison event is dead after 6 attempts and audited", async (note) => {
    const record = `stg-${RUN}-poison`;
    const e = envelope({ source_record_id: record, payload: { odometer_miles: 3_000_000_000, measurements: {}, technician_verified: false } });
    const b = JSON.stringify(e);
    eq((await ingestNative(b, await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), b))).status, 202, "ingest");
    let row = (await inboxByRecord(record))[0];
    for (let i = 0; i < 8 && row.status !== "dead"; i++) {
      await readyNow([row.id as string]);
      eq((await apply(100)).status, 200, "apply");
      row = (await inboxByRecord(record))[0];
    }
    eq([row.status, row.attempts, row.outcome_code], ["dead", 6, "apply_error"], "poison row");
    const audit = await sql`select action from public.audit_log where entity_id = ${row.id as string} and action = 'integration_event_dead'`;
    eq(audit.length, 1, "dead-letter audit entries");
    const again = await apply(100);
    eq(again.status, 200, "apply after dead");
    eq((await inboxByRecord(record))[0].attempts, 6, "dead row is never claimed again");
    note(`inbox ${row.id}`);
  });

  await test("dispatch to staging's own ingest: native accepted; x-af 422 unknown_event (signature verified)", async (note) => {
    check(DISPATCH_BASE.startsWith("https://"), "dispatch only delivers to https endpoints; STAGING_URL must be https");
    const ingestUrl = `${DISPATCH_BASE}/functions/v1/integration-ingest`;
    await sql`update public.integration_connections set endpoint_url = ${ingestUrl} where id = ${CONN.A_NATIVE}`;
    await sql`update public.integration_connections set endpoint_url = ${`${ingestUrl}?connection=${CONN.A_AF}`} where id = ${CONN.A_AF}`;
    const nativeEnv = envelope({ source_record_id: `stg-${RUN}-dispatch-native` });
    const afEnv = envelope({ source_record_id: `stg-${RUN}-dispatch-af` });
    const [nOut] = await sql`insert into public.integration_outbox (tenant_id, connection_id, event_id, event_type, envelope)
      values (${T.A}, ${CONN.A_NATIVE}, ${nativeEnv.event_id}, ${nativeEnv.event_type}, ${sql.json(nativeEnv as never)}) returning id`;
    const [aOut] = await sql`insert into public.integration_outbox (tenant_id, connection_id, event_id, event_type, envelope)
      values (${T.A}, ${CONN.A_AF}, ${afEnv.event_id}, ${afEnv.event_type}, ${sql.json(afEnv as never)}) returning id`;
    const noSecret = await http(`${FN}/integration-dispatch`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    eq(noSecret.status, 401, "dispatch without x-cron-secret");
    const r = await dispatch(25);
    eq(r.status, 200, `dispatch ${r.text.slice(0, 200)}${gatewayHint(r)}`);
    const out = await sql`select id, status, attempts, last_error_code from public.integration_outbox where id in (${nOut.id}, ${aOut.id})`;
    const byId = new Map(out.map((o) => [o.id, o]));
    eq([byId.get(nOut.id)?.status, byId.get(nOut.id)?.last_error_code], ["delivered", null], "native outbox row");
    eq([byId.get(aOut.id)?.status, byId.get(aOut.id)?.last_error_code], ["dead", "http_422"], "x-af outbox row (422 is permanent)");
    const landed = await inboxByRecord(nativeEnv.source_record_id);
    eq(landed.map((x) => [x.tenant_id, x.connection_id, x.status]), [[T.A, CONN.A_NATIVE, "received"]], "native delivery landed in the inbox");
    note(`dispatch outcomes ${JSON.stringify(obj(r).outcomes)}`);
  });

  await test("credential rotation: both keys verify during overlap; the revoked key is 401 afterwards", async (note) => {
    const k1 = `rooftopos-staging-rot-${RUN}-1`;
    const k2 = `rooftopos-staging-rot-${RUN}-2`;
    const kaf = `rooftopos-staging-rot-${RUN}-af`;
    for (const [k, conn] of [[k1, CONN.A_NATIVE], [k2, CONN.A_NATIVE], [kaf, CONN.A_AF]] as const) {
      await sql`select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), ${k}, 'RooftopOS staging rotation test key')`;
      await sql`insert into public.integration_connection_keys (connection_id, key_id, vault_secret_name) values (${conn}, ${k}, ${k})`;
    }
    const rows = await sql`select s.name, s.decrypted_secret from vault.decrypted_secrets s where s.name in (${k1}, ${k2}, ${kaf})`;
    for (const r of rows) secrets.set(r.name as string, r.decrypted_secret as string);
    const sendNative = async (k: string) => {
      const b = JSON.stringify(envelope());
      return (await ingestNative(b, await nativeHeaders(k, secret(k), b))).status;
    };
    const sendAf = async (k: string, tag: string) =>
      (await ingestAf(CONN.A_AF, await afRequest(secret(k), ROOFTOP.A, "mpi.report.published", `evt-${RUN}-rot-${tag}`, { ro_id: RO.A }))).status;
    try {
      eq([await sendNative(k1), await sendNative(k2)], [202, 202], "overlap: old and new native keys");
      await sql`update public.integration_connection_keys set status = 'retiring' where key_id = ${k1}`;
      eq(await sendNative(k1), 202, "retiring key still verifies");
      await sql`update public.integration_connection_keys set status = 'revoked', revoked_at = now() where key_id = ${k1}`;
      eq([await sendNative(k1), await sendNative(k2)], [401, 202], "after revoking the old native key");
      eq([await sendAf(KEY.A_AF, "old"), await sendAf(kaf, "new")], [202, 202], "overlap: old and new AutoFilm secrets");
      await sql`update public.integration_connection_keys set status = 'revoked', revoked_at = now() where key_id = ${kaf}`;
      eq([await sendAf(kaf, "new2"), await sendAf(KEY.A_AF, "old2")], [401, 202], "after revoking the added AutoFilm secret");
      note("native k1+k2 202, k1 retiring 202, k1 revoked 401; autofilm overlap 202/202, revoked 401");
    } finally {
      await sql`update public.integration_connection_keys set status = 'revoked', revoked_at = coalesce(revoked_at, now())
        where key_id in (${k1}, ${k2}, ${kaf})`;
    }
  });

  let tokenA = "", tokenB = "", tokenAdmin = "";
  await test("two-dealer isolation through PostgREST (anon key + each dealer's session)", async (note) => {
    const bEnv = envelope({ source_record_id: `stg-${RUN}-dealer-b` });
    const bBody = JSON.stringify(bEnv);
    eq((await ingestNative(bBody, await nativeHeaders(KEY.B_NATIVE, secret(KEY.B_NATIVE), bBody))).status, 202, "dealer B native event on the shared VIN");
    const bAf = await ingestAf(CONN.B_AF, await afRequest(secret(KEY.B_AF), ROOFTOP.B, "mpi.report.published", `evt-${RUN}-b`, { ro_id: RO.B }));
    eq(bAf.status, 202, "dealer B AutoFilm event");
    await applyUntilIdle();
    const shared = await sql`select e.tenant_id from public.inspection_evidence e join public.vehicle_instances i on i.id = e.instance_id
      where i.vin = ${VIN} group by e.tenant_id order by e.tenant_id`;
    eq(shared.map((r) => r.tenant_id), [T.A, T.B], "both dealers hold evidence on the shared VIN");
    tokenA = await signIn("dealerA");
    tokenB = await signIn("dealerB");
    for (const [label, token, mine, theirs] of [["A", tokenA, T.A, T.B], ["B", tokenB, T.B, T.A]] as const) {
      for (const table of SPINE_TABLES) {
        const r = await rest(table, token);
        if (!TENANT_READ.has(table)) {
          check(denied(r) || (r.status === 200 && Array.isArray(r.body) && r.body.length === 0),
            `dealer ${label} can read ${table} (${r.status})`);
          continue;
        }
        check(r.status === 200 && Array.isArray(r.body), `dealer ${label} ${table}: ${r.status} ${r.text.slice(0, 120)}`);
        const tenants = new Set((r.body as Array<{ tenant_id: string }>).map((x) => x.tenant_id));
        check(!tenants.has(theirs), `dealer ${label} sees dealer ${label === "A" ? "B" : "A"} rows in ${table}`);
        check([...tenants].every((t) => t === mine), `dealer ${label} sees foreign rows in ${table}`);
      }
      const inst = await rest("vehicle_instances", token, `select=tenant_id,vin&vin=eq.${VIN}`);
      eq((inst.body as Array<{ tenant_id: string }>).map((x) => x.tenant_id), [mine], `dealer ${label} instances of the shared VIN`);
      const forced = await rest("integration_inbox", token, `select=id&tenant_id=eq.${theirs}`);
      eq(forced.body, [], `dealer ${label} filtering on the other tenant`);
      const write = await http(`${STAGING_URL}/rest/v1/integration_direction_flags`, {
        method: "POST",
        headers: { ...restHeaders(token), "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ tenant_id: mine, direction: "labels_to_curb", enabled: true }),
      });
      check(denied(write), `dealer ${label} could write a direction flag (${write.status})`);
    }
    const counts: string[] = [];
    for (const [label, token] of [["A", tokenA], ["B", tokenB]] as const) {
      for (const table of ["integration_inbox", "inspection_evidence"]) {
        const r = await rest(table, token, "select=id");
        check(Array.isArray(r.body) && r.body.length > 0, `dealer ${label} sees its own ${table} rows`);
        counts.push(`${label}.${table}=${(r.body as unknown[]).length}`);
      }
    }
    note(`own rows ${counts.join(" ")}; no cross-tenant rows on 8 tables; 4 tables denied; writes denied`);
  });

  await test("no public exposure: the anon key reads nothing from the 12 spine tables and no view exposes them", async (note) => {
    const outcomes: string[] = [];
    for (const table of SPINE_TABLES) {
      const r = await rest(table);
      check(denied(r) || (r.status === 200 && Array.isArray(r.body) && r.body.length === 0), `anon read ${table}: ${r.status} ${r.text.slice(0, 120)}`);
      outcomes.push(`${table}:${r.status}`);
    }
    const root = await http(`${STAGING_URL}/rest/v1/`, { headers: restHeaders() });
    if (root.status === 200 && obj(root).paths) {
      const listed = Object.keys(obj(root).paths as Record<string, unknown>).map((p) => p.replace(/^\//, ""));
      const exposed = listed.filter((p) => SPINE_TABLES.includes(p));
      eq(exposed, [], "spine tables listed in the anon OpenAPI schema");
      note(`anon OpenAPI lists ${listed.length} paths, none spine`);
    } else {
      note(`anon OpenAPI root not readable (${root.status})`);
    }
    const views = await sql`select distinct v.oid::regclass::text as view, s.relname as spine_table
      from pg_depend d join pg_rewrite rw on rw.oid = d.objid and d.classid = 'pg_rewrite'::regclass
      join pg_class v on v.oid = rw.ev_class and v.relkind in ('v','m')
      join pg_class s on s.oid = d.refobjid join pg_namespace sn on sn.oid = s.relnamespace
      where sn.nspname = 'public' and s.relname in ${sql(SPINE_TABLES)} and v.oid <> s.oid`;
    eq(views.map((v) => `${v.view}->${v.spine_table}`), [], "views reading spine tables");
    note(outcomes.join(" "));
  });

  await test("health: no token 401, dealer 403, platform admin 200", async (note) => {
    tokenAdmin = await signIn("admin");
    const none = await http(`${FN}/integration-health`, { method: "GET" });
    eq(none.status, 401, `no token${gatewayHint(none)}`);
    const dealer = await http(`${FN}/integration-health`, { method: "GET", headers: { Authorization: `Bearer ${tokenA}`, apikey: ANON } });
    eq(dealer.status, 403, "dealer token");
    const admin = await http(`${FN}/integration-health`, { method: "GET", headers: { Authorization: `Bearer ${tokenAdmin}`, apikey: ANON } });
    eq(admin.status, 200, `admin token ${admin.text.slice(0, 200)}`);
    eq([obj(admin).ok, obj(admin).state], [true, "configured"], "admin snapshot");
    note(`admin snapshot keys: ${Object.keys(obj(admin)).join(",")}`);
  });
}

// ── run + report ─────────────────────────────────────────────────────
const started = new Date().toISOString();
try {
  if (phase === "phase1") await phase1();
  else await phase2();
} finally {
  await sql.end({ timeout: 5 });
}
const finished = new Date().toISOString();
const passed = results.filter((r) => r.ok).length;
const target = new URL(STAGING_URL).host;
const report = { phase, run: RUN, target, started, finished, passed, failed: results.length - passed, results };
await Deno.mkdir(OUT_DIR, { recursive: true });
const stem = `${OUT_DIR}/rooftopos-staging-${phase}-${RUN}`;
await Deno.writeTextFile(`${stem}.json`, JSON.stringify(report, null, 2));
const md = [
  `# RooftopOS staging ${phase}`,
  "",
  `Target ${target} · run ${RUN} · ${started} to ${finished}`,
  "",
  `**${passed}/${results.length} passed**`,
  "",
  "| Result | Test | ms | Detail |",
  "|---|---|---|---|",
  ...results.map((r) =>
    `| ${r.ok ? "PASS" : "FAIL"} | ${r.name.replace(/\|/g, "/")} | ${r.ms} | ${[...r.detail, r.error ?? ""].filter(Boolean).join("; ").replace(/\|/g, "/")} |`
  ),
  "",
].join("\n");
await Deno.writeTextFile(`${stem}.md`, md);
console.log(`\n${passed}/${results.length} passed. Results: ${stem}.json and ${stem}.md`);
Deno.exit(passed === results.length ? 0 : 1);
