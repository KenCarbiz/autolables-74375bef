// ──────────────────────────────────────────────────────────────
// 50-state dealer compliance engine
//
// This file is the single source of truth for state-specific rules
// AutoLabels enforces on every addendum and window sticker:
//
//   A. Doc-fee caps and required disclosure verbiage (per-state
//      statutory language — dealers must include the EXACT phrases
//      the state requires on any pricing disclosure).
//
//   B. Accessory / add-on sign-off rules — which states require
//      itemized pre-sale disclosure, separate customer sign-off per
//      item, and whether "mandatory" add-ons are prohibited.
//
//   C. Bilingual disclosure requirements — FTC Part 455 + state
//      statutes (CA, NY, TX, NJ, FL).
//
//   D. 3-day right-to-cancel states — CA SB 766 (eff 10/1/2026) is
//      the first; additional states listed as they pass laws.
//
//   E. Record retention periods — signed deals must be kept this
//      long per state DMV / consumer-protection rules.
//
// The ComplianceValidator (below) takes a state + an addendum draft
// and returns a list of PASS/WARN/FAIL findings with statute
// citations, which are then shown to the F&I user and persisted in
// the audit_log when the deal is signed.
//
// IMPORTANT: this table reflects our research as of April 2026.
// Dealers are contractually required to review with their own
// counsel. The `citation` field points at the statutory source.
// When a cap or rule is unknown we use `needsVerification: true`
// and show a warning in the UI rather than silently pass.
// ──────────────────────────────────────────────────────────────

export type StateCode =
  | "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "DC" | "FL"
  | "GA" | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME"
  | "MD" | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH"
  | "NJ" | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI"
  | "SC" | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI" | "WY";

export interface StateRule {
  code: StateCode;
  name: string;
  docFee: {
    cap: number | null;           // null = no statutory cap
    uniformRequirement?: string;  // e.g. "must be uniform across all deals"
    requiredVerbiage: string[];   // exact statutory phrases that must appear
    mustAppearOnSticker: boolean;
    citation: string;
    needsVerification?: boolean;
  };
  addOnRules: {
    itemizedRequired: boolean;       // each item must be listed separately
    separateSignoffRequired: boolean;// customer signs per-item, not just deal
    mandatoryProhibited: boolean;    // dealer cannot require purchase
    preContractDisclosure: boolean;  // disclosure required BEFORE contract
    citation: string;
  };
  bilingual: {
    spanishRequired: boolean;
    otherLanguages: string[];        // e.g. ["zh", "tl", "vi", "ko"] (CA)
    citation: string;
  };
  threeDayReturn: {
    applicable: boolean;
    priceThreshold?: number;         // vehicles under this price
    effectiveDate?: string;          // ISO date when the law kicks in
    citation?: string;
  };
  retentionYears: number;            // how long dealer must keep signed docs
  notes?: string;
}

// Default safe fallback for states we haven't filled in yet.
const fallback = (code: StateCode, name: string): StateRule => ({
  code, name,
  docFee: {
    cap: null,
    requiredVerbiage: [],
    mustAppearOnSticker: true,
    citation: "needs verification",
    needsVerification: true,
  },
  addOnRules: {
    itemizedRequired: true,
    separateSignoffRequired: false,
    mandatoryProhibited: true,
    preContractDisclosure: true,
    citation: "FTC Act §5 (unfair/deceptive)",
  },
  bilingual: {
    spanishRequired: false,
    otherLanguages: [],
    citation: "FTC 16 CFR 455.5 (Spanish if sale conducted in Spanish)",
  },
  threeDayReturn: { applicable: false },
  retentionYears: 4,
});

