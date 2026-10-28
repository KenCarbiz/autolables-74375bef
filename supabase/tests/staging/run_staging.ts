// RooftopOS staging runner (Deno). Drives the four deployed integration functions
// over real HTTP on a dedicated, synthetic-only staging project and records every
// result as JSON and markdown.
//
// ── What the staging project is ──────────────────────────────────────
// A brand-new, EMPTY Supabase / Lovable Cloud project (staging ref
// oaefdolxpmrexjqkzonw). Never a copy of AutoLabels, never a replay of its
// migration history (38 historic migrations call cron.schedule or net.http_post
// and some hard-code the production ref). Only the files below are applied.
//
// ── Exact order ──────────────────────────────────────────────────────
//  1. supabase/tests/staging/00_isolation_check.sql   read-only, must return PASS
//  2. supabase/tests/staging/01_dependencies.sql      migration
//  3. supabase/migrations/20261030000000_rooftopos_spine.sql   migration, unchanged
//  4. supabase/tests/staging/00_isolation_check.sql   read-only, must return PASS again
//     supabase/tests/staging/04_verify_schema.sql     read-only, must return PASS
//  5. supabase/tests/staging/02_seed_synthetic.sql    seed (separate migration/paste)
//  6. Deploy the four functions (file list below) with ROOFTOP_INTEGRATIONS_ENABLED
//     unset or "false"; run phase1 (see the two modes below). Expects 503 from
//     every function and no inbox writes.
//  7. Ken sets the edge-function secret ROOFTOP_INTEGRATIONS_ENABLED=true.
//  8. Run phase2 (everything else).
//  9. supabase/tests/staging/03_rollback.sql          migration; returns PASS
// 10. Verify: 00_isolation_check.sql must PASS (spine_present = false).
// 11. Re-apply: the spine migration, then 00 and 04 (both PASS), then 02.
//
// ── Two ways to give the runner database access ──────────────────────
// Every database-side action (reading seeded key secrets, setup and teardown,
// post-condition snapshots) lives in supabase/tests/staging/steps/*.sql. Each
// step returns ONE row with ONE json column named result. The runner itself only
// speaks HTTP to the staging project.
//
//  A. Step mode (no STAGING_DB_URL, e.g. Lovable Cloud's query_database tool):
//     run the runner; when it needs a step it stops (exit code 3) and names the
//     file. Run that file with query_database, save its returned JSON (the row,
//     the rows array, or just the result object) to <out>/steps/<step>.json, and
//     run the runner again with the same arguments. It resumes where it stopped;
//     progress is kept in <out>/state-<phase>.json. Phase 2 order:
//       p2_20_setup -> HTTP stage A -> p2_21_after_stage_a -> HTTP stage B
//       -> p2_22_after_stage_b -> HTTP stage C -> p2_23_final
//     Phase 1: p1_10_preflight -> kill-switch requests -> p1_11_postcheck.
//     To start a phase over: run again with --restart (old step files are moved
//     aside), then begin with its first step again (p2_20 wipes the synthetic
//     dealers' runtime rows). In step mode the runner cannot run 00/04 itself:
//     run them with query_database before phase 1 and phase 2.
//  B. Direct mode (STAGING_DB_URL set): the runner executes the same step files
//     itself in one pass (plus 00 and 04 as a preflight) and keeps no state file.
//
// ── Edge-function secrets (dashboard / Lovable Cloud secrets) ────────
//   ROOFTOP_INTEGRATIONS_ENABLED  unset/"false" for phase 1, "true" for phase 2
//   CRON_SHARED_SECRET            any long random value; also given to this runner
//                                 as STAGING_CRON_SECRET (sent as x-cron-secret)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by the platform
// All four functions must deploy with verify_jwt = false. The staging
// supabase/config.toml keeps its own project_id line and appends exactly:
//   [functions.integration-ingest]
//   verify_jwt = false
//
//   [functions.integration-apply]
//   verify_jwt = false
//
//   [functions.integration-dispatch]
//   verify_jwt = false
//
//   [functions.integration-health]
//   verify_jwt = false
// (Never copy this repo's config.toml there: its project_id is production.)
// The runner sends ingest requests with no auth header at all, as AutoFilm does,
// so a gateway 401 is reported as a verify_jwt problem.
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
// Remote imports: https://esm.sh/@supabase/supabase-js@2.45.4 (the four index.ts)
// and https://esm.sh/@supabase/supabase-js@2 (_shared/supabase.ts).
//
// ── Runner environment (nothing else is read) ────────────────────────
//   STAGING_URL          https://oaefdolxpmrexjqkzonw.supabase.co
//   STAGING_ANON_KEY     the staging anon / publishable key
//   STAGING_CRON_SECRET  same value as the CRON_SHARED_SECRET function secret
//   STAGING_DB_URL       optional; direct or SESSION-pooler Postgres URL (direct mode)
// Synthetic-user passwords come from step p2_20, which sets fresh random ones.
// Usage: deno run -A supabase/tests/staging/run_staging.ts phase1|phase2
//   [--out=<dir>] (default ./rooftopos-staging-results) [--restart]
//   [--dispatch-base=<https url>] LOCAL VALIDATION ONLY: in direct mode it overrides
//   the dispatch target base that p2_20 sets; in step mode it is the base the
//   p2_20 endpoints are expected to use (default STAGING_URL).
// The runner refuses to start if any URL or the anon key names a production
// project ref. It never prints a secret, password or token, and never writes one
// into its state or result files.

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
  ROT_OLD: "rooftopos-staging-rot-1",
  ROT_NEW: "rooftopos-staging-rot-2",
  ROT_AF: "rooftopos-staging-rot-af",
};
const OUTBOX = { NATIVE: "5ea90000-0000-4000-8000-00000000d001", AF: "5ea90000-0000-4000-8000-00000000d002" };
const ROOFTOP = { A: "rooftopos-staging-rooftop-a", B: "rooftopos-staging-rooftop-b" };
const RO = { A: "staging-ro-a-1", B: "staging-ro-b-1" };
const VIN = "1HGCM82633A004352";
const VIN2 = "1FTFW1E51PFA00017";
const USERS = {
  dealerA: "rooftopos-staging-dealer-a@example.test",
  dealerB: "rooftopos-staging-dealer-b@example.test",
  admin: "rooftopos-staging-admin@example.test",
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
const RACE = Array.from({ length: 20 }, (_, i) => `stg-race-${String(i).padStart(2, "0")}`);
const CLS = {
  completed: "stg-cls-completed", verifiedNoRef: "stg-cls-verified-noref", correctedNoRef: "stg-cls-corrected-noref",
  verified: "stg-cls-verified", techString: "stg-cls-tech-string", techTrue: "stg-cls-tech-true", publicAsk: "stg-cls-public",
};

// ── config ───────────────────────────────────────────────────────────
const args = Deno.args;
const phase = args.find((a) => a === "phase1" || a === "phase2") as "phase1" | "phase2" | undefined;
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const env = (name: string) => (Deno.env.get(name) ?? "").trim();

const STAGING_URL = env("STAGING_URL").replace(/\/+$/, "");
const ANON = env("STAGING_ANON_KEY");
const CRON = env("STAGING_CRON_SECRET");
const DB_URL = env("STAGING_DB_URL");
const DIRECT = DB_URL !== "";
const DISPATCH_OVERRIDE = flag("dispatch-base")?.replace(/\/+$/, "");
const DISPATCH_BASE = DISPATCH_OVERRIDE ?? STAGING_URL;
const OUT_DIR = flag("out") ?? "./rooftopos-staging-results";
const STEP_DIR = `${OUT_DIR}/steps`;
const FN = `${STAGING_URL}/functions/v1`;

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
if (!STAGING_URL || !ANON || (phase === "phase2" && !CRON)) {
  refuse("STAGING_URL and STAGING_ANON_KEY (and STAGING_CRON_SECRET for phase2) are required");
}
for (const [label, value] of [
  ["STAGING_URL", STAGING_URL], ["STAGING_DB_URL", DB_URL], ["--dispatch-base", DISPATCH_BASE],
  ["STAGING_ANON_KEY ref", jwtRef(ANON)],
] as const) {
  const hit = PROD_REFS.find((r) => value.toLowerCase().includes(r));
  if (hit) refuse(`${label} names production project ${hit}`);
}
if (!/^https?:\/\//.test(STAGING_URL)) refuse("STAGING_URL must be an http(s) URL");

const sql = DIRECT
  ? postgres(DB_URL, {
    max: 6,
    prepare: false,
    ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL) ? false : "require",
    onnotice: () => {},
    types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) } },
  })
  : null;

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

