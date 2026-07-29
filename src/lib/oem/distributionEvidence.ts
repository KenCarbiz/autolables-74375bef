// Reading the distribution record, and what it entitles a customer to.
//
// The gate (distributionGrants.ts) decides whether a NEW distribution may be
// hosted. This module answers the different question a passport asks: what was
// already decided for THIS vehicle, and therefore what does the person who
// owns the car get to keep.
//
// Those are deliberately not the same question. A dealer who drops a franchise
// stops new hosting; it does not reach into a passport somebody already owns.
// So a vehicle that was ever distributed under a host decision stays hosted,
// and the log keeps the later decisions too, so the change is visible.

export type DocumentDelivery = "host" | "link";

export interface OemDistributionEvent {
  vin: string;
  brand: string;
  document_kind: "owners_manual" | "brochure";
  decision: DocumentDelivery;
  source_url?: string | null;
  stored_path?: string | null;
  evidence?: OemDistributionEvidence | null;
  decided_at?: string | null;
  gate_version?: number | null;
}

export interface OemDistributionEvidence {
  franchise_brands?: { brand: string; new_units: number }[];
  min_new_units_required?: number;
  brand_blocked?: boolean;
  derived_at?: string;
}

/**
 * What this vehicle's owner is entitled to for a document kind.
 *
 * Mirrors oem_distribution_for_vehicle: hosted if it was EVER hosted. An
 * unreadable log denies, same as everywhere else in this system -- "we could
 * not check" is not "we are allowed".
 */
export function deliveryForVehicle(
  events: OemDistributionEvent[] | null | undefined,
  kind: "owners_manual" | "brochure",
): DocumentDelivery {
  if (!events) return "link";
  return events.some((e) => e.document_kind === kind && e.decision === "host") ? "host" : "link";
}

/**
 * A plain-language account of one decision, for an inquiry or a support
 * question. Reads the evidence as it was captured, never as it is now.
 */
export function explainDecision(e: OemDistributionEvent): string {
  const when = e.decided_at
    ? new Date(e.decided_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "an unrecorded date";
  const brand = e.brand.toUpperCase();
  const doc = e.document_kind === "brochure" ? "brochure" : "owner's manual";

  if (e.decision === "link") {
    if (e.evidence?.brand_blocked) {
      return `On ${when} the ${brand} ${doc} was linked to the manufacturer, not served, because ${brand} documents were under a distribution block.`;
    }
    const units = franchiseUnits(e.evidence, e.brand);
    const need = e.evidence?.min_new_units_required;
    if (units === 0 && need != null) {
      return `On ${when} the ${brand} ${doc} was linked to the manufacturer, not served, because this dealer held no ${brand} new-vehicle franchise (0 new units on record, ${need} required).`;
    }
    return `On ${when} the ${brand} ${doc} was linked to the manufacturer, not served.`;
  }

  const units = franchiseUnits(e.evidence, e.brand);
  const need = e.evidence?.min_new_units_required;
  const basis = units != null && need != null
    ? ` on the basis of ${units} new ${brand} units in inventory against a threshold of ${need}`
    : "";
  return `On ${when} this dealer served the ${brand} ${doc} as a franchised ${brand} retailer${basis}.`;
}

function franchiseUnits(ev: OemDistributionEvidence | null | undefined, brand: string): number | null {
  if (!ev?.franchise_brands) return null;
  const key = brand.trim().toLowerCase();
  const hit = ev.franchise_brands.find((f) => String(f.brand ?? "").trim().toLowerCase() === key);
  return hit ? Number(hit.new_units) || 0 : 0;
}
