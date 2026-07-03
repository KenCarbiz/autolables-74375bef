// ──────────────────────────────────────────────────────────────────────
// Equipment icon key — the locked numbered icon map for the All Features
// & Equipment drawer. One Lucide rounded-line icon per equipment class so
// the panel reads as a decoded build sheet, not a wall of ribbons. The
// generic fallback (65) is ONLY for features the matcher cannot classify.
// ──────────────────────────────────────────────────────────────────────

import {
  Cog, Wind, Leaf, BatteryCharging, Share2, MoveHorizontal, Repeat,
  SlidersHorizontal, RefreshCw, Gauge, Fuel, Droplets, Palette, Paintbrush,
  Disc, Circle, Luggage, Footprints, Umbrella, Brush, Armchair, Sofa, Flame,
  Fan, Bookmark, Users, Navigation, Bluetooth, Smartphone, MonitorSmartphone,
  Usb, Zap, Power, Eye, Route, ShieldAlert, Camera, Radar, Timer,
  AlertOctagon, Shield, Speaker, Volume2, Satellite, Radio, MonitorPlay,
  Thermometer, Snowflake, LifeBuoy, Sun, Sunrise, Lightbulb, DoorOpen,
  KeyRound, Package, Gift, Cpu, Sparkles, Layers, DollarSign, ShieldCheck,
  FilePlus, Wrench, Puzzle, HelpCircle, type LucideIcon,
} from "lucide-react";

export interface EquipmentIconDef {
  num: number;
  key: string;
  label: string;
  category: string;
  icon: LucideIcon;
}

const def = (num: number, key: string, label: string, category: string, icon: LucideIcon): EquipmentIconDef =>
  ({ num, key, label, category, icon });