function envelope(record: string, over: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    event_id: crypto.randomUUID(),
    event_type: "autofilm.inspection.completed",
    schema_version: "1.0.0",
    producer: "autofilm",
    source_record_id: record,
    source_version: 1,
    idempotency_key: `${record}-${crypto.randomUUID()}`,
    correlation_id: "staging",
    causation_id: null,
    occurred_at: now,
    observed_at: now,
    sent_at: now,
    vin: VIN,
    tenant_ref: "ADVISORY",
    instance_ref: null,
    visibility: "tenant_private",
    evidence_refs: ["staging-evidence:1"],
    payload: { odometer_miles: 41250, measurements: { lf_tire_32nds: 7 }, technician_verified: false },
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
async function rest(table: string, token?: string, query = "select=*") {
  return await http(`${STAGING_URL}/rest/v1/${table}?${query}`, { headers: restHeaders(token) });
}
const denied = (r: Res) => r.status === 401 || r.status === 403 || /42501|permission denied/i.test(r.text);

// ── assertions, results, resumable state ─────────────────────────────
class Fail extends Error {}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Fail(msg);
}
const eq = (actual: unknown, expected: unknown, msg: string) =>
  check(JSON.stringify(actual) === JSON.stringify(expected), `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

interface Result { name: string; ok: boolean; ms: number; detail: string[]; error?: string }
interface State {
  phase: string;
  run: string;
  created_at: string;
  done: Record<string, string>;
  facts: Record<string, unknown>;
  results: Result[];
}
const STATE_FILE = `${OUT_DIR}/state-${phase}.json`;
const freshState = (): State => ({
  phase: phase!, run: crypto.randomUUID().slice(0, 8), created_at: new Date().toISOString(), done: {}, facts: {}, results: [],
});

async function loadState(): Promise<State> {
  if (DIRECT) return freshState();
  if (args.includes("--restart")) {
    try {
      const aside = `${STEP_DIR}/old-${Date.now()}`;
      for await (const e of Deno.readDir(STEP_DIR)) {
        if (e.isFile && e.name.startsWith(phase === "phase1" ? "p1_" : "p2_")) {
          await Deno.mkdir(aside, { recursive: true });
          await Deno.rename(`${STEP_DIR}/${e.name}`, `${aside}/${e.name}`);
        }
      }
    } catch { /* no step dir yet */ }
    await Deno.remove(STATE_FILE).catch(() => {});
    return freshState();
  }
  try {
    return JSON.parse(await Deno.readTextFile(STATE_FILE)) as State;
  } catch {
    return freshState();
  }
}
const state = await loadState();
const saveState = async () => {
  if (DIRECT) return;
  await Deno.mkdir(OUT_DIR, { recursive: true });
  await Deno.writeTextFile(STATE_FILE, JSON.stringify(state, null, 2));
};

async function test(name: string, fn: (note: (s: string) => void) => Promise<void>) {
  const detail: string[] = [];
  const t0 = performance.now();
  let result: Result;
  try {
    await fn((s) => detail.push(s));
    result = { name, ok: true, ms: Math.round(performance.now() - t0), detail };
    console.log(`PASS  ${name}`);
  } catch (e) {
    const error = e instanceof Fail ? e.message : `${(e as Error).name}: ${(e as Error).message}`;
    result = { name, ok: false, ms: Math.round(performance.now() - t0), detail, error };
    console.log(`FAIL  ${name}\n      ${error}`);
  }
  state.results = [...state.results.filter((r) => r.name !== name), result];
}

// ── step files (direct: executed here; step mode: read from <out>/steps) ─
type Json = Record<string, unknown>;
const steps: Record<string, Json> = {};

function unwrapStep(raw: unknown): Json | null {
  let v = raw;
  for (let i = 0; i < 4; i++) {
    if (Array.isArray(v)) v = v[0];
    else if (v && typeof v === "object" && "result" in (v as Json)) v = (v as Json).result;
    else if (v && typeof v === "object" && "rows" in (v as Json)) v = (v as Json).rows;
    else if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        return null;
      }
    } else break;
  }
  return v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;
}

async function runSqlFile(path: string) {
  const text = await Deno.readTextFile(new URL(path, import.meta.url));
  const out = await sql!.unsafe(text);
  const last = Array.isArray(out) && Array.isArray(out[out.length - 1]) ? out[out.length - 1] : out;
  return (last as unknown as Json[])[0] ?? {};
}

async function step(name: string, after: string | null) {
  if (DIRECT) {
    steps[name] = unwrapStep(await runSqlFile(`./steps/${name}.sql`)) ?? {};
    if (name === "p2_20_setup" && DISPATCH_OVERRIDE) {
      const ingest = `${DISPATCH_OVERRIDE}/functions/v1/integration-ingest`;
      await sql!`update public.integration_connections set endpoint_url = ${ingest} where id = ${CONN.A_NATIVE}`;
      await sql!`update public.integration_connections set endpoint_url = ${`${ingest}?connection=${CONN.A_AF}`} where id = ${CONN.A_AF}`;
      steps[name].endpoints = { [CONN.A_NATIVE]: ingest, [CONN.A_AF]: `${ingest}?connection=${CONN.A_AF}` };
    }
    return;
  }
  const file = `${STEP_DIR}/${name}.json`;
  let raw: string;
  try {
    raw = await Deno.readTextFile(file);
  } catch {
    await saveState();
    console.log(`\nWAITING FOR STEP ${name}`);
    console.log(`  1. Run supabase/tests/staging/steps/${name}.sql with query_database.`);
    console.log(`  2. Save the JSON it returns to ${file}`);
    console.log(`  3. Run this command again; the runner resumes here.`);
    Deno.exit(3);
  }
  const parsed = unwrapStep(JSON.parse(raw));
  if (!parsed || parsed.step !== name) refuse(`${file} is not the output of steps/${name}.sql`);
  const generated = Date.parse(String(parsed.generated_at));
  const floor = after && state.done[after] ? Date.parse(state.done[after]) - 300_000 : Date.parse(state.created_at) - 6 * 3600_000;
  if (!(generated >= floor)) {
    refuse(`${file} was generated at ${parsed.generated_at}, before the stage it must follow; re-run the step and save it again`);
  }
  steps[name] = parsed;
}

async function stage(name: string, fn: () => Promise<void>) {
  if (state.done[name]) return;
  await fn();
  state.done[name] = new Date().toISOString();
  await saveState();
}

const S = (name: string) => steps[name] ?? {};
const secret = (keyId: string) => {
  const map = (S("p2_20_setup").secrets ?? S("p1_10_preflight").secrets ?? {}) as Record<string, string>;
  const s = map[keyId];
  if (!s) throw new Fail(`no secret for ${keyId} in the step output; was 02_seed_synthetic.sql applied?`);
  return s;
};
type Row = Record<string, unknown>;
const rowsOf = (stepName: string, key: string) => (S(stepName)[key] ?? []) as Row[];
const pick = (rows: Row[], keys: string[]) => rows.map((r) => keys.map((k) => r[k]));

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

async function signIn(email: string): Promise<string> {
  const password = ((S("p2_20_setup").passwords ?? {}) as Record<string, string>)[email];
  check(password, `no password for ${email} in p2_20_setup output`);
  const r = await http(`${STAGING_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  check(r.status === 200 && typeof obj(r).access_token === "string", `sign-in for ${email} failed with ${r.status}`);
  return obj(r).access_token as string;
}

const sendNative = async (keyId: string, env1: ReturnType<typeof envelope>) => {
  const b = JSON.stringify(env1);
  return await ingestNative(b, await nativeHeaders(keyId, secret(keyId), b));
};

// ── phase 1: kill switch off ─────────────────────────────────────────
async function phase1() {
  if (DIRECT) await directPreflight(false);
  await step("p1_10_preflight", null);
  await test("preflight: synthetic seed present and keys available", async (note) => {
    for (const k of [KEY.A_NATIVE, KEY.A_AF, KEY.A_PAUSED, KEY.B_NATIVE, KEY.B_AF]) secret(k);
    note(`tenants ${JSON.stringify(S("p1_10_preflight").tenants)}, inbox rows ${S("p1_10_preflight").inbox_count}`);
  });
  await stage("kill_switch", async () => {
    await test("kill switch off: all four functions answer 503", async (note) => {
      const n = await sendNative(KEY.A_NATIVE, envelope("stg-killswitch"));
      eq(n.status, 503, `ingest (native) ${gatewayHint(n)}`);
      eq(obj(n).error, "integrations_disabled", "ingest error code");
      const af = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", "stg-evt-ks", { ro_id: RO.A }));
      eq(af.status, 503, `ingest (autofilm) ${gatewayHint(af)}`);
      const ap = await http(`${FN}/integration-apply`, { method: "POST", body: "{}", headers: cronHeaders() });
      eq(ap.status, 503, `apply ${gatewayHint(ap)}`);
      const dp = await http(`${FN}/integration-dispatch`, { method: "POST", body: "{}", headers: cronHeaders() });
      eq(dp.status, 503, `dispatch ${gatewayHint(dp)}`);
      const hp = await http(`${FN}/integration-health`, { method: "GET", headers: { Authorization: `Bearer ${ANON}`, apikey: ANON } });
      eq(hp.status, 503, `health ${gatewayHint(hp)}`);
      note("ingest(native), ingest(autofilm), apply, dispatch, health: 503 integrations_disabled");
    });
  });
  await step("p1_11_postcheck", "kill_switch");
  await test("kill switch off: nothing was written to the inbox", () => {
    eq(S("p1_11_postcheck").inbox_count, S("p1_10_preflight").inbox_count, "inbox rows before vs after");
    return Promise.resolve();
  });
}

async function directPreflight(spine: boolean) {
  await test("preflight (direct mode): 00_isolation_check.sql and 04_verify_schema.sql pass", async (note) => {
    const iso = await runSqlFile("./00_isolation_check.sql");
    eq(iso.isolation_check, "PASS", "isolation check");
    if (spine) {
      eq(iso.spine_present, true, "spine present");
      const ver = await runSqlFile("./04_verify_schema.sql");
      check(Object.keys(ver).length > 0, "04_verify_schema.sql returned nothing");
    }
    note(`database=${iso.database}`);
  });
}

// ── phase 2 ──────────────────────────────────────────────────────────
async function phase2() {
  if (DIRECT) await directPreflight(true);
  await step("p2_20_setup", null);
  await test("setup: keys, passwords and dispatch endpoints present", () => {
    for (const k of Object.values(KEY)) secret(k);
    const pw = (S("p2_20_setup").passwords ?? {}) as Record<string, string>;
    eq(Object.keys(pw).sort(), Object.values(USERS).slice().sort(), "synthetic users with fresh passwords");
    const ep = (S("p2_20_setup").endpoints ?? {}) as Record<string, string>;
    const ingest = `${DISPATCH_BASE}/functions/v1/integration-ingest`;
    eq([ep[CONN.A_NATIVE], ep[CONN.A_AF]], [ingest, `${ingest}?connection=${CONN.A_AF}`], "dispatch endpoints point at this project's ingest");
    eq(S("p2_20_setup").inbox_count, 0, "inbox rows after the reset");
    return Promise.resolve();
  });
  if (state.results.some((r) => !r.ok)) return;

  await stage("stage_a", stageA);
  await step("p2_21_after_stage_a", "stage_a");
  await checksA();
  await stage("stage_b", stageB);
  await step("p2_22_after_stage_b", "stage_b");
  await checksB();
  await stage("stage_c", stageC);
  await step("p2_23_final", "stage_c");
  await checksC();
}

async function stageA() {
  await test("A1 native: a valid signed event is accepted (202)", async () => {
    const r = await sendNative(KEY.A_NATIVE, envelope("stg-native-1"));
    if (r.status === 503) throw new Fail("503 integrations_disabled: set ROOFTOP_INTEGRATIONS_ENABLED=true before phase2");
    eq(r.status, 202, `ingest ${r.text.slice(0, 200)}${gatewayHint(r)}`);
  });

  await test("A2 native: bad signature, stale/future timestamp, unknown key and paused connection are 401", async (note) => {
    const body = JSON.stringify(envelope("stg-rejected"));
    const now = Math.floor(Date.now() / 1000);
    const cases: Array<[string, Record<string, string>]> = [
      ["bad signature", await nativeHeaders(KEY.A_NATIVE, "not-the-secret", body)],
      ["stale timestamp", await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), body, now - 3600)],
      ["future timestamp", await nativeHeaders(KEY.A_NATIVE, secret(KEY.A_NATIVE), body, now + 3600)],
      ["unknown key", await nativeHeaders("rooftopos-staging-unknown", secret(KEY.A_NATIVE), body)],
      ["paused connection", await nativeHeaders(KEY.A_PAUSED, secret(KEY.A_PAUSED), body)],
    ];
    for (const [label, headers] of cases) {
      const r = await ingestNative(body, headers);
      eq([r.status, obj(r).error], [401, "signature_invalid"], label);
    }
    const bad = await ingestAf(CONN.A_AF, await afRequest("not-the-secret", ROOFTOP.A, "mpi.report.published", "stg-evt-bad", { ro_id: RO.A }));
    eq(bad.status, 401, "autofilm bad signature");
    note(cases.map((c) => c[0]).join(", ") + ", autofilm bad signature: 401");
  });

  await test("A3 native: duplicate event_id is 200 duplicate; same idempotency key, changed payload is 409", async () => {
    const e = envelope("stg-dup");
    eq((await sendNative(KEY.A_NATIVE, e)).status, 202, "first");
    const again = await sendNative(KEY.A_NATIVE, e);
    eq([again.status, obj(again).status], [200, "duplicate"], "replay");
    const changed = { ...e, event_id: crypto.randomUUID(), payload: { ...e.payload, odometer_miles: 1 } };
    eq((await sendNative(KEY.A_NATIVE, changed)).status, 409, "changed payload under the same idempotency key");
  });

  await test("A4 native: tenant spoof in the body is advisory (202); producer spoof is 403", async () => {
    eq((await sendNative(KEY.A_NATIVE, envelope("stg-spoof", { tenant_ref: T.B }))).status, 202, "tenant_ref names dealer B");
    const p = await sendNative(KEY.A_NATIVE, envelope("stg-spoof-producer", { event_type: "autocurb.valuation.updated", producer: "autocurb", tenant_ref: T.B }));
    eq(p.status, 403, "producer not bound to the connection");
  });

  await test("A5 autofilm (live shape): published 202, decisions 202, retry duplicate, message ignored, rooftop spoof 403", async () => {
    const pub = () => afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", "stg-evt-pub", { ro_id: RO.A, ro_number: "RO-10442" });
    const r1 = await ingestAf(CONN.A_AF, await pub());
    eq(r1.status, 202, `published ${r1.text.slice(0, 200)}${gatewayHint(r1)}`);
    const r2 = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.customer.decisions.submitted", "stg-evt-dec",
      { ro_id: RO.A, external_ro_id: "DMS-5521", approved: 2, declined: 1, total: 1180.5, authorization_id: "auth-stg" }));
    eq(r2.status, 202, `decisions ${r2.text.slice(0, 200)}`);
    const replay = await ingestAf(CONN.A_AF, await pub());
    eq([replay.status, obj(replay).status], [200, "duplicate"], "AutoFilm retry of the same event_id");
    const msg = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.customer.message.created", "stg-evt-msg", { ro_id: RO.A }));
    eq([msg.status, obj(msg).status], [200, "ignored"], "message.created");
    const spoof = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.B, "mpi.report.published", "stg-evt-spoof", { ro_id: RO.B }));
    eq(spoof.status, 403, "A's secret claiming B's rooftop");
  });

  await test("A6 autofilm (patched shape): VIN, external_ro_id, timestamps, approved/declined ids (202)", async () => {
    const published = new Date(Date.now() - 60_000).toISOString();
    state.facts.patched_published_ms = Date.parse(published);
    eq((await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", "stg-evt-ppub",
      { ro_id: "stg-ro-p", ro_number: "RO-20001", vin: VIN2, external_ro_id: "DMS-STG", published_at: published, visibility: "shared" }))).status,
      202, "patched published");
    eq((await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.customer.decisions.submitted", "stg-evt-pdec", {
      ro_id: "stg-ro-p", external_ro_id: "DMS-STG", vin: VIN2, decided_at: new Date().toISOString(),
      approved: 2, declined: 1, total: 640, authorization_id: "auth-stg-p",
      approved_ids: ["f-stg-1", "f-stg-2"], declined_ids: ["f-stg-3"],
    }))).status, 202, "patched decisions");
  });

  await test("A7 unmatched: AutoFilm event with no VIN and an unknown RO is accepted (202)", async () => {
    const r = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", "stg-evt-um",
      { ro_id: "stg-ro-unknown", ro_number: "RO-404" }));
    eq(r.status, 202, `unmatched ${r.text.slice(0, 200)}`);
  });

  await test("A8 rotation overlap: retiring old key and active new key both verify (native and AutoFilm)", async () => {
    eq([(await sendNative(KEY.ROT_OLD, envelope("stg-rot-k1-a"))).status, (await sendNative(KEY.ROT_NEW, envelope("stg-rot-k2-a"))).status],
      [202, 202], "native old (retiring) and new keys");
    const old = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", "stg-evt-rot-old", { ro_id: RO.A }));
    const neu = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.ROT_AF), ROOFTOP.A, "mpi.report.published", "stg-evt-rot-new", { ro_id: RO.A }));
    eq([old.status, neu.status], [202, 202], "AutoFilm old and added secrets");
  });

  await test("A9 apply: x-cron-secret gate; ordering and classification events applied by one worker", async (note) => {
    const noSecret = await http(`${FN}/integration-apply`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    eq(noSecret.status, 401, `apply without x-cron-secret${gatewayHint(noSecret)}`);
    const wrong = await http(`${FN}/integration-apply`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json", "x-cron-secret": "wrong" } });
    eq(wrong.status, 401, "apply with a wrong x-cron-secret");
    for (const v of [2, 1]) {
      eq((await sendNative(KEY.A_NATIVE, envelope("stg-order", { source_version: v, payload: { odometer_miles: 40000 + v, measurements: {}, technician_verified: false } }))).status, 202, `order v${v}`);
    }
    const sends: Array<[string, Record<string, unknown>]> = [
      [CLS.completed, { event_type: "autofilm.repair.completed",
        payload: { finding_id: "f-c", item: "brake pads", severity: "red", verified_by: "tech-9", verified_evidence_ref: "film-evidence:9" } }],
      [CLS.verifiedNoRef, { event_type: "autofilm.repair.completed_verified", payload: { finding_id: "f-v0", item: "rotor" } }],
      [CLS.correctedNoRef, { event_type: "autofilm.repair.corrected", payload: { finding_id: "f-k", status: "completed_verified" } }],
      [CLS.verified, { event_type: "autofilm.repair.completed_verified",
        payload: { finding_id: "f-v1", item: "rotor", verified_by: "tech-9", verified_evidence_ref: "film-evidence:10" } }],
      [CLS.techString, { payload: { odometer_miles: 41000, measurements: {}, technician_verified: "true" } }],
      [CLS.techTrue, { payload: { odometer_miles: 41001, measurements: {}, technician_verified: true } }],
      [CLS.publicAsk, { visibility: "customer_public" }],
    ];
    for (const [record, over] of sends) eq((await sendNative(KEY.A_NATIVE, envelope(record, over))).status, 202, `ingest ${record}`);
    note(`apply outcomes ${JSON.stringify(await applyUntilIdle())}`);
  });

  await test("A10 race: 20 records x (v2, v3) ingested, then 2 concurrent apply workers", async (note) => {
    for (const record of RACE) {
      for (const v of [2, 3]) {
        eq((await sendNative(KEY.A_NATIVE, envelope(record, { source_version: v, payload: { odometer_miles: 50000 + v, measurements: {}, technician_verified: false } }))).status, 202, `${record} v${v}`);
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
    const bad = Object.keys({ ...w1.outcomes, ...w2.outcomes }).filter((k) => k !== "applied" && k !== "superseded");
    eq(bad, [], "outcomes other than applied/superseded");
    note(`worker1 ${JSON.stringify(w1)} worker2 ${JSON.stringify(w2)}`);
  });
}

async function checksA() {
  const pending: Promise<void>[] = [];
  const st = "p2_21_after_stage_a";
  const inbox = rowsOf(st, "inbox");
  const of = (record: string) => inbox.filter((r) => r.record === record);
  const af = rowsOf(st, "af");
  const afOf = (corr: string) => af.filter((r) => r.corr === corr);
  const evidence = rowsOf(st, "evidence");
  const evOf = (record: string) => evidence.filter((r) => r.record === record);
  const repair = rowsOf(st, "repair");
  const repOf = (record: string) => repair.filter((r) => r.record === record);
  const wm = (S(st).watermarks ?? {}) as Record<string, number>;
  const sync = (name: string, fn: (note: (s: string) => void) => void) => pending.push(test(name, (note) => Promise.resolve(fn(note))));

  sync("A1 stored: the accepted event is in dealer A's inbox, private, native adapter", () => {
    eq(pick(of("stg-native-1"), ["tenant", "connection", "status", "visibility", "adapter"]),
      [[T.A, CONN.A_NATIVE, "applied", "tenant_private", "rooftop.v1"]], "row");
  });
  sync("A2 stored: rejected requests wrote nothing", () => {
    eq(of("stg-rejected").length + afOf("af:stg-evt-bad").length, 0, "rows from 401 requests");
  });
  sync("A3 stored: the duplicate and the 409 left exactly one row", () => eq(of("stg-dup").length, 1, "rows"));
  sync("A4 stored: the spoofed event belongs to dealer A; dealer B's inbox is empty", () => {
    eq(pick(of("stg-spoof"), ["tenant"]), [[T.A]], "stored tenant");
    eq(of("stg-spoof-producer").length, 0, "producer spoof rows");
    eq(S(st).b_inbox_count, 0, "dealer B inbox rows");
  });
  sync("A5 stored: live-shape rows resolved to the RO's VIN; message and rooftop spoof not stored", () => {
    eq(pick([...afOf("af:stg-evt-pub"), ...afOf("af:stg-evt-dec")], ["event_type", "vin", "adapter", "tenant"]), [
      ["autofilm.inspection.completed", VIN, "autofilm.v1", T.A],
      ["autofilm.repair_order.decisions_submitted", VIN, "autofilm.v1", T.A],
    ], "rows");
    eq(afOf("af:stg-evt-msg").length + afOf("af:stg-evt-spoof").length, 0, "message/spoof rows");
  });
  sync("A6 stored: patched shape gives summary + one row per finding, payload VIN, published_at version, shared", () => {
    const rows = [...afOf("af:stg-evt-ppub"), ...afOf("af:stg-evt-pdec")];
    eq(rows.map((r) => r.event_type).sort(), [
      "autofilm.inspection.completed", "autofilm.repair.approved", "autofilm.repair.approved",
      "autofilm.repair.declined", "autofilm.repair_order.decisions_submitted",
    ], "events");
    check(rows.every((r) => r.vin === VIN2), "payload VIN used");
    const p = afOf("af:stg-evt-ppub")[0];
    eq(p.version, state.facts.patched_published_ms, "published_at is the source version");
    eq([p.visibility, p.requested], ["custody_shared", "custody_shared"], "shared visibility");
  });
  sync("A7 stored: the unmatched event is kept as unmatched with no VIN", () => {
    eq(pick(afOf("af:stg-evt-um"), ["status", "vin"]), [["unmatched", null]], "row");
  });
  sync("A8 stored: both overlapping keys' events were stored", () => {
    eq([of("stg-rot-k1-a").length, of("stg-rot-k2-a").length, afOf("af:stg-evt-rot-old").length, afOf("af:stg-evt-rot-new").length],
      [1, 1, 1, 1], "rows");
  });
  sync("A9 ordering: v2 before v1 leaves v2 applied, v1 superseded, watermark 2", () => {
    eq(pick(of("stg-order"), ["version", "status"]), [[1, "superseded"], [2, "applied"]], "inbox");
    eq(pick(evOf("stg-order"), ["version", "odometer"]), [[2, 40002]], "evidence");
    eq(wm["stg-order"], 2, "watermark");
  });
  sync("A9 evidence classification: completed never verified; technician_verified false unless true; never customer_public", (note) => {
    eq(pick(repOf(CLS.completed), ["status", "verified_by", "verified_evidence_ref"]), [["completed", null, null]], "completed stays completed");
    eq(pick(of(CLS.verifiedNoRef), ["status", "outcome"]), [["rejected", "missing_verification_evidence"]], "completed_verified without evidence");
    eq(repOf(CLS.verifiedNoRef).length, 0, "no repair row for unproven completed_verified");
    eq(pick(of(CLS.correctedNoRef), ["status", "outcome"]), [["rejected", "missing_verification_evidence"]], "corrected to completed_verified without evidence");
    eq(pick(repOf(CLS.verified), ["status", "verified_evidence_ref"]), [["completed_verified", "film-evidence:10"]], "verified with evidence");
    eq(pick(evOf(CLS.techString), ["technician_verified"]), [[false]], "technician_verified \"true\" (string)");
    eq(pick(evOf(CLS.techTrue), ["technician_verified"]), [[true]], "technician_verified true (boolean)");
    const afEvidence = evidence.filter((r) => String(r.record).startsWith("inspection:"));
    check(afEvidence.length > 0 && afEvidence.every((r) => r.technician_verified === false), "AutoFilm-adapted inspections are never technician_verified");
    eq(pick(of(CLS.publicAsk), ["visibility", "requested", "status"]), [["tenant_private", "customer_public", "applied"]], "public request");
    eq(S(st).stored_customer_public, 0, "stored customer_public rows");
    note(`${afEvidence.length} AutoFilm inspection rows, all technician_verified=false`);
  });
  sync("A10 race: every record ends at v3 exactly once", () => {
    for (const record of RACE) {
      const rows = of(record);
      eq(rows.length, 2, `${record} inbox rows`);
      check(rows.every((r) => r.status === "applied" || r.status === "superseded"), `${record} statuses ${JSON.stringify(pick(rows, ["version", "status"]))}`);
      eq(rows[1].status, "applied", `${record} v3`);
      eq(pick(evOf(record), ["version", "odometer"]), [[3, 50003]], `${record} evidence`);
      eq(wm[record], 3, `${record} watermark`);
    }
  });
  await Promise.all(pending);
}

async function stageB() {
  await test("B1 rotation after revoke: old native key and added AutoFilm secret are 401; the others still verify", async () => {
    eq([(await sendNative(KEY.ROT_OLD, envelope("stg-rot-k1-b"))).status, (await sendNative(KEY.ROT_NEW, envelope("stg-rot-k2-b"))).status],
      [401, 202], "native revoked old / active new");
    const neu = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.ROT_AF), ROOFTOP.A, "mpi.report.published", "stg-evt-rot-new2", { ro_id: RO.A }));
    const old = await ingestAf(CONN.A_AF, await afRequest(secret(KEY.A_AF), ROOFTOP.A, "mpi.report.published", "stg-evt-rot-old2", { ro_id: RO.A }));
    eq([neu.status, old.status], [401, 202], "AutoFilm revoked added / original");
  });

  await test("B2 retry, poison, dealer B traffic, dispatch to own ingest, then apply", async (note) => {
    eq((await sendNative(KEY.A_NATIVE, envelope("stg-retry", { payload: { odometer_miles: 777, measurements: {}, technician_verified: false } }))).status, 202, "retry event");
    eq((await sendNative(KEY.A_NATIVE, envelope("stg-poison", { payload: { odometer_miles: 3_000_000_000, measurements: {}, technician_verified: false } }))).status, 202, "poison event");
    eq((await sendNative(KEY.B_NATIVE, envelope("stg-dealer-b"))).status, 202, "dealer B native event on the shared VIN");
    eq((await ingestAf(CONN.B_AF, await afRequest(secret(KEY.B_AF), ROOFTOP.B, "mpi.report.published", "stg-evt-b", { ro_id: RO.B }))).status, 202, "dealer B AutoFilm event");
    const noSecret = await http(`${FN}/integration-dispatch`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    eq(noSecret.status, 401, `dispatch without x-cron-secret${gatewayHint(noSecret)}`);
    const d = await dispatch(25);
    eq(d.status, 200, `dispatch ${d.text.slice(0, 200)}${gatewayHint(d)}`);
    eq(Object.entries((obj(d).outcomes ?? {}) as Record<string, number>).sort(), [["dead", 1], ["delivered", 1]], "dispatch outcomes");
    state.facts.stage_b_apply_ms = Date.now();
    note(`dispatch ${JSON.stringify(obj(d).outcomes)}; apply ${JSON.stringify(await applyUntilIdle())}`);
  });

  let tokenA = "", tokenB = "";
  await test("B3 two-dealer isolation through PostgREST (anon key + each dealer's session)", async (note) => {
    tokenA = await signIn(USERS.dealerA);
    tokenB = await signIn(USERS.dealerB);
    const counts: string[] = [];
    for (const [label, token, mine, theirs] of [["A", tokenA, T.A, T.B], ["B", tokenB, T.B, T.A]] as const) {
      for (const table of SPINE_TABLES) {
        const r = await rest(table, token);
        if (!TENANT_READ.has(table)) {
          check(denied(r) || (r.status === 200 && Array.isArray(r.body) && r.body.length === 0), `dealer ${label} can read ${table} (${r.status})`);
          continue;
        }
        check(r.status === 200 && Array.isArray(r.body), `dealer ${label} ${table}: ${r.status} ${r.text.slice(0, 120)}`);
        const tenants = new Set((r.body as Array<{ tenant_id: string }>).map((x) => x.tenant_id));
        check([...tenants].every((t) => t === mine), `dealer ${label} sees foreign rows in ${table}`);
        if (table === "integration_inbox" || table === "inspection_evidence") {
          check((r.body as unknown[]).length > 0, `dealer ${label} sees no own ${table} rows`);
          counts.push(`${label}.${table}=${(r.body as unknown[]).length}`);
        }
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
    note(`own rows ${counts.join(" ")}; no cross-tenant rows on 8 tables; 4 tables denied; writes denied`);
  });

  await test("B4 no public exposure: the anon key reads nothing from the 12 spine tables", async (note) => {
    const outcomes: string[] = [];
    for (const table of SPINE_TABLES) {
      const r = await rest(table);
      check(denied(r) || (r.status === 200 && Array.isArray(r.body) && r.body.length === 0), `anon read ${table}: ${r.status} ${r.text.slice(0, 120)}`);
      outcomes.push(`${table}:${r.status}`);
    }
    const root = await http(`${STAGING_URL}/rest/v1/`, { headers: restHeaders() });
    if (root.status === 200 && obj(root).paths) {
      const listed = Object.keys(obj(root).paths as Record<string, unknown>).map((p) => p.replace(/^\//, ""));
      eq(listed.filter((p) => SPINE_TABLES.includes(p)), [], "spine tables listed in the anon OpenAPI schema");
      outcomes.push(`openapi:${listed.length} paths, none spine`);
    } else {
      outcomes.push(`openapi:${root.status}`);
    }
    note(outcomes.join(" "));
  });

  await test("B5 health: no token 401, dealer 403, platform admin 200", async (note) => {
    const tokenAdmin = await signIn(USERS.admin);
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

async function checksB() {
  const pending: Promise<void>[] = [];
  const st = "p2_22_after_stage_b";
  const sync = (name: string, fn: (note: (s: string) => void) => void) => pending.push(test(name, (note) => Promise.resolve(fn(note))));
  const rp = rowsOf(st, "retry_poison");
  const rot = rowsOf(st, "rotation").map((r) => r.record);
  sync("B1 stored: nothing from the revoked keys; the active keys' events were stored", () => {
    eq([rot.includes("stg-rot-k1-b"), rot.includes("stg-rot-k2-b")], [false, true], "native rows");
    const corr = (S(st).af_corr ?? []) as string[];
    eq([corr.includes("af:stg-evt-rot-new2"), corr.includes("af:stg-evt-rot-old2")], [false, true], "AutoFilm rows");
  });
  sync("B2 retry/backoff: the injected failure scheduled a jittered 60s retry", (note) => {
    const retry = rp.find((r) => r.record === "stg-retry");
    eq([retry?.status, retry?.attempts, retry?.outcome], ["received", 1, "apply_error"], "retry row after the failure");
    const delay = Number(retry?.next_attempt_epoch) - Number(state.facts.stage_b_apply_ms) / 1000;
    check(delay > 40 && delay <= 80, `retry delay ${delay.toFixed(1)}s is not 60s +/- 20% (allowing for clock skew)`);
    note(`retry scheduled ${delay.toFixed(1)}s after the apply call`);
  });
  sync("B2 poison: first failure recorded", () => {
    const poison = rp.find((r) => r.record === "stg-poison");
    eq([poison?.status, poison?.attempts, poison?.outcome], ["received", 1, "apply_error"], "poison row");
  });
  sync("B2 dispatch: native delivered into its own ingest; x-af dead with 422 (signature verified, event unknown)", () => {
    const out = rowsOf(st, "outbox");
    const by = (id: string) => out.find((o) => o.event_id === id);
    eq([by(OUTBOX.NATIVE)?.status, by(OUTBOX.NATIVE)?.last_error_code], ["delivered", null], "native outbox row");
    eq([by(OUTBOX.AF)?.status, by(OUTBOX.AF)?.last_error_code], ["dead", "http_422"], "x-af outbox row");
    const landed = rowsOf(st, "dispatched");
    eq(pick(landed, ["tenant", "connection"]), [[T.A, CONN.A_NATIVE]], "delivered event landed in dealer A's inbox");
  });
  sync("B3 database: both dealers hold evidence on the shared VIN; no view reads a spine table; nothing stored customer_public", () => {
    eq(((S(st).shared_vin_tenants ?? []) as string[]).slice().sort(), [T.A, T.B], "tenants with evidence on the shared VIN");
    eq(S(st).views_over_spine, [], "views reading spine tables");
    eq(S(st).stored_customer_public, 0, "stored customer_public rows");
    eq([S(st).retry_ready, S(st).poison_ready, S(st).constraint_dropped], [1, 1, true], "stage C preparation");
  });
  await Promise.all(pending);
}

async function stageC() {
  await test("C1 apply after the injected failure is removed (retry) and on the poison's 6th attempt", async (note) => {
    const first = await applyUntilIdle();
    const again = await apply(100);
    eq(again.status, 200, "apply after dead");
    note(`apply ${JSON.stringify(first)}; follow-up claimed ${obj(again).claimed}`);
  });
}

async function checksC() {
  const pending: Promise<void>[] = [];
  const st = "p2_23_final";
  const sync = (name: string, fn: () => void) => pending.push(test(name, () => Promise.resolve(fn())));
  const rp = rowsOf(st, "retry_poison");
  sync("C1 retry: applied on attempt 2 with the original payload", () => {
    const retry = rp.find((r) => r.record === "stg-retry");
    eq([retry?.status, retry?.attempts], ["applied", 2], "retry row (attempt 1 failed, attempt 2 applied)");
    eq(S(st).retry_evidence, [777], "evidence");
  });
  sync("C1 dead-letter: the poison is dead after 6 attempts, audited, never claimed again", () => {
    const poison = rp.find((r) => r.record === "stg-poison");
    eq([poison?.status, poison?.attempts, poison?.outcome], ["dead", 6, "apply_error"], "poison row");
    eq(S(st).poison_dead_audits, 1, "dead-letter audit entries");
  });
  sync("C2 final: nothing stored customer_public; rotation keys cleaned up", () => {
    eq(S(st).stored_customer_public, 0, "stored customer_public rows");
  });
  await Promise.all(pending);
}

// ── run + report ─────────────────────────────────────────────────────
const started = new Date().toISOString();
try {
  if (phase === "phase1") await phase1();
  else await phase2();
} finally {
  await sql?.end({ timeout: 5 });
}
await saveState();
const finished = new Date().toISOString();
const results = state.results;
const passed = results.filter((r) => r.ok).length;
const target = new URL(STAGING_URL).host;
const report = {
  phase, run: state.run, mode: DIRECT ? "direct" : "steps", target, started: state.created_at, finished,
  passed, failed: results.length - passed, results,
};
await Deno.mkdir(OUT_DIR, { recursive: true });
const stem = `${OUT_DIR}/rooftopos-staging-${phase}-${state.run}`;
await Deno.writeTextFile(`${stem}.json`, JSON.stringify(report, null, 2));
const md = [
  `# RooftopOS staging ${phase}`,
  "",
  `Target ${target} · ${report.mode} mode · run ${state.run} · ${state.created_at} to ${finished}`,
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
