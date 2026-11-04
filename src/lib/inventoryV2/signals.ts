import { deriveRecallView, type RecallRowInput } from "@/lib/vehicleTruth/recallView";
import { classifyCondition, familyForDocumentType, type DocumentFamilyId } from "@/lib/documents/families";

// Per-vehicle signals for the /inventory-v2 draft. Every count, tab, queue
// and badge on that page reads these predicates so a tile can never claim a
// number its filtered list does not show.

export type StickerState = "present" | "missing" | "unknown";
export type RecallState = "clear" | "open" | "unknown";

export interface StickerDoc { vehicle_id: string; document_type: string | null; document_status: string | null }

const DEAD_STATUSES = new Set(["rejected", "archived", "superseded", "voided"]);

/** The window-sticker family this vehicle needs, or null when condition is unresolved. */
export const stickerFamilyFor = (condition: string | null | undefined): DocumentFamilyId | null => {
  const cls = classifyCondition(condition);
  if (cls === "new") return "oem_window_sticker_reproduction";
  if (cls === "used" || cls === "cpo") return "used_vehicle_window_sticker";
  return null;
};

/**
 * "missing" only when the tenant-scoped document read succeeded, the
 * vehicle's condition decides which sticker it needs, and no live document
 * of that family exists. Anything less is "unknown", never "missing".
 */
export function stickerStateOf(
  condition: string | null | undefined,
  docsLoaded: boolean,
  docs: StickerDoc[] | undefined,
): StickerState {
  const family = stickerFamilyFor(condition);
  if (!docsLoaded || !family) return "unknown";
  const has = (docs || []).some((d) =>
    !DEAD_STATUSES.has(String(d.document_status || "").toLowerCase()) &&
    familyForDocumentType(d.document_type, condition)?.id === family);
  return has ? "present" : "missing";
}

export interface SignalRow extends RecallRowInput {
  ymm: string | null;
  price: number | null;
  status: string;
}

export interface VehicleSignal {
  decoded: boolean;
  hasAddendum: boolean;
  hasPrice: boolean;
  published: boolean;
  recall: RecallState;
  openRecall: boolean;
  recallClear: boolean;
  sticker: StickerState;
  /** Fraction of readiness checks that are positively satisfied. Unknown earns nothing. */
  score: number;
  readyToPublish: boolean;
  /** A draft with a known blocker: undecoded VIN, missing addendum or an open recall. */
  blocked: boolean;
}

export function signalOf(r: SignalRow, hasAddendum: boolean, sticker: StickerState): VehicleSignal {
  const rv = deriveRecallView(r);
  const openRecall = rv.riskSignalled;
  const recallClear = !openRecall && rv.vin.clearClaimAllowed;
  const recall: RecallState = openRecall ? "open" : recallClear ? "clear" : "unknown";
  const decoded = !!r.ymm;
  const hasPrice = r.price != null;
  const published = r.status === "published";
  const checks = [decoded, hasAddendum, recallClear, hasPrice];
  const score = checks.filter(Boolean).length / checks.length;
  return {
    decoded, hasAddendum, hasPrice, published, recall, openRecall, recallClear, sticker, score,
    readyToPublish: !published && checks.every(Boolean),
    blocked: !published && (!decoded || !hasAddendum || openRecall),
  };
}

export type QueueId =
  | "all" | "new" | "used" | "cpo" | "published" | "draft"
  | "ready" | "blocked" | "needs_sticker" | "missing_addendum" | "price_review"
  | "open_recalls" | "recall_unknown" | "vin_issues" | "attention";

export const queueMatches = (
  id: QueueId,
  r: { condition: string | null; status: string },
  s: VehicleSignal,
  priceReview: boolean,
): boolean => {
  switch (id) {
    case "all": return true;
    case "new": return r.condition === "new";
    case "used": return r.condition === "used";
    case "cpo": return r.condition === "cpo";
    case "published": return s.published;
    case "draft": return !s.published;
    case "ready": return s.readyToPublish;
    case "blocked": return s.blocked;
    case "needs_sticker": return s.sticker === "missing";
    case "missing_addendum": return !s.hasAddendum;
    case "price_review": return priceReview;
    case "open_recalls": return s.openRecall;
    case "recall_unknown": return s.recall === "unknown";
    case "vin_issues": return !s.decoded;
    case "attention": return s.blocked || s.openRecall || (s.published && !s.hasAddendum);
  }
};
