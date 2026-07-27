import type {
  EquipmentCategory,
  PriceStatus,
  StandardEquipmentGroup,
  StickerOption,
  StickerPackage,
} from "./types.ts";

export const CATEGORY_ORDER: EquipmentCategory[] = [
  "EXTERIOR",
  "INTERIOR",
  "COMFORT_CONVENIENCE",
  "FUNCTIONAL",
  "POWERTRAIN",
  "SAFETY_SECURITY",
  "TECHNOLOGY",
  "OTHER",
];

const KNOWN_MARKS = [
  "LED", "AWD", "4WD", "ABS", "A/C", "USB", "HUD", "EV", "DOHC",
  "V6", "V8", "MPG", "SOS", "GPS", "iPod", "CarPlay", "ProPILOT",
];
const MARK_BY_KEY = new Map(KNOWN_MARKS.map((m) => [m.toLowerCase(), m]));

const SMALL_WORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "w", "w/", "with"]);

const splitToken = (token: string): [string, string, string] => {
  const m = /^([^A-Za-z0-9]*)([\s\S]*?)([^A-Za-z0-9]*)$/.exec(token);
  return m ? [m[1], m[2], m[3]] : ["", token, ""];
};

const isAllCaps = (s: string): boolean => /[A-Z]/.test(s) && !/[a-z]/.test(s);

const titleCaseCore = (core: string): string =>
  core
    .split("-")
    .map((seg) => {
      const restored = MARK_BY_KEY.get(seg.toLowerCase());
      if (restored) return restored;
      return seg ? seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase() : seg;
    })
    .join("-");

export function normalizeEquipmentName(raw: string): string {
  let s = String(raw ?? "").replace(/\s+/g, " ").trim();
  s = s.replace(/([\-.,;:!?/])\1+/g, "$1");
  s = s.replace(/[\s,;:]+$/g, "");
  if (!s) return "";

  // No lowercase letters anywhere means feed shout-case; title-case it and
  // restore known marks. Mixed-case input is deliberate — leave it intact.
  const shout = !/[a-z]/.test(s);
  return s
    .split(" ")
    .map((token, i) => {
      const direct = MARK_BY_KEY.get(token.toLowerCase());
      if (direct) return direct;
      const [lead, core, trail] = splitToken(token);
      const restored = MARK_BY_KEY.get(core.toLowerCase());
      if (restored) return lead + restored + trail;
      if (!shout) return token;
      if (/\d/.test(core) && core.length <= 6) return lead + core + trail;
      const coreLower = core.toLowerCase();
      const cased = i > 0 && SMALL_WORDS.has(coreLower) ? coreLower : titleCaseCore(core);
      return lead + cased + trail;
    })
    .join(" ");
}

export const dedupeKey = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "");

