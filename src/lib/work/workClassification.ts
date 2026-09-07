// My Work classification.
//
// dealer_work_items mixes two different things under one table: tasks a person
// owns, and events the system recorded. Production carries 883 open rows, every
// one of them source='vehicle_exception', none assigned to anybody, and 467
// about vehicles no longer on the lot. Counting that as "work" is what produced
// a permanent 99+ badge nobody could ever clear.
//
// This module is the single place that decides which lane a row belongs in and
// what a person should read. Kept free of React and Supabase so the rules are
// testable on their own.

export type WorkLane = "needs_me" | "team" | "waiting" | "system_exception" | "completed";

export interface WorkItemLike {
  status?: string | null;
  source?: string | null;
  work_type?: string | null;
  assigned_to?: string | null;
  due_at?: string | null;
  /** Whether the row's vehicle is still active inventory. */
  vehicleActive?: boolean;
}

/** A row the system generated about itself, rather than a task someone owns. */
export function isSystemException(item: WorkItemLike): boolean {
  return (item.source || "") === "vehicle_exception"
    || (item.work_type || "").startsWith("exception_");
}

export function classifyWorkItem(item: WorkItemLike, currentUserId?: string | null): WorkLane {
  const status = (item.status || "").toLowerCase();
  if (status === "completed" || status === "cancelled") return "completed";
  if (isSystemException(item)) return "system_exception";
  if (item.assigned_to && currentUserId && item.assigned_to === currentUserId) return "needs_me";
  if (item.assigned_to) return "team";
  // Unassigned human work is nobody's yet: it waits for an owner rather than
  // silently counting against the signed-in person.
  return "waiting";
}

/**
 * Actionable open work for a navigation badge (spec 84).
 *
 * System exceptions are excluded: they are records of what happened, not work
 * a person can pick up. Exceptions about vehicles that have left the lot are
 * excluded twice over.
 */
export function isActionableHumanWork(item: WorkItemLike): boolean {
  const status = (item.status || "").toLowerCase();
  if (status !== "open" && status !== "in_progress" && status !== "needs_approval") return false;
  return !isSystemException(item);
}

/** Exceptions still worth showing: the vehicle is still here. */
export function isLiveException(item: WorkItemLike): boolean {
  const status = (item.status || "").toLowerCase();
  if (status !== "open" && status !== "needs_approval") return false;
  return isSystemException(item) && item.vehicleActive === true;
}

export interface ExceptionCopy {
  /** What a person reads first. Never the raw work_type. */
  label: string;
  /** Why it is here, in one line. */
  why: string;
  /** The verb that clears it, or null when there is nothing to do. */
  nextAction: string | null;
}

// Operational language, not engineering wording (spec 30, 69). The raw
// work_type stays available for diagnostics; it is never the primary label.
const COPY: Record<string, ExceptionCopy> = {
  exception_removed_from_feed: {
    label: "Vehicle left the feed",
    why: "The dealer feed stopped listing this VIN, usually because it sold.",
    nextAction: null,
  },
  exception_artifact_autogen_failed: {
    label: "Document could not be generated",
    why: "An automatic document build did not finish for this vehicle.",
    nextAction: "Retry document",
  },
  exception_new_vehicle: {
    label: "New vehicle arrived",
    why: "First time this VIN appeared in the feed.",
    nextAction: "Review vehicle",
  },
  exception_price_change: {
    label: "Price changed",
    why: "The advertised price moved since the last sync.",
    nextAction: "Review price",
  },
  exception_relisted: {
    label: "Vehicle relisted",
    why: "This VIN returned to the feed after being removed.",
    nextAction: "Review vehicle",
  },
  exception_missing_required_field: {
    label: "Missing required information",
    why: "The feed did not supply a field the sticker needs.",
    nextAction: "Add missing detail",
  },
  exception_certification_change: {
    label: "Certification changed",
    why: "The vehicle's CPO status changed in the feed.",
    nextAction: "Review certification",
  },
  exception_mileage_change: {
    label: "Mileage changed",
    why: "Reported odometer moved since the last sync.",
    nextAction: "Review mileage",
  },
  exception_description_review: {
    label: "Description needs review",
    why: "A validator flagged a claim in this vehicle's description.",
    nextAction: "Review facts",
  },
  exception_stock_number_change: {
    label: "Stock number changed",
    why: "The dealer feed reassigned this vehicle's stock number.",
    nextAction: "Review vehicle",
  },
};

/**
 * Human-readable copy for an exception. Unknown types degrade to a de-slugged
 * label rather than leaking `exception_artifact_autogen_failed` onto a screen.
 */
export function exceptionCopy(workType: string | null | undefined): ExceptionCopy {
  const key = (workType || "").trim();
  if (COPY[key]) return COPY[key];
  const words = key.replace(/^exception_/, "").replace(/_/g, " ").trim();
  return {
    label: words ? words.charAt(0).toUpperCase() + words.slice(1) : "System exception",
    why: "Recorded automatically while syncing this vehicle.",
    nextAction: null,
  };
}

export const WORK_LANES: { key: WorkLane; label: string; empty: string }[] = [
  { key: "needs_me", label: "Needs me", empty: "You're caught up." },
  { key: "team", label: "Team", empty: "Nothing assigned to your team right now." },
  { key: "waiting", label: "Waiting", empty: "Nothing is waiting for an owner." },
  { key: "system_exception", label: "System exceptions", empty: "No open exceptions on current inventory." },
  { key: "completed", label: "Completed", empty: "Nothing completed yet." },
];
