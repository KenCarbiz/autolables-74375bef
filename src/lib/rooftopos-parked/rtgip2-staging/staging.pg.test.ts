// @vitest-environment node
// Local four-node staging: AutoLabels, AutoCurb, AutoFrame and a Gateway stand-in, each a real
// HTTP server on 127.0.0.1 over its own throwaway PostgreSQL cluster, with keys generated at
// start-up. Runs only under supabase/tests/rtgip/pg_staging.sh. The Gateway node is a stand-in
// from the shared core; this is not evidence about the hosted Gateway or any hosted system.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { receiptSigningJson, type Receipt } from "../rtgip2/delivery.ts";
import {
  canonicalize, deriveEventId, eventIdScopeOf, hmacHex, payloadHash, preimage, scopeOf, sha256Hex, signEnvelope, SIGNATURE_PREFIX,
  type EnvelopeV2, type Registry, type ServiceKey,
} from "../rtgip2/protocol.ts";
import * as L from "../rtgip2-autolabels/producer.ts";
import { emptyLabelsProjection, labelsConsumer, type LabelsProjection } from "../rtgip2-autolabels/consumer.ts";
import { publishEpisodeOpened, readEpisodeHistory, type SourceDb } from "../rtgip2-autolabels/source-reader.ts";
import * as C from "../rtgip2-autocurb/producer.ts";
import { curbConsumer, emptyCurbProjection, type CurbProjection } from "../rtgip2-autocurb/consumer.ts";
import * as F from "../rtgip2-autoframe/producer.ts";
import { emptyFrameProjection, frameConsumer, type FrameProjection } from "../rtgip2-autoframe/consumer.ts";
import { TENANT, INSTANCE, EPISODE, VIN, ROOFTOP as FIX_ROOFTOP } from "../rtgip2/fixtures.ts";
import { AT, MEDIA, SUB, approval, cmeta, curbRecords, curbScope, frameRecords, frameScope, revocation, revocationRecords } from "../rtgip2-matrix/scenario.ts";
import {
  APPS, OTHER_ROOFTOP, ROOFTOP, connect, connIdOf, dispatch, enqueue, keyFor, makeDue, noFaults, nowSec, projectionEffect,
  seedNode, stagingRegistry, startGatewayStandin, startTarget, type App, type Faults, type Server, type Sql,
} from "./nodes.ts";

const URLS = {
  autolabels: process.env.RTGIP_STG_AUTOLABELS ?? "",
  autocurb: process.env.RTGIP_STG_AUTOCURB ?? "",
  autoframe: process.env.RTGIP_STG_AUTOFRAME ?? "",
  gateway: process.env.RTGIP_STG_GATEWAY ?? "",
};
const run = describe.runIf(!!URLS.autolabels && !!URLS.gateway);

const tenant = randomUUID();
const otherTenant = randomUUID();
const ids = { ep: randomUUID(), listing: randomUUID(), file: randomUUID(), store: randomUUID(), mapper: randomUUID() };
let reg: Registry;
const db = {} as Record<App | "gateway", Sql>;
const faults: Record<App, Faults> = { autolabels: noFaults(), autocurb: noFaults(), autoframe: noFaults() };
const servers = {} as Record<App | "gateway", Server>;
const evidence: Record<string, Record<string, unknown>> = {};
const note = (route: string, k: string, v: unknown) => void ((evidence[route] ??= {})[k] = v);
const scope = () => ({ tenant_id: tenant, rooftop_id: ROOFTOP, scope_verified_server_side: true as const });
const labelsMeta = (id: string, agg: string, rev = 1): L.FactMeta => ({
  origin_event_id: id, aggregate_id: agg, revision: rev, prev_revision: rev > 1 ? rev - 1 : null, correlation_id: "corr-stg", occurred_at: AT, emitted_at: AT,
});

/** Synthetic AutoCurb/AutoFrame source rows (the matrix scenario) rebound to the staging identity AutoLabels issued. */
function rebind<T>(x: T, extra: Record<string, string> = {}): T {
  let s = JSON.stringify(x);
  for (const [a, b] of Object.entries({ [TENANT]: tenant, [INSTANCE]: ids.ep, [EPISODE]: ids.ep, [FIX_ROOFTOP]: ROOFTOP, ...extra })) s = s.split(a).join(b);
  return JSON.parse(s) as T;
}

const labelsReader: SourceDb = {
  call: (fn, args) =>
    db.autolabels.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE rtgip_source_reader; SET LOCAL transaction_read_only = on");
      return (await tx.unsafe(`SELECT rtgip_src.${fn}($1::uuid, $2::text, $3::uuid) AS v`, args))[0]!.v as unknown;
    }) as Promise<unknown>,
};
const effects = async (app: App, id: string) => Number((await db[app]`SELECT count(*)::int AS c FROM rtgip_stage.effects WHERE event_id = ${id}`)[0]!.c);
const projection = async <P>(app: App) => (await db[app]`SELECT doc FROM rtgip_stage.projection WHERE app = ${app}`)[0]?.doc as P;
const outboxState = async (app: App, id: string) => (await db[app]`SELECT state, last_inbox_outcome FROM rtgip.outbox WHERE event_id = ${id}`)[0];
const receiptKinds = async (app: App, id: string) =>
  (await db[app]`SELECT kind, outcome FROM rtgip.receipts WHERE event_id = ${id} ORDER BY attempt, kind`).map((r) => `${r.kind}:${r.outcome}`);

async function pumpUntilSettled(app: App, max = 6) {
  const all = [];
  for (let i = 0; i < max; i++) {
    const r = await dispatch(db[app], app, reg, servers.gateway.url, `w-${app}`);
    all.push(...r);
    if (r.length === 0) {
      const open = await db[app]`SELECT count(*)::int AS c FROM rtgip.outbox WHERE state NOT IN ('consumer_committed','target_quarantined','dead_letter')`;
      if (open[0]!.c === 0) break;
      await makeDue(db[app]);
    }
  }
  return all;
}

