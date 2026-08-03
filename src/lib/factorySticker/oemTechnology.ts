// ──────────────────────────────────────────────────────────────────────
// OEM technology repository.
//
// Every manufacturer names its own systems, and those names are assets they
// spend heavily to build. This is the catalog of them: who owns what, how the
// name is actually rendered, what concept it implements, and whether it ships
// across the lineup or is optional equipment.
//
// It answers three questions the terminology table cannot:
//
//   1. RECOGNITION — is this decoded row a real manufacturer system, or a
//      decoder artifact? A recognized system prints verbatim rather than being
//      flattened into a generic phrase.
//   2. OWNERSHIP — does THIS make actually sell it? "quattro" on a Porsche or
//      "Mark Levinson" on a Ford is a data error, not a feature. The flat
//      brand-blind list we used before printed both without complaint.
//   3. RENDERING — the manufacturer's own capitalization. A feed saying
//      "propilot assist" is the same system as "ProPILOT Assist", and the
//      sticker should print the manufacturer's form.
//
// Rules for adding an entry:
//   - `fitment: "optional"` means the system is NOT standard across the line.
//     Optional systems are matched, never asserted: they reach the sticker only
//     when a source row names them. This is the same guard as rule 4 in
//     oemTerminology — it is what keeps us from printing Super Cruise onto a
//     base-trim truck.
//   - Only add a name the manufacturer actually uses. If a name is uncertain,
//     leave it out. A missing entry degrades to the generic term; a wrong entry
//     puts a false claim on a window sticker.
//   - Suppliers (Bose, Harman Kardon, Meridian) are owned by `generic` when
//     they are sold across many makes, and by a marque when the pairing is
//     exclusive (Revel is Lincoln's, ELS Studio is Acura's, Mark Levinson is
//     Lexus's). An exclusive supplier appearing on the wrong make is a real
//     signal that the feed is crossed.
// ──────────────────────────────────────────────────────────────────────

import { brandChain, technologyOwners, type OemBrand } from "./oemTerminology.ts";

export type TechCategory =
  | "adas_suite"
  | "driver_assist"
  | "audio"
  | "infotainment"
  | "connected"
  | "drivetrain"
  | "chassis"
  | "lighting"
  | "roof"
  | "convenience"
  | "off_road"
  | "towing";

/** Whether the system is standard across the line, or named optional equipment. */
export type Fitment = "lineup" | "optional";

interface TechEntry {
  /** The manufacturer's own rendering. This is what prints. */
  name: string;
  category: TechCategory;
  /** The printed concept this implements, when it maps to one. */
  concept?: string;
  fitment: Fitment;
  /** The umbrella suite it belongs to, where the maker sells one. */
  suite?: string;
  /** Extra source spellings beyond the name (abbreviations, legacy names). */
  aka?: string[];
  /**
   * Sibling marques that genuinely print this exact name on their own labels.
   *
   * Per-TECHNOLOGY, not per-brand, because the answer differs inside one
   * corporate family: INFINITI really does sell and print "ProPILOT Assist",
   * while "Nissan Safety Shield 360" never appears on an INFINITI label. A
   * brand-level rule gets one of those two wrong whichever way it is set.
   *
   * Only add a marque here against a real label. Corporate ownership is not
   * evidence.
   */
  sharedWith?: OemBrand[];
}

export interface OemTechnology extends TechEntry {
  /** The marque or family that owns it. `generic` is a cross-make supplier. */
  brand: OemBrand;
}

// ── Catalog ───────────────────────────────────────────────────────────
// Keyed by owner. A family key (gm, ford, stellantis…) is inherited by every
// marque beneath it; a marque key belongs to that marque alone.

