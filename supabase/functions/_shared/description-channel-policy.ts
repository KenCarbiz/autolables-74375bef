// ─────────────────────────────────────────────────────────────────────
// Versioned channel policy registry.
//
// Every rule about a destination lives here — length, formatting, pricing,
// keywords, CTA, disclosures, connector truth. Nothing about a channel is
// allowed to live in a React component or inside a prompt string, because a
// rule that lives in two places drifts, and a drifted rule means copy that
// silently violates the destination it was written for.
//
// Platform limits we have not independently verified are marked
// `limit_verified: false` and carry an administrative owner. An unverified
// limit is a configuration to review, never a fact to assert.
// ─────────────────────────────────────────────────────────────────────

export type DeliveryMode = "internal_projection" | "export_only" | "connector";
export type ConnectorStatus = "available" | "not_configured" | "export_only";

export interface ChannelPolicy {
  key: string;
  label: string;
  active: boolean;

  /** Length */
  recommendedMin: number;
  recommendedMax: number;
  /** Hard cap enforced on the stored variant. */
  characterLimit: number;
  /** False when the cap is an administrative default we have not confirmed. */
  limitVerified: boolean;

  /** Structure */
  paragraphMin: number;
  paragraphMax: number;
  listsAllowed: boolean;
  htmlAllowed: boolean;
  markdownAllowed: boolean;
  emojiAllowed: boolean;
  linksAllowed: boolean;
  phoneAllowed: boolean;

  /** Content policy */
  pricingPolicy: "never" | "if_dealer_permits" | "required";
  keywordPolicy: "none" | "natural" | "structured";
  ctaPolicy: "none" | "soft" | "direct";
  seoFields: boolean;
  featureBudget: number;
  prohibitedPhrases: string[];
  requiredDisclosures: string[];

  /** Delivery truth */
  deliveryMode: DeliveryMode;
  connectorStatus: ConnectorStatus;

  /** Governance */
  policyVersion: string;
  lastReviewed: string;
  owner: string;

  /** Model instruction — the only place channel voice is expressed. */
  instruction: string;
}

const REVIEWED = "2026-07-27";
const OWNER = "autolabels_platform";

