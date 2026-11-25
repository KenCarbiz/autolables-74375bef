// Test-only plumbing for the runtime's database-backed tests: a registry mirrored into one
// disposable app node, a loopback stub Gateway, and the generated bundle served under Deno with
// the compiled literal injected by the test (never by the runtime). Disposable clusters only.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import {
  MemoryNonceStore,
  ROUTES,
  canonicalize,
  sha256Hex,
  signEnvelope,
  verifyDelivery,
  type AppId,
  type EnvelopeV2,
  type EventType,
  type Purpose,
  type Registry,
  type ServiceConnection,
  type ServiceKey,
} from "../rtgip2/protocol.ts";
import { ADMISSION_HEADER, encodeAdmissionHeader } from "../rtgip2/admission.ts";
import {
  deliveryIdentity,
  receiptDraft,
  signReceiptV2,
  type ReceiptV2,
} from "../rtgip2/receipt-v2.ts";
import { verifyReceiptQuery } from "../rtgip2/receipt-query.ts";
import { confirmationDraft, signConfirmation, type ConfirmationOutcome } from "./source-chain.ts";

export type Sql = ReturnType<typeof postgres>;
export type App = "autolabels" | "autocurb" | "autoframe";
export const DENO_BIN = process.env["RTGIP_DENO"] ?? "/tmp/denobin/node_modules/.bin/deno";
export const denoAvailable = () => existsSync(DENO_BIN);
export const nowSec = () => Math.floor(Date.now() / 1000);
export const connIdOf = (s: AppId, t: AppId, tenant: string) => `conn:${s}>${t}:${tenant}`;

export function grant(
  source: AppId,
  target: AppId,
  tenant: string,
  rooftops: readonly string[],
): ServiceConnection {
  const route = ROUTES.find(
    (r) => r.source === source && r.target === target && r.phase === "three_app",
  )!;
  return {
    connection_id: connIdOf(source, target, tenant),
    source_app: source,
    target_app: target,
    tenant_id: tenant,
    rooftop_ids: [...rooftops],
    event_types: Object.keys(route.events) as EventType[],
    purposes: [...new Set(Object.values(route.events).flat())] as Purpose[],
    producer_enabled: true,
    reader_enabled: true,
    status: "active",
  };
}

export const APP_PAIRS: readonly [App, App][] = [
  ["autolabels", "autocurb"],
  ["autolabels", "autoframe"],
  ["autocurb", "autolabels"],
  ["autocurb", "autoframe"],
  ["autoframe", "autolabels"],
  ["autoframe", "autocurb"],
];

/** Fresh keys for the Gateway and the three apps, valid around the real clock. */
export function makeRegistry(connections: readonly ServiceConnection[]): Registry {
  const n = nowSec();
  const ids = connections.map((c) => c.connection_id);
  const key = (owner: ServiceKey["owner"]): ServiceKey => ({
    key_id: `c0-${owner}-${randomBytes(4).toString("hex")}`,
    owner,
    dialect: "rtgip/2",
    connection_ids:
      owner === "gateway"
        ? ids
        : connections
            .filter((c) => c.source_app === owner || c.target_app === owner)
            .map((c) => c.connection_id),
    status: "current",
    not_before: n - 3600,
    not_after: n + 86_400,
    secret: randomBytes(32).toString("base64url"),
  });
  return {
    connections,
    keys: [key("gateway"), key("autolabels"), key("autocurb"), key("autoframe")],
  };
}

export const keyOf = (reg: Registry, owner: ServiceKey["owner"]): ServiceKey =>
  reg.keys.find((k) => k.owner === owner && k.status === "current")!;

/**
 * Mirror the registry into the node's own delivery tables and Vault stand-in; set local_app. Under
 * AR-1 option 1 the node holds exactly its own key (audience gateway) and the Gateway key towards
 * it (audience = the app); no other app's key is ever written to it.
 */
