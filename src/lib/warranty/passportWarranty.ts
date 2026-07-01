// ── Passport warranty resolver — vehicle-aware coverage selection ────────────
// Decides what warranty the customer passport shows for a specific vehicle,
// combining the dealer's verified admin terms (always highest precedence) with
// the verified OEM warranty + CPO library:
//
//   NEW              → the OEM's new-car factory terms (full, start at delivery).
//   FACTORY CPO      → only when the listing is marked CPO AND the tenant is
//                      franchised for the vehicle's make (a Nissan store selling
//                      a factory-CPO Nissan Altima): the OEM CPO program's terms
//                      populate the coverage — reinstated/extended powertrain
//                      from in-service, plus any comprehensive wrap.
//   USED (incl. CPO-marked cars whose make does NOT match the tenant's
//   franchise — e.g. a Chevy store selling a Toyota)
//                    → the original factory warranty balance only, with the
//                      make's SECOND-OWNER transfer reduction applied where one
//                      exists (Hyundai/Kia/Genesis/Mitsubishi powertrain drops
//                      to 5 yr / 60k from original in-service on transfer).
//
// Franchise detection: the edge function attaches dealer-verified factory terms
// (oem_warranty) and brand-matched OEM CPO programs (cpo_programs) only when the
// dealer has entered them for the vehicle's make — their presence IS the
// tenant-OEM match signal. No dealer signal → treat as cross-brand.
//
// Compliance: used-vehicle library fills require a real in-service date — we
// never fabricate a countdown. Dealer-entered values always win over the
// library so a dealer's confirmed truth is what customers see.

import { lookupOemReference } from "@/data/oemWarrantyReference";
import { lookupOemCpoReference } from "@/data/oemCpoReference";
import { finiteMiles, UNLIMITED_MILES } from "@/lib/oemWarranty";

export interface WarrantyInfoLike {
  factory_months?: number;
  factory_miles?: number;
  powertrain_months?: number;
  powertrain_miles?: number;
  in_service_date?: string;
}

export interface CpoWrapCard {
  programName: string;
  months?: number;
  miles?: number;              // undefined = unlimited/no cap
  unlimitedMiles: boolean;
  inspectionPoints?: string | null;
}