/** Full evidence for one committed delivery, recorded per route. */
async function proveCommitted(src: App, tgt: App, envelope: EnvelopeV2, sourceFact: string) {
  const route = `${src}->${tgt}`;
  const ob = await outboxState(src, envelope.event_id);
  expect(ob?.state).toBe("consumer_committed");
  const gw = await db.gateway`SELECT connection_id FROM gw_standin.admissions WHERE event_id = ${envelope.event_id} AND target_app = ${tgt}`;
  expect(gw).toEqual([{ connection_id: connIdOf(src, tgt, tenant) }]);
  const inbox = await db[tgt]`SELECT outcome, committed_at IS NOT NULL AS committed FROM rtgip.inbox WHERE event_id = ${envelope.event_id}`;
  expect(inbox[0]?.committed).toBe(true);
  expect(await effects(tgt, envelope.event_id)).toBe(1);
  const kinds = await receiptKinds(src, envelope.event_id);
  expect(kinds.filter((k) => k.startsWith("consumer_commit"))).toHaveLength(1);
  note(route, "source_fact_verified", sourceFact);
  note(route, "signing_and_source_authority_verified", `gateway stand-in verified ${src} key over connection ${connIdOf(src, tgt, tenant)}`);
  note(route, "gateway_admission_committed", "gw_standin.admissions row");
  note(route, "target_inbox_committed", `rtgip.inbox outcome=${inbox[0]?.outcome}, committed`);
  note(route, "consumer_effect_committed", "rtgip_stage.effects = 1, projection updated by the real consumer");
  note(route, "signed_ack_verified", `rtgip.outbox_advance verified: ${kinds.join(", ")}`);
}

