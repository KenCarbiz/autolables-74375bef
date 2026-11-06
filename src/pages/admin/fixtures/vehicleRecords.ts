import type { AdminScreenFixture } from "./index";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import type { VehicleRecordsFixture } from "@/pages/admin/children/VehicleRecordsPage";
import type { EpisodeRow, InboxRow, MilestoneRow, QuarantineRow, RepairRow, ReviewRow, SettingRow, Snapshot, VehicleLookup, VisitRow } from "@/lib/vehicleHistory/types";

// Synthetic design fixtures for Vehicle records & lifecycle. Every account,
// VIN, repair order and date is invented for the harness; nothing here is a
// real vehicle and nothing is ever written.

const NOW = Date.parse("2026-10-31T18:00:00Z");
const VIN_DELIVERED = "1HGCM82633A004352";
const VIN_REACQUIRED = "1M8GDM9AXKP042788";
const VIN_ARCHIVED = "JH4KA7561PC008269";
const VIN_RETURNED = "5FNRL6H78KB000193";
const VIN_SERVICE_ONLY = "1FTFW1E50NFA00931";

const ep = (id: string, vin: string, patch: Partial<EpisodeRow>): EpisodeRow => ({
  id, vin, store_id: "store-synthetic", opened_reason: "initial", custody_state: "in_stock", status: "active",
  acquired_at: null, disposed_at: null, created_at: "2026-01-01T00:00:00Z", previous_instance_id: null, ...patch,
});
const ms = (id: string, instance_id: string, milestone: string, occurred_at: string): MilestoneRow => ({ id, instance_id, milestone, occurred_at });
const visit = (id: string, vin: string, patch: Partial<VisitRow>): VisitRow => ({
  id, vin, instance_id: null, source_app: "autofilm", ro_number: null, opened_at: null, closed_at: null, odometer_value: null, odometer_unit: null,
  intake_verification: "verified_ro", status: "closed", ...patch,
});

const VISIT_DELIVERED = visit("sv-1", VIN_DELIVERED, { ro_number: "48211", opened_at: "2026-09-18T14:00:00Z", closed_at: "2026-09-18T17:30:00Z", odometer_value: 41872, odometer_unit: "mi" });
const VISIT_REACQUIRED = visit("sv-2", VIN_REACQUIRED, { ro_number: "48377", opened_at: "2025-02-11T15:00:00Z", closed_at: "2025-02-11T18:00:00Z", odometer_value: 30410, odometer_unit: "mi", intake_verification: "staff_confirmed" });

const VEHICLES: VehicleLookup[] = [
  {
    vin: VIN_DELIVERED,
    episodes: [ep("ep-1", VIN_DELIVERED, { custody_state: "delivered", status: "disposed", acquired_at: "2025-09-02T00:00:00Z", disposed_at: "2026-01-14T00:00:00Z" })],
    milestones: [ms("m-1", "ep-1", "sold", "2026-01-10T16:00:00Z"), ms("m-2", "ep-1", "awaiting_delivery", "2026-01-11T09:00:00Z"), ms("m-3", "ep-1", "delivered", "2026-01-14T15:00:00Z")],
    visits: [VISIT_DELIVERED],
  },
  {
    vin: VIN_REACQUIRED,
    episodes: [
      ep("ep-2a", VIN_REACQUIRED, { custody_state: "delivered", status: "disposed", acquired_at: "2024-11-05T00:00:00Z", disposed_at: "2025-03-02T00:00:00Z" }),
      ep("ep-2b", VIN_REACQUIRED, { opened_reason: "reacquisition", custody_state: "in_stock", previous_instance_id: "ep-2a", acquired_at: "2026-08-20T00:00:00Z", created_at: "2026-08-20T00:00:00Z" }),
    ],
    milestones: [ms("m-4", "ep-2a", "sold", "2025-02-26T16:00:00Z"), ms("m-5", "ep-2a", "delivered", "2025-03-02T15:00:00Z")],
    visits: [VISIT_REACQUIRED],
  },
  {
    vin: VIN_ARCHIVED,
    episodes: [ep("ep-3", VIN_ARCHIVED, { custody_state: "archived", status: "active", acquired_at: "2026-03-12T00:00:00Z" })],
    milestones: [ms("m-6", "ep-3", "archived", "2026-07-30T12:00:00Z")],
    visits: [],
  },
  {
    vin: VIN_RETURNED,
    episodes: [ep("ep-4", VIN_RETURNED, { custody_state: "delivered", status: "disposed", acquired_at: "2025-06-01T00:00:00Z", disposed_at: "2025-12-09T00:00:00Z" })],
    milestones: [ms("m-7", "ep-4", "delivered", "2025-12-09T15:00:00Z")],
    visits: [],
  },
];