export const STATE_RULES: Record<StateCode, StateRule> = {
  AL: fallback("AL", "Alabama"),
  AK: fallback("AK", "Alaska"),
  AZ: fallback("AZ", "Arizona"),
  AR: {
    ...fallback("AR", "Arkansas"),
    docFee: {
      cap: 129,
      requiredVerbiage: ["Documentary fee"],
      mustAppearOnSticker: true,
      citation: "Ark. Code §23-112-308",
      needsVerification: true,
    },
  },
  CA: {
    ...fallback("CA", "California"),
    docFee: {
      cap: 85,
      requiredVerbiage: [
        "Not a government fee",
        "This is a voluntary charge by the dealer for document preparation services",
      ],
      mustAppearOnSticker: true,
      citation: "Cal. Vehicle Code §4456.5 / §11713",
    },
    addOnRules: {
      itemizedRequired: true,
      separateSignoffRequired: true,
      mandatoryProhibited: true,
      preContractDisclosure: true,
      citation: "CA SB 766 eff 10/1/2026, Vehicle Code §11713.21",
    },
    bilingual: {
      spanishRequired: true,
      otherLanguages: ["zh", "tl", "vi", "ko"],
      citation: "Cal. Civil Code §1632",
    },
    threeDayReturn: {
      applicable: true,
      priceThreshold: 50000,
      effectiveDate: "2026-10-01",
      citation: "CA SB 766 / Vehicle Code §11713.21",
    },
    retentionYears: 4,
    notes: "Doc-fee cap raise (SB 791) was vetoed Oct 2025. $85 cap stays.",
  },
  CO: fallback("CO", "Colorado"),
  CT: {
    ...fallback("CT", "Connecticut"),
    docFee: {
      // Connecticut's conveyance fee max is indexed (Conn. Gen. Stat.
      // §14-62) and has risen above the old $599; $695 reflects the
      // current cap. Verify against the DMV's annual figure.
      cap: 695,
      requiredVerbiage: [
        "Conveyance fee",
        "not a tax or government fee",
      ],
      mustAppearOnSticker: true,
      citation: "Conn. Gen. Stat. §14-62(d); CT Regs §42-110b-28",
    },
    notes: "CT calls it a 'conveyance fee'; K-208 inspection required on used sales.",
  },
  DE: fallback("DE", "Delaware"),
  DC: fallback("DC", "District of Columbia"),
  FL: {
    ...fallback("FL", "Florida"),
    docFee: {
      cap: null,
      uniformRequirement: "must be the same amount on every deal",
      requiredVerbiage: [
        "This charge represents costs and profit to the dealer for items such as inspecting, cleaning and adjusting vehicles, and preparing documents related to the sale.",
      ],
      mustAppearOnSticker: true,
      citation: "Fla. Stat. §501.976(18)",
    },
  },
  GA: fallback("GA", "Georgia"),
  HI: fallback("HI", "Hawaii"),
  ID: fallback("ID", "Idaho"),
  IL: {
    ...fallback("IL", "Illinois"),
    docFee: {
      cap: 347.26, // 2026 CPI-adjusted; baseline $300 + annual CPI
      requiredVerbiage: [
        "Documentary fee is not an official fee",
        "A documentary fee is not required by law, but may be charged to buyers for handling documents and performing services relating to closing of the sale",
      ],
      mustAppearOnSticker: true,
      citation: "625 ILCS 5/2-123.5",
      needsVerification: true,
    },
    notes: "Cap is CPI-adjusted annually — refresh every January.",
  },
  IN: fallback("IN", "Indiana"),
  IA: fallback("IA", "Iowa"),
  KS: fallback("KS", "Kansas"),
  KY: fallback("KY", "Kentucky"),
  LA: fallback("LA", "Louisiana"),
  ME: fallback("ME", "Maine"),
  MD: fallback("MD", "Maryland"),
  MA: fallback("MA", "Massachusetts"),
  MI: fallback("MI", "Michigan"),
  MN: fallback("MN", "Minnesota"),
  MS: fallback("MS", "Mississippi"),
  MO: fallback("MO", "Missouri"),
  MT: fallback("MT", "Montana"),
  NE: fallback("NE", "Nebraska"),
  NV: fallback("NV", "Nevada"),
  NH: fallback("NH", "New Hampshire"),
  NJ: {
    ...fallback("NJ", "New Jersey"),
    bilingual: {
      spanishRequired: true,
      otherLanguages: [],
      citation: "NJ Consumer Fraud Act (Spanish negotiations)",
    },
  },
  NM: fallback("NM", "New Mexico"),
  NY: {
    ...fallback("NY", "New York"),
    docFee: {
      cap: 175,
      requiredVerbiage: [
        "Documentation fee",
      ],
      mustAppearOnSticker: true,
      citation: "N.Y. Veh. & Traf. Law §415(1-a); 15 NYCRR 78.13 — raised from $75 to $175 in 2023",
    },
    addOnRules: {
      itemizedRequired: true,
      separateSignoffRequired: true,
      mandatoryProhibited: true,
      preContractDisclosure: true,
      citation: "N.Y. GBL §396-p; 15 NYCRR 78",
    },
    bilingual: {
      spanishRequired: true,
      otherLanguages: [],
      citation: "N.Y. GBL §219-a (Spanish-negotiated contracts)",
    },
  },
  NC: fallback("NC", "North Carolina"),
  ND: fallback("ND", "North Dakota"),
  OH: fallback("OH", "Ohio"),
  OK: fallback("OK", "Oklahoma"),
  OR: fallback("OR", "Oregon"),
  PA: {
    ...fallback("PA", "Pennsylvania"),
    docFee: {
      cap: 422, // 2026 CPI-adjusted
      requiredVerbiage: [
        "The documentary fee is not an official fee",
      ],
      mustAppearOnSticker: true,
      citation: "67 Pa. Code §19.11",
      needsVerification: true,
    },
    notes: "PA cap is CPI-adjusted; verify current amount each January.",
  },
  RI: fallback("RI", "Rhode Island"),
  SC: {
    ...fallback("SC", "South Carolina"),
    docFee: {
      cap: 299,
      requiredVerbiage: [
        "A closing fee not to exceed $299",
      ],
      mustAppearOnSticker: true,
      citation: "SC Code §37-2-307",
    },
  },
  SD: fallback("SD", "South Dakota"),
  TN: fallback("TN", "Tennessee"),
  TX: {
    ...fallback("TX", "Texas"),
    docFee: {
      cap: 225,
      requiredVerbiage: [
        "A documentary fee is not an official fee and is not required by law, but may be charged to buyers for handling documents relating to closing of the sale",
      ],
      mustAppearOnSticker: true,
      citation: "TX Finance Code §348.006",
    },
    bilingual: {
      spanishRequired: true,
      otherLanguages: [],
      citation: "TX DOB rules (Spanish negotiations)",
    },
  },
  UT: fallback("UT", "Utah"),
  VT: fallback("VT", "Vermont"),
  VA: fallback("VA", "Virginia"),
  WA: fallback("WA", "Washington"),
  WV: fallback("WV", "West Virginia"),
  WI: fallback("WI", "Wisconsin"),
  WY: fallback("WY", "Wyoming"),
};

