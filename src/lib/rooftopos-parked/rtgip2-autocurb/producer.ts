// AutoCurb rtgip/2 producers: appraisal and acquisition facts only.
// Confidential ACV, offers, finance amounts and customer PII are validated at the source
// where needed and never placed in any envelope (see PRIVATE-APPRAISAL-EVENT-SAFEGUARD.md).
// Parked: not imported by any runtime module; transport stays OFF.
//
// Facts are derived from authoritative records read by the server in the publishing
// transaction, never from caller-supplied booleans. public.activity_log is NOT an
// authority: staff browsers can insert into it. The authority is the server-written,
// append-only status ledger proposed in
// docs/rooftopos/proposed-sql/NEVER_APPLY_rtgip_source_ledger.sql (a trigger on
// public.submissions that records auth.uid() and the actor's dealership roles at that moment;
// browser roles cannot insert or change it). The records arrive through the server-only reader
// rtgip_src.curb_source_records (source-reader.ts), never from a caller.
//
// Business permission is checked on the attributed ledger row, not on who could write the
// column: any staff session may move a submission's status in AutoCurb's own workflow, but a
// fact qualifies only when the actor held the role AutoCurb requires for that step
// (src/lib/adminConstants.ts): PRICING_ROLES or appraiser finalize appraisals, APPROVAL_ROLES
// finalize deals, submit check requests and complete purchases, and accounting (or an
// approver) processes the check request.

import { produceFor, type SourceFact } from "../rtgip2/produce.ts";
import type { AppId, EventType } from "../rtgip2/protocol.ts";

/** Filled by the trusted server from the authenticated dealership and selected store. */
export interface CurbServerScope {
  tenant_id: string;
  rooftop_id: string;
  /** public.submissions.dealership_id this RooftopOS tenant maps to. */
  dealership_id: string;
  scope_verified_server_side: true;
}

/** The PII-free columns of public.submissions the producers read. Nothing else is loaded. */
export interface SubmissionRecord {
  id: string;
  dealership_id: string;
  vin: string;
  progress_status: string;
  /**
   * True when a positive ACV is stored for the submission. Computed in SQL by the reader,
   * so the ACV itself never leaves the database.
   */
  acv_confirmed: boolean;
  appraisal_finalized: boolean;
  check_request_done: boolean;
}

/** One row of the proposed rtgip_src.submission_ledger (written by trigger only). */
export interface LedgerRow {
  id: string;
  submission_id: string;
  dealership_id: string;
  field: "progress_status" | "appraisal_finalized" | "check_request_done";
  from_value: string | null;
  to_value: string;
  actor_user_id: string | null;
  /** public.user_roles roles the actor held in this dealership when the row was written. */
  actor_roles: readonly string[];
  written_by: "db_trigger";
  at: string;
}

export interface CurbSourceRecords {
  submission: SubmissionRecord;
  /** Every ledger row for this submission, any order. */
  ledger: readonly LedgerRow[];
  /** AutoLabels instance/episode when already reconciled, otherwise provisional "acq:" refs. */
  instance_ref: string;
  episode_ref: string;
  /** Document refs for the purchase (title/ownership and condition), from the documents table. */
  ownership_evidence_refs?: readonly string[];
  condition_evidence_refs?: readonly string[];
}

export interface CurbFactMeta {
  origin_event_id: string;
  revision: number;
  prev_revision: SourceFact["prev_revision"];
  correlation_id: string;
  causation_id?: string | null;
  emitted_at: string;
}

export class CurbProducerError extends Error { constructor(code: string) { super(code); } }

const INTERMEDIATE = new Set(["offer_accepted", "deal_finalized", "title_ownership_verified", "check_request_submitted"]);

/** Mirrors APPROVAL_ROLES, PRICING_ROLES and the accounting role in src/lib/adminConstants.ts. */
export const APPROVER_ROLES = ["admin", "gsm_gm", "gm"] as const;
export const APPRAISAL_ROLES = ["admin", "used_car_manager", "new_car_manager", "gsm_gm", "gm", "appraiser"] as const;
export const CHECK_PROCESSING_ROLES = ["accounting", ...APPROVER_ROLES] as const;
const APPROVAL_STATUSES = new Set(["deal_finalized", "check_request_submitted", "purchase_complete"]);

function permitted(row: LedgerRow, roles: readonly string[]): LedgerRow {
  if (!Array.isArray(row.actor_roles) || !row.actor_roles.some((r) => roles.includes(r))) throw new CurbProducerError("actor_lacks_permission");
  return row;
}
const staffRef = (uid: string) => `staff:${uid}`;

/** Ledger rows that are trustworthy for this scope: trigger-written, tenant-scoped, attributed. */
function trusted(scope: CurbServerScope, r: CurbSourceRecords, field: LedgerRow["field"]): LedgerRow[] {
  if (scope.scope_verified_server_side !== true) throw new CurbProducerError("scope_not_server_verified");
  if (r.submission.dealership_id !== scope.dealership_id) throw new CurbProducerError("submission_scope_mismatch");
  const rows = r.ledger.filter((x) => x.field === field);
  for (const x of rows) {
    if (x.submission_id !== r.submission.id || x.dealership_id !== scope.dealership_id) throw new CurbProducerError("ledger_scope_mismatch");
    if (x.written_by !== "db_trigger") throw new CurbProducerError("ledger_row_untrusted");
    if (Number.isNaN(Date.parse(x.at))) throw new CurbProducerError("ledger_row_untrusted");
  }
  return [...rows].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}

