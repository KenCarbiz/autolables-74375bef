// @vitest-environment node
// The generated bundle, served under Deno, against one disposable AutoLabels node (built from empty
// by supabase/tests/rtgip/autolabels_node.sh, the transport CHECK lifted in that throwaway cluster
// only by runtime_pg.sh). The compiled literal is injected by this test file; the committed entries
// are also run as deployed to show they refuse.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { produceFor } from "../rtgip2/produce.ts";
import type { AppId, EnvelopeV2, EventType, Registry } from "../rtgip2/protocol.ts";
import { verifyReceiptV2, type ReceiptV2 } from "../rtgip2/receipt-v2.ts";
import { labelsStagingAdapter as A } from "./staging-adapter.ts";
import {
  APP_PAIRS,
  connIdOf,
  denoAvailable,
  grant,
  gatewayDelivery,
  liftTransportCheck,
  makeRegistry,
  nowSec,
  postJson,
  seedRegistry,
  setTransport,
  startDeployedEntry,
  startRuntimeServer,
  startStubGateway,
  type DenoServer,
  type Sql,
  type StubGateway,
} from "../rtgip2-runtime/pg-harness.ts";

const PG_URL = process.env.RTGIP_PG_URL ?? "";
const S = {
  tenant: process.env.AL_SEED_TENANT ?? "",
  other: process.env.AL_SEED_OTHER_TENANT ?? "",
  rooftop: process.env.AL_SEED_ROOFTOP ?? "",
  open: process.env.AL_SEED_OPEN_EPISODE ?? "",
};
const run = describe.runIf(!!PG_URL && !!S.tenant && denoAvailable());
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BUNDLE = path.join(ROOT, "supabase/functions/_shared/rtgip2-runtime.bundle.js");
const STAGING_REF = "uakiwvigsmrlyfpsalai";
const SERVICE_KEY = `svc-${randomUUID()}`;
const VIN_OPEN = "1M8GDM9AXKP042801";
const AT = "2026-11-03T10:00:00Z";
const UNMAPPED_ROOFTOP = "rf-stg-99";

let sql: Sql;
let reg: Registry;
let gw: StubGateway;
let rt: DenoServer;

async function appraisal(over: { tenant?: string; rooftop?: string; origin: string; agg?: string }) {
  const [out] = await produceFor(
    {
      source: "autocurb",
      event_type: "appraisal.completed" as EventType,
      tenant_id: over.tenant ?? S.tenant,
      rooftop_id: over.rooftop ?? S.rooftop,
      vehicle: { vin: VIN_OPEN, instance_id: S.open, episode_id: S.open },
      aggregate_id: over.agg ?? `apr-${randomUUID()}`,
      revision: 1,
      prev_revision: null,
      origin_event_id: over.origin,
      correlation_id: "corr-c0",
      causation_id: null,
      occurred_at: AT,
      emitted_at: AT,
      payload: { verified_state: "finalized", appraisal_ref: "apr-1", verified_by_ref: "staff-1", finalized_at: AT, audit_ref: "aud-apr-1" },
    },
    ["autolabels"] as AppId[],
  );
  return out!;
}

async function deliver(p: { envelope: EnvelopeV2; body: string }, tenant = S.tenant, nonce?: string, at?: number) {
  const g = await gatewayDelivery(reg, p.envelope, p.body, connIdOf("autocurb", "autolabels", tenant), { ...(nonce ? { nonce } : {}), ...(at ? { at } : {}) });
  const r = await postJson(`${rt.url}/inbound`, p.body, g.headers);
  return { status: r.status, doc: (await r.json()) as { reason: string | null; receipts: ReceiptV2[] }, g };
}

const publishAs = (user: string, body: unknown) =>
  postJson(`${rt.url}/publish`, JSON.stringify(body), { authorization: `Bearer user-${user}` });

const REFUSED: Record<string, [number, string]> = {
  inbound: [400, "admission_receipt_malformed"],
  dispatch: [503, "gateway_origin_not_allowed"],
  publish: [401, "unauthenticated"],
};

