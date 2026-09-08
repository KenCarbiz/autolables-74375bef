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
  /**
   * Straight-line miles from the rooftop to each approved locality, keyed
   * exactly as `approvedAreas`. Populated ONLY when the list was derived from
   * the rooftop ZIP against a coordinate dataset; a hand-entered list has no
   * measured distance and none is invented for it.
   */
  areaDistances: Record<string, number>;
  /** The radius the list was derived at. 0 when nothing was measured. */
  geoRadiusMiles: number;
  geoMethod: "radius_derived" | "hand_entered";

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

/**
 * The stored market area, as measured rather than as typed.
 *
 * `selling_areas` is an allowlist of names and says nothing about where they
 * are. `selling_areas_meta` carries the derivation that produced them: the
 * rooftop ZIP, the radius, the dataset and the measured distance to each
 * locality. Absence of that envelope means the list was hand-entered, and a
 * hand-entered list is treated as unmeasured -- it still gates which places
 * may be named, it just cannot claim to be a radius.
 */
function resolveMarketRadius(settings: Record<string, any>): {
  areas: string[]; distances: Record<string, number>;
  radiusMiles: number; method: VoiceProfile["geoMethod"];
} {
  const meta = settings?.selling_areas_meta;
  const raw = (meta && typeof meta === "object" && !Array.isArray(meta))
    ? meta as Record<string, any> : {};
  const rows = Array.isArray(raw.areas) ? raw.areas : [];
  const radius = Number(raw.radius_miles ?? settings?.geo_radius_miles);
  const measured = String(raw.method || "") === "radius_derived"
    && rows.length > 0 && Number.isFinite(radius) && radius > 0;
  if (!measured) return { areas: [], distances: {}, radiusMiles: 0, method: "hand_entered" };

  const areas: string[] = [];
  const distances: Record<string, number> = {};
  for (const row of rows) {
    const name = String(row?.area ?? "").trim();
    if (!name) continue;
    areas.push(name);
    const miles = Number(row?.miles);
    // A row inside the envelope but outside the radius it claims is a stale
    // or edited entry. It stays a permitted place name and loses its distance.
    if (Number.isFinite(miles) && miles >= 0 && miles <= radius) distances[name] = miles;
  }
  return { areas, distances, radiusMiles: radius, method: "radius_derived" };
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

  const geo = resolveMarketRadius(settings);
  const approvedAreas = arr(p.approvedAreas, settings.selling_areas, geo.areas);
  // A distance only survives when it belongs to a place actually on the
  // allowlist. A profile that overrode the area names by hand keeps its names
  // and loses the measurements, rather than pairing one store's distances
  // with another's towns.
  const known = new Set(approvedAreas.map((a) => a.toLowerCase()));
  const areaDistances: Record<string, number> = {};
  for (const [name, miles] of Object.entries(geo.distances)) {
    if (known.has(name.toLowerCase())) areaDistances[name] = miles;
  }
  const geoMethod: VoiceProfile["geoMethod"] =
    geo.method === "radius_derived" && Object.keys(areaDistances).length
      ? "radius_derived" : "hand_entered";

  return {
    tenantId,
    dealerName: str(p.dealerName, settings.dealer_name_format, dealer?.dealer_name, dealer?.name),
    storeReference: str(p.storeReference, DEFAULTS.storeReference),
    city: str(p.city, settings.primary_city, dealer?.city),
    state: str(p.state, settings.state, dealer?.state),
    marketArea: str(p.marketArea),
    approvedAreas,
    areaDistances,
    geoRadiusMiles: geoMethod === "radius_derived" ? geo.radiusMiles : 0,
    geoMethod,
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
    JSON.stringify([...v.approvedAreas].sort()),
    JSON.stringify(Object.entries(v.areaDistances).sort()),
    v.geoRadiusMiles, v.geoMethod,
    v.brandPositioning, v.defaultTone,
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

/**
 * The localities offered to the writer for ONE vehicle.
 *
 * Fleet reach and per-description restraint pull in opposite directions. More
 * town names in a single description is doorway-page behaviour and is what
 * helpful-content ranking penalises; DIFFERENT town names across a hundred
 * descriptions is the only honest way a 45-mile radius gets covered. So the
 * cap per description stays small and the CHOICE rotates.
 *
 * Seeded by the VIN, so a vehicle always draws the same slate: a regeneration
 * is the same page rather than a new one, and the generation checksum (which
 * already carries the vehicle and the voice version) stays stable.
 *
 * When distances are measured the slate takes one locality from each distance
 * band, so every description carries the near market AND somewhere the radius
 * was widened to reach. Unmeasured lists fall back to a rotating window, which
 * still spreads the fleet without claiming to know where anything is.
 */
export function localitySlate(v: VoiceProfile, seed: string, size = 4): string[] {
  const areas = (v.approvedAreas || []).filter(Boolean);
  if (areas.length <= size) return [...areas];

  const measured = areas.filter((a) => Number.isFinite(v.areaDistances?.[a]));
  if (v.geoMethod === "radius_derived" && measured.length >= size) {
    const ordered = [...measured].sort(
      (a, b) => (v.areaDistances[a] - v.areaDistances[b]) || a.localeCompare(b));
    const picked: string[] = [];
    for (let band = 0; band < size; band++) {
      const from = Math.floor((band * ordered.length) / size);
      const to = Math.max(from + 1, Math.floor(((band + 1) * ordered.length) / size));
      const inBand = ordered.slice(from, to);
      // Hashed per band rather than offset from one hash: a single hash moves
      // every band together, so twelve localities would yield three distinct
      // slates for the whole lot instead of eighty-one.
      picked.push(inBand[fnv1a(`${seed}#${band}`) % inBand.length]);
    }
    return [...new Set(picked)];
  }

  const start = fnv1a(String(seed || "")) % areas.length;
  return Array.from({ length: size }, (_, i) => areas[(start + i) % areas.length]);
}

// Deterministic, dependency-free and synchronous: the slate is computed while
// the prompt is being built, so it cannot await a digest.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
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

  // Naming the store's own city and two nearby places is local relevance. A
  // fourth distinct approved locality is the same city list written as prose
  // instead of as a comma list, so the count is checked as well as the shape.
  const named = distinctLocalitiesNamed(text, localityNames(v));
  if (named.length > 3) {
    out.push({ code: "LOCALITY_STUFFING", severity: "warning", claim: named.join(", ").slice(0, 120),
      message: `${named.length} approved localities are named. Keep it to the store's own city and at most two others.` });
  }

  // The platform measures straight-line miles from the rooftop ZIP and
  // deliberately never gives that number to the writer: a shopper reads
  // "twelve miles away" as a drive, and no road distance was ever measured.
  // A distance or a drive time in copy is therefore an invented fact about a
  // real place, which is the same defect class as an invented vehicle fact.
  for (const m of text.matchAll(DISTANCE_CLAIM)) {
    const tail = String(m[1] || "").trim();
    if (!/^[A-Z]/.test(tail) && !/^(our|us)\b/i.test(tail)) continue;
    out.push({ code: "UNVERIFIED_DISTANCE_CLAIM", severity: "blocking",
      claim: m[0].trim().slice(0, 80),
      message: `"${m[0].trim().slice(0, 80)}" states a distance or travel time to a place. Distance to the market area is measured in straight lines and is never a drive; it may not appear in copy.` });
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

const DISTANCE_CLAIM =
  /\b(?:about|just|only|roughly|approximately|barely)?\s*\d{1,3}(?:\.\d)?\s*(?:miles?|minutes?|mins?|hours?)\s+(?:from|to|of|away from|north of|south of|east of|west of|outside)\s+((?:our\s+)?[A-Za-z][\w'.-]*)/g;

/** Every name a locality can legitimately be called in copy: the approved
 *  entries are stored as "Town, ST" and are written as "Town". */
function localityNames(v: VoiceProfile): string[] {
  const out = new Map<string, string>();
  for (const raw of [v.city, v.marketArea, ...(v.approvedAreas || [])]) {
    const name = String(raw || "").split(",")[0].trim();
    if (name) out.set(name.toLowerCase(), name);
  }
  return [...out.values()];
}

/** Longest name first, masking each match, so "East Hartford" is one locality
 *  rather than two. */
function distinctLocalitiesNamed(text: string, names: string[]): string[] {
  let rest = text;
  const found: string[] = [];
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    if (!re.test(rest)) continue;
    found.push(name);
    rest = rest.replace(re, " ");
  }
  return found;
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  return (text.match(re) || []).length;
}

/** Model-facing voice block. Only approved claims are ever offered.
 *  `localities` narrows the offered places to this vehicle's slate; without it
 *  the whole allowlist is offered, which is what a preview or a channel pass
 *  that has no vehicle in hand needs. */
export function voiceInstruction(
  v: VoiceProfile, channel?: string, localities?: string[],
): string {
  const override = channel ? v.channelOverrides?.[channel] : undefined;
  const cta = override?.ctaTemplate || v.ctaTemplate
    || `Contact ${v.dealerName || "our team"} to schedule a test drive.`;
  const approvedLabels = GATED_DEALER_CLAIMS
    .filter((c) => v.approvedClaims.includes(c.key)).map((c) => c.label);
  // Offering the same first twelve to every vehicle is what made the whole lot
  // name the same one or two towns: a slate is how the fleet spreads.
  const slateList = localities && localities.length ? localities : null;
  const slate = slateList !== null;
  const offered = slateList ?? v.approvedAreas.slice(0, 12);
  // Only a measured list may describe itself as a radius. A hand-entered one
  // still rotates -- that is a fleet-spread device, not a distance claim.
  const measured = slate && v.geoMethod === "radius_derived" && v.geoRadiusMiles > 0;

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
      ? `- Approved localities${slate ? " for THIS vehicle" : ""}${measured
          ? `, drawn from the ${v.geoRadiusMiles}-mile market area measured around this rooftop`
          : ""} (the ONLY places you may name): ${offered.join("; ")}.`
        + ` Name AT MOST TWO, each once, inside a sentence that would exist anyway.`
        + ` Never enumerate them, never write a "serving" list, never add a locality block.`
        + (slate ? ` Never state a distance, a drive time or a direction to any of them.` : "")
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
