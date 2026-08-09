// Rooftop ownership matching — shared so it can be unit-tested rather than
// only exercised nightly against live inventory.
//
// The problem this solves: a dealer group's rooftops share a state, often share
// a parent domain, and syndicate each other's cars. Neither state nor domain can
// separate "Harte Infiniti" from "Harte Honda". The street address can, because
// it is the one field unique to a physical rooftop.

export interface Rooftop {
  /**
   * MarketCheck's physical retail rooftop id. The narrowest boundary the API
   * exposes and, when known, the decisive one: a row carrying a different
   * rooftop id is another store's car no matter what else matches.
   */
  rooftopId?: string;
  /** Allowed physical location ids for this rooftop (address-level). */
  locationIds?: string[];
  /** Dealer website host, e.g. "harteinfiniti.com". */
  domain: string;
  /** Two-letter state, uppercase. Can only ever disprove ownership. */
  state: string;
  /** Normalized street, e.g. "150 weston st". */
  street: string;
  /** 5-digit ZIP. */
  zip: string;
}

export type Ownership = "match" | "mismatch" | "unknown";

// Feeds spell the same address a dozen ways, so both sides normalize before
// comparison: "150 Weston Street" and "150 Weston St." must be equal.
const STREET_SUFFIX: Record<string, string> = {
  street: "st", avenue: "ave", road: "rd", drive: "dr", boulevard: "blvd",
  lane: "ln", highway: "hwy", parkway: "pkwy", turnpike: "tpke", place: "pl",
  court: "ct", circle: "cir", terrace: "ter", route: "rt", suite: "ste",
  north: "n", south: "s", east: "e", west: "w",
};

export const normStreet = (v: unknown): string =>
  String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_SUFFIX[w] ?? w)
    .join(" ");

export const normZip = (v: unknown): string => String(v || "").replace(/\D/g, "").slice(0, 5);

export const normHost = (v: unknown): string =>
  String(v || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];

export interface ListingIdentity {
  hosts: string[];
  state: string;
  street: string;
  zip: string;
  /** mc_dealership.mc_rooftop_id from the listing, when present. */
  rooftopId?: string;
  /** mc_dealership.mc_location_id from the listing, when present. */
  locationId?: string;
}

/**
 * Decide whether a listing belongs to this rooftop.
 *
 * Order matters. Street+ZIP is decisive in both directions when configured.
 * Domain decides next. State is deliberately one-way: a shared state proves
 * nothing (every sibling shares it) and may only mark a listing as foreign.
 */
export function classifyListing(listing: ListingIdentity, rt: Rooftop): Ownership {
  // 0. Rooftop id — MarketCheck's own physical-store key. Strongest signal
  //    available, and decisive in both directions when both sides carry it.
  if (rt.rooftopId && listing.rooftopId) {
    return listing.rooftopId === rt.rooftopId ? "match" : "mismatch";
  }
  if (rt.locationIds?.length && listing.locationId) {
    if (!rt.locationIds.includes(listing.locationId)) return "mismatch";
  }
  if (rt.street && rt.zip) {
    if (listing.street && listing.zip) {
      return listing.street === rt.street && listing.zip === rt.zip ? "match" : "mismatch";
    }
    if (listing.zip && listing.zip !== rt.zip) return "mismatch";
    if (listing.street && listing.street !== rt.street) return "mismatch";
  }
  if (rt.domain) {
    if (listing.hosts.includes(rt.domain)) return "match";
    if (listing.hosts.length > 0) return "mismatch";
  }
  if (rt.state && listing.state && listing.state !== rt.state) return "mismatch";
  return "unknown";
}

/** True once the address is precise enough to reject anything unproven. */
export const isStrictRooftop = (rt: Rooftop): boolean => !!(rt.rooftopId || (rt.street && rt.zip));

/**
 * Should this listing be written to the tenant's inventory?
 * Under a verified address, only a positive match is ingested — an unproven
 * listing is exactly how a sibling store's car drifts in.
 */
export function shouldIngest(listing: ListingIdentity, rt: Rooftop): boolean {
  const own = classifyListing(listing, rt);
  if (own === "mismatch") return false;
  if (isStrictRooftop(rt)) return own === "match";
  return true;
}