const CATEGORY_RULES: Array<[EquipmentCategory, RegExp]> = [
  ["SAFETY_SECURITY", /\b(airbags?|air bags?|abs|anti-?lock|anti-?theft|collision|emergency brak|automatic brak|lane (keep|depart|assist|change)|blind[- ]?spot|cross[- ]?traffic|stability|traction|tpms|tire pressure|alarm|immobilizer|security|pre-?crash|isofix|latch|sos|parking sensor|park(ing)? assist|driver alert|attention|night vision|360|surround[- ]view|backup camera|rear[- ]?view camera|adaptive cruise|intelligent cruise|propilot|intervention|seat ?belt|child lock)\b/i],
  ["TECHNOLOGY", /\b(navigation|touch ?screen|display|infotainment|bluetooth|usb|carplay|android auto|wi-?fi|wireless (charging|phone)|audio|speaker|sound system|bose|klipsch|radio|satellite|siriusxm|head-?up|hud|voice|telematics|smartphone|app suite|digital (cluster|key|assistant)|charging pad|gps)\b/i],
  ["POWERTRAIN", /\b(engine|motor|transmission|cvt|automatic$|speed automatic|manual|axle|differential|drivetrain|awd|4wd|fwd|rwd|four-?wheel drive|all-?wheel drive|exhaust|turbo|supercharg|hybrid|battery|kwh|horsepower|cylinder|dohc|v6|v8|paddle shifter|drive mode|regenerative)\b/i],
  ["COMFORT_CONVENIENCE", /\b(climate|air condition|a\/c|heated|ventilated|cooled|keyless|push[- ]?button start|remote (start|engine)|power (liftgate|tailgate|rear door)|cruise control|memory|massag|sunroof|moonroof|sunshade|armrest|cup ?holder|auto-?dimming|rain-?sensing|garage|homelink|hands-?free|tri-?zone|dual-?zone|conditioner)\b/i],
  ["INTERIOR", /\b(seats?|leather|semi-?aniline|upholstery|carpet|floor mats?|console|steering wheel|headliner|interior|ambient lighting|cabin|shift knob|pedals?|headrest|trim)\b/i],
  ["EXTERIOR", /\b(wheels?|tires?|paint|mirrors?|roof rail|spoiler|grille|bumper|running board|mud ?guard|head ?li(ght|ghts)|head ?lamp|tail ?li(ght|ghts)|tail ?lamp|fog (light|lamp)|led|daytime running|body|exterior|windows?|glass|windshield|wiper|door handle|badge|emblem|roof rack|crossbars|kick plate|liftgate spoiler|welcome lighting|puddle)\b/i],
  ["FUNCTIONAL", /\b(tow(ing)?|trailer|hitch|cargo|racks?|jack|spare|tool kit|first aid|tie-?downs?|bed ?liner|payload|skid plate|air suspension|adaptive suspension|load leveling|locking|net|organizer)\b/i],
];

export function categorizeEquipmentItem(name: string): EquipmentCategory {
  for (const [category, re] of CATEGORY_RULES) {
    if (re.test(name)) return category;
  }
  return "OTHER";
}

const HINT_RULES: Array<[EquipmentCategory, RegExp]> = [
  ["SAFETY_SECURITY", /safety|security|adas|driver.?assist|airbag|brak/i],
  ["TECHNOLOGY", /tech|infotain|connect|audio|entertain|instrument|telematic|navigation/i],
  ["POWERTRAIN", /powertrain|engine|mechanical|performance|drivetrain|suspension|transmission/i],
  ["COMFORT_CONVENIENCE", /comfort|convenien|climate/i],
  ["INTERIOR", /interior|seat|cabin/i],
  ["EXTERIOR", /exterior|body|light|wheel|roof/i],
  ["FUNCTIONAL", /functional|utility|cargo|tow/i],
];

export function categoryFromHint(hint: string): EquipmentCategory | undefined {
  for (const [category, re] of HINT_RULES) {
    if (re.test(hint)) return category;
  }
  return undefined;
}

export interface RawStandardItem {
  name: string;
  categoryHint?: string;
}

export interface RawPackageInput {
  code?: string;
  name: string;
  description?: string;
  price?: number;
  priceStatus: PriceStatus;
  features: string[];
}

export interface RawOptionInput {
  code?: string;
  name: string;
  description?: string;
  price?: number;
  priceStatus: PriceStatus;
}

export interface DedupeDecision {
  item: string;
  action: "DROPPED_DUPLICATE" | "DROPPED_PACKAGE_CONTENT";
  keptIn: string;
}

export interface EquipmentBuildResult {
  standard: StandardEquipmentGroup[];
  packages: StickerPackage[];
  options: StickerOption[];
  debug: {
    droppedDuplicates: string[];
    dedupeDecisions: DedupeDecision[];
  };
}

export interface EquipmentBuildInput {
  standard: Array<string | RawStandardItem>;
  packages: RawPackageInput[];
  options: RawOptionInput[];
}

