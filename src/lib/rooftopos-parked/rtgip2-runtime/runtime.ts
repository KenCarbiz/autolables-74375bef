// Deployable RTGIP/2 app runtime: the Request -> Response handlers behind the rtgip-inbound,
// rtgip-dispatch and rtgip-publish edge functions. Byte-identical in AutoLabels, AutoCurb and
// AutoFrame (rtgip2-runtime/PROVENANCE.json). It imports only the frozen rtgip2 core, the rtgip/3
// Gateway mirrors (rtgip3/PROVENANCE.json), the shared chain rule and postgres types; every
// app-specific fact (adapter, publish authorizer, refs, constants) is injected.
//
// Nothing here can switch a route on by itself. Five gates run first, in order, before the body or
// any secret is read: the compiled literal, the runtime mode, the compiled staging backend, the
// compiled Gateway origin allowlist (dispatch only) and the app database's own transport switch.
import type postgres from "postgres";
import {
  MAX_BODY_BYTES,
  MemoryNonceStore,
  canonicalize,
  signEnvelope,
  verifyDelivery,
  type AppId,
  type EnvelopeV2,
  type Registry,
  type ServiceConnection,
  type ServiceKey,
} from "../rtgip2/protocol.ts";
import { signReceiptQuery } from "../rtgip2/receipt-query.ts";
import type { ReceiptV2 } from "../rtgip2/receipt-v2.ts";
import {
  admissionHeaders,
  admitDelivery,
  type AdmissionDb,
  type AdmissionEffect,
  type AdmissionTx,
  type AdmitRow,
} from "../rtgip2/admission.ts";
import { refusalReason } from "../rtgip2/delivery.ts";
import * as sig3 from "../rtgip3/sig.ts";
import * as keys3 from "../rtgip3/keys3.ts";
import * as core3 from "../rtgip3/core3.ts";
import * as receipt3 from "../rtgip3/receipt3.ts";
import * as query3 from "../rtgip3/receipt-query3.ts";
import type { SigningKey3 } from "../rtgip3/sig.ts";
import type { KeyContext3, PublicKeyRecord } from "../rtgip3/keys3.ts";
import type { AttestDoc3, ConnectionGate, SignedHeaders3 } from "../rtgip3/core3.ts";
import type { Outcome3, Receipt3 } from "../rtgip3/receipt3.ts";
import { verifySourceChainV3, type SourceChainV3Verdict } from "./source-chain.ts";

export type Sql = postgres.Sql;
export type App = "autolabels" | "autocurb" | "autoframe";

export interface RuntimeAdapter {
  produce(
    db: Sql,
    kind: string,
    scope: { tenant_id: string; rooftop_id: string },
    ref: Record<string, string>,
  ): Promise<{ envelope: EnvelopeV2; body: string }[]>;
  apply(
    tx: Sql,
    envelope: EnvelopeV2,
  ): Promise<{ ok: boolean; reason: string; duplicate?: boolean }>;
}

export interface ReadDb {
  query(text: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
}
export interface PublishRequest {
  kind: string;
  tenant_id: string;
  rooftop_id: string;
  ref: Record<string, string>;
}
export type PublishDecision = { ok: true } | { ok: false; reason: string };
export type PublishAuthorizer = (
  db: ReadDb,
  userId: string,
  req: PublishRequest,
) => Promise<PublishDecision>;

export interface AppRuntimeConfig {
  app: App;
  /** The compiled literal. The deployed entry files pass RTGIP2_APP_RUNTIME_ENABLED and nothing else. */
  compiledEnabled: boolean;
  /** Compiled staging project ref; SUPABASE_URL must be exactly https://<ref>.supabase.co. */
  stagingRef: string;
  /** Compiled Gateway origin allowlist (dispatch). Empty refuses every dispatch. */
  gatewayOrigins: readonly string[];
  /** Default true. Only a test file sets false, to reach a loopback stub Gateway. */
  gatewayHttpsOnly?: boolean | undefined;
  adapter: RuntimeAdapter;
  publish: { kinds: readonly string[]; refKeys: readonly string[]; authorize: PublishAuthorizer };
  env: (name: string) => string | undefined;
  /** A client the runtime owns: it is ended when the request finishes. */
  sql: () => Sql;
  fetch?: typeof fetch | undefined;
  /** Milliseconds since the epoch. */
  now?: (() => number) | undefined;
  getUser?: ((token: string) => Promise<{ id: string } | null>) | undefined;
}

export interface DispatchResult {
  event_id: string;
  action: "deliver" | "confirm";
  http_status: number;
  reason: string | null;
  advanced: string[];
  state: string;
}

export interface AppRuntime {
  inbound(req: Request): Promise<Response>;
  dispatch(req: Request): Promise<Response>;
  publish(req: Request): Promise<Response>;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REPLY_BYTES = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REF = /^[a-z0-9]{20}$/;
const CODE = /^[a-z][a-z0-9_]{0,47}$/;

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

const json = (status: number, doc: unknown): Response =>
  new Response(JSON.stringify(doc), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const rowsOf = (v: unknown): Record<string, unknown>[] => v as unknown as Record<string, unknown>[];
const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

async function sameSecret(a: string, b: string): Promise<boolean> {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i]! ^ y[i]!;
  return d === 0;
}

const MIN_DISPATCH_TOKEN_CHARS = 32;

type BodyRead = { ok: true; body: string } | { ok: false; status: number; reason: string };
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Bounded read, then fatal UTF-8 decoding; a byte-order mark is refused, never stripped. */
async function readBody(req: Request): Promise<BodyRead> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return { ok: false, status: 413, reason: "body_too_large" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413, reason: "body_too_large" };
      }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.length;
  }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
    return { ok: false, status: 400, reason: "bom_not_allowed" };
  try {
    return { ok: true, body: UTF8.decode(buf) };
  } catch {
    return { ok: false, status: 400, reason: "invalid_utf8" };
  }
}

