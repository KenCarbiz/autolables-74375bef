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
//
// Phase 3D: every ledger row also says how its actor was established (actor_kind). Only a
// signed-in user or a service action attested in the database on behalf of a named user can
// qualify a business step. A customer accepting an offer through their token is recorded as
// customer_token and qualifies only the offer_accepted milestone, never an approval, a check
// or a purchase. The submission must resolve to exactly the rooftop the server is publishing
// for, and a purchase needs the whole approved chain plus custody evidence, which AutoCurb does
// not record today, so acquisition.purchase_completed is refused until that process exists.

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
  /** public.submissions.store_location_id; the rooftop binding is resolved from it in SQL. */
  store_location_id: string | null;
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

/**
 * How the ledger trigger established the actor:
 * - user: auth.uid() of a signed-in session; actor_roles are that user's roles in this
 *   dealership and store at that moment (possibly none).
 * - service_attested: a server action that named the user it acted for, whose roles the
 *   database verified in the same transaction (rtgip_service_set_status).
 * - customer_token: the customer's own token RPC (accept_offer). Not a staff decision.
 * - unattributed: anything else (service key without attestation, cron, console).
 */
export type ActorKind = "user" | "service_attested" | "customer_token" | "unattributed";

/** One row of the proposed rtgip_src.submission_ledger (written by trigger only). */
export interface LedgerRow {
  id: string;
  submission_id: string;
  dealership_id: string;
  field: "progress_status" | "appraisal_finalized" | "check_request_done";
  from_value: string | null;
  to_value: string;
  actor_user_id: string | null;
  /** public.user_roles roles the actor held in this dealership and store when the row was written. */
  actor_roles: readonly string[];
  actor_kind: ActorKind;
  /** The server action name for service_attested rows, otherwise null. */
  attested_service: string | null;
  written_by: "db_trigger";
  at: string;
}

/**
 * Proof that the vehicle physically changed hands. AutoCurb has no such record today
 * (submissions.check_picked_up_at is the customer collecting the check, not the dealership
 * receiving the vehicle), so the reader always returns null and purchases are refused.
 */
export interface CustodyEvidence {
  ref: string;
  at: string;
  actor_user_id: string;
  actor_roles: readonly string[];
  actor_kind: "user" | "service_attested";
}

