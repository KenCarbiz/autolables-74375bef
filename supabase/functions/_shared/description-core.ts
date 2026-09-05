// ─────────────────────────────────────────────────────────────────────
// Description Intelligence — server-side core.
//
// Authoritative home for: the source-data fingerprint, the trusted fact
// snapshot, channel rules, prompt construction, and the validation engine.
// The browser never runs these — it reads the stored results.
//
// The one rule everything here protects: the model decides HOW to say a
// verified fact, never WHETHER the fact is true. Market intelligence
// (value, comps, depreciation, resale) is carried as supporting context and
// can never be promoted into a vehicle claim.
// ─────────────────────────────────────────────────────────────────────

import {
  DEFAULT_CHANNEL_POLICIES, resolveChannelPolicy, checkChannelPolicy,
  computeChannelPolicyVersion, type ChannelPolicy,
} from "./description-channel-policy.ts";
import {
  normalizeFeatures, prioritizeFeatures, splitByOrigin, featureChecksum,
  type NormalizedFeature, type PrioritizedFeature, type RawFeatureInput, type ToneKey,
} from "./description-features.ts";
import { toneProfile, toneInstruction, checkTone, isToneKey, TONE_PROFILES } from "./description-tone.ts";
import {
  resolveVoiceProfile, computeVoiceProfileVersion, voiceInstruction,
  checkDealerClaims, checkLocalityUse, type VoiceProfile,
} from "./description-voice.ts";
import {
  scoreDescription, countFactsUsed, analyzeReadability, analyzeUniqueness,
  analyzeKeywords, SCORE_VERSION,
  type ScoreBreakdown, type ComparisonDoc, type SeoTargeting,
} from "./description-scoring.ts";

export {
  DEFAULT_CHANNEL_POLICIES, resolveChannelPolicy, checkChannelPolicy, computeChannelPolicyVersion,
  normalizeFeatures, prioritizeFeatures, splitByOrigin, featureChecksum,
  toneProfile, toneInstruction, checkTone, isToneKey, TONE_PROFILES,
  resolveVoiceProfile, computeVoiceProfileVersion, voiceInstruction, checkDealerClaims, checkLocalityUse,
  scoreDescription, countFactsUsed, analyzeReadability, analyzeUniqueness, analyzeKeywords, SCORE_VERSION,
};
export type {
  ChannelPolicy, NormalizedFeature, PrioritizedFeature, RawFeatureInput, ToneKey,
  VoiceProfile, ScoreBreakdown, ComparisonDoc, SeoTargeting,
};

export type FactStatus =
  | "verified" | "dealer_entered" | "feed_provided"
  | "calculated" | "inferred" | "disputed" | "pending";

export interface Fact {
  value: string | number | boolean | null;
  field: string;
  source: string;
  status: FactStatus;
  observed_at: string | null;
  usable_in_copy: boolean;
  evidence?: string | null;
  overridden_by?: string | null;
}

export interface FactSnapshot {
  facts: Record<string, Fact>;
  lineage: Record<string, { source: string; status: FactStatus; observed_at: string | null }>;
  conflicts: Array<{ field: string; values: Array<{ value: unknown; source: string; observed_at?: string | null }>; material: boolean }>;
  excluded_claims: Array<{ field: string; reason: string; claim?: string }>;
  market_context: Record<string, unknown>;
  fact_confidence: number;
  /**
   * Canonical, de-duplicated equipment with origin attached. Factory and
   * dealer-added never merge — the flat `facts.equipment` string cannot
   * express that distinction, so it stays for backward compatibility while
   * this is what V3 generation and the UI read.
   */
  features: NormalizedFeature[];
}

// ── Channel registry ─────────────────────────────────────────────────
// delivery_mode drives publication truth. Only `internal_projection`
// channels can ever be reported as published, because they are the only
// ones we actually write. Everything else is honestly export-only until a
// real connector exists.
export interface ChannelRule {
  key: string;
  label: string;
  characterLimit: number;
  minLength: number;
  deliveryMode: "internal_projection" | "export_only" | "connector";
  connectorStatus: "available" | "not_configured" | "export_only";
  seoFields: boolean;
  instruction: string;
}

// Derived from the versioned policy registry — there is exactly one place a
// channel rule is written down. `ChannelRule` remains the narrow shape the
// generator and the UI already consume; the full policy is available through
// `policyForChannel` when a caller needs the rest of the contract.
export const CHANNELS: ChannelRule[] = DEFAULT_CHANNEL_POLICIES.map((p) => ({
  key: p.key,
  label: p.label,
  characterLimit: p.characterLimit,
  minLength: p.recommendedMin,
  deliveryMode: p.deliveryMode,
  connectorStatus: p.connectorStatus,
  seoFields: p.seoFields,
  instruction: p.instruction,
}));

export const channelByKey = (k: string) => CHANNELS.find((c) => c.key === k);

export const policyForChannel = (k: string, override?: Record<string, unknown> | null) =>
  resolveChannelPolicy(k, override);

// ── Claims that require authoritative evidence ───────────────────────
// Each phrase may only appear when the guarding fact is verified AND the
// dealer's configuration permits the language.
export const CONTROLLED_CLAIMS: Array<{ pattern: RegExp; code: string; requires: string; label: string }> = [
  { pattern: /\bcertified\s+pre[- ]?owned\b|\bcertified\b/i, code: "CPO_CLAIM", requires: "cpo_status", label: "certified" },
  { pattern: /\bfactory\s+warranty\b|\bwarranty\s+included\b|\bremaining\s+warranty\b/i, code: "WARRANTY_CLAIM", requires: "warranty_eligible", label: "warranty" },
  { pattern: /\bone[- ]owner\b|\bsingle[- ]owner\b/i, code: "OWNERSHIP_CLAIM", requires: "one_owner", label: "one owner" },
  { pattern: /\baccident[- ]free\b|\bno\s+accidents\b|\bclean\s+history\b/i, code: "HISTORY_CLAIM", requires: "clean_history", label: "accident free" },
  { pattern: /\bbelow\s+market\b|\bbest\s+price\b|\blowest\s+price\b|\bgreat\s+deal\b|\bunbeatable\b/i, code: "MARKET_CLAIM", requires: "__market_context_allowed", label: "market/price claim" },
  { pattern: /\bnew\s+tires\b|\bnew\s+brakes\b/i, code: "SERVICE_CLAIM", requires: "__never", label: "new tires/brakes" },
  { pattern: /\bfully\s+inspected\b|\bdealer\s+serviced\b|\bfully\s+serviced\b/i, code: "SERVICE_CLAIM", requires: "__never", label: "inspection/service" },
  { pattern: /\bgarage[- ]kept\b|\bnever\s+smoked\s+in\b|\blike\s+new\b/i, code: "CONDITION_CLAIM", requires: "__never", label: "condition claim" },
  { pattern: /\brecall[s]?\s+(complete|completed|performed|done)\b/i, code: "RECALL_CLAIM", requires: "__never", label: "recall completion" },
];

// Re-ordering the same option list must not look like a data change.
const sortedList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x: any) => (typeof x === "string" ? x : x?.name ?? ""))
    .filter(Boolean).map((s: string) => s.trim().toLowerCase()).sort();

const norm = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
};