const isJson = (req: Request) =>
  (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() ===
  "application/json";

const currentKey = (reg: Registry, owner: ServiceKey["owner"], nowSec: number): ServiceKey | null =>
  reg.keys.find(
    (k) =>
      k.owner === owner &&
      k.dialect === "rtgip/2" &&
      k.status === "current" &&
      nowSec >= k.not_before &&
      nowSec <= k.not_after,
  ) ?? null;

const GATEWAY_STAGES = new Set(["gateway_admission", "gateway_confirmation"]);
const STATUSES = new Set(["current", "previous", "revoked"]);
const OWNERS = new Set(["autolabels", "autocurb", "autoframe", "autofilm", "gateway"]);
const DIALECTS = new Set([
  "rtgip/2",
  "autolabels.rooftopos/1",
  "gateway.operator/1",
  "autoframe.raw-hash/1",
]);

/**
 * AR-1 option 1 (A1-4): every rtgip/2 key speaks to exactly one audience. A key row is in this
 * app's verification path only when it is the app's own key (owner = this app, audience gateway)
 * or the Gateway's key towards this app (owner gateway, audience = this app). Rows without an
 * audience (the -1 keys until cutover) and any other app's key are left out, so they can neither
 * sign nor verify here.
 */
const inVerificationPath = (app: App, owner: unknown, audience: unknown) =>
  (owner === app && audience === "gateway") || (owner === "gateway" && audience === app);

/** The registry as this app's own database holds it. A missing or malformed secret leaves the key out. */
async function loadRegistry(sql: Sql, app: App): Promise<Registry> {
  const { conns, keys } = (await sql.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    const conns = rowsOf(
      await tx.unsafe(
        "SELECT connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status FROM rtgip.connections",
      ),
    );
    const keys = rowsOf(
      await tx.unsafe(
        `SELECT k.key_id, k.owner, k.dialect, k.connection_ids, k.status, k.audience,
                extract(epoch FROM k.not_before)::bigint::text AS not_before, extract(epoch FROM k.not_after)::bigint::text AS not_after,
                (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = k.secret_ref LIMIT 1) AS secret
           FROM rtgip.signing_keys k`,
      ),
    );
    return { conns, keys };
  })) as unknown as { conns: Record<string, unknown>[]; keys: Record<string, unknown>[] };
  const connections = conns.map((c) => ({ ...c }) as unknown as ServiceConnection);
  const out: ServiceKey[] = [];
  for (const k of keys) {
    const secret = k["secret"];
    if (typeof secret !== "string" || secret.length < 16) continue;
    if (!inVerificationPath(app, k["owner"], k["audience"])) continue;
    if (
      !STATUSES.has(String(k["status"])) ||
      !OWNERS.has(String(k["owner"])) ||
      !DIALECTS.has(String(k["dialect"]))
    )
      continue;
    const nb = Number(k["not_before"]);
    const na = Number(k["not_after"]);
    if (!Number.isFinite(nb) || !Number.isFinite(na)) continue;
    out.push({
      key_id: String(k["key_id"]),
      owner: k["owner"] as ServiceKey["owner"],
      dialect: k["dialect"] as ServiceKey["dialect"],
      connection_ids: k["connection_ids"] as string[],
      status: k["status"] as ServiceKey["status"],
      not_before: nb,
      not_after: na,
      secret,
    });
  }
  return { connections, keys: out };
}

/** AdmissionDb over a real transaction, executing as the rtgip_inbox_receiver duty role. */
function admissionDb(sql: Sql): AdmissionDb {
  return {
    transaction: <T>(fn: (tx: AdmissionTx) => Promise<T>) =>
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE rtgip_inbox_receiver");
        const wrapped: AdmissionTx & { sql: typeof tx } = {
          sql: tx,
          admit: async (headers, body, admission, rej) =>
            rowsOf(
              await tx.unsafe(
                "SELECT * FROM rtgip.inbox_admit($1::text::jsonb, $2::text, $3::text, $4::text::jsonb)",
                [JSON.stringify(headers), body, admission, rej ? JSON.stringify(rej) : null],
              ),
            ) as unknown as AdmitRow[],
          recordReceipts: async (deliveryId, receipts) =>
            void (await tx.unsafe("SELECT rtgip.inbox_record_receipts($1, $2::text[])", [
              deliveryId,
              tx.array(receipts) as never,
            ])),
          savepoint: async (n) => void (await tx.unsafe(`SAVEPOINT ${n}`)),
          rollbackTo: async (n) => void (await tx.unsafe(`ROLLBACK TO SAVEPOINT ${n}`)),
        };
        return fn(wrapped);
      }) as Promise<T>,
  };
}

async function limitedText(r: Response): Promise<string> {
  const text = await r.text();
  return text.length > MAX_REPLY_BYTES ? "" : text;
}

// ---------------------------------------------------------------------------
// rtgip/3 (Ed25519, freeze rtgip/3-contract-freeze/1). The envelope body stays rtgip/2, so business
// events and consumer effects are the rtgip/2 ones; only the transport signature, the receipts and
// the SQL entry points (rtgip_v3_attest.proposed.sql) differ. The database holds public keys only;
// the private key is the platform secret keySecretName3(key_id) of the app's single current key
// row (PKCS#8, base64), imported non-extractable and self-tested against its pinned public key. A
// database without the v3 SQL is an rtgip/2-only node: no v3 query is ever issued against it.
// rtgip/3 has its own switch on top of the rtgip/2 gates: RTGIP3_ENABLED must be exactly "true".
// ---------------------------------------------------------------------------

/** The modules the bundle carries (and its frozen rtgip/2 verifier), for the known-answer run against the built bundle. */
export const RTGIP3 = Object.freeze({
  sig: sig3,
  keys: keys3,
  core: core3,
  receipt: receipt3,
  query: query3,
  v2: Object.freeze({ verifyDelivery }),
});

/**
 * The secret holding a key's PKCS#8, named by key id as the Gateway names its own: the next key's
 * secret can be installed beside the current one, so a rotation never leaves the node without a signer.
 */