// A tenant may narrow any of these; the shipped values are the floor.
export const DEFAULT_CHANNEL_POLICIES: ChannelPolicy[] = [
  {
    key: "vehicle_passport", label: "Vehicle Passport", active: true,
    recommendedMin: 900, recommendedMax: 2000, characterLimit: 2400, limitVerified: true,
    paragraphMin: 3, paragraphMax: 5, listsAllowed: false, htmlAllowed: false,
    markdownAllowed: false, emojiAllowed: false, linksAllowed: false, phoneAllowed: true,
    pricingPolicy: "if_dealer_permits", keywordPolicy: "natural", ctaPolicy: "direct",
    seoFields: false, featureBudget: 10, prohibitedPhrases: [], requiredDisclosures: [],
    deliveryMode: "internal_projection", connectorStatus: "available",
    policyVersion: "cp_passport_1", lastReviewed: REVIEWED, owner: OWNER,
    instruction: "Full merchandising copy for the dealer's own shopper page. Rich detail, natural prose, no marketplace formatting tokens.",
  },
  {
    key: "dealer_website", label: "Dealer Website", active: true,
    recommendedMin: 1000, recommendedMax: 2200, characterLimit: 2400, limitVerified: true,
    paragraphMin: 3, paragraphMax: 6, listsAllowed: true, htmlAllowed: false,
    markdownAllowed: false, emojiAllowed: false, linksAllowed: true, phoneAllowed: true,
    pricingPolicy: "if_dealer_permits", keywordPolicy: "natural", ctaPolicy: "direct",
    seoFields: true, featureBudget: 12, prohibitedPhrases: [], requiredDisclosures: [],
    // The shopper listing IS the published surface; a separately-hosted dealer
    // site has no connector, so this stays export-only rather than claiming a
    // delivery we never perform.
    deliveryMode: "export_only", connectorStatus: "export_only",
    policyVersion: "cp_website_1", lastReviewed: REVIEWED, owner: OWNER,
    instruction: "The richest merchandising version. Clear paragraphs, meaningful vehicle detail, genuine local relevance, a strong approved call to action. Avoid repetitive dealership boilerplate and never keyword-stuff.",
  },
  {
    key: "autotrader", label: "AutoTrader", active: true,
    recommendedMin: 700, recommendedMax: 1300, characterLimit: 1500, limitVerified: false,
    paragraphMin: 3, paragraphMax: 4, listsAllowed: false, htmlAllowed: false,
    markdownAllowed: false, emojiAllowed: false, linksAllowed: false, phoneAllowed: false,
    pricingPolicy: "never", keywordPolicy: "natural", ctaPolicy: "direct",
    seoFields: false, featureBudget: 8, prohibitedPhrases: [], requiredDisclosures: [],
    deliveryMode: "export_only", connectorStatus: "export_only",
    policyVersion: "cp_autotrader_1", lastReviewed: REVIEWED, owner: OWNER,
    instruction: "Inventory-listing structure. Lead with vehicle identity and the meaningful differentiators, then readable paragraphs of verified equipment. No superlatives, no keyword stuffing. Close with the approved dealer call to action.",
  },
  {
    key: "cars_com", label: "Cars.com", active: true,
    recommendedMin: 700, recommendedMax: 1300, characterLimit: 1500, limitVerified: false,
    paragraphMin: 3, paragraphMax: 4, listsAllowed: false, htmlAllowed: false,
    markdownAllowed: false, emojiAllowed: false, linksAllowed: false, phoneAllowed: false,
    pricingPolicy: "never", keywordPolicy: "natural", ctaPolicy: "soft",
    seoFields: false, featureBudget: 8, prohibitedPhrases: [], requiredDisclosures: [],
    deliveryMode: "connector", connectorStatus: "not_configured",
    policyVersion: "cp_carscom_1", lastReviewed: REVIEWED, owner: OWNER,
    instruction: "Scannable equipment and ownership usefulness. Group related equipment instead of listing it item by item. Factual tone throughout; no redundant feature restatement.",
  },
  {
    key: "cargurus", label: "CarGurus", active: true,
    recommendedMin: 500, recommendedMax: 1000, characterLimit: 1200, limitVerified: false,
    paragraphMin: 2, paragraphMax: 3, listsAllowed: false, htmlAllowed: false,
    markdownAllowed: false, emojiAllowed: false, linksAllowed: false, phoneAllowed: false,
    // CarGurus computes its own deal rating. Any price or value framing we write
    // would be an unverifiable claim about their algorithm's output.
    pricingPolicy: "never", keywordPolicy: "natural", ctaPolicy: "soft",
    seoFields: false, featureBudget: 6,
    prohibitedPhrases: ["great deal", "good deal", "fair deal", "below market", "great price"],
    requiredDisclosures: [],
    deliveryMode: "export_only", connectorStatus: "export_only",
    policyVersion: "cp_cargurus_1", lastReviewed: REVIEWED, owner: OWNER,
    instruction: "Concise differentiation. State what makes this specific vehicle worth a look using verified equipment only. Never characterize the price, the deal, or the market position.",
  },
  {
    key: "facebook", label: "Facebook Marketplace", active: true,
    recommendedMin: 350, recommendedMax: 800, characterLimit: 900, limitVerified: false,
    paragraphMin: 2, paragraphMax: 3, listsAllowed: false, htmlAllowed: false,
    markdownAllowed: false, emojiAllowed: false, linksAllowed: false, phoneAllowed: false,
    pricingPolicy: "never", keywordPolicy: "none", ctaPolicy: "soft",
    seoFields: false, featureBudget: 5,
    prohibitedPhrases: ["won't last", "wont last", "act fast", "hurry", "today only", "must go"],
    requiredDisclosures: [],
    deliveryMode: "export_only", connectorStatus: "export_only",
    policyVersion: "cp_facebook_1", lastReviewed: REVIEWED, owner: OWNER,
    instruction: "Shorter and conversational but still professional. Mobile-first, short paragraphs. No urgency language, no bait pricing. Direct the shopper to message or visit the dealership.",
  },
  {
    key: "google_seo", label: "Google Search Listing", active: true,
    recommendedMin: 400, recommendedMax: 800, characterLimit: 900, limitVerified: true,
    paragraphMin: 2, paragraphMax: 3, listsAllowed: false, htmlAllowed: false,
    markdownAllowed: false, emojiAllowed: false, linksAllowed: false, phoneAllowed: false,
    pricingPolicy: "never", keywordPolicy: "structured", ctaPolicy: "soft",
    seoFields: true, featureBudget: 6, prohibitedPhrases: [], requiredDisclosures: [],
    deliveryMode: "export_only", connectorStatus: "export_only",
    policyVersion: "cp_googleseo_1", lastReviewed: REVIEWED, owner: OWNER,
    instruction: "Natural search-facing language a person would actually read. Descriptive vehicle identity, one genuine mention of the market area, real customer usefulness. Produce an SEO title (<=60 chars), a meta description (<=155 chars) and the body. No keyword blocks, no city lists.",
  },
  {
    // vAuto is an inventory-management and merchandising workflow, NOT a
    // consumer marketplace. Its copy is written to be syndicated onward by the
    // dealer's own distribution, so it stays neutral and portable: no
    // destination-specific formatting and no pricing, because vAuto is where
    // pricing is managed.
    key: "vauto", label: "vAuto", active: true,
    // Owner decision: 3,879 is a CEILING, never a floor. A recommendedMin of
    // zero means exactly that, and buildChannelPromptV3 renders a ceiling
    // rather than a range when it sees one — so nothing instructs the writer
    // to reach a length it has no verified facts for.
    recommendedMin: 0, recommendedMax: 3879, characterLimit: 3879, limitVerified: false,
    paragraphMin: 4, paragraphMax: 8, listsAllowed: false, htmlAllowed: false,
    markdownAllowed: false, emojiAllowed: false, linksAllowed: false, phoneAllowed: false,
    pricingPolicy: "never", keywordPolicy: "natural", ctaPolicy: "none",
    seoFields: false, featureBudget: 10, prohibitedPhrases: [], requiredDisclosures: [],
    // Export-only until a dealer actually configures a vAuto connector. This
    // is the honest state, not a placeholder: AutoLabels can produce a
    // vAuto-compatible export and nothing more.
    deliveryMode: "export_only", connectorStatus: "export_only",
    policyVersion: "cp_vauto_1", lastReviewed: REVIEWED, owner: OWNER,
    instruction: "Neutral, portable merchandising copy intended to be syndicated onward by the dealer's inventory workflow. Complete equipment coverage in readable prose, no destination-specific formatting, no price or payment language, no marketplace call to action.",
  },
];

