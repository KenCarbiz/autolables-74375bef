// AutoLabels rtgip/2 consumer effects. Runs inside the inbox transaction (MemoryInbox here,
// rtgip.inbox_receive + PR #46 evidence tables in the proposed SQL). It only ever appends
// evidence or reviews; it never reopens a sold episode, creates a listing, or changes price.

import type { ConsumerEffect } from "../rtgip2/delivery.ts";
import type { EnvelopeV2 } from "../rtgip2/protocol.ts";

export interface LabelsEpisode { state: "open" | "closed"; opened_reason: string }
export interface LabelsInstanceRow {
  tenant_id: string;
  rooftop_id: string;
  vin: string;
  episodes: Record<string, LabelsEpisode>;
  service_visits: Record<string, { ro_ref: string | null }>;
}

export interface EvidenceRow {
  instance_id: string;
  episode_id: string | null;
  service_visit_id: string | null;
  domain: string;
  kind: string;
  source_app: string;
  source_event_id: string;
  source_revision: number;
  refs: string[];
  at: string;
}

export interface MediaRef {
  instance_id: string;
  episode_id: string;
  state: "approved" | "revoked";
  active_in_gallery: boolean;
  approval_revision: number;
  rendition_id: string | null;
  storage_bucket: string | null;
  storage_object_key: string | null;
  content_sha256: string | null;
  media_order: number | null;
  shot_type: string | null;
  source_event_id: string;
}

export interface ReviewRow {
  kind: "identity_reconciliation" | "reappearance";
  tenant_id: string;
  rooftop_id: string;
  vin: string;
  source_app: string;
  source_instance_ref: string;
  source_episode_ref: string;
  prior_instance_id: string | null;
  source_event_id: string;
  status: "open";
}

export interface LabelsProjection {
  instances: Record<string, LabelsInstanceRow>;
  evidence: EvidenceRow[];
  media: Record<string, MediaRef>;
  reviews: ReviewRow[];
}

export const emptyLabelsProjection = (): LabelsProjection => ({ instances: {}, evidence: [], media: {}, reviews: [] });

/** Source-side provisional refs (e.g. an AutoCurb acquisition before AutoLabels registers the unit). */
export const isProvisional = (ref: string) => ref.startsWith("acq:");

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

function resolve(p: LabelsProjection, e: EnvelopeV2): { row: LabelsInstanceRow; episode: LabelsEpisode } | Fail {
  const row = p.instances[e.vehicle.instance_id];
  if (!row) return fail("unknown_instance");
  if (row.tenant_id !== e.tenant_id) return fail("tenant_mismatch");
  if (row.rooftop_id !== e.rooftop_id) return fail("rooftop_mismatch");
  if (row.vin !== e.vehicle.vin) return fail("vin_mismatch");
  const episode = row.episodes[e.vehicle.episode_id];
  if (!episode) return fail("episode_not_registered");
  return { row, episode };
}

function evidence(e: EnvelopeV2, kind: string, refs: string[], at: string, serviceVisit: string | null = null): EvidenceRow {
  return {
    instance_id: e.vehicle.instance_id, episode_id: serviceVisit ? null : e.vehicle.episode_id, service_visit_id: serviceVisit,
    domain: e.aggregate.domain, kind, source_app: e.origin.app, source_event_id: e.origin.event_id, source_revision: e.origin.revision, refs, at,
  };
}

function fromAutoCurb(p: LabelsProjection, e: EnvelopeV2): { ok: true } | Fail {
  const pl = e.payload as Record<string, unknown>;
  if (isProvisional(e.vehicle.instance_id) || isProvisional(e.vehicle.episode_id)) {
    // AutoCurb acquired a unit AutoLabels has not registered. Never create inventory from a VIN:
    // open an identity-reconciliation review, or a reappearance review if the VIN was here before.
    if (e.event_type !== "acquisition.purchase_completed") return fail("provisional_ref_requires_purchase_completed");
    const prior = Object.entries(p.instances).find(([, r]) => r.tenant_id === e.tenant_id && r.vin === e.vehicle.vin);
    p.reviews.push({
      kind: prior ? "reappearance" : "identity_reconciliation", tenant_id: e.tenant_id, rooftop_id: e.rooftop_id, vin: e.vehicle.vin,
      source_app: "autocurb", source_instance_ref: e.vehicle.instance_id, source_episode_ref: e.vehicle.episode_id,
      prior_instance_id: prior ? prior[0] : null, source_event_id: e.origin.event_id, status: "open",
    });
    return { ok: true };
  }
  const r = resolve(p, e);
  if ("ok" in r) return r;
  if (r.episode.state === "closed") return fail("episode_closed");
  if (e.event_type === "appraisal.completed") {
    p.evidence.push(evidence(e, "appraisal_finalized", [String(pl.appraisal_ref), String(pl.audit_ref)], String(pl.finalized_at)));
  } else if (e.event_type === "acquisition.milestone_recorded") {
    p.evidence.push(evidence(e, `acquisition_milestone:${String(pl.milestone)}`, [String(pl.audit_ref)], String(pl.recorded_at)));
  } else if (e.event_type === "acquisition.purchase_completed") {
    const refs = [String(pl.purchase_ref), String(pl.audit_ref), ...(pl.ownership_evidence_refs as string[]), ...(pl.condition_evidence_refs as string[])];
    p.evidence.push(evidence(e, "purchase_completed_custody_received", refs, String(pl.custody_at)));
  } else return fail("unsupported_event_for_consumer");
  return { ok: true };
}

