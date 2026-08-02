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
//   2. Otherwise use the marque's own term for the concept, falling back to its
//      corporate family, then to a neutral phrase.
//   3. Terms are the manufacturer's marketing name, not a description. No
//      "w/ Pedestrian Detection" tails appended to an OEM term.
//   4. Only list a term the maker uses for that concept across the lineup. An
//      OPTIONAL package name (AKG Studio, MULTIBEAM LED, Super Cruise on a
//      base trim) is not a synonym for the concept — asserting it from a
//      generic decoder row would be inventing equipment the car may not have.
//      Those names reach the sticker through rule 1 instead.
// ──────────────────────────────────────────────────────────────────────

/**
 * One key per marque sold in the US, plus the corporate families they inherit
 * from. Marques are separate keys because the terminology genuinely diverges:
 * Lexus is not Toyota, Acura is not Honda, Kia is not Hyundai.
 */
export type OemBrand =
  // Corporate families (fallback tier)
  | "gm" | "ford" | "stellantis" | "nissan" | "toyota" | "honda" | "hyundai"
  | "vw" | "bmw" | "mercedes" | "volvo" | "jlr" | "generic"
  // General Motors
  | "chevrolet" | "gmc" | "buick" | "cadillac"
  // Ford Motor Company
  | "lincoln"
  // Stellantis
  | "jeep" | "ram" | "dodge" | "chrysler" | "alfa_romeo" | "fiat" | "maserati"
  // Nissan Motor
  | "infiniti"
  // Toyota Motor
  | "lexus"
  // Honda Motor
  | "acura"
  // Hyundai Motor Group
  | "kia" | "genesis"
  // Independent Japanese
  | "subaru" | "mazda" | "mitsubishi"
  // Volkswagen Group
  | "audi" | "porsche" | "bentley" | "lamborghini"
  // BMW Group
  | "mini" | "rolls_royce"
  // Volvo Cars / Geely
  | "polestar"
  // JLR
  | "land_rover" | "jaguar"
  // US EV and specialty
  | "tesla" | "rivian" | "lucid"
  | "ferrari" | "mclaren" | "aston_martin" | "lotus" | "vinfast";

/** Marque -> corporate family. Unlisted keys are their own root. */
const BRAND_PARENT: Partial<Record<OemBrand, OemBrand>> = {
  chevrolet: "gm", gmc: "gm", buick: "gm", cadillac: "gm",
  lincoln: "ford",
  jeep: "stellantis", ram: "stellantis", dodge: "stellantis",
  chrysler: "stellantis", alfa_romeo: "stellantis", fiat: "stellantis",
  maserati: "stellantis",
  infiniti: "nissan",
  lexus: "toyota",
  acura: "honda",
  kia: "hyundai", genesis: "hyundai",
  audi: "vw", porsche: "vw", bentley: "vw", lamborghini: "vw",
  mini: "bmw", rolls_royce: "bmw",
  polestar: "volvo",
  land_rover: "jlr", jaguar: "jlr",
};

const MAKE_TO_BRAND: Array<[RegExp, OemBrand]> = [
  [/^(chevrolet|chevy|chev)$/i, "chevrolet"],
  [/^gmc( trucks?)?$/i, "gmc"],
  [/^buick$/i, "buick"],
  [/^cadillac$/i, "cadillac"],
  [/^ford$/i, "ford"],
  [/^lincoln$/i, "lincoln"],
  [/^jeep$/i, "jeep"],
  [/^ram( trucks?)?$/i, "ram"],
  [/^dodge$/i, "dodge"],
  [/^chrysler$/i, "chrysler"],
  [/^alfa[ -]?romeo$/i, "alfa_romeo"],
  [/^fiat$/i, "fiat"],
  [/^maserati$/i, "maserati"],
  [/^nissan|^datsun$/i, "nissan"],
  [/^infinit[iy]$/i, "infiniti"],
  [/^(toyota|scion)$/i, "toyota"],
  [/^lexus$/i, "lexus"],
  [/^honda$/i, "honda"],
  [/^acura$/i, "acura"],
  [/^hyundai$/i, "hyundai"],
  [/^kia$/i, "kia"],
  [/^genesis( motors?)?$/i, "genesis"],
  [/^subaru$/i, "subaru"],
  [/^mazda$/i, "mazda"],
  [/^mitsubishi$/i, "mitsubishi"],
  [/^(volkswagen|volkswagon|vw)$/i, "vw"],
  [/^audi$/i, "audi"],
  [/^porsche$/i, "porsche"],
  [/^bentley$/i, "bentley"],
  [/^lamborghini$/i, "lamborghini"],
  [/^bmw$/i, "bmw"],
  [/^mini( cooper)?$/i, "mini"],
  [/^rolls[ -]?royce$/i, "rolls_royce"],
  [/^(mercedes|mercedes-benz|mercedes benz|benz|maybach|smart)$/i, "mercedes"],
  [/^volvo$/i, "volvo"],
  [/^polestar$/i, "polestar"],
  [/^(land rover|range rover|land-rover)$/i, "land_rover"],
  [/^jaguar$/i, "jaguar"],
  [/^tesla$/i, "tesla"],
  [/^rivian$/i, "rivian"],
  [/^lucid( motors)?$/i, "lucid"],
  [/^ferrari$/i, "ferrari"],
  [/^mclaren$/i, "mclaren"],
  [/^aston[ -]?martin$/i, "aston_martin"],
  [/^lotus$/i, "lotus"],
  [/^vinfast$/i, "vinfast"],
];

