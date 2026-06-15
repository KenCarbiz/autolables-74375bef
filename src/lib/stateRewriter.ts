// ──────────────────────────────────────────────────────────────
// Per-state addendum rewriter
//
// Given a state code + a draft addendum, emit a "disclosure pack" —
// the exact statutory language that must appear in the deal jacket
// for that state, plus the prohibited phrases to strip out. Output
// is ready to paste into the addendum or render directly inside
// the signing UI.
//
// Pure TypeScript, builds on the existing STATE_RULES table. No
// network, no AI call. Deterministic so compliance review can
// reproduce the output byte-for-byte.
//
// Usage:
//   const pack = rewriteForState("CA", { vehiclePrice: 45000, ... });
//   // pack.blocks is a list of { title, body, citation, language }
//   // pack.prohibited is a list of phrases to remove from the sticker
// ──────────────────────────────────────────────────────────────

import { getStateRule, type StateCode, type StateRule } from "./stateCompliance";
import { isSb766Applicable } from "./sb766";

export interface DisclosureBlock {
  id: string;
  title: string;
  body: string;
  citation: string;
  language: "en" | "es";
  required: boolean;
}

export interface ProhibitedPhrase {
  phrase: string;
  reason: string;
}

export interface RewriterInput {
  vehiclePrice?: number;
  docFeeAmount?: number;
  vehicleCondition?: "new" | "used" | "cpo";
  saleConductedInSpanish?: boolean;
}

export interface DisclosurePack {
  state: StateCode | null;
  stateName: string;
  blocks: DisclosureBlock[];
  prohibited: ProhibitedPhrase[];
  warnings: string[];
  requiresSpanish: boolean;
}

// Phrases that should never appear in any addendum regardless of
// state. Kept in sync with the red-team engine.
const UNIVERSAL_PROHIBITED: ProhibitedPhrase[] = [
  {
    phrase: "CARS Act",
    reason: "FTC CARS Rule was vacated by the 5th Circuit on Jan 27, 2025 (No. 24-60013).",
  },
  {
    phrase: "CARS Rule",
    reason: "FTC CARS Rule was vacated by the 5th Circuit on Jan 27, 2025 (No. 24-60013).",
  },
];

// State-specific extra prohibited phrases, if any.
const STATE_PROHIBITED: Partial<Record<StateCode, ProhibitedPhrase[]>> = {
  CA: [
    {
      phrase: "mandatory add-on",
      reason: "California bans dealer add-ons that are required as a condition of sale (CCC §2982.2).",
    },
  ],
  NY: [
    {
      phrase: "dealer fee",
      reason: "New York requires the statutory label 'Documentary Fee' rather than 'Dealer Fee' (15 NYCRR §78.11).",
    },
  ],
};

// FTC Buyers Guide block — required on every used car.
const FTC_BUYERS_GUIDE_EN: DisclosureBlock = {
  id: "ftc-buyers-guide-en",
  title: "FTC Buyers Guide — As Is vs Warranty",
  body:
    "IMPORTANT: Spoken promises are difficult to enforce. Ask the dealer to put all promises in writing. The information on this form is part of any contract to buy this vehicle. Removal of this label before consumer purchase (except for test drives by a licensed dealer) is a violation of federal law (16 CFR Part 455).",
  citation: "FTC 16 CFR Part 455",
  language: "en",
  required: true,
};

const FTC_BUYERS_GUIDE_ES: DisclosureBlock = {
  id: "ftc-buyers-guide-es",
  title: "Guía del comprador FTC — Tal como está vs. garantía",
  body:
    "IMPORTANTE: Las promesas verbales son difíciles de hacer cumplir. Pídale al concesionario que todas las promesas se le den por escrito. La información de este formulario forma parte de cualquier contrato para comprar este vehículo. Quitar esta etiqueta antes de la compra del consumidor (excepto para pruebas de manejo de un concesionario con licencia) es una violación de la ley federal (16 CFR Parte 455).",
  citation: "FTC 16 CFR Part 455.5",
  language: "es",
  required: true,
};

// E-SIGN Act consent — required before electronic signatures are
// legally enforceable.
const ESIGN_CONSENT: DisclosureBlock = {
  id: "esign-consent",
  title: "Electronic Records & Signatures Disclosure",
  body:
    "By signing electronically, you agree that your electronic signature has the same legal effect as a handwritten signature and you consent to receive this transaction and all related records electronically. You may request a paper copy by contacting the dealership. Your consent applies to this transaction only.",
  citation: "Federal E-SIGN Act §101(c); Uniform Electronic Transactions Act §7.",
  language: "en",
  required: true,
};

// California SB 766 (eff 10/1/2026) 3-day right to cancel.
const CA_SB766_EN: DisclosureBlock = {
  id: "ca-sb766-3day",
  title: "California 3-Day Right to Cancel",
  body:
    "Notice: California buyers of a used vehicle priced under $50,000 have the right to return this vehicle within 3 days of purchase for any reason, subject to mileage and condition requirements set by Cal. Veh. Code §11950 et seq. (SB 766, eff. October 1, 2026). You must sign a separate acknowledgment to waive this right; waiver cannot be a condition of sale.",
  citation: "Cal. Veh. Code §11950 (SB 766).",
  language: "en",
  required: true,
};

// NY per-statute doc fee label.
const NY_DOC_FEE: DisclosureBlock = {
  id: "ny-doc-fee",
  title: "New York Documentary Fee",
  body:
    "Documentary Fee: The dealer charges a Documentary Fee (not a tax). This fee compensates the dealer for processing documents related to the sale. The current statutory cap is $175.",
  citation: "15 NYCRR §78.11.",
  language: "en",
  required: true,
};

