// ──────────────────────────────────────────────────────────────────────
// Which manufacturer documents this dealer may still take a copy of, and
// when it is worth asking again.
//
// The franchise rule itself is not here and never will be: it lives in
// tenant_may_host_oem_documents / record_oem_distribution, which decide from
// the dealer's own new-vehicle inventory and write the evidence row that
// authorises a stored copy. This module only chooses a WORKLIST — which
// (tenant, brand, model, year, kind) combinations are worth spending a claim
// and a download on — and it filters to the tenant's derived franchise brands
// first so an off-brand car never even reaches the gate.
//
// Two failure directions, and they are not symmetric. Building too small a
// worklist means a franchised dealer keeps linking to a manufacturer site
// that may reorganise; building too large a one means re-downloading a 40 MB
// manual every night for a model whose PDF will never arrive. So every
// non-answer is written to oem_document_copy_attempts and read back here.
// ──────────────────────────────────────────────────────────────────────

import { oemDocKeyFromYmm } from "./oemDocKey.ts";

export type OemCopyKind = "owners_manual" | "brochure";

export const OEM_COPY_KINDS: readonly OemCopyKind[] = ["owners_manual", "brochure"];

/**
 * Every terminal state of one copy attempt. Mirrors the CHECK constraint on
 * oem_document_copy_attempts.outcome — the two lists have to agree or a write
 * fails at runtime, where nothing type-checks it.
 */
export type OemCopyOutcome =
  | "stored"
  | "already_stored"
  | "not_franchised"
  | "link_missing"
  | "source_unreachable"
  | "not_a_pdf"
  | "too_large"
  | "store_failed";

export const OEM_COPY_OUTCOMES: readonly OemCopyOutcome[] = [
  "stored", "already_stored", "not_franchised", "link_missing",
  "source_unreachable", "not_a_pdf", "too_large", "store_failed",
];

/** Outcomes that mean the document is in hand. Nothing re-asks after one. */
export const OEM_COPY_SETTLED: readonly OemCopyOutcome[] = ["stored", "already_stored"];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long to wait before asking again, per outcome.
 *
 * link_missing is the short one on purpose: it means the model's manufacturer
 * link has not been harvested YET, which is the ordinary state of the first
 * car of a model — the link harvest is still in flight while ingest runs. It
 * is the single most common reason a franchised dealer has no stored copy, and
 * it usually resolves itself overnight.
 *
 * not_a_pdf is the long one: it means the manufacturer served HTML, which is
 * almost always a bot wall or a viewer page rather than a document. Retrying
 * that nightly is a download that can only fail the same way.
 */
export const OEM_COPY_RETRY_DAYS: Record<OemCopyOutcome, number> = {
  stored: Number.POSITIVE_INFINITY,
  already_stored: Number.POSITIVE_INFINITY,
  // A dealer can win a franchise, so this is re-asked — monthly, not nightly.
  not_franchised: 30,
  link_missing: 2,
  source_unreachable: 2,
  not_a_pdf: 14,
  // A 60 MB manual does not get smaller by waiting. Only an explicit force
  // (or a raised cap, which is a deploy) re-opens this one.
  too_large: Number.POSITIVE_INFINITY,
  store_failed: 1,
};

/** Tries per combination, ever. Past this the ledger row is the answer. */
export const OEM_COPY_MAX_ATTEMPTS = 5;

export interface OemCopyAttemptRow {
  tenant_id: string;
  brand_key: string;
  model_key: string;
  year_key: number;
  document_kind: string;
  outcome: string;
  attempts?: number | null;
  last_attempt_at?: string | null;
}

export interface OemCopyPolicyOptions {
  now?: number;
  force?: boolean;
  maxAttempts?: number;
}

/**
 * Is another copy attempt worth making for this combination?
 *
 * An unreadable timestamp answers NO. The alternative reading — "we cannot
 * tell how long ago this failed, so try again" — turns one corrupt row into a
 * nightly download of the same file forever.
 */
