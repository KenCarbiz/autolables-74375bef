// @vitest-environment node
// AutoLabels side of the shared rtgip/2 cross-app corpus (generated from the real
// AutoLabels, AutoCurb and AutoFrame producers). Synthetic data only.
import { describe, expect, it } from "vitest";
import corpus from "../rtgip2/rtgip2-corpus.v2.json";
import { MemoryNonceStore, verifyDelivery, type EnvelopeV2 } from "../rtgip2/protocol.ts";
import { MemoryInbox } from "../rtgip2/delivery.ts";
import { signAdmission } from "../rtgip2/harness.ts";
import { keyOf, syntheticRegistry, T0, TENANT, ROOFTOP, VIN, INSTANCE, EPISODE } from "../rtgip2/fixtures.ts";
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
    const inbox = new MemoryInbox<LabelsProjection>("autolabels", p, labelsConsumer, { registry: reg, key: keyOf(reg, "al-dev-1") });
    for (const e of inbound) {
      const v = await verifyDelivery(e.gateway_headers as Record<string, string>, e.body, { registry: reg, nonces, nowSec: corpus.t0, expectedSigner: "gateway", receiver: "autolabels" });
      expect(v.ok, `seq ${e.seq}`).toBe(true);
      if (v.ok) expect((await inbox.receive(v.delivery, await signAdmission(v.delivery.envelope, v.delivery.connection_id, keyOf(reg, "gw-dev-1"), T0), T0)).outcome, `seq ${e.seq}`).toBe("applied");
    }
    expect(inbox.projection.evidence.map((x) => x.kind)).toEqual(["appraisal_finalized", "acquisition_milestone:deal_finalized", "purchase_completed_custody_received"]);
    expect(inbox.projection.media["med-syn-1"]).toMatchObject({ state: "revoked", active_in_gallery: false });
    expect(inbox.projection.instances[INSTANCE].episodes[EPISODE].state).toBe("open");
    expect(JSON.stringify(inbox.projection)).not.toMatch(/acv|offer|1850000/i);
  });

  it("rejects a tampered inbound entry and a replay of an entry under a different body", async () => {
    const reg = syntheticRegistry();
    const e = inbound[0];
    const tampered = e.body.replace("corr-syn-1", "corr-syn-9");
    expect(tampered).not.toBe(e.body);
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
  const STAFF = "44444444-4444-4444-8444-444444444444";
  const prior: L.EpisodeRecord = { episode_id: EPISODE, tenant_id: TENANT, vin: VIN, instance_id: INSTANCE, opened_reason: "initial", previous_episode_id: null, custody_state: "delivered", status: "disposed" };
  const back: L.EpisodeRecord = { episode_id: "ep-syn-0001-2", tenant_id: TENANT, vin: VIN, instance_id: INSTANCE, opened_reason: "reacquisition", previous_episode_id: EPISODE, custody_state: "in_stock", status: "active" };
  const delivered: L.CustodyMilestoneRecord = { id: "ms-1", tenant_id: TENANT, episode_id: EPISODE, vin: VIN, milestone: "delivered", to_state: "delivered", occurred_at: "2027-01-10T15:00:00Z", source: "staff", confirmed_by: STAFF, corrects_id: null };
  const review: L.ReappearanceReviewRecord = { id: "rv-1", tenant_id: TENANT, vin: VIN, prior_episode_id: EPISODE, status: "resolved", decision: "new_episode", decided_by: STAFF, resulting_episode_id: "ep-syn-0001-2" };
  const returning = { ...sold, episode_id: "ep-syn-0001-2", episode_state: "open" as const };
  const history = (over: Partial<L.EpisodeHistory> = {}): L.EpisodeHistory => ({ episode: back, vin_episodes: [prior], predecessor_milestones: [delivered], review, ...over });
  const open = (h: L.EpisodeHistory, i: L.LabelsInstance = returning) => () => L.episodeOpened(scope, i, h, { opened_at: meta.occurred_at }, meta, ["autocurb"]);

  it("H4: a returning vehicle opens only as a reviewed reacquisition of a closed predecessor", async () => {
    const [out] = await open(history())();
    expect(out!.envelope.payload).toMatchObject({ opened_reason: "reappearance_reviewed", predecessor_episode_id: EPISODE });
    expect(open(history({ review: { ...review, status: "open", decision: null } }))).toThrow("reappearance_review_unresolved");
    expect(open(history({ review: { ...review, decision: "restore_episode" } }))).toThrow("reappearance_review_unresolved");
    expect(open(history({ review: { ...review, resulting_episode_id: "ep-other" } }))).toThrow("reappearance_review_unresolved");
    expect(open(history({ review: { ...review, decided_by: null } }))).toThrow("reappearance_review_unresolved");
    expect(open(history({ review: null }))).toThrow("reappearance_review_unresolved");
  });
  it("H4: the opening reason comes from the episode record, so a returning VIN cannot be relabelled as a fresh acquisition or trade-in", () => {
    const relabel = history({ episode: { ...back, opened_reason: "initial", previous_episode_id: null } });
    expect(open(relabel)).toThrow("prior_history_requires_reappearance_review");
    expect(() => L.episodeOpened(scope, returning, relabel, { opened_at: meta.occurred_at, acquisition_kind: "trade_in" }, meta, ["autocurb"])).toThrow("prior_history_requires_reappearance_review");
    expect(open(history({ episode: { ...back, opened_reason: "transfer_in", previous_episode_id: null } }))).toThrow("prior_history_requires_reappearance_review");
    expect(open(history({ episode: { ...back, opened_reason: "restore" } }))).toThrow("restore_is_not_a_new_episode");
  });
  it("H4: the predecessor must really have ended, with an unreverted terminal milestone, and no other episode may be open", () => {
    expect(open(history({ vin_episodes: [{ ...prior, custody_state: "in_stock", status: "active" }] }))).toThrow("another_episode_open");
    expect(open(history({ vin_episodes: [{ ...prior, custody_state: "sold", status: "disposed" }] }))).toThrow("predecessor_not_closed");
    expect(open(history({ predecessor_milestones: [] }))).toThrow("predecessor_closure_unverified");
    expect(open(history({ predecessor_milestones: [delivered, { ...delivered, id: "ms-2", milestone: "restored", to_state: "in_stock", occurred_at: "2027-01-12T15:00:00Z" }] }))).toThrow("predecessor_closure_unverified");
    expect(open(history({ vin_episodes: [] }))).toThrow("predecessor_not_in_history");
    expect(open(history({ episode: { ...back, previous_episode_id: "ep-syn-0001-2" } }))).toThrow("returning_vehicle_needs_new_episode");
    expect(open(history({ vin_episodes: [{ ...prior, tenant_id: "tnt-other" }] }))).toThrow("history_tenant_mismatch");
  });
  it("H5: sale milestones come from the milestone row: trusted source, confirmed, not superseded", async () => {
    const o = { ...sold, episode_state: "open" as const };
    const row: L.CustodyMilestoneRecord = { ...delivered, id: "ms-sold", milestone: "sold", to_state: "sold" };
    const [out] = await L.saleMilestone(scope, o, row, [row], meta, ["autocurb"]);
    expect(out!.envelope.payload).toMatchObject({ milestone: "sold", audit_ref: "ms-sold", verified: true });
    expect(() => L.saleMilestone(scope, o, { ...row, source: "integration" }, [], meta, ["autocurb"])).toThrow("sale_milestone_unverified");
    expect(() => L.saleMilestone(scope, o, { ...row, confirmed_by: null }, [], meta, ["autocurb"])).toThrow("sale_milestone_unverified");
    expect(() => L.saleMilestone(scope, o, row, [row, { ...row, id: "ms-void", milestone: "sale_voided", corrects_id: "ms-sold" }], meta, ["autocurb"])).toThrow("sale_milestone_superseded");
    expect(() => L.saleMilestone(scope, o, { ...row, tenant_id: "tnt-other" }, [], meta, ["autocurb"])).toThrow("milestone_scope_mismatch");
    expect(() => L.identityRegistered({ ...scope, scope_verified_server_side: false as unknown as true }, o, { year: 2024, make: "S", model: "S", trim: null, registered_at: meta.occurred_at }, meta, ["autocurb"])).toThrow("scope_not_server_verified");
  });
});