const buildDocFeeBlock = (rule: StateRule): DisclosureBlock | null => {
  if (!rule.docFee.cap && (!rule.docFee.requiredVerbiage || rule.docFee.requiredVerbiage.length === 0)) {
    return null;
  }
  const parts: string[] = [];
  if (rule.docFee.requiredVerbiage?.length) {
    parts.push(rule.docFee.requiredVerbiage.join(" / "));
  }
  if (rule.docFee.cap != null) {
    parts.push(`Statutory cap: $${rule.docFee.cap}.`);
  }
  if (rule.docFee.uniformRequirement) {
    parts.push(rule.docFee.uniformRequirement);
  }
  return {
    id: `${rule.code.toLowerCase()}-doc-fee`,
    title: `${rule.name} Doc Fee Disclosure`,
    body: parts.join(" "),
    citation: rule.docFee.citation,
    language: "en",
    required: rule.docFee.mustAppearOnSticker,
  };
};

export const rewriteForState = (
  stateCode: string | null | undefined,
  input: RewriterInput = {}
): DisclosurePack => {
  const rule = getStateRule(stateCode || null);
  const warnings: string[] = [];
  const prohibited: ProhibitedPhrase[] = [...UNIVERSAL_PROHIBITED];
  const blocks: DisclosureBlock[] = [];

  if (!rule) {
    warnings.push(`No state rule loaded for "${stateCode}". Using FTC baseline only.`);
    blocks.push(FTC_BUYERS_GUIDE_EN, ESIGN_CONSENT);
    return {
      state: null,
      stateName: (stateCode || "").toUpperCase(),
      blocks,
      prohibited,
      warnings,
      requiresSpanish: false,
    };
  }

  // 1. FTC Buyers Guide on used vehicles
  if (input.vehicleCondition === "used" || input.vehicleCondition === "cpo") {
    blocks.push(FTC_BUYERS_GUIDE_EN);
  }

  // 2. E-SIGN Act consent
  blocks.push(ESIGN_CONSENT);

  // 3. Per-state doc fee block if the rule has one
  const docFeeBlock = buildDocFeeBlock(rule);
  if (docFeeBlock) blocks.push(docFeeBlock);

  // 3a. NY explicit label block (doc fee language is statutorily picky)
  if (rule.code === "NY") blocks.push(NY_DOC_FEE);

  // 4. California SB 766 3-day return
  if (rule.code === "CA" && isSb766Applicable("CA", input.vehiclePrice)) {
    blocks.push(CA_SB766_EN);
  }

  // 5. Bilingual / Spanish requirement
  const requiresSpanish = !!(
    rule.bilingual.spanishRequired ||
    input.saleConductedInSpanish
  );
  if (requiresSpanish) {
    blocks.push(FTC_BUYERS_GUIDE_ES);
  }

  // 6. Per-state extra prohibited phrases
  const extras = STATE_PROHIBITED[rule.code];
  if (extras) prohibited.push(...extras);

  // 7. Warnings
  if (rule.docFee.needsVerification) {
    warnings.push(
      `${rule.name} doc fee rule is marked needsVerification — confirm with state DMV / counsel before citing.`
    );
  }
  if (rule.docFee.cap != null && typeof input.docFeeAmount === "number" && input.docFeeAmount > rule.docFee.cap) {
    warnings.push(
      `Doc fee $${input.docFeeAmount} exceeds the ${rule.name} statutory cap of $${rule.docFee.cap} (${rule.docFee.citation}).`
    );
  }
  // These are standing state requirements the AutoLabels addendum already
  // satisfies by design (per-item sign-off in the Selection Record + the
  // Voluntary Purchase Notice). Surface them as required disclosure content
  // in the pack, NOT as actionable warnings — a compliant deal shouldn't
  // read as if something is wrong.
  if (rule.addOnRules.separateSignoffRequired) {
    blocks.push({
      id: `${rule.code.toLowerCase()}-addon-signoff`,
      title: `${rule.name.toUpperCase()} — PER-ITEM ADD-ON SIGN-OFF`,
      body: `The customer separately accepts or declines and initials each optional add-on.`,
      citation: rule.addOnRules.citation,
      language: "en",
      required: true,
    });
  }
  if (rule.addOnRules.mandatoryProhibited) {
    blocks.push({
      id: `${rule.code.toLowerCase()}-voluntary-addons`,
      title: `${rule.name.toUpperCase()} — VOLUNTARY ADD-ONS`,
      body: `No add-on or accessory is required as a condition of sale, financing, or lease.`,
      citation: rule.addOnRules.citation,
      language: "en",
      required: true,
    });
  }

  return {
    state: rule.code,
    stateName: rule.name,
    blocks,
    prohibited,
    warnings,
    requiresSpanish,
  };
};

// Render the pack as plain text, suitable for pasting into a
// disclosure block or an email. The output is deterministic so
// compliance review can diff it.
export const renderDisclosurePack = (pack: DisclosurePack): string => {
  const lines: string[] = [];
  lines.push(`=== ${pack.stateName} Disclosure Pack ===`);
  if (pack.warnings.length) {
    lines.push("");
    lines.push("REVIEW WARNINGS:");
    pack.warnings.forEach((w) => lines.push(`  • ${w}`));
  }
  pack.blocks.forEach((b, i) => {
    lines.push("");
    lines.push(`(${i + 1}) ${b.title}${b.language === "es" ? " [ES]" : ""}`);
    lines.push(b.body);
    lines.push(`    — ${b.citation}`);
  });
  if (pack.prohibited.length) {
    lines.push("");
    lines.push("DO NOT USE:");
    pack.prohibited.forEach((p) => lines.push(`  • "${p.phrase}" — ${p.reason}`));
  }
  return lines.join("\n");
};
