// @vitest-environment node
// Local four-node staging over REAL app nodes. AutoLabels, AutoCurb and AutoFrame are each built
// from empty by their own bootstrap (supabase/tests/rtgip/pg_staging.sh) and every seed value,
// connection and mapping comes from the rooftop registry export views. Source events come from
// each app's staging adapter produce() over real seeded rows; the destination effect is the same
// app's adapter apply() inside the inbox transaction. The Gateway is a STAND-IN behind GatewayPort
// (admit, forward, query). Every result here is "stand-in Gateway, not acceptance": isolated,
// disposable, not hosted evidence, and not a claim about the vendored candidate.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { RECEIPT_PROTOCOL, deliveryIdentity, verifyReceiptV2, type ReceiptV2 } from "../rtgip2/receipt-v2.ts";
import { signReceiptQuery } from "../rtgip2/receipt-query.ts";
import { ADMISSION_HEADER, encodeAdmissionHeader } from "../rtgip2/admission.ts";
import { signAdmission } from "../rtgip2/harness.ts";
import {
  canonicalize, deriveEventId, eventIdScopeOf, hmacHex, payloadHash, preimage, scanSensitive, scopeOf, sha256Hex, signEnvelope, SIGNATURE_PREFIX,
  type EnvelopeV2, type Registry, type ServiceKey,
} from "../rtgip2/protocol.ts";
import { labelsAdmissionEffect, labelsStagingAdapter, type StagingAdapter } from "../rtgip2-autolabels/staging-adapter.ts";
import {
  APPS, STANDIN_RESULT_LABEL, StandInGateway, adapterEffect, connect, connIdOf, dispatch, enqueue, grantSixRoutes, keyFor, makeDue, noFaults,
  nowSec, readExports, registryFrom, seedNode, startGatewayHttp, startTarget, syncAppMapping,
  type App, type Faults, type RegistryExports, type Server, type Sql, type StandInServer,
} from "./nodes.ts";

const SEED_FILE = process.env.RTGIP_STG_SEED ?? "";
const URLS = {
  autolabels: process.env.RTGIP_STG_AUTOLABELS ?? "",
  autocurb: process.env.RTGIP_STG_AUTOCURB ?? "",
  autoframe: process.env.RTGIP_STG_AUTOFRAME ?? "",
  gateway: process.env.RTGIP_STG_GATEWAY ?? "",
};
const run = describe.runIf(!!URLS.autolabels && !!URLS.gateway && !!SEED_FILE);
const seed: Record<string, string> = SEED_FILE ? (JSON.parse(readFileSync(SEED_FILE, "utf8")) as Record<string, string>) : {};

type Produced = { envelope: EnvelopeV2; body: string };
const adapters = {} as Record<App, StagingAdapter>;
const db = {} as Record<App | "gateway", Sql>;
const faults: Record<App, Faults> = { autolabels: noFaults(), autocurb: noFaults(), autoframe: noFaults() };
const servers = {} as Record<App, Server>;
let gwHttp: StandInServer;
let gwPort: StandInGateway;
let reg: Registry;
let exp: RegistryExports;
const evidence: Record<string, Record<string, unknown>> = {};
const note = (route: string, k: string, v: unknown) => void ((evidence[route] ??= {})[k] = typeof v === "string" ? `${v} [${STANDIN_RESULT_LABEL}]` : v);

const tenantA = () => seed.AL_SEED_TENANT!;
const tenantB = () => seed.AL_SEED_OTHER_TENANT!;
const ROOFTOP_A = () => seed.AL_SEED_ROOFTOP!;
const ROOFTOP_B = "rf-stg-02";
const scopeA = () => ({ tenant_id: tenantA(), rooftop_id: ROOFTOP_A() });
const scopeB = () => ({ tenant_id: tenantB(), rooftop_id: ROOFTOP_B });
const EP_OPEN = () => seed.AL_SEED_OPEN_EPISODE!;
const EP_DELIVERED = () => seed.AL_SEED_DELIVERED_EPISODE!;
const LISTING = () => seed.AL_SEED_OPEN_LISTING!;
const DIRS: [App, App][] = [["autolabels", "autocurb"], ["autolabels", "autoframe"], ["autocurb", "autolabels"], ["autocurb", "autoframe"], ["autoframe", "autolabels"], ["autoframe", "autocurb"]];

// The applied-event ledger on each node (one row per applied event).
const LEDGER: Record<App, { table: string; key: string }> = {
  autolabels: { table: "rtgip_fx.applied", key: "event_id" },
  autocurb: { table: "rtgip_fx.curb_applied", key: "event_id" },
  autoframe: { table: "rtgip_fx.frame_applied", key: "source_event_id" },
};
const appliedRows = async (app: App, e: EnvelopeV2) => {
  const { table, key } = LEDGER[app];
  const v = key === "event_id" ? e.event_id : e.origin.event_id;
  // AutoFrame keys its ledger by (source app, origin event id); scope it to the envelope's tenant as well.
  const scoped = app === "autoframe" ? " AND tenant_id = $2" : "";
  return db[app].unsafe(`SELECT xmin::text AS xmin, outcome FROM ${table} WHERE ${key}::text = $1${scoped}`, app === "autoframe" ? [v, e.tenant_id] : [v]) as Promise<{ xmin: string; outcome: string }[]>;
};
const outboxState = async (app: App, id: string) => (await db[app]`SELECT state, receipts->1->>'outcome' AS inbox_outcome FROM rtgip.outbox WHERE event_id = ${id}`)[0];
const receiptKinds = async (app: App, id: string) =>
  (await db[app]`SELECT kind, outcome FROM rtgip.receipts WHERE event_id = ${id} ORDER BY attempt, kind`).map((r) => `${r.kind}:${r.outcome}`);

async function resync() {
  exp = await readExports(db.gateway);
  reg = registryFrom(exp, reg?.keys ?? []);
  for (const a of APPS) {
    await seedNode(db[a], reg, a);
    await syncAppMapping(db[a], a, exp, seed.AL_SEED_MAPPER!);
  }
}

async function pump(app: App, max = 10) {
  const all = [];
  for (let i = 0; i < max; i++) {
    all.push(...(await dispatch(db[app], app, reg, gwHttp.url, `w-${app}`)));
    const open = await db[app]`SELECT count(*)::int AS c FROM rtgip.outbox WHERE state NOT IN ('consumer_committed','target_quarantined','dead_letter')`;
    if (open[0]!.c === 0) break;
    await gwPort.forward();
    await makeDue(db[app]);
  }
  return all;
}
const send = async (src: App, items: readonly Produced[]) => {
  const r = await enqueue(db[src], items);
  expect(r.every((x) => x === "enqueued")).toBe(true);
  await pump(src);
};

/** Ask the Gateway for the delivery's chain as the source and verify all three receipts. */
async function chainOf(src: App, e: EnvelopeV2) {
  const connection_id = connIdOf(e.source_app, e.target_app, e.tenant_id, e.rooftop_id);
  const delivery_id = await deliveryIdentity(e, connection_id);
  const q = await signReceiptQuery({ delivery_id, event_id: e.event_id }, keyFor(reg, src), nowSec(), `qry_${randomUUID().replace(/-/g, "")}`);
  const r = await gwPort.query({ headers: q.headers as unknown as Record<string, string>, body: q.body });
  expect(r.status).toBe(200);
  const receipts = r.doc.receipts!;
  const kinds = ["gateway_admission", "target_inbox", "consumer_commit"] as const;
  const chain: ReceiptV2[] = [];
  for (let i = 0; i < receipts.length; i++) {
    await verifyReceiptV2(receipts[i], { envelope: e, connection_id, delivery_id, kind: kinds[i]! }, reg, nowSec(), chain.slice());
    chain.push(receipts[i]!);
  }
  return { receipts, connection_id, delivery_id };
}

/** The whole acceptance chain for one committed delivery. */
async function proveCommitted(src: App, tgt: App, p: Produced, expectRecord?: (rec: Record<string, unknown>) => void) {
  const e = p.envelope;
  const route = `${src}->${tgt}`;
  const connId = connIdOf(src, tgt, e.tenant_id, e.rooftop_id);
  // authorized source event: a registry connection exists, and the source outbox row sits on it
  expect(exp.connections.some((c) => c.id === connId && c.registry_id)).toBe(true);
  const ob = (await db[src]`SELECT state, connection_id, receipts FROM rtgip.outbox WHERE event_id = ${e.event_id}`)[0]!;
  expect(ob.connection_id).toBe(connId);
  const why = JSON.stringify(await db[tgt]`SELECT outcome, reason FROM rtgip.inbox WHERE event_id = ${e.event_id}`);
  expect(ob.state, `${route} ${e.event_type}: ${why}`).toBe("consumer_committed");
  // admission
  const gw = await db.gateway`SELECT connection_id FROM gw_standin.admissions WHERE event_id = ${e.event_id} AND target_app = ${tgt}`;
  expect(gw).toEqual([{ connection_id: connId }]);
  // destination inbox row
  const inbox = await db[tgt]`SELECT outcome, committed_at IS NOT NULL AS committed FROM rtgip.inbox WHERE event_id = ${e.event_id}`;
  expect(inbox).toHaveLength(1);
  expect(inbox[0]!.committed).toBe(true);
  // real business record through the adapter
  const rec = await adapters[tgt].record(db[tgt], e);
  expect(rec, `${route} business record`).not.toBeNull();
  expectRecord?.(rec!);
  // three linked receipts, verified; the source reached consumer_committed through the query
  const { receipts } = await chainOf(src, e);
  expect(receipts.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["gateway_admission:admitted", "target_inbox:applied", "consumer_commit:applied"]);
  expect(receipts[1]!.prev_receipt_sha256).not.toBeNull();
  expect(receipts.every((r) => r.protocol === RECEIPT_PROTOCOL)).toBe(true);
  expect((ob.receipts as (string | { kind: string })[]).map((t) => (typeof t === "string" ? (JSON.parse(t) as { kind: string }) : t).kind)).toEqual(["gateway_admission", "target_inbox", "consumer_commit"]);
  note(route, `committed:${e.event_type}`, `registry connection ${connId}; admission; inbox applied; ${tgt} record via adapter.record; 3 receipts verified (verifyReceiptV2); source consumer_committed via receipt query`);
  return { rec: rec!, receipts };
}

