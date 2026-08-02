// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/oemTerminology.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ──────────────────────────────────────────────────────────────────────
// OEM terminology.
//
// Manufacturers name their own systems, and those names are the point. A GM
// label says "Automatic Emergency Braking" and "IntelliBeam"; the same hardware
// on a Nissan is "Intelligent Emergency Braking" and "High Beam Assist"; on a
// Toyota it is "Pre-Collision System". Printing one generic phrase across all
// of them is what makes a sticker read as generated rather than factory.
//
// Rules:
//   1. A branded name found verbatim in the source always wins — nothing here
//      overrides what the decoder actually said.
//   2. Otherwise use the make's own term for the concept.
//   3. Only fall back to a neutral phrase when the make is unknown.
//   4. Terms are the manufacturer's marketing name, not a description. No
//      "w/ Pedestrian Detection" tails appended to an OEM term.
// ──────────────────────────────────────────────────────────────────────

export type OemBrand =
  | "gm" | "ford" | "stellantis" | "nissan" | "toyota" | "honda" | "hyundai"
  | "subaru" | "mazda" | "vw" | "bmw" | "mercedes" | "volvo" | "tesla"
  | "jlr" | "porsche" | "generic";

const MAKE_TO_BRAND: Array<[RegExp, OemBrand]> = [
  [/^(gmc|chevrolet|chevy|cadillac|buick)$/i, "gm"],
  [/^(ford|lincoln)$/i, "ford"],
  [/^(jeep|ram|dodge|chrysler|alfa romeo|fiat|maserati)$/i, "stellantis"],
  [/^(nissan|infiniti)$/i, "nissan"],
  [/^(toyota|lexus|scion)$/i, "toyota"],
  [/^(honda|acura)$/i, "honda"],
  [/^(hyundai|kia|genesis)$/i, "hyundai"],
  [/^subaru$/i, "subaru"],
  [/^mazda$/i, "mazda"],
  [/^(volkswagen|vw|audi)$/i, "vw"],
  [/^(bmw|mini)$/i, "bmw"],
  [/^(mercedes|mercedes-benz|maybach|smart)$/i, "mercedes"],
  [/^(volvo|polestar)$/i, "volvo"],
  [/^tesla$/i, "tesla"],
  [/^(land rover|range rover|jaguar)$/i, "jlr"],
  [/^porsche$/i, "porsche"],
];

export function brandForMake(make?: string | null): OemBrand {
  const m = String(make ?? "").trim();
  if (!m) return "generic";
  for (const [re, brand] of MAKE_TO_BRAND) if (re.test(m)) return brand;
  return "generic";
}

/**
 * concept -> the term each manufacturer uses for it.
 * `generic` is the neutral fallback when the make is unknown; it is deliberately
 * plain rather than a marketing phrase we would be inventing.
 */
