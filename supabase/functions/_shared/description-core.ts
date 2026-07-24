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
  conflicts: Array<{ field: string; values: Array<{ value: unknown; source: string }>; material: boolean }>;
  excluded_claims: Array<{ field: string; reason: string; claim?: string }>;
  market_context: Record<string, unknown>;
  fact_confidence: number;
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

export const CHANNELS: ChannelRule[] = [
  {
    key: "vehicle_passport", label: "Vehicle Passport", characterLimit: 2400, minLength: 400,
    deliveryMode: "internal_projection", connectorStatus: "available", seoFields: false,
    instruction: "Full merchandising copy for the dealer's own shopper page. Rich detail, natural prose, no marketplace formatting tokens.",
  },
  {
    key: "dealer_website", label: "Dealer Website", characterLimit: 2400, minLength: 400,
    deliveryMode: "internal_projection", connectorStatus: "available", seoFields: true,
    instruction: "Polished website merchandising copy with natural local SEO. Never keyword-stuff.",
  },
  {
    key: "autotrader", label: "AutoTrader", characterLimit: 1500, minLength: 300,
    deliveryMode: "export_only", connectorStatus: "export_only", seoFields: false,
    instruction: "Feature-forward and scannable. Strong opening line, clean close. Plain text only.",
  },
  {
    key: "cars_com", label: "Cars.com", characterLimit: 1500, minLength: 300,
    deliveryMode: "connector", connectorStatus: "not_configured", seoFields: false,
    instruction: "Balanced equipment, utility and condition-neutral language. Plain text only.",
  },
  {
    key: "cargurus", label: "CarGurus", characterLimit: 1200, minLength: 250,
    deliveryMode: "export_only", connectorStatus: "export_only", seoFields: false,
    instruction: "Concise and mobile-readable. Value-oriented WITHOUT any price or deal claim.",
  },
  {
    key: "facebook", label: "Facebook Marketplace", characterLimit: 900, minLength: 200,
    deliveryMode: "export_only", connectorStatus: "export_only", seoFields: false,
    instruction: "Shorter, conversational but professional, mobile-first. Clear vehicle identity and key equipment.",
  },
  {
    key: "google_seo", label: "Google Vehicle Ads", characterLimit: 900, minLength: 150,
    deliveryMode: "export_only", connectorStatus: "export_only", seoFields: true,
    instruction: "Produce an SEO title (<=60 chars), a meta description (<=155 chars) and a short search summary. Local relevance, no stuffing.",
  },
];

export const channelByKey = (k: string) => CHANNELS.find((c) => c.key === k);

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
  const overrideBy = new Map(overrides.map((o) => [o.field_key, o]));
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
    const ov = overrideBy.get(`equipment:${item}`);
    if (ov?.decision === "include") { confirmedEquipment.push(item); continue; }
    if (ov?.decision === "exclude") {
      // decided by a manager — still withheld from copy, but no longer blocking
      excluded.push({ field: `equipment:${item}`, reason: "resolved_excluded", claim: item });
      continue;
    }
    conflicts.push({
      field: `equipment:${item}`,
      values: [
        { value: fromDecode ? "not listed" : item, source: "marketcheck_feed" },
        { value: fromDecode ? item : "not listed", source: "vin_decode" },
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
  if (feedSaysCpo && !cpoConfirmed) {
    conflicts.push({
      field: "cpo_status",
      values: [{ value: "CPO", source: "marketcheck_feed" }, { value: "unconfirmed", source: "cpo_program_source" }],
      material: true,
    });
    excluded.push({ field: "cpo_status", reason: "cpo_unconfirmed", claim: "certified" });
  } else if (feedSaysCpo && cpoConfirmed && settings.cpo_language_allowed) {
    put("cpo_status", "Certified Pre-Owned", "cpo_program_source", "verified");
    if (certification?.program) put("cpo_program", certification.program, "cpo_program_source", "verified");
  } else if (feedSaysCpo && !settings.cpo_language_allowed) {
    excluded.push({ field: "cpo_status", reason: "cpo_language_disabled", claim: "certified" });
  }

  // Warranty — requires verified eligibility and dealer permission.
  const w = (listing.warranty_info || {}) as Record<string, any>;
  if (w && (w.months_remaining || w.miles_remaining || w.program)) {
    if (settings.warranty_language_allowed) {
      put("warranty_eligible", w.program || "remaining factory coverage", "oem_warranty", "verified");
    } else {
      excluded.push({ field: "warranty_eligible", reason: "warranty_language_disabled", claim: "warranty" });
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

  return { facts, lineage, conflicts, excluded_claims: excluded, market_context, fact_confidence };
}

// ── Prompt construction ──────────────────────────────────────────────
export function buildMasterPrompt(snap: FactSnapshot, settings: Record<string, any>): string {
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
${marketLine}

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
- Length: between ${settings.min_length || 400} and ${settings.max_length || 2400} characters.
- Structure: a strong opening, the most important verified qualities, high-priority verified equipment, practical ownership detail, then the closing call to action.
- Close with this call to action: ${settings.cta_template || `Contact ${snap.facts.dealer_name?.value || "our team"} to schedule a test drive.`}
${settings.required_legal_text ? `- Include verbatim: ${settings.required_legal_text}` : ""}

Return ONLY the description text. No headings, no markdown, no preamble.`;
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
  for (const ex of snap.excluded_claims) {
    if (!ex.claim) continue;
    if (lc.includes(String(ex.claim).toLowerCase())) {
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
    out.push({ validator_code: "CHANNEL_LENGTH_EXCEEDED", severity: "blocking", blocking: true,
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

// Content quality is deliberately SEPARATE from factual validity: a
// description can score well and still be blocked.
export function qualityScore(text: string, snap: FactSnapshot, settings: Record<string, any>): number {
  let s = 0;
  const len = text.length;
  const target = settings.max_length || 2400;
  s += len >= (settings.min_length || 400) && len <= target ? 30 : 12;
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

export function decideEligibility(
  findings: Finding[], settings: Record<string, any>, condition: string,
): { eligibility: "eligible" | "blocked" | "review_required"; reason: string } {
  if (findings.some((f) => f.blocking)) {
    return { eligibility: "blocked", reason: `${findings.filter((f) => f.blocking).length} blocking finding(s)` };
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
