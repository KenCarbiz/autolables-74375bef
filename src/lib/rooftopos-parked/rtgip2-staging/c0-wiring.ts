// Test-only plumbing for the C0 local acceptance (c0-runtime.pg.test.ts): the real Gateway route
// handlers served by Signal Hub's own serve-gateway.ts, a transparent proxy in front of each app
// target that can drop an acknowledgement, a crash-after-effect trigger installed in a disposable
// database, and thin clients for the real runtime entries. None of this exists in product code.
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { canonicalize, signEnvelope, type EnvelopeV2 } from "../rtgip2/protocol.ts";
import { signReceiptQuery } from "../rtgip2/receipt-query.ts";
import type { ReceiptV2 } from "../rtgip2/receipt-v2.ts";
import type { DispatchResult, Sql } from "./nodes.ts";

export const freePort = () =>
  new Promise<number>((ok, bad) => {
    const s = net.createServer();
    s.once("error", bad);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => ok(p));
    });
  });

export const keySecretName = (keyId: string) => `RTGIP2_KEY_${keyId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

export interface Child {
  url: string;
  stop(): Promise<void>;
  log(): string;
}

async function waitFor(url: string, child: ChildProcess, out: string[], what: string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`${what} exited early: ${out.join("")}`);
    try {
      await fetch(url);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`${what} did not start: ${out.join("")}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** Signal Hub's scripts/acceptance/serve-gateway.ts under that repository's own bun toolchain. */
export async function startGatewayServer(o: {
  shRepo: string;
  bun: string;
  dbUrl: string;
  endpoints: Record<string, string>;
  cronSecret: string;
  keySecrets: Record<string, string>;
}): Promise<Child> {
  const port = await freePort();
  const out: string[] = [];
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NO_COLOR: "1",
    GW_DB_URL: o.dbUrl,
    GW_PORT: String(port),
    GW_TARGET_ENDPOINTS: JSON.stringify(o.endpoints),
    GW_CRON_SECRET: o.cronSecret,
  };
  for (const [id, secret] of Object.entries(o.keySecrets)) env[keySecretName(id)] = secret;
  const child = spawn(o.bun, [path.join(o.shRepo, "scripts/acceptance/serve-gateway.ts")], { cwd: o.shRepo, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d) => out.push(String(d)));
  child.stderr?.on("data", (d) => out.push(String(d)));
  const url = `http://127.0.0.1:${port}`;
  const stop = () =>
    new Promise<void>((ok) => {
      if (child.exitCode !== null) return ok();
      child.once("exit", () => ok());
      child.kill("SIGKILL");
    });
  try {
    await waitFor(`${url}/ping`, child, out, "serve-gateway");
  } catch (e) {
    await stop();
    throw e;
  }
  return { url, stop, log: () => out.join("") };
}

export interface Proxy {
  url: string;
  /** Forward the next n requests to the app, let the app commit, then cut the connection without an answer. */
  dropNext(n: number): void;
  dropped(): number;
  close(): Promise<void>;
}

/**
 * The address the Gateway forwards to for one app. Transparent: POST /rtgip/v2/inbound goes to the
 * app's rtgip-inbound entry, the answer comes back untouched. Armed by the test, it returns nothing.
 */
export async function startForwardProxy(target: () => string): Promise<Proxy> {
  let drops = 0;
  let dropped = 0;
  const srv = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (req.method !== "POST" || req.url !== "/rtgip/v2/inbound") {
      res.writeHead(404, { "content-type": "application/json" });
      return void res.end("{}");
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (["host", "connection", "content-length", "transfer-encoding"].includes(k)) continue;
      headers[k] = Array.isArray(v) ? v.join(",") : (v as string);
    }
    const upstream = await fetch(`${target()}/inbound`, { method: "POST", headers, body: new Uint8Array(Buffer.concat(chunks)) });
    const body = Buffer.from(await upstream.arrayBuffer());
    if (drops > 0) {
      drops--;
      dropped++;
      req.socket.destroy();
      return;
    }
    res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
    res.end(body);
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = (srv.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    dropNext: (n) => void (drops = n),
    dropped: () => dropped,
    close: () => new Promise<void>((ok) => (srv.closeAllConnections(), srv.close(() => ok()))),
  };
}