export async function seedRegistry(sql: Sql, reg: Registry, app: App): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("DELETE FROM rtgip.signing_keys");
    await tx.unsafe("DELETE FROM vault.decrypted_secrets WHERE name LIKE 'rtgip:%'");
    const arr = (n: number) => `ARRAY(SELECT jsonb_array_elements_text($${n}::text::jsonb))`;
    for (const c of reg.connections)
      await tx.unsafe(
        `INSERT INTO rtgip.connections (connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status)
         VALUES ($1, $2, $3, $4, ${arr(5)}, ${arr(6)}, ${arr(7)}, $8, $9, $10)
         ON CONFLICT (connection_id) DO UPDATE SET status = EXCLUDED.status, producer_enabled = EXCLUDED.producer_enabled, reader_enabled = EXCLUDED.reader_enabled,
           event_types = EXCLUDED.event_types, purposes = EXCLUDED.purposes, rooftop_ids = EXCLUDED.rooftop_ids`,
        [
          c.connection_id,
          c.source_app,
          c.target_app,
          c.tenant_id,
          JSON.stringify(c.rooftop_ids),
          JSON.stringify(c.event_types),
          JSON.stringify(c.purposes),
          c.producer_enabled,
          c.reader_enabled,
          c.status,
        ],
      );
    for (const k of reg.keys) {
      if (k.owner !== app && k.owner !== "gateway") continue;
      await tx.unsafe(
        `INSERT INTO rtgip.signing_keys (key_id, owner, dialect, connection_ids, status, not_before, not_after, secret_ref, audience)
         VALUES ($1, $2, $3, ${arr(4)}, $5, to_timestamp($6::bigint), to_timestamp($7::bigint), $8, $9)`,
        [
          k.key_id,
          k.owner,
          k.dialect,
          JSON.stringify(k.connection_ids),
          k.status,
          k.not_before,
          k.not_after,
          "rtgip:" + k.key_id,
          k.owner === "gateway" ? app : "gateway",
        ],
      );
      await tx.unsafe(
        "INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES ($1, $2)",
        ["rtgip:" + k.key_id, k.secret],
      );
    }
    await tx`UPDATE rtgip.delivery_config SET local_app = ${app}`;
  });
}

/** The throwaway cluster only: lift the CHECK that pins transport off, so the database kill switch can be exercised. */
export async function liftTransportCheck(sql: Sql): Promise<void> {
  const cons =
    await sql`SELECT conname FROM pg_constraint WHERE conrelid = 'rtgip.delivery_config'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%transport_enabled%'`;
  for (const c of cons)
    await sql.unsafe(`ALTER TABLE rtgip.delivery_config DROP CONSTRAINT "${String(c["conname"])}"`);
}
export const setTransport = (sql: Sql, on: boolean, localApp?: App) =>
  sql`UPDATE rtgip.delivery_config SET transport_enabled = ${on}, local_app = coalesce(${localApp ?? null}, local_app)`;

/** What a Gateway sends a target app: the forwarded delivery signed by the Gateway plus its admission receipt. */
export async function gatewayDelivery(
  reg: Registry,
  envelope: EnvelopeV2,
  body: string,
  connectionId: string,
  opts: { nonce?: string; at?: number } = {},
): Promise<{ headers: Record<string, string>; admission: ReceiptV2; deliveryId: string }> {
  const gw = keyOf(reg, "gateway");
  const at = opts.at ?? nowSec();
  const deliveryId = await deliveryIdentity(envelope, connectionId);
  const admission = await signReceiptV2(
    await receiptDraft(
      { envelope, connection_id: connectionId, delivery_id: deliveryId, kind: "gateway_admission" },
      "admitted",
      at,
      null,
    ),
    gw,
  );
  const nonce = opts.nonce ?? `gw_${randomBytes(12).toString("hex")}`;
  const signed = (await signEnvelope(body, envelope, gw, at, nonce)) as unknown as Record<
    string,
    string
  >;
  return {
    headers: {
      "content-type": "application/json",
      ...signed,
      [ADMISSION_HEADER]: encodeAdmissionHeader(admission),
    },
    admission,
    deliveryId,
  };
}

export interface StubGateway {
  url: string;
  origin: string;
  seen: { path: string; body: string; verified: boolean; reason: string | null }[];
  close(): Promise<void>;
}

/**
 * A loopback Gateway: verifies the source's signed delivery, answers with a signed admission
 * receipt; answers a signed receipt query (AR-1 A1-5) with [admission, gateway_confirmation] and,
 * as unverified evidence, a target_inbox receipt signed with the target's key.
 */