const REVIEWS: ReviewRow[] = [
  { id: "rv-1", vin: VIN_ARCHIVED, prior_instance_id: "ep-3", prior_custody_state: "archived", detected_source: "Inventory feed", detected_at: "2026-10-29T08:15:00Z", status: "open" },
  { id: "rv-2", vin: VIN_RETURNED, prior_instance_id: "ep-4", prior_custody_state: "delivered", detected_source: "Inventory feed", detected_at: "2026-10-30T08:15:00Z", status: "open" },
];

const REPAIRS: RepairRow[] = [
  { id: "ri-1", service_visit_id: "sv-1", vin: VIN_DELIVERED, item: "Front brake pads", severity: "Urgent", status: "approved" },
  { id: "ri-2", service_visit_id: "sv-1", vin: VIN_DELIVERED, item: "Cabin air filter", severity: "Advisory", status: "declined" },
  { id: "ri-3", service_visit_id: "sv-1", vin: VIN_DELIVERED, item: "Wiper blades", severity: "Advisory", status: "deferred" },
  { id: "ri-4", service_visit_id: "sv-1", vin: VIN_DELIVERED, item: "Tire rotation", severity: "Routine", status: "completed" },
  { id: "ri-5", service_visit_id: "sv-1", vin: VIN_DELIVERED, item: "12-volt battery", severity: "Urgent", status: "completed_verified" },
  { id: "ri-6", service_visit_id: "sv-1", vin: VIN_DELIVERED, item: "Rear shock leak", severity: "Advisory", status: "recommended" },
];

const INBOX: InboxRow[] = [
  { id: "ib-1", status: "dead", event_type: "service_visit.closed", vin: VIN_REACQUIRED, producer: "autofilm", received_at: "2026-10-27T13:02:00Z", outcome_code: "apply_failed", attempts: 8 },
  { id: "ib-2", status: "unmatched", event_type: "service_visit.opened", vin: VIN_SERVICE_ONLY, producer: "autofilm", received_at: "2026-10-30T10:41:00Z", outcome_code: "service_only_disabled", attempts: 1 },
  { id: "ib-3", status: "held", event_type: "inspection.completed", vin: VIN_DELIVERED, producer: "autofilm", received_at: "2026-10-31T09:10:00Z", outcome_code: null, attempts: 0 },
];

const QUARANTINE: QuarantineRow[] = [
  { id: "qr-1", raw_vin: VIN_SERVICE_ONLY, reason: "service_only_disabled", source_app: "autofilm", source_ref: "RO 50412", inbox_id: "ib-2", status: "open", created_at: "2026-10-30T10:41:00Z" },
];

const key = (patch: Partial<SettingRow> & Pick<SettingRow, "key" | "value_type" | "consumer" | "policy_status" | "allowed_scopes">): SettingRow => ({
  min_value: null, max_value: null, effective_value: false, source: "safe_default", tenant_version: 0, tenant_value: null, ...patch,
});