/** The ledger row that put the field into its current value. It must agree with the row. */
function current(rows: LedgerRow[], value: string): LedgerRow {
  const last = rows[rows.length - 1];
  if (!last || last.to_value !== value) throw new CurbProducerError("ledger_disagrees_with_record");
  if (!last.actor_user_id) throw new CurbProducerError("ledger_row_unattributed");
  return last;
}

function fact(scope: CurbServerScope, r: CurbSourceRecords, type: EventType, aggregateId: string, occurredAt: string, meta: CurbFactMeta, payload: Record<string, unknown>): SourceFact {
  return {
    source: "autocurb", event_type: type, tenant_id: scope.tenant_id, rooftop_id: scope.rooftop_id,
    vehicle: { vin: r.submission.vin, instance_id: r.instance_ref, episode_id: r.episode_ref },
    aggregate_id: aggregateId, revision: meta.revision, prev_revision: meta.prev_revision,
    origin_event_id: meta.origin_event_id, correlation_id: meta.correlation_id, causation_id: meta.causation_id ?? null,
    occurred_at: occurredAt, emitted_at: meta.emitted_at, payload,
  };
}

/** Final appraisal completed: the finalization itself must be in the trusted ledger. */
export function appraisalCompleted(scope: CurbServerScope, r: CurbSourceRecords, meta: CurbFactMeta, targets: readonly AppId[]) {
  const s = r.submission;
  if (s.progress_status !== "appraisal_completed") throw new CurbProducerError("status_not_appraisal_completed");
  current(trusted(scope, r, "progress_status"), "appraisal_completed");
  if (s.appraisal_finalized !== true) throw new CurbProducerError("not_finalized");
  const fin = permitted(current(trusted(scope, r, "appraisal_finalized"), "true"), APPRAISAL_ROLES);
  if (s.acv_confirmed !== true) throw new CurbProducerError("invalid_acv");
  return produceFor(fact(scope, r, "appraisal.completed", `apr:${s.id}`, fin.at, meta, {
    verified_state: "finalized", appraisal_ref: `apr:${s.id}`, verified_by_ref: staffRef(fin.actor_user_id!), finalized_at: fin.at, audit_ref: fin.id,
  }), targets);
}

/** Intermediate acquisition milestones. None of these transfers custody. */
export function acquisitionMilestone(scope: CurbServerScope, r: CurbSourceRecords, meta: CurbFactMeta, targets: readonly AppId[]) {
  const s = r.submission;
  if (!INTERMEDIATE.has(s.progress_status)) throw new CurbProducerError("not_an_intermediate_milestone");
  const row = current(trusted(scope, r, "progress_status"), s.progress_status);
  if (APPROVAL_STATUSES.has(s.progress_status)) permitted(row, APPROVER_ROLES);
  return produceFor(fact(scope, r, "acquisition.milestone_recorded", `acq:${s.id}`, row.at, meta, {
    milestone: s.progress_status, custody_transferred: false, recorded_at: row.at, audit_ref: row.id,
  }), targets);
}

/**
 * Purchase complete with custody transfer. offer_accepted, deal_finalized, title verification
 * and check request are never enough. Refs are either both the AutoLabels ids linked through
 * rtgip_link_acquisition, or both provisional acq: refs, which AutoLabels only ever turns into a
 * reappearance review, never a custody change. The trusted ledger must show the move to
 * purchase_complete came directly from check_request_submitted, accounting must have
 * processed the check request, and ownership and condition evidence must exist.
 */
export function purchaseCompleted(scope: CurbServerScope, r: CurbSourceRecords, meta: CurbFactMeta, targets: readonly AppId[]) {
  const s = r.submission;
  if (s.progress_status !== "purchase_complete") throw new CurbProducerError("status_not_purchase_complete");
  if (r.instance_ref.startsWith("acq:") !== r.episode_ref.startsWith("acq:")) throw new CurbProducerError("identity_partially_linked");
  const rows = trusted(scope, r, "progress_status");
  const done = permitted(current(rows, "purchase_complete"), APPROVER_ROLES);
  if (done.from_value !== "check_request_submitted") throw new CurbProducerError("purchase_skipped_check_request");
  const requested = rows.filter((x) => x.to_value === "check_request_submitted" && x.at <= done.at);
  if (!requested.length) throw new CurbProducerError("purchase_skipped_check_request");
  permitted(requested[requested.length - 1]!, APPROVER_ROLES);
  if (s.check_request_done !== true) throw new CurbProducerError("custody_unverified");
  const processed = permitted(current(trusted(scope, r, "check_request_done"), "true"), CHECK_PROCESSING_ROLES);
  if (processed.at > done.at) throw new CurbProducerError("custody_unverified");
  const own = r.ownership_evidence_refs ?? [];
  const cond = r.condition_evidence_refs ?? [];
  if (!own.length || !cond.length) throw new CurbProducerError("custody_unverified");
  return produceFor(fact(scope, r, "acquisition.purchase_completed", `acq:${s.id}`, done.at, meta, {
    purchase_ref: `pur:${s.id}`, custody_transferred: true, custody_at: done.at, verified_by_ref: staffRef(done.actor_user_id!),
    audit_ref: done.id, ownership_evidence_refs: [...own], condition_evidence_refs: [...cond],
  }), targets);
}
