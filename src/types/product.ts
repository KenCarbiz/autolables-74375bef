// ──────────────────────────────────────────────────────────────
// Rich Product Data Model
//
// Products have:
// - Multiple price tiers (sedan, SUV, truck)
// - Full descriptions, benefits, warranty details
// - Product library with extended info
// - Category hierarchy
// - Provider/vendor information
// ──────────────────────────────────────────────────────────────

export type VehicleCategory = "small_sedan" | "large_sedan" | "small_suv" | "large_suv" | "truck" | "van" | "coupe" | "convertible" | "wagon" | "sports" | "default";

export interface ProductPriceTier {
  vehicleCategory: VehicleCategory;
  price: number;
  label?: string;  // e.g. "Sedan/Coupe", "SUV/Crossover", "Truck/Van"
}

export interface ProductLibraryEntry {
  // Core identity
  id: string;
  name: string;
  category: string;           // e.g. "Paint Protection", "Electronics", "Interior", "Exterior", "Warranty", "Maintenance"
  subcategory?: string;       // e.g. "Ceramic Coating", "Film", "Tint"

  // Display on sticker
  subtitle: string;           // Short tagline for the sticker
  badge_type: "installed" | "optional";

  // Pricing tiers
  defaultPrice: number;       // Base price (used when no vehicle category match)
  priceTiers: ProductPriceTier[];  // Category-specific pricing
  price_label: string;        // "Included in Selling Price" or "If Accepted"

  // Rich content (product library)
  description: string;        // Full marketing description
  benefits: string[];         // Bullet point benefits
  features: string[];         // Technical features
  whyItMatters: string;       // Customer-facing "why you need this"

  // Warranty
  warranty: string;           // Short warranty line for sticker
  warrantyDetails: string;    // Full warranty terms & conditions
  warrantyProvider: string;   // Who backs the warranty
  warrantyDuration: string;   // e.g. "7 years / 100,000 miles"
  warrantyTermsAndConditions: string;  // Full T&C (printable for customer)
  warrantyClaimProcess: string;        // How customer initiates a claim
  warrantyClaimPhone: string;          // Claims phone number
  warrantyClaimEmail: string;          // Claims email
  warrantyClaimUrl: string;            // Online claims portal URL

  // Provider / vendor
  vendorName: string;         // e.g. "XPEL", "Cilajet", "Resistall"
  vendorUrl?: string;
  vendorLogo?: string;

  // Compliance
  disclosure: string;         // Legal disclosure text for the addendum
  ftcCompliant: boolean;      // Does this product provide genuine consumer benefit?
  noBenefitWarning?: string;  // If flagged by checkNoBenefitItems()

  // Media
  iconType: string;           // Icon key from PRODUCT_ICONS
  productImageUrl?: string;
  brochureUrl?: string;       // PDF link for the product library
  videoUrl?: string;          // Demo/install video

  // Admin
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Known large vehicles by make/model for accurate size classification
const LARGE_SEDANS = ["avalon", "maxima", "charger", "300", "impala", "taurus", "continental", "genesis", "ls", "s-class", "7 series", "a8", "ct6", "lucid"];
const LARGE_SUVS = ["tahoe", "suburban", "yukon", "expedition", "sequoia", "armada", "escalade", "navigator", "land cruiser", "gx", "lx", "wagoneer", "grand wagoneer", "durango", "traverse", "pilot", "palisade", "telluride", "atlas", "pathfinder", "highlander", "4runner", "defender", "range rover", "x7", "gls", "q7", "q8", "cayenne", "model x"];
const SMALL_SUVS = ["rav4", "cr-v", "cx-5", "tucson", "sportage", "rogue", "escape", "equinox", "trax", "hr-v", "seltos", "kona", "crosstrek", "cx-30", "corolla cross", "kicks", "venue", "trailblazer", "bronco sport", "compass", "cherokee", "nx", "ux", "rdx", "q3", "q5", "x1", "x3", "glc", "macan", "model y"];

// Map body style + model to our vehicle categories
export function getVehicleCategory(bodyStyle: string, model?: string): VehicleCategory {
  const lower = (bodyStyle || "").toLowerCase();
  const modelLower = (model || "").toLowerCase();

  // Check model-specific overrides first
  if (LARGE_SUVS.some(m => modelLower.includes(m))) return "large_suv";
  if (SMALL_SUVS.some(m => modelLower.includes(m))) return "small_suv";
  if (LARGE_SEDANS.some(m => modelLower.includes(m))) return "large_sedan";

  // Sports / performance
  if (lower.includes("sports") || lower.includes("performance") || lower.includes("roadster")) return "sports";

  // Convertible
  if (lower.includes("convertible") || lower.includes("cabriolet")) return "convertible";

  // Coupe
  if (lower.includes("coupe")) return "coupe";

  // Truck
  if (lower.includes("truck") || lower.includes("pickup") || lower.includes("cab")) return "truck";

  // Van
  if (lower.includes("van") || lower.includes("minivan")) return "van";

  // Wagon
  if (lower.includes("wagon") || lower.includes("estate")) return "wagon";

  // SUV — check size by keywords
  if (lower.includes("suv") || lower.includes("crossover") || lower.includes("sport utility")) {
    if (lower.includes("large") || lower.includes("full-size") || lower.includes("full size")) return "large_suv";
    if (lower.includes("small") || lower.includes("compact") || lower.includes("subcompact") || lower.includes("mini")) return "small_suv";
    // Default SUV → small (more common)
    return "small_suv";
  }

  // Sedan — check size
  if (lower.includes("sedan") || lower.includes("hatchback")) {
    if (lower.includes("full") || lower.includes("large") || lower.includes("mid-size") || lower.includes("midsize")) return "large_sedan";
    return "small_sedan";
  }

  return "default";
}

// Human-readable labels for each category
export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  small_sedan: "Small Sedan / Compact",
  large_sedan: "Large Sedan / Mid-Size",
  small_suv: "Small SUV / Crossover",
  large_suv: "Large SUV / Full-Size",
  truck: "Truck / Pickup",
  van: "Van / Minivan",
  coupe: "Coupe",
  convertible: "Convertible",
  wagon: "Wagon",
  sports: "Sports / Performance",
  default: "Standard",
};