const CATALOG: Partial<Record<OemBrand, TechEntry[]>> = {
  // ── General Motors ──────────────────────────────────────────────────
  gm: [
    { name: "Super Cruise", category: "driver_assist", concept: "hands_free_driving", fitment: "optional" },
    { name: "IntelliBeam", category: "lighting", concept: "auto_high_beam", fitment: "optional" },
    { name: "HD Surround Vision", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "Side Blind Zone Alert", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Rear Cross Traffic Alert", category: "driver_assist", concept: "rear_cross_traffic", fitment: "optional" },
    { name: "Lane Change Alert", category: "driver_assist", fitment: "optional" },
    { name: "Rear Seat Reminder", category: "convenience", concept: "rear_seat_reminder", fitment: "lineup" },
    { name: "Safety Alert Seat", category: "driver_assist", fitment: "optional" },
    { name: "Teen Driver", category: "convenience", fitment: "lineup" },
    { name: "OnStar", category: "connected", fitment: "lineup" },
    { name: "Magnetic Ride Control", category: "chassis", fitment: "optional", aka: ["MagneRide"] },
    { name: "Autotrac", category: "drivetrain", fitment: "optional" },
    { name: "Advanced Trailering System", category: "towing", concept: "trailer_assist", fitment: "optional" },
    { name: "Hitch Guidance with Hitch View", category: "towing", fitment: "optional" },
    { name: "Duramax", category: "drivetrain", fitment: "optional" },
    { name: "Dynamic Fuel Management", category: "drivetrain", fitment: "lineup" },
    { name: "Rear Vision Camera", category: "driver_assist", concept: "rear_camera", fitment: "lineup" },
    { name: "Power-Retractable Assist Steps", category: "convenience", concept: "running_boards", fitment: "optional" },
  ],
  gmc: [
    { name: "MultiPro Tailgate", category: "convenience", fitment: "optional" },
    { name: "Traction Select System", category: "off_road", fitment: "lineup" },
    { name: "AT4", category: "off_road", fitment: "optional" },
  ],
  cadillac: [
    { name: "AKG Studio Reference", category: "audio", fitment: "optional", aka: ["AKG Studio"] },
    { name: "Night Vision", category: "driver_assist", fitment: "optional" },
    { name: "Super Cruise", category: "driver_assist", concept: "hands_free_driving", fitment: "optional" },
  ],
  buick: [{ name: "QuietTuning", category: "convenience", fitment: "lineup" }],

  // ── Ford Motor Company ──────────────────────────────────────────────
  ford: [
    { name: "Ford Co-Pilot360", category: "adas_suite", fitment: "lineup" },
    { name: "BlueCruise", category: "driver_assist", concept: "hands_free_driving", fitment: "optional" },
    { name: "BLIS", category: "driver_assist", concept: "blind_spot", fitment: "optional", aka: ["Blind Spot Information System"] },
    { name: "Pre-Collision Assist", category: "driver_assist", concept: "aeb", fitment: "lineup", suite: "Ford Co-Pilot360" },
    { name: "Lane-Keeping System", category: "driver_assist", concept: "lane_keep", fitment: "lineup", suite: "Ford Co-Pilot360" },
    { name: "Evasive Steering Assist", category: "driver_assist", fitment: "optional" },
    { name: "Active Park Assist", category: "driver_assist", concept: "self_parking", fitment: "optional" },
    { name: "Reverse Sensing System", category: "driver_assist", concept: "parking_sensors", fitment: "optional" },
    { name: "Pro Trailer Backup Assist", category: "towing", concept: "trailer_assist", fitment: "optional" },
    { name: "Pro Power Onboard", category: "convenience", fitment: "optional" },
    { name: "SYNC 4", category: "infotainment", fitment: "optional", aka: ["SYNC 4A", "SYNC 3"] },
    { name: "FordPass Connect", category: "connected", fitment: "lineup", aka: ["FordPass"] },
    { name: "EcoBoost", category: "drivetrain", fitment: "optional" },
    { name: "PowerBoost", category: "drivetrain", fitment: "optional" },
    { name: "Power Stroke", category: "drivetrain", fitment: "optional" },
    { name: "Terrain Management System", category: "off_road", fitment: "optional" },
    { name: "Trail Control", category: "off_road", fitment: "optional" },
    { name: "Trail Turn Assist", category: "off_road", fitment: "optional" },
    { name: "G.O.A.T. Modes", category: "off_road", fitment: "optional" },
    { name: "Panoramic Vista Roof", category: "roof", concept: "panoramic_sunroof", fitment: "optional", aka: ["Vista Roof"] },
    { name: "Bang & Olufsen Sound System", category: "audio", fitment: "optional", aka: ["B&O Sound System", "B&O Play"] },
    { name: "Onboard Scales", category: "towing", fitment: "optional" },
    { name: "Smart Hitch", category: "towing", fitment: "optional" },
  ],
  lincoln: [
    { name: "Lincoln Co-Pilot360", category: "adas_suite", fitment: "lineup" },
    { name: "ActiveGlide", category: "driver_assist", concept: "hands_free_driving", fitment: "optional" },
    { name: "Revel Audio System", category: "audio", fitment: "optional", aka: ["Revel Ultima"] },
    { name: "Perfect Position Seats", category: "convenience", fitment: "optional" },
    { name: "Phone As A Key", category: "convenience", fitment: "lineup" },
  ],

  // ── Stellantis ──────────────────────────────────────────────────────
  stellantis: [
    { name: "Uconnect 5", category: "infotainment", fitment: "lineup", aka: ["Uconnect"] },
    { name: "ParkSense", category: "driver_assist", concept: "parking_sensors", fitment: "optional" },
    { name: "ParkView", category: "driver_assist", concept: "rear_camera", fitment: "lineup" },
    { name: "LaneSense", category: "driver_assist", concept: "lane_keep", fitment: "optional" },
    { name: "Full-Speed Forward Collision Warning Plus", category: "driver_assist", concept: "aeb", fitment: "lineup" },
    { name: "Blind Spot Monitoring", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Rear Cross Path Detection", category: "driver_assist", concept: "rear_cross_traffic", fitment: "optional" },
    { name: "Hands-Free Active Driving Assist", category: "driver_assist", concept: "hands_free_driving", fitment: "optional" },
    { name: "Drowsy Driver Detection", category: "driver_assist", concept: "driver_attention", fitment: "optional" },
    { name: "HEMI", category: "drivetrain", fitment: "optional" },
    { name: "Pentastar", category: "drivetrain", fitment: "optional" },
    { name: "EcoDiesel", category: "drivetrain", fitment: "optional" },
    { name: "Hurricane", category: "drivetrain", fitment: "optional" },
    { name: "Alpine Premium Audio System", category: "audio", fitment: "optional" },
  ],
  jeep: [
    { name: "Selec-Terrain", category: "off_road", fitment: "optional" },
    { name: "Selec-Speed Control", category: "off_road", fitment: "optional" },
    { name: "Quadra-Trac", category: "drivetrain", fitment: "optional" },
    { name: "Quadra-Drive", category: "drivetrain", fitment: "optional" },
    { name: "Quadra-Lift", category: "chassis", fitment: "optional" },
    { name: "Command-Trac", category: "drivetrain", fitment: "optional" },
    { name: "Rock-Trac", category: "drivetrain", fitment: "optional" },
    { name: "CommandView Dual-Pane Panoramic Sunroof", category: "roof", concept: "panoramic_sunroof", fitment: "optional", aka: ["CommandView"] },
    { name: "Sky One-Touch Power Top", category: "roof", fitment: "optional" },
    { name: "McIntosh", category: "audio", fitment: "optional" },
  ],
  ram: [
    { name: "RamBox Cargo Management System", category: "convenience", fitment: "optional", aka: ["RamBox"] },
    { name: "Multifunction Tailgate", category: "convenience", fitment: "optional" },
    { name: "Active-Level Four Corner Air Suspension", category: "chassis", fitment: "optional" },
    { name: "Trailer Reverse Steering Control", category: "towing", concept: "trailer_assist", fitment: "optional" },
    { name: "Harman Kardon", category: "audio", fitment: "optional" },
  ],

  // ── Nissan Motor ────────────────────────────────────────────────────
  nissan: [
    { name: "Nissan Safety Shield 360", category: "adas_suite", fitment: "lineup", aka: ["Safety Shield"] },
    { name: "ProPILOT Assist", category: "driver_assist", fitment: "optional", sharedWith: ["infiniti"] },
    { name: "Intelligent Emergency Braking", category: "driver_assist", concept: "aeb", fitment: "lineup", suite: "Nissan Safety Shield 360" },
    { name: "Intelligent Cruise Control", category: "driver_assist", concept: "adaptive_cruise", fitment: "optional" },
    { name: "Intelligent Around View Monitor", category: "driver_assist", concept: "surround_view", fitment: "optional", aka: ["Around View Monitor"] },
    { name: "Blind Spot Warning", category: "driver_assist", concept: "blind_spot", fitment: "lineup", suite: "Nissan Safety Shield 360" },
    { name: "Rear Cross Traffic Alert", category: "driver_assist", concept: "rear_cross_traffic", fitment: "lineup" },
    { name: "Intelligent Lane Intervention", category: "driver_assist", concept: "lane_keep", fitment: "lineup" },
    { name: "Rear Door Alert", category: "convenience", concept: "rear_seat_reminder", fitment: "lineup" },
    { name: "Intelligent Driver Alertness", category: "driver_assist", concept: "driver_attention", fitment: "lineup" },
    { name: "Motion Activated Liftgate", category: "convenience", concept: "hands_free_liftgate", fitment: "optional" },
    { name: "e-4ORCE", category: "drivetrain", fitment: "optional" },
    { name: "e-POWER", category: "drivetrain", fitment: "optional" },
    { name: "Xtronic CVT", category: "drivetrain", fitment: "optional" },
    { name: "Zero Gravity Seats", category: "convenience", fitment: "optional" },
    { name: "NissanConnect", category: "connected", fitment: "lineup" },
    { name: "Intelligent Key", category: "convenience", fitment: "lineup" },
    { name: "Divide-N-Hide Cargo System", category: "convenience", fitment: "optional" },
  ],
  infiniti: [
    { name: "INFINITI ProACTIVE", category: "adas_suite", fitment: "optional" },
    { name: "Predictive Forward Collision Warning", category: "driver_assist", fitment: "optional" },
    { name: "Backup Collision Intervention", category: "driver_assist", fitment: "optional" },
    { name: "Direct Adaptive Steering", category: "chassis", fitment: "optional" },
    { name: "VC-Turbo", category: "drivetrain", fitment: "optional" },
    { name: "Bose Performance Series", category: "audio", fitment: "optional" },
    { name: "INFINITI InTouch", category: "infotainment", fitment: "lineup" },
  ],

  // ── Toyota Motor ────────────────────────────────────────────────────
  toyota: [
    { name: "Toyota Safety Sense", category: "adas_suite", fitment: "lineup", aka: ["TSS 3\\.0", "TSS 2\\.5"] },
    { name: "Pre-Collision System", category: "driver_assist", concept: "aeb", fitment: "lineup", suite: "Toyota Safety Sense" },
    { name: "Dynamic Radar Cruise Control", category: "driver_assist", concept: "adaptive_cruise", fitment: "lineup", suite: "Toyota Safety Sense" },
    { name: "Lane Departure Alert with Steering Assist", category: "driver_assist", concept: "lane_keep", fitment: "lineup", suite: "Toyota Safety Sense" },
    { name: "Lane Tracing Assist", category: "driver_assist", concept: "lane_centering", fitment: "lineup", suite: "Toyota Safety Sense" },
    { name: "Road Sign Assist", category: "driver_assist", concept: "traffic_sign_recognition", fitment: "lineup", suite: "Toyota Safety Sense" },
    { name: "Proactive Driving Assist", category: "driver_assist", fitment: "lineup", suite: "Toyota Safety Sense" },
    { name: "Blind Spot Monitor", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Panoramic View Monitor", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "Intuitive Parking Assist", category: "driver_assist", concept: "parking_sensors", fitment: "optional" },
    { name: "Advanced Park", category: "driver_assist", concept: "self_parking", fitment: "optional" },
    { name: "Multi-Terrain Select", category: "off_road", fitment: "optional" },
    { name: "Multi-Terrain Monitor", category: "off_road", fitment: "optional" },
    { name: "Crawl Control", category: "off_road", fitment: "optional" },
    { name: "Downhill Assist Control", category: "off_road", fitment: "optional" },
    { name: "Kinetic Dynamic Suspension System", category: "chassis", fitment: "optional" },
    { name: "Straight Path Assist", category: "towing", concept: "trailer_assist", fitment: "optional" },
    { name: "Power Back Door", category: "convenience", concept: "power_liftgate", fitment: "optional" },
    { name: "Toyota Audio Multimedia", category: "infotainment", fitment: "lineup" },
    { name: "Safety Connect", category: "connected", fitment: "lineup" },
    { name: "Remote Connect", category: "connected", fitment: "optional" },
    { name: "Drive Connect", category: "connected", fitment: "optional" },
    { name: "i-FORCE MAX", category: "drivetrain", fitment: "optional" },
    { name: "Dynamic Torque Vectoring AWD", category: "drivetrain", fitment: "optional" },
    { name: "JBL Premium Audio", category: "audio", fitment: "optional" },
  ],
  lexus: [
    { name: "Lexus Safety System+", category: "adas_suite", fitment: "lineup" },
    { name: "Lexus Teammate Advanced Drive", category: "driver_assist", concept: "hands_free_driving", fitment: "optional", aka: ["Lexus Teammate"] },
    { name: "Mark Levinson", category: "audio", fitment: "optional" },
    { name: "Lexus Interface", category: "infotainment", fitment: "lineup" },
    { name: "Adaptive Variable Suspension", category: "chassis", fitment: "optional" },
    { name: "Safe Exit Assist", category: "driver_assist", concept: "safe_exit", fitment: "optional" },
    { name: "Digital Latch", category: "convenience", fitment: "optional" },
  ],

  // ── Honda Motor ─────────────────────────────────────────────────────
  honda: [
    { name: "Honda Sensing", category: "adas_suite", fitment: "lineup", aka: ["Honda Sensing 360"] },
    { name: "Collision Mitigation Braking System", category: "driver_assist", concept: "aeb", fitment: "lineup", suite: "Honda Sensing" },
    { name: "Road Departure Mitigation", category: "driver_assist", fitment: "lineup", suite: "Honda Sensing" },
    { name: "Lane Keeping Assist System", category: "driver_assist", concept: "lane_keep", fitment: "lineup", suite: "Honda Sensing" },
    { name: "Blind Spot Information System", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Traffic Sign Recognition System", category: "driver_assist", concept: "traffic_sign_recognition", fitment: "lineup" },
    { name: "Multi-Angle Rearview Camera", category: "driver_assist", concept: "rear_camera", fitment: "lineup" },
    { name: "Multi-View Camera System", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "Hands-Free Access Power Tailgate", category: "convenience", concept: "hands_free_liftgate", fitment: "optional" },
    { name: "Magic Seat", category: "convenience", fitment: "optional" },
    { name: "HondaLink", category: "connected", fitment: "lineup" },
    { name: "Real Time AWD", category: "drivetrain", fitment: "optional" },
    { name: "i-VTEC", category: "drivetrain", fitment: "lineup", aka: ["VTEC"] },
  ],
  acura: [
    { name: "AcuraWatch", category: "adas_suite", fitment: "lineup" },
    { name: "Super Handling All-Wheel Drive", category: "drivetrain", fitment: "optional", aka: ["SH-AWD"] },
    { name: "ELS Studio 3D Premium Audio", category: "audio", fitment: "optional", aka: ["ELS Studio"] },
    { name: "Integrated Dynamics System", category: "chassis", fitment: "lineup" },
    { name: "Precision All-Wheel Steer", category: "chassis", fitment: "optional" },
    { name: "Surround-View Camera System", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "AcuraLink", category: "connected", fitment: "lineup" },
  ],

  // ── Hyundai Motor Group ─────────────────────────────────────────────
  hyundai: [
    { name: "Forward Collision-Avoidance Assist", category: "driver_assist", concept: "aeb", fitment: "lineup" },
    { name: "Blind-Spot Collision-Avoidance Assist", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Blind-Spot View Monitor", category: "driver_assist", fitment: "optional" },
    { name: "Rear Cross-Traffic Collision-Avoidance Assist", category: "driver_assist", concept: "rear_cross_traffic", fitment: "optional" },
    { name: "Lane Following Assist", category: "driver_assist", concept: "lane_centering", fitment: "lineup" },
    { name: "Lane Keeping Assist", category: "driver_assist", concept: "lane_keep", fitment: "lineup" },
    { name: "Highway Driving Assist", category: "driver_assist", fitment: "optional", aka: ["HDA2"] },
    { name: "Smart Cruise Control", category: "driver_assist", concept: "adaptive_cruise", fitment: "optional" },
    { name: "Safe Exit Assist", category: "driver_assist", concept: "safe_exit", fitment: "optional" },
    { name: "Rear Occupant Alert", category: "convenience", concept: "rear_seat_reminder", fitment: "lineup" },
    { name: "Driver Attention Warning", category: "driver_assist", concept: "driver_attention", fitment: "lineup" },
    { name: "Surround View Monitor", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "Remote Smart Parking Assist", category: "driver_assist", concept: "self_parking", fitment: "optional" },
    { name: "Parking Distance Warning", category: "driver_assist", concept: "parking_sensors", fitment: "optional" },
    { name: "Smart Power Liftgate", category: "convenience", concept: "hands_free_liftgate", fitment: "optional" },
    { name: "HTRAC", category: "drivetrain", fitment: "optional" },
    { name: "Digital Key", category: "convenience", fitment: "optional" },
  ],
  kia: [
    { name: "Kia Drive Wise", category: "adas_suite", fitment: "lineup" },
    { name: "Kia Connect", category: "connected", fitment: "lineup", aka: ["UVO"] },
    { name: "Dynamax AWD", category: "drivetrain", fitment: "optional" },
    { name: "Meridian Premium Audio", category: "audio", fitment: "optional" },
  ],
  genesis: [
    { name: "Genesis Smart Sense", category: "adas_suite", fitment: "lineup" },
    { name: "Lexicon Premium Audio", category: "audio", fitment: "optional", aka: ["Lexicon"] },
    { name: "Genesis Connected Services", category: "connected", fitment: "lineup" },
    { name: "Road Preview Electronic Control Suspension", category: "chassis", fitment: "optional", aka: ["Road Preview"] },
  ],
  // Hyundai and Kia both market Blue Link/Bluelink under the Hyundai marque.
  ...({} as Record<string, never>),

  // ── Independent Japanese ────────────────────────────────────────────
  subaru: [
    { name: "EyeSight Driver Assist Technology", category: "adas_suite", fitment: "lineup", aka: ["EyeSight"] },
    { name: "Pre-Collision Braking", category: "driver_assist", concept: "aeb", fitment: "lineup", suite: "EyeSight Driver Assist Technology" },
    { name: "Advanced Adaptive Cruise Control", category: "driver_assist", concept: "adaptive_cruise", fitment: "lineup", suite: "EyeSight Driver Assist Technology" },
    { name: "Lane Centering Assist", category: "driver_assist", concept: "lane_centering", fitment: "lineup" },
    { name: "DriverFocus Distraction Mitigation System", category: "driver_assist", concept: "driver_attention", fitment: "optional", aka: ["DriverFocus"] },
    { name: "Blind-Spot Detection", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Reverse Automatic Braking", category: "driver_assist", fitment: "optional" },
    { name: "Steering Responsive Headlights", category: "lighting", fitment: "optional" },
    { name: "X-MODE", category: "off_road", fitment: "optional" },
    { name: "Symmetrical All-Wheel Drive", category: "drivetrain", fitment: "lineup" },
    { name: "SUBARU BOXER", category: "drivetrain", fitment: "lineup" },
    { name: "STARLINK", category: "infotainment", fitment: "lineup" },
    { name: "Power Rear Gate", category: "convenience", concept: "power_liftgate", fitment: "optional" },
  ],
  mazda: [
    { name: "i-Activsense", category: "adas_suite", fitment: "lineup" },
    { name: "Smart Brake Support", category: "driver_assist", concept: "aeb", fitment: "lineup", suite: "i-Activsense" },
    { name: "Mazda Radar Cruise Control", category: "driver_assist", concept: "adaptive_cruise", fitment: "lineup" },
    { name: "Blind Spot Monitoring", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Lane-Keep Assist System", category: "driver_assist", concept: "lane_keep", fitment: "lineup" },
    { name: "Cruising & Traffic Support", category: "driver_assist", concept: "lane_centering", fitment: "optional" },
    { name: "Driver Attention Alert", category: "driver_assist", concept: "driver_attention", fitment: "lineup" },
    { name: "360° View Monitor", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "High Beam Control System", category: "lighting", concept: "auto_high_beam", fitment: "lineup" },
    { name: "SKYACTIV", category: "drivetrain", fitment: "lineup" },
    { name: "i-ACTIV AWD", category: "drivetrain", fitment: "optional" },
    { name: "G-Vectoring Control Plus", category: "chassis", fitment: "lineup" },
    { name: "Kinematic Posture Control", category: "chassis", fitment: "optional" },
    { name: "Off-Road Traction Assist", category: "off_road", fitment: "optional" },
    { name: "Bose Premium Audio", category: "audio", fitment: "optional" },
  ],
  mitsubishi: [
    { name: "MI-PILOT Assist", category: "driver_assist", fitment: "optional" },
    { name: "Forward Collision Mitigation", category: "driver_assist", concept: "aeb", fitment: "lineup" },
    { name: "Blind Spot Warning", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Super All-Wheel Control", category: "drivetrain", fitment: "optional", aka: ["S-AWC"] },
    { name: "Active Yaw Control", category: "chassis", fitment: "optional" },
    { name: "Multi-View Camera System", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "Mitsubishi Connect", category: "connected", fitment: "lineup" },
    { name: "Yamaha Premium Audio", category: "audio", fitment: "optional" },
  ],

  // ── Volkswagen Group ────────────────────────────────────────────────
  vw: [
    { name: "IQ.DRIVE", category: "adas_suite", fitment: "lineup" },
    { name: "Travel Assist", category: "driver_assist", concept: "lane_centering", fitment: "optional", suite: "IQ.DRIVE" },
    { name: "Front Assist", category: "driver_assist", concept: "aeb", fitment: "lineup", suite: "IQ.DRIVE" },
    { name: "Side Assist", category: "driver_assist", concept: "blind_spot", fitment: "optional", suite: "IQ.DRIVE" },
    { name: "Rear Traffic Alert", category: "driver_assist", concept: "rear_cross_traffic", fitment: "optional" },
    { name: "Lane Assist", category: "driver_assist", concept: "lane_keep", fitment: "lineup", suite: "IQ.DRIVE" },
    { name: "Light Assist", category: "lighting", concept: "auto_high_beam", fitment: "optional", aka: ["Dynamic Light Assist"] },
    { name: "Park Distance Control", category: "driver_assist", concept: "parking_sensors", fitment: "optional" },
    { name: "Park Assist Plus", category: "driver_assist", concept: "self_parking", fitment: "optional" },
    { name: "Area View", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "Dynamic Road Sign Display", category: "driver_assist", concept: "traffic_sign_recognition", fitment: "optional" },
    { name: "IQ.LIGHT LED Matrix Headlights", category: "lighting", fitment: "optional", aka: ["IQ\\.LIGHT"] },
    { name: "4MOTION", category: "drivetrain", fitment: "optional" },
    { name: "Digital Cockpit Pro", category: "infotainment", fitment: "optional" },
    { name: "Car-Net", category: "connected", fitment: "lineup" },
    { name: "Easy Open", category: "convenience", concept: "hands_free_liftgate", fitment: "optional" },
    { name: "Fender Premium Audio", category: "audio", fitment: "optional" },
  ],
  audi: [
    { name: "Audi pre sense", category: "adas_suite", fitment: "lineup" },
    { name: "Audi side assist", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Audi active lane assist", category: "driver_assist", concept: "lane_keep", fitment: "optional" },
    { name: "adaptive cruise assist", category: "driver_assist", concept: "lane_centering", fitment: "optional" },
    { name: "Audi cross traffic assist rear", category: "driver_assist", concept: "rear_cross_traffic", fitment: "optional" },
    { name: "Audi exit warning", category: "driver_assist", concept: "safe_exit", fitment: "optional" },
    { name: "Audi virtual cockpit", category: "infotainment", fitment: "optional" },
    { name: "quattro", category: "drivetrain", fitment: "optional" },
    { name: "MMI", category: "infotainment", fitment: "lineup" },
    { name: "Audi Matrix-design LED headlights", category: "lighting", fitment: "optional", aka: ["Matrix-design LED"] },
    { name: "Audi laser light", category: "lighting", fitment: "optional" },
    { name: "Audi parking system plus", category: "driver_assist", concept: "parking_sensors", fitment: "optional" },
    { name: "Audi drive select", category: "chassis", fitment: "lineup" },
    { name: "Audi adaptive air suspension", category: "chassis", fitment: "optional" },
    { name: "Audi connect", category: "connected", fitment: "lineup" },
    { name: "Bang & Olufsen 3D Premium Sound System", category: "audio", fitment: "optional" },
    { name: "top view camera system", category: "driver_assist", concept: "surround_view", fitment: "optional" },
  ],
  porsche: [
    { name: "Porsche InnoDrive", category: "driver_assist", fitment: "optional" },
    { name: "Porsche Active Suspension Management", category: "chassis", fitment: "optional", aka: ["PASM"] },
    { name: "Porsche Doppelkupplung", category: "drivetrain", fitment: "optional", aka: ["PDK"] },
    { name: "Porsche Traction Management", category: "drivetrain", fitment: "optional", aka: ["PTM"] },
    { name: "Porsche Dynamic Chassis Control", category: "chassis", fitment: "optional", aka: ["PDCC"] },
    { name: "Porsche Ceramic Composite Brake", category: "chassis", fitment: "optional", aka: ["PCCB"] },
    { name: "Porsche Surface Coated Brake", category: "chassis", fitment: "optional", aka: ["PSCB"] },
    { name: "Porsche Communication Management", category: "infotainment", fitment: "lineup", aka: ["PCM"] },
    { name: "Porsche Torque Vectoring", category: "chassis", fitment: "optional", aka: ["PTV"] },
    { name: "Porsche Dynamic Light System", category: "lighting", fitment: "optional", aka: ["PDLS"] },
    { name: "Sport Chrono Package", category: "chassis", fitment: "optional" },
    { name: "Lane Change Assist", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Warn and Brake Assist", category: "driver_assist", concept: "aeb", fitment: "lineup" },
    { name: "Burmester High-End Surround Sound System", category: "audio", fitment: "optional" },
  ],

  // ── BMW Group ───────────────────────────────────────────────────────
  bmw: [
    { name: "Active Driving Assistant", category: "adas_suite", fitment: "lineup", aka: ["Driving Assistant Professional", "Driving Assistant"] },
    { name: "Highway Assistant", category: "driver_assist", concept: "hands_free_driving", fitment: "optional" },
    { name: "Active Blind Spot Detection", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Active Cruise Control", category: "driver_assist", concept: "adaptive_cruise", fitment: "optional" },
    { name: "Steering and Lane Control Assistant", category: "driver_assist", concept: "lane_centering", fitment: "optional" },
    { name: "Parking Assistant Professional", category: "driver_assist", concept: "self_parking", fitment: "optional", aka: ["Parking Assistant"] },
    { name: "Surround View with 3D View", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "Attentiveness Assistant", category: "driver_assist", concept: "driver_attention", fitment: "lineup" },
    { name: "Speed Limit Info", category: "driver_assist", concept: "traffic_sign_recognition", fitment: "optional" },
    { name: "BMW Head-Up Display", category: "driver_assist", fitment: "optional" },
    { name: "BMW Live Cockpit Professional", category: "infotainment", fitment: "optional" },
    { name: "iDrive", category: "infotainment", fitment: "lineup" },
    { name: "xDrive", category: "drivetrain", fitment: "optional" },
    { name: "BMW TwinPower Turbo", category: "drivetrain", fitment: "lineup" },
    { name: "Adaptive M Suspension", category: "chassis", fitment: "optional" },
    { name: "BMW Laserlight", category: "lighting", fitment: "optional" },
    { name: "Adaptive LED Headlights", category: "lighting", fitment: "optional" },
    { name: "BMW Digital Key Plus", category: "convenience", fitment: "optional" },
    { name: "Comfort Access", category: "convenience", fitment: "optional" },
    { name: "Integral Active Steering", category: "chassis", fitment: "optional" },
    { name: "Automatic Tailgate Operation", category: "convenience", concept: "power_liftgate", fitment: "optional" },
    { name: "Harman Kardon Surround Sound System", category: "audio", fitment: "optional" },
    { name: "Bowers & Wilkins Diamond Surround Sound System", category: "audio", fitment: "optional" },
  ],
  mini: [
    { name: "MINI Connected", category: "connected", fitment: "lineup" },
    { name: "ALL4", category: "drivetrain", fitment: "optional" },
    { name: "MINI Experience Modes", category: "chassis", fitment: "lineup", aka: ["MINI Driving Modes"] },
  ],

  // ── Mercedes-Benz ───────────────────────────────────────────────────
  mercedes: [
    { name: "MBUX", category: "infotainment", fitment: "lineup" },
    { name: "Active Distance Assist DISTRONIC", category: "driver_assist", concept: "adaptive_cruise", fitment: "optional", aka: ["DISTRONIC"] },
    { name: "Active Brake Assist", category: "driver_assist", concept: "aeb", fitment: "lineup" },
    { name: "Blind Spot Assist", category: "driver_assist", concept: "blind_spot", fitment: "optional", aka: ["Active Blind Spot Assist"] },
    { name: "Active Lane Keeping Assist", category: "driver_assist", concept: "lane_keep", fitment: "optional" },
    { name: "Active Steering Assist", category: "driver_assist", concept: "lane_centering", fitment: "optional" },
    { name: "PRE-SAFE", category: "driver_assist", fitment: "lineup" },
    { name: "ATTENTION ASSIST", category: "driver_assist", concept: "driver_attention", fitment: "lineup" },
    { name: "PARKTRONIC", category: "driver_assist", concept: "parking_sensors", fitment: "optional" },
    { name: "Active Parking Assist", category: "driver_assist", concept: "self_parking", fitment: "optional" },
    { name: "Traffic Sign Assist", category: "driver_assist", concept: "traffic_sign_recognition", fitment: "optional" },
    { name: "Adaptive Highbeam Assist", category: "lighting", concept: "auto_high_beam", fitment: "optional" },
    { name: "MULTIBEAM LED", category: "lighting", fitment: "optional" },
    { name: "DIGITAL LIGHT", category: "lighting", fitment: "optional" },
    { name: "AIRMATIC", category: "chassis", fitment: "optional" },
    { name: "E-ACTIVE BODY CONTROL", category: "chassis", fitment: "optional" },
    { name: "4MATIC", category: "drivetrain", fitment: "optional" },
    { name: "ENERGIZING Comfort", category: "convenience", fitment: "optional" },
    { name: "HANDS-FREE ACCESS", category: "convenience", concept: "hands_free_liftgate", fitment: "optional" },
    { name: "KEYLESS-GO", category: "convenience", fitment: "optional" },
    { name: "DRIVE PILOT", category: "driver_assist", fitment: "optional" },
    { name: "Mercedes me connect", category: "connected", fitment: "lineup" },
    { name: "Burmester Surround Sound System", category: "audio", fitment: "optional", aka: ["Burmester"] },
  ],

  // ── Volvo Cars ──────────────────────────────────────────────────────
  volvo: [
    { name: "City Safety", category: "driver_assist", concept: "aeb", fitment: "lineup" },
    { name: "Pilot Assist", category: "driver_assist", concept: "lane_centering", fitment: "optional" },
    { name: "BLIS", category: "driver_assist", concept: "blind_spot", fitment: "optional", aka: ["Blind Spot Information System"] },
    { name: "Cross Traffic Alert", category: "driver_assist", concept: "rear_cross_traffic", fitment: "optional" },
    { name: "Lane Keeping Aid", category: "driver_assist", concept: "lane_keep", fitment: "lineup" },
    { name: "Driver Alert Control", category: "driver_assist", concept: "driver_attention", fitment: "lineup" },
    { name: "Road Sign Information", category: "driver_assist", concept: "traffic_sign_recognition", fitment: "lineup" },
    { name: "Park Assist Pilot", category: "driver_assist", concept: "self_parking", fitment: "optional" },
    { name: "360° Surround View Camera", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "Active High Beam", category: "lighting", concept: "auto_high_beam", fitment: "lineup" },
    { name: "Run-off Road Mitigation", category: "driver_assist", fitment: "lineup" },
    { name: "Oncoming Lane Mitigation", category: "driver_assist", fitment: "lineup" },
    { name: "Four-C Active Chassis", category: "chassis", fitment: "optional" },
    { name: "CleanZone", category: "convenience", fitment: "lineup" },
    { name: "Bowers & Wilkins Premium Sound", category: "audio", fitment: "optional" },
  ],
  polestar: [{ name: "Polestar Engineered", category: "chassis", fitment: "optional" }],

  // ── JLR ─────────────────────────────────────────────────────────────
  jlr: [
    { name: "Terrain Response", category: "off_road", fitment: "optional", aka: ["Terrain Response 2"] },
    { name: "All Terrain Progress Control", category: "off_road", fitment: "optional" },
    { name: "Wade Sensing", category: "off_road", fitment: "optional" },
    { name: "ClearSight Ground View", category: "driver_assist", fitment: "optional" },
    { name: "ClearSight Rear View Mirror", category: "driver_assist", fitment: "optional" },
    { name: "Pivi Pro", category: "infotainment", fitment: "lineup" },
    { name: "Advanced Tow Assist", category: "towing", concept: "trailer_assist", fitment: "optional" },
    { name: "Adaptive Dynamics", category: "chassis", fitment: "optional" },
    { name: "Electronic Air Suspension", category: "chassis", fitment: "optional" },
    { name: "3D Surround Camera", category: "driver_assist", concept: "surround_view", fitment: "optional" },
    { name: "Gesture Tailgate", category: "convenience", concept: "hands_free_liftgate", fitment: "optional" },
    { name: "Blind Spot Assist", category: "driver_assist", concept: "blind_spot", fitment: "optional" },
    { name: "Cabin Air Purification", category: "convenience", fitment: "optional" },
    { name: "Meridian Sound System", category: "audio", fitment: "optional" },
  ],
  jaguar: [{ name: "Configurable Dynamics", category: "chassis", fitment: "optional" }],

  // ── US EV ───────────────────────────────────────────────────────────
  tesla: [
    { name: "Autopilot", category: "driver_assist", fitment: "lineup" },
    { name: "Traffic-Aware Cruise Control", category: "driver_assist", concept: "adaptive_cruise", fitment: "lineup" },
    { name: "Autosteer", category: "driver_assist", concept: "lane_centering", fitment: "lineup" },
    { name: "Full Self-Driving", category: "driver_assist", fitment: "optional" },
    { name: "Autopark", category: "driver_assist", concept: "self_parking", fitment: "optional" },
    { name: "Sentry Mode", category: "convenience", fitment: "lineup" },
    { name: "Dog Mode", category: "convenience", fitment: "lineup" },
    { name: "Smart Summon", category: "driver_assist", fitment: "optional" },
    { name: "Tesla Vision", category: "driver_assist", fitment: "lineup" },
  ],
  rivian: [
    { name: "Rivian Autonomy Platform", category: "adas_suite", fitment: "lineup" },
    { name: "Highway Assist", category: "driver_assist", concept: "hands_free_driving", fitment: "optional" },
    { name: "Gear Tunnel", category: "convenience", fitment: "lineup" },
    { name: "Camp Mode", category: "off_road", fitment: "lineup" },
    { name: "Meridian Audio System", category: "audio", fitment: "optional" },
  ],
  lucid: [
    { name: "DreamDrive", category: "adas_suite", fitment: "lineup", aka: ["DreamDrive Pro"] },
    { name: "Glass Canopy", category: "roof", concept: "panoramic_sunroof", fitment: "optional" },
    { name: "Surreal Sound", category: "audio", fitment: "optional", aka: ["Surreal Sound Pro"] },
    { name: "Wunderbox", category: "drivetrain", fitment: "lineup" },
  ],

  // ── Cross-make suppliers ────────────────────────────────────────────
  // Sold to many manufacturers, so ownership is never a mismatch signal.
  generic: [
    { name: "Bose", category: "audio", fitment: "optional" },
    { name: "Harman Kardon", category: "audio", fitment: "optional" },
    { name: "JBL", category: "audio", fitment: "optional" },
    { name: "Meridian", category: "audio", fitment: "optional" },
    { name: "Bang & Olufsen", category: "audio", fitment: "optional", aka: ["B&O"] },
    { name: "Alpine", category: "audio", fitment: "optional" },
    { name: "Sony", category: "audio", fitment: "optional" },
    { name: "Klipsch", category: "audio", fitment: "optional" },
    { name: "Dynaudio", category: "audio", fitment: "optional" },
    { name: "Focal", category: "audio", fitment: "optional" },
    { name: "Sennheiser", category: "audio", fitment: "optional" },
    { name: "Rockford Fosgate", category: "audio", fitment: "optional" },
    // Apple CarPlay, Android Auto and SiriusXM are deliberately absent. They are
    // consumer platforms carried by the head unit, not technologies a
    // manufacturer built and named, and the concept rules already gate them on
    // the source actually saying so.
  ],
};

// ── Matching ──────────────────────────────────────────────────────────

/**
 * Build a tolerant pattern from a name: token boundaries are preserved, but the
 * separators between them are not, so "Pre-Collision System" also matches
 * "Pre Collision System" and "PRE COLLISION SYSTEM".
 */
const patternFor = (literal: string): RegExp => {
  const tokens = literal.split(/[^A-Za-z0-9&.]+/).filter(Boolean);
  if (!tokens.length) return /(?!)/;
  const body = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\-_/]*");
  return new RegExp(`(^|[^A-Za-z0-9])${body}($|[^A-Za-z0-9])`, "i");
};

interface CompiledTechnology extends OemTechnology {
  patterns: RegExp[];
  /** Longer names win when several match, so the specific beats the general. */
  weight: number;
}

const COMPILED: CompiledTechnology[] = Object.entries(CATALOG)
  .flatMap(([brand, entries]) =>
    (entries ?? []).map((entry) => ({
      ...entry,
      brand: brand as OemBrand,
      patterns: [patternFor(entry.name), ...(entry.aka ?? []).map((a) => patternFor(a))],
      weight: entry.name.length,
    })),
  )
  .sort((a, b) => b.weight - a.weight);

/** Every technology this marque can carry, including its family's and suppliers'. */
export function technologiesFor(brand: OemBrand): OemTechnology[] {
  const owners = new Set<OemBrand>([...brandChain(brand), "generic"]);
  return COMPILED.filter((t) => owners.has(t.brand));
}

const matches = (tech: CompiledTechnology, row: string) => tech.patterns.some((p) => p.test(row));

/**
 * The technology this row names, if the MARQUE actually sells it under that
 * name.
 *
 * Deliberately not the corporate chain. Lexus rolling up to Toyota is a fact
 * about ownership of the company, not permission to print "Toyota Safety
 * Sense" on a Lexus label — Lexus does not use that name.
 */
export function findTechnology(row: string, brand: OemBrand): OemTechnology | undefined {
  const owners = new Set<OemBrand>(technologyOwners(brand));
  return COMPILED.find((t) => (owners.has(t.brand) || t.sharedWith?.includes(brand)) && matches(t, row));
}

/**
 * A technology this row names that belongs to a DIFFERENT manufacturer.
 *
 * This is a feed-quality signal, not a rendering decision: a Ford listing whose
 * equipment mentions "Mark Levinson", or a Porsche claiming "quattro", is
 * almost always a crossed VIN or a scraped description from another vehicle.
 * We surface it; we never silently print it as though it were true.
 */
/**
 * Plain automotive vocabulary. A catalog name built ONLY from these words is a
 * description every maker uses, not a coined brand.
 *
 * This distinction is load-bearing. Several makers file the generic phrase in
 * their own catalog — "Blind Spot Monitor" sits under Toyota, "Blind Spot
 * Monitoring" under Stellantis — so treating any non-owned catalog hit as
 * foreign quarantined a GMC's perfectly real blind-spot monitor. Withholding
 * genuine equipment is its own kind of wrong sticker.
 *
 * "ProPILOT", "IntelliBeam", "AKG", "Mark Levinson", "Safety Sense" survive
 * this filter because they carry a coined token no one else prints.
 */
const COMMON_EQUIPMENT_WORDS = new Set([
  "a", "and", "with", "the", "of", "for", "system", "systems", "package",
  "front", "rear", "side", "left", "right", "outboard", "inboard", "all",
  "blind", "spot", "zone", "monitor", "monitoring", "detection", "alert",
  "warning", "assist", "assistance", "control", "controls", "sensor", "sensors",
  "camera", "cameras", "view", "vision", "mirror", "mirrors",
  "lane", "departure", "keeping", "keep", "centering", "change",
  "cruise", "adaptive", "intelligent", "automatic", "automated", "auto",
  "emergency", "braking", "brake", "brakes", "collision", "forward", "pre",
  "parking", "park", "distance", "cross", "traffic", "sign", "recognition",
  "driver", "attention", "drowsiness", "surround", "panoramic", "high", "low",
  "beam", "beams", "headlight", "headlights", "headlamp", "headlamps",
  "light", "lights", "lighting", "led",
  "heated", "cooled", "ventilated", "seat", "seats", "steering", "wheel",
  "power", "manual", "remote", "engine", "start", "keyless", "entry", "access",
  "liftgate", "tailgate", "hands", "free", "sunroof", "moonroof", "roof",
  "audio", "premium", "speaker", "speakers", "sound", "navigation", "display",
  "touchscreen", "screen", "bluetooth", "wireless", "charging", "usb",
  "climate", "zone", "air", "conditioning", "cargo", "tow", "towing", "trailer",
  "hitch", "running", "boards", "board", "step", "steps", "illuminated",
  "alloy", "wheels", "tire", "tires", "pressure", "spare",
  "safety", "security", "theft", "anti", "airbag", "airbags", "backup",
  "speed", "limiter", "limit", "reminder", "exit", "occupant",
]);

const isGenericDescription = (name: string): boolean => {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !/^\d+$/.test(t));
  return tokens.length > 0 && tokens.every((t) => COMMON_EQUIPMENT_WORDS.has(t));
};

export function findForeignTechnology(
  row: string,
  brand: OemBrand,
): { technology: OemTechnology; owner: OemBrand } | undefined {
  // An owned match settles it. Several makers catalog the same supplier under
  // their own fuller name ("Bose Premium Audio" is Mazda's entry), so without
  // this guard every legitimate Bose row on a Chevrolet would be called
  // foreign. Only a row we can find NO home for is a crossed feed.
  if (findTechnology(row, brand)) return undefined;
  const owners = new Set<OemBrand>(technologyOwners(brand));
  const hit = COMPILED.find((t) => !owners.has(t.brand) && !t.sharedWith?.includes(brand) && matches(t, row));
  // A generic descriptor filed in someone else's catalog is not a crossed
  // feed; it is the industry's shared vocabulary.
  if (hit && isGenericDescription(hit.name)) return undefined;
  return hit ? { technology: hit, owner: hit.brand } : undefined;
}

/**
 * The manufacturer's own rendering of a row that IS one of its technologies.
 *
 * Only returned when the row is the bare name in different casing or
 * punctuation ("propilot assist" -> "ProPILOT Assist"). A row carrying more
 * detail than the catalog name ("Bose Performance Audio - 24 Speakers") is
 * left alone: the source is more specific than we are.
 */
export function officialTechnologyName(row: string, brand: OemBrand): string | undefined {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const tech = findTechnology(row, brand);
  if (!tech) return undefined;
  const rowKey = key(row);
  if (rowKey === key(tech.name)) return row === tech.name ? undefined : tech.name;
  for (const a of tech.aka ?? []) if (rowKey === key(a)) return tech.name;
  return undefined;
}

/** True when the row names a system worth printing exactly as the maker wrote it. */
export const isKnownTechnology = (row: string, brand: OemBrand): boolean =>
  findTechnology(row, brand) !== undefined;

/** Catalog size, for coverage reporting. */
export const TECHNOLOGY_COUNT = COMPILED.length;
