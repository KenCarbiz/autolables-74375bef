// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/equipmentNoise.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
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

import { brandForMake, oemTerm, type OemBrand } from "./oemTerminology.ts";
import {
  findForeignTechnology, findTechnology, officialTechnologyName, type OemTechnology,
} from "./oemTechnology.ts";

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
  upgrade?: { match: RegExp; canonical: string; concept?: string };
}

/**
 * A branded OEM system name is MORE informative than the generic concept, so it
 * is never flattened into one. "ProPILOT Assist 2.1" outranks "Adaptive Cruise
 * Control"; "Bose Performance Audio - 24 Speakers" outranks "Premium Audio
 * System". These rows still collapse their siblings — they just supply the
 * label, verbatim, from the source.
 */
const BRANDED_SOURCE = new RegExp(
  [
    // Driver assistance suites — the OEM's own name for the system.
    "propilot", "pro ?pilot", "safety shield", "super ?cruise", "bluecruise",
    "co-?pilot ?360", "drive pilot", "honda sensing", "acurawatch", "eyesight",
    "toyota safety sense", "lexus safety system", "distronic", "pre-?safe",
    "driving assistant", "active driving assistant", "pilot assist", "city safety",
    "intellisafe", "smart ?sense", "highway driving assist", "autopilot",
    "travel assist", "iq\\.?drive", "audi pre ?sense", "i-?activsense", "mi-?pilot",
    "activedriveassist", "nissan safety shield", "\\bbsd\\b", "\\bhda\\b",
    "activeglide", "teammate", "dreamdrive", "innodrive", "drive wise",
    "lanesense", "driverfocus", "attention assist", "parktronic", "parksense",
    "parkview", "blis\\b", "side blind zone", "around view", "intellibeam",
    "rivian autonomy", "highway assistant", "steering and lane control",
    // Audio — brand IS the feature.
    "bose", "burmester", "mark levinson", "harman ?kardon", "meridian", "revel",
    "bang (&|and) olufsen", "b&o", "naim", "akg", "sony", "jbl", "infinity",
    "klipsch", "lexicon", "dynaudio", "focal", "els studio", "fender", "beats",
    "alpine", "rockford fosgate", "mcintosh", "sennheiser",
    // Infotainment and connected services.
    "sync ?[0-9]?", "uconnect", "idrive", "mbux", "comand", "\\bmmi\\b", "entune",
    "onstar", "blue ?link", "fordpass", "starlink", "nissanconnect", "kia connect",
    "wireless (apple )?carplay", "android auto",
    // Drivetrain, chassis, and powertrain technologies.
    "quattro", "xdrive", "4matic", "sh-?awd", "real time awd", "terrain response",
    "magnetic ride control", "magneride", "adaptive air suspension", "torsen",
    "e-?lsd", "e-?4orce", "ecoboost", "powerboost", "hemi", "duramax",
    "power ?stroke", "\\btdi\\b", "\\btfsi\\b", "i-?vtec", "\\bvtec\\b", "skyactiv",
    "crawl control", "trail control", "terrain management", "selec-?terrain",
    "s-?awc", "4motion", "all4", "\\bpdk\\b", "tiptronic", "x-?mode",
    "g\\.?o\\.?a\\.?t\\.? modes", "multi-?terrain select", "pro trailer backup",
    "advanced trailering", "airmatic", "e-?active body control",
    "dynamic chassis control", "\\be-?pedal\\b", "\\bi-?pedal\\b",
    // Named body/roof/vision features.
    "vista roof", "commandview", "panoramic vista", "magic body control",
    "head-?up display", "night vision assist", "surround ?view", "birds-?eye view",
    "around view monitor", "multi-?terrain monitor", "clearsight",
    "multibeam", "digital light", "matrix(-| )design", "pixel led",
    "panoramic view monitor", "glass canopy",
  ].join("|"),
  "i",
);

/** True when a source row names a specific branded system worth printing as-is. */
export const isBrandedSource = (name: string): boolean => BRANDED_SOURCE.test(name);

