export type RepairStatus = "recommended" | "approved" | "declined" | "deferred" | "completed" | "completed_verified";
export type ChipTone = "neutral" | "green" | "amber" | "red" | "blue";
export interface LabelChip { label: string; tone: ChipTone }

export const REPAIR_LABELS: Readonly<Record<RepairStatus, string>> = {
  recommended: "Recommended",
  approved: "Customer authorized (not yet performed)",
  declined: "Declined - still open",
  deferred: "Deferred - still open",
  completed: "Completed (not independently verified)",
  completed_verified: "Completed and verified",
};

const REPAIR_TONES: Readonly<Record<RepairStatus, ChipTone>> = {
  recommended: "blue",
  approved: "blue",
  declined: "amber",
  deferred: "amber",
  completed: "neutral",
  completed_verified: "green",
};

const UNKNOWN_CHIP: LabelChip = { label: "Unknown status", tone: "neutral" };

export function repairChip(status: string | null | undefined): LabelChip {
  if (status && status in REPAIR_LABELS) return { label: REPAIR_LABELS[status as RepairStatus], tone: REPAIR_TONES[status as RepairStatus] };
  return UNKNOWN_CHIP;
}

export const CUSTODY_LABELS: Readonly<Record<string, string>> = {
  in_stock: "In stock",
  sold: "Sold",
  awaiting_delivery: "Sold, awaiting delivery",
  delivered: "Delivered",
  transferred_out: "Transferred out",
  archived: "Archived",
};

export function custodyLabel(state: string | null | undefined): string {
  return (state && CUSTODY_LABELS[state]) || "Unknown state";
}

export function custodyChip(state: string | null | undefined): LabelChip {
  if (!state || !(state in CUSTODY_LABELS)) return UNKNOWN_CHIP;
  const tone: ChipTone = state === "in_stock" ? "blue" : state === "archived" ? "amber" : "neutral";
  return { label: CUSTODY_LABELS[state], tone };
}

export const OPENED_REASON_LABELS: Readonly<Record<string, string>> = {
  initial: "First time in stock",
  reacquisition: "Reacquired",
  restore: "Restored from archive",
  transfer_in: "Transferred in",
  backfill: "Backfilled from earlier records",
};

export const openedReasonLabel = (reason: string | null | undefined): string => (reason && OPENED_REASON_LABELS[reason]) || "Unknown reason";

export const MILESTONE_LABELS: Readonly<Record<string, string>> = {
  sold: "Marked sold",
  awaiting_delivery: "Awaiting delivery",
  delivered: "Delivered to customer",
  sale_voided: "Sale voided",
  delivery_corrected: "Delivery date corrected",
  transferred_out: "Transferred out",
  archived: "Archived",
  restored: "Restored from archive",
};

export const milestoneLabel = (m: string | null | undefined): string => (m && MILESTONE_LABELS[m]) || "Unknown event";

export type LifecycleLane = "Inventory" | "Service" | "Ownership";

const OWNERSHIP_MILESTONES = new Set(["sold", "awaiting_delivery", "delivered", "sale_voided", "delivery_corrected", "transferred_out"]);

export const laneForMilestone = (m: string): LifecycleLane => (OWNERSHIP_MILESTONES.has(m) ? "Ownership" : "Inventory");

export type ReappearanceDecision = "restore_episode" | "new_episode" | "wrong_store_mapping" | "reject_source" | "keep_quarantined";

export interface DecisionCopy { label: string; description: string }

export const NO_SIDE_EFFECTS = "No listing is published, merged or deleted. No customer access is granted.";

export const DECISIONS: Readonly<Record<ReappearanceDecision, DecisionCopy>> = {
  restore_episode: {
    label: "Restore archived episode",
    description: "Reopens the archived custody episode so the vehicle continues the same stay. Only an archived episode can be restored.",
  },
  new_episode: {
    label: "Start new episode (reacquisition)",
    description: "Keeps the earlier episode as it is and opens a new, linked episode for a vehicle the store has acquired again.",
  },
  wrong_store_mapping: {
    label: "Wrong store mapping",
    description: "Records that the source placed this vehicle at the wrong store. No custody episode is opened.",
  },
  reject_source: {
    label: "Reject source",
    description: "Records that the feed or source that reported this vehicle should not be trusted for it. No custody episode is opened.",
  },
  keep_quarantined: {
    label: "Keep in review",
    description: "Records your note and leaves the review open for a later decision.",
  },
};

export const DECISION_ORDER: readonly ReappearanceDecision[] = ["restore_episode", "new_episode", "wrong_store_mapping", "reject_source", "keep_quarantined"];

export function restoreBlockedReason(priorCustodyState: string | null | undefined): string | null {
  if (priorCustodyState === "archived") return null;
  if (!priorCustodyState) return "Restore needs an archived prior episode, and this review has none. Start a new episode instead.";
  return `Restore is only for an archived episode. The prior episode is ${custodyLabel(priorCustodyState).toLowerCase()}, so a return is a new episode.`;
}

