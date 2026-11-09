// Catalog of the 28 OEM window-sticker layouts from the owner's Figma data
// handoff (2026-11-04), plus the configuration matcher that decides whether a
// vehicle may ever be routed to one of them.
//
// A catalog template is a NEW layout, separate from the approved masters in
// referenceVariants.ts / MASTER_APPROVAL. Every entry starts as
// pending_owner_approval: production routing never selects it, and only the
// explicit sample-render path may draw it for owner review. Figma is the
// design reference only; nothing here is read from Figma at runtime.
//
// The four heavy-duty pickup templates (F-250, Ram 2500, Silverado 2500,
// Sierra 3500) are diesel-only: each reference is a diesel truck with the CARB
// panel and no EPA label (over 8,500 lb GVWR), and a gasoline heavy-duty truck
// is not matched even though the layout would carry it. Fuel evidence is the
// verified EPA fuel type, else the NeoVIN fuel_type when it states diesel.
// Each gasoline variant is a separate entry in BLOCKED_VARIANT_REQUESTS that
// stays unbuilt until a genuine OEM gasoline label is supplied.
//
// A reference label proves nothing about other model years, bodies or
// powertrains, so a vehicle matches only when model year, model line, body
// class and fuel/powertrain class all agree. A make that has catalog
// templates but none for the vehicle's configuration is flagged
// template_configuration_unsupported; rendering for it is unchanged.

export const TEMPLATE_CATALOG_VERSION = "1.0.0";

/**
 * superseded_by_approved_master: an owner classification (Nov 7 2026) for an
 * entry whose vehicles an approved master already serves. It is never
 * routable, and it changes nothing about the master's routing or priority.
 */
export type CatalogApproval = "pending_owner_approval" | "approved" | "superseded_by_approved_master";
export type CatalogLayoutStatus = "not_started" | "in_progress" | "sample_ready" | "approved";
export type CatalogFuelClass = "gasoline" | "hybrid" | "phev" | "ev" | "diesel";
export type CatalogBodyClass =
  | "SUV" | "SEDAN" | "PICKUP" | "MINIVAN" | "COUPE" | "CONVERTIBLE" | "WAGON" | "HATCHBACK" | "VAN";

export type CatalogBlockerCode =
  | "font_substitution"
  | "ocr_unverified"
  | "sample_machine_readable_artwork_not_reproduced"
  | "owner_exact_match_not_approved"
  | "layout_not_built"
  | "served_by_approved_master"
  | "reference_is_2025"
  | "marked_online_copy"
  | "missing_source_artwork"
  | "no_text_layer_in_reference"
  | "range_chart_pending"
  | "carb_panel_pending"
  | "carb_mdv_class_unverified"
  | "reference_msrp_unreconciled"
  | "powertrain_rule_unverified"
  | "page_size_nonstandard"
  | "reference_stored_rotated"
  | "epa_panel_scaled"
  | "epa_scale_scan_rebuilt"
  | "hope_on_wheels_artwork_not_reproduced"
  | "nhtsa_ratings_not_wired"
  | "parts_content_not_wired"
  | "warranty_terms_not_wired"
  | "ev_figures_not_wired"
  | "missing_oem_gasoline_reference"
  | "reference_altered_vehicle";

export interface CatalogMatchRule {
  modelYears: readonly number[];
  /** Tested against the model with every non-alphanumeric character removed, upper-cased then lower-cased. */
  modelPattern: string;
  excludedModelPattern?: string;
  /** Tested against the lower-cased trim; a match excludes the template (for example a plug-in variant sold as a trim). */
  excludedTrimPattern?: string;
  bodyClasses: readonly CatalogBodyClass[];
  fuelClasses: readonly CatalogFuelClass[];
  drivetrains?: readonly string[];
  /** A record that states no drivetrain still matches (the model is only built in the named drivetrain). */
  unknownDrivetrainMatches?: boolean;
  /** Tested against the lower-cased trim; absent means any trim of the model. */
  trimPattern?: string;
  /** Heavy-duty gasoline truck: it has no EPA fuel economy row, so the fuel class is read from a NeoVIN decode that states gasoline. */
  decodeGasolineFuel?: true;
}