function fromAutoFrame(p: LabelsProjection, e: EnvelopeV2): { ok: true } | Fail {
  const r = resolve(p, e);
  if ("ok" in r) return r;
  const pl = e.payload as Record<string, unknown>;
  const mediaId = String(pl.media_id);
  if (mediaId !== e.aggregate.id) return fail("media_aggregate_mismatch");
  const prior = p.media[mediaId];
  if (prior && (prior.instance_id !== e.vehicle.instance_id || prior.episode_id !== e.vehicle.episode_id)) return fail("media_vehicle_reassignment");
  if (e.event_type === "media.revoked") {
    p.media[mediaId] = {
      ...(prior ?? { instance_id: e.vehicle.instance_id, episode_id: e.vehicle.episode_id, rendition_id: null, storage_bucket: null, storage_object_key: null, content_sha256: null, media_order: null, shot_type: null }),
      state: "revoked", active_in_gallery: false, approval_revision: e.aggregate.revision, source_event_id: e.origin.event_id,
    };
    return { ok: true };
  }
  if (e.event_type !== "media.approved") return fail("unsupported_event_for_consumer");
  const storage = pl.storage_ref as { bucket: string; object_key: string };
  const scopePrefix = `${e.tenant_id}/${e.rooftop_id}/${e.vehicle.instance_id}/`;
  if (!storage.object_key.startsWith(scopePrefix)) return fail("storage_ref_out_of_scope");
  p.media[mediaId] = {
    instance_id: e.vehicle.instance_id, episode_id: e.vehicle.episode_id, state: "approved",
    // Approved media for a sold/closed episode is kept as history, never shown as current inventory.
    active_in_gallery: r.episode.state === "open",
    approval_revision: e.aggregate.revision, rendition_id: String(pl.rendition_id), storage_bucket: storage.bucket,
    storage_object_key: storage.object_key, content_sha256: String(pl.content_sha256), media_order: Number(pl.media_order),
    shot_type: String(pl.shot_type), source_event_id: e.origin.event_id,
  };
  return { ok: true };
}

/** Future AutoFilm service evidence. The route is reserved; this is exercised by synthetic tests only. */
function fromServiceEvidence(p: LabelsProjection, e: EnvelopeV2): { ok: true } | Fail {
  const row = p.instances[e.vehicle.instance_id];
  if (!row) return fail("unknown_instance");
  if (row.tenant_id !== e.tenant_id || row.rooftop_id !== e.rooftop_id) return fail("tenant_mismatch");
  if (row.vin !== e.vehicle.vin) return fail("vin_mismatch");
  const sv = e.vehicle.service_visit_id;
  if (!sv || !row.service_visits[sv]) return fail("service_visit_not_registered");
  if (!row.episodes[e.vehicle.episode_id]) return fail("episode_not_registered");
  const pl = e.payload as Record<string, unknown>;
  // Attaches to the service visit only. Episode state (including sold) is untouched.
  p.evidence.push(evidence(e, e.event_type === "service.mpi_verified" ? "mpi_verified" : "repair_verified", [String(pl.ro_ref), ...(pl.evidence_refs as string[])], String(pl.verified_at), sv));
  return { ok: true };
}

export const labelsConsumer: ConsumerEffect<LabelsProjection> = (p, e) => {
  if (e.target_app !== "autolabels") return fail("wrong_destination");
  switch (e.origin.app) {
    case "autocurb": return fromAutoCurb(p, e);
    case "autoframe": return fromAutoFrame(p, e);
    case "autofilm": return fromServiceEvidence(p, e);
    default: return fail("unsupported_source");
  }
};