export function brandForMake(make?: string | null): OemBrand {
  const m = String(make ?? "").trim();
  if (!m) return "generic";
  for (const [re, brand] of MAKE_TO_BRAND) if (re.test(m)) return brand;
  return "generic";
}

/**
 * concept -> the term each manufacturer uses for it.
 *
 * A marque entry overrides its family; `generic` is the neutral fallback and is
 * deliberately plain rather than a marketing phrase we would be inventing. A
 * concept with no `generic` falls through to the caller's own label.
 */
export const OEM_TERMS: Record<string, Partial<Record<OemBrand, string>>> = {
  // ── Collision avoidance ─────────────────────────────────────────────
  aeb: {
    gm: "Automatic Emergency Braking",
    ford: "Pre-Collision Assist with Automatic Emergency Braking",
    stellantis: "Full-Speed Forward Collision Warning Plus",
    nissan: "Intelligent Emergency Braking",
    toyota: "Pre-Collision System",
    honda: "Collision Mitigation Braking System",
    hyundai: "Forward Collision-Avoidance Assist",
    subaru: "EyeSight Pre-Collision Braking",
    mazda: "Smart Brake Support",
    mitsubishi: "Forward Collision Mitigation",
    vw: "Front Assist",
    audi: "Audi pre sense front",
    porsche: "Warn and Brake Assist",
    bmw: "Frontal Collision Warning with City Collision Mitigation",
    mercedes: "Active Brake Assist",
    volvo: "City Safety",
    jlr: "Emergency Braking",
    tesla: "Automatic Emergency Braking",
    rivian: "Automatic Emergency Braking",
    lucid: "Automatic Emergency Braking",
    generic: "Automatic Emergency Braking",
  },
  adaptive_cruise: {
    gm: "Adaptive Cruise Control",
    ford: "Adaptive Cruise Control",
    stellantis: "Adaptive Cruise Control",
    nissan: "Intelligent Cruise Control",
    toyota: "Dynamic Radar Cruise Control",
    honda: "Adaptive Cruise Control",
    hyundai: "Smart Cruise Control",
    subaru: "EyeSight Adaptive Cruise Control",
    mazda: "Mazda Radar Cruise Control",
    vw: "Adaptive Cruise Control",
    porsche: "Adaptive Cruise Control",
    bmw: "Active Cruise Control",
    mercedes: "Active Distance Assist DISTRONIC",
    volvo: "Adaptive Cruise Control",
    tesla: "Traffic-Aware Cruise Control",
    generic: "Adaptive Cruise Control",
  },
  // Hands-OFF highway driving. Only makers who actually certify hands-off are
  // listed: Hyundai/Kia HDA2, Volvo Pilot Assist, Tesla Autopilot and Nissan
  // and Infiniti ProPILOT Assist all still require hands on the wheel, so
  // naming them here would have printed a hands-free claim onto cars that do
  // not have one. Mercedes DRIVE PILOT is eyes-off but sold in two states on
  // two model lines, and Toyota/Lexus Teammate is narrower still — both reach
  // the sticker through rule 1 when the decoder names them, not from here.
  // No generic term: if we cannot name it, the caller's own label is honest.
  hands_free_driving: {
    gm: "Super Cruise",
    ford: "BlueCruise",
    lincoln: "ActiveGlide",
    stellantis: "Hands-Free Active Driving Assist",
    bmw: "Highway Assistant",
    rivian: "Highway Assist",
    lucid: "DreamDrive Pro",
  },
  // ── Vision and awareness ────────────────────────────────────────────
  blind_spot: {
    gm: "Side Blind Zone Alert",
    ford: "BLIS (Blind Spot Information System)",
    stellantis: "Blind Spot Monitoring",
    nissan: "Blind Spot Warning",
    toyota: "Blind Spot Monitor",
    honda: "Blind Spot Information System",
    hyundai: "Blind-Spot Collision-Avoidance Assist",
    subaru: "Blind-Spot Detection",
    mazda: "Blind Spot Monitoring",
    mitsubishi: "Blind Spot Warning",
    vw: "Side Assist",
    audi: "Audi side assist",
    porsche: "Lane Change Assist",
    bmw: "Active Blind Spot Detection",
    mercedes: "Blind Spot Assist",
    volvo: "Blind Spot Information System",
    jlr: "Blind Spot Assist",
    tesla: "Blind Spot Monitoring",
    generic: "Blind Spot Monitor",
  },
  rear_cross_traffic: {
    gm: "Rear Cross Traffic Alert",
    ford: "Cross-Traffic Alert",
    stellantis: "Rear Cross Path Detection",
    nissan: "Rear Cross Traffic Alert",
    toyota: "Rear Cross-Traffic Alert",
    honda: "Cross Traffic Monitor",
    hyundai: "Rear Cross-Traffic Collision-Avoidance Assist",
    subaru: "Rear Cross-Traffic Alert",
    mazda: "Rear Cross Traffic Alert",
    vw: "Rear Traffic Alert",
    audi: "Audi cross traffic assist rear",
    bmw: "Cross-Traffic Alert Rear",
    mercedes: "Rear Cross-Traffic Alert",
    volvo: "Cross Traffic Alert",
    generic: "Rear Cross-Traffic Alert",
  },
  rear_camera: {
    gm: "Rear Vision Camera",
    ford: "Rear View Camera",
    stellantis: "ParkView Rear Back-Up Camera",
    nissan: "RearView Monitor",
    toyota: "Backup Camera",
    honda: "Multi-Angle Rearview Camera",
    hyundai: "Rearview Monitor",
    kia: "Rear View Monitor",
    subaru: "Rear Vision Camera",
    mazda: "Rear-View Camera",
    vw: "Rear View Camera System",
    mercedes: "Reversing Camera",
    volvo: "Park Assist Camera",
    jlr: "Rear Camera",
    generic: "Rear View Camera",
  },
  surround_view: {
    gm: "HD Surround Vision",
    ford: "360-Degree Camera",
    stellantis: "360-Degree Surround View Camera",
    nissan: "Intelligent Around View Monitor",
    infiniti: "Around View Monitor",
    toyota: "Panoramic View Monitor",
    honda: "Multi-View Camera System",
    acura: "Surround-View Camera System",
    hyundai: "Surround View Monitor",
    mazda: "360° View Monitor",
    mitsubishi: "Multi-View Camera System",
    vw: "Area View",
    audi: "Audi 360-degree cameras",
    porsche: "Surround View",
    bmw: "Surround View with 3D View",
    mercedes: "360° Camera",
    volvo: "360° Surround View Camera",
    jlr: "3D Surround Camera",
    generic: "Surround View Camera",
  },
  // ── Lane discipline ─────────────────────────────────────────────────
  lane_keep: {
    gm: "Lane Keep Assist with Lane Departure Warning",
    ford: "Lane-Keeping System",
    stellantis: "LaneSense Lane Departure Warning with Lane Keep Assist",
    nissan: "Intelligent Lane Intervention",
    toyota: "Lane Departure Alert with Steering Assist",
    honda: "Lane Keeping Assist System",
    hyundai: "Lane Keeping Assist",
    subaru: "EyeSight Lane Keep Assist",
    mazda: "Lane-Keep Assist System",
    mitsubishi: "Lane Departure Warning with Lane Keep Assist",
    vw: "Lane Assist",
    audi: "Audi active lane assist",
    porsche: "Lane Keeping Assist",
    bmw: "Active Lane Keeping Assistant",
    mercedes: "Active Lane Keeping Assist",
    volvo: "Lane Keeping Aid",
    jlr: "Lane Keep Assist",
    tesla: "Lane Departure Avoidance",
    generic: "Lane Keep Assist",
  },
  lane_centering: {
    ford: "Lane Centering Assist",
    nissan: "ProPILOT Assist",
    toyota: "Lane Tracing Assist",
    hyundai: "Lane Following Assist",
    mazda: "Cruising & Traffic Support",
    vw: "Travel Assist",
    audi: "Adaptive Cruise Assist",
    bmw: "Steering and Lane Control Assistant",
    mercedes: "Active Steering Assist",
    volvo: "Pilot Assist",
    generic: "Lane Centering Assist",
  },
  traffic_sign_recognition: {
    ford: "Speed Sign Recognition",
    toyota: "Road Sign Assist",
    honda: "Traffic Sign Recognition System",
    nissan: "Traffic Sign Recognition",
    hyundai: "Intelligent Speed Limit Assist",
    mazda: "Traffic Sign Recognition",
    mitsubishi: "Traffic Sign Recognition",
    vw: "Dynamic Road Sign Display",
    audi: "Audi traffic sign recognition",
    bmw: "Speed Limit Info",
    mercedes: "Traffic Sign Assist",
    volvo: "Road Sign Information",
    jlr: "Traffic Sign Recognition",
    generic: "Traffic Sign Recognition",
  },
  driver_attention: {
    ford: "Driver Alert System",
    stellantis: "Drowsy Driver Detection",
    nissan: "Intelligent Driver Alertness",
    hyundai: "Driver Attention Warning",
    subaru: "DriverFocus Distraction Mitigation System",
    mazda: "Driver Attention Alert",
    vw: "Driver Alert System",
    bmw: "Attentiveness Assistant",
    mercedes: "ATTENTION ASSIST",
    volvo: "Driver Alert Control",
    generic: "Driver Attention Monitor",
  },
  // ── Lighting ────────────────────────────────────────────────────────
  auto_high_beam: {
    gm: "IntelliBeam",
    ford: "Auto High-Beam Headlamps",
    stellantis: "Automatic High-Beam Headlamp Control",
    nissan: "High Beam Assist",
    toyota: "Automatic High Beams",
    lexus: "Automatic High Beam",
    honda: "Auto High-Beam Headlights",
    hyundai: "High Beam Assist",
    subaru: "Automatic High Beam Assist",
    mazda: "High Beam Control System",
    mitsubishi: "Automatic High Beam",
    vw: "Light Assist",
    audi: "Audi high-beam assistant",
    porsche: "High Beam Assist",
    bmw: "High-Beam Assistant",
    mercedes: "Adaptive Highbeam Assist",
    volvo: "Active High Beam",
    jlr: "Auto High Beam Assist",
    generic: "Automatic High Beams",
  },
  // ── Roof ────────────────────────────────────────────────────────────
  sunroof: {
    gm: "Power Sunroof",
    ford: "Power Moonroof",
    stellantis: "Power Sunroof",
    nissan: "Power Sliding Moonroof",
    toyota: "Power Moonroof",
    honda: "Power Moonroof",
    hyundai: "Power Sunroof",
    subaru: "Power Moonroof",
    mazda: "Power Sliding-Glass Moonroof",
    mitsubishi: "Power Sunroof",
    vw: "Power Tilt and Slide Sunroof",
    bmw: "Power Moonroof",
    mercedes: "Power Sunroof",
    volvo: "Power Moonroof",
    generic: "Power Sunroof",
  },
  panoramic_sunroof: {
    gm: "Panoramic Sunroof",
    ford: "Panoramic Vista Roof",
    stellantis: "Dual-Pane Panoramic Sunroof",
    jeep: "CommandView Dual-Pane Panoramic Sunroof",
    nissan: "Panoramic Moonroof",
    toyota: "Panoramic Moonroof",
    honda: "Panoramic Moonroof",
    acura: "Panoramic Moonroof",
    hyundai: "Panoramic Sunroof",
    subaru: "Panoramic Moonroof",
    mazda: "Panoramic Moonroof",
    vw: "Panoramic Sunroof",
    porsche: "Panoramic Roof System",
    bmw: "Panoramic Moonroof",
    mercedes: "Panorama Roof",
    volvo: "Panoramic Moonroof",
    jlr: "Sliding Panoramic Roof",
    tesla: "Glass Roof",
    lucid: "Glass Canopy",
    generic: "Panoramic Sunroof",
  },
  // ── Access and convenience ──────────────────────────────────────────
  remote_start: {
    gm: "Remote Start",
    ford: "Remote Start System",
    stellantis: "Remote Start System",
    nissan: "Remote Engine Start",
    toyota: "Remote Engine Start",
    honda: "Remote Engine Start",
    hyundai: "Remote Start",
    subaru: "Remote Engine Start",
    mazda: "Remote Engine Start",
    bmw: "Remote Engine Start",
    mercedes: "Remote Start",
    generic: "Remote Engine Start",
  },
  // The plain powered gate. Hands-free (kick sensor, gesture, proximity) is a
  // separate option on every one of these lines, so it gets its own concept —
  // promoting a bare "Power Liftgate" row to "Hands-Free" would assert hardware
  // the car may not have.
  power_liftgate: {
    gm: "Power Liftgate",
    ford: "Power Liftgate",
    stellantis: "Power Liftgate",
    nissan: "Power Liftgate",
    toyota: "Power Back Door",
    honda: "Power Tailgate",
    hyundai: "Power Liftgate",
    subaru: "Power Rear Gate",
    mazda: "Power Liftgate",
    vw: "Power Liftgate",
    audi: "Power Tailgate",
    bmw: "Automatic Tailgate Operation",
    mercedes: "Power Tailgate",
    volvo: "Power Tailgate",
    jlr: "Powered Tailgate",
    generic: "Power Liftgate",
  },
  hands_free_liftgate: {
    gm: "Hands-Free Power Liftgate",
    ford: "Hands-Free Foot-Activated Liftgate",
    stellantis: "Hands-Free Power Liftgate",
    nissan: "Motion Activated Liftgate",
    toyota: "Hands-Free Power Back Door",
    honda: "Hands-Free Access Power Tailgate",
    acura: "Hands-Free Power Tailgate",
    hyundai: "Smart Power Liftgate",
    subaru: "Hands-Free Power Rear Gate",
    vw: "Easy Open Power Liftgate",
    mercedes: "HANDS-FREE ACCESS",
    volvo: "Hands-Free Power Tailgate",
    jlr: "Gesture Tailgate",
    generic: "Hands-Free Power Liftgate",
  },
  parking_sensors: {
    gm: "Front and Rear Park Assist",
    ford: "Reverse Sensing System",
    stellantis: "ParkSense Front and Rear Park Assist",
    nissan: "Front and Rear Sonar System",
    toyota: "Intuitive Parking Assist",
    honda: "Parking Sensors",
    hyundai: "Parking Distance Warning",
    mazda: "Front and Rear Parking Sensors",
    vw: "Park Distance Control",
    audi: "Audi parking system",
    porsche: "ParkAssist",
    bmw: "Park Distance Control",
    mercedes: "PARKTRONIC",
    volvo: "Park Assist",
    jlr: "Park Distance Control",
    generic: "Parking Sensors",
  },
  self_parking: {
    gm: "Automatic Parking Assist",
    ford: "Active Park Assist",
    stellantis: "ParkSense Automated Parking System",
    toyota: "Advanced Park",
    hyundai: "Remote Smart Parking Assist",
    vw: "Park Assist Plus",
    audi: "Audi park assist plus",
    porsche: "Active Parking Support",
    bmw: "Parking Assistant Professional",
    mercedes: "Active Parking Assist",
    volvo: "Park Assist Pilot",
    jlr: "Park Assist",
    tesla: "Autopark",
    generic: "Automated Parking Assist",
  },
  safe_exit: {
    hyundai: "Safe Exit Assist",
    audi: "Audi exit warning",
    volvo: "Exit Warning",
    generic: "Safe Exit Warning",
  },
  rear_seat_reminder: {
    gm: "Rear Seat Reminder",
    ford: "Rear Occupant Alert",
    nissan: "Rear Door Alert",
    toyota: "Rear Seat Reminder",
    honda: "Rear Seat Reminder",
    hyundai: "Rear Occupant Alert",
    subaru: "Rear Seat Reminder",
    generic: "Rear Seat Reminder",
  },
  running_boards: {
    gm: "Power-Retractable Assist Steps",
    ford: "Power Running Boards",
    stellantis: "Power Running Boards",
    toyota: "Running Boards",
    jlr: "Deployable Side Steps",
    generic: "Power Running Boards",
  },
  trailer_assist: {
    gm: "Advanced Trailering System",
    ford: "Pro Trailer Backup Assist",
    ram: "Trailer Reverse Steering Control",
    toyota: "Straight Path Assist",
    vw: "Trailer Assist",
    jlr: "Advanced Tow Assist",
    generic: "Trailer Assist",
  },
  // ── Infotainment ────────────────────────────────────────────────────
  // Deliberately empty. Audio, smartphone and radio all failed rule 4: the
  // audio brand IS the feature and is optional on nearly every line, a row
  // reading "Bluetooth Connection" is not CarPlay, and "Digital Radio" is not
  // a SiriusXM subscription. Each of those names now prints only when a source
  // row says it — the concept rules earn them through an upgrade, or rule 1
  // passes the brand through verbatim.
};

/** Walk marque -> corporate family -> generic. */
export function oemTerm(concept: string, brand: OemBrand): string | undefined {
  const row = OEM_TERMS[concept];
  if (!row) return undefined;
  let cursor: OemBrand | undefined = brand;
  while (cursor) {
    const term = row[cursor];
    if (term) return term;
    cursor = BRAND_PARENT[cursor];
  }
  return row.generic;
}
