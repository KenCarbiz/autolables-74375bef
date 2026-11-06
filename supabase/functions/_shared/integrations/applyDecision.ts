import { catalogEntry } from "./envelope.ts";
import { validateVin } from "./vin.ts";

export type ApplyStatus = "applied" | "superseded" | "unmatched" | "rejected";

export interface InboxRowForApply {
  id: string;
  tenant_id: string;
  connection_id: string;
  producer: string;
  event_type: string;
  source_record_id: string;
  source_version: number;
  vin: string;
  visibility: string;
  envelope: {
    occurred_at?: string;
    observed_at?: string | null;
    evidence_refs?: string[];
    payload?: Record<string, unknown>;
  };
}

export interface ResolvedInstance {
  id: string;
  tenant_id: string;
}

export type StoredVisibility = "tenant_private" | "custody_shared";

export type RepairStatus =
  | "recommended" | "approved" | "declined" | "deferred" | "completed" | "completed_verified";

export interface InspectionEvidenceUpsert {
  kind: "inspection_evidence_upsert";
  row: {
    tenant_id: string;
    instance_id: string;
    source_app: string;
    source_record_id: string;
    source_version: number;
    visibility: StoredVisibility;
    inspected_at?: string | null;
    odometer_miles?: number | null;
    measurements?: Record<string, unknown>;
    evidence_refs?: string[];
    technician_verified?: boolean;
    revoked_at?: string;
  };
}

export interface RepairItemUpsert {
  kind: "repair_item_upsert";
  row: {
    tenant_id: string;
    instance_id: string;
    source_app: string;
    source_record_id: string;
    source_version: number;
    visibility: StoredVisibility;
    status: RepairStatus;
    finding_ref: string | null;
    item: string | null;
    severity: string | null;
    verified_by: string | null;
    verified_evidence_ref: string | null;
  };
}

export type ApplyEffect = InspectionEvidenceUpsert | RepairItemUpsert;

export interface ApplyDecision {
  status: ApplyStatus;
  outcomeCode: string;
  effect: ApplyEffect | null;
  recordVersion: boolean;
}

export interface ApplyInput {
  row: InboxRowForApply;
  latestVersion: number | null;
  instance: ResolvedInstance | null;
}

const REPAIR_STATUSES: readonly RepairStatus[] = [
  "recommended", "approved", "declined", "deferred", "completed", "completed_verified",
];

const result = (
  status: ApplyStatus,
  outcomeCode: string,
  effect: ApplyEffect | null = null,
  recordVersion = false,
): ApplyDecision => ({ status, outcomeCode, effect, recordVersion });

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

export function decideApply({ row, latestVersion, instance }: ApplyInput): ApplyDecision {
  if (!catalogEntry(row.event_type)) return result("rejected", "unknown_event");

  const vin = validateVin(row.vin);
  if (!vin.ok) return result("unmatched", `vin_${vin.reason}`);
  if (!instance || instance.tenant_id !== row.tenant_id) return result("unmatched", "no_active_instance");

  if (latestVersion !== null && row.source_version <= latestVersion) return result("superseded", "stale_version");

  const payload = row.envelope.payload ?? {};
  const base = {
    tenant_id: row.tenant_id,
    instance_id: instance.id,
    source_app: row.producer,
    source_record_id: row.source_record_id,
    source_version: row.source_version,
    visibility: (row.visibility === "custody_shared" ? "custody_shared" : "tenant_private") as StoredVisibility,
  };

  if (row.event_type === "autofilm.inspection.completed" || row.event_type === "autofilm.inspection.corrected") {
    const measurements = payload.measurements;
    return result("applied", "applied", {
      kind: "inspection_evidence_upsert",
      row: {
        ...base,
        inspected_at: row.envelope.observed_at ?? row.envelope.occurred_at ?? null,
        odometer_miles: int(payload.odometer_miles),
        measurements: measurements && typeof measurements === "object" && !Array.isArray(measurements)
          ? measurements as Record<string, unknown>
          : {},
        evidence_refs: row.envelope.evidence_refs ?? [],
        technician_verified: payload.technician_verified === true,
      },
    }, true);
  }

  if (row.event_type === "autofilm.inspection.revoked") {
    return result("applied", "applied", {
      kind: "inspection_evidence_upsert",
      row: { ...base, revoked_at: row.envelope.occurred_at ?? new Date(0).toISOString() },
    }, true);
  }

  if (row.event_type.startsWith("autofilm.repair.")) {
    const suffix = row.event_type.slice("autofilm.repair.".length);
    const status = suffix === "corrected" ? str(payload.status) : suffix;
    if (!status || !(REPAIR_STATUSES as readonly string[]).includes(status)) {
      return result("rejected", "invalid_repair_status");
    }
    const evidenceRef = str(payload.verified_evidence_ref);
    if (status === "completed_verified" && !evidenceRef) {
      return result("rejected", "missing_verification_evidence");
    }
    return result("applied", "applied", {
      kind: "repair_item_upsert",
      row: {
        ...base,
        status: status as RepairStatus,
        finding_ref: str(payload.finding_id),
        item: str(payload.item),
        severity: str(payload.severity),
        verified_by: status === "completed_verified" ? str(payload.verified_by) : null,
        verified_evidence_ref: status === "completed_verified" ? evidenceRef : null,
      },
    }, true);
  }

  return result("applied", "applied_no_effect", null, true);
}

export interface ApplyPlan {
  verdict: "apply" | "noop" | "reject" | "unmatched";
  outcome: string;
  effect?: Record<string, unknown>;
}

const EFFECT_OMIT = new Set(["tenant_id", "instance_id", "source_app", "source_record_id", "source_version", "visibility"]);

// Version- and instance-independent part of the decision. The database function
// integration_apply_event owns ordering, instance lookup and the watermark.
export function planApply(row: InboxRowForApply): ApplyPlan {
  const d = decideApply({ row, latestVersion: null, instance: { id: "plan", tenant_id: row.tenant_id } });
  if (d.status === "rejected") return { verdict: "reject", outcome: d.outcomeCode };
  if (d.status === "unmatched") return { verdict: "unmatched", outcome: d.outcomeCode };
  if (!d.effect) return { verdict: "noop", outcome: d.outcomeCode };
  const effect: Record<string, unknown> = { kind: d.effect.kind };
  for (const [k, v] of Object.entries(d.effect.row)) {
    if (!EFFECT_OMIT.has(k) && v !== undefined) effect[k] = v;
  }
  return { verdict: "apply", outcome: d.outcomeCode, effect };
}