/**
 * How a channel rule was established. Phase 5's rule: an AutoLabels preference
 * must never be presented as a marketplace requirement, so provenance travels
 * with the policy rather than living in a comment.
 */
export type RuleProvenance =
  | "provider_required" | "connector_required" | "tenant_required"
  | "autolabels_best_practice" | "seo_recommendation" | "awaiting_confirmation";

export interface ChannelProvenance {
  channel: string;
  /** Why the length cap is what it is. */
  lengthLimit: RuleProvenance;
  formatting: RuleProvenance;
  pricing: RuleProvenance;
  prohibitedPhrases: RuleProvenance;
  /** Free-text source note. Empty means we have not confirmed a source. */
  sourceNote: string;
}

// Deliberately conservative. Where a published platform limit has not been
// confirmed by the team, the rule is recorded as an AutoLabels default
// awaiting confirmation rather than asserted as the marketplace's requirement.
export const CHANNEL_PROVENANCE: ChannelProvenance[] = [
  { channel: "vehicle_passport", lengthLimit: "tenant_required", formatting: "provider_required",
    pricing: "tenant_required", prohibitedPhrases: "tenant_required",
    sourceNote: "AutoLabels owns this surface end to end." },
  { channel: "dealer_website", lengthLimit: "autolabels_best_practice", formatting: "autolabels_best_practice",
    pricing: "tenant_required", prohibitedPhrases: "tenant_required",
    sourceNote: "Website providers vary; these are AutoLabels defaults, not a provider mandate." },
  { channel: "autotrader", lengthLimit: "awaiting_confirmation", formatting: "autolabels_best_practice",
    pricing: "autolabels_best_practice", prohibitedPhrases: "autolabels_best_practice",
    sourceNote: "Length cap is an AutoLabels default. Confirm against the dealer's current AutoTrader feed spec before treating it as a provider requirement." },
  { channel: "cars_com", lengthLimit: "awaiting_confirmation", formatting: "autolabels_best_practice",
    pricing: "autolabels_best_practice", prohibitedPhrases: "autolabels_best_practice",
    sourceNote: "Length cap is an AutoLabels default awaiting confirmation against the current Cars.com feed spec." },
  { channel: "cargurus", lengthLimit: "awaiting_confirmation", formatting: "autolabels_best_practice",
    pricing: "autolabels_best_practice", prohibitedPhrases: "autolabels_best_practice",
    sourceNote: "Deal-rating language is blocked as an AutoLabels compliance decision: CarGurus computes its own rating and we cannot assert its output." },
  { channel: "facebook", lengthLimit: "awaiting_confirmation", formatting: "autolabels_best_practice",
    pricing: "autolabels_best_practice", prohibitedPhrases: "autolabels_best_practice",
    sourceNote: "Urgency phrasing is blocked as an AutoLabels advertising-compliance decision, not a Marketplace rule." },
  { channel: "google_seo", lengthLimit: "seo_recommendation", formatting: "seo_recommendation",
    pricing: "autolabels_best_practice", prohibitedPhrases: "autolabels_best_practice",
    sourceNote: "Meta-description length is an SEO recommendation. Nothing here is published to Google by AutoLabels." },
  { channel: "vauto", lengthLimit: "awaiting_confirmation", formatting: "autolabels_best_practice",
    pricing: "autolabels_best_practice", prohibitedPhrases: "autolabels_best_practice",
    sourceNote: "vAuto field mapping and limits are not confirmed. Treat this policy as an AutoLabels export default until a dealer's vAuto configuration is supplied." },
];

