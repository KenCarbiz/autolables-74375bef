// AutoFrame rtgip/2 producers. Parked: nothing calls these yet and transport is hard off.
// Maps the existing internal outbox envelope written by public.approve_media into rtgip/2
// media.approved / media.revoked. Metadata only: no bytes, no URLs, no tokens.
//
// Every fact is re-derived from the authoritative rows (public.media_assets, vehicles,
// media_renditions, approvals) that the server re-reads in the dispatch transaction. The
// queued envelope is only trusted where those rows agree with it.

import { produceFor } from "../rtgip2/produce.ts";
import type { AppId } from "../rtgip2/protocol.ts";

/** Exact shape of AutoFrame's internal outbox envelope (docs/integrations/AUTOFRAME-GATEWAY-V1.md). */
export interface AutoFrameInternalApproval {
  schema_version: 1;
  event_id: string;
  event_type: "media.approved";
  source: { app: "autoframe"; env: string };
  tenant_id: string;
  rooftop_id: string;
  vehicle: { vin: string; instance_id: string; episode_id: number };
  aggregate: { type: "media"; id: string; revision: number };
  correlation_id: string;
  causation_id: string;
  occurred_at: string;
  emitted_at: string;
  classification: string;
  payload_hash: string;
  payload: {
    media_id: string;
    rendition_id: string;
    width: number;
    height: number;
    orientation: "landscape" | "portrait" | "square";
    storage_ref: { bucket: string; path: string };
    content_sha256: string;
    approval_audit_ref: string;
    preset: { key: string; version: number };
    media_order: number;
    shot_type: string;
  };
}

/** public.media_assets columns the producer re-reads. */
export interface MediaAssetRow {
  id: string;
  tenant_id: string;
  rooftop_id: string;
  vehicle_id: string;
  episode_id: number;
  status: "uploaded" | "processing" | "review" | "approved" | "rejected" | "revoked" | "failed";
  revision: number;
  approved_rendition_id: string | null;
}
/** public.vehicles columns the producer re-reads. */
export interface VehicleRow {
  id: string;
  tenant_id: string;
  rooftop_id: string;
  vin: string;
  instance_id: string;
  episode_id: number;
  lifecycle: "inventory" | "sold" | "service";
}
/** public.media_renditions columns the producer re-reads. */
export interface RenditionRow {
  id: string;
  tenant_id: string;
  media_id: string;
  path: string;
  sha256: string;
  width: number;
  height: number;
}
/** public.approvals rows for the media (append-only decisions). */
export interface ApprovalRow {
  id: string;
  tenant_id: string;
  media_id: string;
  decision: "approved" | "rejected" | "revoked";
  actor: string;
  aggregate_revision: number;
  source_event_id: string | null;
}
/** An audited reinstatement after a revocation (audit_log action 'media.reinstated'). */
export interface ReinstatementRow {
  audit_id: string;
  tenant_id: string;
  media_id: string;
  revoked_approval_id: string;
  actor: string;
}

export interface FrameApprovalRecords {
  media: MediaAssetRow;
  vehicle: VehicleRow;
  rendition: RenditionRow;
  approvals: readonly ApprovalRow[];
  reinstatements?: readonly ReinstatementRow[];
}

/** Server scope. The episode map comes from the AutoLabels identity AutoFrame received. */
export interface FrameServerScope {
  tenant_id: string;
  rooftop_id: string;
  scope_verified_server_side: true;
  /** AutoLabels' shared episode id for AutoFrame's local integer episode. */
  episode_map: Record<number, string>;
  /** Previous emitted revision for this media aggregate, or null for the first. */
  prev_revision: number | null;
}

export class FrameProducerError extends Error {
  constructor(code: string) {
    super(code);
  }
}

const iso = (t: string) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
const staffRef = (uid: string) => `af-staff:${uid}`;

