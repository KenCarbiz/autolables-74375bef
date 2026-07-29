// One question, one answer: may this dealer serve OUR copy of this
// manufacturer's documents, or do we hand the shopper a link?
//
// Linking needs no permission. Hosting the bytes is redistribution, and that
// right belongs to the franchised dealer for their own brand. An INFINITI
// store may serve INFINITI manuals for the INFINITI it is selling; the used
// Honda beside it links out, and so does a used INFINITI sitting on a Honda
// lot -- even when we already hold that exact PDF for another dealer.
// POSSESSION IS NOT PERMISSION, and this module never takes the presence of a
// stored file as an input.
//
// The permission is DERIVED, never asked for. New-vehicle franchises are
// exclusive, so new inventory of a brand is the evidence that the dealer holds
// that franchise. There is no dealer-facing switch: not one to turn hosting
// on, because the franchise is not ours to give, and not one to turn it off,
// because it is not theirs to refuse.
//
// DEFAULT DENY, and specifically: an UNKNOWN answer is a denial. A caller that
// could not load the derivation must fall through to linking, because "we
// could not check" and "we are allowed" are not the same sentence.

import { resolveOemBrand } from "@/components/brand/OemLogoRegistry";

export type DocumentDelivery = "host" | "link";

/** A brand this tenant demonstrably holds a new-vehicle franchise for. */
export interface OemFranchiseBrand {
  brand: string;
  new_units?: number | null;
  latest_listed_at?: string | null;
}

/** A platform-level takedown. tenant_id null blocks the brand everywhere. */
export interface OemDistributionBlock {
  tenant_id: string | null;
  brand: string;
  reason?: string | null;
}

/** The grant key for a make. Falls back to the cleaned string for a brand
 *  outside the registry, so a new marque still resolves consistently. */
export function grantBrandKey(make?: string | null): string {
  const resolved = resolveOemBrand(make);
  if (resolved) return resolved;
  return String(make ?? "").trim().toLowerCase();
}

export interface DeliveryQuery {
  /** The vehicle's make, free text off the listing. */
  make?: string | null;
  tenantId?: string | null;
  /** Derived franchises. Pass null when they could not be loaded. */
  franchises?: OemFranchiseBrand[] | null;
  /** Active takedowns. Pass null when they could not be loaded. */
  blocks?: OemDistributionBlock[] | null;
}

/**
 * Whether a vehicle's OEM documents may be hosted for this dealer.
 *
 * Returns "link" for everything that is not an explicit derived franchise for
 * this exact brand with no block against it.
 */
export function documentDeliveryFor(q: DeliveryQuery): DocumentDelivery {
  // Blocks default to [] but franchises do not: a missing takedown list is
  // safe to read as "none", while a missing franchise list must not be read
  // as "granted".
  if (!q.franchises || !q.tenantId) return "link";
  const brand = grantBrandKey(q.make);
  if (!brand) return "link";

  const franchised = q.franchises.some(
    (f) => String(f.brand ?? "").trim().toLowerCase() === brand,
  );
  if (!franchised) return "link";

  const blocked = (q.blocks ?? []).some(
    (b) =>
      String(b.brand ?? "").trim().toLowerCase() === brand &&
      (b.tenant_id == null || b.tenant_id === q.tenantId),
  );
  return blocked ? "link" : "host";
}

/** Convenience for call sites that only want the boolean. */
export const mayHostOemDocuments = (q: DeliveryQuery): boolean =>
  documentDeliveryFor(q) === "host";

/** The brands this tenant may currently host, for display. */
export function hostableBrands(
  franchises?: OemFranchiseBrand[] | null,
  blocks?: OemDistributionBlock[] | null,
  tenantId?: string | null,
): string[] {
  if (!franchises) return [];
  const isBlocked = (brand: string) =>
    (blocks ?? []).some(
      (b) =>
        String(b.brand ?? "").trim().toLowerCase() === brand &&
        (b.tenant_id == null || b.tenant_id === tenantId),
    );
  return Array.from(
    new Set(franchises.map((f) => String(f.brand ?? "").trim().toLowerCase())),
  )
    .filter((b) => b && !isBlocked(b))
    .sort();
}