export const provenanceFor = (channel: string) =>
  CHANNEL_PROVENANCE.find((p) => p.channel === channel);

export const policyByKey = (k: string): ChannelPolicy | undefined =>
  DEFAULT_CHANNEL_POLICIES.find((p) => p.key === k);

/** Fields a tenant is permitted to narrow. Delivery truth is not one of them. */
const TENANT_OVERRIDABLE = new Set([
  "active", "recommendedMin", "recommendedMax", "characterLimit", "paragraphMin",
  "paragraphMax", "listsAllowed", "emojiAllowed", "linksAllowed", "phoneAllowed",
  "pricingPolicy", "keywordPolicy", "ctaPolicy", "featureBudget",
  "prohibitedPhrases", "requiredDisclosures", "instruction",
]);

/**
 * Merge a stored tenant override onto the shipped policy.
 *
 * `deliveryMode` and `connectorStatus` are deliberately NOT overridable: a
 * tenant flipping a channel to "connector" would let the UI report a
 * publication that never happened. Connector truth is a platform fact.
 */
export function resolveChannelPolicy(
  key: string, override?: Record<string, unknown> | null,
): ChannelPolicy | undefined {
  const base = policyByKey(key);
  if (!base) return undefined;
  if (!override) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === null || v === undefined) continue;
    if (!TENANT_OVERRIDABLE.has(k)) continue;
    merged[k] = v;
  }
  // A tenant may tighten a cap but never raise it past what the destination
  // is believed to accept.
  merged.characterLimit = Math.min(Number(merged.characterLimit) || base.characterLimit, base.characterLimit);
  merged.prohibitedPhrases = dedupe([
    ...base.prohibitedPhrases,
    ...(Array.isArray(override.prohibitedPhrases) ? override.prohibitedPhrases.map(String) : []),
  ]);
  merged.requiredDisclosures = dedupe([
    ...base.requiredDisclosures,
    ...(Array.isArray(override.requiredDisclosures) ? override.requiredDisclosures.map(String) : []),
  ]);
  return merged as unknown as ChannelPolicy;
}

/**
 * The version a generated variant is stamped with. Derived from the resolved
 * policy so a tenant override produces a distinct version — an approved
 * description keeps the policy it was written under even after the tenant
 * edits the channel.
 */