export interface EffectiveWarranty {
  mode: "new" | "used" | "cpo_factory";
  // Drives the panel's existing countdown math (same shape as warranty_info).
  info: WarrantyInfoLike;
  // A from-purchase CPO comprehensive wrap (Kia 1/12k, Toyota 12/12k, Lexus
  // 2yr/unlimited). Can't count down before purchase → rendered as a term card.
  cpoWrap: CpoWrapCard | null;
  cpoProgramName: string | null;
  cpoInspectionPoints: string | null;
  // The powertrain shown is the make's reduced second-owner term.
  secondOwnerReduced: boolean;
  franchiseMatch: boolean;
  // True when any term was filled from the verified library (vs dealer/listing).
  usedLibrary: boolean;
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function resolveEffectiveWarranty(args: {
  condition?: string | null;
  ymm?: string | null;                       // any string containing the make
  warrantyInfo?: WarrantyInfoLike | null;    // listing.warranty_info (dealer/edge)
  hasDealerOem?: boolean;                    // dealer-verified factory terms attached
  cpoPrograms?: Array<Record<string, unknown>> | null; // listing.cpo_programs
}): EffectiveWarranty {
  const cond = (args.condition || "").toLowerCase();
  const isNew = cond === "new";
  const isCpoMarked = cond === "cpo";
  const wi = args.warrantyInfo || {};
  const ref = lookupOemReference(args.ymm);
  const cpoRef = lookupOemCpoReference(args.ymm);

  // Tenant-OEM match: the edge function only attaches these when the dealer has
  // entered terms/programs for this vehicle's make.
  const oemCpoProgram = (args.cpoPrograms || []).find((p) => p && p.kind === "oem") || null;
  const franchiseMatch = !!args.hasDealerOem || !!oemCpoProgram;

  const info: WarrantyInfoLike = { ...wi };
  let usedLibrary = false;
  let secondOwnerReduced = false;

  // ── Fill factory terms from the verified library when the dealer/listing
  // carries none. Used cars need a real in-service date to count down.
  const canFillUsed = isNew || !!wi.in_service_date;
  if (ref && canFillUsed) {
    if (info.factory_months == null && ref.basic_months) {
      info.factory_months = ref.basic_months;
      info.factory_miles = finiteMiles(ref.basic_miles);
      usedLibrary = true;
    }
    if (info.powertrain_months == null && ref.powertrain_months) {
      // Used retail buyers are subsequent owners: apply the make's transfer
      // reduction when one exists (unless factory CPO reinstates it below).
      const reduce = !isNew && ref.powertrain_transfer_months != null;
      info.powertrain_months = reduce ? ref.powertrain_transfer_months : ref.powertrain_months;
      info.powertrain_miles = finiteMiles(reduce ? ref.powertrain_transfer_miles : ref.powertrain_miles);
      secondOwnerReduced = reduce;
      usedLibrary = true;
    } else if (!isNew && info.powertrain_months != null && ref?.powertrain_transfer_months != null
               && info.powertrain_months === ref.powertrain_months) {
      // Listing carried the ORIGINAL-owner long term (e.g. Hyundai 120 mo) for a
      // used car — surface the reduction rather than overstate coverage.
      info.powertrain_months = ref.powertrain_transfer_months;
      info.powertrain_miles = finiteMiles(ref.powertrain_transfer_miles);
      secondOwnerReduced = true;
    }
  }

  // ── Factory CPO overlay — only for CPO-marked cars at a matching franchise.
  let cpoWrap: CpoWrapCard | null = null;
  let cpoProgramName: string | null = null;
  let cpoInspectionPoints: string | null = null;
  let mode: EffectiveWarranty["mode"] = isNew ? "new" : "used";

  if (isCpoMarked && franchiseMatch && (oemCpoProgram || cpoRef)) {
    mode = "cpo_factory";
    cpoProgramName = (oemCpoProgram?.name as string) || cpoRef?.programName || null;
    cpoInspectionPoints = (oemCpoProgram?.inspection_points as string) || cpoRef?.inspectionPoints || null;

    // Powertrain: dealer-entered program numbers win, else the verified library.
    // CPO reinstates the original term (e.g. Hyundai back to 10 yr/100k), so the
    // second-owner reduction no longer applies.
    const ptMo = num(oemCpoProgram?.powertrain_months) ?? cpoRef?.powertrainMonths;
    const ptMi = num(oemCpoProgram?.powertrain_miles) ?? finiteMiles(cpoRef?.powertrainMiles);
    if (ptMo) {
      info.powertrain_months = ptMo;
      info.powertrain_miles = ptMi;
      secondOwnerReduced = false;
      usedLibrary = usedLibrary || !oemCpoProgram;
    }

    // Comprehensive: in-service-based coverage replaces the basic countdown
    // (INFINITI/Genesis/Lincoln style); purchase-based wraps become a term card.
    const compFrom = (oemCpoProgram?.coverage_from as string) || cpoRef?.comprehensiveFrom;
    const compMo = num(oemCpoProgram?.basic_months) ?? cpoRef?.comprehensiveMonths;
    const compMiRaw = num(oemCpoProgram?.basic_miles) ?? cpoRef?.comprehensiveMiles;
    if (compMo) {
      if (compFrom === "in_service") {
        info.factory_months = compMo;
        info.factory_miles = finiteMiles(compMiRaw);
        usedLibrary = usedLibrary || !oemCpoProgram;
      } else {
        cpoWrap = {
          programName: cpoProgramName || "CPO Limited Warranty",
          months: compMo,
          miles: finiteMiles(compMiRaw),
          unlimitedMiles: compMiRaw === UNLIMITED_MILES,
          inspectionPoints: cpoInspectionPoints,
        };
      }
    }
  }

  return { mode, info, cpoWrap, cpoProgramName, cpoInspectionPoints, secondOwnerReduced, franchiseMatch, usedLibrary };
}