const SETTINGS: SettingRow[] = [
  key({ key: "access.prior_owner_keeps_transaction_records", value_type: "boolean", allowed_scopes: ["platform", "tenant"], consumer: "vehicle_history_owner_view", policy_status: "awaiting_approval" }),
  key({ key: "integration.apply_paused", value_type: "boolean", allowed_scopes: ["platform", "tenant"], consumer: "integration_claim_inbox", policy_status: "approved_default" }),
  key({ key: "integration.delivery_paused", value_type: "boolean", allowed_scopes: ["platform", "tenant"], consumer: "integration-dispatch via integration_delivery_allowed", policy_status: "approved_default" }),
  key({ key: "integration.outbound_capture_enabled", value_type: "boolean", allowed_scopes: ["platform", "tenant"], consumer: "vehicle_history_record_milestone (outbox write)", policy_status: "awaiting_approval" }),
  key({ key: "integration.replay_max_batch", value_type: "integer", allowed_scopes: ["platform", "tenant"], consumer: "integration_replay_inbox", policy_status: "awaiting_approval", min_value: 1, max_value: 500, effective_value: 25, source: "platform+tenant", tenant_version: 1, tenant_value: 25 }),
  key({ key: "lifecycle.emergency_hold", value_type: "boolean", allowed_scopes: ["platform", "tenant", "store"], consumer: "vehicle_history_record_milestone, vehicle_history_resolve_reappearance", policy_status: "approved_default" }),
  key({ key: "service.allow_service_only_vehicle", value_type: "boolean", allowed_scopes: ["platform", "tenant"], consumer: "integration_apply_event (vehicle with no custody history at this dealer)", policy_status: "awaiting_approval" }),
  key({ key: "service.attach_enabled", value_type: "boolean", allowed_scopes: ["platform", "tenant", "store"], consumer: "integration_apply_event (service visit path)", policy_status: "awaiting_approval", effective_value: true, source: "tenant", tenant_version: 1, tenant_value: true }),
];

const SNAPSHOT: Snapshot = {
  missing: false,
  counts: { vehicles: 4, vehiclesAtLeast: false, openReturns: 2, awaitingMatch: 3, deadLetters: 1 },
  reviews: REVIEWS,
  visits: [VISIT_DELIVERED, VISIT_REACQUIRED],
  inspections: [{ id: "in-1", service_visit_id: "sv-1", vin: VIN_DELIVERED, inspected_at: "2026-09-18T14:30:00Z", source_app: "autofilm", technician_verified: true }],
  repairs: REPAIRS,
  inbox: INBOX,
  inboxCounts: { received: 3, held: 1, applied: 1284, superseded: 41, stale: 7, conflict: 2, rejected: 5, unmatched: 1, dead: 1 },
  quarantine: QUARANTINE,
  settings: SETTINGS,
  replayCap: 25,
};

const BASE: VehicleRecordsFixture = {
  account: "Synthetic Demo Motors",
  store: null,
  status: "ready",
  canManage: true,
  snapshot: SNAPSHOT,
  vehicles: VEHICLES,
  stockByVin: { [VIN_DELIVERED]: "SD1001", [VIN_REACQUIRED]: "SD1002", [VIN_ARCHIVED]: "SD1003", [VIN_RETURNED]: "SD1004" },
};

const screen = (id: string, fx: VehicleRecordsFixture): AdminScreenFixture => ({
  childPath: ADMIN_CHILD_ROUTES.vehicleRecords,
  fixture: {
    label: `Vehicle records ${id}`,
    now: NOW,
    views: {
      "vehicle-records": fx,
      "al97-copy": {
        "fixture.label": "SYNTHETIC DATA · DESIGN FIXTURE · NOT A LIVE SCREENSHOT",
        "fixture.id": `Vehicle records / ${id}`,
        "vr.synthetic": "Synthetic data: the account, VINs, repair orders and dates on this screen are invented. Try searching 1HGCM82633A004352, 1M8GDM9AXKP042788 or JH4KA7561PC008269.",
      },
    },
  },
});

export const VEHICLE_RECORDS_FIXTURES: Record<string, AdminScreenFixture> = {
  "vehicle-records": screen("ready", BASE),
  "vehicle-records-missing": screen("not installed", { ...BASE, status: "missing", snapshot: null, vehicles: [] }),
  "vehicle-records-error": screen("read failed", { ...BASE, status: "error", snapshot: null }),
  "vehicle-records-readonly": screen("read-only role", { ...BASE, canManage: false }),
};

export { BASE as VEHICLE_RECORDS_BASE, SNAPSHOT as VEHICLE_RECORDS_SNAPSHOT };