// ── Destructive-step safety ───────────────────────────────────────────
// Prune is the only step that deletes a dealer's cars, so it needs its own
// gates. A wrong or truncated feed must never be able to empty a live lot.

export interface PruneGateInput {
  /** Every page of the feed was fetched, so the live VIN set is the whole lot. */
  feedWalked: boolean;
  /** Cars proven to belong to this rooftop on this run. */
  matched: number;
  /** Distinct live VINs written this run. */
  liveVins: number;
  /** Matched count from the last run that validated cleanly; 0 if never. */
  lastGoodCount: number;
  /** Any write failed this run. */
  writeError: boolean;
}

/**
 * Returns null when pruning is safe, otherwise the reason to skip it.
 *
 * The collapse threshold is deliberately generous: carrying a sold car for an
 * extra day is a cosmetic problem, while deleting a live lot because a feed
 * hiccuped is not recoverable from the dealer's side.
 */
export function prunePreflight(i: PruneGateInput): string | null {
  if (i.writeError) return "write_error";
  if (!i.feedWalked) return "partial_feed";
  if (i.liveVins === 0) return "no_live_vins";
  if (i.lastGoodCount > 0 && i.matched < Math.floor(i.lastGoodCount * 0.6)) {
    return `inventory_collapsed:${i.matched}_vs_${i.lastGoodCount}`;
  }
  return null;
}

// ── Per-segment safety ────────────────────────────────────────────────
//
// The prune reads one undifferentiated live-VIN set, so "the provider stopped
// listing this segment" and "the dealer sold every car in it" arrive as the
// same input. On 2026-08-01 the owned feed stopped returning new units for a
// rooftop; the walk completed, every used car came back, the run reported
// success, and the whole new-car lot was archived.
//
// The fix is not to trust our own ingest count. A segment we accepted nothing
// from is ambiguous — the provider may have had none, or the address gate may
// have rejected every one. Only the provider's OWN reported count separates
// those, and it is the difference between a sell-down and an outage.

/** A car is new, or it is not. CPO is a grade of used, and `is_certified`
 *  flips week to week — that must never read as a segment change. */
export type InventorySegment = "new" | "rest";

export const segmentOf = (condition: unknown): InventorySegment =>
  String(condition ?? "").trim().toLowerCase() === "new" ? "new" : "rest";

export interface SegmentGateInput {
  segment: InventorySegment;
  /** Run-level: every page was fetched. */
  feedWalked: boolean;
  /** Run-level: a write failed somewhere this run. */
  writeError: boolean;
  /**
   * What the PROVIDER said it holds for this segment, from its own num_found.
   * null when we could not ask — which is not the same as zero.
   */
  feedReported: number | null;
  /** Rows of this segment we accepted after the ownership gate. */
  accepted: number;
  /** Non-archived rows of this segment the dealer has right now. */
  priorInventory: number;
}

/**
 * Null when retiring this segment is safe, otherwise the reason to skip it.
 *
 * The invariant, in one line: a segment may only be retired by a run that
 * positively observed it. Absence is never evidence of a sale.
 */
export function segmentPrunePreflight(i: SegmentGateInput): string | null {
  if (i.writeError) return "write_error";
  if (!i.feedWalked) return "partial_feed";

  // We could not ask the provider what it holds, so we cannot tell an empty
  // segment from an unasked one. Fail closed.
  if (i.feedReported === null && i.accepted === 0) {
    return `segment_unverified:${i.segment}`;
  }

  // The provider says it has cars here and we kept none of them. That is our
  // ownership gate rejecting them, not the dealer selling them.
  if (i.feedReported !== null && i.feedReported > 0 && i.accepted === 0) {
    return `segment_all_rejected:${i.segment}:0_of_${i.feedReported}`;
  }

  // A provider that reports zero for a segment the dealer still stocks is the
  // 2026-08-01 shape exactly. A genuine sell-down reaches zero stocked too, so
  // this only blocks while the dealer still has cars on the ground.
  if (i.accepted === 0 && i.priorInventory > 0) {
    return `segment_vanished:${i.segment}:0_vs_${i.priorInventory}`;
  }

  return null;
}
