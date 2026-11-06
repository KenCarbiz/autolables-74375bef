export interface ExistingListing {
  id: string;
  status: string | null;
  archived_at?: string | null;
  archive_reason?: string | null;
}

export type ListingWritePlan = "insert" | "update" | "hold_archived";

// draft, pending, active and published are the current statuses a feed may refresh.
// archived, sold and expired are retired, and so is any row carrying archived_at.
const CURRENT_STATUSES = new Set(["draft", "pending", "active", "published"]);

export function planListingWrite(existing: ExistingListing | null): ListingWritePlan {
  if (!existing) return "insert";
  if (existing.archived_at) return "hold_archived";
  if (!CURRENT_STATUSES.has(String(existing.status ?? "").toLowerCase())) return "hold_archived";
  return "update";
}

export interface HeldVehicle {
  vin: string;
  reason: "archived_listing_requires_review";
  review_id: string | null;
}
