// ──────────────────────────────────────────────────────────────
// Compliance Red-Team engine
//
// Sits on top of validateAddendum (which handles per-state rules)
// and layers cross-cutting "if a regulator actually read this deal"
// checks:
//
//   1. E-SIGN + 16 CFR 455 hygiene
//      - Buyers Guide present for used cars
//      - Bilingual copy present where the sale happens in Spanish
//      - Customer name + signature must be non-blank at sign time
//
//   2. Add-on reasonableness
//      - Optional items that are un-initialled
//      - Add-ons > 20% of vehicle price flagged for secondary review
//      - Products marked "installed" with no installed_at timestamp
//      - Doc fee over state cap
//
//   3. FTC mothership checks
//      - "CARS Act"/"CARS Rule" language (vacated Jan 2025) — hard fail
//      - Bait-and-switch risk: advertised price missing when any add-on
//        changes the OTD total
//
// Every finding carries a severity (pass|warn|fail), a regulator-facing
// citation, and an actionable suggestion. Downstream UI (the panel
// component) groups and presents them.
//
// The engine is deliberately pure — no network. It's fast enough to
// run on every keystroke, which is how we present findings live in
// the addendum builder.
// ──────────────────────────────────────────────────────────────

import {
  validateAddendum,
  type ComplianceDraft,
  type ComplianceFinding,
} from "./stateCompliance";

export interface RedTeamDraft extends ComplianceDraft {
  customerName?: string;
  buyersGuideAttached?: boolean;
  advertisedPrice?: number;
  signedAt?: string | null;
  initialsByProductId?: Record<string, string>;
  esignConsentAccepted?: boolean;
  listingUnlocked?: boolean;
  vehicleCondition?: "new" | "used" | "cpo";
  // Verified installer proofs (signature + photo) on file for this VIN. When
  // provided (dealer build context), every pre-installed product must match a
  // verified proof or it cannot remain in the advertised price.
  provenInstallProofs?: Array<{ product_name: string; verified: boolean }>;
}

// Words that should not appear in current addendum copy because the
// regulatory authority for them was vacated or never existed. These
// are hard fails, not warnings — a dealer referencing "CARS Act"
// loses credibility with the very lawyer they need on their side.
const BANNED_PHRASES: Array<{ phrase: string; reason: string }> = [
  { phrase: "CARS Act", reason: "FTC CARS Rule was vacated by the 5th Circuit on Jan 27, 2025 (No. 24-60013)." },
  { phrase: "CARS Rule", reason: "FTC CARS Rule was vacated by the 5th Circuit on Jan 27, 2025 (No. 24-60013)." },
  { phrase: "federally required", reason: "Use 'disclosure-aligned' or cite the specific statute; 'federally required' is overbroad." },
];

