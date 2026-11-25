// @vitest-environment node
import { describe, expect, it } from "vitest";
import { authorize, sealEnvelope, type EnvelopeV2 } from "../rtgip2/protocol.ts";
import { draftEnvelope, syntheticRegistry, TENANT, ROOFTOP, VIN, INSTANCE, EPISODE } from "../rtgip2/fixtures.ts";
import { emptyLabelsProjection, labelsConsumer, type LabelsProjection } from "./consumer.ts";

const seeded = (episodeState: "open" | "closed" = "open"): LabelsProjection => {
  const p = emptyLabelsProjection();
  p.instances[INSTANCE] = { tenant_id: TENANT, rooftop_id: ROOFTOP, vin: VIN, episodes: { [EPISODE]: { state: episodeState, opened_reason: "acquisition" } }, service_visits: { "sv-syn-1": { ro_ref: "ro-syn-1" } } };
  return p;
};
const env = async (d: Omit<EnvelopeV2, "payload_sha256">) => (await sealEnvelope(d)).envelope;

describe("AutoLabels consumer", () => {
  it("accepts future verified service evidence on a service visit of a sold vehicle without reopening it (synthetic only)", async () => {
    const e = await env(draftEnvelope("autofilm", "autolabels", "service.mpi_verified"));
    expect(authorize(e, syntheticRegistry())).toEqual({ ok: false, reason: "route_reserved" });
    const p = seeded("closed");
    expect(labelsConsumer(p, e)).toEqual({ ok: true });
    expect(p.evidence).toMatchObject([{ kind: "mpi_verified", service_visit_id: "sv-syn-1", episode_id: null, source_app: "autofilm" }]);
    expect(p.instances[INSTANCE].episodes[EPISODE].state).toBe("closed");
    const unknownVisit = await env(draftEnvelope("autofilm", "autolabels", "service.mpi_verified", { vehicle: { vin: VIN, instance_id: INSTANCE, episode_id: EPISODE, service_visit_id: "sv-other" } }));
    expect(labelsConsumer(seeded(), unknownVisit)).toEqual({ ok: false, reason: "service_visit_not_registered" });
  });

  it("does not attach acquisition evidence to a closed episode and never creates inventory from a VIN", async () => {
    const purchase = await env(draftEnvelope("autocurb", "autolabels", "acquisition.purchase_completed"));
    expect(labelsConsumer(seeded("closed"), purchase)).toEqual({ ok: false, reason: "episode_closed" });
    const fresh = await env(draftEnvelope("autocurb", "autolabels", "acquisition.purchase_completed", { vehicle: { vin: "5YJSA1E26HF000001", instance_id: "acq:sub-1", episode_id: "acq:sub-1:1" } }));
    const p = seeded();
    expect(labelsConsumer(p, fresh)).toEqual({ ok: true });
    expect(p.reviews).toMatchObject([{ kind: "identity_reconciliation", vin: "5YJSA1E26HF000001" }]);
    expect(Object.keys(p.instances)).toEqual([INSTANCE]);
    const provisionalAppraisal = await env(draftEnvelope("autocurb", "autolabels", "appraisal.completed", { vehicle: { vin: VIN, instance_id: "acq:sub-1", episode_id: "acq:sub-1:1" } }));
    expect(labelsConsumer(seeded(), provisionalAppraisal)).toEqual({ ok: false, reason: "provisional_ref_requires_purchase_completed" });
  });

  it("isolates tenant, rooftop, VIN and episode", async () => {
    const base = draftEnvelope("autoframe", "autolabels", "media.approved");
    expect(labelsConsumer(seeded(), await env({ ...base, aggregate: { ...base.aggregate, id: "med-syn-1" }, vehicle: { ...base.vehicle, vin: "5YJSA1E26HF000001" } }))).toEqual({ ok: false, reason: "vin_mismatch" });
    expect(labelsConsumer(seeded(), await env({ ...base, aggregate: { ...base.aggregate, id: "med-syn-1" }, vehicle: { ...base.vehicle, episode_id: "ep-syn-0001-9" } }))).toEqual({ ok: false, reason: "episode_not_registered" });
    expect(labelsConsumer(seeded(), await env({ ...base, aggregate: { ...base.aggregate, id: "med-syn-1" }, rooftop_id: "rf-nw-02" }))).toEqual({ ok: false, reason: "rooftop_mismatch" });
  });

  it("keeps media for a sold episode as history only, and refuses out-of-scope storage refs", async () => {
    const base = draftEnvelope("autoframe", "autolabels", "media.approved");
    const ok = await env({ ...base, aggregate: { ...base.aggregate, id: "med-syn-1" } });
    const p = seeded("closed");
    expect(labelsConsumer(p, ok)).toEqual({ ok: true });
    expect(p.media["med-syn-1"].active_in_gallery).toBe(false);
    const elsewhere = await env({ ...base, aggregate: { ...base.aggregate, id: "med-syn-1" }, payload: { ...base.payload, storage_ref: { bucket: "autoframe-media", object_key: "tnt-other/rf/inst/med-syn-1/x.webp" } } });
    expect(labelsConsumer(seeded(), elsewhere)).toEqual({ ok: false, reason: "storage_ref_out_of_scope" });
  });
});