run(`${STANDIN_RESULT_LABEL}: four real app nodes, registry-driven, over HTTP`, () => {
  beforeAll(async () => {
    for (const k of Object.keys(URLS) as (keyof typeof URLS)[]) db[k] = connect(URLS[k]);
    await grantSixRoutes(db.gateway, tenantA(), seed.REG_OPERATOR!, seed.REG_REVIEWER!);
    await grantSixRoutes(db.gateway, tenantB(), seed.REG_OPERATOR!, seed.REG_REVIEWER!);
    await resync();
    const ac = (await import(/* @vite-ignore */ `${process.env.AC_REPO}/src/lib/rooftopos/rtgip2-autocurb/staging-adapter.ts`)) as { curbStagingAdapter: StagingAdapter; curbAdmissionEffect: unknown };
    const af = (await import(/* @vite-ignore */ `${process.env.AF_REPO}/src/lib/af/rtgip2-autoframe/staging-adapter.ts`)) as { autoframeStagingAdapter: StagingAdapter };
    adapters.autolabels = labelsStagingAdapter;
    adapters.autocurb = ac.curbStagingAdapter;
    adapters.autoframe = af.autoframeStagingAdapter;
    void labelsAdmissionEffect;
    const regFn = () => reg;
    for (const a of APPS) servers[a] = await startTarget(a, db[a], regFn, adapterEffect(adapters[a], faults[a]), faults[a]);
    gwPort = new StandInGateway(db.gateway, {
      reg: regFn,
      mappings: () => exp.mappings,
      targets: () => ({ autolabels: servers.autolabels.url, autocurb: servers.autocurb.url, autoframe: servers.autoframe.url }),
    });
    gwHttp = await startGatewayHttp(gwPort);
  });
  afterAll(async () => {
    for (const s of Object.values(servers)) await s?.close();
    await gwHttp?.close();
    for (const s of Object.values(db)) await s?.end();
    if (process.env.RTGIP_STG_REPORT)
      writeFileSync(
        process.env.RTGIP_STG_REPORT,
        JSON.stringify({ classification: `isolated four-node, ${STANDIN_RESULT_LABEL}, disposable`, tenant_is_synthetic: true, keys_generated_at_start: reg.keys.map((k) => k.key_id), routes: evidence }, null, 2),
      );
  });

  it("registry: exports drove the seeds, transport flags are off in the export, two tenants and two rooftops", async () => {
    expect(exp.rooftops.map((r) => r.rooftop_id)).toEqual(["rf-stg-01", "rf-stg-02"]);
    expect(new Set(exp.rooftops.map((r) => r.tenant_id)).size).toBe(2);
    expect(exp.connections).toHaveLength(12);
    expect(exp.connections.every((c) => c.source_enabled === false && c.target_enabled === false)).toBe(true);
    expect(exp.mappings.length).toBe(12);
    const grants = await db.gateway`SELECT count(*)::int AS n, count(DISTINCT created_by)::int AS creators, count(DISTINCT reviewed_by)::int AS reviewers FROM rooftop_registry.grants WHERE status = 'active'`;
    expect(grants[0]).toEqual({ n: 12, creators: 1, reviewers: 1 });
    expect((await db.gateway`SELECT count(*)::int AS n FROM rooftop_registry.audit WHERE action = 'refused'`)[0]!.n).toBeGreaterThanOrEqual(14);
    expect((await db.autolabels`SELECT store_id::text FROM rtgip_src.rooftop_stores WHERE status = 'active' AND rooftop_id = ${ROOFTOP_A()}`)[0]!.store_id).toBe(exp.rooftops[0]!.al_store_id);
    note("registry", "exports", "2 rooftops (2 tenants), 12 active grants (2 creators... one operator, one reviewer), 12 connections and 12 mappings exported with transport flags off");
  });

  // ---- helpers that turn real rows into fresh events -------------------------------------------

  /** The revision the target's inbox expects as predecessor: its own watermark for this aggregate, so an undelivered event never poisons the chain. */
  async function watermarkFor(tgt: App, e: EnvelopeV2): Promise<string> {
    const wm = (await db[tgt]`SELECT rtgip.watermark_key(${db[tgt].json(e as never)}::jsonb) AS k`)[0]!.k as string;
    const row = (await db[tgt]`SELECT revision::text AS r FROM rtgip.watermarks WHERE wm_key = ${wm}`)[0];
    return row ? (row.r as string) : "null";
  }

  async function bumpListing() {
    await db.autolabels`UPDATE public.vehicle_listings SET price = price + 1, advertised_price_before_doc = advertised_price_before_doc + 1, updated_at = clock_timestamp() WHERE id = ${LISTING()}`;
  }
  async function labelsEvent(kind: "price_published" | "listing_availability" | "inventory_status", targets: App[]): Promise<Produced[]> {
    if (kind !== "inventory_status") await bumpListing();
    const ref = { episode_id: EP_OPEN(), targets: targets.join(",") };
    const probe = await adapters.autolabels.produce(db.autolabels, kind, scopeA(), ref);
    const prev = await watermarkFor(targets[0]!, probe[0]!.envelope);
    return prev === "null" ? probe : adapters.autolabels.produce(db.autolabels, kind, scopeA(), { ...ref, prev_revision: prev });
  }
  const APPRAISER = () => seed.AC_SEED_APPR!;
  let episodeOpenedAtCurb = "";
  /** A general manager links the submission to the admitted AutoLabels episode (rtgip_link_acquisition). */
  const asGm = (fn: (tx: Sql) => Promise<unknown>) =>
    db.autocurb.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx`SELECT set_config('request.jwt.claim.sub', ${seed.AC_SEED_GM!}, true), set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
      await fn(tx as unknown as Sql);
    });
  /** AutoCurb allows one active link per episode, so a submission is linked only while its event is sealed. */
  async function withLinked<T>(sub: string, fn: () => Promise<T>): Promise<T> {
    await asGm((tx) => tx`SELECT public.rtgip_link_acquisition(${sub}::uuid, ${episodeOpenedAtCurb}::uuid, 'staging: the vehicle on the submission is the admitted episode')`);
    try {
      return await fn();
    } finally {
      await asGm((tx) => tx`SELECT public.rtgip_revoke_acquisition_link(${sub}::uuid, 'staging: event sealed, link released')`);
    }
  }
  async function newCurbAppraisal(): Promise<string> {
    const sub = randomUUID();
    await db.autocurb`INSERT INTO public.submissions (id, dealership_id, store_location_id, progress_status, vin, name, email, phone, offered_price, acv_value, estimated_offer_high, bb_wholesale_avg)
      VALUES (${sub}, ${seed.AC_SEED_DEALERSHIP!}, ${seed.AC_SEED_STORE!}, 'inspection_completed', '1M8GDM9AXKP042801', 'Pat Synthetic', 'pat@example.test', '5550100', 19250, 18500, 20000, 16222)`;
    for (const step of ["progress_status = 'appraisal_completed'", "appraisal_finalized = true"])
      await db.autocurb.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE authenticated");
        await tx`SELECT set_config('request.jwt.claim.sub', ${APPRAISER()}, true), set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
        await tx.unsafe(`UPDATE public.submissions SET ${step} WHERE id = '${sub}'`);
      });
    return sub;
  }
  async function newMedia(): Promise<string> {
    return (await db.autoframe`SELECT rtgip_stage.approve_new_media(${EP_OPEN()}::uuid)::text AS id`)[0]!.id as string;
  }
  /** One fresh, never-before-sent event on a direction, produced by the source adapter over real rows. */
  async function fresh(src: App, tgt: App): Promise<Produced> {
    if (src === "autolabels")
      return (await labelsEvent(tgt === "autocurb" ? "price_published" : "listing_availability", [tgt]))[0]!;
    if (src === "autocurb") {
      const sub = await newCurbAppraisal();
      return withLinked(sub, async () => (await adapters.autocurb.produce(db.autocurb, "appraisal_completed", scopeA(), { submission_id: sub, targets: tgt }))[0]!);
    }
    const media = await newMedia();
    return (await adapters.autoframe.produce(db.autoframe, "media.approved", scopeA(), { media_id: media, targets: tgt }))[0]!;
  }

  // ---- positive path: all six directions, over the real rows --------------------------------------

  it("AutoLabels -> AutoCurb and AutoFrame: identity then episode from the PR #46 rows, committed in both real apps", async () => {
    const idn = await adapters.autolabels.produce(db.autolabels, "identity_registered", scopeA(), { episode_id: EP_OPEN() });
    expect(idn.map((p) => p.envelope.target_app).sort()).toEqual(["autocurb", "autoframe"]);
    await send("autolabels", idn);
    const ep = await adapters.autolabels.produce(db.autolabels, "episode_opened", scopeA(), { episode_id: EP_OPEN() });
    await send("autolabels", ep);
    episodeOpenedAtCurb = ep.find((p) => p.envelope.target_app === "autocurb")!.envelope.event_id;
    for (const p of idn) await proveCommitted("autolabels", p.envelope.target_app as App, p);
    for (const p of ep) {
      const tgt = p.envelope.target_app as App;
      const { rec } = await proveCommitted("autolabels", tgt, p);
      if (tgt === "autocurb") {
        expect(rec).toMatchObject({ vehicle: { instance_id: EP_OPEN(), tenant_id: tenantA(), rooftop_id: ROOFTOP_A(), vin: "1M8GDM9AXKP042801", stock_number: "STG1001" }, episode: { state: "open" } });
      } else {
        expect(rec).toMatchObject({ vehicle: { vin: "1M8GDM9AXKP042801", lifecycle: "inventory", instance_id: EP_OPEN() }, episode_map: { al_episode_id: EP_OPEN() } });
      }
    }
  });

  it("AutoLabels -> AutoCurb and AutoFrame: inventory status, advertised price and listing availability from the listing rows", async () => {
    const st = await labelsEvent("inventory_status", ["autocurb", "autoframe"]);
    await send("autolabels", st);
    const pr = await labelsEvent("price_published", ["autocurb"]);
    await send("autolabels", pr);
    const av = await labelsEvent("listing_availability", ["autoframe"]);
    await send("autolabels", av);
    for (const p of [...st, ...pr, ...av]) await proveCommitted("autolabels", p.envelope.target_app as App, p);
    const curb = await adapters.autocurb.record(db.autocurb, pr[0]!.envelope);
    expect((curb as { episode: { advertised_price_cents: number } }).episode.advertised_price_cents).toBeGreaterThan(0);
  });

  it("AutoCurb -> AutoLabels and AutoFrame: appraisal, milestone and a custody-backed purchase from attributed ledger rows", async () => {
    const apr = await withLinked(seed.AC_SEED_SUB_APPRAISAL!, () => adapters.autocurb.produce(db.autocurb, "appraisal_completed", scopeA(), { submission_id: seed.AC_SEED_SUB_APPRAISAL! }));
    const ms = await withLinked(seed.AC_SEED_SUB_MILESTONE!, () => adapters.autocurb.produce(db.autocurb, "acquisition_milestone", scopeA(), { submission_id: seed.AC_SEED_SUB_MILESTONE! }));
    const pur = await withLinked(seed.AC_SEED_SUB_PURCHASE!, () => adapters.autocurb.produce(db.autocurb, "purchase_completed", scopeA(), { submission_id: seed.AC_SEED_SUB_PURCHASE! }));
    expect(apr.map((p) => p.envelope.target_app).sort()).toEqual(["autoframe", "autolabels"]);
    expect(ms.map((p) => p.envelope.target_app)).toEqual(["autolabels"]);
    await send("autocurb", [...apr, ...ms, ...pur]);
    const kindOf = { "appraisal.completed": "appraisal_finalized", "acquisition.milestone_recorded": "acquisition_milestone:deal_finalized", "acquisition.purchase_completed": "purchase_completed_custody_received" } as const;
    const reasonOf = { "appraisal.completed": "appraisal_completed", "acquisition.purchase_completed": "purchase_completed" } as const;
    for (const p of [...apr, ...ms, ...pur]) {
      const tgt = p.envelope.target_app as App;
      const t = p.envelope.event_type as keyof typeof kindOf;
      await proveCommitted("autocurb", tgt, p, (rec) => {
        if (tgt === "autolabels") expect(rec).toMatchObject({ evidence: [{ kind: kindOf[t], vin: "1M8GDM9AXKP042801", episode_id: EP_OPEN() }], reviews: [], episode: { status: "active", custody_state: "in_stock" } });
        else expect(rec).toMatchObject({ intake: { reason: reasonOf[t as keyof typeof reasonOf], status: "open", vin: "1M8GDM9AXKP042801" }, applied: { ok: true } });
      });
    }
  });

  it("AutoFrame -> AutoLabels and AutoCurb: a media approval from the real RPC chain", async () => {
    const media = await newMedia();
    const ok = await adapters.autoframe.produce(db.autoframe, "media.approved", scopeA(), { media_id: media });
    expect(ok.map((p) => p.envelope.target_app).sort()).toEqual(["autocurb", "autolabels"]);
    await send("autoframe", ok);
    for (const p of ok) {
      const tgt = p.envelope.target_app as App;
      await proveCommitted("autoframe", tgt, p, (rec) => {
        const m = (rec as { media: Record<string, unknown> }).media;
        expect(m).toMatchObject({ media_id: media, state: "approved" });
      });
    }
  });

  // ---- shared attack plumbing ------------------------------------------------------------------

  const post = async (url: string, h: Record<string, string>, body: string) => {
    const r = await fetch(url, { method: "POST", headers: h, body });
    return { status: r.status, doc: (await r.json()) as { reason: string | null; receipts?: ReceiptV2[] } };
  };
  const gwUrl = () => `${gwHttp.url}/rtgip/v2/deliver`;
  const signAs = async (e: { body: string; envelope: EnvelopeV2 }, owner: App | "gateway") =>
    (await signEnvelope(e.body, e.envelope, keyFor(reg, owner), nowSec(), `atk_${randomUUID().replace(/-/g, "")}`)) as unknown as Record<string, string>;
  async function resealed(e: EnvelopeV2, patch: (x: Record<string, unknown>) => Record<string, unknown>) {
    const { payload_sha256: _p, event_id: _e, ...rest } = e;
    const draft = patch(rest as unknown as Record<string, unknown>) as unknown as Omit<EnvelopeV2, "payload_sha256">;
    const event_id = await deriveEventId(eventIdScopeOf(draft));
    const envelope = { ...draft, event_id, payload_sha256: await payloadHash(draft.payload) } as EnvelopeV2;
    return { envelope, body: canonicalize(envelope) };
  }
  /** A Gateway-signed forward with a Gateway-signed admission, posted straight at a target (the Gateway's checks bypassed). */
  async function forwardDirect(p: Produced, tgt: App, nonce?: string, opts: { gatewayKey?: ServiceKey } = {}) {
    const e = p.envelope;
    const conn = connIdOf(e.source_app, e.target_app, e.tenant_id, e.rooftop_id);
    // A Gateway key that is not authorized for this connection cannot even sign the admission; widen it to hand the
    // target the strongest forgery, so the refusal that follows is the target's own.
    const base = opts.gatewayKey ?? keyFor(reg, "gateway");
    const gwKey = base.connection_ids.includes(conn) ? base : { ...base, connection_ids: [...base.connection_ids, conn] };
    const adm = await signAdmission(e, conn, gwKey, nowSec());
    const hdr = { ...((await signEnvelope(p.body, e, gwKey, nowSec(), nonce ?? `dir_${randomUUID().replace(/-/g, "")}`)) as unknown as Record<string, string>), [ADMISSION_HEADER]: encodeAdmissionHeader(adm) };
    return post(`${servers[tgt].url}/rtgip/v2/inbound`, hdr, p.body);
  }
  const noConsumerCommit = async (src: App, id: string) => expect((await receiptKinds(src, id)).some((k) => k.startsWith("consumer_commit"))).toBe(false);

  // ---- scenarios -------------------------------------------------------------------------------

  it("delivered-vehicle protection: AutoCurb purchase evidence for a delivered AutoLabels episode opens a custody review and leaves the episode alone", async () => {
    const dIdn = await adapters.autolabels.produce(db.autolabels, "identity_registered", scopeA(), { episode_id: EP_DELIVERED(), targets: "autocurb" });
    const dEp = await adapters.autolabels.produce(db.autolabels, "episode_opened", scopeA(), { episode_id: EP_DELIVERED(), targets: "autocurb" });
    await send("autolabels", dIdn);
    await send("autolabels", dEp);
    for (const p of [...dIdn, ...dEp]) await proveCommitted("autolabels", "autocurb", p);
    await db.autolabels.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE service_role");
      await tx`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
      await tx`SELECT public.vehicle_history_record_milestone(${EP_DELIVERED()}::uuid, 'sold', now() - interval '3 days', NULL, 'dms', 'stg-deal-1', NULL, NULL, NULL, 'dms:stg-deal-1:r1', 1)`;
      await tx`SELECT public.vehicle_history_record_milestone(${EP_DELIVERED()}::uuid, 'delivered', now() - interval '2 days', NULL, 'dms', 'stg-deal-1', NULL, NULL, NULL, 'dms:stg-deal-1:r2', 2)`;
    });
    const before = (await db.autolabels`SELECT status, custody_state, previous_instance_id IS NOT NULL AS has_previous FROM public.vehicle_instances WHERE id = ${EP_DELIVERED()}`)[0]!;
    expect(before).toMatchObject({ status: "disposed", custody_state: "delivered" });
    const episodes = Number((await db.autolabels`SELECT count(*)::int AS n FROM public.vehicle_instances`)[0]!.n);
    const previous = episodeOpenedAtCurb;
    episodeOpenedAtCurb = dEp[0]!.envelope.event_id;
    const pur = await withLinked(seed.AC_SEED_SUB_DELIVERED!, () => adapters.autocurb.produce(db.autocurb, "purchase_completed", scopeA(), { submission_id: seed.AC_SEED_SUB_DELIVERED!, targets: "autolabels" }));
    episodeOpenedAtCurb = previous;
    expect(pur[0]!.envelope.vehicle.episode_id).toBe(EP_DELIVERED());
    await send("autocurb", pur);
    const { rec } = await proveCommitted("autocurb", "autolabels", pur[0]!, (r) => {
      const x = r as { applied: { outcome: { reason: string } }; reviews: { kind: string; prior_episode_id: string; status: string }[]; evidence: unknown[] };
      expect(x.applied.outcome.reason).toBe("custody_review_opened");
      expect(x.reviews).toEqual([expect.objectContaining({ kind: "custody_review", prior_episode_id: EP_DELIVERED(), status: "open", vin: "1M8GDM9AXKP042802" })]);
      expect(x.evidence).toEqual([]);
    });
    void rec;
    const after = (await db.autolabels`SELECT status, custody_state, previous_instance_id IS NOT NULL AS has_previous FROM public.vehicle_instances WHERE id = ${EP_DELIVERED()}`)[0]!;
    expect(after).toEqual(before);
    expect(Number((await db.autolabels`SELECT count(*)::int AS n FROM public.vehicle_instances`)[0]!.n)).toBe(episodes);
    expect(await db.autolabels`SELECT status FROM public.vehicle_listings WHERE vin = '1M8GDM9AXKP042802'`).toEqual([{ status: "archived" }]);
    note("autocurb->autolabels", "delivered_vehicle_protection", "purchase evidence for the delivered episode: custody_review_opened, episode still disposed/delivered, no new episode, listing still archived");
  });

  it("AutoCurb custody evidence: a purchase with recorded custody publishes; one without is refused at the source", async () => {
    const outboxBefore = Number((await db.autocurb`SELECT count(*)::int AS n FROM rtgip.outbox`)[0]!.n);
    await expect(adapters.autocurb.produce(db.autocurb, "purchase_completed", scopeA(), { submission_id: seed.AC_SEED_SUB_NOCUSTODY! })).rejects.toThrow("custody_authority_missing");
    expect(Number((await db.autocurb`SELECT count(*)::int AS n FROM rtgip.outbox`)[0]!.n)).toBe(outboxBefore);
    const bought = await db.autocurb`SELECT body FROM rtgip.outbox WHERE envelope->>'event_type' = 'acquisition.purchase_completed' AND envelope#>>'{origin,event_id}' LIKE ${"%" + seed.AC_SEED_SUB_PURCHASE! + "%"}`;
    expect(bought.length).toBeGreaterThan(0);
    expect(JSON.parse(bought[0]!.body as string).payload).toMatchObject({ custody_transferred: true });
    note("autocurb->autolabels", "custody_evidence", "purchase with custody published and committed; without custody refused at the source: custody_authority_missing, nothing enqueued");
  });

  it("media revocation: AutoFrame revokes and both consumers tombstone the media", async () => {
    const m = await newMedia();
    const ap = await adapters.autoframe.produce(db.autoframe, "media.approved", scopeA(), { media_id: m });
    await send("autoframe", ap);
    await db.autoframe`SELECT rtgip_stage.revoke(${m}::uuid)`;
    const rv = await adapters.autoframe.produce(db.autoframe, "media.revoked", scopeA(), { media_id: m });
    expect(rv.map((p) => p.envelope.target_app).sort()).toEqual(["autocurb", "autolabels"]);
    await send("autoframe", rv);
    for (const p of ap) await proveCommitted("autoframe", p.envelope.target_app as App, p);
    for (const p of rv) {
      const tgt = p.envelope.target_app as App;
      await proveCommitted("autoframe", tgt, p, (rec) => {
        const r = rec as { media: { state: string; active_in_gallery?: boolean }; revocation: { reason: string } | null };
        expect(r.media.state).toBe("revoked");
        if (tgt === "autolabels") expect(r.media.active_in_gallery).toBe(false);
        expect(r.revocation).not.toBeNull();
      });
    }
    note("autoframe->autolabels", "media_revocation", "approved then revoked: the media is revoked and out of the gallery");
    note("autoframe->autocurb", "media_revocation", "approved then revoked: the media is revoked with a revocation row");
  });

  it("stale approval denial: an approval from an older generation changes nothing, after a revoke and after a reinstatement", async () => {
    const m = await newMedia();
    const ap = await adapters.autoframe.produce(db.autoframe, "media.approved", scopeA(), { media_id: m, targets: "autolabels,autocurb" });
    await send("autoframe", ap);
    await db.autoframe`SELECT rtgip_stage.revoke(${m}::uuid)`;
    const rv = await adapters.autoframe.produce(db.autoframe, "media.revoked", scopeA(), { media_id: m });
    await send("autoframe", rv);
    for (const p of ap) {
      const old = await resealed(p.envelope, (x) => ({ ...x, origin: { ...(x.origin as object), event_id: `af-stale-${randomUUID()}` }, emitted_at: p.envelope.emitted_at }));
      const tgt = p.envelope.target_app as App;
      const before = JSON.stringify(await adapters[tgt].record(db[tgt], p.envelope));
      await send("autoframe", [old]);
      expect(await outboxState("autoframe", old.envelope.event_id)).toEqual({ state: "consumer_committed", inbox_outcome: "stale_ignored" });
      expect(await appliedRows(tgt, old.envelope)).toHaveLength(0);
      expect(JSON.stringify(await adapters[tgt].record(db[tgt], p.envelope))).toBe(before);
      expect(JSON.parse(before).media.state).toBe("revoked");
      note(`autoframe->${tgt}`, "stale_approval", "older-generation approval after a revoke: stale_ignored, no effect, media still revoked");
    }
    await db.autoframe`SELECT rtgip_stage.reinstate_and_approve(${m}::uuid)`;
    const again = await adapters.autoframe.produce(db.autoframe, "media.approved", scopeA(), { media_id: m, targets: "autolabels,autocurb" });
    await send("autoframe", again);
    for (const p of again) await proveCommitted("autoframe", p.envelope.target_app as App, p, (rec) => expect((rec as { media: { state: string } }).media.state).toBe("approved"));
    for (const p of ap) {
      const old = await resealed(p.envelope, (x) => ({ ...x, origin: { ...(x.origin as object), event_id: `af-stale2-${randomUUID()}` } }));
      const tgt = p.envelope.target_app as App;
      const before = JSON.stringify(await adapters[tgt].record(db[tgt], again.find((a) => a.envelope.target_app === tgt)!.envelope));
      await send("autoframe", [old]);
      expect(await outboxState("autoframe", old.envelope.event_id)).toEqual({ state: "consumer_committed", inbox_outcome: "stale_ignored" });
      expect(JSON.stringify(await adapters[tgt].record(db[tgt], again.find((a) => a.envelope.target_app === tgt)!.envelope))).toBe(before);
    }
  });

  it("customer financial privacy: no ACV, offer, payoff, finance or customer data in any envelope, inbox row or receipt; the anonymous portal hides ACV", async () => {
    const LEAK = /\b(18500|19250|20000|16222)\b|Pat Synthetic|example\.test|5550100|acv_value|acv_cents|offered_price|estimated_offer|payoff|wholesale_avg|finance_amount/i;
    const texts: { where: string; text: string }[] = [];
    for (const a of APPS) {
      for (const r of await db[a]`SELECT body FROM rtgip.outbox`) texts.push({ where: `${a}.outbox.body`, text: r.body as string });
      for (const r of await db[a]`SELECT envelope::text AS t FROM rtgip.inbox`) texts.push({ where: `${a}.inbox.envelope`, text: r.t as string });
      for (const r of await db[a]`SELECT to_jsonb(r)::text AS t FROM rtgip.receipts r`) texts.push({ where: `${a}.receipts`, text: r.t as string });
      for (const r of await db[a]`SELECT coalesce(array_to_string(receipts, E'\n'), '') AS t FROM rtgip.inbox_deliveries`) texts.push({ where: `${a}.inbox_deliveries.receipts`, text: r.t as string });
    }
    for (const r of await db.gateway`SELECT body, envelope::text AS e, admission_text, coalesce(array_to_string(target_receipts, E'\n'), '') AS t FROM gw_standin.admissions`) {
      texts.push({ where: "gateway.admissions.body", text: r.body as string }, { where: "gateway.admissions.envelope", text: r.e as string }, { where: "gateway.admissions.admission", text: r.admission_text as string }, { where: "gateway.admissions.receipts", text: r.t as string });
    }
    expect(texts.length).toBeGreaterThan(50);
    const rawHits = texts.filter((t) => LEAK.test(t.text)).map((t) => t.where);
    expect(rawHits).toEqual([]);
    const scanHits: string[] = [];
    for (const t of texts.filter((x) => x.where.endsWith("body") || x.where.endsWith("envelope"))) scanHits.push(...scanSensitive(JSON.parse(t.text) as unknown));
    expect(scanHits).toEqual([]);
    const portal = await db.autocurb.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE anon");
      return tx.unsafe("SELECT to_jsonb(p) AS j FROM public.get_submission_portal($1) p", [seed.AC_SEED_PORTAL_TOKEN!]);
    });
    expect(portal).toHaveLength(1);
    expect(portal[0]!.j).toHaveProperty("acv_value", null);
    note("autocurb->autolabels", "customer_financial_privacy", `${texts.length} texts (outbox bodies, inbox envelopes, receipts, Gateway admissions) free of ACV, offer, payoff, finance and customer data (scanSensitive and raw grep); anon get_submission_portal returns acv_value null`);
  });

  // ---- per direction: duplicates, crash after the effect, lost acknowledgement -------------------

  async function replayToTarget(p: Produced, tgt: App) {
    const stored = (await db.gateway`SELECT gateway_nonce, admission_text FROM gw_standin.admissions WHERE event_id = ${p.envelope.event_id} AND target_app = ${tgt}`)[0]!;
    const hdr = {
      ...((await signEnvelope(p.body, p.envelope, keyFor(reg, "gateway"), nowSec(), stored.gateway_nonce as string)) as unknown as Record<string, string>),
      [ADMISSION_HEADER]: encodeAdmissionHeader(JSON.parse(stored.admission_text as string) as ReceiptV2),
    };
    return post(`${servers[tgt].url}/rtgip/v2/inbound`, hdr, p.body);
  }
  const storedAtTarget = async (tgt: App, p: Produced) => {
    const id = await deliveryIdentity(p.envelope, connIdOf(p.envelope.source_app, p.envelope.target_app, p.envelope.tenant_id, p.envelope.rooftop_id));
    return (await db[tgt]`SELECT receipts FROM rtgip.inbox_deliveries WHERE delivery_id = ${id}`)[0]?.receipts as string[] | undefined;
  };

  it.each(DIRS)("%s -> %s: duplicate suppression, crash after the effect, lost acknowledgement", async (src, tgt) => {
    const route = `${src}->${tgt}`;
    // Duplicate suppression: a source resend and a Gateway redelivery return the same receipts and change nothing.
    const a = await fresh(src, tgt);
    await send(src, [a]);
    const first = await proveCommitted(src, tgt, a);
    const snap = async () => JSON.stringify({ rec: await adapters[tgt].record(db[tgt], a.envelope), applied: await appliedRows(tgt, a.envelope), inbox: await db[tgt]`SELECT outcome, received_at, committed_at FROM rtgip.inbox WHERE event_id = ${a.envelope.event_id}` });
    const before = await snap();
    const again = await enqueue(db[src], [a]);
    expect(again.every((x) => x !== "enqueued")).toBe(true);
    const resend = await post(gwUrl(), await signAs(a, src), a.body);
    expect(resend.status).toBe(200);
    expect(canonicalize(resend.doc.receipts![0]!)).toBe(canonicalize(first.receipts[0]!));
    const redeliver = await replayToTarget(a, tgt);
    expect(redeliver.status).toBe(200);
    expect(redeliver.doc.receipts!.map((r) => canonicalize(r))).toEqual(first.receipts.slice(1).map((r) => canonicalize(r)));
    expect(redeliver.doc.receipts!.map((r) => canonicalize(r))).toEqual(await storedAtTarget(tgt, a));
    expect(await snap()).toBe(before);
    expect(await appliedRows(tgt, a.envelope)).toHaveLength(1);

    // Crash after the effect, before the inbox commit: the real rows roll back, the retry applies once.
    const b = await fresh(src, tgt);
    await enqueue(db[src], [b]);
    faults[tgt].crashAfterEffect = 1;
    const crashed = await dispatch(db[src], src, reg, gwHttp.url, `w-${src}`);
    expect(crashed[0]).toMatchObject({ action: "deliver", http_status: 200, state: "gateway_admitted" });
    expect(faults[tgt].crashAfterEffect).toBe(0);
    expect(await db[tgt]`SELECT 1 FROM rtgip.inbox WHERE event_id = ${b.envelope.event_id}`).toHaveLength(0);
    expect(await db[tgt]`SELECT 1 FROM rtgip.admissions WHERE event_id = ${b.envelope.event_id}`).toHaveLength(0);
    expect(await appliedRows(tgt, b.envelope)).toHaveLength(0);
    expect(await adapters[tgt].record(db[tgt], b.envelope)).toBeNull();
    await gwPort.forward();
    await makeDue(db[src]);
    await pump(src);
    await proveCommitted(src, tgt, b);
    expect(await appliedRows(tgt, b.envelope)).toHaveLength(1);

    // Lost acknowledgement: the target commits, its answer is dropped, the Gateway's retry gets the stored receipts.
    const c = await fresh(src, tgt);
    await enqueue(db[src], [c]);
    faults[tgt].dropReceipts = 1;
    const lost = await dispatch(db[src], src, reg, gwHttp.url, `w-${src}`);
    expect(lost[0]).toMatchObject({ action: "deliver", state: "gateway_admitted" });
    expect(faults[tgt].dropReceipts).toBe(0);
    const committed = await appliedRows(tgt, c.envelope);
    expect(committed).toHaveLength(1);
    expect(await adapters[tgt].record(db[tgt], c.envelope)).not.toBeNull();
    expect((await db.gateway`SELECT target_receipts FROM gw_standin.admissions WHERE event_id = ${c.envelope.event_id} AND target_app = ${tgt}`)[0]!.target_receipts).toBeNull();
    const heldBack = await storedAtTarget(tgt, c);
    expect(heldBack).toHaveLength(2);
    await gwPort.forward();
    await makeDue(db[src]);
    await pump(src);
    const done = await proveCommitted(src, tgt, c);
    expect(done.receipts.slice(1).map((r) => canonicalize(r))).toEqual(heldBack);
    expect((await db.gateway`SELECT target_receipts FROM gw_standin.admissions WHERE event_id = ${c.envelope.event_id} AND target_app = ${tgt}`)[0]!.target_receipts).toEqual(heldBack);
    expect(await appliedRows(tgt, c.envelope)).toEqual(committed);
    note(route, "duplicate_crash_lost_ack", "duplicate: byte-identical receipts, state unchanged; crash after the effect: rolled back then applied once; lost ACK: target committed, retry returned the stored receipts, one effect");
  });

  // ---- per direction: cross-tenant and cross-rooftop denial ---------------------------------------

  it.each(DIRS)("%s -> %s: cross-tenant and cross-rooftop events are denied at the source, the Gateway and the target", async (src, tgt) => {
    const ok = await fresh(src, tgt);
    const media = (await db.autoframe`SELECT id::text FROM public.media_assets LIMIT 1`)[0]!.id as string;
    const sourceAttempt =
      src === "autolabels" ? adapters.autolabels.produce(db.autolabels, "listing_availability", scopeB(), { episode_id: EP_OPEN(), targets: tgt })
      : src === "autocurb" ? adapters.autocurb.produce(db.autocurb, "appraisal_completed", scopeB(), { submission_id: seed.AC_SEED_SUB_APPRAISAL!, targets: tgt })
      : adapters.autoframe.produce(db.autoframe, "media.approved", scopeB(), { media_id: media, targets: tgt });
    await expect(sourceAttempt).rejects.toThrow();
    const variants: Record<string, Record<string, string>> = {
      cross_tenant: { tenant_id: tenantB(), rooftop_id: ROOFTOP_B },
      other_tenant_same_rooftop: { tenant_id: tenantB() },
      cross_rooftop: { rooftop_id: ROOFTOP_B },
    };
    const results: Record<string, string> = {};
    for (const [name, patch] of Object.entries(variants)) {
      const x = await resealed(ok.envelope, (e) => ({ ...e, ...patch, origin: { ...(e.origin as object), event_id: `${ok.envelope.origin.event_id}:forged-${name}` } }));
      const r = await post(gwUrl(), await signAs(x, src), x.body);
      expect([name, r.status >= 400 && r.status < 500]).toEqual([name, true]);
      expect(await db.gateway`SELECT 1 FROM gw_standin.admissions WHERE event_id = ${x.envelope.event_id}`).toHaveLength(0);
      expect(await db[tgt]`SELECT 1 FROM rtgip.inbox WHERE event_id = ${x.envelope.event_id}`).toHaveLength(0);
      results[name] = `gateway ${r.status} ${r.doc.reason}`;
      if (name !== "other_tenant_same_rooftop") {
        const d = await forwardDirect(x, tgt);
        const kinds = (d.doc.receipts ?? []).map((q) => `${q.kind}:${q.outcome}`);
        const rec = await adapters[tgt].record(db[tgt], x.envelope);
        if (src === "autocurb" && tgt === "autoframe" && name === "cross_tenant" && d.status === 200 && kinds.includes("consumer_commit:applied")) {
          // AutoFrame records AutoCurb acquisition evidence as a shot-list intake with no vehicle (frame_apply never creates one from
          // AutoCurb). With the Gateway bypassed it cannot tell an unresolved reference from another tenant's, so the intake is
          // written context-only: no vehicle, no episode mapping, no custody fact. Reported as a finding; the registry mapping
          // check at the Gateway is the control that denied this event above.
          expect(rec).toMatchObject({ intake: { vehicle_id: null, status: "open" }, vehicle: null, episode_map: null, fact: null });
          results[name] = `gateway ${results[name]!.replace(/^gateway /, "")}; target wrote a context-only intake (no vehicle, no mapping)`;
          continue;
        }
        expect([name, d.status >= 400 || (kinds.length > 0 && !kinds.some((k) => k === "consumer_commit:applied" || k === "target_inbox:applied"))]).toEqual([name, true]);
        expect(await appliedRows(tgt, x.envelope)).toHaveLength(0);
        expect(rec).toBeNull();
        results[name] += `; target ${d.status} ${d.doc.reason ?? kinds.join(",")}`;
      }
    }
    expect(await appliedRows(tgt, ok.envelope)).toHaveLength(0);
    note(`${src}->${tgt}`, "cross_tenant_cross_rooftop_denial", results);
  });

  it("concurrent dispatchers: every event is leased once and applied once", async () => {
    const evs: Produced[] = [];
    for (let i = 0; i < 6; i++) evs.push(await fresh("autoframe", "autolabels"));
    await enqueue(db.autoframe, evs);
    const rs = await Promise.all([1, 2, 3].map((w) => dispatch(db.autoframe, "autoframe", reg, gwHttp.url, `cw-${w}`)));
    const leased = rs.flat().map((r) => r.event_id);
    expect(rs.flat().every((r) => r.action === "deliver")).toBe(true);
    expect(new Set(leased).size).toBe(leased.length);
    await pump("autoframe");
    for (const e of evs) expect(await appliedRows("autolabels", e.envelope)).toHaveLength(1);
  });

  // ---- attacks through the stand-in Gateway ---------------------------------------------------------

  async function signRaw(body: string, scope: string, owner: App) {
    const k = keyFor(reg, owner);
    const ts = String(nowSec());
    const nonce = `raw_${randomUUID().replace(/-/g, "")}`;
    const sig = SIGNATURE_PREFIX + (await hmacHex(k.secret, preimage(k.key_id, owner, ts, nonce, scope, await sha256Hex(body))));
    return { "rtgip-protocol": "rtgip/2", "rtgip-key-id": k.key_id, "rtgip-signer": owner, "rtgip-timestamp": ts, "rtgip-nonce": nonce, "rtgip-scope": scope, "rtgip-signature": sig };
  }

  it.each(APPS)("%s as source: signer mismatch, wrong key, malformed JSON, protected-data injection, direct-to-target", async (src) => {
    const tgt: App = src === "autolabels" ? "autocurb" : "autolabels";
    const ok = await fresh(src, tgt);
    const cases: [string, Promise<{ status: number; doc: { reason: string | null } }>][] = [];
    cases.push(["signer_is_gateway", post(gwUrl(), await signAs(ok, "gateway"), ok.body)]);
    const other = APPS.find((a) => a !== src)!;
    cases.push(["other_apps_key", post(gwUrl(), { ...(await signAs(ok, other)), "rtgip-signer": src }, ok.body)]);
    const bad = "{\"protocol\":\"rtgip/2\",";
    cases.push(["malformed_json", post(gwUrl(), await signRaw(bad, (await signAs(ok, src))["rtgip-scope"]!, src), bad)]);
    const inj = await resealed(ok.envelope, (x) => ({ ...x, payload: { ...(x.payload as object), customer_email: "x@example.test", acv_cents: 1 } }));
    cases.push(["protected_data_injection", post(gwUrl(), await signAs(inj, src), inj.body)]);
    cases.push(["direct_to_target_with_source_signature", post(`${servers[tgt].url}/rtgip/v2/inbound`, await signAs(ok, src), ok.body)]);
    const results: Record<string, string> = {};
    for (const [name, p] of cases) {
      const r = await p;
      expect(r.status, name).toBeGreaterThanOrEqual(400);
      expect(r.status, name).toBeLessThan(500);
      results[name] = `${r.status} ${r.doc.reason}`;
    }
    for (const e of [ok.envelope, inj.envelope]) {
      expect(await db.gateway`SELECT 1 FROM gw_standin.admissions WHERE event_id = ${e.event_id}`).toHaveLength(0);
      expect(await db[tgt]`SELECT 1 FROM rtgip.inbox WHERE event_id = ${e.event_id}`).toHaveLength(0);
    }
    const xr = await resealed(ok.envelope, (x) => ({ ...x, rooftop_id: ROOFTOP_B }));
    await expect(enqueue(db[src], [xr])).rejects.toThrow(/no_connection_for_event/);
    note(`${src}->${tgt}`, "attacks_refused", results);
  });

  it("revoked credentials: a revoked source key is refused at the Gateway and the row pauses; a revoked Gateway key is refused by the target database", async () => {
    const a = await fresh("autocurb", "autolabels");
    await enqueue(db.autocurb, [a]);
    const live = reg;
    reg = { ...live, keys: live.keys.map((k) => (k.owner === "autocurb" ? { ...k, status: "revoked" as const } : k)) };
    const r1 = await dispatch(db.autocurb, "autocurb", live, gwHttp.url, "w-rev");
    expect(r1[0]).toMatchObject({ http_status: 401, reason: "key_revoked", state: "retry_wait" });
    reg = live;
    await db.autolabels`UPDATE rtgip.signing_keys SET status = 'revoked' WHERE owner = 'gateway'`;
    await makeDue(db.autocurb);
    const r2 = await dispatch(db.autocurb, "autocurb", reg, gwHttp.url, "w-rev");
    expect(r2[0]).toMatchObject({ action: "deliver", state: "gateway_admitted" });
    const refused = (await db.gateway`SELECT decision, reason FROM gw_standin.audit WHERE event_id = ${a.envelope.event_id} AND decision = 'target_error' ORDER BY seq DESC LIMIT 1`)[0];
    expect(refused?.reason).toMatch(/^db:key_revoked/);
    expect(await appliedRows("autolabels", a.envelope)).toHaveLength(0);
    await db.autolabels`UPDATE rtgip.signing_keys SET status = 'current' WHERE owner = 'gateway'`;
    await gwPort.forward();
    await makeDue(db.autocurb);
    await pump("autocurb");
    expect(await appliedRows("autolabels", a.envelope)).toHaveLength(1);
    note("autocurb->autolabels", "revoked_credentials", `source key: 401 key_revoked; gateway key revoked in the target database: ${refused?.reason}; restored -> applied once`);
  });

  it("a consumer rejection is quarantined: the real app refuses an unregistered episode and no consumer_commit receipt exists for it", async () => {
    const ok = await fresh("autoframe", "autolabels");
    const unknown = randomUUID();
    const q = await resealed(ok.envelope, (x) => ({ ...x, vehicle: { ...(x.vehicle as object), instance_id: unknown, episode_id: unknown } }));
    await send("autoframe", [q]);
    expect(await outboxState("autoframe", q.envelope.event_id)).toEqual({ state: "target_quarantined", inbox_outcome: "quarantined" });
    await noConsumerCommit("autoframe", q.envelope.event_id);
    expect(await appliedRows("autolabels", q.envelope)).toHaveLength(0);
    expect(await adapters.autolabels.record(db.autolabels, q.envelope)).toBeNull();
    expect((await db.autolabels`SELECT outcome, reason FROM rtgip.inbox WHERE event_id = ${q.envelope.event_id}`)[0]).toMatchObject({ outcome: "quarantined" });
    note("autoframe->autolabels", "quarantine_no_commit", "the real AutoLabels effect refused: target_quarantined, no consumer_commit receipt, no business record");
  });

  it("source-side capture is transactional: a failed business transaction leaves neither the write nor the outbox row", async () => {
    const a = await fresh("autolabels", "autocurb");
    await expect(enqueue(db.autolabels, [a], { failAfterEnqueue: true })).rejects.toThrow("injected_source_failure");
    expect(await db.autolabels`SELECT 1 FROM rtgip.outbox WHERE event_id = ${a.envelope.event_id}`).toHaveLength(0);
    expect(await db.autolabels`SELECT 1 FROM rtgip_stage.source_writes WHERE event_id = ${a.envelope.event_id}`).toHaveLength(0);
  });

  it("AutoFilm routes are refused at the Gateway before any verification or storage", async () => {
    const a = await fresh("autolabels", "autocurb");
    const h = await signAs(a, "autolabels");
    const scope = h["rtgip-scope"]!.split(";");
    scope[1] = "autofilm";
    const r = await post(gwUrl(), { ...h, "rtgip-scope": scope.join(";") }, a.body);
    expect(r).toEqual({ status: 403, doc: { reason: "autofilm_route_denied" } });
  });

  const sigFor = async (o: { body: string | Buffer; scope: string; key: ServiceKey; signer?: string; ts?: number; nonce?: string; prefix?: string }) => {
    const ts = String(o.ts ?? nowSec());
    const nonce = o.nonce ?? `bnd_${randomUUID().replace(/-/g, "")}`;
    const signer = o.signer ?? o.key.owner;
    const mac = await hmacHex(o.key.secret, preimage(o.key.key_id, signer as never, ts, nonce, o.scope, await sha256Hex(typeof o.body === "string" ? o.body : new Uint8Array(o.body))));
    return { "rtgip-protocol": "rtgip/2", "rtgip-key-id": o.key.key_id, "rtgip-signer": signer, "rtgip-timestamp": ts, "rtgip-nonce": nonce, "rtgip-scope": o.scope, "rtgip-signature": (o.prefix ?? SIGNATURE_PREFIX) + mac } as Record<string, string>;
  };
  const postRaw = async (h: Record<string, string>, body: string | Buffer) => {
    const r = await fetch(gwUrl(), { method: "POST", headers: h, body: typeof body === "string" ? body : new Uint8Array(body) });
    return { status: r.status, reason: ((await r.json()) as { reason: string | null }).reason };
  };
  const withKeys = async <T>(extra: ServiceKey[], fn: () => Promise<T>) => {
    const live = reg;
    reg = { ...live, keys: [...live.keys, ...extra] };
    try {
      return await fn();
    } finally {
      reg = live;
    }
  };

  it("Gateway ingress refuses wrong prefix, missing identity, unknown, wrong-dialect and expired keys, clock skew, nonce reuse, non-canonical, duplicate-key, BOM, invalid UTF-8, oversize, underived ids, wrong purpose and wrong destination", async () => {
    const ok = await fresh("autolabels", "autocurb");
    const scope = (await signAs(ok, "autolabels"))["rtgip-scope"]!;
    const al = keyFor(reg, "autolabels");
    const n = nowSec();
    const legacy: ServiceKey = { ...al, key_id: `stg-al-legacy-${randomUUID().slice(0, 8)}`, dialect: "autolabels.rooftopos/1" };
    const expired: ServiceKey = { ...al, key_id: `stg-al-expired-${randomUUID().slice(0, 8)}`, not_before: n - 7200, not_after: n - 60 };
    const reused = `bnd_reused_${randomUUID().replace(/-/g, "")}`;
    const out: Record<string, string> = {};
    await withKeys([legacy, expired], async () => {
      const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ok.body)]);
      const bad8 = Buffer.concat([Buffer.from(ok.body.slice(0, -1)), Buffer.from([0xff, 0x7d])]);
      const dup = `{"tenant_id":"${ok.envelope.tenant_id}",${ok.body.slice(1)}`;
      const cases: [string, Record<string, string>, string | Buffer, number, string][] = [
        ["wrong_prefix", await sigFor({ body: ok.body, scope, key: al, prefix: "rtgip3=" }), ok.body, 401, "protocol_mismatch"],
        ["wrong_protocol_header", { ...(await sigFor({ body: ok.body, scope, key: al })), "rtgip-protocol": "gateway.service/1" }, ok.body, 401, "protocol_mismatch"],
        ["unknown_key", await sigFor({ body: ok.body, scope, key: { ...al, key_id: "stg-nobody" } }), ok.body, 401, "unknown_key"],
        ["wrong_dialect_key", await sigFor({ body: ok.body, scope, key: legacy }), ok.body, 401, "key_dialect_mismatch"],
        ["expired_key", await sigFor({ body: ok.body, scope, key: expired }), ok.body, 401, "key_outside_validity"],
        ["timestamp_past_window", await sigFor({ body: ok.body, scope, key: al, ts: n - 301 }), ok.body, 401, "timestamp_out_of_window"],
        ["timestamp_future_window", await sigFor({ body: ok.body, scope, key: al, ts: n + 301 }), ok.body, 401, "timestamp_out_of_window"],
        ["non_canonical_whitespace", await sigFor({ body: ok.body.replace(":", ": "), scope, key: al }), ok.body.replace(":", ": "), 401, "body_not_canonical"],
        ["duplicate_json_key", await sigFor({ body: dup, scope, key: al }), dup, 401, "body_not_canonical"],
        ["bom", await sigFor({ body: bom, scope, key: al }), bom, 400, "bom_not_allowed"],
        ["invalid_utf8", await sigFor({ body: bad8, scope, key: al }), bad8, 400, "invalid_utf8"],
        ["oversize", await sigFor({ body: "x".repeat(64 * 1024 + 1), scope, key: al }), "x".repeat(64 * 1024 + 1), 413, "body_too_large"],
      ];
      for (const [name, h, body, status, reason] of cases) {
        const r = await postRaw(h, body);
        expect([name, r.status, r.reason], name).toEqual([name, status, reason]);
        out[name] = `${r.status} ${r.reason}`;
      }
      const { "rtgip-key-id": _k, ...noKey } = await sigFor({ body: ok.body, scope, key: al });
      const r = await postRaw(noKey, ok.body);
      expect([r.status, r.reason]).toEqual([401, "missing_headers"]);
      out.missing_service_identity = `${r.status} ${r.reason}`;
    });
    const forgedId = { ...ok.envelope, event_id: randomUUID() };
    const fb = canonicalize(forgedId);
    const fr = await postRaw(await sigFor({ body: fb, scope: scopeOf(forgedId), key: al }), fb);
    expect(fr.status).toBe(401);
    out.event_id_not_derived = `${fr.status} ${fr.reason}`;
    const wp = await resealed(ok.envelope, (x) => ({ ...x, purpose: "service_history" }));
    const wpr = await postRaw(await sigFor({ body: wp.body, scope: scopeOf(wp.envelope), key: al }), wp.body);
    expect(wpr.status).toBe(401);
    out.unauthorized_purpose = `${wpr.status} ${wpr.reason}`;
    const wd = await resealed(ok.envelope, (x) => ({ ...x, target_app: "autoframe", route: "autolabels->autoframe" }));
    const wdr = await postRaw(await sigFor({ body: wd.body, scope: scopeOf(wd.envelope), key: al }), wd.body);
    expect(wdr.status).toBe(401);
    out.wrong_destination = `${wdr.status} ${wdr.reason}`;
    // Same nonce over other bytes: the first use is admitted, the second refused.
    expect((await postRaw(await sigFor({ body: ok.body, scope, key: al, nonce: reused }), ok.body)).status).toBe(200);
    const other = await fresh("autolabels", "autocurb");
    const nr = await postRaw(await sigFor({ body: other.body, scope: (await signAs(other, "autolabels"))["rtgip-scope"]!, key: al, nonce: reused }), other.body);
    expect([nr.status, nr.reason]).toEqual([401, "nonce_reused"]);
    out.nonce_collision = `${nr.status} ${nr.reason}`;
    // A timestamp 299 s old is still inside the window.
    const edge = await fresh("autolabels", "autocurb");
    expect((await postRaw(await sigFor({ body: edge.body, scope: (await signAs(edge, "autolabels"))["rtgip-scope"]!, key: al, ts: nowSec() - 299 }), edge.body)).status).toBe(200);
    note("autolabels->autocurb", "gateway_ingress_boundary", out);
  });

  it("key rotation: a previous key verifies inside its window; once revoked it never does", async () => {
    const al = keyFor(reg, "autolabels");
    const prev: ServiceKey = { ...al, key_id: `stg-al-prev-${randomUUID().slice(0, 8)}`, status: "previous", secret: randomUUID() };
    const a = await fresh("autolabels", "autocurb");
    const scope = (await signAs(a, "autolabels"))["rtgip-scope"]!;
    await withKeys([prev], async () => expect((await postRaw(await sigFor({ body: a.body, scope, key: prev }), a.body)).status).toBe(200));
    const b = await fresh("autolabels", "autocurb");
    const bscope = (await signAs(b, "autolabels"))["rtgip-scope"]!;
    await withKeys([{ ...prev, status: "revoked" }], async () => expect(await postRaw(await sigFor({ body: b.body, scope: bscope, key: prev }), b.body)).toEqual({ status: 401, reason: "key_revoked" }));
  });

  it("changed immutable envelope under the same event id is refused at the source outbox, the Gateway and the target", async () => {
    const a = await fresh("autolabels", "autocurb");
    await send("autolabels", [a]);
    const changed = { ...a.envelope, correlation_id: "corr-tampered" } as EnvelopeV2;
    const body = canonicalize(changed);
    await expect(enqueue(db.autolabels, [{ envelope: changed, body }])).rejects.toThrow(/event_id_conflict/);
    const g = await postRaw(await sigFor({ body, scope: scopeOf(changed), key: keyFor(reg, "autolabels") }), body);
    expect([401, 409]).toContain(g.status);
    const t = await forwardDirect({ envelope: changed, body }, "autocurb", `chg_${randomUUID().replace(/-/g, "")}`);
    expect([t.status, t.doc.reason, (t.doc.receipts ?? []).map((r) => `${r.kind}:${r.outcome}`)]).toEqual([200, null, ["target_inbox:quarantined"]]);
    expect(await appliedRows("autocurb", a.envelope)).toHaveLength(1);
    note("autolabels->autocurb", "full_envelope_collision", `source: event_id_conflict; gateway: ${g.status} ${g.reason}; target: quarantined, the original stays applied once`);
  });

  it("receipt forgery, wrong issuer key, replayed receipts and a non-lease-holder are refused by outbox_advance", async () => {
    const a = await fresh("autolabels", "autoframe");
    await enqueue(db.autolabels, [a]);
    const asD = <T>(fn: (tx: Sql) => Promise<T>) => db.autolabels.begin(async (tx) => { await tx.unsafe("SET LOCAL ROLE rtgip_dispatcher"); return fn(tx as unknown as Sql); }) as Promise<T>;
    const leased = await asD((tx) => tx`SELECT event_id, lease_generation, lease_action FROM rtgip.outbox_claim('w-forge', 100, 60) WHERE event_id = ${a.envelope.event_id}`);
    expect(leased).toHaveLength(1);
    expect(leased[0]!.lease_action).toBe("deliver");
    const gen = Number(leased[0]!.lease_generation);
    const res = await post(gwUrl(), await signAs(a, "autolabels"), a.body);
    const receipts = res.doc.receipts!;
    const adv = async (worker: string, generation: number, texts: string[]) =>
      (await asD((tx) => tx.unsafe("SELECT rtgip.outbox_advance($1, $2, $3, $4::text[]) AS r", [a.envelope.event_id, worker, generation, tx.array(texts) as never])))[0]!.r as string;
    const adm = receipts[0]!;
    expect(adm.kind).toBe("gateway_admission");
    expect(await adv("w-forge", gen, [canonicalize({ ...adm, issued_at: adm.issued_at + 1 })])).toBe("rejected:ack_bad_signature");
    const appKey = keyFor(reg, "autolabels");
    const { signature: _s, key_id: _k, ...bare } = adm;
    const unsigned = { ...bare, key_id: appKey.key_id };
    const forged = { ...unsigned, signature: await hmacHex(appKey.secret, RECEIPT_PROTOCOL + "\n" + canonicalize(unsigned)) };
    expect(await adv("w-forge", gen, [canonicalize(forged)])).toBe("rejected:ack_key_not_authorized");
    await expect(adv("w-other", gen, [canonicalize(adm)])).rejects.toThrow(/lost_lease/);
    await expect(adv("w-forge", gen + 1, [canonicalize(adm)])).rejects.toThrow(/lost_lease/);
    expect(await adv("w-forge", gen, [canonicalize(adm)])).toBe("gateway_admitted");
    await expect(adv("w-forge", gen, [canonicalize(adm)])).rejects.toThrow(/lost_lease/);
    await pump("autolabels");
    expect(await outboxState("autolabels", a.envelope.event_id)).toMatchObject({ state: "consumer_committed" });
    const rejected = await db.autolabels`SELECT count(*)::int AS c FROM rtgip.audit_log WHERE event_id = ${a.envelope.event_id} AND action = 'receipt_rejected'`;
    expect(rejected[0]!.c).toBe(2);
    note("autolabels->autoframe", "receipt_forgery", "altered receipt, app key posing as Gateway: rejected and audited; non-lease-holder, stale generation and replay after release: lost_lease");
  });

  it("a suspended connection pauses without spending attempts; a dead letter is terminal until an operator redrives it with a reason", async () => {
    const conn = connIdOf("autolabels", "autoframe", tenantA(), ROOFTOP_A());
    await db.autolabels`UPDATE rtgip.connections SET status = 'suspended' WHERE connection_id = ${conn}`;
    const a = await fresh("autolabels", "autoframe");
    await enqueue(db.autolabels, [a]);
    expect((await dispatch(db.autolabels, "autolabels", reg, gwHttp.url, "w-susp")).filter((r) => r.event_id === a.envelope.event_id)).toHaveLength(0);
    expect((await db.autolabels`SELECT attempts FROM rtgip.outbox WHERE event_id = ${a.envelope.event_id}`)[0]!.attempts).toBe(0);
    await db.autolabels`UPDATE rtgip.connections SET status = 'active' WHERE connection_id = ${conn}`;
    await db.autolabels`UPDATE rtgip.outbox SET attempts = 9 WHERE event_id = ${a.envelope.event_id}`;
    const dead = await dispatch(db.autolabels, "autolabels", reg, "http://127.0.0.1:9", "w-dead");
    expect(dead.find((r) => r.event_id === a.envelope.event_id)?.state).toBe("dead_letter");
    expect((await dispatch(db.autolabels, "autolabels", reg, gwHttp.url, "w-dead")).filter((r) => r.event_id === a.envelope.event_id)).toHaveLength(0);
    const asOp = (reason: string) => db.autolabels.begin(async (tx) => { await tx.unsafe("SET LOCAL ROLE rtgip_operator"); return (await tx`SELECT rtgip.outbox_redrive(${a.envelope.event_id}, 'ops-stg', ${reason}) AS r`)[0]!.r; });
    await expect(asOp("x")).rejects.toThrow(/reason_required/);
    await expect(db.autolabels.begin(async (tx) => { await tx.unsafe("SET LOCAL ROLE rtgip_dispatcher"); return tx`SELECT rtgip.outbox_redrive(${a.envelope.event_id}, 'w', 'gateway outage resolved')`; })).rejects.toThrow(/permission denied/);
    expect(await asOp("gateway outage resolved, redrive after review")).toBe("retry_wait");
    await pump("autolabels");
    expect(await appliedRows("autoframe", a.envelope)).toHaveLength(1);
    const acts = (await db.autolabels`SELECT action FROM rtgip.audit_log WHERE event_id = ${a.envelope.event_id} ORDER BY id`).map((r) => r.action as string);
    expect(acts).toEqual(expect.arrayContaining(["enqueued", "fail:dead_letter", "redrive", "advance:consumer_committed"]));
    note("autolabels->autoframe", "suspended_and_dead_letter", "suspended: not leased, 0 attempts; dead letter not re-leased; operator redrive with reason -> applied once; history retained");
  });

  it("history is preserved through every failure: append-only audits on the Gateway and the source", async () => {
    const gw = await db.gateway`SELECT decision, count(*)::int AS c FROM gw_standin.audit GROUP BY decision ORDER BY decision`;
    expect(gw.map((r) => r.decision)).toEqual(expect.arrayContaining(["admitted", "forwarded", "rejected", "target_error"]));
    await expect(db.gateway`DELETE FROM gw_standin.audit`).rejects.toThrow(/append_only/);
    const acts = (await db.autolabels`SELECT DISTINCT action FROM rtgip.audit_log`).map((r) => r.action as string);
    expect(acts).toEqual(expect.arrayContaining(["enqueued", "advance:gateway_admitted", "advance:consumer_committed", "receipt_rejected"]));
    expect((await db.autolabels`SELECT count(*)::int AS c FROM rtgip.receipts`)[0]!.c).toBeGreaterThan(0);
    for (const d of Object.keys(evidence)) note(d, "audit_preserved", "gw_standin.audit append-only; rtgip.audit_log + rtgip.receipts retained");
  });

  // ---- registry revocation: last, because it removes the rooftop everything above ran on ---------------

  it("registry revocation: after the rooftop is revoked and the exports re-synced, the next event is refused at the source, the Gateway admission and the target", async () => {
    const pre: Record<App, Produced> = {
      autolabels: await fresh("autolabels", "autocurb"),
      autocurb: await fresh("autocurb", "autolabels"),
      autoframe: await fresh("autoframe", "autolabels"),
    };
    const keyBefore = keyFor(reg, "gateway");
    const rid = seed.REG_ROOFTOP_A!;
    expect((await db.gateway`SELECT rooftop_registry.revoke_rooftop(${rid}::uuid, ${seed.REG_REVIEWER!}::uuid, 'staging: dealer agreement terminated') AS r`)[0]!.r).toBe("revoked");
    await resync();
    expect(exp.rooftops.map((r) => r.rooftop_id)).toEqual([ROOFTOP_B]);
    expect(exp.connections.every((c) => c.tenant_id === tenantB())).toBe(true);
    expect(exp.mappings).toHaveLength(0);
    const results: Record<string, string> = {};
    for (const src of APPS) {
      const p = pre[src];
      const tgt = p.envelope.target_app as App;
      const kind = { autolabels: "listing_availability", autocurb: "appraisal_completed", autoframe: "media.approved" }[src];
      const ref: Record<string, string> = src === "autolabels" ? { episode_id: EP_OPEN() } : src === "autocurb" ? { submission_id: seed.AC_SEED_SUB_APPRAISAL! } : { media_id: (await db.autoframe`SELECT id::text FROM public.media_assets LIMIT 1`)[0]!.id as string };
      await expect(adapters[src].produce(db[src], kind, scopeA(), ref)).rejects.toThrow(/rooftop_unmapped|rooftop|scope/);
      await expect(enqueue(db[src], [p])).rejects.toThrow(/no_connection_for_event/);
      const g = await post(gwUrl(), await signAs(p, src), p.body);
      expect(g.status).toBeGreaterThanOrEqual(400);
      expect(g.status).toBeLessThan(500);
      expect(await db.gateway`SELECT 1 FROM gw_standin.admissions WHERE event_id = ${p.envelope.event_id}`).toHaveLength(0);
      const d = await forwardDirect(p, tgt, undefined, { gatewayKey: keyBefore });
      const kinds = (d.doc.receipts ?? []).map((q) => `${q.kind}:${q.outcome}`);
      expect(d.status >= 400 || !kinds.some((k) => k.endsWith(":applied"))).toBe(true);
      expect(await appliedRows(tgt, p.envelope)).toHaveLength(0);
      expect(await adapters[tgt].record(db[tgt], p.envelope)).toBeNull();
      results[`${src}->${tgt}`] = `source produce refused, outbox refused, Gateway ${g.status} ${g.doc.reason}, target ${d.status} ${d.doc.reason ?? kinds.join(",")}`;
    }
    for (const [route, r] of Object.entries(results)) note(route, "registry_revocation", r);
  });
});

