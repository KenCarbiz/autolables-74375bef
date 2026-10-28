import assert from "node:assert/strict";
import { afSign } from "../../functions/_shared/integrations/adapters/autofilmV1.ts";
import { handleApply } from "../../functions/_shared/integrations/handlers/apply.ts";
import { handleDispatch } from "../../functions/_shared/integrations/handlers/dispatch.ts";
import { handleHealth } from "../../functions/_shared/integrations/handlers/health.ts";
import { handleIngest } from "../../functions/_shared/integrations/handlers/ingest.ts";
import { sign } from "../../functions/_shared/integrations/signing.ts";
import { connect, pgApplyStore, pgDispatchStore, pgHealthStore, pgIngestStore, type Sql } from "./pgStores.ts";

export { assert };

export const DB_URL = Deno.env.get("ROOFTOP_TEST_DB_URL") ?? "";
export const VIN = "1HGCM82633A004352";
export const SERVICE_KEY = "test-service-role-key-not-real";

export const admin: Sql = DB_URL ? connect(DB_URL, null) : (null as unknown as Sql);
const svc: Sql = DB_URL ? connect(DB_URL, "service_role") : (null as unknown as Sql);

export const state = { enabled: true };

export interface Seed {
  tenantId: string;
  connId: string;
  keyId: string;
  secret: string;
  rooftopRef: string | null;
}

export async function seed(opts: {
  adapter?: "rooftop.v1" | "autofilm.v1";
  status?: string;
  flag?: boolean;
  scopes?: string[];
  endpoint?: string | null;
  app?: "autofilm" | "autocurb";
} = {}): Promise<Seed> {
  const tenantId = crypto.randomUUID();
  const connId = crypto.randomUUID();
  const keyId = `k_${crypto.randomUUID().slice(0, 12)}`;
  const secret = `secret-${crypto.randomUUID()}`;
  const adapter = opts.adapter ?? "rooftop.v1";
  const rooftopRef = adapter === "autofilm.v1" ? `af-rooftop-${crypto.randomUUID().slice(0, 8)}` : null;
  await admin`insert into public.tenants (id, name, slug) values (${tenantId}, 'Test Dealer', ${"t-" + tenantId})`;
  await admin`insert into public.vehicles (vin) values (${VIN}) on conflict do nothing`;
  await admin`insert into public.vehicle_instances (tenant_id, vin) values (${tenantId}, ${VIN})`;
  await admin`insert into public.integration_connections (id, tenant_id, app, display_name, status, adapter, external_rooftop_ref, scopes, endpoint_url)
    values (${connId}, ${tenantId}, ${opts.app ?? "autofilm"}, 'conn', ${opts.status ?? "active"}, ${adapter}, ${rooftopRef},
      ${opts.scopes ?? ["inspection:write", "repair:write"]}, ${opts.endpoint ?? null})`;
  await admin`insert into vault.secrets (name, secret) values (${"vault_" + keyId}, ${secret})`;
  await admin`insert into public.integration_connection_keys (connection_id, key_id, vault_secret_name) values (${connId}, ${keyId}, ${"vault_" + keyId})`;
  if (opts.flag !== false) {
    const dir = (opts.app ?? "autofilm") === "autofilm" ? "film_to_labels" : "curb_to_labels";
    await admin`insert into public.integration_direction_flags (tenant_id, direction, enabled) values (${tenantId}, ${dir}, true)`;
  }
  return { tenantId, connId, keyId, secret, rooftopRef };
}

export interface Hooks {
  failApplyTimes?: () => boolean;
  fetcher?: typeof fetch;
}

const authorize = (req: Request) => (req.headers.get("Authorization") || "") === `Bearer ${SERVICE_KEY}`;
export const SERVICE_HEADERS = { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

export function startServer(hooks: Hooks = {}) {
  const apply = pgApplyStore(svc);
  const flaky = {
    ...apply,
    apply: (id: string, plan: Parameters<typeof apply.apply>[1]) => {
      if (hooks.failApplyTimes?.()) return Promise.reject(new Error("injected_failure"));
      return apply.apply(id, plan);
    },
  };
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    const path = new URL(req.url).pathname;
    const enabled = () => state.enabled;
    if (path === "/ingest") return handleIngest(req, { enabled, store: () => pgIngestStore(svc) });
    if (path === "/apply") return handleApply(req, { enabled, authorize, store: () => flaky, random: () => 0.5 });
    if (path === "/dispatch") {
      return handleDispatch(req, { enabled, authorize, store: () => pgDispatchStore(svc), fetcher: hooks.fetcher, random: () => 0.5 });
    }
    if (path === "/health") return handleHealth(req, { enabled, store: () => pgHealthStore(svc) });
    return new Response("not found", { status: 404 });
  });
  const base = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
  return {
    base,
    close: () => server.shutdown(),
    post: (path: string, body: string, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, { method: "POST", body, headers: { "Content-Type": "application/json", ...headers } }),
  };
}

export const envelopeFor = (over: Record<string, unknown> = {}) => ({
  event_id: crypto.randomUUID(),
  event_type: "autofilm.inspection.completed",
  schema_version: "1.0.0",
  producer: "autofilm",
  source_record_id: `mpi_${crypto.randomUUID().slice(0, 8)}`,
  source_version: 1,
  idempotency_key: `idem-${crypto.randomUUID()}`,
  correlation_id: "case-1",
  causation_id: null,
  occurred_at: "2026-10-28T19:00:00Z",
  observed_at: "2026-10-28T18:55:00Z",
  sent_at: "2026-10-28T19:01:00Z",
  vin: VIN,
  tenant_ref: "ADVISORY",
  instance_ref: null,
  visibility: "tenant_private",
  evidence_refs: ["film-evidence:1"],
  payload: { inspection_id: "x", odometer_miles: 45123, measurements: { lf_tire_32nds: 8 }, technician_verified: false },
  ...over,
});

export async function nativeHeaders(s: Seed, body: string, over: { ts?: number; secret?: string; keyId?: string } = {}) {
  const ts = String(over.ts ?? Math.floor(Date.now() / 1000));
  const keyId = over.keyId ?? s.keyId;
  return {
    "x-rooftop-key-id": keyId,
    "x-rooftop-timestamp": ts,
    "x-rooftop-signature": await sign(over.secret ?? s.secret, ts, s.keyId, body),
  };
}

export async function afHeaders(s: Seed, body: string, over: { ts?: number; secret?: string } = {}) {
  const ts = String(over.ts ?? Date.now());
  return { "x-af-timestamp": ts, "x-af-signature": await afSign(over.secret ?? s.secret, ts, body) };
}

export const afBody = (s: Seed, event: string, data: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    event,
    event_id: `evt-${crypto.randomUUID().slice(0, 8)}`,
    schema_version: "1",
    tenant_id: s.rooftopRef,
    data,
    ...over,
  });

export async function runApply(srv: ReturnType<typeof startServer>, limit = 100) {
  const res = await srv.post("/apply", JSON.stringify({ limit }), SERVICE_HEADERS);
  return { status: res.status, body: await res.json() as { claimed: number; outcomes: Record<string, number> } };
}

export const inboxOf = async (tenantId: string) =>
  await admin`select * from public.integration_inbox where tenant_id = ${tenantId} order by received_at, id`;
