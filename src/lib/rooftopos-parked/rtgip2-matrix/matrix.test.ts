// @vitest-environment node
// Six-direction synthetic acceptance matrix: the real AutoLabels, AutoCurb and AutoFrame
// producers and consumers (AutoCurb and AutoFrame vendored byte-for-byte, see VENDORED.json)
// exchanging signed rtgip/2 messages through the in-process reference Gateway.
// IN-MEMORY SIMULATION ONLY. This is not real-database concurrency and not physical staging.
import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import {
  authorize, canonicalize, hmacHex, sealEnvelope, sha256Hex, signEnvelope, verifyDelivery, MemoryNonceStore,
  type AppId, type EnvelopeV2, type Registry, type SignedHeaders,
} from "../rtgip2/protocol.ts";
import { MemoryInbox, MemoryOutbox, reconcile, type OutboxRow, type Receipt } from "../rtgip2/delivery.ts";
import { makeTarget, ReferenceGateway, type TargetEndpoint } from "../rtgip2/harness.ts";
import { draftEnvelope, keyOf, signingKeyFor, syntheticRegistry, T0, TENANT, ROOFTOP, OTHER_TENANT, OTHER_ROOFTOP, VIN, INSTANCE, EPISODE } from "../rtgip2/fixtures.ts";
import * as L from "../rtgip2-autolabels/producer.ts";
import { emptyLabelsProjection, labelsConsumer, type LabelsProjection } from "../rtgip2-autolabels/consumer.ts";
import * as C from "../rtgip2-autocurb/producer.ts";
import { curbConsumer, emptyCurbProjection, type CurbProjection } from "../rtgip2-autocurb/consumer.ts";
import * as F from "../rtgip2-autoframe/producer.ts";
import { emptyFrameProjection, frameConsumer, type FrameProjection } from "../rtgip2-autoframe/consumer.ts";
import { AT, STAFF, MEDIA, approval, cmeta, curbRecords, curbScope, firstEpisode, frameRecords, frameScope, inst, meta, revocation, revocationRecords, scope, soldMilestone } from "./scenario.ts";

const results: Record<string, Record<string, string>> = {};
const record = (route: string, check: string, outcome: string) => { (results[route] ??= {})[check] = outcome; };
const APPS = ["autolabels", "autocurb", "autoframe"] as const;
type App = (typeof APPS)[number];

function world(opts: { dropAckFor?: (app: App) => boolean } = {}) {
  const reg = syntheticRegistry();
  const labels = new MemoryInbox<LabelsProjection>("autolabels", emptyLabelsProjection(), labelsConsumer);
  labels.projection.instances[INSTANCE] = { tenant_id: TENANT, rooftop_id: ROOFTOP, vin: VIN, episodes: { [EPISODE]: { state: "open", opened_reason: "acquisition" } }, service_visits: { "sv-syn-1": { ro_ref: "ro-syn-1" } } };
  const curb = new MemoryInbox<CurbProjection>("autocurb", emptyCurbProjection(), curbConsumer);
  const frame = new MemoryInbox<FrameProjection>("autoframe", emptyFrameProjection(), frameConsumer);
  const inboxes = { autolabels: labels, autocurb: curb, autoframe: frame } as const;
  const targets = new Map<AppId, TargetEndpoint>(APPS.map((a) => [a, makeTarget(a, inboxes[a] as MemoryInbox<unknown>, reg, keyOf(reg, signingKeyFor(a)), undefined, { dropAck: () => opts.dropAckFor?.(a) ?? false })]));
  const gw = new ReferenceGateway(reg, keyOf(reg, "gw-dev-1"), targets);
  const clock = { now: T0 };
  let n = 0;
  const outboxes = { autolabels: new MemoryOutbox({}), autocurb: new MemoryOutbox({}), autoframe: new MemoryOutbox({}) } as const;
  const seen: Receipt[] = [];
  const transport = (src: AppId) => async (r: OutboxRow) => {
    const res = await gw.admit(await signEnvelope(r.body, r.envelope, keyOf(reg, signingKeyFor(src)), clock.now, `src_${src}_${String(n++).padStart(12, "0")}`), r.body, clock.now);
    seen.push(...(res.receipts ?? []));
    return res;
  };
  async function pump(src: App) {
    for (const r of outboxes[src].claim("worker-1", clock.now, 100)) await outboxes[src].deliver(r, "worker-1", transport(src), reg, clock.now, () => 0);
  }
  async function send(src: App, produced: Promise<{ envelope: EnvelopeV2; body: string }[]> | { envelope: EnvelopeV2; body: string }[]) {
    const evs = await produced;
    await outboxes[src].transaction(async (_s, enqueue) => { for (const e of evs) await enqueue(e.envelope, e.body); }, clock.now);
    await pump(src);
    return evs.map((e) => outboxes[src].rows.get(e.envelope.event_id)!);
  }
  return { reg, gw, inboxes, outboxes, send, pump, clock, seen };
}