export async function startStubGateway(
  reg: Registry,
  opts: { confirmOutcome?: ConfirmationOutcome } = {},
): Promise<StubGateway> {
  const seen: StubGateway["seen"] = [];
  const nonces = new MemoryNonceStore();
  const admitted = new Map<
    string,
    { envelope: EnvelopeV2; connection_id: string; admission: ReceiptV2 }
  >();
  const srv = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const reply = (status: number, doc: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(doc));
    };
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.join(",") : (v as string),
      ]),
    );
    if (req.method === "POST" && req.url === "/api/rtgip/v2/receipts") {
      const q = await verifyReceiptQuery(headers, body, {
        registry: reg,
        nonces,
        nowSec: nowSec(),
        lookup: (id) => {
          const a = admitted.get(id);
          return a
            ? {
                connection_id: a.connection_id,
                source_app: a.envelope.source_app,
                tenant_id: a.envelope.tenant_id,
                event_id: a.envelope.event_id,
              }
            : null;
        },
      });
      if ("reason" in q) {
        seen.push({ path: req.url, body, verified: false, reason: q.reason });
        return reply(401, { reason: q.reason });
      }
      seen.push({ path: req.url, body, verified: true, reason: null });
      const a = admitted.get(q.query.delivery_id)!;
      const expect = {
        envelope: a.envelope,
        connection_id: a.connection_id,
        delivery_id: q.query.delivery_id,
      };
      const evidence = await signReceiptV2(
        await receiptDraft(
          { ...expect, kind: "target_inbox" },
          "applied",
          a.admission.issued_at,
          a.admission,
        ),
        keyOf(reg, a.envelope.target_app),
      );
      const confirmation = await signConfirmation(
        await confirmationDraft(
          expect,
          opts.confirmOutcome ?? "consumer_committed",
          a.admission.issued_at,
          a.admission,
        ),
        keyOf(reg, "gateway"),
      );
      // A1-5: the Gateway-signed stages, plus the target chain as evidence the source never verifies.
      return reply(200, {
        reason: null,
        receipts: [a.admission, confirmation],
        target_evidence:
          opts.confirmOutcome === "delivery_abandoned" ? [a.admission] : [a.admission, evidence],
      });
    }
    if (req.method !== "POST" || req.url !== "/api/rtgip/v2/deliver") {
      seen.push({ path: String(req.url), body, verified: false, reason: "not_a_deliver" });
      return reply(404, { reason: "not_found" });
    }
    const v = await verifyDelivery(headers, body, {
      registry: reg,
      nonces,
      nowSec: nowSec(),
      expectedSigner: "source",
    });
    if ("reason" in v) {
      seen.push({ path: req.url, body, verified: false, reason: v.reason });
      return reply(401, { reason: v.reason });
    }
    seen.push({ path: req.url, body, verified: true, reason: null });
    const e = v.delivery.envelope;
    const deliveryId = await deliveryIdentity(e, v.delivery.connection_id);
    const admission = await signReceiptV2(
      await receiptDraft(
        {
          envelope: e,
          connection_id: v.delivery.connection_id,
          delivery_id: deliveryId,
          kind: "gateway_admission",
        },
        "admitted",
        nowSec(),
        null,
      ),
      keyOf(reg, "gateway"),
    );
    admitted.set(deliveryId, { envelope: e, connection_id: v.delivery.connection_id, admission });
    reply(200, { reason: null, receipts: [admission] });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = (srv.address() as net.AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  return { url: origin, origin, seen, close: () => new Promise((ok) => srv.close(() => ok())) };
}

const freePort = () =>
  new Promise<number>((ok, bad) => {
    const s = net.createServer();
    s.once("error", bad);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => ok(p));
    });
  });

export interface DenoServer {
  url: string;
  stop(): Promise<void>;
  log(): string;
}