export const OEM_TERMS: Record<string, Partial<Record<OemBrand, string>>> = {
  aeb: {
    gm: "Automatic Emergency Braking",
    ford: "Pre-Collision Assist with Automatic Emergency Braking",
    stellantis: "Full-Speed Forward Collision Warning Plus",
    nissan: "Intelligent Emergency Braking",
    toyota: "Pre-Collision System with Pedestrian Detection",
    honda: "Collision Mitigation Braking System",
    hyundai: "Forward Collision-Avoidance Assist",
    subaru: "EyeSight Pre-Collision Braking",
    mazda: "Smart Brake Support",
    vw: "Front Assist",
    bmw: "Active Guard",
    mercedes: "Active Brake Assist",
    volvo: "City Safety",
    jlr: "Emergency Braking",
    porsche: "Warn and Brake Assist",
    generic: "Automatic Emergency Braking",
  },
  adaptive_cruise: {
    gm: "Adaptive Cruise Control",
    ford: "Adaptive Cruise Control with Stop-and-Go",
    stellantis: "Adaptive Cruise Control with Stop and Go",
    nissan: "Intelligent Cruise Control",
    toyota: "Dynamic Radar Cruise Control",
    honda: "Adaptive Cruise Control with Low-Speed Follow",
    hyundai: "Smart Cruise Control",
    subaru: "EyeSight Adaptive Cruise Control",
    mazda: "Mazda Radar Cruise Control",
    vw: "Adaptive Cruise Control",
    bmw: "Active Cruise Control",
    mercedes: "DISTRONIC",
    volvo: "Pilot Assist",
    jlr: "Adaptive Cruise Control",
    porsche: "Adaptive Cruise Control",
    generic: "Adaptive Cruise Control",
  },
  blind_spot: {
    gm: "Side Blind Zone Alert",
    ford: "BLIS with Cross-Traffic Alert",
    stellantis: "Blind Spot Monitoring",
    nissan: "Blind Spot Warning",
    toyota: "Blind Spot Monitor",
    honda: "Blind Spot Information System",
    hyundai: "Blind-Spot Collision-Avoidance Assist",
    subaru: "Blind-Spot Detection",
    mazda: "Blind Spot Monitoring",
    vw: "Side Assist",
    bmw: "Active Blind Spot Detection",
    mercedes: "Blind Spot Assist",
    volvo: "Blind Spot Information System",
    jlr: "Blind Spot Assist",
    generic: "Blind Spot Monitor",
  },
  lane_keep: {
    gm: "Lane Keep Assist with Lane Departure Warning",
    ford: "Lane-Keeping System",
    stellantis: "LaneSense Lane Departure Warning Plus",
    nissan: "Intelligent Lane Intervention",
    toyota: "Lane Departure Alert with Steering Assist",
    honda: "Lane Keeping Assist System",
    hyundai: "Lane Following Assist",
    subaru: "EyeSight Lane Keep Assist",
    mazda: "Lane-Keep Assist System",
    vw: "Lane Assist",
    bmw: "Lane Departure Warning",
    mercedes: "Active Lane Keeping Assist",
    volvo: "Lane Keeping Aid",
    generic: "Lane Keep Assist",
  },
  rear_camera: {
    gm: "Rear Vision Camera",
    ford: "Rear View Camera",
    stellantis: "ParkView Rear Back-Up Camera",
    nissan: "RearView Monitor",
    toyota: "Backup Camera",
    honda: "Multi-Angle Rearview Camera",
    hyundai: "Rearview Monitor",
    subaru: "Rear Vision Camera",
    mazda: "Rear-View Camera",
    generic: "Rear View Camera",
  },
  surround_view: {
    gm: "HD Surround Vision",
    ford: "360-Degree Camera",
    stellantis: "Surround View Camera",
    nissan: "Around View Monitor",
    toyota: "Panoramic View Monitor",
    honda: "Surround-View Camera System",
    hyundai: "Surround View Monitor",
    mercedes: "360° Camera",
    jlr: "3D Surround Camera",
    generic: "Surround View Camera",
  },
  auto_high_beam: {
    gm: "IntelliBeam",
    ford: "Auto High-Beam Headlamps",
    stellantis: "Automatic High-Beam Headlamp Control",
    nissan: "High Beam Assist",
    toyota: "Automatic High Beams",
    honda: "Auto High-Beam Headlights",
    hyundai: "High Beam Assist",
    subaru: "Automatic High Beam Assist",
    mazda: "High Beam Control System",
    vw: "Light Assist",
    bmw: "Adaptive LED Headlights",
    mercedes: "Adaptive Highbeam Assist",
    generic: "Automatic High Beams",
  },
  sunroof: {
    gm: "Power Sunroof",
    ford: "Vista Roof",
    stellantis: "Power Sunroof",
    nissan: "Power Sliding Moonroof",
    toyota: "Power Moonroof",
    honda: "Power Moonroof",
    hyundai: "Power Sunroof",
    subaru: "Power Moonroof",
    mazda: "Power Sliding-Glass Moonroof",
    generic: "Power Sunroof",
  },
  panoramic_sunroof: {
    gm: "Panoramic Sunroof",
    ford: "Panoramic Vista Roof",
    stellantis: "CommandView Dual-Pane Panoramic Sunroof",
    nissan: "Panoramic Moonroof",
    toyota: "Panoramic Moonroof",
    honda: "Panoramic Moonroof",
    hyundai: "Panoramic Sunroof",
    bmw: "Panoramic Moonroof",
    mercedes: "Panorama Roof",
    generic: "Panoramic Sunroof",
  },
  premium_audio: {
    generic: "Premium Audio System",
  },
  remote_start: {
    gm: "Remote Start",
    ford: "Remote Start",
    stellantis: "Remote Start System",
    nissan: "Remote Engine Start",
    toyota: "Remote Engine Start",
    hyundai: "Remote Start",
    generic: "Remote Engine Start",
  },
  power_liftgate: {
    gm: "Hands-Free Power Liftgate",
    ford: "Hands-Free Foot-Activated Liftgate",
    stellantis: "Power Liftgate",
    nissan: "Motion Activated Liftgate",
    toyota: "Hands-Free Power Back Door",
    honda: "Hands-Free Access Power Tailgate",
    hyundai: "Smart Power Liftgate",
    generic: "Power Liftgate",
  },
  parking_sensors: {
    gm: "Rear Park Assist",
    ford: "Reverse Sensing System",
    nissan: "Front and Rear Sonar System",
    toyota: "Intuitive Parking Assist",
    honda: "Parking Sensors",
    hyundai: "Parking Distance Warning",
    generic: "Parking Sensors",
  },
  running_boards: {
    gm: "Power-Retractable Assist Steps",
    ford: "Power Running Boards",
    stellantis: "Power Running Boards",
    generic: "Power Running Boards",
  },
  smartphone: {
    generic: "Apple CarPlay and Android Auto",
  },
  digital_radio: {
    generic: "SiriusXM Satellite Radio",
  },
};

/** The manufacturer's own term for a concept, if we know one. */
export function oemTerm(concept: string, brand: OemBrand): string | undefined {
  const row = OEM_TERMS[concept];
  if (!row) return undefined;
  return row[brand] ?? row.generic;
}