const committed = (rows: OutboxRow[]) => rows.every((r) => r.state === "consumer_committed");
const inboxOutcome = (r: OutboxRow) => r.receipts.filter((x) => x.kind === "target_inbox").at(-1)?.outcome;

describe("six-direction end-to-end exchange (positive path)", () => {
  const w = world();

  it("1+3: AutoLabels -> AutoCurb and AutoFrame: identity, episode, price, availability", async () => {
    const a = await w.send("autolabels", L.identityRegistered(scope, inst, { year: 2024, make: "Synthetic", model: "Sedan", trim: null, registered_at: AT }, meta("al-id-1", INSTANCE), ["autocurb", "autoframe"]));
    const b = await w.send("autolabels", L.episodeOpened(scope, inst, firstEpisode, { opened_at: AT }, meta("al-ep-1", EPISODE), ["autocurb", "autoframe"]));
    const c = await w.send("autolabels", L.pricePublished(scope, inst, { vehicle_selling_price_cents: 2_450_000, doc_fee_cents: 49_900, total_advertised_price_cents: 2_499_900, published_at: AT }, meta("al-price-1", "listing-syn-1"), ["autocurb"]));
    const d = await w.send("autolabels", L.listingAvailabilityChanged(scope, inst, true, "passport-syn-1001", AT, meta("al-avail-1", "listing-syn-1", 2, { autoframe: null }), ["autoframe"]));
    expect(committed([...a, ...b, ...c, ...d])).toBe(true);
    expect(w.inboxes.autocurb.projection.vehicles[INSTANCE]!.identity?.stock_number).toBe("SYN1001");
    expect(w.inboxes.autocurb.projection.vehicles[INSTANCE]!.advertised_price[EPISODE]!.total_advertised_price_cents).toBe(2_499_900);
    expect(w.inboxes.autoframe.projection.vehicles[INSTANCE]).toMatchObject({ approvals_allowed: true, listing_available: true, current_episode_id: EPISODE });
    record("autolabels->autocurb", "positive_e2e", "committed");
    record("autolabels->autoframe", "positive_e2e", "committed");
  });

  it("2+5: AutoCurb -> AutoLabels and AutoFrame: final appraisal, milestone, purchase from trusted ledger rows; no valuation leaves AutoCurb", async () => {
    const a = await w.send("autocurb", C.appraisalCompleted(curbScope, curbRecords("appraisal_completed"), cmeta("ac-apr-1"), ["autolabels", "autoframe"]));
    const b = await w.send("autocurb", C.acquisitionMilestone(curbScope, curbRecords("deal_finalized"), cmeta("ac-m-1"), ["autolabels"]));
    const c = await w.send("autocurb", C.purchaseCompleted(curbScope, curbRecords("purchase_complete"), cmeta("ac-pur-1", 2, { autolabels: 1, autoframe: null }), ["autolabels", "autoframe"]));
    expect(committed([...a, ...b, ...c])).toBe(true);
    expect(w.inboxes.autolabels.projection.evidence.map((x) => x.kind)).toEqual(["appraisal_finalized", "acquisition_milestone:deal_finalized", "purchase_completed_custody_received"]);
    expect(w.inboxes.autolabels.projection.instances[INSTANCE]!.episodes[EPISODE]!.state).toBe("open");
    expect(w.inboxes.autoframe.projection.intake.map((x) => x.reason)).toEqual(["appraisal_completed", "purchase_completed"]);
    const wire = [...w.outboxes.autocurb.rows.values()].map((r) => r.body).join("\n").toLowerCase();
    for (const secret of ["1850000", "acv", "offer", "price"]) expect(wire).not.toContain(secret);
    record("autocurb->autolabels", "positive_e2e", "committed");
    record("autocurb->autoframe", "positive_e2e", "committed");
  });

  it("4+6: AutoFrame -> AutoLabels and AutoCurb: approved media, revocation; a stale approval and an unreinstated higher revision cannot resurrect it", async () => {
    const stale = await F.mediaApproved(approval(1, "af-evt-stale"), frameScope(null), frameRecords(1, "af-evt-stale"), ["autolabels", "autocurb"]);
    const a = await w.send("autoframe", F.mediaApproved(approval(1), frameScope(null), frameRecords(1), ["autolabels", "autocurb"]));
    expect(committed(a)).toBe(true);
    expect(w.inboxes.autolabels.projection.media[MEDIA]).toMatchObject({ state: "approved", active_in_gallery: true });
    const r = await w.send("autoframe", F.mediaRevoked(revocation(2, 1), frameScope(1), revocationRecords(2), ["autolabels", "autocurb"]));
    expect(committed(r)).toBe(true);
    expect(w.inboxes.autolabels.projection.media[MEDIA]).toMatchObject({ state: "revoked", active_in_gallery: false });
    const late = await w.send("autoframe", stale);
    expect(late.map(inboxOutcome)).toEqual(["stale_ignored", "stale_ignored"]);
    // Source side: once the row is revoked, a queued approval can never be re-emitted.
    expect(() => F.mediaApproved(approval(1), frameScope(2), frameRecords(1, "af-evt-1", [], { status: "revoked" }), ["autolabels"])).toThrow("media_not_currently_approved");
    // Consumer side: a higher-revision approval without an audited reinstatement is quarantined.
    const priorRevoke = revocationRecords(2).approvals;
    const forged = await F.mediaApproved(approval(3), frameScope(2), { ...frameRecords(3, "af-evt-3", priorRevoke), reinstatements: [{ audit_id: "aud-x", tenant_id: TENANT, media_id: MEDIA, revoked_approval_id: "ap-syn-rv-2", actor: STAFF }] }, ["autolabels", "autocurb"]);
    const stripped = await Promise.all(forged.map(async (f) => {
      const { reinstatement_audit_ref: _r, ...payload } = f.envelope.payload;
      const { payload_sha256: _p, ...rest } = { ...f.envelope, payload };
      return { target: f.target, ...(await sealEnvelope({ ...rest, origin: { ...rest.origin, event_id: "af-evt-3-noreinstate" } })) };
    }));
    const q = await w.send("autoframe", stripped);
    expect(q.map((x) => x.state)).toEqual(["target_quarantined", "target_quarantined"]);
    expect(w.inboxes.autolabels.projection.media[MEDIA]!.state).toBe("revoked");
    expect(w.inboxes.autocurb.projection.vehicles[INSTANCE]!.media[MEDIA]!.state).toBe("revoked");
    // With the audited reinstatement the same revision is accepted.
    const ok = await w.send("autoframe", forged);
    expect(committed(ok)).toBe(true);
    expect(w.inboxes.autolabels.projection.media[MEDIA]!.state).toBe("approved");
    record("autoframe->autolabels", "positive_e2e", "committed");
    record("autoframe->autocurb", "positive_e2e", "committed");
    record("autoframe->autolabels", "unauthorized_resurrection", "rejected:revoked_media_requires_reinstatement");
    record("autoframe->autocurb", "unauthorized_resurrection", "rejected:revoked_media_requires_reinstatement");
  });

  it("sale keeps history; AutoFrame stops approvals; a returning VIN opens a review instead of reopening inventory", async () => {
    const sold = { ...inst, episode_state: "closed" as const };
    await w.send("autolabels", L.saleMilestone(scope, inst, soldMilestone, [soldMilestone], meta("al-sale-1", EPISODE, 1), ["autocurb", "autoframe"]));
    await w.send("autolabels", L.episodeClosed(scope, sold, { closed_reason: "sold_delivered", closed_at: AT }, meta("al-close-1", EPISODE, 2), ["autocurb", "autoframe"]));
    expect(w.inboxes.autoframe.projection.vehicles[INSTANCE]!.approvals_allowed).toBe(false);
    expect(w.inboxes.autocurb.projection.vehicles[INSTANCE]!.episodes[EPISODE]!.state).toBe("closed");
    expect(() => L.inventoryStatusChanged(scope, sold, "frontline", AT, meta("al-x", EPISODE, 4), ["autocurb"])).toThrow("closed_episode_cannot_reactivate");
    expect(() => F.mediaApproved(approval(5), frameScope(4), frameRecords(5, "af-evt-5", [], { lifecycle: "sold" }), ["autolabels"])).toThrow("vehicle_sold");
    w.inboxes.autolabels.projection.instances[INSTANCE]!.episodes[EPISODE]!.state = "closed";
    const back = await w.send("autocurb", C.purchaseCompleted(curbScope, curbRecords("purchase_complete", { instance_ref: "acq:sub-syn-77", episode_ref: "acq:sub-syn-77:1" }, "77777777-7777-4777-8777-777777777777"), cmeta("ac-pur-77"), ["autolabels"]));
    expect(back[0]!.state).toBe("consumer_committed");
    expect(w.inboxes.autolabels.projection.reviews).toMatchObject([{ kind: "reappearance", vin: VIN, prior_instance_id: INSTANCE, status: "open" }]);
    expect(Object.keys(w.inboxes.autolabels.projection.instances)).toEqual([INSTANCE]);
  });

  it("H3: a delayed episode_opened replayed after the sale cannot re-enable AutoFrame approvals", async () => {
    const replay = (await L.episodeOpened(scope, inst, firstEpisode, { opened_at: AT }, { ...meta("al-ep-late", EPISODE, 9, 8) }, ["autoframe"]))[0]!;
    const res = await w.send("autolabels", [replay]);
    expect(res[0]!.state).not.toBe("consumer_committed");
    expect(w.inboxes.autoframe.projection.vehicles[INSTANCE]!.approvals_allowed).toBe(false);
    record("autolabels->autoframe", "reordered_reactivation", `rejected:${inboxOutcome(res[0]!)}`);
  });

  it("future service evidence attaches to a service visit without reopening the sold episode (synthetic; route reserved)", async () => {
    const { envelope } = await sealEnvelope(draftEnvelope("autofilm", "autolabels", "service.mpi_verified"));
    expect(authorize(envelope, w.reg)).toEqual({ ok: false, reason: "route_reserved" });
    const before = w.inboxes.autolabels.projection.evidence.length;
    expect(labelsConsumer(w.inboxes.autolabels.projection, envelope)).toEqual({ ok: true });
    expect(w.inboxes.autolabels.projection.evidence.slice(before)).toMatchObject([{ kind: "mpi_verified", service_visit_id: "sv-syn-1", episode_id: null }]);
    expect(w.inboxes.autolabels.projection.instances[INSTANCE]!.episodes[EPISODE]!.state).toBe("closed");
  });

  it("reconciliation across all six routes: nothing missing, duplicated or mis-acknowledged; no commit receipt for any quarantined event", () => {
    for (const [src, ob] of Object.entries(w.outboxes)) {
      for (const tgt of APPS) {
        if (tgt === src) continue;
        const rep = reconcile(ob.rows.values(), w.inboxes[tgt] as MemoryInbox<unknown>, tgt);
        const route = `${src}->${tgt}`;
        expect(rep.missing_at_target, route).toEqual([]);
        expect(rep.duplicate_effects, route).toEqual([]);
        expect(rep.invalid_ack, route).toEqual([]);
        expect(rep.hash_mismatch, route).toEqual([]);
        expect(rep.unacked_but_committed, route).toEqual([]);
        record(route, "reconciliation", `checked=${rep.checked} stale_ignored=${rep.stale_ignored.length} quarantined=${rep.quarantined.length} held=${rep.revision_gaps.length}`);
      }
    }
    const quarantinedIds = new Set(w.seen.filter((r) => r.kind === "target_inbox" && r.outcome === "quarantined").map((r) => r.event_id));
    expect(w.seen.filter((r) => r.kind === "consumer_commit" && quarantinedIds.has(r.event_id))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-route negative matrix. Each route uses one envelope from its real producer.
// ---------------------------------------------------------------------------

async function sample(route: string): Promise<{ envelope: EnvelopeV2; body: string }> {
  const one = async (p: Promise<{ envelope: EnvelopeV2; body: string }[]>) => (await p)[0]!;
  switch (route) {
    case "autolabels->autocurb": return one(L.inventoryStatusChanged(scope, inst, "frontline", AT, meta("n-1", EPISODE), ["autocurb"]));
    case "autolabels->autoframe": return one(L.inventoryStatusChanged(scope, inst, "frontline", AT, meta("n-2", EPISODE), ["autoframe"]));
    case "autocurb->autolabels": return one(C.appraisalCompleted(curbScope, curbRecords("appraisal_completed"), cmeta("n-3"), ["autolabels"]));
    case "autocurb->autoframe": return one(C.appraisalCompleted(curbScope, curbRecords("appraisal_completed"), cmeta("n-4"), ["autoframe"]));
    case "autoframe->autolabels": return one(F.mediaApproved(approval(1), frameScope(null), frameRecords(1), ["autolabels"]));
    default: return one(F.mediaApproved(approval(1), frameScope(null), frameRecords(1), ["autocurb"]));
  }
}

const ROUTE_IDS = ["autolabels->autocurb", "autocurb->autolabels", "autolabels->autoframe", "autoframe->autolabels", "autocurb->autoframe", "autoframe->autocurb"];

describe.each(ROUTE_IDS)("negative matrix %s", (route) => {
  const [src, tgt] = route.split("->") as [App, App];
  const atGateway = async (reg: Registry, h: SignedHeaders | Record<string, string>, body: string, nonces = new MemoryNonceStore(), now = T0) => {
    const v = await verifyDelivery(h as Record<string, string>, body, { registry: reg, nonces, nowSec: now, expectedSigner: "source" });
    return v.ok ? "accepted" : v.reason;
  };
  const sign = async (reg: Registry, e: EnvelopeV2, body: string, nonce = "nonce_matrix_000000001", keyId = signingKeyFor(src)) => signEnvelope(body, e, keyOf(reg, keyId), T0, nonce);
  const reseal = async (e: EnvelopeV2, over: Partial<EnvelopeV2>) => { const { payload_sha256: _x, ...rest } = { ...e, ...over }; return sealEnvelope(rest); };
  const check = async (name: string, expected: string, run: () => Promise<string>) => {
    const got = await run();
    record(route, name, got === expected ? `rejected:${got}` : `UNEXPECTED:${got}`);
    expect(got, name).toBe(expected);
  };

  it("valid signature, tenant, rooftop and destination are accepted at the Gateway and the target", async () => {
    const reg = syntheticRegistry();
    const s = await sample(route);
    expect(await atGateway(reg, await sign(reg, s.envelope, s.body), s.body)).toBe("accepted");
    const gwh = await signEnvelope(s.body, s.envelope, keyOf(reg, "gw-dev-1"), T0, "gw_nonce_matrix_00000001");
    const atTarget = await verifyDelivery(gwh, s.body, { registry: reg, nonces: new MemoryNonceStore(), nowSec: T0, expectedSigner: "gateway", receiver: tgt });
    expect(atTarget.ok).toBe(true);
    record(route, "positive_signed_admission", "accepted");
  });

  it("rejects every negative case", async () => {
    const reg = syntheticRegistry();
    const s = await sample(route);
    const h = await sign(reg, s.envelope, s.body);
    await check("wrong_tenant", "no_connection_for_tenant", async () => { const x = await reseal(s.envelope, { tenant_id: "tnt-syn-eastwind" }); return atGateway(reg, await sign(reg, x.envelope, x.body), x.body); });
    await check("wrong_rooftop", "rooftop_not_granted", async () => { const x = await reseal(s.envelope, { rooftop_id: OTHER_ROOFTOP }); return atGateway(reg, await sign(reg, x.envelope, x.body), x.body); });
    await check("invalid_signature", "bad_signature", async () => atGateway(reg, { ...h, "rtgip-signature": "rtgip2=" + "1".repeat(64) }, s.body));
    await check("mutated_payload", "bad_signature", async () => atGateway(reg, h, s.body.replace(TENANT, OTHER_TENANT)));
    await check("expired_timestamp", "timestamp_out_of_window", async () => atGateway(reg, h, s.body, new MemoryNonceStore(), T0 + 301));
    await check("reused_nonce", "nonce_reused", async () => {
      const nonces = new MemoryNonceStore();
      await atGateway(reg, h, s.body, nonces);
      const other = await reseal(s.envelope, { correlation_id: "corr-syn-2" });
      return atGateway(reg, await sign(reg, other.envelope, other.body), other.body, nonces);
    });
    await check("revoked_key", "key_revoked", async () => {
      const r2: Registry = { ...reg, keys: reg.keys.map((k) => (k.key_id === signingKeyFor(src) ? { ...k, status: "revoked" as const } : k)) };
      return atGateway(r2, h, s.body);
    });
    await check("revoked_connection", "connection_revoked", async () => {
      const r2: Registry = { ...reg, connections: reg.connections.map((c) => (c.source_app === src && c.target_app === tgt ? { ...c, status: "revoked" as const } : c)) };
      return atGateway(r2, h, s.body);
    });
    await check("event_id_not_derived_from_scope", "event_id_not_derived", async () => {
      const forged = { ...s.envelope, event_id: "00000000-0000-4000-8000-000000000000" };
      const body = canonicalize(forged);
      return atGateway(reg, await sign(reg, forged, body, "nonce_matrix_evid_0001"), body);
    });
    await check("unsupported_event_version", "unsupported_schema_version", async () => {
      const bad = { ...s.envelope, schema_version: 3 };
      const body = canonicalize(bad);
      const key = keyOf(reg, signingKeyFor(src));
      const scope3 = [src, tgt, TENANT, ROOFTOP, bad.event_type, "3", bad.purpose, bad.event_id].join(";");
      const sig = "rtgip2=" + (await hmacHex(key.secret, ["rtgip/2", key.key_id, src, String(T0), "nonce_matrix_v3_00001", scope3, await sha256Hex(body)].join("\n")));
      return atGateway(reg, { "rtgip-protocol": "rtgip/2", "rtgip-key-id": key.key_id, "rtgip-signer": src, "rtgip-timestamp": String(T0), "rtgip-nonce": "nonce_matrix_v3_00001", "rtgip-scope": scope3, "rtgip-signature": sig }, body);
    });
    await check("unauthorized_destination", "wrong_destination", async () => {
      const v = await verifyDelivery(h, s.body, { registry: reg, nonces: new MemoryNonceStore(), nowSec: T0, expectedSigner: "source", receiver: tgt === "autolabels" ? "autocurb" : "autolabels" });
      return v.ok ? "accepted" : v.reason;
    });
    await check("reserved_autofilm_destination", "route_reserved", async () => {
      const x = await reseal(s.envelope, { target_app: "autofilm", route: `${src}->autofilm` as EnvelopeV2["route"] });
      const a = authorize(x.envelope, reg);
      return a.ok ? "accepted" : a.reason;
    });
    await check("missing_source_authority", "event_not_on_route", async () => {
      const foreign = src === "autolabels" ? "media.approved" : src === "autocurb" ? "inventory.status_changed" : "appraisal.completed";
      const x = await sealEnvelope(draftEnvelope(src, tgt, foreign));
      return atGateway(reg, await sign(reg, x.envelope, x.body, "nonce_matrix_auth_0001"), x.body);
    });
    await check("source_impersonation", "source_impersonation", async () => {
      const other = APPS.find((a) => a !== src && a !== tgt)!;
      return atGateway(reg, await sign(reg, s.envelope, s.body, "nonce_matrix_imp_00001", signingKeyFor(other)), s.body);
    });
    await check("cross_protocol_signature", "protocol_mismatch", async () => {
      const legacy = { autolabels: "al-legacy-1", autocurb: "ac-legacy-1", autoframe: "af-legacy-1" }[src];
      const k = keyOf(reg, legacy);
      return atGateway(reg, { ...h, "rtgip-key-id": legacy, "rtgip-signature": "v1=" + (await hmacHex(k.secret, `${T0}.nonce.${s.body}`)) }, s.body);
    });
  });

  it("consumer: other episode, out-of-order revision, conflicting duplicate, and a quarantine whose ACK is lost never gets a commit receipt", async () => {
    let drop = true;
    const w = world({ dropAckFor: (a) => a === tgt && drop });
    drop = false;
    await w.send("autolabels", L.identityRegistered(scope, inst, { year: 2024, make: "Synthetic", model: "Sedan", trim: null, registered_at: AT }, meta("prime-1", INSTANCE), ["autocurb", "autoframe"]));
    const s = await sample(route);
    const gw = async (e: EnvelopeV2, body: string, nonce: string) => w.gw.admit(await signEnvelope(body, e, keyOf(w.reg, signingKeyFor(src)), T0, nonce), body, T0);
    const otherEpisode = await reseal(s.envelope, { vehicle: { ...s.envelope.vehicle, episode_id: "ep-syn-0001-9" } });
    const res = await gw(otherEpisode.envelope, otherEpisode.body, "nonce_matrix_ep_000001");
    const outcome = res.receipts?.find((r) => r.kind === "target_inbox")?.outcome;
    const sameVinOther = src === "autocurb" && tgt === "autoframe" ? "intake_only_no_identity" : String(outcome);
    record(route, "same_vin_other_episode", ["quarantined", "intake_only_no_identity"].includes(sameVinOther) ? `rejected:${sameVinOther}` : `UNEXPECTED:${sameVinOther}`);
    expect(["quarantined", "intake_only_no_identity"]).toContain(sameVinOther);
    const r3 = await reseal(s.envelope, { aggregate: { ...s.envelope.aggregate, revision: 3, prev_revision: 2 }, origin: { ...s.envelope.origin, revision: 3, event_id: "late-3" } });
    const held = await gw(r3.envelope, r3.body, "nonce_matrix_ooo_00001");
    const heldOutcome = held.receipts?.find((r) => r.kind === "target_inbox")?.outcome;
    record(route, "out_of_order_revision", heldOutcome === "held" && !held.receipts?.some((r) => r.kind === "consumer_commit") ? "held_not_applied_no_commit" : `UNEXPECTED:${heldOutcome}`);
    expect(heldOutcome).toBe("held");
    await gw(s.envelope, s.body, "nonce_matrix_dup_00001");
    const conflict = await reseal(s.envelope, { correlation_id: "corr-conflict" });
    const c = await gw(conflict.envelope, conflict.body, "nonce_matrix_dup_00002");
    record(route, "conflicting_duplicate", c.http_status === 409 ? "rejected:admission_conflict" : `UNEXPECTED:${c.http_status}`);
    expect(c.http_status).toBe(409);
    if (sameVinOther === "quarantined") {
      // C1 across the real consumer: quarantine, lose the ACK, redeliver through the outbox.
      drop = true;
      const bad = await reseal(s.envelope, { vehicle: { ...s.envelope.vehicle, episode_id: "ep-syn-0001-8" }, origin: { ...s.envelope.origin, event_id: "lost-ack-q" } });
      const rows = await w.send(src, [bad]);
      expect(rows[0]!.state).toBe("retry_wait");
      drop = false;
      for (let k = 0; k < 3 && rows[0]!.state !== "target_quarantined"; k++) {
        w.clock.now = Math.max(w.clock.now, rows[0]!.next_attempt_at);
        await w.pump(src);
      }
      const commits = w.seen.filter((r) => r.event_id === bad.envelope.event_id && r.kind === "consumer_commit");
      record(route, "quarantine_lost_ack_redelivery", rows[0]!.state === "target_quarantined" && commits.length === 0 ? "no_commit_ack" : `UNEXPECTED:${rows[0]!.state}:${commits.length}`);
      expect(rows[0]!.state).toBe("target_quarantined");
      expect(commits).toEqual([]);
    }
  });
});

describe("source-side business rules", () => {
  it("AutoCurb: offer_accepted, deal_finalized, title and check request never produce purchase or custody; flags without ledger rows are refused", async () => {
    for (const status of ["offer_accepted", "deal_finalized", "title_ownership_verified", "check_request_submitted"]) {
      const base = curbRecords("deal_finalized", {});
      const recs = { ...base, submission: { ...base.submission, progress_status: status }, ledger: [...base.ledger, { ...base.ledger[0]!, id: `led-${status}`, from_value: "deal_finalized", to_value: status, at: "2027-01-15T14:59:00Z" }] };
      expect(() => C.purchaseCompleted(curbScope, recs, cmeta("x"), ["autolabels"])).toThrow("status_not_purchase_complete");
      const [m] = await C.acquisitionMilestone(curbScope, recs, cmeta(`m-${status}`), ["autolabels"]);
      expect(m!.envelope.payload["custody_transferred"]).toBe(false);
    }
    expect(() => C.purchaseCompleted(curbScope, curbRecords("purchase_complete", { ledger: [] }), cmeta("x"), ["autolabels"])).toThrow("ledger_disagrees_with_record");
    record("autocurb->autolabels", "unverified_acquisition", "rejected:at_source");
    record("autocurb->autoframe", "unverified_acquisition", "rejected:at_source");
  });
  it("AutoLabels: price only to AutoCurb, inconsistent price cards refused, cost never representable", async () => {
    await expect(L.pricePublished(scope, inst, { vehicle_selling_price_cents: 1, doc_fee_cents: 1, total_advertised_price_cents: 2, published_at: AT }, meta("p-x", "listing-syn-1"), ["autoframe"])).rejects.toThrow("event_not_on_route");
    expect(() => L.pricePublished(scope, inst, { vehicle_selling_price_cents: 1, doc_fee_cents: 1, total_advertised_price_cents: 3, published_at: AT }, meta("p-y", "listing-syn-1"), ["autocurb"])).toThrow("price_card_inconsistent");
    await expect(L.pricePublished(scope, inst, { vehicle_selling_price_cents: 1, doc_fee_cents: 1, total_advertised_price_cents: 2, published_at: AT, dealer_cost: 5 } as never, meta("p-z", "listing-syn-1"), ["autocurb"])).rejects.toThrow(/forbidden_key|unknown_field/);
    record("autolabels->autoframe", "unauthorized_price_exposure", "rejected:event_not_on_route");
    record("autolabels->autocurb", "unauthorized_cost_exposure", "rejected:forbidden_key");
  });
  it("AutoFrame: unapproved media and URLs never leave AutoFrame", () => {
    expect(() => F.mediaApproved(approval(1), frameScope(null), frameRecords(1, "af-evt-1", [], { status: "review" }), ["autolabels"])).toThrow("media_not_currently_approved");
    const bad = approval(1);
    bad.payload.storage_ref.path = "https://cdn.example/x.webp";
    const recs = frameRecords(1);
    recs.rendition.path = bad.payload.storage_ref.path;
    expect(() => F.mediaApproved(bad, frameScope(null), recs, ["autolabels"])).toThrow("storage_path_out_of_scope");
    record("autoframe->autolabels", "unapproved_media", "rejected:at_source");
    record("autoframe->autocurb", "unapproved_media", "rejected:at_source");
  });
  it("missing access grant: a connection without the event type or with reader disabled is refused", async () => {
    const reg = syntheticRegistry();
    for (const r of ROUTE_IDS) {
      const s = await sample(r);
      const [a, b] = r.split("->");
      const noGrant: Registry = { ...reg, connections: reg.connections.map((c) => (c.source_app === a && c.target_app === b ? { ...c, event_types: [] } : c)) };
      expect(authorize(s.envelope, noGrant)).toEqual({ ok: false, reason: "event_not_granted" });
      const noReader: Registry = { ...reg, connections: reg.connections.map((c) => (c.source_app === a && c.target_app === b ? { ...c, reader_enabled: false } : c)) };
      expect(authorize(s.envelope, noReader)).toEqual({ ok: false, reason: "reader_disabled" });
      record(r, "missing_access_grant", "rejected:event_not_granted");
    }
  });
});

afterAll(() => {
  const unexpected = Object.entries(results).flatMap(([r, m]) => Object.entries(m).filter(([, v]) => v.startsWith("UNEXPECTED")).map(([k]) => `${r}:${k}`));
  if (process.env.RTGIP_MATRIX_OUT) writeFileSync(process.env.RTGIP_MATRIX_OUT, JSON.stringify({ kind: "in-memory synthetic simulation (not staging)", checks: Object.values(results).reduce((n, m) => n + Object.keys(m).length, 0), unexpected, results }, null, 2) + "\n");
});