export function shouldAttemptCopy(
  attempt: OemCopyAttemptRow | undefined,
  opts: OemCopyPolicyOptions = {},
): boolean {
  const { now = Date.now(), force = false, maxAttempts = OEM_COPY_MAX_ATTEMPTS } = opts;
  if (force) return true;
  if (!attempt) return true;

  const outcome = attempt.outcome as OemCopyOutcome;
  const waitDays = OEM_COPY_RETRY_DAYS[outcome];
  // An outcome this build does not know about is treated as settled rather
  // than as an invitation: a newer deploy wrote it, and guessing is spend.
  if (waitDays === undefined) return false;
  if (!Number.isFinite(waitDays)) return false;
  if ((attempt.attempts ?? 0) >= maxAttempts) return false;

  const last = Date.parse(attempt.last_attempt_at || "");
  if (!Number.isFinite(last)) return false;
  return now - last >= waitDays * DAY_MS;
}

/** The ledger's own key. Mirrors uq_oem_document_copy_attempts exactly. */
export function copyAttemptKey(
  tenantId: string, brand: string, model: string, year: number | null, kind: OemCopyKind,
): string {
  return [
    tenantId,
    brand.trim().toLowerCase(),
    model.trim().toLowerCase(),
    year ?? 0,
    kind,
  ].join("|");
}

export interface OemCopyListingRow {
  id: string;
  tenant_id: string;
  vin: string;
  ymm: string | null;
}

export interface OemHostedRow {
  tenant_id: string;
  brand: string;
  model: string;
  model_year: number | null;
  document_kind: string;
}

export interface OemCopyTarget {
  tenantId: string;
  /** One VIN of the model — the claim is per vehicle, the copy is per model. */
  vin: string;
  listingId: string | null;
  brand: string;
  model: string;
  year: number | null;
  kind: OemCopyKind;
  /** Cars on the lot this one copy would serve. Drives the ordering. */
  vehicleCount: number;
}

export interface OemCopySelectionOptions {
  /** Brands each tenant demonstrably holds a new-vehicle franchise for,
   *  lower-cased. A tenant absent from the map has no franchise on record and
   *  contributes nothing: every one of its cars links, which needs no copy. */
  franchiseBrands: Map<string, Set<string>>;
  hosted: readonly OemHostedRow[];
  attempts: readonly OemCopyAttemptRow[];
  kinds?: readonly OemCopyKind[];
  now?: number;
  force?: boolean;
}

const hostedKey = (tenantId: string, brand: string, model: string, year: number | null, kind: string) =>
  [tenantId, brand.trim().toLowerCase(), model.trim().toLowerCase(), year ?? 0, kind].join("|");

/**
 * The copies worth attempting, most-used model first.
 *
 * Order of the filters is the whole design:
 *
 *   1. a ymm that cannot produce the key the passport looks documents up by is
 *      dropped — storing under a key nothing queries is pure cost;
 *   2. the brand must be one the tenant is franchised for. This is the
 *      licensing rule, applied before anything is claimed or fetched: an
 *      off-brand car is a LINK, and a link needs no bytes and no permission;
 *   3. a copy already held is skipped, which is what makes a re-run free;
 *   4. the ledger's verdict is honoured, which is what makes a failure
 *      bounded instead of nightly.
 */