export async function computeChannelPolicyVersion(p: ChannelPolicy): Promise<string> {
  const material = [
    p.key, p.active, p.recommendedMin, p.recommendedMax, p.characterLimit,
    p.paragraphMin, p.paragraphMax, p.listsAllowed, p.htmlAllowed, p.markdownAllowed,
    p.emojiAllowed, p.linksAllowed, p.phoneAllowed, p.pricingPolicy, p.keywordPolicy,
    p.ctaPolicy, p.seoFields, p.featureBudget,
    JSON.stringify([...p.prohibitedPhrases].sort()),
    JSON.stringify([...p.requiredDisclosures].sort()),
    p.instruction, p.policyVersion,
  ].map((x) => String(x ?? "")).join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return `${p.policyVersion}.` + Array.from(new Uint8Array(digest)).slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Channel-policy conformance for an already-generated variant. */
export interface PolicyFinding {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
}

export function checkChannelPolicy(content: string, p: ChannelPolicy): PolicyFinding[] {
  const out: PolicyFinding[] = [];
  const text = content || "";
  const lc = text.toLowerCase();

  if (text.length > p.characterLimit) {
    out.push({ code: "CHANNEL_LENGTH_EXCEEDED", severity: "warning",
      message: `${p.label} limit exceeded by ${text.length - p.characterLimit} characters (${text.length}/${p.characterLimit}).` });
  } else if (text.length < p.recommendedMin) {
    out.push({ code: "LENGTH_BELOW_MINIMUM", severity: "warning",
      message: `Only ${text.length} characters; ${p.label} reads best from ${p.recommendedMin}.` });
  }

  if (!p.markdownAllowed && /(^|\n)\s*[#>*-]\s|\*\*|__/.test(text)) {
    out.push({ code: "CHANNEL_FORMAT_INVALID", severity: "warning",
      message: `${p.label} does not render markdown.` });
  }
  if (!p.htmlAllowed && /<[a-z][^>]*>/i.test(text)) {
    out.push({ code: "CHANNEL_FORMAT_INVALID", severity: "warning",
      message: `${p.label} does not render HTML.` });
  }
  if (!p.emojiAllowed && /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) {
    out.push({ code: "CHANNEL_EMOJI_NOT_ALLOWED", severity: "warning",
      message: `${p.label} copy should not contain emoji.` });
  }
  if (!p.linksAllowed && /https?:\/\/|www\./i.test(text)) {
    out.push({ code: "CHANNEL_LINK_NOT_ALLOWED", severity: "warning",
      message: `${p.label} does not permit links in the description body.` });
  }
  if (!p.phoneAllowed && /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(text)) {
    out.push({ code: "CHANNEL_PHONE_NOT_ALLOWED", severity: "warning",
      message: `${p.label} does not permit a phone number in the description body.` });
  }
  // A price where the destination forbids one is a compliance problem, not a
  // style problem: the marketplace shows its own price and a second, stale
  // figure in the copy is a misstatement to the shopper.
  if (p.pricingPolicy === "never" && /\$\s?\d[\d,]{2,}/.test(text)) {
    out.push({ code: "CHANNEL_PRICE_NOT_ALLOWED", severity: "blocking",
      message: `${p.label} publishes its own pricing; a price in the description body is not permitted.` });
  }
  for (const phrase of p.prohibitedPhrases) {
    if (phrase && lc.includes(phrase.toLowerCase())) {
      out.push({ code: "CHANNEL_PROHIBITED_PHRASE", severity: "blocking",
        message: `"${phrase}" is not permitted on ${p.label}.` });
    }
  }
  for (const d of p.requiredDisclosures) {
    if (d && !lc.includes(d.toLowerCase())) {
      out.push({ code: "CHANNEL_DISCLOSURE_MISSING", severity: "blocking",
        message: `${p.label} requires the disclosure "${d}".` });
    }
  }
  const paragraphs = text.split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s.length > 40).length;
  if (paragraphs > p.paragraphMax) {
    out.push({ code: "CHANNEL_STRUCTURE_WARNING", severity: "info",
      message: `${paragraphs} paragraphs; ${p.label} reads best with at most ${p.paragraphMax}.` });
  }
  if (p.ctaPolicy !== "none" && !/\b(contact|call|visit|schedule|stop by|reach out|message|test drive)\b/i.test(text)) {
    out.push({ code: "CTA_MISSING", severity: "warning",
      message: `No call to action detected for ${p.label}.` });
  }
  return out;
}

const dedupe = (a: string[]) => [...new Set(a.filter(Boolean).map((s) => String(s)))];