export const EQUIPMENT_ICON_REGISTRY: Record<number, EquipmentIconDef> = {
  1: def(1, "engine", "Engine", "Performance / Engine", Cog),
  2: def(2, "turbo", "Turbo", "Performance / Engine", Wind),
  3: def(3, "hybrid", "Hybrid", "Performance / Engine", Leaf),
  4: def(4, "electric", "Electric / EV", "Performance / Engine", BatteryCharging),
  5: def(5, "awd", "AWD / 4WD", "Drivetrain / Transmission", Share2),
  6: def(6, "fwd-rwd", "FWD / RWD", "Drivetrain / Transmission", MoveHorizontal),
  7: def(7, "automatic", "Automatic", "Drivetrain / Transmission", Repeat),
  8: def(8, "manual-mode", "Manual Mode", "Drivetrain / Transmission", SlidersHorizontal),
  9: def(9, "cvt", "CVT", "Drivetrain / Transmission", RefreshCw),
  10: def(10, "mpg", "Fuel Economy", "Fuel / Efficiency", Gauge),
  11: def(11, "fuel-type", "Fuel Type", "Fuel / Efficiency", Fuel),
  12: def(12, "premium-fuel", "Premium Fuel", "Fuel / Efficiency", Droplets),
  13: def(13, "paint", "Paint / Color", "Exterior", Palette),
  14: def(14, "premium-paint", "Premium Paint", "Exterior", Paintbrush),
  15: def(15, "wheels", "Wheels", "Exterior", Disc),
  16: def(16, "tires", "Tires", "Exterior", Circle),
  17: def(17, "roof-rails", "Roof Rails", "Exterior", Luggage),
  18: def(18, "running-boards", "Running Boards", "Exterior", Footprints),
  19: def(19, "mud-flaps", "Mud Flaps", "Exterior", Umbrella),
  20: def(20, "interior-color", "Interior Color", "Interior / Seating", Brush),
  21: def(21, "seating", "Seating", "Interior / Seating", Armchair),
  22: def(22, "leather", "Leather Seats", "Interior / Seating", Sofa),
  23: def(23, "heated-seats", "Heated Seats", "Interior / Seating", Flame),
  24: def(24, "ventilated-seats", "Ventilated Seats", "Interior / Seating", Fan),
  25: def(25, "memory-seat", "Memory Seat", "Interior / Seating", Bookmark),
  26: def(26, "third-row", "Third Row", "Interior / Seating", Users),
  27: def(27, "navigation", "Navigation", "Technology", Navigation),
  28: def(28, "bluetooth", "Bluetooth", "Technology", Bluetooth),
  29: def(29, "carplay", "Apple CarPlay", "Technology", Smartphone),
  30: def(30, "android-auto", "Android Auto", "Technology", MonitorSmartphone),
  31: def(31, "usb", "USB", "Technology", Usb),
  32: def(32, "wireless-charging", "Wireless Charging", "Technology", Zap),
  33: def(33, "remote-start", "Remote Start", "Technology", Power),
  34: def(34, "blind-spot", "Blind Spot Monitor", "Safety", Eye),
  35: def(35, "lane-assist", "Lane Assist", "Safety", Route),
  36: def(36, "forward-collision", "Forward Collision", "Safety", ShieldAlert),
  37: def(37, "backup-camera", "Backup Camera", "Safety", Camera),
  38: def(38, "parking-sensors", "Parking Sensors", "Safety", Radar),
  39: def(39, "adaptive-cruise", "Adaptive Cruise", "Safety", Timer),
  40: def(40, "abs", "ABS", "Safety", AlertOctagon),
  41: def(41, "airbags", "Airbags", "Safety", Shield),
  42: def(42, "premium-audio", "Premium Audio", "Audio / Entertainment", Speaker),
  43: def(43, "branded-audio", "Branded Audio", "Audio / Entertainment", Volume2),
  44: def(44, "satellite-radio", "Satellite Radio", "Audio / Entertainment", Satellite),
  45: def(45, "hd-radio", "HD Radio", "Audio / Entertainment", Radio),
  46: def(46, "entertainment", "Entertainment System", "Audio / Entertainment", MonitorPlay),
  47: def(47, "climate", "Climate Control", "Comfort / Convenience", Thermometer),
  48: def(48, "dual-zone", "Dual Zone Climate", "Comfort / Convenience", Snowflake),
  49: def(49, "heated-wheel", "Heated Steering Wheel", "Comfort / Convenience", LifeBuoy),
  50: def(50, "sunroof", "Sunroof / Moonroof", "Comfort / Convenience", Sun),
  51: def(51, "panoramic-roof", "Panoramic Roof", "Comfort / Convenience", Sunrise),
  52: def(52, "ambient-lighting", "Ambient Lighting", "Comfort / Convenience", Lightbulb),
  53: def(53, "power-liftgate", "Power Liftgate", "Comfort / Convenience", DoorOpen),
  54: def(54, "keyless", "Keyless Entry", "Comfort / Convenience", KeyRound),
  55: def(55, "package", "Package", "Packages & Options", Package),
  56: def(56, "premium-package", "Premium Package", "Packages & Options", Gift),
  57: def(57, "technology-package", "Technology Package", "Packages & Options", Cpu),
  58: def(58, "appearance-package", "Appearance Package", "Packages & Options", Sparkles),
  59: def(59, "convenience-package", "Convenience Package", "Packages & Options", Layers),
  60: def(60, "option-value", "Option Value", "Packages & Options", DollarSign),
  61: def(61, "factory-warranty", "Factory Warranty", "Warranty & Dealer Add-ons", ShieldCheck),
  62: def(62, "extended-warranty", "Extended Warranty", "Warranty & Dealer Add-ons", FilePlus),
  63: def(63, "dealer-addon", "Dealer Add-on", "Warranty & Dealer Add-ons", Wrench),
  64: def(64, "accessory", "Installed Accessory", "Warranty & Dealer Add-ons", Puzzle),
  65: def(65, "unknown", "Feature", "Fallback", HelpCircle),
};

// Lowercase, strip punctuation (keeping "." and "/" so "3.0L" and "19/27 MPG"
// survive), canonicalize drivetrain spellings, collapse whitespace.
const normalize = (raw: string): string =>
  ` ${String(raw || "")
    .toLowerCase()
    .replace(/[^\w\s./]/g, " ")
    .replace(/\bfour[\s-]?wheel[\s-]?drive\b|\b4[\s-]?wheel[\s-]?drive\b/g, "4wd")
    .replace(/\ball[\s-]?wheel[\s-]?drive\b/g, "awd")
    .replace(/\bfront[\s-]?wheel[\s-]?drive\b/g, "fwd")
    .replace(/\brear[\s-]?wheel[\s-]?drive\b/g, "rwd")
    .replace(/\bmoon\s+roof\b/g, "moonroof")
    .replace(/\s+/g, " ")
    .trim()} `;

