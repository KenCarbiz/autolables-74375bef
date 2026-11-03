// @vitest-environment node
// The Phase 4 AutoLabels staging adapter against a node built from empty by
// supabase/tests/rtgip/autolabels_node.sh (bootstrap + synthetic seed). Disposable cluster only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { canonicalize, type AppId, type EnvelopeV2, type EventType } from "../rtgip2/protocol.ts";
import { produceFor } from "../rtgip2/produce.ts";
import { labelsAdmissionEffect, labelsStagingAdapter as A, PRODUCE_KINDS, targetsFor } from "../rtgip2-autolabels/staging-adapter.ts";
import { connect, PG_URL, type Sql } from "./pg.ts";

const S = {
  tenant: process.env.AL_SEED_TENANT ?? "",
  other: process.env.AL_SEED_OTHER_TENANT ?? "",
  rooftop: process.env.AL_SEED_ROOFTOP ?? "",
  open: process.env.AL_SEED_OPEN_EPISODE ?? "",
  delivered: process.env.AL_SEED_DELIVERED_EPISODE ?? "",
};
const run = describe.runIf(!!PG_URL && !!S.tenant);
const VIN_OPEN = "1M8GDM9AXKP042801";
const VIN_DELIVERED = "1M8GDM9AXKP042802";
const AT = "2026-11-03T10:00:00Z";
let sql: Sql;
const scope = () => ({ tenant_id: S.tenant, rooftop_id: S.rooftop });

/** An inbound envelope sealed by the shared producer, as AutoCurb or AutoFrame would emit it. */
async function inbound(source: "autocurb" | "autoframe", type: EventType, p: {
  episode: string; vin: string; agg: string; rev: number; origin: string; payload: Record<string, unknown>; tenant?: string; instance?: string;
}): Promise<EnvelopeV2> {
  const [out] = await produceFor({
    source, event_type: type, tenant_id: p.tenant ?? S.tenant, rooftop_id: S.rooftop,
    vehicle: { vin: p.vin, instance_id: p.instance ?? p.episode, episode_id: p.episode },
    aggregate_id: p.agg, revision: p.rev, prev_revision: p.rev > 1 ? p.rev - 1 : null, origin_event_id: p.origin,
    correlation_id: "corr-adapter", causation_id: null, occurred_at: AT, emitted_at: AT, payload: p.payload,
  }, ["autolabels"] as AppId[]);
  return out!.envelope;
}
const appraisal = (agg: string, origin: string, ep = S.open, vin = VIN_OPEN) => inbound("autocurb", "appraisal.completed", {
  episode: ep, vin, agg, rev: 1, origin,
  payload: { verified_state: "finalized", appraisal_ref: "apr-1", verified_by_ref: "staff-1", finalized_at: AT, audit_ref: "aud-apr-1" } });
const milestone = (agg: string, origin: string, rev: number) => inbound("autocurb", "acquisition.milestone_recorded", {
  episode: S.open, vin: VIN_OPEN, agg, rev, origin,
  payload: { milestone: "deal_finalized", custody_transferred: false, recorded_at: AT, audit_ref: "aud-m-1" } });
const purchase = (agg: string, origin: string, rev: number, ep = S.open, vin = VIN_OPEN) => inbound("autocurb", "acquisition.purchase_completed", {
  episode: ep, vin, agg, rev, origin,
  payload: { purchase_ref: "po-1", custody_transferred: true, custody_at: AT, verified_by_ref: "staff-1", audit_ref: "aud-p-1",
    ownership_evidence_refs: ["title-1"], condition_evidence_refs: ["insp-1"] } });
const approved = (media: string, rev: number, origin: string, extra: Record<string, unknown> = {}) => inbound("autoframe", "media.approved", {
  episode: S.open, vin: VIN_OPEN, agg: media, rev, origin,
  payload: { media_id: media, rendition_id: `r-${rev}`, width: 1600, height: 1200, orientation: "landscape",
    storage_ref: { bucket: "af-stg", object_key: `${S.tenant}/${S.rooftop}/${S.open}/${media}.jpg` }, content_sha256: "a".repeat(64),
    approval_audit_ref: `aa-${rev}`, approved_by_ref: "photo-mgr-1", preset_key: "front_3q", preset_version: 1, media_order: 1,
    shot_type: "front_3q", approved_at: AT, ...extra } });
