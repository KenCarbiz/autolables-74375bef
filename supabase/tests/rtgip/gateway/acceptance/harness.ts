/** Shared disposable setup for the acceptance checks. Synthetic data, ephemeral keys, local socket only. */
import postgres from "postgres";
import { sealEnvelope, signEnvelope, type EnvelopeV2, type Registry, type ServiceKey } from "../../src/lib/gateway/rtgip2/core";
import { createRtgip2Handler } from "../../src/lib/gateway/rtgip2/handler.server";
import { candidateStore } from "../../src/lib/gateway/rtgip2/store.server";
import { receiptDraft, signReceiptV2, type Outcome, type ReceiptV2, type Stage } from "../../src/lib/gateway/rtgip2/receipt";
import type { IdentityMapping } from "../../src/lib/gateway/rtgip2/verify";
import type { DeliveryLease } from "../../src/lib/gateway/rtgip2/dispatcher.server";

export const now = () => Math.floor(Date.now() / 1000);
export const ephemeral = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
export const connection = "r2-acceptance-connection";
export const TENANT = "grp-syn-northwind";
export const ROOFTOP = "rt-syn-nw-01";

export function openDb() {
  const dbname = process.argv[2];
  if (!dbname || !/^gw_candidate_[a-z0-9_]+$/.test(dbname)) throw new Error("Disposable database name required");
  return postgres({ host: "/tmp/gateway-final/socket", username: "lovable", database: dbname, max: 8, onnotice: () => {} });
}
export type Sql = ReturnType<typeof openDb>;

export function checker(label: string) {
  const results: { name: string; pass: boolean }[] = [];
  return {
    check(name: string, pass: boolean) {
      results.push({ name, pass });
      if (!pass) throw new Error(`${label}: ${name}`);
    },
    report() {
      console.log(JSON.stringify({ suite: label, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length }));
    },
  };
}

export function rpc(sql: Sql) {
  return {
    async call(name: string, args: Record<string, unknown>) {
      if (!/^gw_r2_[a-z_]+$/.test(name)) throw new Error("RPC allowlist");
      const vals = Object.values(args);
      const params = vals.map((v) => (v && typeof v === "object" ? JSON.stringify(v) : v)) as (string | number | null)[];
      const casts = vals.map((v, i) => `$${i + 1}${v && typeof v === "object" ? "::text::jsonb" : ""}`).join(",");
      const rows = await sql.unsafe(`SELECT public.${name}(${casts}) AS result`, params);
      return rows[0]?.["result"];
    },
  };
}

