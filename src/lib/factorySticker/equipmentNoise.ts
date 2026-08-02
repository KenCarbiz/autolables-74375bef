// ──────────────────────────────────────────────────────────────────────
// Decoder noise suppression and concept collapse.
//
// A VIN decoder emits implementation attributes, not customer-facing equipment.
// One sunroof arrives as seven rows ("Front Sunroof", "Glass Sunroof", "Electric
// Sunroof-Front", "Tilting Sunroof-Front", "Sliding Sunroof-Front", "One-Touch
// Opening Sunroof-Front", "Front Panoramic Roof"); one braking system arrives as
// six ("Brakes At Low Speed", "Automatic Braking", "Operates Above 130 Kph/78
// Mph", …). Printing them verbatim is what makes the sticker read like a data
// dump instead of a Monroney label.
//
// Two rules govern everything here:
//   1. Never invent equipment. A concept is only emitted when a source row
//      supports it; collapsing renames, it never adds.
//   2. Be deterministic. The same input always produces the same output, in the
//      same order, so the rendered sticker is reproducible.
// ──────────────────────────────────────────────────────────────────────

/** Priority tier — page 1 fills from tier 1 up. */
export type EquipmentTier = 1 | 2 | 3;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// ── Noise ─────────────────────────────────────────────────────────────

/** Bare color words a decoder emits as standalone "equipment". */
const COLOR_WORDS = new Set([
  "black", "white", "blue", "red", "green", "silver", "grey", "gray", "brown",
  "beige", "tan", "gold", "bronze", "ivory", "charcoal", "graphite", "walnut",
  "chrome", "titanium", "platinum", "sand", "cocoa", "ebony",
]);

/** Words that only ever qualify a colour, never name equipment. */
const COLOR_MODIFIERS = new Set([
  "midnight", "dark", "light", "deep", "metallic", "pearl", "jet", "arctic",
  "summit", "onyx", "satin", "matte", "gloss", "medium", "very",
]);

// Fragments that describe HOW a system behaves rather than WHAT the car has.
const NOISE_PATTERNS: RegExp[] = [
  // "Operates Above 130 Kph/78 Mph", "Operates Below 50 Kph/30 Mph"
  /^operates?\s+(above|below|between|at)\b/i,
  // Raw dimensional decoder attributes: wheel diameter/width per corner. These
  // are specifications, and printing four of them (often contradictory across
  // trims) reads as noise next to "20in Aluminum Wheels".
  /^(front|rear)\s+wheel\s+(diameter|width)\b/i,
  /^wheel\s+(diameter|width)\b/i,
  // Component-level implementation flags.
  /^(visual|acoustic|audible|visual\/acoustic)\s+(warning|alert)$/i,
  /^activates?\s+brake\s+lights?$/i,
  /^(stop|go)\s+function$/i,
  /^(with|w\/)\s/i,
  // Generic taxonomy labels with no customer meaning.
  /^(standard|optional|included|equipment|feature|other|misc|n\/?a|none|tbd)$/i,
  /^(front|rear|left|right|driver|passenger)$/i,
  /^\d+(\.\d+)?\s*(in|inch|mm|cm)$/i,
];

/**
 * True when a decoded row is an implementation detail or taxonomy artifact
 * rather than equipment a customer would recognize.
 */
export function isDecoderNoise(raw: string): boolean {
  const s = norm(raw);
  if (!s) return true;
  if (COLOR_WORDS.has(s)) return true;
  // A bare colour phrase ("midnight blue", "dark walnut") is still a colour.
  const words = s.split(" ");
  if (words.length === 2 && COLOR_WORDS.has(words[1]) && (COLOR_WORDS.has(words[0]) || COLOR_MODIFIERS.has(words[0]))) {
    return true;
  }
  return NOISE_PATTERNS.some((re) => re.test(s));
}

// ── Concept collapse ──────────────────────────────────────────────────

interface ConceptRule {
  /** Stable concept key; one row per concept survives. */
  concept: string;
  /** The customer-facing label printed on the sticker. */
  canonical: string;
  tier: EquipmentTier;
  /** Any source row matching this belongs to the concept. */
  match: RegExp;
  /**
   * When present, the canonical label is only used if a source row matches —
   * lets "Panoramic" upgrade the generic sunroof label without inventing it.
   */
  upgrade?: { match: RegExp; canonical: string };
}