const revoked = (media: string, rev: number, origin: string) => inbound("autoframe", "media.revoked", {
  episode: S.open, vin: VIN_OPEN, agg: media, rev, origin,
  payload: { media_id: media, reason: "withdrawn", revoked_at: AT, revocation_audit_ref: `ra-${rev}` } });

/** apply() exactly as the inbox would call it: inside an open transaction under rtgip_inbox_receiver. */
const inInbox = (e: EnvelopeV2) =>
  sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE rtgip_inbox_receiver");
    const r = await A.apply(tx as unknown as Sql, e);
    const [{ u }] = (await tx.unsafe("SELECT current_user AS u")) as unknown as [{ u: string }];
    return { ...r, role_after: u };
  });
const custodySnapshot = async () =>
  (await sql`SELECT md5(string_agg(to_jsonb(v)::text, ',' ORDER BY v.id)) AS i,
    (SELECT md5(string_agg(to_jsonb(l)::text, ',' ORDER BY l.id)) FROM public.vehicle_listings l WHERE l.tenant_id = ${S.tenant}::uuid) AS l,
    (SELECT count(*)::int FROM public.vehicle_custody_milestones m WHERE m.tenant_id = ${S.tenant}::uuid) AS m
    FROM public.vehicle_instances v WHERE v.tenant_id = ${S.tenant}::uuid`)[0];