// Get the right price for a vehicle category
export function getProductPrice(product: ProductLibraryEntry, vehicleCategory: VehicleCategory): number {
  const tier = product.priceTiers.find(t => t.vehicleCategory === vehicleCategory);
  if (tier) return tier.price;

  // Fall back to default price
  return product.defaultPrice;
}

// ──────────────────────────────────────────────────────────────
// Live-product vehicle-category pricing.
//
// The catalog Product carries an optional `price_tiers` map keyed by
// one of these four broad buckets. Protection products (ceramic, PPF,
// tint, etc.) are commonly priced by vehicle size, so the addendum
// resolves the line price from the decoded body class, falling back to
// the product's base `price` when a bucket is blank.
// ──────────────────────────────────────────────────────────────
export type PriceBucket = "car" | "suv" | "truck" | "van";

export const PRICE_BUCKETS: { id: PriceBucket; label: string }[] = [
  { id: "car", label: "Car / Sedan / Coupe" },
  { id: "suv", label: "SUV / Crossover" },
  { id: "truck", label: "Truck / Pickup" },
  { id: "van", label: "Van / Minivan" },
];

// Collapse the fine-grained VehicleCategory into a pricing bucket.
export function bucketForVehicle(bodyStyle: string, model?: string): PriceBucket {
  switch (getVehicleCategory(bodyStyle, model)) {
    case "small_suv":
    case "large_suv":
      return "suv";
    case "truck":
      return "truck";
    case "van":
      return "van";
    default:
      return "car";
  }
}

// Resolve a product's price for a bucket from its price_tiers map.
// Returns null when no positive tier is set so callers fall back to base.
export function resolveTierPrice(
  tiers: Record<string, number> | null | undefined,
  bucket: PriceBucket
): number | null {
  if (!tiers) return null;
  const v = tiers[bucket];
  return typeof v === "number" && v > 0 ? v : null;
}

// Default product categories for organizing the library
export const PRODUCT_CATEGORIES = [
  { id: "paint_protection", name: "Paint Protection", description: "PPF, ceramic coating, paint sealant" },
  { id: "window", name: "Window", description: "Tint, film, protection" },
  { id: "interior", name: "Interior Protection", description: "Fabric guard, leather treatment, floor liners" },
  { id: "exterior", name: "Exterior", description: "Door edge guards, pinstripe, clear bra, bed liner" },
  { id: "theft", name: "Theft Deterrent", description: "VIN etch, GPS tracking, alarm systems" },
  { id: "electronics", name: "Electronics", description: "Remote start, dash cam, backup camera" },
  { id: "wheels_tires", name: "Wheels & Tires", description: "Wheel locks, nitrogen, tire protection, TPMS" },
  { id: "appearance", name: "Appearance", description: "Detail packages, chrome delete, wrap" },
  { id: "warranty", name: "Warranty & Plans", description: "Extended warranty, VSC, GAP, maintenance plans" },
  { id: "safety", name: "Safety", description: "Road hazard, key replacement, windshield" },
  { id: "convenience", name: "Convenience", description: "All-weather mats, cargo liner, roof rack, running boards" },
  { id: "chemical", name: "Chemical Application", description: "Rust proofing, undercoating, fabric/paint chemicals" },
];

// Empty product template
export const emptyProductLibraryEntry: Omit<ProductLibraryEntry, "id" | "created_at" | "updated_at"> = {
  name: "",
  category: "paint_protection",
  subtitle: "",
  badge_type: "installed",
  defaultPrice: 0,
  priceTiers: [
    { vehicleCategory: "small_sedan", price: 0, label: "Small Sedan / Compact" },
    { vehicleCategory: "large_sedan", price: 0, label: "Large Sedan / Mid-Size" },
    { vehicleCategory: "small_suv", price: 0, label: "Small SUV / Crossover" },
    { vehicleCategory: "large_suv", price: 0, label: "Large SUV / Full-Size" },
    { vehicleCategory: "truck", price: 0, label: "Truck / Pickup" },
    { vehicleCategory: "van", price: 0, label: "Van / Minivan" },
  ],
  price_label: "Included in Selling Price",
  description: "",
  benefits: [],
  features: [],
  whyItMatters: "",
  warranty: "",
  warrantyDetails: "",
  warrantyProvider: "",
  warrantyDuration: "",
  warrantyTermsAndConditions: "",
  warrantyClaimProcess: "",
  warrantyClaimPhone: "",
  warrantyClaimEmail: "",
  warrantyClaimUrl: "",
  vendorName: "",
  disclosure: "",
  ftcCompliant: true,
  iconType: "",
  sort_order: 0,
  is_active: true,
};
