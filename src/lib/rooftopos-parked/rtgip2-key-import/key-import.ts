// One-time, staging-only import of an rtgip/2 key from this app's Edge Function secrets into its
// database Vault (C-S4 Alternative S1). Byte-identical in AutoLabels, AutoCurb and AutoFrame
// (PROVENANCE.json). The runtime and the frozen delivery SQL are unchanged: after the import, the
// existing inbox_admit and receipt_check_signature read the key from Vault exactly as before.
//
// The secret travels only from the function environment to the database, as a bind parameter on
// one server-side call. It is never written into SQL text, a response, a log line, an error or a URL.
// Gates, in order, before the body is parsed or any secret is read: the compiled literal, the
// compiled staging backend, the request shape. Authorization is a single-use ticket issued by the
// database owner (rtgip.key_import_tickets): the token is checked, the ticket is claimed and burned
// in its own transaction, and the database re-checks the material against the approved fingerprint
// before it calls vault.create_secret. Every failure answers a fixed code.
import type postgres from "postgres";

export type Sql = postgres.Sql;

/** The only key ids this function will ever import; the database enforces the same list. */
export const KEY_IMPORT_IDS = [
  "stg-gateway-1",
  "stg-autolabels-1",
  "stg-autocurb-1",
  "stg-autoframe-1",
] as const;

export interface KeyImportConfig {
  /** The compiled literal. The deployed entry passes RTGIP2_KEY_IMPORT_ENABLED and nothing else. */
  compiledEnabled: boolean;
  /** Compiled staging project ref; SUPABASE_URL must be exactly https://<ref>.supabase.co. */
  stagingRef: string;
  env: (name: string) => string | undefined;
  /** A client the import owns: it is ended when the request finishes. */
  sql: () => Sql;
}

const REF = /^[a-z0-9]{20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[a-z][a-z0-9_]{0,47}$/;
const MAX_BODY_BYTES = 1024;
/** Keeps every import statement far below auto_explain's 10 s threshold, which would log parameters. */
const STATEMENT_TIMEOUT = "5s";

/** Edge Function secret holding a key's material; the same derivation the Gateway uses. */
export const keySecretName = (keyId: string): string =>
  `RTGIP2_KEY_${keyId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

async function sha256Text(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (status: number, doc: Record<string, unknown>): Response =>
  new Response(JSON.stringify(doc), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** A database refusal raised as a plain code; anything else becomes internal_error. */
const codeOf = (e: unknown): string => {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && CODE.test(m) && m.startsWith("key_import_")
    ? m
    : "internal_error";
};

export function createKeyImport(cfg: KeyImportConfig) {
  function staticGate(): Response | null {
    if (cfg.compiledEnabled !== true)
      return json(503, { reason: "RTGIP2_KEY_IMPORT_NOT_ACTIVATED" });
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
    return ok ? null : json(503, { reason: "not_staging_backend" });
  }

  async function readTicket(req: Request): Promise<{ ticket_id: string; token: string } | null> {
    if (req.method !== "POST") return null;
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
      return null;
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return null;
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > MAX_BODY_BYTES) return null;
    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buf));
    } catch {
      return null;
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    const keys = Object.keys(doc).sort();
    if (keys.length !== 2 || keys[0] !== "ticket_id" || keys[1] !== "token") return null;
    const { ticket_id, token } = doc as Record<string, unknown>;
    if (
      typeof ticket_id !== "string" ||
      !UUID.test(ticket_id) ||
      typeof token !== "string" ||
      !HEX64.test(token)
    )
      return null;
    return { ticket_id, token };
  }

  async function handle(req: Request): Promise<Response> {
    const gate = staticGate();
    if (gate) return gate;
    const t = await readTicket(req).catch(() => null);
    if (!t) return json(400, { reason: "bad_request" });
    let sql: Sql | null = null;
    try {
      sql = cfg.sql();
      const asImporter = <T>(fn: (tx: Sql) => Promise<T>) =>
        sql!.begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE rtgip_key_importer");
          await tx.unsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
          return fn(tx as unknown as Sql);
        }) as Promise<T>;
      // 1. Claim: checks the token, the expiry, the server, the session's logging, transport off and Vault
      //    free. Every refusal burns the ticket and comes back as a status, never as the fingerprint.
      let claimed: { key_id: string; fingerprint: string };
      try {
        const rows = (await asImporter((tx) =>
          tx.unsafe(
            "SELECT status, key_id, fingerprint FROM rtgip.key_import_claim($1::uuid, $2::text)",
            [t.ticket_id, t.token],
          ),
        )) as unknown as { status: unknown; key_id: unknown; fingerprint: unknown }[];
        const r = rows[0];
        if (!r || r.status !== "claimed")
          return json(409, {
            reason:
              typeof r?.status === "string" && CODE.test(r.status)
                ? r.status
                : "key_import_claim_failed",
          });
        if (typeof r.key_id !== "string" || typeof r.fingerprint !== "string")
          return json(409, { reason: "key_import_claim_failed" });
        claimed = { key_id: r.key_id, fingerprint: r.fingerprint };
      } catch (e) {
        return json(409, { reason: codeOf(e) });
      }
      if (
        !(KEY_IMPORT_IDS as readonly string[]).includes(claimed.key_id) ||
        !HEX64.test(claimed.fingerprint)
      )
        return json(409, { reason: "key_import_claim_failed" });
      // 2. Read the material; send it only when it is 64 hex and matches the approved fingerprint.
      const material = cfg.env(keySecretName(claimed.key_id));
      let localReason: string | null = null;
      if (typeof material !== "string" || material === "")
        localReason = "key_import_secret_missing";
      else if (!HEX64.test(material)) localReason = "key_import_secret_malformed";
      else if ((await sha256Text(material)) !== claimed.fingerprint)
        localReason = "key_import_fingerprint_mismatch";
      // 3. Finish: the database re-checks the fingerprint, refuses a duplicate, stores and verifies.
      let outcome: string;
      try {
        const rows = (await asImporter((tx) =>
          tx.unsafe("SELECT rtgip.key_import_finish($1::uuid, $2::text, $3::text, $4::text) AS r", [
            t.ticket_id,
            t.token,
            localReason === null ? material! : null,
            localReason,
          ]),
        )) as unknown as { r: unknown }[];
        outcome =
          typeof rows[0]?.r === "string" ? (rows[0]!.r as string) : "key_import_finish_failed";
      } catch (e) {
        return json(409, { key_id: claimed.key_id, outcome: "refused", reason: codeOf(e) });
      }
      if (outcome === "imported")
        return json(200, {
          key_id: claimed.key_id,
          outcome: "imported",
          fingerprint_verified: true,
        });
      return json(409, {
        key_id: claimed.key_id,
        outcome: "refused",
        reason: CODE.test(outcome) ? outcome : "key_import_finish_failed",
      });
    } catch {
      return json(500, { reason: "internal_error" });
    } finally {
      try {
        await sql?.end({ timeout: 2 });
      } catch {
        /* nothing to report */
      }
    }
  }

  return { handle };
}