run("AutoLabels Phase 4 staging adapter over a node bootstrapped from empty", () => {
  let before: Awaited<ReturnType<typeof custodySnapshot>>;
  beforeAll(async () => {
    sql = connect();
    before = await custodySnapshot();
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("produces every AutoLabels fact from the real readers, sealed for every route", async () => {
    const [m] = await sql`SELECT id::text FROM public.vehicle_custody_milestones WHERE instance_id = ${S.delivered}::uuid AND milestone = 'delivered'`;
    const want: Record<string, string> = { sale_milestone: S.delivered, episode_closed: S.delivered };
    for (const kind of PRODUCE_KINDS) {
      const ep = want[kind] ?? S.open;
      const out = await A.produce(sql, kind, scope(), { episode_id: ep, ...(kind === "sale_milestone" ? { milestone_id: m!.id } : {}) });
      expect(out.map((o) => o.envelope.target_app).sort()).toEqual(targetsFor(out[0]!.envelope.event_type).sort());
      for (const o of out) {
        expect(o.body).toBe(canonicalize(o.envelope));
        expect(o.envelope).toMatchObject({ source_app: "autolabels", tenant_id: S.tenant, rooftop_id: S.rooftop, vehicle: { episode_id: ep } });
      }
    }
    const price = await A.produce(sql, "price_published", scope(), { episode_id: S.open });
    expect(price[0]!.envelope.payload).toMatchObject({ vehicle_selling_price_cents: 2599500, doc_fee_cents: 89900, total_advertised_price_cents: 2689400 });
  });

  it("refuses to produce outside the bound rooftop or tenant, or an open fact for a delivered car", async () => {
    await expect(A.produce(sql, "identity_registered", { tenant_id: S.tenant, rooftop_id: "rf-stg-99" }, { episode_id: S.open })).rejects.toThrow(/rooftop_unmapped/);
    await expect(A.produce(sql, "identity_registered", { tenant_id: S.other, rooftop_id: S.rooftop }, { episode_id: S.open })).rejects.toThrow();
    await expect(A.produce(sql, "episode_closed", scope(), { episode_id: S.open })).rejects.toThrow(/episode_not_closed/);
    await expect(A.produce(sql, "listing_availability", scope(), { episode_id: S.delivered })).rejects.toThrow();
  });

  it("applies AutoCurb appraisal, milestone and purchase with custody evidence, once per event id", async () => {
    const acq = `acq-${randomUUID()}`;
    for (const e of [await appraisal(`apr-${randomUUID()}`, "ac-apr-1"), await milestone(acq, "ac-m-1", 1), await purchase(acq, "ac-p-1", 2)]) {
      const r = await inInbox(e);
      expect(r).toMatchObject({ ok: true, reason: "applied", role_after: "rtgip_inbox_receiver" });
      expect(await inInbox(e)).toMatchObject({ ok: true, duplicate: true });
      const rec = await A.record(sql, e);
      expect(rec?.evidence).toHaveLength(1);
      expect(rec?.episode).toEqual({ status: "active", custody_state: "in_stock" });
    }
    const p = await purchase(acq, "ac-p-1", 2);
    expect((await A.record(sql, p))?.evidence).toMatchObject([{ kind: "purchase_completed_custody_received", refs: ["po-1", "aud-p-1", "title-1", "insp-1"] }]);
    const tampered = { ...p, payload: { ...p.payload, audit_ref: "aud-changed" } } as EnvelopeV2;
    expect(await inInbox(tampered)).toMatchObject({ ok: false, reason: "conflicting_duplicate" });
  });

  it("never reopens a delivered car: purchase evidence becomes a custody review", async () => {
    const e = await purchase(`acq-${randomUUID()}`, "ac-p-late", 1, S.delivered, VIN_DELIVERED);
    expect(await inInbox(e)).toMatchObject({ ok: true, reason: "custody_review_opened" });
    const rec = await A.record(sql, e);
    expect(rec?.evidence).toEqual([]);
    expect(rec?.reviews).toMatchObject([{ kind: "custody_review", prior_episode_id: S.delivered }]);
    expect(rec?.episode).toEqual({ status: "disposed", custody_state: "delivered" });
  });

  it("applies AutoFrame approval, revocation and audited reinstatement; stale approval is denied", async () => {
    const media = `m-${randomUUID()}`;
    expect(await inInbox(await approved(media, 1, `af-${media}-1`))).toMatchObject({ ok: true });
    expect(await inInbox(await revoked(media, 2, `af-${media}-2`))).toMatchObject({ ok: true });
    expect(await inInbox(await approved(media, 1, `af-${media}-stale`))).toMatchObject({ ok: false, reason: "stale_revision" });
    expect(await inInbox(await approved(media, 3, `af-${media}-3`))).toMatchObject({ ok: false, reason: "revoked_media_requires_reinstatement" });
    const back = await approved(media, 3, `af-${media}-3r`, { reinstatement_audit_ref: "reinst-stg-1" });
    expect(await inInbox(back)).toMatchObject({ ok: true });
    const rec = await A.record(sql, back);
    expect(rec?.media).toMatchObject({ state: "approved", active_in_gallery: true, revision: 3 });
    expect(rec?.reinstatement).toEqual({ audit_ref: "reinst-stg-1" });
  });

  it("denies cross-tenant and cross-rooftop deliveries; the admission effect quarantines with the reason", async () => {
    const other = await appraisal(`apr-${randomUUID()}`, "ac-x-tenant");
    const forged = { ...other, tenant_id: S.other } as EnvelopeV2;
    expect(await inInbox(forged)).toMatchObject({ ok: false, reason: "episode_not_registered" });
    const roof = { ...other, rooftop_id: "rf-stg-99" } as EnvelopeV2;
    expect(await inInbox(roof)).toMatchObject({ ok: false, reason: "rooftop_unmapped" });
    const viaAdmission = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE rtgip_inbox_receiver");
      return labelsAdmissionEffect({ sql: tx } as never, roof);
    });
    expect(viaAdmission).toEqual({ ok: false, reason: "rooftop_unmapped" });
    expect(await A.record(sql, forged)).toBeNull();
  });

  it("left inventory, listings, prices and custody milestones untouched", async () => {
    expect(await custodySnapshot()).toEqual(before);
  });
});