// ── Source-data fingerprint ──────────────────────────────────────────
// Deterministic over the fields that can actually change the copy, so a
// nightly feed that only moves price/photos does not force regeneration.
export async function computeSourceDataVersion(
  listing: Record<string, any>,
  configVersion: string,
  priceMatters: boolean,
): Promise<string> {
  const mc = (listing.mc_attributes || {}) as Record<string, any>;
  const parts: string[] = [
    norm(listing.vin), norm(listing.ymm), norm(listing.trim), norm(listing.condition),
    norm(listing.mileage),
    norm(mc.exterior_color ?? mc.base_ext_color), norm(mc.interior_color ?? mc.base_int_color),
    norm(mc.engine), norm(mc.transmission), norm(mc.drivetrain), norm(mc.fuel_type),
    norm(mc.body_type), norm(mc.seating ?? mc.std_seating),
    norm(JSON.stringify(sortedList(mc.options))), norm(JSON.stringify(sortedList(mc.features))),
    norm(JSON.stringify(sortedList(listing.features))),
    norm(JSON.stringify((listing.certification || {})?.certified ?? "")),
    norm(JSON.stringify(listing.warranty_info ?? {})),
    norm(JSON.stringify(listing.available_accessories ?? [])),
    // these arrive AFTER ingest and change what may be claimed, so they must
    // move the fingerprint or the vehicle would never be reconsidered
    norm(listing.history_report_url), norm(mc.carfax_1_owner), norm(mc.carfax_clean_title),
    norm((listing.certification || {})?.program), norm((listing.certification || {})?.verified_at),
    norm(listing.recall_status),
    priceMatters ? norm(listing.price) : "",
    configVersion,
  ];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  return "sdv_" + Array.from(new Uint8Array(digest)).slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeConfigVersion(settings: Record<string, any>): Promise<string> {
  const material = [
    settings.review_mode, JSON.stringify(settings.enabled_channels ?? []), settings.brand_voice,
    settings.default_tone, settings.dealer_name_format, settings.primary_city, settings.state,
    JSON.stringify(settings.selling_areas ?? []), settings.cta_template,
    JSON.stringify(settings.prohibited_phrases ?? []), settings.required_legal_text,
    settings.min_length, settings.max_length, JSON.stringify(settings.class_rules ?? {}),
    settings.warranty_language_allowed, settings.cpo_language_allowed,
    settings.accessory_language_allowed, settings.market_context_allowed,
    settings.price_in_description, settings.generation_model, settings.prompt_version,
  ].map(norm).join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return "cfg_" + Array.from(new Uint8Array(digest)).slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Fact snapshot ────────────────────────────────────────────────────
// A resolved conflict is a durable decision: `include` promotes the claim to a
// dealer-confirmed fact, `exclude` keeps it out of copy. Either way the
// conflict stops being material, so the vehicle stops being blocked forever.
export interface FactOverride { field_key: string; decision: "include" | "exclude"; value?: string | null }

export function buildFactSnapshot(
  listing: Record<string, any>,
  settings: Record<string, any>,
  dealer: Record<string, any> | null,
  overrides: FactOverride[] = [],
): FactSnapshot {
  // Conflict detection compares equipment names case-insensitively, so the
  // override lookup must too — otherwise the feed switching "Bose" to "BOSE"
  // re-raises a conflict the manager already answered.
  const overrideBy = new Map(overrides.map((o) => [String(o.field_key || "").toLowerCase().trim(), o]));
  const mc = (listing.mc_attributes || {}) as Record<string, any>;
  const facts: Record<string, Fact> = {};
  const conflicts: FactSnapshot["conflicts"] = [];
  const excluded: FactSnapshot["excluded_claims"] = [];
  const now = listing.enriched_at || listing.scrape_last_synced_at || null;

  const put = (field: string, value: unknown, source: string, status: FactStatus, usable = true, evidence?: string) => {
    if (value === null || value === undefined || value === "") return;
    facts[field] = { field, value: value as any, source, status, observed_at: now, usable_in_copy: usable, evidence: evidence ?? null };
  };

  // Identity — VIN-decoded / feed identity is the authoritative spine.
  put("vin", listing.vin, "inventory_record", "verified");
  put("ymm", listing.ymm, "marketcheck_feed", "feed_provided");
  put("trim", listing.trim, "marketcheck_feed", "feed_provided");
  put("condition", listing.condition, "inventory_record", "feed_provided");
  put("mileage", listing.mileage, "marketcheck_feed", "feed_provided");
  put("stock_number", mc.stock_no, "marketcheck_feed", "feed_provided");

  // Mechanical / appearance — NeoVIN build decode is OEM-grade.
  const decoded = String(mc.specs_source || "") === "neovin" || Array.isArray(mc.options);
  put("engine", mc.engine, decoded ? "vin_decode" : "marketcheck_feed", decoded ? "verified" : "feed_provided");
  put("transmission", mc.transmission, decoded ? "vin_decode" : "marketcheck_feed", decoded ? "verified" : "feed_provided");
  put("drivetrain", mc.drivetrain, decoded ? "vin_decode" : "marketcheck_feed", decoded ? "verified" : "feed_provided");
  put("fuel_type", mc.fuel_type, "marketcheck_feed", "feed_provided");
  put("body_style", mc.body_type, "marketcheck_feed", "feed_provided");
  put("seating", mc.seating ?? mc.std_seating, "marketcheck_feed", "feed_provided");
  put("exterior_color", mc.exterior_color ?? mc.base_ext_color, "marketcheck_feed", "feed_provided");
  put("interior_color", mc.interior_color ?? mc.base_int_color, "marketcheck_feed", "feed_provided");

  // Equipment — feed list vs decoded list. Disagreement is a real conflict,
  // and the disputed item is withheld from auto-published copy.
  const feedFeatures: string[] = Array.isArray(listing.features)
    ? listing.features.map((f: any) => (typeof f === "string" ? f : f?.name)).filter(Boolean)
    : [];
  const decodedOptions: string[] = [
    ...(Array.isArray(mc.options) ? mc.options : []),
    ...(Array.isArray(mc.features) ? mc.features : []),
  ].map((o: any) => (typeof o === "string" ? o : o?.name)).filter(Boolean);

  const lower = (a: string[]) => a.map((s) => s.toLowerCase().trim());
  const feedLower = lower(feedFeatures);
  const decLower = lower(decodedOptions);
  const agreed = decodedOptions.filter((o) => feedLower.includes(o.toLowerCase().trim()));
  const decodedOnly = decodedOptions.filter((o) => !feedLower.includes(o.toLowerCase().trim()));
  const feedOnly = feedFeatures.filter((f) => !decLower.includes(f.toLowerCase().trim()));

  // Premium/named equipment claimed by exactly one source is material:
  // it is the "Bose" case — exclude until a human resolves it.
  const PREMIUM = /\b(bose|harman|burmester|mark levinson|bang\s*&\s*olufsen|premium audio|panoramic|head-?up|massage|nappa|adaptive cruise|night vision)\b/i;
  const confirmedEquipment: string[] = [];
  for (const item of [...decodedOnly, ...feedOnly]) {
    if (!PREMIUM.test(item)) continue;
    const fromDecode = decodedOnly.includes(item);
    const ov = overrideBy.get(`equipment:${item}`.toLowerCase().trim());
    if (ov?.decision === "include") { confirmedEquipment.push(item); continue; }
    if (ov?.decision === "exclude") {
      // decided by a manager — still withheld from copy, but no longer blocking
      excluded.push({ field: `equipment:${item}`, reason: "resolved_excluded", claim: item });
      continue;
    }
    conflicts.push({
      field: `equipment:${item}`,
      values: [
        { value: fromDecode ? "not listed" : item, source: "marketcheck_feed",
          observed_at: listing.scrape_last_synced_at || now },
        { value: fromDecode ? item : "not listed", source: "vin_decode",
          observed_at: mc.specs_decoded_at || listing.enriched_at || now },
      ],
      material: true,
    });
    excluded.push({ field: `equipment:${item}`, reason: "equipment_conflict", claim: item });
  }
  const excludedNames = new Set(excluded.map((e) => (e.claim || "").toLowerCase()));
  const safeEquipment = [...agreed, ...confirmedEquipment,
                         ...decodedOnly.filter((o) => !excludedNames.has(o.toLowerCase()) && !confirmedEquipment.includes(o)),
                         ...feedOnly.filter((o) => !excludedNames.has(o.toLowerCase()) && !confirmedEquipment.includes(o))];
  if (safeEquipment.length) {
    facts.equipment = {
      field: "equipment", value: safeEquipment.slice(0, 40).join(", "),
      source: decodedOnly.length ? "vin_decode+feed" : "marketcheck_feed",
      status: agreed.length ? "verified" : "feed_provided",
      observed_at: now, usable_in_copy: true,
    };
  }

  // CPO — only claimable when an approved source confirms it AND the dealer
  // allows CPO language. A feed flag alone is never enough.
  const certification = (listing.certification || {}) as Record<string, any>;
  const feedSaysCpo = String(listing.condition || "").toLowerCase() === "cpo" || certification?.certified === true;
  const cpoConfirmed = !!(certification?.program || certification?.verified_at || certification?.source);
  // A manager decision on CPO is durable: once ruled on, the conflict never
  // re-raises, or the vehicle blocks on the same question every night.
  const cpoOverride = overrideBy.get("cpo_status");
  if (feedSaysCpo && !cpoConfirmed && cpoOverride?.decision) {
    if (cpoOverride.decision === "include" && settings.cpo_language_allowed) {
      put("cpo_status", "Certified Pre-Owned", "manager_resolution", "dealer_entered");
    } else {
      excluded.push({
        field: "cpo_status",
        reason: cpoOverride.decision === "include" ? "cpo_language_disabled" : "resolved_excluded",
        claim: "certified",
      });
    }
  } else if (feedSaysCpo && !cpoConfirmed) {
    conflicts.push({
      field: "cpo_status",
      values: [
        { value: "CPO", source: "marketcheck_feed", observed_at: listing.scrape_last_synced_at || now },
        { value: "unconfirmed", source: "cpo_program_source", observed_at: null },
      ],
      material: true,
    });
    excluded.push({ field: "cpo_status", reason: "cpo_unconfirmed", claim: "certified" });
  } else if (feedSaysCpo && cpoConfirmed && settings.cpo_language_allowed) {
    put("cpo_status", "Certified Pre-Owned", "cpo_program_source", "verified");
    if (certification?.program) put("cpo_program", certification.program, "cpo_program_source", "verified");
  } else if (feedSaysCpo && !settings.cpo_language_allowed) {
    excluded.push({ field: "cpo_status", reason: "cpo_language_disabled", claim: "certified" });
  }

  // Warranty — FACT-GATED, not permission-gated.
  //
  // This used to sit behind a blanket warranty_language_allowed flag that
  // defaulted off, so a dealership with genuine verified remaining coverage
  // could not mention it while a dealership with none was equally silent — the
  // setting decided, not the vehicle. The gate is now the data: coverage is
  // stated only when the record actually carries it, and the specific terms are
  // stated only when the specific terms are known.
  //
  // The flag survives as an explicit suppression switch for a dealership that
  // chooses never to discuss warranty, which is a legitimate legal preference.
  // Absent an explicit false, verified facts speak.
  const w = (listing.warranty_info || {}) as Record<string, any>;
  const warrantySuppressed = settings.warranty_language_allowed === false
    && settings.warranty_language_suppressed_explicitly === true;
  const months = Number(w?.months_remaining) || 0;
  const miles = Number(w?.miles_remaining) || 0;
  const program = String(w?.program || "").trim();
  if (months > 0 || miles > 0 || program) {
    if (warrantySuppressed) {
      excluded.push({ field: "warranty_eligible", reason: "warranty_language_disabled", claim: "warranty" });
    } else {
      // The value carries only what is known. A writer given "remaining
      // factory coverage" cannot honestly produce "5 years / 60,000 miles";
      // one given the months and miles can state them exactly.
      const terms = [
        months > 0 ? `${months} months remaining` : "",
        miles > 0 ? `${miles.toLocaleString("en-US")} miles remaining` : "",
      ].filter(Boolean).join(", ");
      put("warranty_eligible", [program, terms].filter(Boolean).join(" — ") || "remaining factory coverage",
          "oem_warranty", "verified");
    }
  }

  // Accessories — an accessory may only be described as installed once
  // verified proof exists. Pending/optional never reads as installed.
  const accessories = Array.isArray(listing.available_accessories) ? listing.available_accessories : [];
  const installed = accessories.filter((a: any) => {
    const s = String(a?.status || a?.install_status || "").toUpperCase();
    return s === "INSTALLED_VERIFIED" || a?.installed === true;
  });
  const pending = accessories.filter((a: any) => {
    const s = String(a?.status || a?.install_status || "").toUpperCase();
    return s === "PENDING_INSTALLATION" || s === "OPTIONAL" || s === "AUTO_RECLASSIFIED_OPTIONAL";
  });
  if (installed.length && settings.accessory_language_allowed) {
    put("installed_accessories", installed.map((a: any) => a.name || a.label).filter(Boolean).join(", "),
        "install_proof", "verified");
  }
  for (const p of pending) {
    excluded.push({ field: "installed_accessories", reason: "install_not_verified", claim: p?.name || p?.label || "accessory" });
  }

  // Ownership / history — ONLY a real history report may support these.
  const oneOwner = mc.carfax_1_owner === true;
  const cleanTitle = mc.carfax_clean_title === true;
  const hasReport = !!listing.history_report_url;
  if (oneOwner && hasReport) put("one_owner", true, "vehicle_history_report", "verified");
  else if (oneOwner) excluded.push({ field: "one_owner", reason: "no_history_report", claim: "one owner" });
  if (cleanTitle && hasReport) put("clean_history", true, "vehicle_history_report", "verified");
  else if (cleanTitle) excluded.push({ field: "clean_history", reason: "no_history_report", claim: "clean history" });

  // Recalls are a safety signal, never merchandising copy.
  if (listing.recall_status) {
    facts.recall_status = {
      field: "recall_status", value: listing.recall_status, source: "nhtsa/marketcheck",
      status: "verified", observed_at: listing.recall_checked_at || null, usable_in_copy: false,
    };
  }

  // Dealer identity
  put("dealer_name", settings.dealer_name_format || dealer?.dealer_name || dealer?.name, "tenant_settings", "dealer_entered");
  put("dealer_city", settings.primary_city || dealer?.city, "tenant_settings", "dealer_entered");
  put("dealer_state", settings.state || dealer?.state, "tenant_settings", "dealer_entered");

  // Price — a derived, fee-inclusive figure. Only enters copy when the
  // dealer explicitly permits price language.
  if (settings.price_in_description && listing.price) {
    facts.price = {
      field: "price", value: listing.price, source: "advertised_price(derived)",
      status: "calculated", observed_at: listing.price_last_verified_at || null, usable_in_copy: true,
      evidence: "derived: advertised_price_before_doc + doc fee",
    };
  }

  // ── SUPPORTING market context — never a vehicle fact ───────────────
  const market_context: Record<string, unknown> = {};
  if (listing.market_value != null) market_context.market_value = listing.market_value;
  if (listing.market_position) market_context.market_position = listing.market_position;
  if (listing.market_meta) market_context.market_meta = listing.market_meta;
  if (listing.blackbook) market_context.residual_values = (listing.blackbook as any)?.residual_36 ?? null;
  if (Object.keys(market_context).length) {
    market_context.__usage = settings.market_context_allowed
      ? "May inform emphasis. Never state as a verified vehicle fact."
      : "Excluded from copy entirely by dealer configuration.";
  }

  const usable = Object.values(facts).filter((f) => f.usable_in_copy);
  const verified = usable.filter((f) => f.status === "verified").length;
  const fact_confidence = usable.length ? Math.round((verified / usable.length) * 100) : 0;

  const lineage: FactSnapshot["lineage"] = {};
  for (const [k, f] of Object.entries(facts)) lineage[k] = { source: f.source, status: f.status, observed_at: f.observed_at };

  // ── Canonical feature set ──────────────────────────────────────────
  // Built from the SAME resolved equipment decisions above, so a feature can
  // never enter the canonical set through a path the conflict logic did not
  // see. Origin is assigned here and never revisited downstream.
  const agreedLower = new Set(agreed.map((s) => s.toLowerCase().trim()));
  const rawFeatures: RawFeatureInput[] = [];
  for (const item of [...agreed, ...confirmedEquipment, ...decodedOnly, ...feedOnly]) {
    const isExcluded = excludedNames.has(item.toLowerCase());
    const fromDecode = decLower.includes(item.toLowerCase().trim());
    const bothAgree = agreedLower.has(item.toLowerCase().trim());
    rawFeatures.push({
      name: item,
      origin: "factory_option",
      source: bothAgree ? "vin_decode+marketcheck_feed" : fromDecode ? "vin_decode" : "marketcheck_feed",
      confidence: bothAgree ? 95 : fromDecode ? 78 : 55,
      conflict: isExcluded,
      descriptionEligible: !isExcluded,
      publicEligible: !isExcluded,
    });
  }
  // Dealer-added products carry install proof or they are not claimable at all.
  for (const a of installed) {
    rawFeatures.push({
      name: String(a?.name || a?.label || "").trim(),
      origin: "dealer_added", source: "install_proof", confidence: 95,
      descriptionEligible: !!settings.accessory_language_allowed,
      publicEligible: !!settings.accessory_language_allowed,
    });
  }
  for (const p of pending) {
    rawFeatures.push({
      name: String(p?.name || p?.label || "").trim(),
      origin: "dealer_added", source: "accessory_catalog", confidence: 30,
      conflict: true, descriptionEligible: false, publicEligible: false,
    });
  }
  const features = normalizeFeatures(rawFeatures.filter((f) => f.name));

  return { facts, lineage, conflicts, excluded_claims: excluded, market_context, fact_confidence, features };
}

// ── Description packet (V3) ──────────────────────────────────────────
// One approved fact packet per truth snapshot. Every channel is derived from
// THIS object — no channel is allowed to re-read the provider payload, so a
// channel physically cannot introduce a fact the master did not have.

export interface DescriptionPacket {
  tone: ToneKey;
  voice: VoiceProfile;
  targeting: SeoTargeting;
  /** Facts the copy is permitted to state, already filtered for usability. */
  verifiedFacts: Fact[];
  /** Factory equipment, prioritized and budgeted for the channel. */
  factoryFeatures: PrioritizedFeature[];
  /** Dealer-installed products. Separate bucket, separate wording. */
  dealerAddedFeatures: PrioritizedFeature[];
  /** Everything the prioritizer or the validator kept out, with the reason. */
  excludedFeatures: PrioritizedFeature[];
  excludedClaims: FactSnapshot["excluded_claims"];
  marketContext: Record<string, unknown>;
  factConfidence: number;
  selectedFeatureIds: string[];
}

export function buildDescriptionPacket(
  snap: FactSnapshot,
  settings: Record<string, any>,
  voice: VoiceProfile,
  opts: { tone?: ToneKey; targeting?: Partial<SeoTargeting>; featureBudget?: number } = {},
): DescriptionPacket {
  const tone = (opts.tone || voice.defaultTone || "professional") as ToneKey;
  const identity = String(snap.facts.ymm?.value || "").trim();
  const trim = String(snap.facts.trim?.value || "").trim();

  const targeting: SeoTargeting = {
    // The default primary phrase is the one a shopper actually types. It is a
    // default, not a mandate: unnatural placement is penalized by the scorer.
    primaryKeyword: opts.targeting?.primaryKeyword
      ?? (identity ? `${identity}${trim ? ` ${trim}` : ""} for sale`.trim() : ""),
    secondaryKeywords: opts.targeting?.secondaryKeywords ?? [],
    city: opts.targeting?.city ?? voice.city,
    state: opts.targeting?.state ?? voice.state,
    marketArea: opts.targeting?.marketArea ?? voice.marketArea,
    dealerName: opts.targeting?.dealerName ?? voice.dealerName,
    searchIntent: opts.targeting?.searchIntent ?? "inventory",
  };

  const prioritized = prioritizeFeatures(snap.features || [], {
    tone,
    featureBudget: opts.featureBudget ?? 10,
    bodyStyle: String(snap.facts.body_style?.value || ""),
    fuelType: String(snap.facts.fuel_type?.value || ""),
    toneEmphasis: toneProfile(tone).emphasis,
  });
  const { factory, dealerAdded, excluded } = splitByOrigin(prioritized);

  return {
    tone, voice, targeting,
    verifiedFacts: Object.values(snap.facts).filter((f) => f.usable_in_copy),
    factoryFeatures: factory,
    dealerAddedFeatures: dealerAdded,
    excludedFeatures: excluded,
    excludedClaims: snap.excluded_claims,
    marketContext: snap.market_context,
    factConfidence: snap.fact_confidence,
    selectedFeatureIds: [...factory, ...dealerAdded].map((f) => f.canonical_id),
  };
}

/** The generation identity. Identical inputs must never bill a second call. */
export async function computeInputChecksum(parts: {
  tenantId: string; vehicleId: string; snapshotChecksum: string; channel: string;
  channelPolicyVersion: string; voiceProfileVersion: string; tone: string;
  featureChecksum: string; targeting: SeoTargeting; promptVersion: string; model: string;
}): Promise<string> {
  const material = [
    parts.tenantId, parts.vehicleId, parts.snapshotChecksum, parts.channel,
    parts.channelPolicyVersion, parts.voiceProfileVersion, parts.tone, parts.featureChecksum,
    parts.targeting.primaryKeyword, [...parts.targeting.secondaryKeywords].sort().join(","),
    parts.targeting.city, parts.targeting.state, parts.targeting.marketArea,
    parts.promptVersion, parts.model,
  ].map((x) => String(x ?? "").trim().toLowerCase()).join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return "in_" + Array.from(new Uint8Array(digest)).slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

function featureBlock(packet: DescriptionPacket): string {
  const fmt = (f: PrioritizedFeature) =>
    `  - ${f.display_name} [${f.category}; source: ${f.source}; confidence ${f.confidence}%]`;
  const parts: string[] = [];
  if (packet.factoryFeatures.length) {
    parts.push(`FACTORY EQUIPMENT (verified on this vehicle, listed in priority order):\n${packet.factoryFeatures.map(fmt).join("\n")}`);
  }
  if (packet.dealerAddedFeatures.length) {
    parts.push(`DEALER-INSTALLED PRODUCTS — these are NOT factory equipment. If you mention them, say so plainly (for example "dealer-installed"). Never present them as factory or included equipment:\n${packet.dealerAddedFeatures.map(fmt).join("\n")}`);
  }
  return parts.join("\n\n");
}

// ── Prompt construction ──────────────────────────────────────────────
export function buildMasterPrompt(snap: FactSnapshot, settings: Record<string, any>): string {
  // Per-class rules are dealer copy policy for new / used / CPO inventory.
  // They were fingerprinted (so editing them forced a regeneration) but never
  // reached the model, which made the setting look active while doing nothing.
  const vehicleClass = String(snap.facts.condition?.value || "used").toLowerCase();
  const classRules = (settings.class_rules || {}) as Record<string, unknown>;
  const rule = classRules[vehicleClass] ?? classRules[vehicleClass.toUpperCase()];
  const ruleText = Array.isArray(rule) ? rule.filter(Boolean).join("\n- ")
    : typeof rule === "string" ? rule
    : rule && typeof rule === "object" ? JSON.stringify(rule) : "";
  const classLine = ruleText
    ? `\nDEALER RULES FOR ${vehicleClass.toUpperCase()} INVENTORY (follow these in addition to the rules below):\n- ${ruleText}`
    : "";
  const usable = Object.values(snap.facts).filter((f) => f.usable_in_copy);
  const factLines = usable.map((f) => `- ${f.field}: ${f.value}  [source: ${f.source}; status: ${f.status}]`).join("\n");
  const banned = [
    ...(Array.isArray(settings.prohibited_phrases) ? settings.prohibited_phrases : []),
    ...snap.excluded_claims.map((e) => e.claim).filter(Boolean),
  ];
  const marketLine = settings.market_context_allowed && Object.keys(snap.market_context).length
    ? `\nMarket context (for EMPHASIS ONLY — never state as a vehicle fact, never claim a price advantage):\n${JSON.stringify(snap.market_context)}`
    : "";

  return `You are writing the canonical vehicle merchandising description for a franchise dealership.

VERIFIED FACTS — these are the ONLY vehicle facts you may state:
${factLines}
${marketLine}${classLine}

ABSOLUTE RULES
- Never state a fact that is not in the verified list above. If something is missing, omit it entirely.
- Never invent equipment, packages, trim, ownership history, accident history, service history, recall completion, warranty coverage, CPO status, fuel economy, range, horsepower or towing capacity.
- Never describe an accessory as installed.
- Never use: ${banned.length ? banned.join("; ") : "(no additional banned terms)"}.
- Never claim the vehicle is below market, a great deal, the best price, rare, or loaded.
- Never use exclamation marks or unverifiable superlatives.
- Do not include a price unless a price fact appears above.

STYLE
- Tone: ${settings.default_tone || "professional"}. ${settings.brand_voice ? `Brand voice: ${settings.brand_voice}.` : ""}
- Length: aim for ${preferredLengthBand(settings).min}-${preferredLengthBand(settings).max} characters, and never exceed ${LENGTH_POLICY.absoluteMax}. This is a target, not a quota: write as much as the VERIFIED facts above genuinely support and no more. A vehicle with little verified data gets a shorter description. Never pad, repeat a feature, restate a fact in different words, or add generic dealership filler to reach a length.
- Structure: a strong opening, the most important verified qualities, high-priority verified equipment, practical ownership detail, then the closing call to action.
- Close with this call to action: ${settings.cta_template || `Contact ${snap.facts.dealer_name?.value || "our team"} to schedule a test drive.`}
${settings.required_legal_text ? `- Include verbatim: ${settings.required_legal_text}` : ""}

Return ONLY the description text. No headings, no markdown, no preamble.`;
}

/**
 * V3 master prompt. Same absolute rules as the legacy builder, plus the three
 * layers Phase 3 adds: canonical features with origin, the approval-gated
 * dealership voice, and tone as a wording-only instruction.
 */
export function buildMasterPromptV3(packet: DescriptionPacket, settings: Record<string, any>): string {
  const factLines = packet.verifiedFacts
    .map((f) => `- ${f.field}: ${f.value}  [source: ${f.source}; status: ${f.status}]`).join("\n");
  const banned = [
    ...packet.voice.prohibitedPhrases,
    ...packet.excludedClaims.map((e) => e.claim).filter(Boolean),
    ...packet.excludedFeatures.filter((f) => f.conflict).map((f) => f.display_name),
  ].filter(Boolean);
  const marketLine = settings.market_context_allowed && Object.keys(packet.marketContext).length
    ? `\nMarket context (EMPHASIS ONLY — never state as a vehicle fact, never claim a price advantage):\n${JSON.stringify(packet.marketContext)}`
    : "";
  const kw = packet.targeting.primaryKeyword
    ? `\nSEARCH RELEVANCE\n- Shoppers reach this listing searching "${packet.targeting.primaryKeyword}". Use that phrasing ONCE, inside a sentence that would exist anyway. If it cannot be written naturally, leave it out.\n- Do not repeat the phrase, do not list nearby towns, do not add a keyword block.`
    : "";

  return `You are writing the canonical vehicle merchandising description for a franchise dealership.

VERIFIED FACTS — the ONLY vehicle facts you may state:
${factLines}

${featureBlock(packet)}
${marketLine}

ABSOLUTE RULES
- Never state a fact that is not listed above. If something is missing, omit it entirely.
- Never invent equipment, packages, trim, ownership history, accident history, service history, recall completion, warranty coverage, CPO status, fuel economy, EV range, horsepower, torque, towing capacity, payload, seating capacity or safety ratings.
- Never describe a dealer-installed product as factory equipment.
- Never describe an accessory as installed unless it appears above as a dealer-installed product.
- Never use: ${banned.length ? banned.join("; ") : "(no additional banned terms)"}.
- Never claim the vehicle is below market, a great deal, the best price, rare, or loaded.
- No exclamation marks, no unverifiable superlatives.
- Do not include a price unless a price fact appears above.
- Do not repeat the same feature under a second name.

${toneInstruction(packet.tone)}

${voiceInstruction(packet.voice)}

STRUCTURE
- Length: aim for ${preferredLengthBand(settings).min}-${preferredLengthBand(settings).max} characters, and never exceed ${LENGTH_POLICY.absoluteMax}. This is a target, not a quota: write as much as the VERIFIED facts above genuinely support and no more. A vehicle with little verified data gets a shorter description. Never pad, repeat a feature, restate a fact in different words, or add generic dealership filler to reach a length.
- A strong opening that names the vehicle, then the qualities that matter most, then the prioritized equipment grouped sensibly, then practical ownership detail, then the close.
${kw}

Return ONLY the description text. No headings, no markdown, no preamble.`;
}

/**
 * V3 channel prompt. The master is the single source of facts; the channel
 * policy is the only thing permitted to change. A channel may restructure,
 * shorten, re-emphasize and re-close — it may not learn anything new.
 */
export function buildChannelPromptV3(
  master: string, policy: ChannelPolicy, packet: DescriptionPacket,
): string {
  const body = master.length > CHANNEL_PROMPT_BUDGET
    ? master.slice(0, CHANNEL_PROMPT_BUDGET).replace(/\s+\S*$/, "") + "…"
    : master;
  const override = packet.voice.channelOverrides?.[policy.key];
  const cta = override?.ctaTemplate || packet.voice.ctaTemplate
    || `Contact ${packet.voice.dealerName || "our team"} to schedule a test drive.`;

  const rules = [
    `- ${policy.instruction}`,
    override?.instruction ? `- ${override.instruction}` : "",
    `- Length: ${policy.recommendedMin}-${policy.recommendedMax} characters. Hard maximum ${policy.characterLimit}.`,
    `- ${policy.paragraphMin}-${policy.paragraphMax} paragraphs.`,
    `- Feature budget: name at most ${policy.featureBudget} pieces of equipment, chosen from the highest-priority ones in the master. Group the rest or leave them out.`,
    policy.markdownAllowed ? "" : "- Plain text only. No markdown, no headings, no bullet characters.",
    policy.htmlAllowed ? "" : "- No HTML.",
    policy.emojiAllowed ? "" : "- No emoji.",
    policy.linksAllowed ? "" : "- No URLs.",
    policy.phoneAllowed ? "" : "- No phone numbers in the body.",
    policy.pricingPolicy === "never"
      ? "- Never state, imply or characterize a price, payment, discount, saving, deal quality or market position."
      : "- Only state a price if one appears in the master.",
    policy.keywordPolicy === "none"
      ? "- Do not optimize for search. Write for a person scrolling on a phone."
      : "- Search phrasing must read naturally. Never repeat a keyword or name more than one locality.",
    policy.ctaPolicy === "none" ? "" : `- Close with: ${cta}`,
    policy.prohibitedPhrases.length ? `- Never use: ${policy.prohibitedPhrases.join("; ")}.` : "",
    policy.requiredDisclosures.length ? `- Include verbatim: ${policy.requiredDisclosures.join(" ")}` : "",
  ].filter(Boolean).join("\n");

  return `Rewrite the master vehicle description below for ${policy.label}.

MASTER DESCRIPTION:
${body}

CHANNEL REQUIREMENTS (policy ${policy.policyVersion})
${rules}

FACT INVARIANT
- Every factual statement must remain identical in meaning to the master.
- Do not add a fact, a feature, a claim, a benefit or a number that is not already in the master.
- Do not promote a dealer-installed product to factory equipment.
- Changing the destination changes the presentation, never the vehicle.

${toneInstruction(packet.tone)}
${policy.seoFields ? `
Return STRICT JSON only, no code fence:
{"seo_title":"<=60 chars","meta_description":"<=155 chars","content":"the body copy"}` : `
Return ONLY the rewritten text.`}`;
}

// The generator rejects a prompt_override over 4000 chars, and a full-length
// master plus these instructions can exceed that — which would fail exactly
// the equipment-rich vehicles that matter most. Trim the master to fit.
const CHANNEL_PROMPT_BUDGET = 2600;

export function buildChannelPrompt(master: string, ch: ChannelRule, snap: FactSnapshot, settings: Record<string, any>): string {
  const body = master.length > CHANNEL_PROMPT_BUDGET
    ? master.slice(0, CHANNEL_PROMPT_BUDGET).replace(/\s+\S*$/, "") + "…"
    : master;
  return `Rewrite the master vehicle description below for ${ch.label}.

MASTER DESCRIPTION:
${body}

CHANNEL REQUIREMENTS
- ${ch.instruction}
- Hard maximum ${ch.characterLimit} characters. Aim for ${Math.round(ch.characterLimit * 0.8)}.
- Keep every factual statement identical in meaning to the master. Do not add any new fact.
- Do not introduce price, market, ownership, warranty or CPO claims that are not already present.
${ch.seoFields ? `
Return STRICT JSON only, no code fence:
{"seo_title":"<=60 chars","meta_description":"<=155 chars","content":"the body copy"}` : `
Return ONLY the rewritten text.`}`;
}

// ── Validation engine ────────────────────────────────────────────────
export interface Finding {
  validator_code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  fact_path?: string | null;
  claim_text?: string | null;
  source_reference?: string | null;
  blocking: boolean;
}

export function validateContent(
  content: string,
  snap: FactSnapshot,
  settings: Record<string, any>,
  ch?: ChannelRule,
): Finding[] {
  const out: Finding[] = [];
  const text = content || "";
  const lc = text.toLowerCase();

  // 1. Controlled claims must be backed by a usable verified fact.
  for (const rule of CONTROLLED_CLAIMS) {
    const m = text.match(rule.pattern);
    if (!m) continue;
    let permitted = false;
    if (rule.requires === "__never") permitted = false;
    else if (rule.requires === "__market_context_allowed") permitted = !!settings.market_context_allowed;
    else {
      const f = snap.facts[rule.requires];
      permitted = !!f && f.usable_in_copy && (f.status === "verified" || f.status === "dealer_entered");
    }
    if (!permitted) {
      out.push({
        validator_code: rule.code, severity: "blocking", blocking: true,
        message: `Unsupported claim "${m[0]}" — ${rule.label} requires authoritative evidence that is not present.`,
        fact_path: rule.requires.startsWith("__") ? null : rule.requires,
        claim_text: m[0], source_reference: null,
      });
    }
  }

  // 2. Nothing excluded by a conflict may appear in the copy.
  // The dealer's own required legal text is mandated verbatim elsewhere in this
  // validator, so a generic exclusion word that only occurs inside it ("see
  // dealer for complete warranty details") must not be read as a claim —
  // otherwise the vehicle is blocked for including it AND for omitting it.
  const legal = String(settings.required_legal_text || "").toLowerCase();
  const withoutLegal = legal ? lc.split(legal).join(" ") : lc;
  for (const ex of snap.excluded_claims) {
    if (!ex.claim) continue;
    const claim = String(ex.claim).toLowerCase();
    // whole-word match: "certified" must not fire on "certifiedxyz"
    const hit = new RegExp(`(^|[^a-z0-9])${claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i")
      .test(withoutLegal);
    if (hit) {
      out.push({
        validator_code: "EXCLUDED_CLAIM_PRESENT", severity: "blocking", blocking: true,
        message: `"${ex.claim}" is excluded (${ex.reason}) but appears in the description.`,
        fact_path: ex.field, claim_text: ex.claim, source_reference: ex.reason,
      });
    }
  }

  // 3. Identity consistency.
  const ymm = String(snap.facts.ymm?.value ?? "");
  if (ymm) {
    const yr = ymm.match(/\b(19|20)\d{2}\b/)?.[0];
    if (yr && !text.includes(yr)) {
      out.push({ validator_code: "IDENTITY_YEAR_MISSING", severity: "warning", blocking: false,
        message: `Model year ${yr} is not mentioned.`, fact_path: "ymm" });
    }
    // Only a year attached to the vehicle itself is a contradiction; a dealer
    // tagline ("serving Dallas since 1998") or a coverage term is not.
    const modelYearClaim = new RegExp(`\\b(19|20)\\d{2}\\s+${(snap.facts.ymm?.value ? String(snap.facts.ymm.value).split(/\s+/)[1] : "")}`, "i");
    const claimed = text.match(modelYearClaim)?.[0]?.match(/\b(19|20)\d{2}\b/)?.[0];
    const wrongYear = claimed && yr && claimed !== yr ? [claimed] : [];
    if (wrongYear.length) {
      out.push({ validator_code: "IDENTITY_YEAR_CONFLICT", severity: "blocking", blocking: true,
        message: `Description references year ${wrongYear[0]} but the vehicle is ${yr}.`,
        fact_path: "ymm", claim_text: wrongYear[0] });
    }
  }

  // 4. Dealer-configured prohibited phrases.
  for (const p of (Array.isArray(settings.prohibited_phrases) ? settings.prohibited_phrases : [])) {
    if (p && lc.includes(String(p).toLowerCase())) {
      out.push({ validator_code: "PROHIBITED_PHRASE", severity: "blocking", blocking: true,
        message: `Prohibited phrase "${p}" is present.`, claim_text: String(p) });
    }
  }

  // 5. Required legal wording.
  if (settings.required_legal_text && !text.includes(settings.required_legal_text)) {
    out.push({ validator_code: "REQUIRED_DISCLOSURE_MISSING", severity: "blocking", blocking: true,
      message: "Required disclosure text is missing." });
  }

  // 6. Length / channel format.
  const limit = ch?.characterLimit ?? settings.max_length ?? 2400;
  const min = ch?.minLength ?? settings.min_length ?? 400;
  if (text.length > limit) {
    // Overshooting a marketplace's character cap is a formatting problem with
    // that one export, not a factual defect. Marking it blocking made a single
    // long Facebook variant refuse publication of a clean master description.
    out.push({ validator_code: "CHANNEL_LENGTH_EXCEEDED", severity: "warning", blocking: false,
      message: `${ch ? ch.label : "Master"} limit exceeded by ${text.length - limit} characters (${text.length}/${limit}).` });
  } else if (text.length < min) {
    out.push({ validator_code: "LENGTH_BELOW_MINIMUM", severity: "warning", blocking: false,
      message: `Only ${text.length} characters; minimum target is ${min}.` });
  }
  if (ch && /[#*_`]|<[a-z]/i.test(text)) {
    out.push({ validator_code: "CHANNEL_FORMAT_INVALID", severity: "warning", blocking: false,
      message: `${ch.label} does not support markdown or HTML formatting.` });
  }

  // 7. CTA presence.
  if (!ch || ch.deliveryMode === "internal_projection") {
    const cta = /\b(contact|call|visit|schedule|stop by|reach out|test drive)\b/i.test(text);
    if (!cta) out.push({ validator_code: "CTA_MISSING", severity: "warning", blocking: false,
      message: "No call to action detected." });
  }

  // 8. Boilerplate / duplicate risk.
  const sentences = text.split(/[.!?]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 24);
  if (new Set(sentences).size < sentences.length) {
    out.push({ validator_code: "DUPLICATE_CONTENT_RISK", severity: "warning", blocking: false,
      message: "Repeated sentences detected." });
  }

  // 9. Missing trusted facts.
  if (snap.fact_confidence < 40) {
    out.push({ validator_code: "LOW_FACT_CONFIDENCE", severity: "warning", blocking: false,
      message: `Only ${snap.fact_confidence}% of usable facts are source-verified.` });
  }
  if (!snap.facts.ymm || !snap.facts.vin) {
    out.push({ validator_code: "REQUIRED_DATA_MISSING", severity: "blocking", blocking: true,
      message: "Vehicle identity (VIN / year-make-model) is incomplete.", fact_path: "ymm" });
  }

  // 10. Unresolved material conflicts block automatic publication.
  for (const c of snap.conflicts.filter((c) => c.material)) {
    out.push({ validator_code: "SOURCE_CONFLICT_UNRESOLVED", severity: "blocking", blocking: true,
      message: `Unresolved source conflict on ${c.field}.`, fact_path: c.field,
      source_reference: c.values.map((v) => `${v.source}=${v.value}`).join(" vs ") });
  }

  return out;
}

/**
 * Deterministic claim validation for V3.
 *
 * Runs the legacy validator (identity, controlled claims, excluded claims,
 * disclosures) and then the four checks Phase 3 adds, all of which compare
 * generated text against the APPROVED PACKET rather than asking the model
 * whether it told the truth:
 *
 *   - dealer benefits the tenant never approved
 *   - locality stuffing and unapproved service areas
 *   - tone overreach (invented performance, safety or savings language)
 *   - equipment named in the copy that is not in the packet at all
 *   - dealer-installed products presented as factory equipment
 */
export function validateContentV3(
  content: string,
  snap: FactSnapshot,
  settings: Record<string, any>,
  packet: DescriptionPacket,
  policy?: ChannelPolicy,
): Finding[] {
  const legacyChannel = policy
    ? CHANNELS.find((c) => c.key === policy.key) ?? {
        key: policy.key, label: policy.label, characterLimit: policy.characterLimit,
        minLength: policy.recommendedMin, deliveryMode: policy.deliveryMode,
        connectorStatus: policy.connectorStatus, seoFields: policy.seoFields,
        instruction: policy.instruction,
      }
    : undefined;

  const out: Finding[] = validateContent(content, snap, settings, legacyChannel)
    // Length + format are owned by the channel policy in V3; keeping the
    // legacy copies would double-report the same problem on every variant.
    .filter((f) => !policy || !["CHANNEL_LENGTH_EXCEEDED", "LENGTH_BELOW_MINIMUM", "CHANNEL_FORMAT_INVALID", "CTA_MISSING"].includes(f.validator_code));

  for (const v of checkDealerClaims(content, packet.voice)) {
    out.push({ validator_code: v.code, severity: v.severity, blocking: v.severity === "blocking",
      message: v.message, claim_text: v.claim, fact_path: "voice_profile",
      source_reference: packet.voice.version });
  }
  for (const v of checkLocalityUse(content, packet.voice)) {
    out.push({ validator_code: v.code, severity: v.severity, blocking: v.severity === "blocking",
      message: v.message, claim_text: v.claim, fact_path: "seo_targeting" });
  }
  for (const t of checkTone(content, packet.tone)) {
    out.push({ validator_code: t.code, severity: "blocking", blocking: true,
      message: t.message, claim_text: t.claim, fact_path: "tone" });
  }

  // Equipment attribution. A canonical feature the packet excluded (conflict,
  // unverified install) must not appear, and a dealer-installed product must
  // not be worded as factory equipment.
  const lc = String(content || "").toLowerCase();
  for (const f of packet.excludedFeatures) {
    if (!f.conflict) continue;
    if (!lc.includes(f.display_name.toLowerCase()) &&
        !f.aliases_seen.some((a) => lc.includes(a.toLowerCase()))) continue;
    out.push({ validator_code: "UNSUPPORTED_FEATURE_CLAIM", severity: "blocking", blocking: true,
      message: `"${f.display_name}" is not confirmed on this vehicle (${f.selection_reason}) but appears in the copy.`,
      claim_text: f.display_name, fact_path: `feature:${f.canonical_id}` });
  }
  for (const f of packet.dealerAddedFeatures) {
    const name = f.display_name.toLowerCase();
    if (!lc.includes(name)) continue;
    const factoryFraming = new RegExp(
      `\\b(factory|standard|comes with|equipped from the factory|included from the factory)\\b[^.]{0,60}${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "i");
    if (factoryFraming.test(content)) {
      out.push({ validator_code: "DEALER_ADDED_AS_FACTORY", severity: "blocking", blocking: true,
        message: `"${f.display_name}" is a dealer-installed product and is described as factory equipment.`,
        claim_text: f.display_name, fact_path: `feature:${f.canonical_id}` });
    }
  }

  if (policy) {
    for (const p of checkChannelPolicy(content, policy)) {
      out.push({ validator_code: p.code, severity: p.severity, blocking: p.severity === "blocking",
        message: p.message, fact_path: `channel:${policy.key}`,
        source_reference: policy.policyVersion });
    }
  }

  // Search-spam checks are content-safety findings, not style notes: hidden
  // text and stuffing are the two things that get a listing demoted.
  const kw = analyzeKeywords(content, packet.targeting);
  if (kw.hiddenTextDetected) {
    out.push({ validator_code: "HIDDEN_TEXT_DETECTED", severity: "blocking", blocking: true,
      message: "Hidden text or markup was found in the description body." });
  }
  if (kw.stuffing) {
    out.push({ validator_code: "KEYWORD_STUFFING", severity: "warning", blocking: false,
      message: `Unnatural keyword repetition: ${kw.stuffedTerms.join(", ")}.`,
      claim_text: kw.stuffedTerms.join(", ") });
  }
  return out;
}

// ── Length policy ────────────────────────────────────────────────────
//
// Quality-guided, not hard compliance. A dealership was configured with
// min_length 3750 / max_length 3922 — a 172-character window — which can only
// be satisfied by padding a finished description or truncating a detailed one.
// Both produce exactly the generic boilerplate the writer is supposed to avoid.
//
// The band below is a TARGET, not a gate. Length is the last of the six
// generation priorities, beneath factual accuracy, differentiation,
// readability, voice and SEO. A lightly equipped car with little verified data
// should be shorter than a loaded one with a full NeoVIN package list, and
// nothing may be invented, repeated or padded to close the gap.
//
// Only absoluteMax is a real boundary, and it is a safety ceiling rather than a
// quality judgement. Channel policies still impose their own limits on
// derivatives; the master carries the richest appropriate story and is never
// made worse to satisfy the smallest channel.
export const LENGTH_POLICY = {
  softMin: 1800,
  preferredMin: 2400,
  preferredMax: 3200,
  softMax: 3800,
  absoluteMax: 4500,
} as const;

/** The dealer's preferred band, falling back to the platform target. A tenant
 *  that configured an unreachably narrow window gets the platform band: the
 *  setting expresses a preference, not a contract the copy must satisfy. */
export function preferredLengthBand(settings: Record<string, any>): { min: number; max: number } {
  const min = Number(settings?.min_length) || LENGTH_POLICY.preferredMin;
  const max = Number(settings?.max_length) || LENGTH_POLICY.preferredMax;
  // A window too tight to write in is a misconfiguration, not an instruction.
  if (max <= min || max - min < 400) {
    return { min: LENGTH_POLICY.preferredMin, max: LENGTH_POLICY.preferredMax };
  }
  return { min, max };
}

/** Graduated, so a good 2,000-character description is not scored as harshly
 *  as a 6,000-character one. Full marks inside the band, most marks inside the
 *  soft bounds, and a real penalty only past the safety ceiling. */
export function lengthScore(len: number, settings: Record<string, any>): number {
  const { min, max } = preferredLengthBand(settings);
  if (len >= min && len <= max) return 30;
  if (len >= LENGTH_POLICY.softMin && len <= LENGTH_POLICY.softMax) return 24;
  if (len <= LENGTH_POLICY.absoluteMax) return 16;
  return 6;
}

// Content quality is deliberately SEPARATE from factual validity: a
// description can score well and still be blocked.
export function qualityScore(text: string, snap: FactSnapshot, settings: Record<string, any>): number {
  let s = 0;
  const len = text.length;
  s += lengthScore(len, settings);
  const equip = String(snap.facts.equipment?.value || "").split(",").filter(Boolean).length;
  s += Math.min(20, equip * 2);
  if (/\b(contact|call|visit|schedule|test drive)\b/i.test(text)) s += 15;
  const city = String(snap.facts.dealer_city?.value || "");
  if (city && text.includes(city)) s += 10;
  const paras = text.split(/\n\s*\n/).filter((p) => p.trim().length > 40).length;
  s += paras >= 2 ? 15 : 6;
  const words = text.split(/\s+/).filter(Boolean).length;
  const avg = words / Math.max(1, text.split(/[.!?]+/).filter((x) => x.trim()).length);
  s += avg > 8 && avg < 26 ? 10 : 4;
  return Math.max(0, Math.min(100, s));
}

/**
 * The real score. Replaces the heuristic `qualityScore` on every V3 path:
 * readability, uniqueness and keyword safety are measured, not asserted, and
 * a blocking finding caps the band regardless of how well the copy reads.
 */
export function scoreVersion(args: {
  text: string; packet: DescriptionPacket; findings: Finding[];
  comparisons: ComparisonDoc[]; policy?: ChannelPolicy; now?: string;
}): ScoreBreakdown {
  const { text, packet, findings, comparisons, policy } = args;
  const policyFindings = policy ? checkChannelPolicy(text, policy) : [];
  return scoreDescription({
    text,
    tone: packet.tone,
    targeting: packet.targeting,
    comparisons,
    factsOffered: packet.verifiedFacts.length,
    factsUsed: countFactsUsed(text, packet.verifiedFacts.map((f) => f.value)),
    featuresSelected: [...packet.factoryFeatures, ...packet.dealerAddedFeatures].map((f) => f.display_name),
    policyFindings: policyFindings.map((f) => ({ code: f.code, severity: f.severity })),
    blockingFindings: findings.filter((f) => f.blocking).length,
    warningFindings: findings.filter((f) => f.severity === "warning").length,
    ctaExpected: !policy || policy.ctaPolicy !== "none",
    now: args.now,
  });
}

export function decideEligibility(
  findings: Finding[], settings: Record<string, any>, condition: string, quality?: number,
): { eligibility: "eligible" | "blocked" | "review_required"; reason: string } {
  if (findings.some((f) => f.blocking)) {
    return { eligibility: "blocked", reason: `${findings.filter((f) => f.blocking).length} blocking finding(s)` };
  }
  // The dealer's quality bar is a review gate, never an auto-publish gate:
  // thin copy goes to a human rather than straight to a shopper.
  const threshold = Number(settings.quality_threshold);
  if (Number.isFinite(threshold) && typeof quality === "number" && quality < threshold) {
    return { eligibility: "review_required", reason: `quality ${quality} is below the dealer threshold of ${threshold}` };
  }
  const cls = String(condition || "used").toLowerCase();
  const byClass = (settings.review_mode_by_class || {}) as Record<string, string>;
  const mode = byClass[cls] || settings.review_mode || "EXCEPTION_REVIEW";
  if (mode === "DRAFT_ONLY") return { eligibility: "review_required", reason: "dealer is in draft-only mode" };
  if (mode === "REQUIRE_APPROVAL_ALL") return { eligibility: "review_required", reason: "approval required for all vehicles" };
  // Cosmetic warnings (missing CTA, short copy, formatting) should not drag a
  // clean vehicle in front of a manager — only warnings about the facts do.
  const MATERIAL = new Set([
    "LOW_FACT_CONFIDENCE", "IDENTITY_YEAR_MISSING", "SOURCE_CONFLICT_UNRESOLVED",
    "REQUIRED_DATA_MISSING", "DUPLICATE_CONTENT_RISK",
  ]);
  const material = findings.filter((f) => f.severity === "warning" && MATERIAL.has(f.validator_code)).length;
  if (mode === "EXCEPTION_REVIEW" && material > 0) {
    return { eligibility: "review_required", reason: `${material} finding(s) need review` };
  }
  return { eligibility: "eligible", reason: "all required checks passed" };
}