export function buildCopyTargets(
  listings: readonly OemCopyListingRow[],
  opts: OemCopySelectionOptions,
): OemCopyTarget[] {
  const { franchiseBrands, hosted, attempts, kinds = OEM_COPY_KINDS, now = Date.now(), force = false } = opts;

  const held = new Set(hosted.map((h) =>
    hostedKey(h.tenant_id, h.brand, h.model, h.model_year ?? null, h.document_kind)));
  const attemptIndex = new Map<string, OemCopyAttemptRow>();
  for (const a of attempts) {
    attemptIndex.set(
      [a.tenant_id, String(a.brand_key).toLowerCase(), String(a.model_key).toLowerCase(), a.year_key ?? 0, a.document_kind].join("|"),
      a,
    );
  }

  const grouped = new Map<string, OemCopyTarget>();
  for (const listing of listings) {
    const key = oemDocKeyFromYmm(listing.ymm);
    if (!key || !listing.tenant_id || !listing.vin) continue;
    const brands = franchiseBrands.get(listing.tenant_id);
    if (!brands || !brands.has(key.make.trim().toLowerCase())) continue;

    for (const kind of kinds) {
      const id = copyAttemptKey(listing.tenant_id, key.make, key.model, key.year, kind);
      const existing = grouped.get(id);
      if (existing) { existing.vehicleCount++; continue; }
      if (held.has(hostedKey(listing.tenant_id, key.make, key.model, key.year, kind))) continue;
      if (!shouldAttemptCopy(attemptIndex.get(id), { now, force })) continue;
      grouped.set(id, {
        tenantId: listing.tenant_id,
        vin: listing.vin,
        listingId: listing.id ?? null,
        brand: key.make,
        model: key.model,
        year: key.year,
        kind,
        vehicleCount: 1,
      });
    }
  }

  return [...grouped.values()].sort(
    (a, b) => b.vehicleCount - a.vehicleCount
      || a.brand.localeCompare(b.brand)
      || a.model.localeCompare(b.model)
      || a.kind.localeCompare(b.kind),
  );
}

export interface OemLinkCatalogRow {
  url: string;
  year: number | null;
}

/**
 * The manufacturer link that serves this model year.
 *
 * Deliberately the same pick as public-listing-view and
 * intake-autoprovision's cache read: exact model year, then within two model
 * years, then a year-less row. A different rule here would store a copy the
 * passport does not serve, or refuse one it does.
 */
export function pickCopySourceUrl(
  rows: readonly OemLinkCatalogRow[], year: number | null,
): string | null {
  if (!rows.length) return null;
  const pick = (year != null ? rows.find((r) => r.year === year) : rows[0])
    || rows.find((r) => r.year != null && year != null && Math.abs(r.year - year) <= 2)
    || rows.find((r) => r.year == null)
    || null;
  const url = pick?.url?.trim();
  return url && /^https:\/\//i.test(url) ? url : null;
}

/** Plain-language account of a ledger row, for the Vehicle File and support. */
export function explainCopyOutcome(outcome: string, kind: OemCopyKind): string {
  const doc = kind === "brochure" ? "brochure" : "owner's manual";
  switch (outcome as OemCopyOutcome) {
    case "stored":
    case "already_stored":
      return `A copy of the ${doc} is stored for this dealership, so the packet keeps working if the manufacturer moves the file.`;
    case "not_franchised":
      return `This dealership is not franchised for this brand, so the packet links to the manufacturer's ${doc} instead of serving a copy.`;
    case "link_missing":
      return `No manufacturer ${doc} link has been found for this model yet, so there is nothing to copy. The nightly sweep retries.`;
    case "source_unreachable":
      return `The manufacturer's ${doc} could not be downloaded. The packet still links to it, and the nightly sweep retries.`;
    case "not_a_pdf":
      return `The manufacturer returned a web page rather than a ${doc} PDF, so nothing was stored. The packet still links to it.`;
    case "too_large":
      return `The manufacturer's ${doc} is larger than this dealership stores, so the packet links to it instead.`;
    case "store_failed":
      return `The ${doc} was downloaded but could not be filed. The nightly sweep retries.`;
    default:
      return `No copy of the ${doc} is stored for this dealership; the packet links to the manufacturer.`;
  }
}

// ── Sweep budgets ─────────────────────────────────────────────────────
//
// The reconciliation pass downloads real documents — tens of megabytes each,
// over somebody else's CDN — so its ceiling is wall-clock and file count, not
// provider spend. Small on purpose: the backlog drains over nights, and a
// dealer's fleet is a fixed number of model-years, so the work trends to zero.

export const OEM_COPY_LOCK_KEY = "oem-document-copy-sweep";
export const OEM_COPY_LOCK_TTL_SECONDS = 20 * 60;
export const OEM_COPY_SWEEP_BUDGET_MS = 240_000;
export const DEFAULT_COPY_STORE_LIMIT = 8;
export const MAX_COPY_STORE_LIMIT = 40;