// Order matters: the first matching rule wins, so specific concepts precede
// general ones.
const CONCEPT_RULES: ConceptRule[] = [
  {
    concept: "aeb",
    canonical: "Automatic Emergency Braking",
    tier: 1,
    match: /\b(automatic braking|automatic emergency brak|brakes? at low speed|emergency brak|forward collision|pre-?collision|pedestrian (&|and)? ?cyclist|city brak)/i,
  },
  {
    concept: "sunroof",
    canonical: "Power Sunroof",
    tier: 1,
    match: /\b(sunroofs?|moonroofs?|panoramic roof|glass roof)\b/i,
    // A panoramic roof is a different product, so it swaps concept — and picks
    // up that concept's OEM term (Ford's "Panoramic Vista Roof", Jeep's
    // "CommandView", …) rather than a described variant of the plain one.
    upgrade: { match: /\bpanoram/i, canonical: "Panoramic Sunroof", concept: "panoramic_sunroof" },
  },
  {
    concept: "adaptive_cruise",
    canonical: "Adaptive Cruise Control",
    tier: 1,
    match: /\b(adaptive cruise|intelligent cruise|radar cruise|stop function cruise|propilot)\b/i,
  },
  {
    concept: "blind_spot",
    canonical: "Blind Spot Monitor",
    tier: 1,
    match: /\b(blind ?spot|blind zone|side assist)\b/i,
  },
  {
    concept: "rear_cross_traffic",
    canonical: "Rear Cross-Traffic Alert",
    tier: 2,
    match: /\b(cross ?traffic|cross path)\b/i,
  },
  {
    concept: "lane_keep",
    canonical: "Lane Keep Assist",
    tier: 1,
    match: /\b(lane keep|lane-?keeping|lane departure|lane intervention|lanesense)\b/i,
  },
  {
    concept: "lane_centering",
    canonical: "Lane Centering Assist",
    tier: 2,
    match: /\b(lane centering|lane tracing|lane following)\b/i,
  },
  {
    concept: "traffic_sign_recognition",
    canonical: "Traffic Sign Recognition",
    tier: 3,
    match: /\b(traffic sign|road sign|speed limit (info|assist)|speed sign)\b/i,
  },
  {
    concept: "driver_attention",
    canonical: "Driver Attention Monitor",
    tier: 3,
    match: /\b(driver (attention|alert|drowsiness|fatigue)|drowsy driver|attentiveness)\b/i,
  },
  {
    concept: "surround_view",
    canonical: "Surround View Camera",
    tier: 1,
    match: /\b(surround ?view|360-?degree camera|360°|birds-?eye view|around view|panoramic view monitor|multi-?view camera)\b/i,
  },
  {
    concept: "self_parking",
    canonical: "Automated Parking Assist",
    tier: 2,
    match: /\b(automated parking|automatic parking assist|active park assist|self-?parking|remote smart parking|autopark)\b/i,
  },
  {
    concept: "parking_sensors",
    canonical: "Parking Sensors",
    tier: 3,
    match: /\b(parking sensors?|park distance|parking distance|park assist sensors?|sonar system|parktronic)\b/i,
  },
  {
    concept: "safe_exit",
    canonical: "Safe Exit Warning",
    tier: 3,
    match: /\b(safe exit|exit warning)\b/i,
  },
  {
    concept: "rear_seat_reminder",
    canonical: "Rear Seat Reminder",
    tier: 3,
    match: /\b(rear seat reminder|rear door alert|rear occupant alert)\b/i,
  },
  {
    concept: "power_liftgate",
    canonical: "Power Liftgate",
    tier: 2,
    match: /\b(power (liftgate|tailgate|rear gate|back door)|hands-?free (liftgate|tailgate|access)|motion activated liftgate)\b/i,
    upgrade: {
      match: /\b(hands-?free|foot-?activated|kick sensor|motion activated|gesture|easy open)\b/i,
      canonical: "Hands-Free Power Liftgate",
      concept: "hands_free_liftgate",
    },
  },
  {
    concept: "remote_start",
    canonical: "Remote Engine Start",
    tier: 2,
    match: /\bremote (engine )?start\b/i,
  },
  {
    concept: "trailer_assist",
    canonical: "Trailer Assist",
    tier: 3,
    match: /\b(trailer (assist|backup|reverse)|tow assist|trailering system)\b/i,
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
    canonical: "Audio System",
    tier: 2,
    match: /\b(premium brand speakers?|surround sound|subwoofer|\d+ speakers?|bose|bang (&|and) olufsen|harman|klipsch|premium audio)\b/i,
    // A speaker count alone does not make a system premium. The word is only
    // printed when a source row supports it.
    upgrade: {
      match: /\b(premium|surround sound|subwoofer|bose|bang (&|and) olufsen|harman|klipsch|burmester|revel|meridian|mark levinson)\b/i,
      canonical: "Premium Audio System",
    },
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
    canonical: "Digital Radio",
    tier: 3,
    match: /\b(rds audio|digital radio|satellite radio|siriusxm)\b/i,
    upgrade: { match: /\b(satellite radio|siriusxm)\b/i, canonical: "Satellite Radio" },
  },
  {
    concept: "smartphone",
    canonical: "Smartphone Integration",
    tier: 2,
    match: /\b(bluetooth connection|built-?in apps|carplay|android auto|smartphone)\b/i,
    upgrade: {
      match: /\b(carplay|android auto)\b/i,
      canonical: "Apple CarPlay and Android Auto",
    },
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
  /** The label came verbatim from a branded OEM system name. */
  branded?: boolean;
  /** The catalogued manufacturer system this row names, when it names one. */
  technology?: OemTechnology;
}

export interface CurateResult {
  items: CuratedItem[];
  /** Rows discarded as decoder noise. */
  dropped: string[];
  /** Exact repeats of a row already kept, with the row they folded into. */
  duplicates: Array<{ item: string; keptIn: string }>;
  /** concept -> source rows collapsed into it. */
  collapsed: Record<string, string[]>;
  /**
   * Rows naming another manufacturer's technology. Almost always a crossed VIN
   * or a description scraped from a different vehicle. Reported, never printed
   * as though we had verified it.
   */
  foreign: Array<{ item: string; technology: string; owner: OemBrand }>;
}

/**
 * Curate a decoded standard-equipment list into printable rows.
 *
 * Noise is dropped, overlapping rows collapse to one concept, and the rest pass
 * through deduplicated. Output order is stable: tier, then first appearance.
 */
export interface CurateOptions {
  /** Vehicle make, so each concept prints in that manufacturer's own words. */
  make?: string | null;
}

export function curateEquipment(raw: string[], opts: CurateOptions = {}): CurateResult {
  const brand: OemBrand = brandForMake(opts.make);
  /** Branded source > the make's own term > the rule's neutral fallback. */
  const labelFor = (concept: string, fallback: string) => oemTerm(concept, brand) ?? fallback;
  const dropped: string[] = [];
  const duplicates: Array<{ item: string; keptIn: string }> = [];
  const collapsed: Record<string, string[]> = {};
  const foreign: Array<{ item: string; technology: string; owner: OemBrand }> = [];
  const byConcept = new Map<string, CuratedItem>();
  const passthrough = new Map<string, CuratedItem>();
  const order: CuratedItem[] = [];

  /**
   * Resolve a row against the technology catalog.
   *
   * The catalog knows WHO owns a system, which the flat pattern list never
   * did. A row naming another manufacturer's technology is recorded as a feed
   * problem and treated as unbranded, so it can never supply a label — a Ford
   * does not get to print "Mark Levinson" because a scraped description said
   * so. A row we do own prints in the manufacturer's own rendering.
   */
  const resolve = (name: string): { label: string; branded: boolean; technology?: OemTechnology } => {
    const tech = findTechnology(name, brand);
    if (tech) return { label: officialTechnologyName(name, brand) ?? name, branded: true, technology: tech };
    const alien = findForeignTechnology(name, brand);
    if (alien) {
      foreign.push({ item: name, technology: alien.technology.name, owner: alien.owner });
      return { label: name, branded: false };
    }
    // Not catalogued either way. The flat list still recognises names we have
    // not yet entered, so coverage gaps degrade to the old behaviour.
    return { label: name, branded: isBrandedSource(name) };
  };

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
        // A branded name always wins the label; otherwise an upgrade label
        // applies only when a source row justifies it.
        const r = resolve(name);
        if (r.branded) {
          existing.name = r.label;
          existing.branded = true;
          if (r.technology) existing.technology = r.technology;
        } else if (rule.upgrade?.match.test(name) && !existing.branded) {
          const upConcept = rule.upgrade.concept ?? rule.concept;
          existing.name = labelFor(upConcept, rule.upgrade.canonical);
        }
        continue;
      }
      const r = resolve(name);
      const upgraded = rule.upgrade?.match.test(name) ? rule.upgrade : undefined;
      const item: CuratedItem = {
        name: r.branded
          ? r.label
          : upgraded
            ? labelFor(upgraded.concept ?? rule.concept, upgraded.canonical)
            : labelFor(rule.concept, rule.canonical),
        tier: rule.tier,
        concept: rule.concept,
        sources: [name],
        ...(r.branded ? { branded: true } : {}),
        ...(r.technology ? { technology: r.technology } : {}),
      };
      byConcept.set(rule.concept, item);
      order.push(item);
      continue;
    }

    const key = norm(name).replace(/[^a-z0-9]+/g, "");
    const seen = passthrough.get(key);
    if (seen) { seen.sources.push(name); duplicates.push({ item: name, keptIn: seen.name }); continue; }
    const r = resolve(name);
    const item: CuratedItem = {
      name: r.label, tier: 2, concept: null, sources: [name],
      ...(r.technology ? { technology: r.technology } : {}),
    };
    passthrough.set(key, item);
    order.push(item);
  }

  // Stable sort: tier first, original order within a tier.
  const items = order
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.tier - b.item.tier || a.i - b.i)
    .map(({ item }) => item);

  return { items, dropped, duplicates, collapsed, foreign };
}

/** Rows that fit page 1, filling by priority tier. */
export function selectForPageOne(items: CuratedItem[], capacity: number): {
  pageOne: CuratedItem[];
  continuation: CuratedItem[];
} {
  if (capacity >= items.length) return { pageOne: items, continuation: [] };
  return { pageOne: items.slice(0, capacity), continuation: items.slice(capacity) };
}
