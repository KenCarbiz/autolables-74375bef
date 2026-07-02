import { getAddendumIconDef } from "@/components/addendum-icons/iconRegistry";

// Semantic icon keys → addendum icon library IDs. The label asks for icons
// by meaning ("window_tint", "qr_scan"), never by static path, and always
// resolves to SOMETHING — a missing key falls back to the default product
// tag so the print can never break on artwork.
const SEMANTIC_ICON_IDS: Record<string, string> = {
  // Product keys (match the catalog's stored icon_type values)
  window_tint: "A001",
  paint_protection: "C001",
  paint_protection_film: "A002",
  clear_bra: "A002",
  ceramic_coating: "A003",
  wheel_locks: "AX207",
  floor_mats: "AX203",
  all_weather_mats: "A006",
  remote_start: "AX212",
  roof_rack: "AX202",
  trailer_hitch: "AX201",
  hitch: "AX201",
  dash_cam: "A021",
  splash_guards: "AX208",
  cargo_liner: "AX209",
  tonneau_cover: "AX210",
  bed_liner: "AX211",
  interior_protection: "A026",
  rust_proofing: "A005",
  door_edge_guards: "A023",
  pinstripe: "A004",
  alarm: "A020",
  gps_tracking: "V019",
  nitrogen_tires: "A025",
  theft_deterrent: "C002",
  extended_warranty: "C010",
  maintenance_plan: "WC206",
  gap_insurance: "D001",
  road_hazard: "W004",
  key_replacement: "WC208",
  windshield_protection: "WC209",
  dent_repair: "WC210",
  // Benefits
  powertrain_warranty: "WC202",
  roadside_assistance: "WC205",
  exchange_policy: "C015",
  included_benefit: "S007",
  warranty: "C001",
  // Structural / header keys
  stock_number: "D017",
  vin: "P014",
  calendar: "U023",
  price_tag: "U017",
  qr_scan: "CA201",
  installed_equipment: "PR207",
  included_benefits: "S007",
  available_upgrades: "PR208",
  // Trust + compliance footer
  quality_products: "S014",
  expert_installation: "PR207",
  added_value: "S019",
  peace_of_mind: "S008",
  ftc_compliant: "PR201",
  realtime_updates: "PR203",
  print_ready: "U016",
  ai_powered: "S012",
  default_product: "U017",
};

export const resolveIconId = (iconKey: string, fallbackKey = "default_product"): string => {
  const direct = SEMANTIC_ICON_IDS[iconKey];
  if (direct && getAddendumIconDef(direct)) return direct;
  // Allow passing a registry ID straight through (e.g. "WC205").
  if (getAddendumIconDef(iconKey)) return iconKey.toUpperCase();
  return SEMANTIC_ICON_IDS[fallbackKey] ?? "U017";
};