export function buildEquipment(input: EquipmentBuildInput): EquipmentBuildResult {
  const droppedDuplicates: string[] = [];
  const dedupeDecisions: DedupeDecision[] = [];

  // Packages first so their contents can suppress double-counted options.
  const packages: StickerPackage[] = [];
  const packageKeys = new Map<string, string>();
  const packageFeatureKeys = new Map<string, string>();
  for (const raw of input.packages) {
    const name = normalizeEquipmentName(raw.name);
    if (!name) continue;
    const key = dedupeKey(name);
    const existing = packageKeys.get(key);
    if (existing) {
      droppedDuplicates.push(name);
      dedupeDecisions.push({ item: name, action: "DROPPED_DUPLICATE", keptIn: `package:${existing}` });
      continue;
    }
    packageKeys.set(key, name);
    const features: string[] = [];
    const seenFeatures = new Set<string>();
    for (const f of raw.features) {
      const fname = normalizeEquipmentName(f);
      if (!fname) continue;
      const fkey = dedupeKey(fname);
      if (seenFeatures.has(fkey)) {
        droppedDuplicates.push(fname);
        dedupeDecisions.push({ item: fname, action: "DROPPED_DUPLICATE", keptIn: `package:${name}` });
        continue;
      }
      seenFeatures.add(fkey);
      features.push(fname);
      if (!packageFeatureKeys.has(fkey)) packageFeatureKeys.set(fkey, name);
    }
    packages.push({
      ...(raw.code !== undefined ? { code: raw.code } : {}),
      name,
      ...(raw.description !== undefined ? { description: raw.description } : {}),
      ...(raw.price !== undefined ? { price: raw.price } : {}),
      priceStatus: raw.priceStatus,
      features,
    });
  }

  const options: StickerOption[] = [];
  const optionKeys = new Map<string, string>();
  for (const raw of input.options) {
    const name = normalizeEquipmentName(raw.name);
    if (!name) continue;
    const key = dedupeKey(name);
    const inPackageFeature = packageFeatureKeys.get(key);
    if (inPackageFeature) {
      dedupeDecisions.push({ item: name, action: "DROPPED_PACKAGE_CONTENT", keptIn: `package:${inPackageFeature}` });
      continue;
    }
    const asPackage = packageKeys.get(key);
    if (asPackage) {
      dedupeDecisions.push({ item: name, action: "DROPPED_PACKAGE_CONTENT", keptIn: `package:${asPackage}` });
      continue;
    }
    const existing = optionKeys.get(key);
    if (existing) {
      droppedDuplicates.push(name);
      dedupeDecisions.push({ item: name, action: "DROPPED_DUPLICATE", keptIn: `option:${existing}` });
      continue;
    }
    optionKeys.set(key, name);
    options.push({
      ...(raw.code !== undefined ? { code: raw.code } : {}),
      name,
      ...(raw.description !== undefined ? { description: raw.description } : {}),
      ...(raw.price !== undefined ? { price: raw.price } : {}),
      priceStatus: raw.priceStatus,
    });
  }

  const buckets = new Map<EquipmentCategory, string[]>();
  const standardKeys = new Map<string, string>();
  for (const raw of input.standard) {
    const item = typeof raw === "string" ? { name: raw } : raw;
    const name = normalizeEquipmentName(item.name);
    if (!name) continue;
    const key = dedupeKey(name);
    const existing = standardKeys.get(key);
    if (existing) {
      droppedDuplicates.push(name);
      dedupeDecisions.push({ item: name, action: "DROPPED_DUPLICATE", keptIn: `standard:${existing}` });
      continue;
    }
    standardKeys.set(key, name);
    const category =
      (item.categoryHint ? categoryFromHint(item.categoryHint) : undefined) ?? categorizeEquipmentItem(name);
    const bucket = buckets.get(category);
    if (bucket) bucket.push(name);
    else buckets.set(category, [name]);
  }

  const standard: StandardEquipmentGroup[] = CATEGORY_ORDER.filter((c) => buckets.has(c)).map((category) => ({
    category,
    items: buckets.get(category) as string[],
  }));

  return { standard, packages, options, debug: { droppedDuplicates, dedupeDecisions } };
}
