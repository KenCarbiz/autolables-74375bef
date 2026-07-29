// One question, one answer: may this dealer serve OUR copy of this
// manufacturer's documents, or do we hand the shopper a link?
//
// Linking needs no permission. Hosting the bytes is redistribution, and the
// right belongs to the franchised dealer for their own brand -- not to
// AutoLabels, and not across brands. An INFINITI store may serve INFINITI
// manuals for the INFINITI it is selling; the used Honda beside it gets a link.
//
// DEFAULT DENY, and specifically: an UNKNOWN answer is a denial. A caller that
// could not load the grants must fall through to linking, because "we could not
// check" and "we are allowed" are not the same sentence.

import { resolveOemBrand } from "@/components/brand/OemLogoRegistry";

export type DocumentDelivery = "host" | "link";

export interface OemDistributionGrant {
  id: string;
  tenant_id: string;
  /** null means every store in the tenant. */
  store_id: string | null;
  brand: string;
  status: "active" | "revoked";
  attested_at?: string | null;
  attestation_version?: number | null;
  revoked_at?: string | null;
}

/** The grant key for a make. Falls back to the cleaned string for a brand
 *  outside the registry, so a new marque is grantable before we style it. */
export function grantBrandKey(make?: string | null): string {
  const resolved = resolveOemBrand(make);
  if (resolved) return resolved;
  return String(make ?? "").trim().toLowerCase();
}

export interface DeliveryQuery {
  /** The vehicle's make, free text off the listing. */
  make?: string | null;
  tenantId?: string | null;
  storeId?: string | null;
  /** Active grants for this tenant. Pass null when they could not be loaded. */
  grants?: OemDistributionGrant[] | null;
}

/**
 * Whether a vehicle's OEM documents may be hosted for this dealer.
 *
 * Returns "link" for every case that is not an explicit, live, brand-matched
 * grant: no grants loaded, no make, a revoked grant, a different brand, or a
 * store-scoped grant that does not cover this store.
 */
export function documentDeliveryFor(q: DeliveryQuery): DocumentDelivery {
  if (!q.grants || !q.tenantId) return "link";
  const brand = grantBrandKey(q.make);
  if (!brand) return "link";

  const covers = q.grants.some((g) =>
    g.status === "active" &&
    g.tenant_id === q.tenantId &&
    String(g.brand ?? "").trim().toLowerCase() === brand &&
    // A tenant-wide grant covers every store; a store-scoped one covers its own.
    (g.store_id == null || g.store_id === (q.storeId ?? null))
  );
  return covers ? "host" : "link";
}

/** Convenience for call sites that only want the boolean. */
export const mayHostOemDocuments = (q: DeliveryQuery): boolean =>
  documentDeliveryFor(q) === "host";

/** The brands this tenant may currently host, for display. */
export function grantedBrands(grants?: OemDistributionGrant[] | null): string[] {
  if (!grants) return [];
  return Array.from(
    new Set(grants.filter((g) => g.status === "active").map((g) => String(g.brand ?? "").trim().toLowerCase())),
  ).filter(Boolean).sort();
}