export function mediaApproved(
  internal: AutoFrameInternalApproval,
  scope: FrameServerScope,
  records: FrameApprovalRecords,
  targets: readonly AppId[],
) {
  if (scope.scope_verified_server_side !== true)
    throw new FrameProducerError("scope_not_server_verified");
  if (internal.event_type !== "media.approved" || internal.source.app !== "autoframe")
    throw new FrameProducerError("not_an_autoframe_approval");
  if (internal.tenant_id !== scope.tenant_id || internal.rooftop_id !== scope.rooftop_id)
    throw new FrameProducerError("scope_mismatch");
  const { media: m, vehicle: v, rendition: r } = records;
  const p = internal.payload;
  if (m.id !== internal.aggregate.id || p.media_id !== m.id)
    throw new FrameProducerError("media_aggregate_mismatch");
  if (m.tenant_id !== scope.tenant_id || m.rooftop_id !== scope.rooftop_id)
    throw new FrameProducerError("scope_mismatch");
  // Re-read state wins over the queued event: a withdrawn or rejected image must never go out.
  if (m.status !== "approved") throw new FrameProducerError("media_not_currently_approved");
  if (m.revision !== internal.aggregate.revision)
    throw new FrameProducerError("stale_approval_event");
  if (v.id !== m.vehicle_id || v.tenant_id !== m.tenant_id || v.rooftop_id !== m.rooftop_id)
    throw new FrameProducerError("vehicle_record_mismatch");
  if (v.lifecycle === "sold") throw new FrameProducerError("vehicle_sold");
  if (v.lifecycle !== "inventory") throw new FrameProducerError("vehicle_not_in_inventory");
  if (
    v.vin !== internal.vehicle.vin ||
    v.instance_id !== internal.vehicle.instance_id ||
    v.episode_id !== internal.vehicle.episode_id ||
    m.episode_id !== v.episode_id
  )
    throw new FrameProducerError("media_from_prior_episode");
  if (
    r.id !== m.approved_rendition_id ||
    r.id !== p.rendition_id ||
    r.tenant_id !== m.tenant_id ||
    r.media_id !== m.id ||
    r.path !== p.storage_ref.path ||
    r.sha256 !== p.content_sha256 ||
    r.width !== p.width ||
    r.height !== p.height
  )
    throw new FrameProducerError("rendition_mismatch");
  const decisions = records.approvals.filter((a) => a.media_id === m.id);
  if (decisions.some((a) => a.tenant_id !== m.tenant_id))
    throw new FrameProducerError("approval_scope_mismatch");
  const latest = [...decisions].sort((a, b) => b.aggregate_revision - a.aggregate_revision)[0];
  if (
    !latest ||
    latest.decision !== "approved" ||
    latest.aggregate_revision !== m.revision ||
    latest.source_event_id !== internal.event_id
  )
    throw new FrameProducerError("approval_record_missing");
  // A previously revoked image needs an audited reinstatement of that revocation.
  const revoked = decisions.filter(
    (a) => a.decision === "revoked" && a.aggregate_revision < latest.aggregate_revision,
  );
  let reinstatement: string | null = null;
  if (revoked.length) {
    const last = revoked.sort((a, b) => b.aggregate_revision - a.aggregate_revision)[0]!;
    const rs = (records.reinstatements ?? []).find(
      (x) =>
        x.revoked_approval_id === last.id && x.media_id === m.id && x.tenant_id === m.tenant_id,
    );
    if (!rs) throw new FrameProducerError("revoked_media_requires_reinstatement");
    reinstatement = rs.audit_id;
  }
  const episode = scope.episode_map[v.episode_id];
  if (!episode) throw new FrameProducerError("episode_not_mapped");
  if (!p.storage_ref.path.startsWith(`${m.tenant_id}/${m.rooftop_id}/${v.instance_id}/`))
    throw new FrameProducerError("storage_path_out_of_scope");
  return produceFor(
    {
      source: "autoframe",
      event_type: "media.approved",
      tenant_id: scope.tenant_id,
      rooftop_id: scope.rooftop_id,
      vehicle: { vin: v.vin, instance_id: v.instance_id, episode_id: episode },
      aggregate_id: m.id,
      revision: m.revision,
      prev_revision: scope.prev_revision,
      origin_event_id: internal.event_id,
      correlation_id: internal.correlation_id,
      causation_id: internal.causation_id,
      occurred_at: iso(internal.occurred_at),
      emitted_at: iso(internal.emitted_at),
      payload: {
        media_id: m.id,
        rendition_id: r.id,
        width: r.width,
        height: r.height,
        orientation: p.orientation,
        storage_ref: { bucket: p.storage_ref.bucket, object_key: r.path },
        content_sha256: r.sha256,
        approval_audit_ref: p.approval_audit_ref,
        approved_by_ref: staffRef(latest.actor),
        preset_key: p.preset.key,
        preset_version: p.preset.version,
        media_order: p.media_order,
        shot_type: p.shot_type,
        approved_at: iso(internal.occurred_at),
        ...(reinstatement ? { reinstatement_audit_ref: reinstatement } : {}),
      },
    },
    targets,
  );
}

export interface FrameRevocation {
  event_id: string;
  media_id: string;
  vin: string;
  instance_id: string;
  episode_id: number;
  revision: number;
  prev_revision: number | null;
  reason: "withdrawn" | "rejected_after_approval" | "rights_revoked" | "vehicle_sold_cleanup";
  revoked_at: string;
  revocation_audit_ref: string;
  correlation_id: string;
}

/** media.revoked: always a higher revision than the approval it withdraws, backed by the row. */
export function mediaRevoked(
  rv: FrameRevocation,
  scope: FrameServerScope,
  records: { media: MediaAssetRow; approvals: readonly ApprovalRow[] },
  targets: readonly AppId[],
) {
  if (scope.scope_verified_server_side !== true)
    throw new FrameProducerError("scope_not_server_verified");
  if (rv.prev_revision === null) throw new FrameProducerError("revocation_without_prior_approval");
  const m = records.media;
  if (m.id !== rv.media_id || m.tenant_id !== scope.tenant_id || m.rooftop_id !== scope.rooftop_id)
    throw new FrameProducerError("scope_mismatch");
  if (m.status !== "revoked" || m.revision !== rv.revision)
    throw new FrameProducerError("revocation_not_current");
  const row = records.approvals.find(
    (a) => a.media_id === m.id && a.decision === "revoked" && a.aggregate_revision === rv.revision,
  );
  if (!row || row.tenant_id !== m.tenant_id || row.source_event_id !== rv.event_id)
    throw new FrameProducerError("revocation_record_missing");
  if (rv.revision <= rv.prev_revision) throw new FrameProducerError("revocation_not_newer");
  const episode = scope.episode_map[rv.episode_id];
  if (!episode) throw new FrameProducerError("episode_not_mapped");
  return produceFor(
    {
      source: "autoframe",
      event_type: "media.revoked",
      tenant_id: scope.tenant_id,
      rooftop_id: scope.rooftop_id,
      vehicle: { vin: rv.vin, instance_id: rv.instance_id, episode_id: episode },
      aggregate_id: rv.media_id,
      revision: rv.revision,
      prev_revision: rv.prev_revision,
      origin_event_id: rv.event_id,
      correlation_id: rv.correlation_id,
      causation_id: null,
      occurred_at: iso(rv.revoked_at),
      emitted_at: iso(rv.revoked_at),
      payload: {
        media_id: rv.media_id,
        reason: rv.reason,
        revoked_at: iso(rv.revoked_at),
        revocation_audit_ref: rv.revocation_audit_ref,
      },
    },
    targets,
  );
}