export const getStateRule = (code: string | undefined | null): StateRule | null => {
  if (!code) return null;
  const up = code.toUpperCase() as StateCode;
  return STATE_RULES[up] || null;
};

// ──────────────────────────────────────────────────────────────
// ComplianceValidator — run a draft addendum through the state's
// rules. Returns findings the UI shows before the customer signs
// and the dealer publishes.
// ──────────────────────────────────────────────────────────────

export type FindingSeverity = "pass" | "warn" | "fail";

export interface ComplianceFinding {
  id: string;
  severity: FindingSeverity;
  rule: string;          // human-readable rule name
  message: string;       // what's wrong, or confirmation of pass
  citation: string;      // statute or regulation
  suggestion?: string;   // how to fix
}

export interface ComplianceDraft {
  state: string;
  vehiclePrice?: number;
  docFeeAmount?: number;
  docFeeLabel?: string;
  stickerText?: string;       // the full addendum / sticker verbiage shown
  products?: Array<{
    id: string;
    name: string;
    price: number;
    badge_type: "installed" | "optional" | string;
    mandatory?: boolean;
    disclosure?: string;
    installed_at?: string;
    separate_signoff?: boolean;
    // Wave 16 — per-line benefit text. Seeded from the catalog,
    // overridable per-addendum. The red-team gates send on this
    // for installed products (FTC §5 + CA SB 766 §11713.21).
    benefit_justification?: string;
  }>;
  spanishVersion?: boolean;
  threeDayAck?: boolean;
}

