// Deployable RTGIP/2 app runtime: the Request -> Response handlers behind the rtgip-inbound,
// rtgip-dispatch and rtgip-publish edge functions. Byte-identical in AutoLabels, AutoCurb and
// AutoFrame (rtgip2-runtime/PROVENANCE.json). It imports only the frozen rtgip2 core and postgres
// types; every app-specific fact (adapter, publish authorizer, refs, constants) is injected.
//
// Nothing here can switch a route on by itself. Five gates run first, in order, before the body or
// any secret is read: the compiled literal, the runtime mode, the compiled staging backend, the
// compiled Gateway origin allowlist (dispatch only) and the app database's own transport switch.
import type postgres from "postgres";
import {
  MAX_BODY_BYTES,
  canonicalize,
  signEnvelope,
  type AppId,
  type EnvelopeV2,
  type Registry,
  type ServiceConnection,
  type ServiceKey,
} from "../rtgip2/protocol.ts";
import { signReceiptQuery } from "../rtgip2/receipt-query.ts";
import type { ReceiptV2 } from "../rtgip2/receipt-v2.ts";
import {
  admitDelivery,
  type AdmissionDb,
  type AdmissionEffect,
  type AdmissionTx,
  type AdmitRow,
} from "../rtgip2/admission.ts";
import { refusalReason } from "../rtgip2/delivery.ts";

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

const STATUSES = new Set(["current", "previous", "revoked"]);
const OWNERS = new Set(["autolabels", "autocurb", "autoframe", "autofilm", "gateway"]);
const DIALECTS = new Set([
  "rtgip/2",
  "autolabels.rooftopos/1",
  "gateway.operator/1",
  "autoframe.raw-hash/1",
]);

/** The registry as this app's own database holds it. A missing or malformed secret leaves the key out. */
async function loadRegistry(sql: Sql): Promise<Registry> {
  const { conns, keys } = (await sql.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    const conns = rowsOf(
      await tx.unsafe(
        "SELECT connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status FROM rtgip.connections",
      ),
    );
    const keys = rowsOf(
      await tx.unsafe(
        `SELECT k.key_id, k.owner, k.dialect, k.connection_ids, k.status,
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

export function createAppRuntime(cfg: AppRuntimeConfig): AppRuntime {
  const now = cfg.now ?? (() => Date.now());
  const nowSec = () => Math.floor(now() / 1000);
  const doFetch = cfg.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const httpsOnly = cfg.gatewayHttpsOnly !== false;

  const refuse = (reason: string) => json(503, { reason });

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

  async function guarded(
    req: Request,
    work: (sql: Sql) => Promise<Response>,
    opts: { dispatch?: boolean } = {},
  ): Promise<Response> {
    const early = staticGate();
    if (early) return early;
    if (opts.dispatch) {
      if (!gatewayBase()) return refuse("gateway_origin_not_allowed");
      const key = cfg.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const m = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "");
      if (!key || !m || !(await sameSecret(m[1]!, key)))
        return json(401, { reason: "unauthorized" });
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

  const inbound = (req: Request) =>
    guarded(req, async (sql) => {
      if (req.method !== "POST") return json(405, { reason: "method_not_allowed" });
      if (!isJson(req)) return json(415, { reason: "unsupported_media_type" });
      const read = await readBody(req);
      if ("reason" in read) return json(read.status, { reason: read.reason });
      const reg = await loadRegistry(sql);
      const t = nowSec();
      const receiptKey = currentKey(reg, cfg.app, t);
      if (!receiptKey) return refuse("no_receipt_key");
      const effect: AdmissionEffect = async (tx, e) => {
        const r = await cfg.adapter.apply((tx as unknown as { sql: Sql }).sql, e);
        return r.ok ? { ok: true } : { ok: false, reason: r.reason };
      };
      const headers = Object.fromEntries(req.headers.entries());
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

  const dispatch = (req: Request) =>
    guarded(
      req,
      async (sql) => {
        if (req.method !== "POST") return json(405, { reason: "method_not_allowed" });
        const base = gatewayBase()!;
        const reg = await loadRegistry(sql);
        if (!currentKey(reg, cfg.app, nowSec())) return refuse("no_signing_key");
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
        const out: DispatchResult[] = [];
        for (const row of rows) {
          const envelope = row["envelope"] as EnvelopeV2;
          const body = row["body"] as string;
          const eventId = row["event_id"] as string;
          const gen = Number(row["lease_generation"]);
          const action = row["lease_action"] as "deliver" | "confirm";
          const key = currentKey(reg, cfg.app, nowSec())!;
          let status = 0;
          let doc: { reason?: string | null; receipts?: ReceiptV2[] } = {};
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
          const advanced: string[] = [];
          if (status === 200 && Array.isArray(doc.receipts) && doc.receipts.length)
            advanced.push(
              await advance(
                eventId,
                gen,
                doc.receipts.map((x) => canonicalize(x)),
              ),
            );
          const last = advanced.at(-1);
          if (
            last !== "gateway_admitted" &&
            last !== "consumer_committed" &&
            last !== "target_quarantined"
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