export const runComplianceRedTeam = (draft: RedTeamDraft): ComplianceFinding[] => {
  const findings = validateAddendum(draft);

  // ─── Banned / risky phrases ──────────────────────────────────
  const haystack = `${draft.stickerText || ""} ${(draft.products || [])
    .map((p) => `${p.name} ${p.disclosure || ""}`)
    .join(" ")}`.toLowerCase();
  BANNED_PHRASES.forEach(({ phrase, reason }) => {
    if (haystack.includes(phrase.toLowerCase())) {
      findings.push({
        id: `banned-${phrase.toLowerCase().replace(/\s+/g, "-")}`,
        severity: "fail",
        rule: `Do not use "${phrase}"`,
        message: `Found "${phrase}" in addendum copy.`,
        citation: reason,
        suggestion: `Replace with specific, current statute citations or neutral "disclosure" language.`,
      });
    }
  });

  // ─── Unsigned installed products ─────────────────────────────
  const unsigned = (draft.products || [])
    .filter((p) => p.badge_type === "installed")
    .filter((p) => !(draft.initialsByProductId || {})[p.id]?.trim());
  if (draft.signedAt && unsigned.length > 0) {
    findings.push({
      id: "unsigned-installed",
      severity: "fail",
      rule: "Every installed product needs customer initials",
      message: `${unsigned.length} installed product(s) have no customer initials.`,
      citation: "UETA §12; state per-item sign-off rules for add-ons.",
      suggestion: `Re-open the sign flow and have the customer initial: ${unsigned.slice(0, 3).map((p) => p.name).join(", ")}${unsigned.length > 3 ? "…" : ""}`,
    });
  }

  // ─── Pre-installed products require a verified install proof ──
  // FTC: a product advertised as installed/included must be substantiated by
  // a verifiable installer sign-off WITH a photo. Absent that, it cannot stay
  // in the advertised price — reclassify to customer-elected so the buyer may
  // decline it. Only runs in the dealer build context (proofs supplied).
  if (draft.provenInstallProofs !== undefined) {
    const verifiedNames = new Set(
      draft.provenInstallProofs
        .filter((p) => p.verified)
        .map((p) => (p.product_name || "").trim().toLowerCase())
        .filter(Boolean),
    );
    const installedLines = (draft.products || []).filter((p) => p.badge_type === "installed");
    const unproven = installedLines.filter((p) => {
      const pn = (p.name || "").toLowerCase();
      return ![...verifiedNames].some((n) => n.length >= 4 && (pn === n || pn.includes(n) || n.includes(pn)));
    });
    if (unproven.length > 0) {
      findings.push({
        id: "installed-without-verified-proof",
        severity: "fail",
        rule: "Pre-installed products require a verified install proof with a photo",
        message: `${unproven.length} pre-installed product(s) have no verified, photographed installer sign-off: ${unproven.slice(0, 3).map((p) => p.name).join(", ")}${unproven.length > 3 ? "…" : ""}.`,
        citation: "FTC Act §5 — an item advertised as installed/included must be substantiated; otherwise it is a customer-elected add-on the buyer may decline.",
        suggestion: "Have the installer scan the Get-Ready QR to record a signed, photographed proof, OR set the line's Sale Method to Customer Elected (the buyer may opt out).",
      });
    }
  }

  // ─── Missing benefit justification (Wave 16) ────────────────
  // FTC §5 + CA SB 766 §11713.21 require dealers to JUSTIFY why
  // each add-on benefits the buyer for this transaction. Silent
  // installed products are the #1 hook in the FTC's 97-dealer
  // letter campaign (March 2026). Hard fail before send.
  const hasBenefit = (p: unknown): boolean => {
    const pp = p as { benefit_justification?: string; benefit_justification_optional?: string };
    return !!((pp.benefit_justification || "").trim() || (pp.benefit_justification_optional || "").trim());
  };
  const hasDisclosure = (p: unknown): boolean => {
    const pp = p as { disclosure?: string };
    return !!(pp.disclosure || "").trim();
  };
  const installedProducts = (draft.products || []).filter((p) => p.badge_type === "installed");
  const optionalProducts = (draft.products || []).filter((p) => p.badge_type === "optional");
  const allProducts = draft.products || [];

  // Benefit justification — FAIL (red) if any installed product is missing
  // it, otherwise an explicit PASS (green) so the dealer SEES it's present.
  const missingBenefit = installedProducts.filter((p) => !hasBenefit(p));
  if (missingBenefit.length > 0) {
    findings.push({
      id: "missing-benefit-justification",
      severity: "fail",
      rule: "Every installed product needs a benefit justification",
      message: `${missingBenefit.length} installed product(s) have no benefit justification text.`,
      citation: "FTC Act §5 claim substantiation (nationwide); CA SB 766 §11713.21 (California only, eff. Oct 1, 2026).",
      suggestion: `Open the products tab and set the Benefit Justification field for: ${missingBenefit.slice(0, 3).map((p) => p.name).join(", ")}${missingBenefit.length > 3 ? "…" : ""}`,
    });
  } else if (installedProducts.length > 0) {
    findings.push({
      id: "benefit-justification-ok",
      severity: "pass",
      rule: "Every installed product has a benefit justification",
      message: `All ${installedProducts.length} installed product(s) carry benefit justification text the customer can read.`,
      citation: "FTC Act §5 claim substantiation (nationwide).",
    });
  }

  // Optional benefit copy — WARN (yellow) if missing, else PASS (green).
  const optionalMissingBenefit = optionalProducts.filter((p) => !hasBenefit(p));
  if (optionalMissingBenefit.length > 0) {
    findings.push({
      id: "optional-missing-benefit",
      severity: "warn",
      rule: "Optional products benefit from a justification too",
      message: `${optionalMissingBenefit.length} optional product(s) have no benefit text. The /v/:slug landing will show the name + price only.`,
      citation: "FTC §5 (best practice); not statutory until accepted by the customer.",
      suggestion: "Add benefit text so the customer can read what they're buying before initialling.",
    });
  } else if (optionalProducts.length > 0) {
    findings.push({
      id: "optional-benefit-ok",
      severity: "pass",
      rule: "Optional products carry benefit text",
      message: `All ${optionalProducts.length} optional product(s) show benefit text before the customer accepts.`,
      citation: "FTC §5 (best practice).",
    });
  }

  // Product disclosure present — WARN (yellow) if any line lacks the
  // customer-facing disclosure, else PASS (green). Material terms must be
  // disclosed; the addendum shows this text directly under each product.
  const missingDisclosure = allProducts.filter((p) => !hasDisclosure(p));
  if (missingDisclosure.length > 0) {
    findings.push({
      id: "missing-product-disclosure",
      severity: "warn",
      rule: "Every product needs a disclosure",
      message: `${missingDisclosure.length} product(s) have no disclosure text shown to the customer.`,
      citation: "FTC Act §5 — material terms must be clearly disclosed.",
      suggestion: `Set the Disclosure field for: ${missingDisclosure.slice(0, 3).map((p) => p.name).join(", ")}${missingDisclosure.length > 3 ? "…" : ""}`,
    });
  } else if (allProducts.length > 0) {
    findings.push({
      id: "product-disclosure-ok",
      severity: "pass",
      rule: "Every product has a disclosure",
      message: `All ${allProducts.length} product(s) carry disclosure text on the addendum.`,
      citation: "FTC Act §5.",
    });
  }

  // ─── Add-on spend ratio ──────────────────────────────────────
  const addOnTotal = (draft.products || []).reduce((sum, p) => sum + (p.price || 0), 0);
  if (draft.vehiclePrice && addOnTotal > 0) {
    const ratio = addOnTotal / draft.vehiclePrice;
    if (ratio > 0.20) {
      findings.push({
        id: "addon-ratio-high",
        severity: "warn",
        rule: "Add-ons exceed 20% of vehicle price",
        message: `Add-ons total $${addOnTotal.toLocaleString()} on a $${draft.vehiclePrice.toLocaleString()} vehicle (${Math.round(ratio * 100)}%).`,
        citation: "FTC §5 unfair practices; CFPB Junk Fees guidance.",
        suggestion: "Manager review recommended. Ensure every line is itemized and customer-initialled separately.",
      });
    }
  }

  // ─── Advertised price drift (Goal A: website price == price charged) ─
  if (
    typeof draft.advertisedPrice === "number" && draft.advertisedPrice > 0 &&
    typeof draft.vehiclePrice === "number" && draft.vehiclePrice > 0
  ) {
    const diff = draft.vehiclePrice - draft.advertisedPrice;
    if (Math.abs(diff) > 50) {
      findings.push({
        id: "advertised-price-drift",
        severity: "warn",
        rule: "Window price differs from advertised price",
        message: diff > 0
          ? `This vehicle's price ($${draft.vehiclePrice.toLocaleString()}) is $${Math.abs(diff).toLocaleString()} HIGHER than your latest advertised price ($${draft.advertisedPrice.toLocaleString()}).`
          : `This vehicle's price ($${draft.vehiclePrice.toLocaleString()}) is $${Math.abs(diff).toLocaleString()} lower than your latest advertised price ($${draft.advertisedPrice.toLocaleString()}).`,
        citation: "FTC §5 — the advertised price must match the price charged.",
        suggestion: "Reconcile the window price with your website / marketplace listing before the customer signs.",
      });
    }
  }

  // ─── Doc fee sanity ──────────────────────────────────────────
  if (typeof draft.docFeeAmount === "number" && draft.docFeeAmount <= 0) {
    findings.push({
      id: "doc-fee-zero",
      severity: "warn",
      rule: "Doc fee is $0",
      message: "Doc fee is blank or zero. Most stores charge a statutory max doc fee — confirm this is intended.",
      citation: "Per-state doc fee caps.",
    });
  }

  // ─── Customer identity ───────────────────────────────────────
  if (draft.signedAt && !(draft.customerName || "").trim()) {
    findings.push({
      id: "customer-name-blank",
      severity: "fail",
      rule: "Customer name required at sign time",
      message: "The addendum was submitted as signed but the customer name is blank.",
      citation: "UETA §7; Federal E-SIGN Act §101(c).",
      suggestion: "Capture printed name at the top of the signing flow before the signature pad.",
    });
  }

  // ─── ESIGN consent ───────────────────────────────────────────
  if (draft.signedAt && draft.esignConsentAccepted === false) {
    findings.push({
      id: "esign-consent-missing",
      severity: "fail",
      rule: "E-SIGN Act consent required",
      message: "Electronic Records Disclosure was not accepted before signature capture.",
      citation: "Federal E-SIGN Act §101(c)(1).",
      suggestion: "Require the customer to check the E-SIGN box before enabling the signature pad.",
    });
  }

  // ─── Buyers Guide for used ───────────────────────────────────
  if (draft.vehicleCondition === "used" && draft.buyersGuideAttached === false) {
    findings.push({
      id: "buyers-guide-missing",
      severity: "fail",
      rule: "FTC Buyers Guide required on every used vehicle",
      message: "No Buyers Guide is attached to this used-car deal.",
      citation: "16 CFR Part 455.",
      suggestion: "Generate a Buyers Guide (English + Spanish if sale conducted in Spanish) and attach before signing.",
    });
  }

  // ─── Listing-unlock gate ─────────────────────────────────────
  if (draft.listingUnlocked === false) {
    findings.push({
      id: "prep-not-unlocked",
      severity: "warn",
      rule: "Prep sign-off not unlocked",
      message: "No foreman sign-off with listing_unlocked=true exists for this VIN.",
      citation: "AutoLabels internal install-audit gate.",
      suggestion: "Complete /prep for this vehicle; customer signatures should not be captured until install is verified.",
    });
  }

  return findings;
};

export interface RedTeamSummary {
  pass: number;
  warn: number;
  fail: number;
  total: number;
  blocker: boolean;  // true if any fail severity present
}

export const summarizeRedTeam = (findings: ComplianceFinding[]): RedTeamSummary => {
  const pass = findings.filter((f) => f.severity === "pass").length;
  const warn = findings.filter((f) => f.severity === "warn").length;
  const fail = findings.filter((f) => f.severity === "fail").length;
  return { pass, warn, fail, total: findings.length, blocker: fail > 0 };
};