export const validateAddendum = (draft: ComplianceDraft): ComplianceFinding[] => {
  const findings: ComplianceFinding[] = [];
  const rule = getStateRule(draft.state);

  if (!rule) {
    findings.push({
      id: "state-unknown",
      severity: "warn",
      rule: "State rule lookup",
      message: `No rule set registered for state "${draft.state ?? "?"}". Platform-wide defaults applied; review locally.`,
      citation: "ComplianceEngine.getStateRule",
    });
    return findings;
  }

  // A. Doc-fee cap
  if (rule.docFee.cap !== null && typeof draft.docFeeAmount === "number") {
    if (draft.docFeeAmount > rule.docFee.cap) {
      findings.push({
        id: "docfee-over-cap",
        severity: "fail",
        rule: `${rule.name} doc-fee cap`,
        message: `Doc fee $${draft.docFeeAmount.toFixed(2)} exceeds the $${rule.docFee.cap} statutory cap.`,
        citation: rule.docFee.citation,
        suggestion: `Reduce to $${rule.docFee.cap} or lower.`,
      });
    } else {
      findings.push({
        id: "docfee-cap-ok",
        severity: "pass",
        rule: `${rule.name} doc-fee cap`,
        message: `$${draft.docFeeAmount.toFixed(2)} is within the $${rule.docFee.cap} cap.`,
        citation: rule.docFee.citation,
      });
    }
  }

  // A.1 Required verbiage
  if (rule.docFee.requiredVerbiage.length > 0 && draft.stickerText) {
    const text = draft.stickerText.toLowerCase();
    const missing = rule.docFee.requiredVerbiage.filter(
      (phrase) => !text.includes(phrase.toLowerCase())
    );
    if (missing.length > 0) {
      findings.push({
        id: "docfee-verbiage-missing",
        severity: "warn",
        rule: `${rule.name} doc-fee disclosure language`,
        message: `Missing statutory phrase${missing.length > 1 ? "s" : ""}: ${missing.map((m) => `"${m}"`).join(", ")}.`,
        citation: rule.docFee.citation,
        suggestion: "Add the exact statutory phrases to the addendum footer.",
      });
    } else {
      findings.push({
        id: "docfee-verbiage-ok",
        severity: "pass",
        rule: `${rule.name} doc-fee disclosure language`,
        message: "All statutory disclosure phrases present.",
        citation: rule.docFee.citation,
      });
    }
  }

  if (rule.docFee.needsVerification) {
    findings.push({
      id: "docfee-unverified",
      severity: "warn",
      rule: `${rule.name} doc-fee cap (unverified)`,
      message: "This cap is flagged for periodic re-verification (CPI-adjusted or recently amended). Confirm current cap with counsel.",
      citation: rule.docFee.citation,
    });
  }

  // B. Accessory add-on rules
  const products = draft.products || [];
  if (rule.addOnRules.mandatoryProhibited) {
    const mandatoryFound = products.filter((p) => p.mandatory);
    if (mandatoryFound.length > 0) {
      findings.push({
        id: "mandatory-addon-prohibited",
        severity: "fail",
        rule: `${rule.name} bans mandatory add-ons`,
        message: `${mandatoryFound.length} product${mandatoryFound.length > 1 ? "s" : ""} flagged mandatory: ${mandatoryFound.map((p) => p.name).join(", ")}.`,
        citation: rule.addOnRules.citation,
        suggestion: "Mark these as optional. Customer must be able to decline without affecting the sale.",
      });
    }
  }
  if (rule.addOnRules.separateSignoffRequired) {
    const optional = products.filter((p) => p.badge_type === "optional");
    const unsigned = optional.filter((p) => !p.separate_signoff);
    if (unsigned.length > 0) {
      findings.push({
        id: "separate-signoff-missing",
        severity: "warn",
        rule: `${rule.name} requires per-item sign-off`,
        message: `${unsigned.length} optional product${unsigned.length > 1 ? "s require" : " requires"} a separate customer initial or signature.`,
        citation: rule.addOnRules.citation,
        suggestion: "MobileSigning will enforce this automatically before submit.",
      });
    }
  }

  // C. Bilingual
  if (rule.bilingual.spanishRequired && draft.spanishVersion !== true) {
    findings.push({
      id: "spanish-missing",
      severity: "warn",
      rule: `${rule.name} Spanish disclosure`,
      message: `If the sale is conducted in Spanish, the dealer must provide a Spanish-language Buyers Guide and contract translation.`,
      citation: rule.bilingual.citation,
      suggestion: "Use the Spanish toggle in BuyersGuide and re-generate the addendum.",
    });
  }

  // D. 3-day return
  if (
    rule.threeDayReturn.applicable &&
    new Date() >= new Date(rule.threeDayReturn.effectiveDate || "1970-01-01") &&
    typeof draft.vehiclePrice === "number" &&
    rule.threeDayReturn.priceThreshold &&
    draft.vehiclePrice < rule.threeDayReturn.priceThreshold &&
    draft.threeDayAck !== true
  ) {
    findings.push({
      id: "three-day-return-ack-missing",
      severity: "fail",
      rule: `${rule.name} 3-day right to cancel`,
      message: `Under $${rule.threeDayReturn.priceThreshold.toLocaleString()} vehicles must include the 3-day right-to-cancel notice and buyer acknowledgment.`,
      citation: rule.threeDayReturn.citation || rule.addOnRules.citation,
      suggestion: "Show SB766DisclosurePanel in MobileSigning and require threeDayAck.",
    });
  }

  return findings;
};

export const summarizeFindings = (findings: ComplianceFinding[]) => {
  const fails = findings.filter((f) => f.severity === "fail").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  const passes = findings.filter((f) => f.severity === "pass").length;
  return {
    fails,
    warns,
    passes,
    status: fails > 0 ? "fail" : warns > 0 ? "warn" : "pass",
  } as const;
};
