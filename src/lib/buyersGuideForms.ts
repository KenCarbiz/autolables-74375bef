// ──────────────────────────────────────────────────────────────────────
// Per-state Buyers Guide FORM resolver.
//
// The FTC Used Car Rule (16 CFR Part 455) governs the Buyers Guide in every
// state EXCEPT Maine and Wisconsin, which are exempt because they mandate
// their OWN state forms. Those two forms are not variants of the FTC form —
// they are structurally different documents:
//
//   • Wisconsin  — Form MV2872 (Wis. Admin. Code TRANS 139): a condition
//     disclosure with title brands, odometer, a per-system YES/NO condition
//     checklist, and TRANS 305 equipment requirements. Nothing like the FTC form.
//   • Maine      — Form 250-C104 (Used Car Information Act, 10 MRSA §§1471-1477):
//     FTC-shaped but with Maine-specific warranty boxes (Warranty of
//     Inspectability / No Express Warranty Except State Inspection Standards /
//     Dealer Express Warranty) and an Implied Warranties YES/NO/Limited box.
//
// This resolver answers the first question for any sale: WHICH official form.
// The FTC front-variant choice (As-Is vs Implied vs Warranty) then comes from
// resolveBuyersGuideWarranty in stateCompliance.ts. Only the FTC form has an
// official Spanish version (§ 455.5, Figures 4-6); the state forms do not.
// ──────────────────────────────────────────────────────────────────────

export type BuyersGuideAuthority = "ftc" | "state";

export type BuyersGuideFormId = "ftc" | "wi-mv2872" | "me-250c104";

export interface BuyersGuideForm {
  authority: BuyersGuideAuthority;
  formId: BuyersGuideFormId;
  formName: string;
  citation: string;
  // The FTC form carries an official Spanish translation the dealer must use for
  // a Spanish-language sale; the Maine/Wisconsin state forms do not.
  spanishAvailable: boolean;
  // Human note for the admin surface — why this form, and any action needed.
  note: string;
  // For state forms: the official state PDF served from /public, shown and
  // printed as-is (filled by hand). null for the FTC form, which we render.
  assetUrl: string | null;
}

const FTC: BuyersGuideForm = {
  authority: "ftc",
  formId: "ftc",
  formName: "FTC Buyers Guide",
  citation: "16 CFR Part 455",
  spanishAvailable: true,
  note: "Federal FTC Buyers Guide applies. Choose the As-Is or Implied Warranties Only front per this state's warranty rules.",
  assetUrl: null,
};

const WISCONSIN: BuyersGuideForm = {
  authority: "state",
  formId: "wi-mv2872",
  formName: "Wisconsin Buyers Guide (Form MV2872)",
  citation: "Wis. Admin. Code TRANS 139",
  spanishAvailable: false,
  note: "Wisconsin is exempt from the federal rule and mandates its own Form MV2872 — use the Wisconsin form, not the FTC Buyers Guide.",
  assetUrl: "/buyers-guides/wi-mv2872.pdf",
};

const MAINE: BuyersGuideForm = {
  authority: "state",
  formId: "me-250c104",
  formName: "Maine Used Vehicle Buyer's Guide (Form 250-C104)",
  citation: "Maine Used Car Information Act, 10 MRSA §§1471-1477",
  spanishAvailable: false,
  note: "Maine is exempt from the federal rule and mandates its own Used Vehicle Buyer's Guide — use the Maine form, not the FTC Buyers Guide.",
  assetUrl: "/buyers-guides/me-250c104.pdf",
};

// The two exempt states → their own forms; everyone else → the FTC form.
export function resolveBuyersGuideForm(state: string | null | undefined): BuyersGuideForm {
  switch ((state || "").toUpperCase()) {
    case "WI":
      return WISCONSIN;
    case "ME":
      return MAINE;
    default:
      return FTC;
  }
}

// Convenience for admin surfaces: is a real state form required (vs the FTC form)?
export const usesStateBuyersGuide = (state: string | null | undefined): boolean =>
  resolveBuyersGuideForm(state).authority === "state";