async function serve(script: string, env: Record<string, string>): Promise<DenoServer> {
  const port = await freePort();
  const out: string[] = [];
  const child: ChildProcess = spawn(
    DENO_BIN,
    ["run", "--allow-net", "--allow-env", "--allow-read", script],
    {
      env: {
        ...process.env,
        DENO_DIR: process.env["DENO_DIR"] ?? path.join(os.tmpdir(), "rtgip2-deno-cache"),
        DENO_CERT: process.env["DENO_CERT"] ?? "/root/.ccr/ca-bundle.crt",
        NO_COLOR: "1",
        TEST_PORT: String(port),
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (d) => out.push(String(d)));
  child.stderr?.on("data", (d) => out.push(String(d)));
  const url = `http://127.0.0.1:${port}`;
  const stop = () =>
    new Promise<void>((ok) => {
      if (child.exitCode !== null) return ok();
      child.once("exit", () => ok());
      child.kill("SIGKILL");
    });
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`deno exited early: ${out.join("")}`);
    try {
      await fetch(`${url}/ping`);
      break;
    } catch {
      if (Date.now() > deadline) {
        await stop();
        throw new Error(`deno did not start: ${out.join("")}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return { url, stop, log: () => out.join("") };
}

export interface RuntimeServerOptions {
  bundleFile: string;
  dbUrl: string;
  stagingRef: string;
  gatewayOrigin: string;
  serviceRoleKey: string;
  mode?: string;
  /** The compiled literal, supplied by the test file because the deployed entries pass false. */
  compiledEnabled: boolean;
  /** Further platform environment, such as the rtgip/3 pins, signing secret and verifier digest. */
  env?: Record<string, string>;
}

/** A test-built runtime from the generated bundle: /inbound, /dispatch and /publish on one loopback port. */
export async function startRuntimeServer(o: RuntimeServerOptions): Promise<DenoServer> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rtgip2-entry-"));
  const entry = path.join(dir, "entry.ts");
  writeFileSync(
    entry,
    `import postgres from "npm:postgres@3.4.5";
import * as B from ${JSON.stringify(pathToFileURL(o.bundleFile).href)};
const rt = B.createAppRuntime({
  ...B.APP_BINDINGS,
  compiledEnabled: ${o.compiledEnabled ? "true" : "false"},
  stagingRef: B.STAGING_PROJECT_REF,
  gatewayOrigins: [Deno.env.get("TEST_GATEWAY_ORIGIN")],
  gatewayHttpsOnly: false,
  env: (n) => Deno.env.get(n),
  sql: () => postgres(Deno.env.get("SUPABASE_DB_URL"), { prepare: false, max: 3, idle_timeout: 5, onnotice: () => {} }),
  getUser: async (t) => (/^user-[0-9a-f-]{36}$/.test(t) ? { id: t.slice(5) } : null),
});
Deno.serve({ hostname: "127.0.0.1", port: Number(Deno.env.get("TEST_PORT")) }, (req) => {
  const p = new URL(req.url).pathname;
  if (p === "/inbound") return rt.inbound(req);
  if (p === "/dispatch") return rt.dispatch(req);
  if (p === "/publish") return rt.publish(req);
  return new Response("{}", { status: 404 });
});
`,
  );
  return serve(entry, {
    SUPABASE_URL: `https://${o.stagingRef}.supabase.co`,
    SUPABASE_DB_URL: o.dbUrl,
    SUPABASE_SERVICE_ROLE_KEY: o.serviceRoleKey,
    SUPABASE_ANON_KEY: "anon-key-for-local-tests",
    RTGIP2_RUNTIME_MODE: o.mode ?? "staging",
    RTGIP2_GATEWAY_URL: o.gatewayOrigin,
    TEST_GATEWAY_ORIGIN: o.gatewayOrigin,
    ...o.env,
  });
}

/** One of the committed function entries, run exactly as deployed (the compiled literal and nothing else). */
export function startDeployedEntry(
  indexFile: string,
  env: Record<string, string>,
): Promise<DenoServer> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rtgip2-deployed-"));
  const wrapper = path.join(dir, "run.ts");
  writeFileSync(
    wrapper,
    `const serve = Deno.serve.bind(Deno);
(Deno as { serve: unknown }).serve = (handler: Deno.ServeHandler) => serve({ hostname: "127.0.0.1", port: Number(Deno.env.get("TEST_PORT")) }, handler);
await import(${JSON.stringify(pathToFileURL(indexFile).href)});
`,
  );
  return serve(wrapper, env);
}

export const postJson = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

export const sha = sha256Hex;
export { canonicalize };