// Keyword rules in specificity order — the first match wins, so compound
// terms (heated steering wheel, panoramic roof, premium paint, branded
// audio) must run before their generic parents.
const KEYWORD_RULES: { re: RegExp; num: number }[] = [
  // Packages first: "Essential Package (3.0t LUXE)" is a package, not an engine.
  { re: /\b(technology|tech|driver assistance) package\b/, num: 57 },
  { re: /\b(premium|luxury|deluxe) package\b/, num: 56 },
  { re: /\b(appearance|sport appearance|blackout|chrome) package\b/, num: 58 },
  { re: /\b(convenience|comfort) package\b/, num: 59 },
  { re: /\b(option|added|factory option|msrp option) value\b/, num: 60 },
  { re: /\bpackage\b/, num: 55 },
  // Warranty & dealer add-ons
  { re: /\b(extended warranty|service contract|vsc|vehicle service contract)\b/, num: 62 },
  { re: /\b(factory|oem|manufacturer|basic|powertrain) warranty\b/, num: 61 },
  { re: /\bdealer (add.?on|installed|accessory)\b|\badd.?on\b/, num: 63 },
  { re: /\b(installed )?(accessor(y|ies)|installed equipment)\b/, num: 64 },
  // Comfort compounds before their generic parents
  { re: /\bheated (steering )?wheel\b|\bheated steering\b/, num: 49 },
  { re: /\bpanoramic\b|\bglass roof\b/, num: 51 },
  { re: /\b(sunroof|moonroof)\b/, num: 50 },
  { re: /\b(dual|tri|multi)[\s-]?zone\b/, num: 48 },
  { re: /\b(climate control|automatic climate|air conditioning|hvac)\b/, num: 47 },
  { re: /\b(ambient|mood|interior) lighting\b/, num: 52 },
  { re: /\b(power|hands.?free) (liftgate|tailgate|hatch)\b|\bpower liftgate\b|\brear hatch\b/, num: 53 },
  { re: /\b(keyless|smart key|proximity key|push button start)\b/, num: 54 },
  // Interior / seating
  { re: /\b(ventilated|cooled|air.?conditioned) seat/, num: 24 },
  { re: /\bheated (front |rear )?seat/, num: 23 },
  { re: /\b(memory seat|driver memory|seat memory)\b/, num: 25 },
  { re: /\b(third row|3rd row|rear row)\b/, num: 26 },
  { re: /\bleather\b/, num: 22 },
  { re: /\binterior color\b|\b(wheat|tan|graphite|charcoal) interior\b|\binterior\b.*\bcolor\b/, num: 20 },
  // Generic seats last within seating — every specific seat type (heated,
  // ventilated, memory, leather, third row) already matched above.
  { re: /\b(seating|passenger|bucket seat|captain)\b|\bseats?\b/, num: 21 },
  // Technology
  { re: /\b(apple )?carplay\b/, num: 29 },
  { re: /\bandroid auto\b/, num: 30 },
  { re: /\bwireless (charg|phone charg)|\bqi charger\b/, num: 32 },
  { re: /\busb\b|\bcharging port\b/, num: 31 },
  { re: /\bbluetooth\b|\bhands.?free\b|\bphone pairing\b/, num: 28 },
  { re: /\b(navigation|gps|nav|map system)\b/, num: 27 },
  { re: /\bremote (engine )?start\b|\bkey fob start\b/, num: 33 },
  // Safety
  { re: /\bblind.?spot\b|\bbsm\b/, num: 34 },
  { re: /\blane (assist|departure|keep|warning)/, num: 35 },
  { re: /\b(forward|front|pre.?) ?collision\b|\bcollision warning\b|\bemergency brak/, num: 36 },
  { re: /\b(backup|rear.?view|rear|360|around.?view) (camera|monitor)\b|\bbackup camera\b/, num: 37 },
  { re: /\bpark(ing)? (sensor|assist|sonar)|\b(front|rear) sensors\b/, num: 38 },
  { re: /\b(adaptive|intelligent|dynamic) cruise\b|\bcruise control with distance\b/, num: 39 },
  { re: /\babs\b|\banti.?lock\b/, num: 40 },
  { re: /\bairbag|\bsupplemental restraint\b/, num: 41 },
  // Audio
  { re: /\b(bose|harman|jbl|burmester|mark levinson|bang olufsen|meridian)\b|\bbrand(ed)? audio\b/, num: 43 },
  { re: /\b(premium|upgraded) (audio|sound)\b/, num: 42 },
  { re: /\b(satellite radio|siriusxm|xm radio)\b/, num: 44 },
  { re: /\bhd radio\b/, num: 45 },
  { re: /\b(entertainment system|rear entertainment|dvd|rear screen)/, num: 46 },
  // Fuel / efficiency
  { re: /\bmpg\b|\bfuel econom/, num: 10 },
  { re: /\bpremium (fuel|gas)\b|\brequires premium\b/, num: 12 },
  { re: /\b(gasoline|diesel|flex fuel|fuel type)\b/, num: 11 },
  // Drivetrain / transmission
  { re: /\b(awd|4wd|4x4)\b/, num: 5 },
  { re: /\b(fwd|rwd)\b/, num: 6 },
  { re: /\bcvt\b|\bcontinuously variable\b/, num: 9 },
  { re: /\bmanual (shift )?mode\b|\bpaddle shifter|\bshiftable\b|\bsport mode trans/, num: 8 },
  { re: /\bautomatic\b|\bauto trans/, num: 7 },
  // Performance / engine
  { re: /\bturbo/, num: 2 },
  { re: /\b(hybrid|hev)\b|\bgas.?electric\b/, num: 3 },
  { re: /\b(electric|ev|phev|plug.?in|battery electric)\b/, num: 4 },
  { re: /\bengine\b|\bv6\b|\bv8\b|\bcylinder\b|\bhorsepower\b|\bpowertrain\b|\b\d\.\d\s?l\b|\b\d\.\dl\b/, num: 1 },
  // Dealer-installed protection products (addendum line items)
  { re: /\bwindow tint|tint\b/, num: 14 },
  { re: /\bpaint protection|ppf\b|\bceramic coat/, num: 14 },
  { re: /\bwheel lock/, num: 15 },
  { re: /\bfloor (mat|liner)|all.?weather mat/, num: 64 },
  { re: /\bnitrogen\b|\bdoor edge guard|\bpinstripe/, num: 64 },
  // Exterior
  { re: /\b(premium|special|pearl|metallic|tri.?coat) paint\b/, num: 14 },
  { re: /\b(alloy|aluminum)\b|\bwheels?\b|\brims\b|\b\d{2}.?inch wheel/, num: 15 },
  { re: /\btires?\b/, num: 16 },
  { re: /\broof (rail|rack)|\bcrossbar/, num: 17 },
  { re: /\brunning board|\bside step|\bstep rail/, num: 18 },
  { re: /\bmud flap|\bsplash guard/, num: 19 },
  { re: /\b(exterior color|paint)\b|\b(majestic|pearl|onyx|graphite|champagne|burgundy|charcoal|white|black|silver|gray|grey|red|blue|green|brown|beige)\b/, num: 13 },
];

