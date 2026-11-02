// Synthetic source records shared by the corpus generator and the six-direction matrix.
// Fictitious data only. The shapes are the authoritative rows each producer re-reads:
// AutoLabels PR #46 history, AutoCurb submissions + trusted ledger, AutoFrame media rows.
import { TENANT, ROOFTOP, VIN, INSTANCE, EPISODE } from "../rtgip2/fixtures.ts";
import type * as L from "../rtgip2-autolabels/producer.ts";
import type * as C from "../rtgip2-autocurb/producer.ts";
import type * as F from "../rtgip2-autoframe/producer.ts";

export const AT = "2027-01-15T15:00:00Z";
export const STAFF = "44444444-4444-4444-8444-444444444444";
export const OWNER = "77777777-7777-4777-8777-777777777777";
export const SUB = "55555555-5555-4555-8555-555555555555";
export const DEALERSHIP = "dlr-syn-northwind";

export const scope = { tenant_id: TENANT, rooftop_id: ROOFTOP, scope_verified_server_side: true as const };
export const curbScope = { ...scope, dealership_id: DEALERSHIP };
export const inst: L.LabelsInstance = { vin: VIN, instance_id: INSTANCE, episode_id: EPISODE, episode_state: "open", stock_number: "SYN1001" };

export const meta = (id: string, agg: string, rev = 1, prev: L.FactMeta["prev_revision"] = rev > 1 ? rev - 1 : null): L.FactMeta => ({
  origin_event_id: id, aggregate_id: agg, revision: rev, prev_revision: prev, correlation_id: "corr-syn-1", occurred_at: AT, emitted_at: AT,
});
export const cmeta = (id: string, rev = 1, prev: C.CurbFactMeta["prev_revision"] = rev > 1 ? rev - 1 : null): C.CurbFactMeta => ({
  origin_event_id: id, revision: rev, prev_revision: prev, correlation_id: "corr-syn-1", emitted_at: AT,
});

export const firstEpisode: L.EpisodeHistory = {
  episode: { episode_id: EPISODE, tenant_id: TENANT, vin: VIN, instance_id: INSTANCE, opened_reason: "initial", previous_episode_id: null, custody_state: "in_stock", status: "active" },
  vin_episodes: [], predecessor_milestones: [], review: null,
};

export const soldMilestone: L.CustodyMilestoneRecord = {
  id: "ms-syn-sold-1", tenant_id: TENANT, episode_id: EPISODE, vin: VIN, milestone: "sold", to_state: "sold",
  occurred_at: AT, source: "staff", confirmed_by: STAFF, corrects_id: null,
};

const T = (m: number) => `2027-01-15T14:${String(m).padStart(2, "0")}:00Z`;
const led = (id: string, field: C.LedgerRow["field"], from: string | null, to: string, at: string, sub = SUB): C.LedgerRow => ({
  id, submission_id: sub, dealership_id: DEALERSHIP, field, from_value: from, to_value: to, actor_user_id: STAFF, actor_roles: ["gm"], written_by: "db_trigger", at,
});

export const curbRecords = (status: "appraisal_completed" | "deal_finalized" | "purchase_complete", over: Partial<C.CurbSourceRecords> = {}, sub = SUB): C.CurbSourceRecords => {
  const ledger: C.LedgerRow[] = [
    led(`led-${sub.slice(0, 4)}-1`, "progress_status", "inspection_completed", "appraisal_completed", T(1), sub),
    led(`led-${sub.slice(0, 4)}-2`, "appraisal_finalized", "false", "true", T(2), sub),
  ];
  if (status !== "appraisal_completed") ledger.push(led(`led-${sub.slice(0, 4)}-3`, "progress_status", "appraisal_completed", "deal_finalized", T(3), sub));
  if (status === "purchase_complete") {
    ledger.push(led(`led-${sub.slice(0, 4)}-4`, "progress_status", "deal_finalized", "check_request_submitted", T(4), sub));
    ledger.push(led(`led-${sub.slice(0, 4)}-6`, "check_request_done", "false", "true", T(4), sub));
    ledger.push(led(`led-${sub.slice(0, 4)}-5`, "progress_status", "check_request_submitted", "purchase_complete", T(5), sub));
  }
  return {
    submission: { id: sub, dealership_id: DEALERSHIP, vin: VIN, progress_status: status, acv_confirmed: true, appraisal_finalized: true, check_request_done: status === "purchase_complete" },
    ledger, instance_ref: INSTANCE, episode_ref: EPISODE,
    ownership_evidence_refs: ["doc:title-syn-1"], condition_evidence_refs: ["doc:cond-syn-1"],
    ...over,
  };
};