run("local four-node staging over HTTP and committed transactions", () => {
  beforeAll(async () => {
    db.autolabels = connect(URLS.autolabels);
    db.autocurb = connect(URLS.autocurb);
    db.autoframe = connect(URLS.autoframe);
    db.gateway = connect(URLS.gateway);
    reg = stagingRegistry(tenant, otherTenant);
    for (const a of APPS) await seedNode(db[a], reg, a);
    await db.autolabels.begin(async (tx) => {
      await tx`INSERT INTO public.tenants (id, name, slug) VALUES (${tenant}, 'Staging Synthetic', ${"stg-" + tenant}), (${otherTenant}, 'Staging Other', ${"stg-o-" + otherTenant})`;
      await tx`INSERT INTO public.vehicles (vin) VALUES (${VIN}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO public.vehicle_files (id, tenant_id, vin, stock_number) VALUES (${ids.file}, ${tenant}, ${VIN}, 'STG1001')`;
      await tx`INSERT INTO public.dealer_stores (id, tenant_id) VALUES (${ids.store}, ${tenant})`;
      await tx`INSERT INTO rtgip_src.rooftop_stores (tenant_id, rooftop_id, store_id, mapped_by, reason) VALUES (${tenant}, ${ROOFTOP}, ${ids.store}, ${ids.mapper}, 'staging synthetic mapping')`;
      await tx`INSERT INTO public.vehicle_listings (id, store_id, owning_store_id, tenant_id, vin, slug, vehicle_file_id) VALUES (${ids.listing}, ${randomUUID()}, ${ids.store}, ${tenant}, ${VIN}, ${"stg-" + ids.listing}, ${ids.file})`;
      await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, listing_id)
        VALUES (${ids.ep}, ${tenant}, ${VIN}, ${ids.store}, 'active', 'in_stock', 'initial', ${ids.listing})`;
    });
    const labelsSeed: LabelsProjection = emptyLabelsProjection();
    labelsSeed.instances[ids.ep] = { tenant_id: tenant, rooftop_id: ROOFTOP, vin: VIN, episodes: { [ids.ep]: { state: "open", opened_reason: "acquisition" } }, service_visits: {} } as LabelsProjection["instances"][string];
    await db.autolabels`INSERT INTO rtgip_stage.projection (app, doc) VALUES ('autolabels', ${db.autolabels.json(labelsSeed as never)})`;
    const regFn = () => reg;
    servers.autolabels = await startTarget("autolabels", db.autolabels, regFn, projectionEffect<LabelsProjection>("autolabels", labelsConsumer, emptyLabelsProjection, faults.autolabels), faults.autolabels);
    servers.autocurb = await startTarget("autocurb", db.autocurb, regFn, projectionEffect<CurbProjection>("autocurb", curbConsumer, emptyCurbProjection, faults.autocurb), faults.autocurb);
    servers.autoframe = await startTarget("autoframe", db.autoframe, regFn, projectionEffect<FrameProjection>("autoframe", frameConsumer, emptyFrameProjection, faults.autoframe), faults.autoframe);
    servers.gateway = await startGatewayStandin(db.gateway, regFn, () => ({ autolabels: servers.autolabels.url, autocurb: servers.autocurb.url, autoframe: servers.autoframe.url }));
  });
  afterAll(async () => {
    for (const s of Object.values(servers)) await s?.close();
    for (const s of Object.values(db)) await s?.end();
    if (process.env.RTGIP_STG_REPORT) writeFileSync(process.env.RTGIP_STG_REPORT, JSON.stringify({ tenant_is_synthetic: true, keys_generated_at_start: reg.keys.map((k) => k.key_id), routes: evidence }, null, 2));
  });

  // ---- positive path, all six directions ----

  it("AutoLabels -> AutoCurb and AutoFrame: identity and episode read from the PR #46 rows by rtgip_source_reader", async () => {
    const { inst } = await readEpisodeHistory(labelsReader, scope(), ids.ep);
    expect(inst).toMatchObject({ instance_id: ids.ep, episode_id: ids.ep, stock_number: "STG1001" });
    const idn = await L.identityRegistered(scope(), inst, { year: 2024, make: "Synthetic", model: "Sedan", trim: null, registered_at: AT }, labelsMeta("al-id-1", ids.ep), ["autocurb", "autoframe"]);
    const ep = await publishEpisodeOpened(labelsReader, scope(), ids.ep, {}, { correlation_id: "corr-stg", emitted_at: AT, prev_revision: null }, ["autocurb", "autoframe"]);
    // Identity must be committed before the episode that refers to it: the outbox does not order
    // across aggregates, and a consumer quarantines an episode for an instance it has not seen.
    expect(await enqueue(db.autolabels, idn)).toEqual(["enqueued", "enqueued"]);
    await pumpUntilSettled("autolabels");
    expect(await enqueue(db.autolabels, ep)).toEqual(["enqueued", "enqueued"]);
    await pumpUntilSettled("autolabels");
    for (const p of [...idn, ...ep]) await proveCommitted("autolabels", p.envelope.target_app as App, p.envelope, "rtgip_src.labels_episode_history over vehicle_instances (staging cluster)");
    expect((await projection<CurbProjection>("autocurb")).vehicles[ids.ep]!.identity?.stock_number).toBe("STG1001");
    expect((await projection<FrameProjection>("autoframe")).vehicles[ids.ep]).toMatchObject({ approvals_allowed: true, current_episode_id: ids.ep });
  });

  it("AutoCurb -> AutoLabels and AutoFrame: appraisal and purchase from attributed ledger rows; no valuation on the wire", async () => {
    const cs = rebind(curbScope);
    const apr = await C.appraisalCompleted(cs, rebind(curbRecords("appraisal_completed")), cmeta("ac-apr-1"), ["autolabels", "autoframe"]);
    const ms = await C.acquisitionMilestone(cs, rebind(curbRecords("deal_finalized")), cmeta("ac-m-1"), ["autolabels"]);
    const pur = await C.purchaseCompleted(cs, rebind(curbRecords("purchase_complete")), cmeta("ac-pur-1", 2, { autolabels: 1, autoframe: null }), ["autolabels", "autoframe"]);
    await enqueue(db.autocurb, [...apr, ...ms, ...pur]);
    await pumpUntilSettled("autocurb");
    for (const p of [...apr, ...ms, ...pur]) await proveCommitted("autocurb", p.envelope.target_app as App, p.envelope, "AutoCurb producer over ledger rows with actor roles (reader SQL verified in AutoCurb CI)");
    const wire = (await db.autocurb`SELECT body FROM rtgip.outbox`).map((r) => r.body as string).join("\n").toLowerCase();
    for (const s of ["acv", "offer", "price", "phone", "email"]) expect(wire).not.toContain(s);
    expect((await projection<LabelsProjection>("autolabels")).evidence.map((x) => x.kind).sort()).toEqual(["acquisition_milestone:deal_finalized", "appraisal_finalized", "purchase_completed_custody_received"]);
  });

  it("AutoFrame -> AutoLabels and AutoCurb: approval, revocation, and a late stale approval cannot resurrect it", async () => {
    const fs = rebind(frameScope(null));
    const stale = await F.mediaApproved(rebind(approval(1, "af-evt-stale")), fs, rebind(frameRecords(1, "af-evt-stale")), ["autolabels", "autocurb"]);
    const ok = await F.mediaApproved(rebind(approval(1)), fs, rebind(frameRecords(1)), ["autolabels", "autocurb"]);
    await enqueue(db.autoframe, ok);
    await pumpUntilSettled("autoframe");
    for (const p of ok) await proveCommitted("autoframe", p.envelope.target_app as App, p.envelope, "AutoFrame producer over media/approval rows (reader SQL verified in AutoFrame CI)");
    const rv = await F.mediaRevoked(rebind(revocation(2, 1)), rebind(frameScope(1)), rebind(revocationRecords(2)), ["autolabels", "autocurb"]);
    await enqueue(db.autoframe, rv);
    await pumpUntilSettled("autoframe");
    await enqueue(db.autoframe, stale);
    await pumpUntilSettled("autoframe");
    for (const p of stale) expect(await outboxState("autoframe", p.envelope.event_id)).toEqual({ state: "consumer_committed", last_inbox_outcome: "stale_ignored" });
    expect((await projection<LabelsProjection>("autolabels")).media[MEDIA]).toMatchObject({ state: "revoked", active_in_gallery: false });
    expect((await projection<CurbProjection>("autocurb")).vehicles[ids.ep]!.media[MEDIA]!.state).toBe("revoked");
    for (const t of ["autolabels->autocurb", "autoframe->autolabels", "autoframe->autocurb"]) note(t, "stale_revision", "stale_ignored, no effect");
  });

  // ---- per-direction failure, retry and replay through HTTP ----

  let seq = 0;
  async function freshEvent(src: App, tgt: App) {
    const i = ++seq;
    if (src === "autolabels") {
      const { inst } = await readEpisodeHistory(labelsReader, scope(), ids.ep);
      return tgt === "autocurb"
        ? L.pricePublished(scope(), inst, { vehicle_selling_price_cents: 2_450_000 + i, doc_fee_cents: 49_900, total_advertised_price_cents: 2_499_900 + i, published_at: AT }, labelsMeta(`al-pr-${i}`, `listing-stg-${i}`), [tgt])
        : L.listingAvailabilityChanged(scope(), inst, true, `passport-stg-${i}`, AT, labelsMeta(`al-av-${i}`, `listing-stg-${i}`), [tgt]);
    }
    if (src === "autocurb") {
      const sub = randomUUID();
      return C.appraisalCompleted(rebind(curbScope), rebind(curbRecords("appraisal_completed", {}, sub)), cmeta(`ac-apr-f${i}`), [tgt]);
    }
    const m = `med-stg-${i}`;
    return F.mediaApproved(rebind(approval(1, `af-f-${i}`), { [MEDIA]: m }), rebind(frameScope(null)), rebind(frameRecords(1, `af-f-${i}`), { [MEDIA]: m }), [tgt]);
  }
  const DIRS: [App, App][] = [["autolabels", "autocurb"], ["autolabels", "autoframe"], ["autocurb", "autolabels"], ["autocurb", "autoframe"], ["autoframe", "autolabels"], ["autoframe", "autocurb"]];

  it.each(DIRS)("%s -> %s: lost acknowledgement, crash in the consumer transaction, exact replay and altered replay", async (src, tgt) => {
    const route = `${src}->${tgt}`;
    // Lost ACK: the target commits but the receipts never arrive; the retry gets the committed duplicate.
    const [a] = await freshEvent(src, tgt);
    await enqueue(db[src], [a!]);
    faults[tgt].dropReceipts = 1;
    const first = await dispatch(db[src], src, reg, servers.gateway.url, `w-${src}`);
    expect(first[0]!.state).toBe("retry_wait");
    expect(await effects(tgt, a!.envelope.event_id)).toBe(1);
    await makeDue(db[src]);
    await pumpUntilSettled(src);
    expect(await outboxState(src, a!.envelope.event_id)).toMatchObject({ state: "consumer_committed" });
    expect(await effects(tgt, a!.envelope.event_id)).toBe(1);
    // Crash inside the target's business transaction: nothing commits, no receipt, retry applies once.
    const [b] = await freshEvent(src, tgt);
    await enqueue(db[src], [b!]);
    faults[tgt].crashInEffect = 1;
    const crashed = await dispatch(db[src], src, reg, servers.gateway.url, `w-${src}`);
    expect(crashed[0]).toMatchObject({ http_status: 502, state: "retry_wait" });
    expect(await db[tgt]`SELECT 1 FROM rtgip.inbox WHERE event_id = ${b!.envelope.event_id}`).toHaveLength(0);
    expect(await db[tgt]`SELECT 1 FROM rtgip.admissions WHERE event_id = ${b!.envelope.event_id}`).toHaveLength(0);
    await makeDue(db[src]);
    await pumpUntilSettled(src);
    expect(await effects(tgt, b!.envelope.event_id)).toBe(1);
    // Replay of the exact Gateway-forwarded delivery straight at the target: a committed duplicate, no second effect.
    const gwKey = keyFor(reg, "gateway");
    const nonce = (await db.gateway`SELECT gateway_nonce FROM gw_standin.admissions WHERE event_id = ${b!.envelope.event_id}`)[0]!.gateway_nonce as string;
    const hdr = (await signEnvelope(b!.body, b!.envelope, gwKey, nowSec(), nonce)) as unknown as Record<string, string>;
    const replay = await fetch(`${servers[tgt].url}/rtgip/v2/inbound`, { method: "POST", headers: hdr, body: b!.body });
    const rj = (await replay.json()) as { receipts: { kind: string; outcome: string }[] };
    expect(replay.status).toBe(200);
    expect(rj.receipts.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["target_inbox:duplicate", `consumer_commit:${rj.receipts[1]?.outcome}`]);
    expect(await effects(tgt, b!.envelope.event_id)).toBe(1);
    // The same nonce over other bytes is refused by the target database.
    const [c] = await freshEvent(src, tgt);
    const hdr2 = (await signEnvelope(c!.body, c!.envelope, gwKey, nowSec(), nonce)) as unknown as Record<string, string>;
    const altered = await fetch(`${servers[tgt].url}/rtgip/v2/inbound`, { method: "POST", headers: hdr2, body: c!.body });
    expect(altered.status).toBe(403);
    expect(await effects(tgt, c!.envelope.event_id)).toBe(0);
    note(route, "failure_retry_replay", "lost ack -> committed duplicate (1 effect); crash -> 503/no receipt -> retry (1 effect); exact replay -> duplicate; nonce reuse over other bytes -> 403");
  });

  it("concurrent dispatchers: every event is leased once and applied once", async () => {
    const evs = [];
    for (let i = 0; i < 6; i++) evs.push(...(await freshEvent("autolabels", "autocurb")));
    await enqueue(db.autolabels, evs);
    const [x, y, z] = await Promise.all([1, 2, 3].map((w) => dispatch(db.autolabels, "autolabels", reg, servers.gateway.url, `cw-${w}`)));
    const leased = [...x!, ...y!, ...z!].map((r) => r.event_id);
    expect(new Set(leased).size).toBe(leased.length);
    await pumpUntilSettled("autolabels");
    for (const e of evs) expect(await effects("autocurb", e.envelope.event_id)).toBe(1);
  });

  // ---- attacks, all through the HTTP Gateway stand-in ----

  const post = async (url: string, h: Record<string, string>, body: string) => {
    const r = await fetch(url, { method: "POST", headers: h, body });
    return { status: r.status, doc: (await r.json()) as { reason: string | null } };
  };
  const gwUrl = () => `${servers.gateway.url}/rtgip/v2/deliver`;
  const signAs = async (e: { body: string; envelope: EnvelopeV2 }, owner: "autolabels" | "autocurb" | "autoframe" | "gateway") =>
    (await signEnvelope(e.body, e.envelope, keyFor(reg, owner), nowSec(), `atk_${randomUUID().replace(/-/g, "")}`)) as unknown as Record<string, string>;
  async function signRaw(body: string, scope: string, owner: App) {
    const k = keyFor(reg, owner);
    const ts = String(nowSec());
    const nonce = `raw_${randomUUID().replace(/-/g, "")}`;
    const sig = SIGNATURE_PREFIX + (await hmacHex(k.secret, preimage(k.key_id, owner, ts, nonce, scope, await sha256Hex(body))));
    return { "rtgip-protocol": "rtgip/2", "rtgip-key-id": k.key_id, "rtgip-signer": owner, "rtgip-timestamp": ts, "rtgip-nonce": nonce, "rtgip-scope": scope, "rtgip-signature": sig };
  }
  async function resealed(e: EnvelopeV2, patch: (x: Record<string, unknown>) => Record<string, unknown>) {
    const { payload_sha256: _p, event_id: _e, ...rest } = e;
    const draft = patch(rest as unknown as Record<string, unknown>) as unknown as Omit<EnvelopeV2, "payload_sha256">;
    const event_id = await deriveEventId(eventIdScopeOf(draft));
    const envelope = { ...draft, event_id, payload_sha256: await payloadHash(draft.payload) } as EnvelopeV2;
    return { envelope, body: canonicalize(envelope) };
  }

  it.each(APPS)("%s as source: cross-tenant, cross-rooftop, signer mismatch, wrong key, malformed JSON, protected-data injection, direct-to-target", async (src) => {
    const tgt: App = src === "autolabels" ? "autocurb" : "autolabels";
    const [ok] = await freshEvent(src, tgt);
    const cases: [string, Promise<{ status: number; doc: { reason: string | null } }>][] = [];
    const xt = await resealed(ok!.envelope, (x) => ({ ...x, tenant_id: otherTenant }));
    cases.push(["cross_tenant", post(gwUrl(), await signAs(xt, src), xt.body)]);
    const xr = await resealed(ok!.envelope, (x) => ({ ...x, rooftop_id: OTHER_ROOFTOP }));
    cases.push(["cross_rooftop", post(gwUrl(), await signAs(xr, src), xr.body)]);
    cases.push(["signer_is_gateway", post(gwUrl(), await signAs(ok!, "gateway"), ok!.body)]);
    const other = APPS.find((a) => a !== src)!;
    const wrong = await signAs(ok!, other);
    cases.push(["other_apps_key", post(gwUrl(), { ...wrong, "rtgip-signer": src }, ok!.body)]);
    const bad = "{\"protocol\":\"rtgip/2\",";
    cases.push(["malformed_json", post(gwUrl(), await signRaw(bad, (await signAs(ok!, src))["rtgip-scope"]!, src), bad)]);
    const inj = await resealed(ok!.envelope, (x) => ({ ...x, payload: { ...(x.payload as object), customer_email: "x@example.test", acv_cents: 1 } }));
    cases.push(["protected_data_injection", post(gwUrl(), await signAs(inj, src), inj.body)]);
    cases.push(["direct_to_target_with_source_signature", post(`${servers[tgt].url}/rtgip/v2/inbound`, await signAs(ok!, src), ok!.body)]);
    const results: Record<string, string> = {};
    for (const [name, p] of cases) {
      const r = await p;
      expect(r.status, name).toBeGreaterThanOrEqual(400);
      expect(r.status, name).toBeLessThan(500);
      results[name] = `${r.status} ${r.doc.reason}`;
    }
    for (const e of [ok!.envelope, xt.envelope, xr.envelope, inj.envelope]) {
      expect(await db.gateway`SELECT 1 FROM gw_standin.admissions WHERE event_id = ${e.event_id}`).toHaveLength(0);
      expect(await db[tgt]`SELECT 1 FROM rtgip.inbox WHERE event_id = ${e.event_id}`).toHaveLength(0);
    }
    // The source database refuses to enqueue an event outside its grants.
    await expect(enqueue(db[src], [xr])).rejects.toThrow(/no_connection_for_event/);
    note(`${src}->${tgt}`, "attacks_refused", results);
  });

  it("revoked credentials: a revoked source key is refused at the Gateway and the row pauses; a revoked Gateway key is refused by the target database", async () => {
    const [a] = await freshEvent("autocurb", "autolabels");
    await enqueue(db.autocurb, [a!]);
    const live = reg;
    reg = { ...live, keys: live.keys.map((k) => (k.owner === "autocurb" ? { ...k, status: "revoked" as const } : k)) };
    const r1 = await dispatch(db.autocurb, "autocurb", live, servers.gateway.url, "w-rev");
    expect(r1[0]).toMatchObject({ http_status: 401, reason: "key_revoked", state: "retry_wait" });
    reg = live;
    await db.autolabels`UPDATE rtgip.signing_keys SET status = 'revoked' WHERE owner = 'gateway'`;
    await makeDue(db.autocurb);
    const r2 = await dispatch(db.autocurb, "autocurb", reg, servers.gateway.url, "w-rev");
    expect(r2[0]!.reason).toMatch(/^db:key_revoked|^db:/);
    expect(await effects("autolabels", a!.envelope.event_id)).toBe(0);
    await db.autolabels`UPDATE rtgip.signing_keys SET status = 'current' WHERE owner = 'gateway'`;
    await makeDue(db.autocurb);
    await pumpUntilSettled("autocurb");
    expect(await effects("autolabels", a!.envelope.event_id)).toBe(1);
    note("autocurb->autolabels", "revoked_credentials", `source key: 401 key_revoked; gateway key revoked in target DB: ${r2[0]!.reason}; restored -> applied once`);
  });

  it("a consumer rejection is quarantined: no consumer_commit receipt exists for it anywhere", async () => {
    const unknown = randomUUID();
    const m = "med-stg-quarantine";
    const fs = { ...rebind(frameScope(null)), episode_map: { 1: unknown } };
    const q = await F.mediaApproved(rebind(approval(1, "af-q-1"), { [MEDIA]: m }), fs, rebind(frameRecords(1, "af-q-1"), { [MEDIA]: m }), ["autolabels"]);
    await enqueue(db.autoframe, q);
    await pumpUntilSettled("autoframe");
    expect(await outboxState("autoframe", q[0]!.envelope.event_id)).toEqual({ state: "target_quarantined", last_inbox_outcome: "quarantined" });
    expect(await receiptKinds("autoframe", q[0]!.envelope.event_id)).not.toContain("consumer_commit:applied");
    expect((await receiptKinds("autoframe", q[0]!.envelope.event_id)).some((k) => k.startsWith("consumer_commit"))).toBe(false);
    expect(await effects("autolabels", q[0]!.envelope.event_id)).toBe(0);
    expect((await db.autolabels`SELECT outcome FROM rtgip.inbox WHERE event_id = ${q[0]!.envelope.event_id}`)[0]!.outcome).toBe("quarantined");
    note("autoframe->autolabels", "quarantine_no_commit", "target_quarantined; no consumer_commit receipt; no effect");
  });

  it("source-side capture is transactional: a failed business transaction leaves neither the write nor the outbox row", async () => {
    const [a] = await freshEvent("autolabels", "autocurb");
    await expect(enqueue(db.autolabels, [a!], { failAfterEnqueue: true })).rejects.toThrow("injected_source_failure");
    expect(await db.autolabels`SELECT 1 FROM rtgip.outbox WHERE event_id = ${a!.envelope.event_id}`).toHaveLength(0);
    expect(await db.autolabels`SELECT 1 FROM rtgip_stage.source_writes WHERE event_id = ${a!.envelope.event_id}`).toHaveLength(0);
  });

  it("AutoFilm routes are refused at the Gateway before any verification or storage", async () => {
    const [a] = await freshEvent("autolabels", "autocurb");
    const h = await signAs(a!, "autolabels");
    const scope = h["rtgip-scope"]!.split(";");
    scope[1] = "autofilm";
    const r = await post(gwUrl(), { ...h, "rtgip-scope": scope.join(";") }, a!.body);
    expect(r).toEqual({ status: 403, doc: { reason: "autofilm_route_denied" } });
  });

  // ---- Phase 3D shared cases: Gateway ingress boundary, envelope integrity, receipts, pauses ----

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
    try { return await fn(); } finally { reg = live; }
  };

  it("Gateway ingress refuses wrong prefix, missing identity, unknown, wrong-dialect and expired keys, clock skew, nonce reuse, non-canonical, duplicate-key, BOM, invalid UTF-8, oversize, underived ids, wrong purpose and wrong destination", async () => {
    const [ok] = await freshEvent("autolabels", "autocurb");
    const scope = (await signAs(ok!, "autolabels"))["rtgip-scope"]!;
    const al = keyFor(reg, "autolabels");
    const n = nowSec();
    const legacy: ServiceKey = { ...al, key_id: `stg-al-legacy-${randomUUID().slice(0, 8)}`, dialect: "autolabels.rooftopos/1" };
    const expired: ServiceKey = { ...al, key_id: `stg-al-expired-${randomUUID().slice(0, 8)}`, not_before: n - 7200, not_after: n - 60 };
    const reused = `bnd_reused_${randomUUID().replace(/-/g, "")}`;
    const out: Record<string, string> = {};
    await withKeys([legacy, expired], async () => {
      const cases: [string, Record<string, string>, string | Buffer, number, string][] = [
        ["wrong_prefix", await sigFor({ body: ok!.body, scope, key: al, prefix: "rtgip3=" }), ok!.body, 401, "protocol_mismatch"],
        ["wrong_protocol_header", { ...(await sigFor({ body: ok!.body, scope, key: al })), "rtgip-protocol": "gateway.service/1" }, ok!.body, 401, "protocol_mismatch"],
        ["unknown_key", await sigFor({ body: ok!.body, scope, key: { ...al, key_id: "stg-nobody" } }), ok!.body, 401, "unknown_key"],
        ["wrong_dialect_key", await sigFor({ body: ok!.body, scope, key: legacy }), ok!.body, 401, "key_dialect_mismatch"],
        ["expired_key", await sigFor({ body: ok!.body, scope, key: expired }), ok!.body, 401, "key_outside_validity"],
        ["timestamp_past_window", await sigFor({ body: ok!.body, scope, key: al, ts: n - 301 }), ok!.body, 401, "timestamp_out_of_window"],
        ["timestamp_future_window", await sigFor({ body: ok!.body, scope, key: al, ts: n + 301 }), ok!.body, 401, "timestamp_out_of_window"],
        ["non_canonical_whitespace", await sigFor({ body: ok!.body.replace(":", ": "), scope, key: al }), ok!.body.replace(":", ": "), 401, "body_not_canonical"],
        ["duplicate_json_key", await sigFor({ body: `{"tenant_id":"${tenant}",${ok!.body.slice(1)}`, scope, key: al }), `{"tenant_id":"${tenant}",${ok!.body.slice(1)}`, 401, "body_not_canonical"],
        ["bom", await sigFor({ body: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ok!.body)]), scope, key: al }), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ok!.body)]), 400, "bom_not_allowed"],
        ["invalid_utf8", await sigFor({ body: Buffer.concat([Buffer.from(ok!.body.slice(0, -1)), Buffer.from([0xff, 0x7d])]), scope, key: al }), Buffer.concat([Buffer.from(ok!.body.slice(0, -1)), Buffer.from([0xff, 0x7d])]), 400, "invalid_utf8"],
        ["oversize", await sigFor({ body: "x".repeat(64 * 1024 + 1), scope, key: al }), "x".repeat(64 * 1024 + 1), 413, "body_too_large"],
      ];
      for (const [name, h, body, status, reason] of cases) {
        const r = await postRaw(h, body);
        expect([name, r.status, r.reason], name).toEqual([name, status, reason]);
        out[name] = `${r.status} ${r.reason}`;
      }
      // The missing-identity case drops the key header entirely.
      const { "rtgip-key-id": _k, ...noKey } = await sigFor({ body: ok!.body, scope, key: al });
      const r = await postRaw(noKey, ok!.body);
      expect([r.status, r.reason]).toEqual([401, "missing_headers"]);
      out.missing_service_identity = `${r.status} ${r.reason}`;
    });
    // Same nonce over other bytes: the first use is admitted, the second refused.
    const [other] = await freshEvent("autolabels", "autocurb");
    expect((await postRaw(await sigFor({ body: ok!.body, scope, key: al, nonce: reused }), ok!.body)).status).toBe(200);
    const oscope = (await signAs(other!, "autolabels"))["rtgip-scope"]!;
    const nr = await postRaw(await sigFor({ body: other!.body, scope: oscope, key: al, nonce: reused }), other!.body);
    expect([nr.status, nr.reason]).toEqual([401, "nonce_reused"]);
    out.nonce_collision = `${nr.status} ${nr.reason}`;
    // A timestamp 299 s old is still inside the window.
    const [edge] = await freshEvent("autolabels", "autocurb");
    const escope = (await signAs(edge!, "autolabels"))["rtgip-scope"]!;
    expect((await postRaw(await sigFor({ body: edge!.body, scope: escope, key: al, ts: nowSec() - 299 }), edge!.body)).status).toBe(200);
    // Event id not derived from the envelope, unauthorized purpose, destination outside the route.
    const forgedId = { ...ok!.envelope, event_id: randomUUID() };
    const fb = canonicalize(forgedId);
    const fr = await postRaw(await sigFor({ body: fb, scope: scopeOf(forgedId), key: al }), fb);
    expect(fr.status).toBe(401);
    out.event_id_not_derived = `${fr.status} ${fr.reason}`;
    const wp = await resealed(ok!.envelope, (x) => ({ ...x, purpose: "service_history" }));
    const wpr = await postRaw(await sigFor({ body: wp.body, scope: scopeOf(wp.envelope), key: al }), wp.body);
    expect(wpr.status).toBe(401);
    out.unauthorized_purpose = `${wpr.status} ${wpr.reason}`;
    const wd = await resealed(ok!.envelope, (x) => ({ ...x, target_app: "autoframe", route: "autolabels->autoframe" }));
    const wdr = await postRaw(await sigFor({ body: wd.body, scope: scopeOf(wd.envelope), key: al }), wd.body);
    expect(wdr.status).toBe(401);
    out.wrong_destination = `${wdr.status} ${wdr.reason}`;
    note("autolabels->autocurb", "gateway_ingress_boundary", out);
  });

  it("key rotation: a previous key verifies inside its window; once revoked it never does", async () => {
    const al = keyFor(reg, "autolabels");
    const prev: ServiceKey = { ...al, key_id: `stg-al-prev-${randomUUID().slice(0, 8)}`, status: "previous", secret: randomUUID() };
    const [a] = await freshEvent("autolabels", "autocurb");
    const scope = (await signAs(a!, "autolabels"))["rtgip-scope"]!;
    await withKeys([prev], async () => expect((await postRaw(await sigFor({ body: a!.body, scope, key: prev }), a!.body)).status).toBe(200));
    const [b] = await freshEvent("autolabels", "autocurb");
    const bscope = (await signAs(b!, "autolabels"))["rtgip-scope"]!;
    await withKeys([{ ...prev, status: "revoked" }], async () => expect(await postRaw(await sigFor({ body: b!.body, scope: bscope, key: prev }), b!.body)).toEqual({ status: 401, reason: "key_revoked" }));
  });

  it("changed immutable envelope under the same event id is refused at the source outbox, the Gateway and the target", async () => {
    const [a] = await freshEvent("autolabels", "autocurb");
    await enqueue(db.autolabels, [a!]);
    await pumpUntilSettled("autolabels");
    const changed = { ...a!.envelope, correlation_id: "corr-tampered" } as EnvelopeV2;
    const body = canonicalize(changed);
    await expect(enqueue(db.autolabels, [{ envelope: changed, body }])).rejects.toThrow(/event_id_conflict/);
    const g = await postRaw(await sigFor({ body, scope: scopeOf(changed), key: keyFor(reg, "autolabels") }), body);
    expect([401, 409]).toContain(g.status);
    const t = await fetch(`${servers.autocurb.url}/rtgip/v2/inbound`, { method: "POST", headers: await sigFor({ body, scope: scopeOf(changed), key: keyFor(reg, "gateway") }), body });
    const tj = (await t.json()) as { reason: string | null; receipts: { kind: string; outcome: string }[] };
    expect(tj.receipts.some((r) => r.kind === "consumer_commit")).toBe(false);
    expect(await effects("autocurb", a!.envelope.event_id)).toBe(1);
    note("autolabels->autocurb", "full_envelope_collision", `source: event_id_conflict; gateway: ${g.status} ${g.reason}; target: ${t.status} ${tj.reason ?? tj.receipts.map((r) => r.kind + ":" + r.outcome).join(",")}`);
  });

  it("receipt forgery, wrong issuer key, replayed receipts and a non-lease-holder are refused by outbox_advance", async () => {
    const [a] = await freshEvent("autolabels", "autoframe");
    await enqueue(db.autolabels, [a!]);
    const asD = <T>(fn: (tx: Sql) => Promise<T>) => db.autolabels.begin(async (tx) => { await tx.unsafe("SET LOCAL ROLE rtgip_dispatcher"); return fn(tx as unknown as Sql); }) as Promise<T>;
    const leased = await asD((tx) => tx`SELECT event_id FROM rtgip.outbox_claim('w-forge', 100, 60) WHERE event_id = ${a!.envelope.event_id}`);
    expect(leased).toHaveLength(1);
    const h = await signAs(a!, "autolabels");
    const res = await fetch(gwUrl(), { method: "POST", headers: h, body: a!.body });
    const { receipts } = (await res.json()) as { receipts: (Receipt & { signature: string })[] };
    const adv = async (worker: string, unsigned: Omit<Receipt, "signature">, sig: string) =>
      (await asD((tx) => tx`SELECT rtgip.outbox_advance(${a!.envelope.event_id}, ${worker}, ${receiptSigningJson(unsigned)}, ${sig}) AS r`))[0]!.r as string;
    const [adm, inbox, commit] = receipts;
    const { signature: s0, ...u0 } = adm!;
    expect(await adv("w-forge", { ...u0, outcome: "duplicate" as never }, s0)).toMatch(/^rejected:ack_/);
    // An app key signing a receipt that claims to be the Gateway's admission.
    const appKey = keyFor(reg, "autolabels");
    const u1 = { ...u0, key_id: appKey.key_id };
    const s1 = await hmacHex(appKey.secret, "rtgip/2-receipt\n" + receiptSigningJson(u1));
    expect(await adv("w-forge", u1, s1)).toBe("rejected:ack_bad_key");
    expect(await adv("w-other", u0, s0)).toBe("rejected:not_lease_holder");
    expect(await adv("w-forge", u0, s0)).toBe("gateway_admitted");
    expect(await adv("w-forge", u0, s0)).toMatch(/^rejected:illegal_transition/);
    for (const r of [inbox!, commit!]) { const { signature, ...u } = r; await adv("w-forge", u, signature); }
    expect(await outboxState("autolabels", a!.envelope.event_id)).toMatchObject({ state: "consumer_committed" });
    const rejected = await db.autolabels`SELECT count(*)::int AS c FROM rtgip.audit_log WHERE event_id = ${a!.envelope.event_id} AND action = 'receipt_rejected'`;
    expect(rejected[0]!.c).toBe(4);
    note("autolabels->autoframe", "receipt_forgery", "tampered outcome, app key posing as Gateway, non-lease-holder and replayed receipt all rejected and audited");
  });

  it("a suspended connection pauses without spending attempts; a dead letter is terminal until an operator redrives it with a reason", async () => {
    const conn = connIdOf("autolabels", "autoframe", tenant);
    await db.autolabels`UPDATE rtgip.connections SET status = 'suspended' WHERE connection_id = ${conn}`;
    const [a] = await freshEvent("autolabels", "autoframe");
    await enqueue(db.autolabels, [a!]);
    expect((await dispatch(db.autolabels, "autolabels", reg, servers.gateway.url, "w-susp")).filter((r) => r.event_id === a!.envelope.event_id)).toHaveLength(0);
    expect((await db.autolabels`SELECT attempts FROM rtgip.outbox WHERE event_id = ${a!.envelope.event_id}`)[0]!.attempts).toBe(0);
    await db.autolabels`UPDATE rtgip.connections SET status = 'active' WHERE connection_id = ${conn}`;
    await db.autolabels`UPDATE rtgip.outbox SET attempts = 9 WHERE event_id = ${a!.envelope.event_id}`;
    const dead = await dispatch(db.autolabels, "autolabels", reg, "http://127.0.0.1:9", "w-dead");
    expect(dead.find((r) => r.event_id === a!.envelope.event_id)?.state).toBe("dead_letter");
    expect((await dispatch(db.autolabels, "autolabels", reg, servers.gateway.url, "w-dead")).filter((r) => r.event_id === a!.envelope.event_id)).toHaveLength(0);
    const asOp = (reason: string) => db.autolabels.begin(async (tx) => { await tx.unsafe("SET LOCAL ROLE rtgip_operator"); return (await tx`SELECT rtgip.outbox_redrive(${a!.envelope.event_id}, 'ops-stg', ${reason}) AS r`)[0]!.r; });
    await expect(asOp("x")).rejects.toThrow(/reason_required/);
    await expect(db.autolabels.begin(async (tx) => { await tx.unsafe("SET LOCAL ROLE rtgip_dispatcher"); return tx`SELECT rtgip.outbox_redrive(${a!.envelope.event_id}, 'w', 'gateway outage resolved')`; })).rejects.toThrow(/permission denied/);
    expect(await asOp("gateway outage resolved, redrive after review")).toBe("retry_wait");
    await pumpUntilSettled("autolabels");
    expect(await effects("autoframe", a!.envelope.event_id)).toBe(1);
    const acts = (await db.autolabels`SELECT action FROM rtgip.audit_log WHERE event_id = ${a!.envelope.event_id} ORDER BY id`).map((r) => r.action as string);
    expect(acts).toEqual(expect.arrayContaining(["enqueued", "fail:dead_letter", "redrive", "advance:consumer_committed"]));
    note("autolabels->autoframe", "suspended_and_dead_letter", "suspended: not leased, 0 attempts; dead letter not re-leased; operator redrive with reason -> applied once; history retained");
  });

  it("history is preserved through every failure: append-only audits on the Gateway and the source", async () => {
    const gw = await db.gateway`SELECT decision, count(*)::int AS c FROM gw_standin.audit GROUP BY decision ORDER BY decision`;
    expect(gw.map((r) => r.decision)).toEqual(expect.arrayContaining(["admitted", "forwarded", "rejected", "target_error"]));
    await expect(db.gateway`DELETE FROM gw_standin.audit`).rejects.toThrow(/append_only/);
    for (const a of APPS) {
      const acts = (await db[a]`SELECT DISTINCT action FROM rtgip.audit_log`).map((r) => r.action as string);
      if (a !== "autolabels") continue;
      expect(acts).toEqual(expect.arrayContaining(["enqueued", "fail:retry_wait"]));
    }
    const kept = await db.autolabels`SELECT count(*)::int AS c FROM rtgip.receipts`;
    expect(kept[0]!.c).toBeGreaterThan(0);
    for (const d of Object.keys(evidence)) note(d, "audit_preserved", "gw_standin.audit append-only; rtgip.audit_log + rtgip.receipts retained");
  });
});
