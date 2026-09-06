// ─────────────────────────────────────────────────────────────────────
// Dealership voice profile — versioned, tenant-scoped, approval-gated.
//
// The store's own claims are the second-largest source of unverifiable copy
// after vehicle facts. "Family owned since 1974", "free delivery", "lifetime
// warranty" are all statements a model will happily produce because they are
// what dealership copy sounds like. None of them are true by default.
//
// So every dealership benefit is a GATED CLAIM: it may only appear in copy
// when the tenant has explicitly approved it on their voice profile, and the
// approval is versioned so a description keeps the profile it was written
// under even after the store changes its mind.
// ─────────────────────────────────────────────────────────────────────

import type { ToneKey } from "./description-tone.ts";

export interface GatedDealerClaim {
  key: string;
  label: string;
  /** Detects the claim in generated copy. */
  pattern: RegExp;
}

// Each of these requires an approved entry on the voice profile. Anything not
// approved is a blocking finding, not a warning: it is a statement about the
// business that the business did not make.
export const GATED_DEALER_CLAIMS: GatedDealerClaim[] = [
  { key: "family_owned", label: "family owned", pattern: /\bfamily[- ]owned\b|\bfamily[- ]run\b/i },
  { key: "years_in_business", label: "years in business", pattern: /\b(serving|proudly serving)\b[^.]*\b(since|for over|for more than)\b|\b\d{2,3}\+?\s+years\s+(in business|of service|serving)\b/i },
  { key: "free_delivery", label: "free delivery", pattern: /\bfree\s+(home\s+)?delivery\b|\bcomplimentary\s+delivery\b|\bwe\s+deliver\s+free\b/i },
  { key: "nationwide_shipping", label: "nationwide shipping", pattern: /\bnationwide\s+(shipping|delivery)\b|\bship\s+anywhere\b/i },
  { key: "lifetime_warranty", label: "lifetime warranty", pattern: /\blifetime\s+(warranty|powertrain)\b/i },
  { key: "complimentary_maintenance", label: "complimentary maintenance", pattern: /\bcomplimentary\s+maintenance\b|\bfree\s+(oil changes|maintenance)\b/i },
  { key: "no_haggle_pricing", label: "no-haggle pricing", pattern: /\bno[- ]haggle\b|\bone[- ]price\b|\bupfront\s+pricing\b|\bhaggle[- ]free\b/i },
  { key: "guaranteed_financing", label: "guaranteed financing", pattern: /\bguaranteed\s+(financing|approval|credit)\b|\beveryone\s+is\s+approved\b|\ball\s+credit\s+approved\b/i },
  { key: "free_carfax", label: "free vehicle history report", pattern: /\bfree\s+(carfax|autocheck|vehicle\s+history)\b/i },
  { key: "certified_technicians", label: "certified technicians", pattern: /\b(factory[- ])?certified\s+technicians\b|\bmaster[- ]certified\s+techs?\b/i },
  { key: "largest_inventory", label: "largest inventory", pattern: /\blargest\s+(selection|inventory)\b|\bbiggest\s+(selection|inventory)\b/i },
  { key: "number_one_dealer", label: "number-one dealer", pattern: /\b(#\s?1|number\s+one|no\.\s?1)\s+(dealer|volume|in\s+\w+)\b|\btop[- ]rated\s+dealer\b/i },
  { key: "award_winning", label: "award winning", pattern: /\baward[- ]winning\b|\bpresident'?s\s+award\b|\bdealer\s+of\s+the\s+year\b/i },
  { key: "price_match", label: "price match", pattern: /\bprice\s+match\b|\bwe'?ll\s+beat\s+any\s+price\b/i },
];

export interface VoiceProfile {
  tenantId: string;
  /** Display identity */
  dealerName: string;
  storeReference: string;
  city: string;
  state: string;
  marketArea: string;
  /** Communities the dealer has confirmed they actually serve. */
  approvedAreas: string[];

  brandPositioning: string;
  defaultTone: ToneKey;
  ctaTemplate: string;
  contactPreference: string;

  /** Claim keys from GATED_DEALER_CLAIMS the tenant has approved. */
  approvedClaims: string[];
  /** Approved differentiators, stated verbatim. */
  differentiators: string[];

  prohibitedPhrases: string[];
  requiredDisclosures: string[];

  certificationTerminology: string;
  warrantyTerminology: string;
  financeTerminology: string;
  tradeTerminology: string;
  deliveryTerminology: string;

  /** Per-channel wording overrides, keyed by channel. */
  channelOverrides: Record<string, { ctaTemplate?: string; instruction?: string }>;

  version: string;
  status: "draft" | "approved" | "archived";
  approvedBy: string | null;
  approvedAt: string | null;
}

const DEFAULTS = {
  storeReference: "", brandPositioning: "", defaultTone: "professional" as ToneKey,
  ctaTemplate: "", contactPreference: "phone", approvedClaims: [] as string[],
  differentiators: [] as string[], prohibitedPhrases: [] as string[],
  requiredDisclosures: [] as string[], certificationTerminology: "Certified Pre-Owned",
  warrantyTerminology: "remaining factory coverage", financeTerminology: "financing options",
  tradeTerminology: "trade-in appraisal", deliveryTerminology: "delivery",
  channelOverrides: {} as Record<string, { ctaTemplate?: string; instruction?: string }>,
};

/**
 * Build the effective profile from the stored voice row, falling back to the
 * legacy `description_settings` fields so a tenant that never created a profile
 * still gets a coherent, approval-gated voice rather than nothing.
 */
export function resolveVoiceProfile(
  tenantId: string,
  stored: Record<string, any> | null,
  settings: Record<string, any>,
  dealer: Record<string, any> | null,
): VoiceProfile {
  const p = (stored?.profile_json || {}) as Record<string, any>;
  const str = (...vals: unknown[]) =>
    String(vals.find((v) => v !== null && v !== undefined && String(v).trim() !== "") ?? "").trim();
  const arr = (...vals: unknown[]): string[] => {
    const hit = vals.find((v) => Array.isArray(v) && v.length);
    return Array.isArray(hit) ? hit.map(String).filter(Boolean) : [];
  };

  return {
    tenantId,
    dealerName: str(p.dealerName, settings.dealer_name_format, dealer?.dealer_name, dealer?.name),
    storeReference: str(p.storeReference, DEFAULTS.storeReference),
    city: str(p.city, settings.primary_city, dealer?.city),
    state: str(p.state, settings.state, dealer?.state),
    marketArea: str(p.marketArea),
    approvedAreas: arr(p.approvedAreas, settings.selling_areas),
    brandPositioning: str(p.brandPositioning, settings.brand_voice, DEFAULTS.brandPositioning),
    defaultTone: (p.defaultTone || settings.default_tone || DEFAULTS.defaultTone) as ToneKey,
    ctaTemplate: str(p.ctaTemplate, settings.cta_template),
    contactPreference: str(p.contactPreference, DEFAULTS.contactPreference),
    // Absence is denial. A tenant that has never configured approved claims
    // gets an EMPTY list, so no dealership benefit can be stated at all.
    approvedClaims: arr(p.approvedClaims),
    differentiators: arr(p.differentiators),
    prohibitedPhrases: arr(p.prohibitedPhrases, settings.prohibited_phrases),
    requiredDisclosures: arr(p.requiredDisclosures,
      settings.required_legal_text ? [settings.required_legal_text] : []),
    certificationTerminology: str(p.certificationTerminology, DEFAULTS.certificationTerminology),
    warrantyTerminology: str(p.warrantyTerminology, DEFAULTS.warrantyTerminology),
    financeTerminology: str(p.financeTerminology, DEFAULTS.financeTerminology),
    tradeTerminology: str(p.tradeTerminology, DEFAULTS.tradeTerminology),
    deliveryTerminology: str(p.deliveryTerminology, DEFAULTS.deliveryTerminology),
    channelOverrides: (p.channelOverrides && typeof p.channelOverrides === "object")
      ? p.channelOverrides : DEFAULTS.channelOverrides,
    version: str(stored?.version, "vp_unversioned"),
    status: (stored?.status as VoiceProfile["status"]) || "draft",
    approvedBy: stored?.approved_by ?? null,
    approvedAt: stored?.approved_at ?? null,
  };
}

export async function computeVoiceProfileVersion(v: VoiceProfile): Promise<string> {
  const material = [
    v.dealerName, v.storeReference, v.city, v.state, v.marketArea,
    JSON.stringify([...v.approvedAreas].sort()), v.brandPositioning, v.defaultTone,
    v.ctaTemplate, v.contactPreference,
    JSON.stringify([...v.approvedClaims].sort()),
    JSON.stringify([...v.differentiators].sort()),
    JSON.stringify([...v.prohibitedPhrases].sort()),
    JSON.stringify([...v.requiredDisclosures].sort()),
    v.certificationTerminology, v.warrantyTerminology, v.financeTerminology,
    v.tradeTerminology, v.deliveryTerminology, JSON.stringify(v.channelOverrides),
  ].map((x) => String(x ?? "").trim().toLowerCase()).join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return "vp_" + Array.from(new Uint8Array(digest)).slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface VoiceFinding {
  code: string;
  severity: "warning" | "blocking";
  message: string;
  claim: string;
}

/** Any dealership benefit the tenant has not approved is a blocking finding. */
export function checkDealerClaims(content: string, v: VoiceProfile): VoiceFinding[] {
  const approved = new Set(v.approvedClaims.map((c) => String(c).toLowerCase().trim()));
  const out: VoiceFinding[] = [];
  for (const claim of GATED_DEALER_CLAIMS) {
    const m = (content || "").match(claim.pattern);
    if (!m) continue;
    if (approved.has(claim.key)) continue;
    out.push({
      code: "UNAPPROVED_DEALER_CLAIM", severity: "blocking", claim: m[0],
      message: `"${m[0].trim()}" states a dealership benefit (${claim.label}) that ${v.dealerName || "this store"} has not approved on its voice profile.`,
    });
  }
  return out;
}

/**
 * Locality guard. A market-area mention is useful; a list of nearby towns is
 * doorway-page behavior. Only areas the dealer confirmed are legitimate, and
 * even those cannot be enumerated.
 */
export function checkLocalityUse(content: string, v: VoiceProfile): VoiceFinding[] {
  const out: VoiceFinding[] = [];
  const text = content || "";
  const approved = new Set([v.city, v.marketArea, ...v.approvedAreas]
    .map((s) => String(s || "").toLowerCase().trim()).filter(Boolean));

  // Three or more comma-joined proper-noun place names in one sentence is a
  // city list regardless of which cities they are.
  // The keyword is matched case-insensitively but the place names are not: a
  // city list most naturally BEGINS a sentence ("Serving Hartford, Manchester
  // and New Britain..."), and a case-sensitive keyword missed exactly that.
  // The /i flag cannot be applied to the whole pattern without [A-Z] matching
  // lowercase words and turning any comma list into a locality finding.
  const listPattern = /\b(?:[Ss]erving|[Nn]ear|[Aa]round|[Pp]roudly serving|[Ss]hoppers? (?:from|in))\b[^.]*?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?(?:\s*,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?){2,})/;
  const listed = text.match(listPattern);
  if (listed) {
    out.push({ code: "LOCALITY_STUFFING", severity: "blocking", claim: listed[1].slice(0, 120),
      message: "The copy enumerates nearby communities. A city list is doorway-page behavior and is not permitted." });
  }

  if (v.city) {
    const occurrences = countOccurrences(text, v.city);
    if (occurrences > 2) {
      out.push({ code: "LOCALITY_STUFFING", severity: "warning", claim: v.city,
        message: `"${v.city}" appears ${occurrences} times. Mention the market area once or twice, naturally.` });
    }
  }
  // A place name the dealer never confirmed serving is an unverifiable
  // service-area claim, not merely awkward SEO.
  const servingClause = text.match(/\b(?:[Ss]erving|[Pp]roudly serving)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/);
  if (servingClause && approved.size && !approved.has(servingClause[1].toLowerCase().trim())) {
    out.push({ code: "UNAPPROVED_SERVICE_AREA", severity: "blocking", claim: servingClause[1],
      message: `"${servingClause[1]}" is not an approved market area for this store.` });
  }
  return out;
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  return (text.match(re) || []).length;
}

/** Model-facing voice block. Only approved claims are ever offered. */
export function voiceInstruction(v: VoiceProfile, channel?: string): string {
  const override = channel ? v.channelOverrides?.[channel] : undefined;
  const cta = override?.ctaTemplate || v.ctaTemplate
    || `Contact ${v.dealerName || "our team"} to schedule a test drive.`;
  const approvedLabels = GATED_DEALER_CLAIMS
    .filter((c) => v.approvedClaims.includes(c.key)).map((c) => c.label);

  const lines = [
    `DEALERSHIP VOICE — ${v.dealerName || "this dealership"} (profile ${v.version})`,
    v.brandPositioning ? `- Positioning: ${v.brandPositioning}` : "",
    v.city || v.state ? `- Location: ${[v.city, v.state].filter(Boolean).join(", ")}` : "",
    v.marketArea ? `- Market area: ${v.marketArea}. Mention it at most twice, naturally.` : "",
    // The approved areas were resolved once from the rooftop ZIP and are the
    // allowlist checkLocalityUse validates against. Without naming them here
    // the model could not use local relevance at all: any place it guessed was
    // rejected as an unapproved service area, so geography was permitted,
    // unstated and effectively forbidden at the same time.
    v.approvedAreas.length
      ? `- Approved localities (the ONLY places you may name): ${v.approvedAreas.slice(0, 12).join("; ")}.`
        + ` Name AT MOST TWO, each once, inside a sentence that would exist anyway.`
        + ` Never enumerate them, never write a "serving" list, never add a locality block.`
      : "",
    approvedLabels.length
      ? `- APPROVED dealership claims (the ONLY store claims you may make): ${approvedLabels.join("; ")}.`
      : "- NO dealership benefit claims are approved. Do not state anything about the store beyond its name and location.",
    v.differentiators.length ? `- Approved differentiators, use verbatim: ${v.differentiators.join(" | ")}` : "",
    `- Close with: ${cta}`,
    v.prohibitedPhrases.length ? `- Never use: ${v.prohibitedPhrases.join("; ")}.` : "",
    v.requiredDisclosures.length ? `- Include verbatim: ${v.requiredDisclosures.join(" ")}` : "",
    `- Terminology: certification "${v.certificationTerminology}", warranty "${v.warrantyTerminology}", finance "${v.financeTerminology}", trade "${v.tradeTerminology}", delivery "${v.deliveryTerminology}".`,
    override?.instruction ? `- ${override.instruction}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