/**
 * Crash after the effect, injected in the disposable database only: a deferred constraint trigger on
 * the app's applied-event ledger raises at COMMIT while a ticket from a sequence is within the armed
 * budget. The sequence is not transactional, so the failed attempt consumes its ticket and the retry passes.
 */
export async function installCrashTrigger(sql: Sql, ledger: string): Promise<void> {
  const name = ledger.replace(/\W/g, "_");
  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS c0_fault;
    CREATE TABLE IF NOT EXISTS c0_fault.budget (id boolean PRIMARY KEY DEFAULT true CHECK (id), crash_through bigint NOT NULL DEFAULT 0);
    INSERT INTO c0_fault.budget (id) VALUES (true) ON CONFLICT DO NOTHING;
    CREATE SEQUENCE IF NOT EXISTS c0_fault.tickets;
    CREATE OR REPLACE FUNCTION c0_fault.crash_at_commit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
    BEGIN
      IF nextval('c0_fault.tickets') <= (SELECT crash_through FROM c0_fault.budget) THEN
        RAISE EXCEPTION 'c0_injected_crash_after_effect';
      END IF;
      RETURN NULL;
    END $f$;
    DROP TRIGGER IF EXISTS c0_crash_${name} ON ${ledger};
    CREATE CONSTRAINT TRIGGER c0_crash_${name} AFTER INSERT ON ${ledger} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION c0_fault.crash_at_commit();
  `);
}
export async function armCrash(sql: Sql, n: number): Promise<void> {
  await sql.unsafe(`UPDATE c0_fault.budget SET crash_through = (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM c0_fault.tickets) + ${Number(n)}`);
}
export async function crashesLeft(sql: Sql): Promise<number> {
  const r = await sql.unsafe(`SELECT greatest(0, b.crash_through - (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM c0_fault.tickets))::int AS n FROM c0_fault.budget b`);
  return Number(r[0]!["n"]);
}

/** One pass of the app's real rtgip-dispatch entry (service-role bearer). */
export async function appDispatch(appUrl: string, serviceKey: string): Promise<DispatchResult[]> {
  const r = await fetch(`${appUrl}/dispatch`, { method: "POST", headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" }, body: "{}" });
  if (r.status !== 200) throw new Error(`dispatch ${r.status}: ${await r.text()}`);
  return (await r.json()) as DispatchResult[];
}

/** One Gateway forwarding pass (the real handleDispatch). */
export async function gatewayDispatch(gwUrl: string, cron: string): Promise<{ status: number; results: string[]; error?: string }> {
  const r = await fetch(`${gwUrl}/api/rtgip/v2/dispatch`, { method: "POST", headers: { authorization: `Bearer ${cron}`, "content-type": "application/json" }, body: "{}" });
  const doc = (await r.json()) as { results?: string[]; error?: string };
  return { status: r.status, results: doc.results ?? [], ...(doc.error ? { error: doc.error } : {}) };
}

export async function gatewayRegistrySync(gwUrl: string, cron: string) {
  const r = await fetch(`${gwUrl}/api/rtgip/v2/registry-sync`, { method: "POST", headers: { authorization: `Bearer ${cron}`, "content-type": "application/json" }, body: "{}" });
  return { status: r.status, doc: (await r.json()) as Record<string, unknown> };
}

/** The signed receipt query a source sends the Gateway. */
export async function queryChain(gwUrl: string, key: Parameters<typeof signReceiptQuery>[1], deliveryId: string, eventId: string, now: number) {
  const q = await signReceiptQuery({ delivery_id: deliveryId, event_id: eventId }, key, now, `qry_${randomUUID().replace(/-/g, "")}`);
  const r = await fetch(`${gwUrl}/api/rtgip/v2/receipts`, { method: "POST", headers: { "content-type": "application/json", ...(q.headers as unknown as Record<string, string>) }, body: q.body });
  return { status: r.status, doc: (await r.json()) as { reason?: string | null; error?: string; receipts?: ReceiptV2[] } };
}

export { canonicalize, signEnvelope };
export type { EnvelopeV2 };