// Coarse category → default icon, used when the name itself doesn't match.
const CATEGORY_DEFAULTS: { re: RegExp; num: number }[] = [
  { re: /performance|engine/, num: 1 },
  { re: /drivetrain|transmission/, num: 5 },
  { re: /safety/, num: 41 },
  { re: /tech/, num: 28 },
  { re: /audio|entertainment/, num: 42 },
  { re: /comfort|convenience/, num: 47 },
  { re: /exterior/, num: 13 },
  { re: /interior|seat/, num: 21 },
  { re: /package|option/, num: 55 },
  { re: /warranty/, num: 61 },
  { re: /accessor|add.?on|dealer/, num: 64 },
  { re: /fuel|efficiency/, num: 11 },
];

export interface EquipmentFeatureInput {
  name: string;
  category?: string | null;
  description?: string | null;
}

export const getEquipmentIcon = (feature: string | EquipmentFeatureInput): EquipmentIconDef => {
  const f = typeof feature === "string" ? { name: feature } : feature;
  const name = normalize(f.name);
  if (name.trim()) {
    for (const rule of KEYWORD_RULES) if (rule.re.test(name)) return EQUIPMENT_ICON_REGISTRY[rule.num];
  }
  const cat = normalize(f.category || "");
  if (cat.trim()) {
    for (const rule of CATEGORY_DEFAULTS) if (rule.re.test(cat)) return EQUIPMENT_ICON_REGISTRY[rule.num];
  }
  const desc = normalize(f.description || "");
  if (desc.trim()) {
    for (const rule of KEYWORD_RULES) if (rule.re.test(desc)) return EQUIPMENT_ICON_REGISTRY[rule.num];
  }
  return EQUIPMENT_ICON_REGISTRY[65];
};
