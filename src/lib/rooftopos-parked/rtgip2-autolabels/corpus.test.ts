// @vitest-environment node
// AutoLabels side of the shared rtgip/2 cross-app corpus (generated from the real
// AutoLabels, AutoCurb and AutoFrame producers). Synthetic data only.
import { describe, expect, it } from "vitest";
import corpus from "../rtgip2/rtgip2-corpus.v1.json";
import { MemoryNonceStore, verifyDelivery, type EnvelopeV2 } from "../rtgip2/protocol.ts";
import { MemoryInbox } from "../rtgip2/delivery.ts";
import { syntheticRegistry, T0, TENANT, ROOFTOP, VIN, INSTANCE, EPISODE } from "../rtgip2/fixtures.ts";
import * as L from "./producer.ts";
import { emptyLabelsProjection, labelsConsumer, type LabelsProjection } from "./consumer.ts";

type Entry = (typeof corpus.entries)[number];
const outbound = corpus.entries.filter((e) => e.route.startsWith("autolabels->"));
const inbound = corpus.entries.filter((e) => e.route.endsWith("->autolabels"));
const producers = L as unknown as Record<string, (...a: unknown[]) => Promise<{ envelope: EnvelopeV2; body: string }[]>>;

describe("AutoLabels against the shared rtgip/2 corpus", () => {
  it("covers both AutoLabels outbound routes and both inbound routes", () => {
    expect(new Set(outbound.map((e) => e.route))).toEqual(new Set(["autolabels->autocurb", "autolabels->autoframe"]));
    expect(new Set(inbound.map((e) => e.route))).toEqual(new Set(["autocurb->autolabels", "autoframe->autolabels"]));
  });

  it.each(outbound.map((e) => [e.seq, e.route, e.event_type, e] as const))("producer reproduces corpus entry %i (%s %s) byte-for-byte", async (_s, route, _t, e: Entry) => {
    const fn = producers[e.producer.split(".")[1]];
    const out = await fn(...(e.producer_args as unknown[]));
    expect(out.find((o) => o.envelope.route === route)?.body).toBe(e.body);
  });

  it("verifies, admits and applies every inbound entry in order; revocation wins", async () => {
    const reg = syntheticRegistry();
    const nonces = new MemoryNonceStore();
    const p = emptyLabelsProjection();
    p.instances[INSTANCE] = { tenant_id: TENANT, rooftop_id: ROOFTOP, vin: VIN, episodes: { [EPISODE]: { state: "open", opened_reason: "acquisition" } }, service_visits: {} };
    const inbox = new MemoryInbox<LabelsProjection>("autolabels", p, labelsConsumer);
    for (const e of inbound) {
      const v = await verifyDelivery(e.gateway_headers as Record<string, string>, e.body, { registry: reg, nonces, nowSec: corpus.t0, expectedSigner: "gateway", receiver: "autolabels" });
      expect(v.ok, `seq ${e.seq}`).toBe(true);
      if (v.ok) expect(inbox.receive(v.delivery, T0).outcome, `seq ${e.seq}`).toBe("applied");
    }
    expect(inbox.projection.evidence.map((x) => x.kind)).toEqual(["appraisal_finalized", "acquisition_milestone:deal_finalized", "purchase_completed_custody_received"]);
    expect(inbox.projection.media["med-syn-1"]).toMatchObject({ state: "revoked", active_in_gallery: false });
    expect(inbox.projection.instances[INSTANCE].episodes[EPISODE].state).toBe("open");
    expect(JSON.stringify(inbox.projection)).not.toMatch(/acv|offer|1850000/i);
  });

  it("rejects a tampered inbound entry and a replay of an entry under a different body", async () => {
    const reg = syntheticRegistry();
    const e = inbound[0];
    const tampered = e.body.replace("audit-apr-1", "audit-apr-9");
    const v = await verifyDelivery(e.gateway_headers as Record<string, string>, tampered, { registry: reg, nonces: new MemoryNonceStore(), nowSec: corpus.t0, expectedSigner: "gateway", receiver: "autolabels" });
    expect(v).toEqual({ ok: false, reason: "bad_signature" });
    const wrongReceiver = await verifyDelivery(e.gateway_headers as Record<string, string>, e.body, { registry: reg, nonces: new MemoryNonceStore(), nowSec: corpus.t0, expectedSigner: "gateway", receiver: "autocurb" });
    expect(wrongReceiver).toEqual({ ok: false, reason: "wrong_destination" });
  });
});

describe("AutoLabels producer guards", () => {
  const scope = { tenant_id: TENANT, rooftop_id: ROOFTOP, scope_verified_server_side: true as const };
  const sold: L.LabelsInstance = { vin: VIN, instance_id: INSTANCE, episode_id: EPISODE, episode_state: "closed", stock_number: "SYN1001" };
  const meta = { origin_event_id: "g-1", aggregate_id: EPISODE, revision: 1, prev_revision: null, correlation_id: "c-1", occurred_at: "2027-01-15T15:00:00Z", emitted_at: "2027-01-15T15:00:00Z" };
  it("never reactivates, prices or lists a closed (sold) episode", () => {
    expect(() => L.inventoryStatusChanged(scope, sold, "frontline", meta.occurred_at, meta, ["autocurb"])).toThrow("closed_episode_cannot_reactivate");
    expect(() => L.listingAvailabilityChanged(scope, sold, true, null, meta.occurred_at, meta, ["autoframe"])).toThrow("closed_episode_cannot_be_available");
    expect(() => L.pricePublished(scope, sold, { vehicle_selling_price_cents: 1, doc_fee_cents: 0, total_advertised_price_cents: 1, published_at: meta.occurred_at }, meta, ["autocurb"])).toThrow("closed_episode_has_no_price");
  });
  it("requires a new episode and a resolved review for a returning vehicle", () => {
    const open = { ...sold, episode_state: "open" as const };
    expect(() => L.episodeOpened(scope, open, { opened_reason: "reappearance_reviewed", predecessor_episode_id: EPISODE, opened_at: meta.occurred_at, reappearance_review_resolved: true }, meta, ["autocurb"])).toThrow("returning_vehicle_needs_new_episode");
    expect(() => L.episodeOpened(scope, { ...open, episode_id: "ep-syn-0001-2" }, { opened_reason: "reappearance_reviewed", predecessor_episode_id: EPISODE, opened_at: meta.occurred_at }, meta, ["autocurb"])).toThrow("reappearance_review_unresolved");
  });
  it("refuses unverified sale milestones and unverified server scope", () => {
    const open = { ...sold, episode_state: "open" as const };
    expect(() => L.saleMilestone(scope, open, { milestone: "sold", recorded_at: meta.occurred_at, audit_ref: "a-1", verified_by_server: false }, meta, ["autocurb"])).toThrow("sale_milestone_unverified");
    expect(() => L.identityRegistered({ ...scope, scope_verified_server_side: false as unknown as true }, open, { year: 2024, make: "S", model: "S", trim: null, registered_at: meta.occurred_at }, meta, ["autocurb"])).toThrow("scope_not_server_verified");
  });
});