export async function setup(sql: Sql) {
  const keys: ServiceKey[] = ["autolabels", "gateway", "autocurb"].map((owner) => ({
    key_id: `acc-${owner}`,
    owner: owner as ServiceKey["owner"],
    dialect: "rtgip/2",
    connection_ids: [connection],
    status: "current",
    not_before: now() - 60,
    not_after: now() + 3600,
    secret: ephemeral(),
  }));
  const [source, gateway, target] = keys as [ServiceKey, ServiceKey, ServiceKey];
  await sql`INSERT INTO gw_r2_connections(id,source_app,target_app,tenant_id,rooftop_id,events,purposes,status,source_enabled,target_enabled)
    VALUES(${connection},'autolabels','autocurb',${TENANT},${ROOFTOP},ARRAY['inventory.status_changed'],ARRAY['inventory_sync'],'active',true,true)`;
  for (const k of keys)
    await sql`INSERT INTO gw_r2_keys(id,owner,connections,status,not_before,not_after,fingerprint)
      VALUES(${k.key_id},${k.owner},ARRAY[${connection}],'current',to_timestamp(${k.not_before}),to_timestamp(${k.not_after}),${"0".repeat(64)})`;
  await sql`INSERT INTO gw_r2_mappings VALUES(${connection},'acc-instance','acc-episode','acc-store','DEVSYN00000000401','acc-reviewed','active')`;
  const registry: Registry = {
    keys,
    connections: [
      {
        connection_id: connection,
        source_app: "autolabels",
        target_app: "autocurb",
        tenant_id: TENANT,
        rooftop_ids: [ROOFTOP],
        event_types: ["inventory.status_changed"],
        purposes: ["inventory_sync"],
        producer_enabled: true,
        reader_enabled: true,
        status: "active",
      },
    ],
  };
  const mappingOf = (instance_id: string, episode_id: string): IdentityMapping => ({
    vin: "DEVSYN00000000401",
    instance_id,
    episode_id,
    tenant_id: TENANT,
    rooftop_id: ROOFTOP,
    source_app: "autolabels",
    source_store_id: "acc-store",
    connection_id: connection,
    status: "active",
    reviewed_ref: "acc-reviewed",
  });
  const mapping = mappingOf("acc-instance", "acc-episode");
  const mappings: IdentityMapping[] = [mapping];
  async function addMapping(instance_id: string, episode_id: string) {
    await sql`INSERT INTO gw_r2_mappings VALUES(${connection},${instance_id},${episode_id},'acc-store','DEVSYN00000000401','acc-reviewed','active')`;
    mappings.push(mappingOf(instance_id, episode_id));
  }
  const store = candidateStore(rpc(sql), async () => gateway.key_id);
  const handler = createRtgip2Handler(
    {
      registry: async () => ({ registry, mappings }),
      now,
      ...store,
      resolveSigningKey: async (id) => keys.find((k) => k.key_id === id) ?? null,
    },
    true,
  );
  let nonce = 0;
  async function admit(revision: number, origin = `acc-origin-${revision}`, instance_id = "acc-instance", episode_id = "acc-episode") {
    const { envelope, body } = await sealEnvelope({
      protocol: "rtgip/2",
      schema_version: 2,
      event_id: "",
      event_type: "inventory.status_changed",
      source_app: "autolabels",
      target_app: "autocurb",
      route: "autolabels->autocurb",
      purpose: "inventory_sync",
      tenant_id: TENANT,
      rooftop_id: ROOFTOP,
      vehicle: { vin: "DEVSYN00000000401", instance_id, episode_id },
      aggregate: { domain: "inventory", type: "episode", id: episode_id, revision, prev_revision: revision > 1 ? revision - 1 : null },
      origin: { app: "autolabels", event_id: origin, revision },
      correlation_id: "acc-correlation",
      causation_id: null,
      occurred_at: new Date().toISOString(),
      emitted_at: new Date().toISOString(),
      classification: "shared_vehicle_fact",
      payload: { status: "in_stock", stock_number: `ACC-${revision}`, changed_at: new Date().toISOString() },
    });
    const headers = await signEnvelope(body, envelope, source, now(), `acc_nonce_${String(++nonce).padStart(8, "0")}`);
    const res = await handler(
      new Request("http://localhost/acceptance", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body }),
    );
    const json = (await res.json()) as { receipt?: ReceiptV2; error?: string };
    if (res.status !== 200 || !json.receipt) throw new Error(`admission refused: ${res.status} ${json.error ?? ""}`);
    return { envelope, body, admission: json.receipt };
  }
  async function claim(worker = "acc-worker"): Promise<Record<string, unknown>[]> {
    return [...(await sql`SELECT * FROM gw_r2_claim(${worker},4,5)`)];
  }
  const lease = (row: Record<string, unknown>, a: { envelope: EnvelopeV2; body: string; admission: ReceiptV2 }): DeliveryLease => ({
    delivery_id: String(row["delivery_id"]),
    connection_id: connection,
    generation: Number(row["generation"]),
    token: String(row["token"]),
    canonical_body: a.body,
    envelope: a.envelope,
    admission_receipt: a.admission,
  });
  async function targetReceipt(l: DeliveryLease, kind: Stage, outcome: Outcome, prev: ReceiptV2) {
    return signReceiptV2(await receiptDraft({ ...l, kind }, outcome, now(), prev), target);
  }
  return { keys, source, gateway, target, registry, mapping, mappings, addMapping, store, handler, admit, claim, lease, targetReceipt };
}