run("AutoLabels runtime bundle under Deno against a disposable node", () => {
  beforeAll(async () => {
    sql = postgres(PG_URL, { max: 5, onnotice: () => {}, idle_timeout: 5 });
    const conns = [
      ...APP_PAIRS.map(([s, t]) => grant(s, t, S.tenant, [S.rooftop, UNMAPPED_ROOFTOP])),
      grant("autocurb", "autolabels", S.other, [S.rooftop]),
    ];
    reg = makeRegistry(conns);
    await liftTransportCheck(sql);
    await seedRegistry(sql, reg, "autolabels");
    await setTransport(sql, true, "autolabels");
    gw = await startStubGateway(reg);
    rt = await startRuntimeServer({ bundleFile: BUNDLE, dbUrl: PG_URL, stagingRef: STAGING_REF, gatewayOrigin: gw.origin, serviceRoleKey: SERVICE_KEY, compiledEnabled: true });
  }, 180_000);
  afterAll(async () => {
    await rt?.stop();
    await gw?.close();
    await sql?.end();
  });

  it("admits a Gateway-signed delivery with a verified three-receipt chain and applies the effect once", async () => {
    const p = await appraisal({ origin: "ac-c0-1" });
    const first = await deliver(p);
    expect(first.status, rt.log()).toBe(200);
    expect(first.doc.receipts).toHaveLength(2);
    const chain: ReceiptV2[] = [first.g.admission];
    const kinds = ["target_inbox", "consumer_commit"] as const;
    for (let i = 0; i < 2; i++) {
      const exp = { envelope: p.envelope, connection_id: connIdOf("autocurb", "autolabels", S.tenant), delivery_id: first.g.deliveryId, kind: kinds[i]! };
      chain.push(await verifyReceiptV2(first.doc.receipts[i], exp, reg, nowSec() + 1, chain.slice()));
    }
    expect(chain.map((r) => r.kind)).toEqual(["gateway_admission", "target_inbox", "consumer_commit"]);
    expect(chain.map((r) => r.outcome)).toEqual(["admitted", "applied", "applied"]);
    expect((await A.record(sql, p.envelope))?.evidence).toHaveLength(1);
  });

  it("suppresses a duplicate: the stored chain comes back byte for byte and nothing is applied twice", async () => {
    const p = await appraisal({ origin: "ac-c0-dup" });
    const at = Math.floor(Date.now() / 1000);
    const first = await deliver(p, S.tenant, undefined, at);
    expect(first.status).toBe(200);
    const exactRetry = await deliver(p, S.tenant, first.g.headers["rtgip-nonce"], at);
    const freshNonce = await deliver(p, S.tenant, undefined, at);
    for (const again of [exactRetry, freshNonce]) {
      expect(again.status).toBe(200);
      expect(again.doc.receipts).toEqual(first.doc.receipts);
    }
    expect((await A.record(sql, p.envelope))?.evidence).toHaveLength(1);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM rtgip.inbox WHERE event_id = ${p.envelope.event_id}::uuid`;
    expect(n).toBe(1);
  });

  it("quarantines a cross-tenant delivery: the effect refuses and no business row is written", async () => {
    const p = await appraisal({ tenant: S.other, origin: "ac-c0-xtenant" });
    const r = await deliver(p, S.other);
    expect(r.status, rt.log()).toBe(200);
    expect(r.doc.receipts).toHaveLength(1);
    expect(r.doc.receipts[0]).toMatchObject({ kind: "target_inbox", outcome: "quarantined" });
    expect(await A.record(sql, p.envelope)).toBeNull();
  });

  it("quarantines a cross-rooftop delivery that the connection grants but this app does not map", async () => {
    const p = await appraisal({ rooftop: UNMAPPED_ROOFTOP, origin: "ac-c0-xroof" });
    const r = await deliver(p);
    expect(r.status, rt.log()).toBe(200);
    expect(r.doc.receipts[0]).toMatchObject({ kind: "target_inbox", outcome: "quarantined" });
    expect(r.doc.receipts).toHaveLength(1);
    expect(await A.record(sql, p.envelope)).toBeNull();
  });

  it("refuses a delivery for a rooftop or tenant the registry never granted", async () => {
    const roof = await appraisal({ rooftop: "rf-never-granted", origin: "ac-c0-nogrant" });
    const a = await deliver(roof);
    expect([401, 403]).toContain(a.status);
    expect(a.doc.receipts).toEqual([]);
    const ten = await appraisal({ tenant: randomUUID(), origin: "ac-c0-notenant" });
    const b = await deliver(ten, S.tenant);
    expect([401, 403]).toContain(b.status);
    expect(b.doc.receipts).toEqual([]);
    expect(await A.record(sql, roof.envelope)).toBeNull();
  });

  it("publishes for a tenant manager through the real authorizer, and refuses everyone else", async () => {
    const manager = randomUUID();
    const staff = randomUUID();
    const foreign = randomUUID();
    const stranger = randomUUID();
    for (const u of [manager, staff, foreign, stranger]) await sql`INSERT INTO auth.users (id, email) VALUES (${u}::uuid, ${`c0-${u}@example.test`})`;
    await sql`INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) VALUES
      (${S.tenant}::uuid, ${manager}::uuid, 'manager', now()), (${S.tenant}::uuid, ${staff}::uuid, 'staff', now()), (${S.other}::uuid, ${foreign}::uuid, 'owner', now())`;
    const ask = (over: Record<string, unknown> = {}) => ({ kind: "identity_registered", tenant_id: S.tenant, rooftop_id: S.rooftop, ref: { episode_id: S.open }, ...over });
    const noAuth = await postJson(`${rt.url}/publish`, JSON.stringify(ask()));
    expect(noAuth.status).toBe(401);
    const outside = await publishAs(stranger, ask());
    expect([outside.status, ((await outside.json()) as { reason: string }).reason]).toEqual([403, "not_a_member"]);
    const otherTenant = await publishAs(foreign, ask());
    expect([otherTenant.status, ((await otherTenant.json()) as { reason: string }).reason]).toEqual([403, "not_a_member"]);
    const lowRole = await publishAs(staff, ask());
    expect([lowRole.status, ((await lowRole.json()) as { reason: string }).reason]).toEqual([403, "role_not_permitted"]);
    const unmapped = await publishAs(manager, ask({ rooftop_id: UNMAPPED_ROOFTOP }));
    expect([unmapped.status, ((await unmapped.json()) as { reason: string }).reason]).toEqual([403, "rooftop_unmapped"]);
    expect((await sql`SELECT 1 FROM rtgip.outbox`).length).toBe(0);

    const hostile = ask({ target_app: "autofilm", envelope: { tenant_id: S.other }, ref: { episode_id: S.open, targets: "autofilm", emitted_at: "1999-01-01T00:00:00Z" } });
    const ok = await publishAs(manager, hostile);
    const doc = (await ok.json()) as { results: { event_id: string; target_app: string; result: string }[] };
    expect(ok.status, rt.log()).toBe(200);
    expect(doc.results.map((x) => [x.target_app, x.result]).sort()).toEqual([["autocurb", "enqueued"], ["autoframe", "enqueued"]]);
    const rows = await sql`SELECT envelope->>'emitted_at' AS emitted_at, envelope->>'tenant_id' AS tenant, state FROM rtgip.outbox`;
    expect(rows).toHaveLength(2);
    for (const r of rows) expect([r.tenant, r.state, String(r.emitted_at).startsWith("1999")]).toEqual([S.tenant, "pending", false]);
  });

  it("runs one dispatcher pass against the stub Gateway: signed deliveries, admission receipts, lease advanced", async () => {
    const wrong = await postJson(`${rt.url}/dispatch`, "{}", { authorization: "Bearer not-the-key" });
    expect(wrong.status).toBe(401);
    const none = await postJson(`${rt.url}/dispatch`, "{}");
    expect(none.status).toBe(401);
    const r = await postJson(`${rt.url}/dispatch`, "{}", { authorization: `Bearer ${SERVICE_KEY}` });
    const doc = (await r.json()) as { action: string; http_status: number; advanced: string[]; state: string }[];
    expect(r.status, rt.log()).toBe(200);
    expect(doc).toHaveLength(2);
    for (const d of doc) expect(d).toMatchObject({ action: "deliver", http_status: 200, advanced: ["gateway_admitted"], state: "gateway_admitted" });
    expect(gw.seen.filter((s) => s.path === "/api/rtgip/v2/deliver" && s.verified)).toHaveLength(2);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM rtgip.receipts WHERE kind = 'gateway_admission'`;
    expect(n).toBe(2);
    const idle = await postJson(`${rt.url}/dispatch`, "{}", { authorization: `Bearer ${SERVICE_KEY}` });
    expect(await idle.json()).toEqual([]);
  });

  it("stops at the database kill switch and at a local_app mismatch, then resumes", async () => {
    const hit = async () => {
      const out: [number, string][] = [];
      for (const [p, h] of [["inbound", {}], ["dispatch", { authorization: `Bearer ${SERVICE_KEY}` }], ["publish", { authorization: `Bearer user-${randomUUID()}` }]] as const) {
        const r = await postJson(`${rt.url}/${p}`, "{}", h);
        out.push([r.status, ((await r.json()) as { reason: string }).reason]);
      }
      return out;
    };
    await setTransport(sql, false);
    expect(await hit()).toEqual([[503, "transport_disabled"], [503, "transport_disabled"], [503, "transport_disabled"]]);
    await setTransport(sql, true, "autocurb");
    expect(await hit()).toEqual([[503, "local_app_mismatch"], [503, "local_app_mismatch"], [503, "local_app_mismatch"]]);
    await setTransport(sql, true, "autolabels");
    expect((await hit())[0]).toEqual([400, "admission_receipt_malformed"]);
  });

  it("refuses a runtime built with the literal off, and the mode, and a production backend", async () => {
    const off = await startRuntimeServer({ bundleFile: BUNDLE, dbUrl: PG_URL, stagingRef: STAGING_REF, gatewayOrigin: gw.origin, serviceRoleKey: SERVICE_KEY, compiledEnabled: false });
    const mode = await startRuntimeServer({ bundleFile: BUNDLE, dbUrl: PG_URL, stagingRef: STAGING_REF, gatewayOrigin: gw.origin, serviceRoleKey: SERVICE_KEY, compiledEnabled: true, mode: "off" });
    try {
      const a = await postJson(`${off.url}/inbound`, "{}");
      expect([a.status, ((await a.json()) as { reason: string }).reason]).toEqual([503, "RTGIP2_NOT_ACTIVATED"]);
      const b = await postJson(`${mode.url}/inbound`, "{}");
      expect([b.status, ((await b.json()) as { reason: string }).reason]).toEqual([503, "runtime_mode_off"]);
    } finally {
      await off.stop();
      await mode.stop();
    }
  }, 180_000);

  it("the committed function entries, run as deployed, refuse every call", async () => {
    for (const fn of ["inbound", "dispatch", "publish"]) {
      const entry = path.join(ROOT, `supabase/functions/rtgip-${fn}/index.ts`);
      const d = await startDeployedEntry(entry, {
        SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
        SUPABASE_DB_URL: PG_URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        RTGIP2_RUNTIME_MODE: "staging",
        RTGIP2_GATEWAY_URL: gw.origin,
      });
      try {
        const r = await postJson(`${d.url}/`, "{}", { authorization: `Bearer ${SERVICE_KEY}` });
        expect([fn, r.status, ((await r.json()) as { reason: string }).reason]).toEqual([fn, ...REFUSED[fn]!]);
      } finally {
        await d.stop();
      }
    }
  }, 180_000);
});
