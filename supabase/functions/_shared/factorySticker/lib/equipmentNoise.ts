// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/equipmentNoise.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { brandForMake, oemTerm, type OemBrand } from "./oemTerminology.ts";
import { findForeignTechnology, findTechnology, officialTechnologyName, type OemTechnology, } from "./oemTechnology.ts";
export type EquipmentTier = 1 | 2 | 3;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const COLOR_WORDS = new Set([
    "black",
    "white",
    "blue",
    "red",
    "green",
    "silver",
    "grey",
    "gray",
    "brown",
    "beige",
    "tan",
    "gold",
    "bronze",
    "ivory",
    "charcoal",
    "graphite",
    "walnut",
    "chrome",
    "titanium",
    "platinum",
    "sand",
    "cocoa",
    "ebony",
]);
const COLOR_MODIFIERS = new Set([
    "midnight",
    "dark",
    "light",
    "deep",
    "metallic",
    "pearl",
    "jet",
    "arctic",
    "summit",
    "onyx",
    "satin",
    "matte",
    "gloss",
    "medium",
    "very",
]);
const NOISE_PATTERNS: RegExp[] = [
    /^operates?\s+(above|below|between|at)\b/i,
    /^(front|rear)\s+wheel\s+(diameter|width)\b/i,
    /^wheel\s+(diameter|width)\b/i,
    /^(visual|acoustic|audible|visual\/acoustic)\s+(warning|alert)$/i,
    /^activates?\s+brake\s+lights?$/i,
    /^(stop|go)\s+function$/i,
    /^(with|w\/)\s/i,
    /^(standard|optional|included|equipment|feature|other|misc|n\/?a|none|tbd)$/i,
    /^(front|rear|left|right|driver|passenger)$/i,
    /^\d+(\.\d+)?\s*(in|inch|mm|cm)$/i,
];
export function isDecoderNoise(raw: string): boolean {
    const s = norm(raw);
    if (!s)
        return true;
    if (COLOR_WORDS.has(s))
        return true;
    const words = s.split(" ");
    if (words.length === 2 && COLOR_WORDS.has(words[1]) && (COLOR_WORDS.has(words[0]) || COLOR_MODIFIERS.has(words[0]))) {
        return true;
    }
    return NOISE_PATTERNS.some((re) => re.test(s));
}
interface ConceptRule {
    concept: string;
    canonical: string;
    tier: EquipmentTier;
    match: RegExp;
    upgrade?: {
        match: RegExp;
        canonical: string;
        concept?: string;
    };
    weaker?: {
        match: RegExp;
        canonical: string;
        concept: string;
        strongEvidence?: RegExp;
    };
}
function evidenceLevel(rule: ConceptRule, name: string, alt = name): {
    bucket: string;
    concept: string;
    canonical: string;
} {
    const hit = (re?: RegExp) => !!re && (re.test(name) || re.test(alt));
    const w = rule.weaker;
    if (w && hit(w.match) && !hit(w.strongEvidence)) {
        return { bucket: w.concept, concept: w.concept, canonical: w.canonical };
    }
    const up = rule.upgrade;
    if (up && hit(up.match)) {
        return { bucket: rule.concept, concept: up.concept ?? rule.concept, canonical: up.canonical };
    }
    return { bucket: rule.concept, concept: rule.concept, canonical: rule.canonical };
}
const BRANDED_SOURCE = new RegExp([
    "propilot",
    "pro ?pilot",
    "safety shield",
    "super ?cruise",
    "bluecruise",
    "co-?pilot ?360",
    "drive pilot",
    "honda sensing",
    "acurawatch",
    "eyesight",
    "toyota safety sense",
    "lexus safety system",
    "distronic",
    "pre-?safe",
    "driving assistant",
    "active driving assistant",
    "pilot assist",
    "city safety",
    "intellisafe",
    "smart ?sense",
    "highway driving assist",
    "autopilot",
    "travel assist",
    "iq\\.?drive",
    "audi pre ?sense",
    "i-?activsense",
    "mi-?pilot",
    "activedriveassist",
    "nissan safety shield",
    "\\bbsd\\b",
    "\\bhda\\b",
    "activeglide",
    "teammate",
    "dreamdrive",
    "innodrive",
    "drive wise",
    "lanesense",
    "driverfocus",
    "attention assist",
    "parktronic",
    "parksense",
    "parkview",
    "blis\\b",
    "side blind zone",
    "around view",
    "intellibeam",
    "rivian autonomy",
    "highway assistant",
    "steering and lane control",
    "bose",
    "burmester",
    "mark levinson",
    "harman ?kardon",
    "meridian",
    "revel",
    "bang (&|and) olufsen",
    "b&o",
    "naim",
    "akg",
    "sony",
    "jbl",
    "infinity",
    "klipsch",
    "lexicon",
    "dynaudio",
    "focal",
    "els studio",
    "fender",
    "beats",
    "alpine",
    "rockford fosgate",
    "mcintosh",
    "sennheiser",
    "sync ?[0-9]?",
    "uconnect",
    "idrive",
    "mbux",
    "comand",
    "\\bmmi\\b",
    "entune",
    "onstar",
    "blue ?link",
    "fordpass",
    "starlink",
    "nissanconnect",
    "kia connect",
    "wireless (apple )?carplay",
    "android auto",
    "quattro",
    "xdrive",
    "4matic",
    "sh-?awd",
    "real time awd",
    "terrain response",
    "magnetic ride control",
    "magneride",
    "adaptive air suspension",
    "torsen",
    "e-?lsd",
    "e-?4orce",
    "ecoboost",
    "powerboost",
    "hemi",
    "duramax",
    "power ?stroke",
    "\\btdi\\b",
    "\\btfsi\\b",
    "i-?vtec",
    "\\bvtec\\b",
    "skyactiv",
    "crawl control",
    "trail control",
    "terrain management",
    "selec-?terrain",
    "s-?awc",
    "4motion",
    "all4",
    "\\bpdk\\b",
    "tiptronic",
    "x-?mode",
    "g\\.?o\\.?a\\.?t\\.? modes",
    "multi-?terrain select",
    "pro trailer backup",
    "advanced trailering",
    "airmatic",
    "e-?active body control",
    "dynamic chassis control",
    "\\be-?pedal\\b",
    "\\bi-?pedal\\b",
    "vista roof",
    "commandview",
    "panoramic vista",
    "magic body control",
    "head-?up display",
    "night vision assist",
    "surround ?view",
    "birds-?eye view",
    "around view monitor",
    "multi-?terrain monitor",
    "clearsight",
    "multibeam",
    "digital light",
    "matrix(-| )design",
    "pixel led",
    "panoramic view monitor",
    "glass canopy",
].join("|"), "i");
export const isBrandedSource = (name: string): boolean => BRANDED_SOURCE.test(name);
const CONCEPT_RULES: ConceptRule[] = [
    {
        concept: "aeb",
        canonical: "Automatic Emergency Braking",
        tier: 1,
        match: /\b(automatic braking|automatic emergency brak|brakes? at low speed|emergency brak|forward collision|pre-?collision|pedestrian (&|and)? ?cyclist|city brak)/i,
        weaker: {
            match: /\b(forward collision|pre-?collision)\b/i,
            strongEvidence: /\bbrak/i,
            canonical: "Forward Collision Warning",
            concept: "fcw",
        },
    },
    {
        concept: "sunroof",
        canonical: "Power Sunroof",
        tier: 1,
        match: /\b(sunroofs?|moonroofs?|panoramic roof|glass roof)\b/i,
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
        weaker: {
            match: /\blane departure\b/i,
            strongEvidence: /\b(keep|keeping|assist|intervention|steer|centering)/i,
            canonical: "Lane Departure Warning",
            concept: "ldw",
        },
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
        weaker: {
            match: /\bspeed limiter\b/i,
            strongEvidence: /\bcruise\b/i,
            canonical: "Speed Limiter",
            concept: "speed_limiter",
        },
    },
    {
        concept: "led_headlights",
        canonical: "LED Headlights",
        tier: 2,
        match: /\b(led headlights?|led head ?lamps?|complex surface headlights?|headlights?[- ](low|high) beam)\b/i,
        weaker: {
            match: /\bheadlights?[- ](low|high) beam\b/i,
            strongEvidence: /\bled\b/i,
            canonical: "Headlamps",
            concept: "headlamps",
        },
    },
    {
        concept: "auto_high_beam",
        canonical: "Automatic High Beams",
        tier: 3,
        match: /\b(auto high beams?|automatic high beams?|high beam assist|dusk sensor)\b/i,
        weaker: {
            match: /\bdusk sensor\b/i,
            strongEvidence: /\bhigh beam\b/i,
            canonical: "Automatic Headlamp Control",
            concept: "auto_headlamps",
        },
    },
    {
        concept: "premium_audio",
        canonical: "Audio System",
        tier: 2,
        match: /\b(premium brand speakers?|surround sound|subwoofer|\d+ speakers?|bose|bang (&|and) olufsen|harman|klipsch|premium audio)\b/i,
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
        weaker: {
            match: /\b(illuminated steps?|side steps?|assist steps?|running boards?)\b/i,
            strongEvidence: /\b(power|retract|deploy|automatic)/i,
            canonical: "Running Boards",
            concept: "fixed_running_boards",
        },
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
        match: /\b(bluetooth connection|built-?in apps|smartphone)\b/i,
    },
];
export interface CuratedItem {
    name: string;
    tier: EquipmentTier;
    concept: string | null;
    sources: string[];
    branded?: boolean;
    technology?: OemTechnology;
}
export interface CurateResult {
    items: CuratedItem[];
    dropped: string[];
    duplicates: Array<{
        item: string;
        keptIn: string;
    }>;
    collapsed: Record<string, string[]>;
    foreign: Array<{
        item: string;
        technology: string;
        owner: OemBrand;
    }>;
    quarantined: string[];
}
export interface CurateOptions {
    make?: string | null;
}
export function curateEquipment(raw: string[], opts: CurateOptions = {}): CurateResult {
    const brand: OemBrand = brandForMake(opts.make);
    const labelFor = (concept: string, fallback: string) => oemTerm(concept, brand) ?? fallback;
    const dropped: string[] = [];
    const duplicates: Array<{
        item: string;
        keptIn: string;
    }> = [];
    const collapsed: Record<string, string[]> = {};
    const foreign: Array<{
        item: string;
        technology: string;
        owner: OemBrand;
    }> = [];
    const quarantined: string[] = [];
    const byConcept = new Map<string, CuratedItem>();
    const passthrough = new Map<string, CuratedItem>();
    const order: CuratedItem[] = [];
    const resolve = (name: string): {
        label: string;
        branded: boolean;
        foreign?: boolean;
        technology?: OemTechnology;
    } => {
        const tech = findTechnology(name, brand);
        if (tech)
            return { label: officialTechnologyName(name, brand) ?? name, branded: true, technology: tech };
        const alien = findForeignTechnology(name, brand);
        if (alien) {
            foreign.push({ item: name, technology: alien.technology.name, owner: alien.owner });
            return { label: "", branded: false, foreign: true };
        }
        return { label: name, branded: isBrandedSource(name) };
    };
    for (const source of raw) {
        const name = String(source ?? "").replace(/\s+/g, " ").trim();
        if (!name)
            continue;
        if (isDecoderNoise(name)) {
            dropped.push(name);
            continue;
        }
        const owned = resolve(name);
        if (owned.foreign) {
            quarantined.push(name);
            continue;
        }
        const matchable = name.replace(/[-\u2010-\u2015]/g, " ").replace(/\s+/g, " ");
        const rule = CONCEPT_RULES.find((r) => r.match.test(name) || r.match.test(matchable));
        if (rule) {
            const level = evidenceLevel(rule, name, matchable);
            (collapsed[level.bucket] ||= []).push(name);
            const existing = byConcept.get(level.bucket);
            if (existing) {
                existing.sources.push(name);
                const r = owned;
                if (r.branded) {
                    existing.name = r.label;
                    existing.branded = true;
                    if (r.technology)
                        existing.technology = r.technology;
                }
                else if (!existing.branded && level.canonical !== rule.canonical) {
                    existing.name = labelFor(level.concept, level.canonical);
                    existing.concept = level.concept;
                }
                continue;
            }
            const r = owned;
            const item: CuratedItem = {
                name: r.branded ? r.label : labelFor(level.concept, level.canonical),
                tier: rule.tier,
                concept: level.concept,
                sources: [name],
                ...(r.branded ? { branded: true } : {}),
                ...(r.technology ? { technology: r.technology } : {}),
            };
            byConcept.set(level.bucket, item);
            order.push(item);
            continue;
        }
        const key = norm(name).replace(/[^a-z0-9]+/g, "");
        const seen = passthrough.get(key);
        if (seen) {
            seen.sources.push(name);
            duplicates.push({ item: name, keptIn: seen.name });
            continue;
        }
        const r = owned;
        const item: CuratedItem = {
            name: r.label || name,
            tier: 2,
            concept: null,
            sources: [name],
            ...(r.technology ? { technology: r.technology } : {}),
        };
        passthrough.set(key, item);
        order.push(item);
    }
    const items = order
        .map((item, i) => ({ item, i }))
        .sort((a, b) => a.item.tier - b.item.tier || a.i - b.i)
        .map(({ item }) => item);
    return { items, dropped, duplicates, collapsed, foreign, quarantined };
}
export function selectForPageOne(items: CuratedItem[], capacity: number): {
    pageOne: CuratedItem[];
    continuation: CuratedItem[];
} {
    if (capacity >= items.length)
        return { pageOne: items, continuation: [] };
    return { pageOne: items.slice(0, capacity), continuation: items.slice(capacity) };
}
