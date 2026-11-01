export interface EpisodeRow {
  id: string;
  vin: string;
  store_id: string | null;
  opened_reason: string;
  custody_state: string;
  status: string;
  acquired_at: string | null;
  disposed_at: string | null;
  created_at: string;
  previous_instance_id: string | null;
}

export interface MilestoneRow {
  id: string;
  instance_id: string;
  milestone: string;
  occurred_at: string;
}

export interface RepairRow {
  id: string;
  service_visit_id: string | null;
  vin: string | null;
  item: string | null;
  severity: string | null;
  status: string;
}

export interface InspectionRow {
  id: string;
  service_visit_id: string | null;
  vin: string | null;
  inspected_at: string | null;
  source_app: string;
  technician_verified: boolean;
}

export interface VisitRow {
  id: string;
  vin: string;
  instance_id: string | null;
  source_app: string;
  ro_number: string | null;
  opened_at: string | null;
  closed_at: string | null;
  odometer_value: number | null;
  odometer_unit: string | null;
  intake_verification: string;
  status: string;
}

export interface ReviewRow {
  id: string;
  vin: string;
  prior_instance_id: string | null;
  prior_custody_state: string | null;
  detected_source: string;
  detected_at: string;
  status: string;
}

export interface InboxRow {
  id: string;
  status: string;
  event_type: string;
  vin: string | null;
  producer: string;
  received_at: string;
  outcome_code: string | null;
  attempts: number;
}

export interface QuarantineRow {
  id: string;
  raw_vin: string;
  reason: string;
  source_app: string;
  source_ref: string | null;
  inbox_id: string | null;
  status: string;
  created_at: string;
}

export interface SettingRow {
  key: string;
  value_type: "boolean" | "integer";
  allowed_scopes: string[];
  consumer: string;
  policy_status: "approved_default" | "awaiting_approval";
  min_value: number | null;
  max_value: number | null;
  effective_value: boolean | number | null;
  source: string | null;
  tenant_version: number;
  tenant_value: boolean | number | null;
}

export interface VehicleLookup {
  vin: string;
  episodes: EpisodeRow[];
  milestones: MilestoneRow[];
  visits: VisitRow[];
}

export type LookupResult = { kind: "found"; vehicles: VehicleLookup[] } | { kind: "none" } | { kind: "missing" } | { kind: "error" };

export interface Counts {
  vehicles: number | null;
  vehiclesAtLeast: boolean;
  openReturns: number | null;
  awaitingMatch: number | null;
  deadLetters: number | null;
}

export interface Snapshot {
  missing: boolean;
  counts: Counts;
  reviews: ReviewRow[] | null;
  visits: VisitRow[] | null;
  inspections: InspectionRow[];
  repairs: RepairRow[];
  inbox: InboxRow[] | null;
  inboxCounts: Record<string, number> | null;
  quarantine: QuarantineRow[] | null;
  settings: SettingRow[] | null;
  replayCap: number | null;
}

export type ActionResult = { ok: true; detail?: string } | { ok: false; message: string };

export interface VehicleRecordsActions {
  lookup: (query: string) => Promise<LookupResult>;
  resolveReview: (reviewId: string, decision: string, reason: string) => Promise<ActionResult>;
  replay: (ids: string[], reason: string) => Promise<ActionResult>;
  saveSetting: (key: string, value: boolean | number, expectedVersion: number, reason: string) => Promise<ActionResult>;
}