export const MIN_REASON_LENGTH = 5;
export const reasonOk = (reason: string): boolean => reason.trim().length >= MIN_REASON_LENGTH;

export function isMissingRelation(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883") return true;
  return /does not exist|could not find the (table|function)/i.test(error.message ?? "");
}

export const NOT_INSTALLED_BANNER = "Not installed in this environment: the vehicle history migration is proposed and has not been applied.";

export function countLabel(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "Unknown";
}

export const INBOX_STATUS_LABELS: Readonly<Record<string, string>> = {
  received: "Received",
  held: "Held",
  applied: "Applied",
  superseded: "Superseded",
  stale: "Stale",
  conflict: "Conflict",
  rejected: "Rejected",
  unmatched: "Unmatched",
  dead: "Dead letter",
};

export const inboxStatusLabel = (s: string): string => INBOX_STATUS_LABELS[s] ?? "Unknown status";

export const REPLAYABLE_INBOX = new Set(["dead", "unmatched"]);

export const QUARANTINE_REASON_LABELS: Readonly<Record<string, string>> = {
  vin_format: "VIN format invalid",
  vin_check_digit: "VIN check digit invalid",
  vin_conflict: "VIN conflict",
  store_mismatch: "Store mismatch",
  ro_conflict: "Repair order conflict",
  service_visit_vin_conflict: "Service visit VIN conflict",
  unknown_vehicle: "Unknown vehicle",
  service_only_disabled: "Service-only vehicles are off",
  other: "Other",
};

export const quarantineReasonLabel = (r: string): string => QUARANTINE_REASON_LABELS[r] ?? "Unknown reason";

export const INTAKE_LABELS: Readonly<Record<string, string>> = {
  verified_ro: "Verified repair order",
  connection_attested: "Attested by the connection",
  staff_confirmed: "Confirmed by staff",
  unverified: "Not verified",
};

export const intakeLabel = (s: string | null | undefined): string => (s && INTAKE_LABELS[s]) || "Not verified";

export const SETTING_LABELS: Readonly<Record<string, string>> = {
  "lifecycle.emergency_hold": "Lifecycle emergency hold",
  "service.attach_enabled": "Attach service visits to vehicles",
  "service.allow_service_only_vehicle": "Allow vehicles that were never in stock",
  "integration.apply_paused": "Pause applying incoming events",
  "integration.delivery_paused": "Pause outgoing deliveries",
  "integration.outbound_capture_enabled": "Capture outgoing events",
  "integration.replay_max_batch": "Largest replay batch",
  "access.prior_owner_keeps_transaction_records": "Prior owner keeps transaction records",
};

export const settingLabel = (key: string): string => SETTING_LABELS[key] ?? key;

export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  safe_default: "Built-in safe default",
  platform: "Platform",
  tenant: "This account",
  store: "Store",
};

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "Unknown";
  return source.split("+").map((s) => SOURCE_LABELS[s] ?? s).join(" + ");
}

export type SettingErrorKind =
  | "version_conflict" | "exceeds_parent_cap" | "not_authorized" | "reason_required" | "value_out_of_bounds" | "emergency_hold"
  | "replay_batch_exceeds_cap" | "replay_scope_mismatch" | "review_not_open" | "restore_requires_archived_episode" | "active_episode_exists" | "other";

const ERROR_KINDS = [
  "version_conflict", "exceeds_parent_cap", "not_authorized", "reason_required", "value_out_of_bounds", "emergency_hold",
  "replay_batch_exceeds_cap", "replay_scope_mismatch", "review_not_open", "restore_requires_archived_episode", "active_episode_exists",
] as const;

export function classifyRpcError(error: { message?: string | null } | null | undefined): SettingErrorKind {
  const m = error?.message ?? "";
  for (const k of ERROR_KINDS) {
    if (m.includes(k)) return k;
  }
  return "other";
}

const RPC_MESSAGES: Readonly<Record<SettingErrorKind, string>> = {
  version_conflict: "Someone changed this setting; reload to see the current value.",
  exceeds_parent_cap: "A store or account cannot raise this value past the platform limit.",
  not_authorized: "You are not authorized to change this. Ask an owner or admin of this account.",
  reason_required: "Enter a reason of at least 5 characters.",
  value_out_of_bounds: "That value is outside the allowed range for this setting.",
  emergency_hold: "An emergency hold is on, so lifecycle decisions are paused.",
  replay_batch_exceeds_cap: "That batch is larger than the replay limit. Select fewer rows.",
  replay_scope_mismatch: "Only dead-letter and unmatched rows for this account can be replayed. Reload to see their current state.",
  review_not_open: "This return was already decided. Reload to see the current state.",
  restore_requires_archived_episode: "Only an archived episode can be restored. Start a new episode instead.",
  active_episode_exists: "This vehicle already has an active episode, so a new one cannot be started.",
  other: "The change was not saved. Try again, or reload to see the current state.",
};

export const rpcErrorMessage = (error: { message?: string | null } | null | undefined): string => RPC_MESSAGES[classifyRpcError(error)];