export const keySecretName3 = (keyId: string) => `RTGIP3_SIGNING_KEY_${keyId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
const KEY_ENVS = new Set(["stg", "prd"]);
const HEX64 = /^[0-9a-f]{64}$/;
// The two tables rtgip_v3_attest.proposed.sql creates together with its entry points.
const V3_PROBE =
  "SELECT to_regclass('rtgip.evidence_v3') IS NOT NULL AND to_regclass('rtgip.public_key_bindings') IS NOT NULL AS installed";

// rtgip/3-refusal-policy/1 (rtgip3/refusal-policy.v1.json; runtime-v3.test.ts keeps these equal).
export const REFUSALS_V3: Readonly<Record<number, readonly string[]>> = {
  400: [
    "unknown_rtgip_header", "duplicate_or_invalid_header", "missing_headers", "missing_nonce",
    "malformed_json", "body_not_canonical", "payload_hash_mismatch", "event_id_not_derived",
    "protocol_mismatch", "scope_mismatch", "unmappable_event", "invalid_nonce",
    "signature_malformed", "origin_missing", "attest_shape", "attest_missing", "admission_missing",
  ],
  403: [
    "ambiguous_connection", "ambiguous_or_unauthorized_connection", "ambiguous_or_unauthorized_mapping",
    "connection_revoked", "dialect_held", "event_not_granted", "event_not_on_route",
    "key_not_bound_to_connection", "no_connection_for_tenant", "not_source_authority",
    "producer_disabled", "purpose_not_allowed", "purpose_not_granted", "reader_disabled",
    "rooftop_not_granted", "route_reserved", "source_impersonation", "unknown_route",
    "wrong_destination", "admission_forbidden", "rooftop_not_active", "labels_event_reused",
    "episode_already_bound", "episode_previously_revoked",
    "protocol_not_accepted", "origin_mismatch", "attest_key_mismatch", "attest_msg_mismatch",
    "attest_sig_mismatch",
  ],
  409: ["admission_conflict"],
  413: ["body_too_large"],
  503: ["no_signing_key", "verification_unavailable"],
};
/** peer_visible: a node's own configuration faults are never sent to a peer. */
export const PEER_VISIBLE_V3: Readonly<Record<string, string>> = {
  attest_shape: "verification_unavailable",
  attest_missing: "verification_unavailable",
  attest_key_mismatch: "verification_unavailable",
  attest_msg_mismatch: "verification_unavailable",
  attest_sig_mismatch: "verification_unavailable",
  attest_stale: "verification_unavailable",
  key_not_pinned: "unknown_key",
};

/** The status a peer sees for an rtgip/3 refusal, and the code it sees (after the peer mapping). */
export function refusalV3(reason: string): { status: number; reason: string; local: boolean } {
  const local = Object.hasOwn(PEER_VISIBLE_V3, reason);
  const shown = local ? PEER_VISIBLE_V3[reason]! : reason;
  for (const [status, codes] of Object.entries(REFUSALS_V3))
    if (codes.includes(shown)) return { status: Number(status), reason: shown, local };
  return { status: 401, reason: shown, local };
}

interface Gate3 extends ConnectionGate {
  send_protocol: string;
}
export interface V3State {
  keys: KeyContext3;
  connections: ServiceConnection[];
  gates: ReadonlyMap<string, Gate3>;
  /** This app's key after its self-test, or null (no_signing_key). */
  signer: SigningKey3 | null;
  /** RTGIP3_VERIFIER_DIGEST: sha256 of this deployed bundle, the attestation `verifier`. */
  verifier: string | null;
  /** A configuration fault (malformed pins or key environment): verification_unavailable. */
  fault: string | null;
}

const epochOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const textArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

async function v3Installed(sql: Sql): Promise<boolean> {
  const row = rowsOf(
    await sql.begin(async (tx) => {
      await tx.unsafe("SET TRANSACTION READ ONLY");
      return tx.unsafe(V3_PROBE);
    }),
  )[0];
  return row?.["installed"] === true;
}

/** Null when the database has no rtgip/3 SQL: the node is rtgip/2 only. */
async function loadV3(
  sql: Sql,
  app: App,
  cfg: { env: (name: string) => string | undefined },
  nowSec: number,
): Promise<V3State | null> {
  const got = (await sql.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    if (rowsOf(await tx.unsafe(V3_PROBE))[0]?.["installed"] !== true) return null;
    const keys = rowsOf(
      await tx.unsafe(
        `SELECT k.key_id, k.owner, k.protocol, k.alg, k.public_key, k.fingerprint, k.status,
                k.not_before::text AS not_before, k.not_after::text AS not_after, k.revoked_at::text AS revoked_at, k.revoked_reason,
                ARRAY(SELECT b.connection_id FROM rtgip.public_key_bindings b WHERE b.key_id = k.key_id ORDER BY b.connection_id) AS connection_ids
           FROM rtgip.public_keys k ORDER BY k.key_id`,
      ),
    );
    const conns = rowsOf(
      await tx.unsafe(
        `SELECT connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status,
                send_protocol, accept_protocols, v3_added_at::text AS v3_added_at, v2_accept_until::text AS v2_accept_until
           FROM rtgip.connections`,
      ),
    );
    return { keys, conns };
  })) as unknown as { keys: Record<string, unknown>[]; conns: Record<string, unknown>[] } | null;
  if (!got) return null;
  let fault: string | null = null;
  let pins: Record<string, string> = {};
  try {
    pins = keys3.parsePins(cfg.env("RTGIP3_KEY_PINS"));
  } catch {
    fault = "pins_malformed";
  }
  const keyEnv = cfg.env("RTGIP3_KEY_ENV") ?? "stg";
  if (!KEY_ENVS.has(keyEnv)) fault = "key_env_invalid";
  const records: PublicKeyRecord[] = [];
  for (const k of got.keys) {
    const notBefore = Number(k["not_before"]);
    const notAfter = Number(k["not_after"]);
    const revokedAt = epochOrNull(k["revoked_at"]);
    // A row whose validity or revocation time is not a safe integer is left out, as the Gateway's
    // keyRecord3FromRow does: the key then fails closed (unknown_key, no_signing_key) instead of throwing.
    if (![notBefore, notAfter, revokedAt ?? 0].every(Number.isSafeInteger)) continue;
    records.push({
      alg: String(k["alg"]),
      connection_ids: textArray(k["connection_ids"]),
      fingerprint: String(k["fingerprint"]),
      key_id: String(k["key_id"]),
      not_after: notAfter,
      not_before: notBefore,
      owner: String(k["owner"]),
      protocol: String(k["protocol"]),
      public_key: String(k["public_key"]),
      revoked_at: revokedAt,
      revoked_reason: k["revoked_reason"] === null ? null : String(k["revoked_reason"]),
      status: String(k["status"]),
    });
  }
  const keys: KeyContext3 = { keys: records, pins: fault ? {} : pins, now: nowSec, env: keyEnv };
  const connections = got.conns.map(
    (c) =>
      ({
        connection_id: c["connection_id"],
        source_app: c["source_app"],
        target_app: c["target_app"],
        tenant_id: c["tenant_id"],
        rooftop_ids: c["rooftop_ids"],
        event_types: c["event_types"],
        purposes: c["purposes"],
        producer_enabled: c["producer_enabled"],
        reader_enabled: c["reader_enabled"],
        status: c["status"],
      }) as unknown as ServiceConnection,
  );
  const gates = new Map<string, Gate3>(
    got.conns.map((c) => [
      String(c["connection_id"]),
      {
        connection_id: String(c["connection_id"]),
        accept_protocols: textArray(c["accept_protocols"]),
        send_protocol: String(c["send_protocol"]),
        v3_added_at: epochOrNull(c["v3_added_at"]),
        v2_accept_until: epochOrNull(c["v2_accept_until"]),
      },
    ]),
  );
  const signer = fault ? null : await keys3.loadSigningKey3(keys, app, (keyId) => cfg.env(keySecretName3(keyId)));
  const digest = cfg.env("RTGIP3_VERIFIER_DIGEST");
  return {
    keys,
    connections,
    gates,
    signer,
    verifier: digest !== undefined && HEX64.test(digest) ? digest : null,
    fault,
  };
}

const unsignedOf = (r: Receipt3) => {
  const { signature: _s, ...u } = r;
  return u;
};

/** One attestation item per receipt, role receipt:<n>, for receipts this edge has just verified. */
async function receiptAttest(v3: V3State, verifier: string, at: number, receipts: readonly Receipt3[]): Promise<AttestDoc3> {
  const items = [];
  for (const [i, r] of receipts.entries()) {
    const k = v3.keys.keys.find((x) => x.key_id === r.key_id);
    if (!k) throw new Error("verification_unavailable");
    items.push(await core3.attestItem3(`receipt:${i}`, k, receipt3.receiptMessage3(unsignedOf(r)), r.signature));
  }
  return core3.attestDoc3(verifier, at, items);
}

class AdmissionDisagreementV3 extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const NO_CLAIM = { claim: async () => "claimed" as const };
const ATTEST_FAULT = /^attest_(shape|missing|key_mismatch|msg_mismatch|sig_mismatch|stale)$/;
const V3_HEADERS: readonly string[] = [...core3.HEADER_NAMES3, core3.ORIGIN_HEADER, core3.ADMISSION_HEADER3];
const NONCE3 = /^[A-Za-z0-9_-]{16,128}$/;
const KEY_ID_SHAPE3 = /^[a-z]{2,8}-(gateway|autolabels|autocurb|autoframe)-ed[1-9][0-9]{0,3}$/;

/**
 * The state-free head of the target's check order, so an unsigned or malformed request costs no database
 * read and no key import: verifySignature3's header checks (as the Gateway's headerShape3), the signature
 * encoding, then presence and encoding of the Gateway's admission and of the source's origin. The same
 * codes as the full verifiers give for these faults.
 */
function shapeV3(h: Readonly<Record<string, string>>): string | null {
  if (h["rtgip-protocol"] !== core3.PROTOCOL3) return "protocol_mismatch";
  const keyId = h["rtgip-key-id"];
  const nonce = h["rtgip-nonce"];
  const sig = h["rtgip-signature"];
  if (!keyId || !h["rtgip-signer"] || !h["rtgip-timestamp"] || !nonce || !h["rtgip-scope"] || !sig) return "missing_headers";
  if (!sig.startsWith(core3.SIGNATURE_PREFIX3)) return "protocol_mismatch";
  if (!NONCE3.test(nonce)) return "invalid_nonce";
  if (!KEY_ID_SHAPE3.test(keyId)) return "unknown_key";
  if (!sig3.signatureWellFormed(sig.slice(core3.SIGNATURE_PREFIX3.length))) return "signature_malformed";
  const admission = h[core3.ADMISSION_HEADER3];
  if (!admission) return "admission_missing";
  try {
    const text = sig3.b64urlDecode(admission);
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || canonicalize(parsed) !== text) return "invalid_receipt_shape";
  } catch {
    return "invalid_receipt_shape";
  }
  const origin = h[core3.ORIGIN_HEADER];
  if (!origin) return "origin_missing";
  if (!core3.decodeOrigin(origin)) return "origin_mismatch";
  return null;
}

export function createAppRuntime(cfg: AppRuntimeConfig): AppRuntime {
  const now = cfg.now ?? (() => Date.now());
  const nowSec = () => Math.floor(now() / 1000);
  const doFetch = cfg.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const httpsOnly = cfg.gatewayHttpsOnly !== false;

  const refuse = (reason: string) => json(503, { reason });
  /** rtgip/3's own switch, default off: only the exact value "true" turns it on. */
  const v3Enabled = () => cfg.env("RTGIP3_ENABLED") === "true";

  function staticGate(): Response | null {
    if (cfg.compiledEnabled !== true) return refuse("RTGIP2_NOT_ACTIVATED");
    if (cfg.env("RTGIP2_RUNTIME_MODE") !== "staging") return refuse("runtime_mode_off");
    let ok = false;
    try {
      const u = new URL(cfg.env("SUPABASE_URL") ?? "");
      ok =
        REF.test(cfg.stagingRef) &&
        u.origin === `https://${cfg.stagingRef}.supabase.co` &&
        !u.username &&
        !u.password;
    } catch {
      ok = false;
    }
    return ok ? null : refuse("not_staging_backend");
  }

  function gatewayBase(): string | null {
    try {
      const u = new URL(cfg.env("RTGIP2_GATEWAY_URL") ?? "");
      if (httpsOnly && u.protocol !== "https:") return null;
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      if (u.username || u.password) return null;
      return cfg.gatewayOrigins.includes(u.origin) ? u.origin : null;
    } catch {
      return null;
    }
  }

  async function dbGate(sql: Sql): Promise<Response | null> {
    let row: Record<string, unknown> | undefined;
    try {
      row = rowsOf(
        await sql.begin(async (tx) => {
          await tx.unsafe("SET TRANSACTION READ ONLY");
          return tx.unsafe(
            "SELECT transport_enabled, local_app FROM rtgip.delivery_config WHERE id",
          );
        }),
      )[0];
    } catch {
      return refuse("db_unavailable");
    }
    if (!row || row["transport_enabled"] !== true) return refuse("transport_disabled");
    if (row["local_app"] !== cfg.app) return refuse("local_app_mismatch");
    return null;
  }

  async function dispatchAuthorized(req: Request): Promise<boolean> {
    const m = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "");
    if (!m) return false;
    const key = cfg.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const token = cfg.env("RTGIP2_DISPATCH_TOKEN") ?? "";
    const [byKey, byToken] = await Promise.all([
      key ? sameSecret(m[1]!, key) : Promise.resolve(false),
      token.length >= MIN_DISPATCH_TOKEN_CHARS ? sameSecret(m[1]!, token) : Promise.resolve(false),
    ]);
    return byKey || byToken;
  }

  async function guarded(
    req: Request,
    work: (sql: Sql) => Promise<Response>,
    opts: { dispatch?: boolean } = {},
  ): Promise<Response> {
    const early = staticGate();
    if (early) return early;
    if (opts.dispatch) {
      if (!gatewayBase()) return refuse("gateway_origin_not_allowed");
      if (!(await dispatchAuthorized(req))) return json(401, { reason: "unauthorized" });
    }
    let sql: Sql | null = null;
    try {
      sql = cfg.sql();
      const denied = await dbGate(sql);
      if (denied) return denied;
      return await work(sql);
    } catch (err) {
      const e = err as { name?: string; code?: string };
      console.error("rtgip2_runtime_error", e?.name ?? "Error", e?.code ?? "");
      return json(500, { reason: "internal_error" });
    } finally {
      try {
        await sql?.end({ timeout: 2 });
      } catch {
        // the request is already answered
      }
    }
  }

  /** An rtgip/3 refusal as the peer sees it; a local fault is logged here and only its peer code leaves. */
  const refuseV3 = (reason: string): Response => {
    const r = refusalV3(reason);
    if (r.local || r.status === 503) console.warn("rtgip3_local_refusal", reason);
    return json(r.status, { reason: r.reason, receipts: [] });
  };

  /**
   * rtgip/3 target (H2): the Gateway's forward signature, its admission for this very delivery and the
   * source's origin are all verified here before any write; rtgip.inbox_admit_v3 then recomputes every
   * message, checks the attestation and claims the nonce, and the effect pass is the rtgip/2 one. The
   * receipts are signed with this app's Ed25519 key, self-verified, attested and stored.
   */
  async function inboundV3(req: Request, sql: Sql): Promise<Response> {
    if (!v3Enabled()) return refuseV3("protocol_not_accepted");
    const read = await readBody(req);
    if ("reason" in read) return refuseV3(read.status === 413 ? "body_too_large" : "malformed_json");
    const raw = Object.fromEntries(req.headers.entries());
    for (const h of V3_HEADERS)
      if (raw[h] !== undefined && (raw[h]!.includes(",") || /[\r\n\0]/.test(raw[h]!)))
        return refuseV3("duplicate_or_invalid_header");
    const shape = shapeV3(raw);
    if (shape) return refuseV3(shape);
    const v3 = await loadV3(sql, cfg.app, cfg, nowSec());
    if (!v3) return refuseV3("protocol_not_accepted");
    if (v3.fault || !v3.verifier) return refuseV3("verification_unavailable");
    const signer = v3.signer;
    if (!signer) return refuseV3("no_signing_key");
    const verifier = v3.verifier;
    const now = nowSec();
    const keys: KeyContext3 = { ...v3.keys, now };
    const headers = admissionHeaders(raw) as unknown as SignedHeaders3;
    const v = await core3.verifyDeliveryV3(headers, read.body, {
      keys,
      connections: v3.connections,
      nonces: NO_CLAIM,
      expectedSigner: "gateway",
      receiver: cfg.app as AppId,
    });
    if (!v.ok) return refuseV3(v.reason);
    const d = v.delivery;
    const gate = v3.gates.get(d.connection_id);
    const g = gate ? core3.gateVerdict(gate, core3.PROTOCOL3, now) : sig3.fail("protocol_not_accepted");
    if (!g.ok) return refuseV3(g.reason);
    const admissionText = raw[core3.ADMISSION_HEADER3] ?? null;
    const originText = raw[core3.ORIGIN_HEADER] ?? null;
    const fwd = await core3.verifyForwardEvidence3(
      { headers, body: read.body, admission: admissionText, origin: originText },
      keys,
      d.connection_id,
    );
    if (!fwd.ok) return refuseV3(fwd.reason);
    const adm = fwd.admission;
    const origin = core3.decodeOrigin(originText!)!;
    const record = (id: string) => keys.keys.find((k) => k.key_id === id)!;
    let attest: AttestDoc3;
    try {
      attest = core3.attestDoc3(verifier, now, [
        await core3.attestItem3(
          "forward",
          d.key,
          core3.preimage3(headers["rtgip-key-id"], headers["rtgip-signer"], headers["rtgip-timestamp"], headers["rtgip-nonce"], headers["rtgip-scope"], d.body_sha256),
          headers["rtgip-signature"].slice(core3.SIGNATURE_PREFIX3.length),
        ),
        await core3.attestItem3("admission", record(adm.key_id), receipt3.receiptMessage3(unsignedOf(adm)), adm.signature),
        await core3.attestItem3(
          "origin",
          record(origin.key_id),
          core3.preimage3(origin.key_id, origin.signer, String(origin.timestamp), origin.nonce, origin.scope, d.body_sha256),
          origin.signature,
        ),
      ]);
    } catch {
      return refuseV3("verification_unavailable");
    }

    type Row = AdmitRow;
    let decided: { rejected: string | null; rows: Row[] };
    try {
      decided = (await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE rtgip_inbox_receiver");
        const admit = async (rej: { event_id: string; reason: string } | null) =>
          rowsOf(
            await tx.unsafe(
              "SELECT * FROM rtgip.inbox_admit_v3($1::text::jsonb, $2::text, $3::text, $4::text, $5::text::jsonb, $6::text::jsonb)",
              [JSON.stringify(headers), read.body, admissionText, originText, JSON.stringify(attest), rej ? JSON.stringify(rej) : null],
            ),
          ) as unknown as Row[];
        await tx.unsafe("SAVEPOINT rtgip_admit_v3");
        let rows = await admit(null);
        const first = rows[0];
        if (!first) throw new AdmissionDisagreementV3("admit_returned_nothing");
        if (first.outcome === "rejected") return { rejected: first.reason ?? "rejected", rows };
        if (first.event_id !== d.envelope.event_id || first.connection_id !== d.connection_id)
          throw new AdmissionDisagreementV3("verifier_disagreement");
        for (const row of rows) {
          if (row.outcome !== "applied" || first.replayed) continue;
          if (!row.envelope || !row.event_id) throw new AdmissionDisagreementV3("applied_without_envelope");
          const res = await cfg.adapter.apply(tx as unknown as Sql, row.envelope);
          if (res.ok) continue;
          await tx.unsafe("ROLLBACK TO SAVEPOINT rtgip_admit_v3");
          rows = await admit({ event_id: row.event_id, reason: res.reason });
          const again = rows[0];
          if (!again || again.outcome === "rejected") throw new AdmissionDisagreementV3("reject_pass_refused");
          for (const r2 of rows) {
            if (r2.outcome !== "applied" || !r2.envelope) continue;
            if (!(await cfg.adapter.apply(tx as unknown as Sql, r2.envelope)).ok)
              throw new AdmissionDisagreementV3("effect_failed_after_reject_pass");
          }
          break;
        }
        return { rejected: null, rows };
      })) as unknown as { rejected: string | null; rows: Row[] };
    } catch (err) {
      if (err instanceof AdmissionDisagreementV3) return json(500, { reason: err.code, receipts: [] });
      return json(503, { reason: "admission_aborted", receipts: [] });
    }
    if (decided.rejected) return refuseV3(decided.rejected);
    const received = decided.rows[0]!;
    const deliveryId = await receipt3.deliveryId3(d.connection_id, d.envelope.event_id, d.envelope.target_app, d.body_sha256);
    if (!received.delivery_id || received.issued_at === null) return json(500, { reason: "delivery_record_missing", receipts: [] });
    if (received.delivery_id !== deliveryId) return json(500, { reason: "verifier_disagreement", receipts: [] });
    if (received.stored_receipts)
      return json(200, { reason: null, receipts: received.stored_receipts.map((t) => JSON.parse(t) as Receipt3) });
    const issuedAt = Number(received.issued_at);
    const exp = (kind: "target_inbox" | "consumer_commit") => ({
      envelope: d.envelope,
      envelope_sha256: d.body_sha256,
      connection_id: d.connection_id,
      delivery_id: deliveryId,
      kind,
    });
    let receipts: Receipt3[];
    try {
      const inbox = await receipt3.signReceipt3(
        await receipt3.receiptDraft3(exp("target_inbox"), received.outcome as Outcome3, issuedAt, adm),
        signer,
      );
      receipts = [inbox];
      if (received.committed && received.committed_outcome)
        receipts.push(
          await receipt3.signReceipt3(
            await receipt3.receiptDraft3(exp("consumer_commit"), received.committed_outcome, issuedAt, inbox),
            signer,
          ),
        );
    } catch {
      console.warn("rtgip3_local_refusal", "receipt_signing_failed");
      return json(503, { reason: "no_signing_key", receipts: [] });
    }
    // Self-verification through the chain rule a source and the Gateway apply, before anything is stored.
    // A failure here is not a key fault: its own reason is logged and the peer sees verification_unavailable.
    let selfReason: string | null;
    try {
      const self = await receipt3.evaluateChain3([adm, ...receipts], {
        ...keys,
        now: nowSec(),
        envelope: d.envelope,
        envelope_sha256: d.body_sha256,
        connection_id: d.connection_id,
      });
      selfReason = self.ok ? null : self.reason;
    } catch {
      selfReason = "self_check_failed";
    }
    if (selfReason !== null) {
      console.warn("rtgip3_local_refusal", CODE.test(selfReason) ? selfReason : "self_check_failed");
      return json(503, { reason: "verification_unavailable", receipts: [] });
    }
    if (received.outcome !== "held") {
      try {
        const doc = await receiptAttest(v3, verifier, nowSec(), receipts);
        await sql.begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE rtgip_inbox_receiver");
          await tx.unsafe("SELECT rtgip.inbox_record_receipts_v3($1, $2::text[], $3::text::jsonb)", [
            deliveryId,
            tx.array(receipts.map((r) => canonicalize(r))) as never,
            JSON.stringify(doc),
          ]);
        });
      } catch (err) {
        const m = String((err as { message?: unknown })?.message ?? "");
        if (ATTEST_FAULT.test(m) || m === "verification_unavailable") return refuseV3(m);
        return json(503, { reason: "receipts_not_stored", receipts: [] });
      }
    }
    return json(200, { reason: null, receipts });
  }

  const inbound = (req: Request) =>
    guarded(req, async (sql) => {
      if (req.method !== "POST") return json(405, { reason: "method_not_allowed" });
      if (!isJson(req)) return json(415, { reason: "unsupported_media_type" });
      if (req.headers.get("rtgip-protocol") === core3.PROTOCOL3) return inboundV3(req, sql);
      const read = await readBody(req);
      if ("reason" in read) return json(read.status, { reason: read.reason });
      const reg = await loadRegistry(sql, cfg.app);
      const t = nowSec();
      const receiptKey = currentKey(reg, cfg.app, t);
      if (!receiptKey) return refuse("no_receipt_key");
      const headers = Object.fromEntries(req.headers.entries());
      // The version gate (contract "Coexistence"), before any state change. It is asked only about a body
      // the frozen rtgip/2 verifier has authenticated (no nonce is claimed here; admitDelivery verifies
      // again), so an unsigned request learns nothing from it; anything else goes straight to
      // admitDelivery, which refuses it as it always has. Without the rtgip/3 SQL there is no gate.
      if (req.headers.get("rtgip-protocol") === "rtgip/2") {
        const pre = await verifyDelivery(admissionHeaders(headers), read.body, {
          registry: reg,
          nonces: new MemoryNonceStore(),
          nowSec: t,
          expectedSigner: "gateway",
          receiver: cfg.app as AppId,
        });
        if (!("reason" in pre) && (await v3Installed(sql))) {
          let gate: unknown;
          try {
            gate = rowsOf(
              await sql.begin(async (tx) => {
                await tx.unsafe("SET LOCAL ROLE rtgip_inbox_receiver");
                return tx.unsafe("SELECT rtgip.connection_gate($1, 'rtgip/2') AS g", [read.body]);
              }),
            )[0]?.["g"];
          } catch {
            return json(503, { reason: "admission_aborted", receipts: [] });
          }
          if (typeof gate === "string") return json(403, { reason: gate, receipts: [] });
        }
      }
      const effect: AdmissionEffect = async (tx, e) => {
        const r = await cfg.adapter.apply((tx as unknown as { sql: Sql }).sql, e);
        return r.ok ? { ok: true } : { ok: false, reason: r.reason };
      };
      const r = await admitDelivery(headers, read.body, {
        app: cfg.app as AppId,
        registry: reg,
        nowSec: t,
        db: admissionDb(sql),
        effect,
        receiptKey,
      });
      return json(r.http_status, { reason: r.reason ?? null, receipts: r.receipts ?? [] });
    });

  async function post(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; doc: { reason?: string | null; receipts?: ReceiptV2[] } }> {
    try {
      const r = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
        redirect: "error",
        signal: timeoutSignal(FETCH_TIMEOUT_MS),
      });
      let doc: {
        reason?: string | null;
        error?: string;
        receipts?: ReceiptV2[];
        receipt?: ReceiptV2;
      } = {};
      try {
        const parsed: unknown = JSON.parse(await limitedText(r));
        if (parsed && typeof parsed === "object") doc = parsed as typeof doc;
      } catch {
        doc = {};
      }
      // The Gateway's deliver route answers { outcome, receipt } with one admission receipt; the
      // receipt query answers { receipts }. Both reach outbox_advance as a receipt list. Its
      // refusals carry the code in `error`, which the refusal policy reads as the reason.
      if (doc.reason == null && typeof doc.error === "string") doc = { ...doc, reason: doc.error };
      if (!Array.isArray(doc.receipts) && doc.receipt && typeof doc.receipt === "object")
        doc = { ...doc, receipts: [doc.receipt] };
      return { status: r.status, doc };
    } catch {
      return { status: 0, doc: { reason: "gateway_unreachable" } };
    }
  }

  type Doc = { reason?: string | null; receipts?: ReceiptV2[] };
  /**
   * One leased rtgip/3 row at the source: H1 to /api/rtgip/v3/deliver, or the rtgip/3-receipt-query/2
   * to /api/rtgip/v3/receipts. The answer is verified here by the rtgip/3 chain rule in the row's pinned
   * protocol, then attested to rtgip.outbox_advance_v3, which recomputes and re-checks every link.
   */
  async function stepV3(
    v3: V3State,
    base: string,
    worker: string,
    asDispatcher: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>,
    row: {
      envelope: EnvelopeV2;
      body: string;
      eventId: string;
      gen: number;
      action: "deliver" | "confirm";
      delivery_id_v3: string | null;
      connection_id: string;
    },
    advanced: string[],
  ): Promise<{ status: number; doc: Doc }> {
    if (!v3Enabled()) return { status: 0, doc: { reason: "rtgip3_disabled" } };
    if (v3.fault || !v3.verifier) return { status: 0, doc: { reason: "verification_unavailable" } };
    const signer = v3.signer;
    if (!signer) return { status: 0, doc: { reason: "no_signing_key" } };
    if (!row.delivery_id_v3) return { status: 0, doc: { reason: "protocol_mismatch" } };
    const verifier = v3.verifier;
    let status = 0;
    let doc: Doc = {};
    try {
      if (row.action === "deliver") {
        const now = nowSec();
        const keys: KeyContext3 = { ...v3.keys, now };
        const headers = await core3.signEnvelopeV3(row.body, row.envelope, signer, now, `src_${hex(12)}`);
        // The H1 signature is also the origin the Gateway forwards: both must verify as the peers will check them.
        const own = await core3.verifySignature3(headers, row.body, "source", keys, row.connection_id);
        if (!own.ok) return { status: 0, doc: { reason: own.reason } };
        const origin = await core3.verifyOrigin3(
          core3.encodeOrigin(core3.originOf(headers)),
          row.body,
          headers["rtgip-scope"],
          row.envelope,
          keys,
        );
        if (!origin.ok) return { status: 0, doc: { reason: origin.reason } };
        ({ status, doc } = await post(`${base}/api/rtgip/v3/deliver`, headers as unknown as Record<string, string>, row.body));
      } else {
        const q = await query3.signReceiptQuery3(
          { delivery_id: row.delivery_id_v3, event_id: row.eventId },
          signer,
          nowSec(),
          `qry_${hex(12)}`,
        );
        ({ status, doc } = await post(`${base}/api/rtgip/v3/receipts`, q.headers as unknown as Record<string, string>, q.body));
      }
    } catch {
      return { status: 0, doc: { reason: "signing_failed" } };
    }
    if (status !== 200 || !Array.isArray(doc.receipts) || !doc.receipts.length) return { status, doc };
    const verdict: SourceChainV3Verdict = await verifySourceChainV3(
      doc.receipts,
      {
        envelope: row.envelope,
        envelope_sha256: await sig3.sha256Hex(row.body),
        connection_id: row.connection_id,
        delivery_id: row.delivery_id_v3,
      },
      { ...v3.keys, now: nowSec() },
      row.action,
    );
    if (!verdict.ok) return { status, doc: { ...doc, reason: verdict.reason } };
    let attest: AttestDoc3;
    try {
      attest = await receiptAttest(v3, verifier, nowSec(), verdict.receipts);
    } catch {
      return { status, doc: { ...doc, reason: "verification_unavailable" } };
    }
    const r = rowsOf(
      await asDispatcher((tx) =>
        tx.unsafe("SELECT rtgip.outbox_advance_v3($1, $2, $3, $4::text[], $5::text::jsonb) AS r", [
          row.eventId,
          worker,
          row.gen,
          tx.array(verdict.receipts.map((x) => canonicalize(x))) as never,
          JSON.stringify(attest),
        ]),
      ),
    )[0]!["r"] as string;
    if (/^rejected:attest_/.test(r)) console.warn("rtgip3_local_refusal", r.slice("rejected:".length));
    advanced.push(r);
    return { status, doc };
  }

  const dispatch = (req: Request) =>
    guarded(
      req,
      async (sql) => {
        if (req.method !== "POST") return json(405, { reason: "method_not_allowed" });
        const base = gatewayBase()!;
        const reg = await loadRegistry(sql, cfg.app);
        const v3 = await loadV3(sql, cfg.app, cfg, nowSec());
        // REVIEW-IMPL-2 M-1: nothing is leased that this node cannot sign or attest for its protocol. A claim
        // charges an attempt, so a lease taken during a key or configuration fault would be charged until the
        // row is dead-lettered without one request sent. The protocol of an open row is its pin, or for a row
        // never claimed the connection's send_protocol, exactly as rtgip.outbox_protocol_guard will pin it.
        const v2Key = currentKey(reg, cfg.app, nowSec());
        if (!v3) {
          if (!v2Key) return refuse("no_signing_key");
        } else {
          const v3Signer = v3Enabled() ? v3.signer : null;
          const open = new Set(
            rowsOf(
              await sql.unsafe(
                `SELECT DISTINCT coalesce(o.protocol, CASE WHEN o.lease_generation = 0 THEN coalesce(c.send_protocol, 'rtgip/2') ELSE 'rtgip/2' END) AS protocol
                   FROM rtgip.outbox o LEFT JOIN rtgip.connections c ON c.connection_id = o.connection_id
                  WHERE o.state IN ('pending', 'retry_wait', 'in_flight', 'gateway_admitted')`,
              ),
            ).map((r) => String(r["protocol"])),
          );
          if (open.has(core3.PROTOCOL3)) {
            if (!v3Enabled()) return refuse("rtgip3_disabled");
            if (v3.fault || !v3.verifier) return refuse("verification_unavailable");
            if (!v3Signer) return refuse("no_signing_key");
          }
          if (open.has("rtgip/2") && !v2Key) return refuse("no_signing_key");
          if (!v2Key && !v3Signer) return refuse("no_signing_key");
        }
        const worker = `dispatch-${hex(4)}`;
        const asDispatcher = <T>(fn: (tx: Sql) => Promise<T>) =>
          sql.begin(async (tx) => {
            await tx.unsafe("SET LOCAL ROLE rtgip_dispatcher");
            return fn(tx as unknown as Sql);
          }) as Promise<T>;
        const advance = async (id: string, gen: number, texts: string[]) =>
          rowsOf(
            await asDispatcher((tx) =>
              tx.unsafe("SELECT rtgip.outbox_advance($1, $2, $3, $4::text[]) AS r", [
                id,
                worker,
                gen,
                tx.array(texts) as never,
              ]),
            ),
          )[0]!["r"] as string;
        const rows = rowsOf(
          await asDispatcher((tx) =>
            tx.unsafe(
              "SELECT event_id, body, envelope, delivery_id, lease_generation, lease_action FROM rtgip.outbox_claim($1, 100, 60)",
              [worker],
            ),
          ),
        );
        // The protocol each row was pinned to at this claim (rtgip.outbox_protocol_guard, from the
        // connection's send_protocol); without the rtgip/3 SQL every row is rtgip/2.
        const pinned = new Map<string, { protocol: string | null; delivery_id_v3: string | null; connection_id: string }>();
        if (v3 && rows.length)
          for (const p of rowsOf(
            await sql.unsafe(
              "SELECT event_id::text AS event_id, protocol, delivery_id_v3, connection_id FROM rtgip.outbox WHERE event_id = ANY($1::uuid[])",
              [sql.array(rows.map((r) => String(r["event_id"]))) as never],
            ),
          ))
            pinned.set(String(p["event_id"]), {
              protocol: (p["protocol"] as string | null) ?? null,
              delivery_id_v3: (p["delivery_id_v3"] as string | null) ?? null,
              connection_id: String(p["connection_id"]),
            });
        const out: DispatchResult[] = [];
        for (const row of rows) {
          const envelope = row["envelope"] as EnvelopeV2;
          const body = row["body"] as string;
          const eventId = row["event_id"] as string;
          const gen = Number(row["lease_generation"]);
          const action = row["lease_action"] as "deliver" | "confirm";
          const pin = pinned.get(eventId);
          let status = 0;
          let doc: { reason?: string | null; receipts?: ReceiptV2[] } = {};
          const advanced: string[] = [];
          if (v3 && pin?.protocol === core3.PROTOCOL3) {
            ({ status, doc } = await stepV3(v3, base, worker, asDispatcher, { envelope, body, eventId, gen, action, ...pin }, advanced));
          } else if (v3 && pin?.protocol !== "rtgip/2") {
            // With the rtgip/3 SQL every leased row carries its pin; anything else is never sent as rtgip/2.
            doc = { reason: "protocol_mismatch" };
          } else {
          const key = currentKey(reg, cfg.app, nowSec())!;
          try {
            if (action === "deliver") {
              const headers = (await signEnvelope(
                body,
                envelope,
                key,
                nowSec(),
                `src_${hex(12)}`,
              )) as unknown as Record<string, string>;
              ({ status, doc } = await post(`${base}/api/rtgip/v2/deliver`, headers, body));
            } else {
              const q = await signReceiptQuery(
                { delivery_id: row["delivery_id"] as string, event_id: eventId },
                key,
                nowSec(),
                `qry_${hex(12)}`,
              );
              ({ status, doc } = await post(
                `${base}/api/rtgip/v2/receipts`,
                q.headers as unknown as Record<string, string>,
                q.body,
              ));
            }
          } catch {
            doc = { reason: "signing_failed" };
          }
          // AR-1 option 1 (A1-2, A1-5): the source verifies only the Gateway-signed stages; a
          // target-issued receipt returned by the receipt query as evidence is never passed on.
          const chain =
            action === "confirm" && Array.isArray(doc.receipts)
              ? doc.receipts.filter((x) => GATEWAY_STAGES.has(String(x?.kind)))
              : doc.receipts;
          if (status === 200 && Array.isArray(chain) && chain.length)
            advanced.push(
              await advance(
                eventId,
                gen,
                chain.map((x) => canonicalize(x)),
              ),
            );
          }
          const last = advanced.at(-1);
          if (
            last !== "gateway_admitted" &&
            last !== "consumer_committed" &&
            last !== "target_quarantined" &&
            last !== "dead_letter"
          ) {
            const why = last
              ? last.replace(/^(rejected|pending):/, "")
              : status >= 400 && status < 500
                ? refusalReason(status, doc.reason)
                : (doc.reason ?? `http_${status}`);
            await asDispatcher((tx) =>
              tx.unsafe("SELECT rtgip.outbox_fail($1, $2, $3, $4, 1, 10)", [
                eventId,
                worker,
                gen,
                String(why).slice(0, 200),
              ]),
            );
          }
          const state = String(
            rowsOf(
              await sql.unsafe("SELECT state FROM rtgip.outbox WHERE event_id = $1", [eventId]),
            )[0]?.["state"] ?? "unknown",
          );
          out.push({
            event_id: eventId,
            action,
            http_status: status,
            reason: doc.reason ?? null,
            advanced,
            state,
          });
        }
        return json(200, out);
      },
      { dispatch: true },
    );

  async function getUser(token: string): Promise<{ id: string } | null> {
    if (cfg.getUser) return cfg.getUser(token);
    const base = new URL(cfg.env("SUPABASE_URL") ?? "").origin;
    const apikey = cfg.env("SUPABASE_ANON_KEY") ?? "";
    if (!apikey) return null;
    try {
      const r = await doFetch(`${base}/auth/v1/user`, {
        headers: { authorization: `Bearer ${token}`, apikey },
        redirect: "error",
        signal: timeoutSignal(FETCH_TIMEOUT_MS),
      });
      if (r.status !== 200) return null;
      const u = JSON.parse(await limitedText(r)) as { id?: unknown };
      return typeof u.id === "string" && UUID.test(u.id) ? { id: u.id } : null;
    } catch {
      return null;
    }
  }

  const safeCode = (err: unknown, fallback: string): string => {
    const c = String((err as { message?: unknown })?.message ?? "").replace(/:/g, "_");
    return CODE.test(c) ? c : fallback;
  };

  const publish = (req: Request) =>
    guarded(req, async (sql) => {
      if (req.method !== "POST") return json(405, { reason: "method_not_allowed" });
      const m = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(req.headers.get("authorization") ?? "");
      const user = m ? await getUser(m[1]!) : null;
      if (!user) return json(401, { reason: "unauthenticated" });
      if (!isJson(req)) return json(415, { reason: "unsupported_media_type" });
      const read = await readBody(req);
      if ("reason" in read) return json(read.status, { reason: read.reason });
      let doc: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(read.body);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("shape");
        doc = parsed as Record<string, unknown>;
      } catch {
        return json(400, { reason: "bad_request" });
      }
      const kind = doc["kind"];
      const tenant = doc["tenant_id"];
      const rooftop = doc["rooftop_id"];
      if (typeof kind !== "string" || !cfg.publish.kinds.includes(kind))
        return json(400, { reason: "unknown_kind" });
      if (
        typeof tenant !== "string" ||
        !tenant ||
        tenant.length > 128 ||
        typeof rooftop !== "string" ||
        !rooftop ||
        rooftop.length > 64
      )
        return json(400, { reason: "bad_scope" });
      const ref: Record<string, string> = {};
      const given =
        doc["ref"] && typeof doc["ref"] === "object" && !Array.isArray(doc["ref"])
          ? (doc["ref"] as Record<string, unknown>)
          : {};
      for (const k of cfg.publish.refKeys) {
        const v = given[k];
        if (v === undefined) continue;
        if (typeof v !== "string" || !v || v.length > 256) return json(400, { reason: "bad_ref" });
        ref[k] = v;
      }
      const request: PublishRequest = { kind, tenant_id: tenant, rooftop_id: rooftop, ref };
      const decision = (await sql.begin(async (tx) => {
        await tx.unsafe("SET TRANSACTION READ ONLY");
        return cfg.publish.authorize(
          {
            query: async (text, params) => rowsOf(await tx.unsafe(text, (params ?? []) as never[])),
          },
          user.id,
          request,
        );
      })) as unknown as PublishDecision;
      if (!decision.ok) {
        const why = "reason" in decision ? decision.reason : "";
        return json(403, { reason: CODE.test(why) ? why : "forbidden" });
      }
      let produced: { envelope: EnvelopeV2; body: string }[];
      try {
        produced = await cfg.adapter.produce(
          sql,
          kind,
          { tenant_id: tenant, rooftop_id: rooftop },
          ref,
        );
      } catch (err) {
        return json(422, {
          reason:
            (err as { name?: string })?.name === "PostgresError"
              ? "produce_failed"
              : safeCode(err, "produce_failed"),
        });
      }
      if (!produced.length) return json(422, { reason: "nothing_to_publish" });
      try {
        const results = (await sql.begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE rtgip_outbox_writer");
          const acc: { event_id: string; target_app: string; result: string }[] = [];
          for (const p of produced) {
            const r = rowsOf(await tx.unsafe("SELECT rtgip.outbox_enqueue($1) AS r", [p.body]))[0]![
              "r"
            ] as string;
            acc.push({
              event_id: p.envelope.event_id,
              target_app: p.envelope.target_app,
              result: r,
            });
          }
          return acc;
        })) as unknown as { event_id: string; target_app: string; result: string }[];
        return json(200, { results });
      } catch (err) {
        return json(422, {
          reason:
            (err as { name?: string })?.name === "PostgresError"
              ? safeCode(err, "enqueue_failed")
              : "enqueue_failed",
        });
      }
    });

  return { inbound, dispatch, publish };
}