export const MEDIA = "med-syn-1";
export const mediaPath = (rev: number) => `${TENANT}/${ROOFTOP}/${INSTANCE}/${MEDIA}/derived/studio-v1-r${rev}.webp`;

export const approval = (rev = 1, eventId = `af-evt-${rev}`): F.AutoFrameInternalApproval => ({
  schema_version: 1, event_id: eventId, event_type: "media.approved", source: { app: "autoframe", env: "dev" }, tenant_id: TENANT, rooftop_id: ROOFTOP,
  vehicle: { vin: VIN, instance_id: INSTANCE, episode_id: 1 }, aggregate: { type: "media", id: MEDIA, revision: rev }, correlation_id: "corr-syn-1", causation_id: "appr-syn-1",
  occurred_at: AT, emitted_at: AT, classification: "internal-synthetic", payload_hash: "x",
  payload: { media_id: MEDIA, rendition_id: `rend-syn-${rev}`, width: 1500, height: 1000, orientation: "landscape", storage_ref: { bucket: "autoframe-media", path: mediaPath(rev) }, content_sha256: "b".repeat(64), approval_audit_ref: "audit-af-1", preset: { key: "studio", version: 1 }, media_order: 1, shot_type: "front_34" },
});

export const frameScope = (prev: number | null = null): F.FrameServerScope => ({ ...scope, episode_map: { 1: EPISODE }, prev_revision: prev });

/** Rows as they stand right after the approval at revision `rev` (optionally after a revocation). */
export const frameRecords = (rev = 1, eventId = `af-evt-${rev}`, history: F.ApprovalRow[] = [], over: { lifecycle?: F.VehicleRow["lifecycle"]; status?: F.MediaAssetRow["status"]; reinstatements?: F.ReinstatementRow[] } = {}): F.FrameApprovalRecords => ({
  media: { id: MEDIA, tenant_id: TENANT, rooftop_id: ROOFTOP, vehicle_id: "veh-syn-1", episode_id: 1, status: over.status ?? "approved", revision: rev, approved_rendition_id: `rend-syn-${rev}` },
  vehicle: { id: "veh-syn-1", tenant_id: TENANT, rooftop_id: ROOFTOP, vin: VIN, instance_id: INSTANCE, episode_id: 1, lifecycle: over.lifecycle ?? "inventory" },
  rendition: { id: `rend-syn-${rev}`, tenant_id: TENANT, media_id: MEDIA, path: mediaPath(rev), sha256: "b".repeat(64), width: 1500, height: 1000 },
  approvals: [...history, { id: `ap-syn-${rev}`, tenant_id: TENANT, media_id: MEDIA, decision: "approved", actor: STAFF, aggregate_revision: rev, source_event_id: eventId }],
  ...(over.reinstatements ? { reinstatements: over.reinstatements } : {}),
});

export const revocation = (rev: number, prev: number): F.FrameRevocation => ({
  event_id: `af-rev-${rev}`, media_id: MEDIA, vin: VIN, instance_id: INSTANCE, episode_id: 1, revision: rev, prev_revision: prev,
  reason: "withdrawn", revoked_at: AT, revocation_audit_ref: `audit-rev-${rev}`, correlation_id: "corr-syn-1",
});
export const revocationRecords = (rev: number): { media: F.MediaAssetRow; approvals: F.ApprovalRow[] } => ({
  media: { id: MEDIA, tenant_id: TENANT, rooftop_id: ROOFTOP, vehicle_id: "veh-syn-1", episode_id: 1, status: "revoked", revision: rev, approved_rendition_id: `rend-syn-${rev - 1}` },
  approvals: [{ id: `ap-syn-rv-${rev}`, tenant_id: TENANT, media_id: MEDIA, decision: "revoked", actor: STAFF, aggregate_revision: rev, source_event_id: `af-rev-${rev}` }],
});