export interface CurbSourceRecords {
  submission: SubmissionRecord;
  /** Every ledger row for this submission, any order. */
  ledger: readonly LedgerRow[];
  /** The RooftopOS tenant and rooftop the submission's dealership and store map to, or null when unmapped or ambiguous. */
  rooftop_binding: { tenant_id: string; rooftop_id: string } | null;
  /** AutoLabels instance/episode when already reconciled, otherwise provisional "acq:" refs. */
  instance_ref: string;
  episode_ref: string;
  /** Document refs for the purchase (title/ownership and condition), from the documents table. */
  ownership_evidence_refs?: readonly string[];
  condition_evidence_refs?: readonly string[];
  custody_evidence?: CustodyEvidence | null;
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
/** AutoCurb has no role rule for title verification today; this is the proposed rule (owner decision). */
export const TITLE_VERIFY_ROLES = ["accounting", ...APPROVER_ROLES] as const;
/** Who may attest that the dealership received the vehicle (owner decision; no process exists yet). */
export const CUSTODY_ROLES = APPROVER_ROLES;
/** The only statuses accept_offer moves from (supabase/migrations/20260510143530_*.sql). */
const CUSTOMER_ACCEPT_FROM = new Set(["new", "offer_made", "contacted"]);
const MILESTONE_ROLES: Record<string, readonly string[] | "any_staff_or_customer"> = {
  offer_accepted: "any_staff_or_customer",
  deal_finalized: APPROVER_ROLES,
  title_ownership_verified: TITLE_VERIFY_ROLES,
  check_request_submitted: APPROVER_ROLES,
};

/** Time order for ledger timestamps with 0-6 fractional digits. */
const tkey = (at: string) => {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(at);
  if (!m) throw new CurbProducerError("ledger_row_untrusted");
  return `${m[1]}.${(m[2] ?? "").padEnd(6, "0")}Z`;
};
const before = (a: LedgerRow | CustodyEvidence, b: LedgerRow | CustodyEvidence) => tkey(a.at) <= tkey(b.at);

function staffRow<T extends LedgerRow | CustodyEvidence>(row: T): T {
  if (row.actor_kind !== "user" && row.actor_kind !== "service_attested") throw new CurbProducerError(row.actor_kind === "customer_token" ? "customer_action_not_staff_authority" : "ledger_row_unattributed");
  if (!row.actor_user_id) throw new CurbProducerError("ledger_row_unattributed");
  return row;
}
function permitted<T extends LedgerRow | CustodyEvidence>(row: T, roles: readonly string[]): T {
  staffRow(row);
  if (!Array.isArray(row.actor_roles) || !row.actor_roles.some((r) => roles.includes(r))) throw new CurbProducerError("actor_lacks_permission");
  return row;
}
const staffRef = (uid: string) => `staff:${uid}`;

/** The scope, rooftop and ledger rows must all belong to what the server publishes for. */
function bound(scope: CurbServerScope, r: CurbSourceRecords) {
  if (scope.scope_verified_server_side !== true) throw new CurbProducerError("scope_not_server_verified");
  if (r.submission.dealership_id !== scope.dealership_id) throw new CurbProducerError("submission_scope_mismatch");
  if (!r.rooftop_binding) throw new CurbProducerError("rooftop_unmapped");
  if (r.rooftop_binding.tenant_id !== scope.tenant_id || r.rooftop_binding.rooftop_id !== scope.rooftop_id) throw new CurbProducerError("rooftop_mismatch");
}

/** Ledger rows that are trustworthy for this scope: trigger-written and tenant-scoped. */
function trusted(scope: CurbServerScope, r: CurbSourceRecords, field: LedgerRow["field"]): LedgerRow[] {
  bound(scope, r);
  const rows = r.ledger.filter((x) => x.field === field);
  for (const x of rows) {
    if (x.submission_id !== r.submission.id || x.dealership_id !== scope.dealership_id) throw new CurbProducerError("ledger_scope_mismatch");
    if (x.written_by !== "db_trigger") throw new CurbProducerError("ledger_row_untrusted");
    if (!["user", "service_attested", "customer_token", "unattributed"].includes(x.actor_kind)) throw new CurbProducerError("ledger_row_untrusted");
    tkey(x.at);
  }
  return [...rows].sort((a, b) => (tkey(a.at) < tkey(b.at) ? -1 : tkey(a.at) > tkey(b.at) ? 1 : a.id < b.id ? -1 : 1));
}

/** The ledger row that put the field into its current value. It must agree with the record. */
function current(rows: LedgerRow[], value: string): LedgerRow {
  const last = rows[rows.length - 1];
  if (!last || last.to_value !== value) throw new CurbProducerError("ledger_disagrees_with_record");
  return last;
}

/** The latest row moving the field to value at or before the bound row. */
function lastTo(rows: LedgerRow[], value: string, notAfter: LedgerRow, code: string): LedgerRow {
  const hit = rows.filter((x) => x.to_value === value && before(x, notAfter) && x !== notAfter);
  if (!hit.length) throw new CurbProducerError(code);
  return hit[hit.length - 1]!;
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

function identityConsistent(r: CurbSourceRecords) {
  if (r.instance_ref.startsWith("acq:") !== r.episode_ref.startsWith("acq:")) throw new CurbProducerError("identity_partially_linked");
}

/** Final appraisal completed: the finalization itself must be in the trusted ledger. */
export function appraisalCompleted(scope: CurbServerScope, r: CurbSourceRecords, meta: CurbFactMeta, targets: readonly AppId[]) {
  const s = r.submission;
  bound(scope, r);
  identityConsistent(r);
  if (s.progress_status !== "appraisal_completed") throw new CurbProducerError("status_not_appraisal_completed");
  staffRow(current(trusted(scope, r, "progress_status"), "appraisal_completed"));
  if (s.appraisal_finalized !== true) throw new CurbProducerError("not_finalized");
  const fin = permitted(current(trusted(scope, r, "appraisal_finalized"), "true"), APPRAISAL_ROLES);
  if (s.acv_confirmed !== true) throw new CurbProducerError("invalid_acv");
  return produceFor(fact(scope, r, "appraisal.completed", `apr:${s.id}`, fin.at, meta, {
    verified_state: "finalized", appraisal_ref: `apr:${s.id}`, verified_by_ref: staffRef(fin.actor_user_id!), finalized_at: fin.at, audit_ref: fin.id,
  }), targets);
}

/**
 * Intermediate acquisition milestones. None of these transfers custody. offer_accepted may come
 * from the customer's token RPC (only from the statuses accept_offer moves from) or from any staff
 * member with a role in this dealership; the later milestones need the role AutoCurb requires.
 */
export function acquisitionMilestone(scope: CurbServerScope, r: CurbSourceRecords, meta: CurbFactMeta, targets: readonly AppId[]) {
  const s = r.submission;
  bound(scope, r);
  identityConsistent(r);
  if (!INTERMEDIATE.has(s.progress_status)) throw new CurbProducerError("not_an_intermediate_milestone");
  const row = current(trusted(scope, r, "progress_status"), s.progress_status);
  const rule = MILESTONE_ROLES[s.progress_status]!;
  if (rule === "any_staff_or_customer") {
    if (row.actor_kind === "customer_token") {
      if (!CUSTOMER_ACCEPT_FROM.has(row.from_value ?? "")) throw new CurbProducerError("customer_accept_from_invalid_status");
    } else if (!staffRow(row).actor_roles.length) throw new CurbProducerError("actor_lacks_permission");
  } else permitted(row, rule);
  return produceFor(fact(scope, r, "acquisition.milestone_recorded", `acq:${s.id}`, row.at, meta, {
    milestone: s.progress_status, custody_transferred: false, recorded_at: row.at, audit_ref: row.id,
  }), targets);
}

/**
 * Purchase complete with custody transfer. Every step must be in the trusted ledger, attributed
 * to staff holding the role for that step, in order: appraisal finalized, deal finalized by an
 * approver, title verified, check request submitted by an approver, check request processed by
 * accounting or an approver, purchase completed by an approver directly from
 * check_request_submitted, exactly once. Ownership and condition evidence must exist, and the
 * dealership must have recorded custody of the vehicle. A customer accepting an offer counts
 * for none of these. Refs are either both linked AutoLabels ids or both provisional acq: refs,
 * which AutoLabels only ever turns into a reappearance review, never a custody change.
 */
export function purchaseCompleted(scope: CurbServerScope, r: CurbSourceRecords, meta: CurbFactMeta, targets: readonly AppId[]) {
  const s = r.submission;
  bound(scope, r);
  if (s.progress_status !== "purchase_complete") throw new CurbProducerError("status_not_purchase_complete");
  identityConsistent(r);
  const rows = trusted(scope, r, "progress_status");
  const done = permitted(current(rows, "purchase_complete"), APPROVER_ROLES);
  if (rows.filter((x) => x.to_value === "purchase_complete").length !== 1) throw new CurbProducerError("duplicate_purchase");
  if (done.from_value !== "check_request_submitted") throw new CurbProducerError("purchase_skipped_check_request");
  const requested = permitted(lastTo(rows, "check_request_submitted", done, "purchase_skipped_check_request"), APPROVER_ROLES);
  const title = permitted(lastTo(rows, "title_ownership_verified", requested, "title_unverified"), TITLE_VERIFY_ROLES);
  permitted(lastTo(rows, "deal_finalized", title, "deal_not_finalized"), APPROVER_ROLES);
  if (s.appraisal_finalized !== true || s.acv_confirmed !== true) throw new CurbProducerError("appraisal_not_final");
  const fin = permitted(current(trusted(scope, r, "appraisal_finalized"), "true"), APPRAISAL_ROLES);
  if (!before(fin, done)) throw new CurbProducerError("appraisal_not_final");
  if (s.check_request_done !== true) throw new CurbProducerError("check_unprocessed");
  const processed = permitted(current(trusted(scope, r, "check_request_done"), "true"), CHECK_PROCESSING_ROLES);
  if (!before(requested, processed) || !before(processed, done)) throw new CurbProducerError("check_unprocessed");
  const own = r.ownership_evidence_refs ?? [];
  const cond = r.condition_evidence_refs ?? [];
  if (!own.length) throw new CurbProducerError("ownership_evidence_missing");
  if (!cond.length) throw new CurbProducerError("condition_evidence_missing");
  if (!r.custody_evidence) throw new CurbProducerError("custody_authority_missing");
  const custody = permitted(r.custody_evidence, CUSTODY_ROLES);
  if (!before(requested, custody)) throw new CurbProducerError("custody_before_check_request");
  return produceFor(fact(scope, r, "acquisition.purchase_completed", `acq:${s.id}`, done.at, meta, {
    purchase_ref: `pur:${s.id}`, custody_transferred: true, custody_at: custody.at, verified_by_ref: staffRef(done.actor_user_id!),
    audit_ref: done.id, ownership_evidence_refs: [...own], condition_evidence_refs: [...cond],
  }), targets);
}
