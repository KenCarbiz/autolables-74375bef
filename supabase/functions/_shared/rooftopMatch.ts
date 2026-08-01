// Rooftop ownership matching — shared so it can be unit-tested rather than
// only exercised nightly against live inventory.
//
// The problem this solves: a dealer group's rooftops share a state, often share
// a parent domain, and syndicate each other's cars. Neither state nor domain can
// separate "Harte Infiniti" from "Harte Honda". The street address can, because
// it is the one field unique to a physical rooftop.

export interface Rooftop {
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
}

/**
 * Decide whether a listing belongs to this rooftop.
 *
 * Order matters. Street+ZIP is decisive in both directions when configured.
 * Domain decides next. State is deliberately one-way: a shared state proves
 * nothing (every sibling shares it) and may only mark a listing as foreign.
 */
export function classifyListing(listing: ListingIdentity, rt: Rooftop): Ownership {
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
export const isStrictRooftop = (rt: Rooftop): boolean => !!(rt.street && rt.zip);

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