// Order matters: the first matching rule wins, so specific concepts precede
// general ones.
const CONCEPT_RULES: ConceptRule[] = [
  {
    concept: "aeb",
    canonical: "Automatic Emergency Braking",
    tier: 1,
    match: /\b(automatic braking|automatic emergency brak|brakes? at low speed|emergency brak|forward collision|pre-?collision|pedestrian (&|and)? ?cyclist|city brak)/i,
    upgrade: {
      match: /\bpedestrian\b/i,
      canonical: "Automatic Emergency Braking w/ Pedestrian Detection",
    },
  },
  {
    concept: "sunroof",
    canonical: "Power Sunroof",
    tier: 1,
    match: /\b(sunroofs?|moonroofs?|panoramic roof|glass roof)\b/i,
    upgrade: { match: /\bpanoram/i, canonical: "Panoramic Sunroof" },
  },
  {
    concept: "adaptive_cruise",
    canonical: "Adaptive Cruise Control",
    tier: 1,
    match: /\b(adaptive cruise|intelligent cruise|radar cruise|stop function cruise|propilot)\b/i,
  },
  {
    concept: "cruise",
    canonical: "Cruise Control",
    tier: 2,
    match: /\b(cruise controls?|speed limiter|steering wheel mounted cruise)\b/i,
  },
  {
    concept: "led_headlights",
    canonical: "LED Headlights",
    tier: 2,
    match: /\b(led headlights?|led head ?lamps?|complex surface headlights?|headlights?-(low|high) beam)\b/i,
  },
  {
    concept: "auto_high_beam",
    canonical: "Automatic High Beams",
    tier: 3,
    match: /\b(auto high beams?|automatic high beams?|high beam assist|dusk sensor)\b/i,
  },
  {
    concept: "premium_audio",
    canonical: "Premium Audio System",
    tier: 2,
    match: /\b(premium brand speakers?|surround sound|subwoofer|\d+ speakers?|bose|bang (&|and) olufsen|harman|klipsch|premium audio)\b/i,
  },
  {
    concept: "running_boards",
    canonical: "Power Retractable Running Boards",
    tier: 2,
    match: /\b(running boards?|assist steps?|illuminated steps?|side steps?)\b/i,
  },
  {
    concept: "anti_theft",
    canonical: "Anti-Theft Protection",
    tier: 3,
    match: /\b(anti-?theft|immobilizer|interior monitoring)\b/i,
  },
  {
    concept: "rear_camera",
    canonical: "Rear View Camera",
    tier: 1,
    match: /\b(rear ?view (mirror\/)?cameras?|backup cameras?|rear cameras?)\b/i,
  },
  {
    concept: "wheel_locks",
    canonical: "Locking Wheel Nuts",
    tier: 3,
    match: /\block(ing)? (front |rear )?wheel nuts?\b/i,
  },
  {
    concept: "two_tone_wheels",
    canonical: "Two-Tone Alloy Wheels",
    tier: 2,
    match: /\b(two-?tone wheels?|aluminum alloy wheels?|alloy wheels?)\b/i,
  },
  {
    concept: "digital_radio",
    canonical: "Digital & Satellite Radio",
    tier: 3,
    match: /\b(rds audio|digital radio|satellite radio|siriusxm)\b/i,
  },
  {
    concept: "smartphone",
    canonical: "Smartphone Integration",
    tier: 2,
    match: /\b(bluetooth connection|built-?in apps|carplay|android auto|smartphone)\b/i,
  },
];

export interface CuratedItem {
  /** Printed label. */
  name: string;
  tier: EquipmentTier;
  /** Concept key when collapsed, else null for a pass-through row. */
  concept: string | null;
  /** Source rows this row represents, for audit. */
  sources: string[];
}

export interface CurateResult {
  items: CuratedItem[];
  /** Rows discarded as decoder noise. */
  dropped: string[];
  /** concept -> source rows collapsed into it. */
  collapsed: Record<string, string[]>;
}

/**
 * Curate a decoded standard-equipment list into printable rows.
 *
 * Noise is dropped, overlapping rows collapse to one concept, and the rest pass
 * through deduplicated. Output order is stable: tier, then first appearance.
 */
export function curateEquipment(raw: string[]): CurateResult {
  const dropped: string[] = [];
  const collapsed: Record<string, string[]> = {};
  const byConcept = new Map<string, CuratedItem>();
  const passthrough = new Map<string, CuratedItem>();
  const order: CuratedItem[] = [];

  for (const source of raw) {
    const name = String(source ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (isDecoderNoise(name)) { dropped.push(name); continue; }

    const rule = CONCEPT_RULES.find((r) => r.match.test(name));
    if (rule) {
      (collapsed[rule.concept] ||= []).push(name);
      const existing = byConcept.get(rule.concept);
      if (existing) {
        existing.sources.push(name);
        // An upgrade label only applies when a source row justifies it.
        if (rule.upgrade?.match.test(name)) existing.name = rule.upgrade.canonical;
        continue;
      }
      const item: CuratedItem = {
        name: rule.upgrade?.match.test(name) ? rule.upgrade.canonical : rule.canonical,
        tier: rule.tier,
        concept: rule.concept,
        sources: [name],
      };
      byConcept.set(rule.concept, item);
      order.push(item);
      continue;
    }

    const key = norm(name).replace(/[^a-z0-9]+/g, "");
    const seen = passthrough.get(key);
    if (seen) { seen.sources.push(name); dropped.push(name); continue; }
    const item: CuratedItem = { name, tier: 2, concept: null, sources: [name] };
    passthrough.set(key, item);
    order.push(item);
  }

  // Stable sort: tier first, original order within a tier.
  const items = order
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.tier - b.item.tier || a.i - b.i)
    .map(({ item }) => item);

  return { items, dropped, collapsed };
}

/** Rows that fit page 1, filling by priority tier. */
export function selectForPageOne(items: CuratedItem[], capacity: number): {
  pageOne: CuratedItem[];
  continuation: CuratedItem[];
} {
  if (capacity >= items.length) return { pageOne: items, continuation: [] };
  return { pageOne: items.slice(0, capacity), continuation: items.slice(capacity) };
}