export interface CatalogTemplate {
  id: string;
  brand: string;
  /** Normalized make: upper-case letters and digits only. */
  canonicalMake: string;
  source: { modelYear: number; model: string; trim: string };
  referenceStatus: "2026_factory_example" | "2026_marked_online_copy" | "2025_reference_only";
  /** Page size of the reference PDF; a rendered page must equal it. */
  page: { widthPt: number; heightPt: number; orientation: "landscape" | "portrait" };
  referencePdf: string;
  /** Informational only. Figma is never a runtime dependency. */
  design: { fileKey: string; masterNodeId: string };
  match: CatalogMatchRule;
  approval: CatalogApproval;
  layoutStatus: CatalogLayoutStatus;
  /** An approved master already serves this configuration; the catalog template is a separate candidate. */
  existingMasterKey?: string;
  blockers: readonly CatalogBlockerCode[];
}

export const TEMPLATE_CATALOG: readonly CatalogTemplate[] = [
  {
    id: "alfa_romeo_2026_giulia_veloce",
    brand: "Alfa Romeo",
    canonicalMake: "ALFAROMEO",
    source: { modelYear: 2026, model: "Giulia", trim: "Veloce" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Alfa_Romeo_2026_Giulia_Veloce.pdf",
    design: { fileKey: "TFwkJ5GKoNH1mjAbmHzlct", masterNodeId: "3:824" },
    match: { modelYears: [2026], modelPattern: "^giulia$", bodyClasses: ["SEDAN"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "aston_martin_2026_vantage_roadster",
    brand: "Aston Martin",
    canonicalMake: "ASTONMARTIN",
    source: { modelYear: 2026, model: "Vantage", trim: "Roadster" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Aston_Martin_2026_Vantage_Roadster.pdf",
    design: { fileKey: "w4wcUofXSX020vHQIhN9zR", masterNodeId: "1:688" },
    match: { modelYears: [2026], modelPattern: "^vantage$", bodyClasses: ["CONVERTIBLE"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "no_text_layer_in_reference", "reference_stored_rotated", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "bentley_2026_continental_gt_azure",
    brand: "Bentley",
    canonicalMake: "BENTLEY",
    source: { modelYear: 2026, model: "Continental GT", trim: "Azure" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1159.29, heightPt: 697.01, orientation: "landscape" },
    referencePdf: "Bentley_2026_Continental_GT_Azure.pdf",
    design: { fileKey: "z4BdUP0OCHnaktjScEcCNG", masterNodeId: "1:429" },
    match: { modelYears: [2026], modelPattern: "^continentalgt$", bodyClasses: ["COUPE", "CONVERTIBLE"], fuelClasses: ["phev"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "range_chart_pending", "powertrain_rule_unverified", "page_size_nonstandard", "missing_source_artwork", "ev_figures_not_wired", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "buick_2026_envista_avenir",
    brand: "Buick",
    canonicalMake: "BUICK",
    source: { modelYear: 2026, model: "Envista", trim: "Avenir" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Buick_2026_Envista_Avenir.pdf",
    design: { fileKey: "sCNlNdmOzOx1C7jxt3wMBq", masterNodeId: "2:466" },
    match: { modelYears: [2026], modelPattern: "^envista$", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "pending_owner_approval",
    layoutStatus: "sample_ready",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "cadillac_2026_escalade_iql_premium_sport",
    brand: "Cadillac",
    canonicalMake: "CADILLAC",
    source: { modelYear: 2026, model: "Escalade IQL", trim: "Premium Sport" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Cadillac_2026_Escalade_IQL_Premium_Sport.pdf",
    design: { fileKey: "yd9IzgDohOuwez6hPc60WK", masterNodeId: "1:824" },
    match: { modelYears: [2026], modelPattern: "^escaladeiq", bodyClasses: ["SUV"], fuelClasses: ["ev"], },
    approval: "pending_owner_approval",
    layoutStatus: "sample_ready",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "missing_source_artwork", "parts_content_not_wired", "warranty_terms_not_wired", "carb_mdv_class_unverified"],
  },
  {
    id: "chevrolet_2026_silverado_2500_high_country",
    brand: "Chevrolet",
    canonicalMake: "CHEVROLET",
    source: { modelYear: 2026, model: "Silverado 2500", trim: "High Country" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Chevrolet_2026_Silverado_2500_High_Country.pdf",
    design: { fileKey: "6lFZHEOempaeguzjr0sSOb", masterNodeId: "1:824" },
    match: { modelYears: [2026], modelPattern: "^silverado2500", bodyClasses: ["PICKUP"], fuelClasses: ["diesel"], },
    approval: "pending_owner_approval",
    layoutStatus: "sample_ready",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "carb_panel_pending", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "chrysler_2026_voyager_lx",
    brand: "Chrysler",
    canonicalMake: "CHRYSLER",
    source: { modelYear: 2026, model: "Voyager", trim: "LX" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Chrysler_2026_Voyager_LX.pdf",
    design: { fileKey: "wOmRNh3cib1TqhkcFEUKqO", masterNodeId: "1:897" },
    match: { modelYears: [2026], modelPattern: "^voyager$", bodyClasses: ["MINIVAN"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "dodge_2026_durango_gt_blacktop",
    brand: "Dodge",
    canonicalMake: "DODGE",
    source: { modelYear: 2026, model: "Durango", trim: "GT Blacktop" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Dodge_2026_Durango_GT_Blacktop.pdf",
    design: { fileKey: "YS8oPxN3wIbn3ijLmhmuDc", masterNodeId: "1:824" },
    match: { modelYears: [2026], modelPattern: "^durango$", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "ford_2026_f250",
    brand: "Ford",
    canonicalMake: "FORD",
    source: { modelYear: 2026, model: "F-250", trim: "Super Duty" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Ford_2026_F250.pdf",
    design: { fileKey: "2g3UZx8tx8OFgwft6XAssG", masterNodeId: "1:824" },
    match: { modelYears: [2026], modelPattern: "^f250(superduty)?(pickup)?$", bodyClasses: ["PICKUP"], fuelClasses: ["diesel"], },
    approval: "pending_owner_approval",
    layoutStatus: "sample_ready",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "carb_panel_pending", "warranty_terms_not_wired"],
  },
  {
    id: "gmc_2026_sierra_3500_denali_ultimate",
    brand: "GMC",
    canonicalMake: "GMC",
    source: { modelYear: 2026, model: "Sierra 3500", trim: "Denali Ultimate" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "GMC_2026_Sierra_3500_Denali_Ultimate.pdf",
    design: { fileKey: "1KkxbDPYNy2r10UcZTBPlB", masterNodeId: "1:824" },
    match: { modelYears: [2026], modelPattern: "^sierra3500", bodyClasses: ["PICKUP"], fuelClasses: ["diesel"], },
    approval: "pending_owner_approval",
    layoutStatus: "sample_ready",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "carb_panel_pending", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "genesis_2026_gv80_3.5t_prestige",
    brand: "Genesis",
    canonicalMake: "GENESIS",
    source: { modelYear: 2026, model: "GV80", trim: "3.5T Prestige" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Genesis_2026_GV80_3.5T_Prestige.pdf",
    design: { fileKey: "bJilnmW6l2DfhGYWz2nbpU", masterNodeId: "1:320" },
    match: { modelYears: [2026], modelPattern: "^gv80$", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "honda_2026_odyssey_touring",
    brand: "Honda",
    canonicalMake: "HONDA",
    source: { modelYear: 2026, model: "Odyssey", trim: "Touring" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 792, heightPt: 612, orientation: "landscape" },
    referencePdf: "Honda_2026_Odyssey_Touring.pdf",
    design: { fileKey: "bYlV3mnBv5YlIpZauBSaib", masterNodeId: "2:821" },
    match: { modelYears: [2026], modelPattern: "^odyssey$", bodyClasses: ["MINIVAN"], fuelClasses: ["gasoline"], },
    approval: "pending_owner_approval",
    layoutStatus: "sample_ready",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "no_text_layer_in_reference", "reference_stored_rotated", "missing_source_artwork", "epa_panel_scaled", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "hyundai_2026_tucson_se_awd",
    brand: "Hyundai",
    canonicalMake: "HYUNDAI",
    source: { modelYear: 2026, model: "Tucson", trim: "SE AWD" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Hyundai_2026_Tucson_SE_AWD.pdf",
    design: { fileKey: "ri3E33YzTgPc8RYJl6NEOn", masterNodeId: "1:393" },
    match: { modelYears: [2026], modelPattern: "^tucson$", excludedModelPattern: "^tucsonhybrid|^tucsonplug", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "epa_scale_scan_rebuilt", "hope_on_wheels_artwork_not_reproduced", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "jeep_2026_wrangler_willys_392",
    brand: "Jeep",
    canonicalMake: "JEEP",
    source: { modelYear: 2026, model: "Wrangler", trim: "Willys 392" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Jeep_2026_Wrangler_Willys_392.pdf",
    design: { fileKey: "iIZJSBEBc0Ywk6fzKIQTFF", masterNodeId: "1:824" },
    match: { modelYears: [2026], modelPattern: "^wrangler(2door|4door|unlimited)?$", excludedModelPattern: "^wrangler4xe", excludedTrimPattern: "4xe", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], drivetrains: ["4WD"], unknownDrivetrainMatches: true, },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "epa_scale_scan_rebuilt", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "kia_2026_sorento_lx",
    brand: "Kia",
    canonicalMake: "KIA",
    source: { modelYear: 2026, model: "Sorento", trim: "LX" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Kia_2026_Sorento_LX.pdf",
    design: { fileKey: "xcxFLxAY6O3SJieA2e6WQv", masterNodeId: "1:393" },
    match: { modelYears: [2026], modelPattern: "^sorento$", excludedModelPattern: "^sorentohybrid|^sorentoplug", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "lamborghini_2026_urus_se",
    brand: "Lamborghini",
    canonicalMake: "LAMBORGHINI",
    source: { modelYear: 2026, model: "Urus", trim: "SE" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Lamborghini_2026_Urus_SE.pdf",
    design: { fileKey: "UpPzSNMcVHF6N9WsXKbT5p", masterNodeId: "1:846" },
    match: { modelYears: [2026], modelPattern: "^urus$", bodyClasses: ["SUV"], fuelClasses: ["phev"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "range_chart_pending", "reference_stored_rotated", "no_text_layer_in_reference", "missing_source_artwork", "ev_figures_not_wired", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "lincoln_2026_nautilus_premiere",
    brand: "Lincoln",
    canonicalMake: "LINCOLN",
    source: { modelYear: 2026, model: "Nautilus", trim: "Premiere" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Lincoln_2026_Nautilus_Premiere.pdf",
    design: { fileKey: "e0549oHeHY7hoityL1ljd7", masterNodeId: "1:394" },
    match: { modelYears: [2026], modelPattern: "^nautilus$", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "maserati_2026_granturismo_trofeo",
    brand: "Maserati",
    canonicalMake: "MASERATI",
    source: { modelYear: 2026, model: "GranTurismo", trim: "Trofeo" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Maserati_2026_GranTurismo_Trofeo.pdf",
    design: { fileKey: "r7OzwGrxQWEyF5GA5sJKYH", masterNodeId: "1:323" },
    match: { modelYears: [2026], modelPattern: "^granturismo$", bodyClasses: ["COUPE"], fuelClasses: ["gasoline"], },
    approval: "pending_owner_approval",
    layoutStatus: "sample_ready",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "parts_content_not_wired", "warranty_terms_not_wired", "reference_msrp_unreconciled"],
  },
  {
    id: "mitsubishi_2026_outlander_sport_s",
    brand: "Mitsubishi",
    canonicalMake: "MITSUBISHI",
    source: { modelYear: 2026, model: "Outlander Sport", trim: "2.0 S" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Mitsubishi_2026_Outlander_Sport_S.pdf",
    design: { fileKey: "VehaYwRPRnGDHVPNxrppeA", masterNodeId: "1:393" },
    match: { modelYears: [2026], modelPattern: "^outlandersport$|^rvr$", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "reference_stored_rotated", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "ram_2026_2500_limited",
    brand: "RAM",
    canonicalMake: "RAM",
    source: { modelYear: 2026, model: "2500", trim: "Limited" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Ram_2026_2500_Limited.pdf",
    design: { fileKey: "KQDfedj4ysiDgipy9fYPjs", masterNodeId: "1:824" },
    match: { modelYears: [2026], modelPattern: "^(ram)?2500(pickup)?$", bodyClasses: ["PICKUP"], fuelClasses: ["diesel"], },
    approval: "pending_owner_approval",
    layoutStatus: "sample_ready",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "carb_panel_pending", "warranty_terms_not_wired"],
  },
  {
    id: "ram_2026_2500_gas",
    brand: "RAM",
    canonicalMake: "RAM",
    source: { modelYear: 2026, model: "2500", trim: "Big Horn" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "../gas-hd-references/Ram_2026_2500_Big_Horn_Gas_3C6UR5DJ7TG302125.pdf",
    design: { fileKey: "KQDfedj4ysiDgipy9fYPjs", masterNodeId: "1:824" },
    match: { modelYears: [2026], modelPattern: "^(ram)?2500(pickup)?$", bodyClasses: ["PICKUP"], fuelClasses: ["gasoline"], decodeGasolineFuel: true, },
    approval: "pending_owner_approval",
    layoutStatus: "sample_ready",
    blockers: ["font_substitution", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "carb_panel_pending", "warranty_terms_not_wired"],
  },
  {
    id: "rolls-royce_2026_spectre",
    brand: "Rolls-Royce",
    canonicalMake: "ROLLSROYCE",
    source: { modelYear: 2026, model: "Spectre", trim: "Spectre" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Rolls-Royce_2026_Spectre.pdf",
    design: { fileKey: "rvEUVoSjTWaiDa6HckLQ4O", masterNodeId: "1:735" },
    match: { modelYears: [2026], modelPattern: "^spectre$", bodyClasses: ["COUPE"], fuelClasses: ["ev"], },
    approval: "pending_owner_approval",
    layoutStatus: "sample_ready",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "reference_stored_rotated", "no_text_layer_in_reference", "missing_source_artwork", "ev_figures_not_wired", "parts_content_not_wired", "warranty_terms_not_wired", "reference_msrp_unreconciled"],
  },
  {
    id: "subaru_2026_forester_wilderness",
    brand: "Subaru",
    canonicalMake: "SUBARU",
    source: { modelYear: 2026, model: "Forester", trim: "Wilderness" },
    referenceStatus: "2026_factory_example",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Subaru_2026_Forester_Wilderness.pdf",
    design: { fileKey: "y788YsVcOr0lMwPln7vjyy", masterNodeId: "1:393" },
    match: { modelYears: [2026], modelPattern: "^forester$", excludedModelPattern: "^foresterhybrid|^foresterplug", excludedTrimPattern: "hybrid", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "infiniti_2026_qx60_sport",
    brand: "INFINITI",
    canonicalMake: "INFINITI",
    source: { modelYear: 2026, model: "QX60", trim: "Sport" },
    referenceStatus: "2026_marked_online_copy",
    page: { widthPt: 792, heightPt: 612, orientation: "landscape" },
    referencePdf: "Infiniti_2026_QX60_Sport.pdf",
    design: { fileKey: "J3SqYGgMhIDclzOxxb7wRO", masterNodeId: "1:822" },
    match: { modelYears: [2026], modelPattern: "^qx60$", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "superseded_by_approved_master",
    layoutStatus: "sample_ready", existingMasterKey: "infiniti-2026-qx60-sport-awd",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "marked_online_copy", "page_size_nonstandard", "served_by_approved_master"],
  },
  {
    id: "lexus_2026_rx_350_awd",
    brand: "Lexus",
    canonicalMake: "LEXUS",
    source: { modelYear: 2026, model: "RX 350", trim: "AWD" },
    referenceStatus: "2026_marked_online_copy",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Lexus_2026_RX_350_AWD.pdf",
    design: { fileKey: "KayjX5jlCkfCvPTnzy2Re3", masterNodeId: "1:393" },
    match: { modelYears: [2026], modelPattern: "^rx350$|^rx$", excludedModelPattern: "^rx350h|^rx450h|^rx500h", excludedTrimPattern: "350h|450h|500h|hybrid", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "marked_online_copy", "reference_stored_rotated", "parts_content_not_wired"],
  },
  {
    id: "nissan_2026_pathfinder_platinum",
    brand: "Nissan",
    canonicalMake: "NISSAN",
    source: { modelYear: 2026, model: "Pathfinder", trim: "Platinum" },
    referenceStatus: "2026_marked_online_copy",
    page: { widthPt: 792, heightPt: 612, orientation: "landscape" },
    referencePdf: "Nissan_2026_Pathfinder_Platinum.pdf",
    design: { fileKey: "wqUIPGVY4aHERMX0QmxzFl", masterNodeId: "1:822" },
    match: { modelYears: [2026], modelPattern: "^pathfinder$", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "superseded_by_approved_master",
    layoutStatus: "sample_ready", existingMasterKey: "nissan-2026-pathfinder-platinum-4wd",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "owner_exact_match_not_approved", "marked_online_copy", "page_size_nonstandard", "served_by_approved_master"],
  },
  {
    id: "toyota_2026_4runner_trd_sport",
    brand: "Toyota",
    canonicalMake: "TOYOTA",
    source: { modelYear: 2026, model: "4Runner", trim: "SR5" },
    referenceStatus: "2026_marked_online_copy",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Toyota_2026_4Runner_TRD_Sport.pdf",
    design: { fileKey: "YF2cIi6d6z4iyf1xcXdXre", masterNodeId: "1:393" },
    match: { modelYears: [2026], modelPattern: "^4runner$", excludedModelPattern: "^4runnerhybrid", excludedTrimPattern: "trdpro|trailhunter|platinum|hybrid|iforcemax", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "marked_online_copy", "reference_stored_rotated", "parts_content_not_wired", "powertrain_rule_unverified"],
  },
  {
    id: "fiat_2025_500e_giorgio_armani",
    brand: "Fiat",
    canonicalMake: "FIAT",
    source: { modelYear: 2025, model: "500e", trim: "Giorgio Armani" },
    referenceStatus: "2025_reference_only",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Fiat_2025_500e_Giorgio_Armani.pdf",
    design: { fileKey: "CN6z6UNk9YFEEfe1Nvk9mS", masterNodeId: "1:933" },
    match: { modelYears: [2025], modelPattern: "^500e$", bodyClasses: ["HATCHBACK"], fuelClasses: ["ev"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "reference_is_2025", "missing_source_artwork", "ev_figures_not_wired", "parts_content_not_wired", "warranty_terms_not_wired"],
  },
  {
    id: "volvo_2025_xc60_b5_awd_plus",
    brand: "Volvo",
    canonicalMake: "VOLVO",
    source: { modelYear: 2025, model: "XC60", trim: "B5 AWD Plus" },
    referenceStatus: "2025_reference_only",
    page: { widthPt: 1224, heightPt: 792, orientation: "landscape" },
    referencePdf: "Volvo_2025_XC60_B5_AWD_Plus.pdf",
    design: { fileKey: "ZSb0xcK1N6bcFnqlM5jevY", masterNodeId: "1:393" },
    match: { modelYears: [2025], modelPattern: "^xc60$", excludedModelPattern: "^xc60recharge", excludedTrimPattern: "t8|t6|recharge|b6", bodyClasses: ["SUV"], fuelClasses: ["gasoline"], },
    approval: "approved",
    layoutStatus: "approved",
    blockers: ["font_substitution", "ocr_unverified", "sample_machine_readable_artwork_not_reproduced", "reference_is_2025", "powertrain_rule_unverified", "parts_content_not_wired", "warranty_terms_not_wired"],
  },];

/**
 * A gasoline variant of a heavy-duty diesel template (owner directive, Nov 8
 * 2026). It has its own entry so it is never served by the diesel layout, but
 * no genuine OEM gasoline label is in project files, so nothing is built and
 * it never matches for routing. Engine, emissions, GVWR, EPA applicability,
 * MSRP and page format must all come from that label, never from the diesel.
 */
export interface CatalogVariantRequest {
  id: string;
  brand: string;
  canonicalMake: string;
  source: { modelYear: number; model: string; trim: null };
  dieselTemplateId: string;
  match: CatalogMatchRule;
  approval: "pending_owner_approval";
  layoutStatus: "not_started";
  blockers: readonly CatalogBlockerCode[];
  requiredFromReference: readonly string[];
  /** A located OEM gasoline label, recorded once its VIN, source and checksum are verified (gas-hd-references/provenance.json). */
  reference?: {
    file: string;
    vin: string;
    sha256: string;
    source: string;
    kind: "standard_retail" | "altered_commercial";
  };
}

const GAS_HD_REQUIRED = [
  "genuine OEM gasoline window label (PDF or flat scan) for a 2026 model-year truck",
  "engine and transmission as printed",
  "emissions certification and the CARB medium-duty panel as printed",
  "GVWR, and whether an EPA fuel economy label applies at that GVWR",
  "base price, options, destination and total MSRP as printed",
  "page size and orientation",
] as const;

const GAS_HD_BLOCKERS: readonly CatalogBlockerCode[] = [
  "missing_oem_gasoline_reference", "layout_not_built", "owner_exact_match_not_approved",
  "carb_panel_pending", "powertrain_rule_unverified",
];

const GAS_HD_BLOCKERS_WITH_REFERENCE: readonly CatalogBlockerCode[] = [
  "layout_not_built", "owner_exact_match_not_approved", "carb_panel_pending",
];

export const BLOCKED_VARIANT_REQUESTS: readonly CatalogVariantRequest[] = [
  {
    id: "ford_2026_f250_gas", brand: "Ford", canonicalMake: "FORD",
    source: { modelYear: 2026, model: "F-250 Super Duty", trim: null }, dieselTemplateId: "ford_2026_f250",
    match: { modelYears: [2026], modelPattern: "^f250(superduty)?(pickup)?$", bodyClasses: ["PICKUP"], fuelClasses: ["gasoline"] },
    approval: "pending_owner_approval", layoutStatus: "not_started", blockers: GAS_HD_BLOCKERS, requiredFromReference: GAS_HD_REQUIRED,
  },
  {
    id: "chevrolet_2026_silverado_2500hd_gas", brand: "Chevrolet", canonicalMake: "CHEVROLET",
    source: { modelYear: 2026, model: "Silverado 2500HD", trim: null }, dieselTemplateId: "chevrolet_2026_silverado_2500_high_country",
    match: { modelYears: [2026], modelPattern: "^silverado2500", bodyClasses: ["PICKUP"], fuelClasses: ["gasoline"] },
    approval: "pending_owner_approval", layoutStatus: "not_started", blockers: GAS_HD_BLOCKERS, requiredFromReference: GAS_HD_REQUIRED,
  },
  {
    id: "gmc_2026_sierra_3500hd_gas", brand: "GMC", canonicalMake: "GMC",
    source: { modelYear: 2026, model: "Sierra 3500HD", trim: null }, dieselTemplateId: "gmc_2026_sierra_3500_denali_ultimate",
    match: { modelYears: [2026], modelPattern: "^sierra3500", bodyClasses: ["PICKUP"], fuelClasses: ["gasoline"] },
    approval: "pending_owner_approval", layoutStatus: "not_started",
    blockers: ["reference_altered_vehicle", ...GAS_HD_BLOCKERS_WITH_REFERENCE], requiredFromReference: GAS_HD_REQUIRED,
    reference: {
      file: "gas-hd-references/GMC_2026_Sierra_3500_Pro_Gas_ALTERED_1GT3USE75TF129680.pdf", vin: "1GT3USE75TF129680",
      sha256: "f9d23805a840aed834d01bf001900f18143661e0885349254184144253515c56", source: "dealer-hosted GM label (Springfield GMC)",
      kind: "altered_commercial",
    },
  },
];

/** True when a template for this make and model reads the gasoline fuel class from the NeoVIN decode (no EPA row exists for it). */
export const usesDecodeGasolineFuel = (make: string | null | undefined, model: string | null | undefined): boolean => {
  const m = token(make);
  const mo = token(model).toLowerCase();
  return !!m && !!mo && TEMPLATE_CATALOG.some((t) => t.canonicalMake === m && t.match.decodeGasolineFuel === true && new RegExp(t.match.modelPattern).test(mo));
};

export const CATALOG_ENTRY_COUNT = TEMPLATE_CATALOG.length + BLOCKED_VARIANT_REQUESTS.length;

/** True when the catalog holds at least one template with a built layout for this make. */
export const hasBuiltCatalogTemplates = (make: string | null | undefined): boolean => {
  const m = token(make);
  return !!m && TEMPLATE_CATALOG.some((t) => t.canonicalMake === m && t.layoutStatus !== "not_started" && !t.existingMasterKey);
};

export const getCatalogTemplate = (id: string): CatalogTemplate | null =>
  TEMPLATE_CATALOG.find((t) => t.id === id) ?? null;

export interface CatalogVehicleInput {
  make: string | null;
  modelYear: number | null;
  model: string | null;
  trim: string | null;
  /** Free-text body style from the record (mc_attributes.body_type). */
  bodyClass: string | null;
  fuelClass: CatalogFuelClass | null;
  drivetrain: string | null;
}

const token = (s: string | null | undefined): string => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");

export function normalizeBodyClass(raw: string | null | undefined): CatalogBodyClass | null {
  const t = String(raw ?? "").toUpperCase();
  if (!t.trim()) return null;
  if (/MINI\s*-?VAN|PASSENGER VAN|MPV/.test(t)) return "MINIVAN";
  if (/CARGO|\bVAN\b/.test(t)) return "VAN";
  if (/PICK\s*-?UP|TRUCK|CREW CAB|CAB/.test(t)) return "PICKUP";
  if (/CONVERTIBLE|ROADSTER|CABRIOLET|SPYDER|DROPHEAD/.test(t)) return "CONVERTIBLE";
  if (/SUV|SPORT UTILITY|CROSSOVER|\bUTILITY\b/.test(t)) return "SUV";
  if (/SEDAN|SALOON/.test(t)) return "SEDAN";
  if (/COUPE|GRAN TURISMO|FASTBACK/.test(t)) return "COUPE";
  if (/WAGON|ESTATE|SPORTBACK|AVANT/.test(t)) return "WAGON";
  if (/HATCH/.test(t)) return "HATCHBACK";
  return null;
}

export interface CatalogEvaluation {
  matched: boolean;
  reasons: string[];
}

export function evaluateCatalogTemplate(
  t: { match: CatalogMatchRule; source: { model: string } }, v: CatalogVehicleInput,
): CatalogEvaluation {
  const reasons: string[] = [];
  const r = t.match;
  if (v.modelYear === null || !r.modelYears.includes(v.modelYear)) {
    reasons.push(`model year ${v.modelYear ?? "unknown"} is not ${r.modelYears.join("/")}`);
  }
  const model = token(v.model).toLowerCase();
  if (!model) reasons.push("model unknown");
  else {
    if (!new RegExp(r.modelPattern).test(model)) reasons.push(`model ${v.model} is not ${t.source.model}`);
    if (r.excludedModelPattern && new RegExp(r.excludedModelPattern).test(model)) reasons.push(`model ${v.model} is an excluded variant`);
  }
  const body = normalizeBodyClass(v.bodyClass);
  if (!body) reasons.push("body class unknown");
  else if (!r.bodyClasses.includes(body)) reasons.push(`body ${body} is not ${r.bodyClasses.join("/")}`);
  if (!v.fuelClass) reasons.push("powertrain unknown");
  else if (!r.fuelClasses.includes(v.fuelClass)) reasons.push(`powertrain ${v.fuelClass} is not ${r.fuelClasses.join("/")}`);
  if (r.drivetrains) {
    const d = token(v.drivetrain);
    if (!d) { if (!r.unknownDrivetrainMatches) reasons.push("drivetrain unknown"); }
    else if (!r.drivetrains.some((x) => token(x) === d || (x === "4WD" && d === "AWD"))) reasons.push(`drivetrain ${d} is not ${r.drivetrains.join("/")}`);
  }
  if (r.excludedTrimPattern && new RegExp(r.excludedTrimPattern).test(token(v.trim).toLowerCase())) {
    reasons.push(`trim ${v.trim} is an excluded variant`);
  }
  if (r.trimPattern && !new RegExp(r.trimPattern).test(String(v.trim ?? "").toLowerCase())) {
    reasons.push(`trim ${v.trim ?? "unknown"} does not match ${r.trimPattern}`);
  }
  return { matched: reasons.length === 0, reasons };
}

export type CatalogFlag = "template_configuration_unsupported" | "template_pending_owner_approval" | "epa_match_conflict";

export interface CatalogResolution {
  status: "approved_match" | "pending_match" | "configuration_unsupported" | "no_catalog_for_make";
  template: CatalogTemplate | null;
  flags: CatalogFlag[];
  /** Same-make templates considered. */
  candidates: string[];
  reasons: string[];
}

/** A template production routing may use: owner-approved with a finished layout. */
export const isRoutable = (t: CatalogTemplate): boolean =>
  t.approval === "approved" && t.layoutStatus === "approved";

export function resolveCatalogTemplate(v: CatalogVehicleInput): CatalogResolution {
  const make = token(v.make);
  const sameMake = TEMPLATE_CATALOG.filter((t) => t.canonicalMake === make);
  if (!make || !sameMake.length) {
    return { status: "no_catalog_for_make", template: null, flags: [], candidates: [], reasons: [] };
  }
  const reasons: string[] = [];
  const matches: CatalogTemplate[] = [];
  for (const t of sameMake) {
    const ev = evaluateCatalogTemplate(t, v);
    if (ev.matched) matches.push(t);
    else reasons.push(`${t.id}: ${ev.reasons.join("; ")}`);
  }
  const candidates = sameMake.map((t) => t.id);
  const approved = matches.find(isRoutable);
  if (approved) return { status: "approved_match", template: approved, flags: [], candidates, reasons: [] };
  if (matches.length) {
    return {
      status: "pending_match", template: matches[0], flags: ["template_pending_owner_approval"], candidates,
      reasons: [`${matches[0].id}: matches the configuration but is ${matches[0].approval}`],
    };
  }
  for (const b of BLOCKED_VARIANT_REQUESTS) {
    if (b.canonicalMake === make && evaluateCatalogTemplate(b, v).matched) {
      reasons.push(b.reference
        ? `${b.id}: matches the configuration; OEM gasoline label verified but no layout is built`
        : `${b.id}: matches the configuration, but no genuine OEM gasoline label exists, so no layout is built`);
    }
  }
  return { status: "configuration_unsupported", template: null, flags: ["template_configuration_unsupported"], candidates, reasons };
}
