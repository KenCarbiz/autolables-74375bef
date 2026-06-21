// Vehicle image pipeline for AutoLabels stickers.
// Goal: large window stickers should reliably receive clean, low-background vehicle images
// from API inventory enrichment, while still supporting real vehicle photos when a dealer wants them.

export type VehicleImageSourceType =
  | "factory_clean"
  | "transparent_png"
  | "dealer_inventory_photo"
  | "new_car_api"
  | "generic_api_fallback"
  | "template_illustration";

export type VehicleImagePreference =
  | "factory_clean_first"
  | "dealer_photo_first"
  | "transparent_first"
  | "api_fallback_only";

export type VehicleImageCandidate = {
  url?: string;
  source: VehicleImageSourceType;
  confidence: number;
  label: string;
  background: "transparent" | "clean_low" | "photo" | "unknown";
};

export type VehicleImageInput = {
  factoryCleanImageUrl?: string;
  transparentVehicleImageUrl?: string;
  usedCarPrimaryPhotoUrl?: string;
  newCarImageUrl?: string;
  imageUrl?: string;
  apiFallbackImageUrl?: string;
  imagePreference?: VehicleImagePreference;
};

export type VehicleImageResolution = {
  url?: string;
  source: VehicleImageSourceType;
  background: VehicleImageCandidate["background"];
  confidence: number;
  label: string;
  fallbackUsed: boolean;
  candidates: VehicleImageCandidate[];
};

const candidate = (
  url: string | undefined,
  source: VehicleImageSourceType,
  confidence: number,
  label: string,
  background: VehicleImageCandidate["background"],
): VehicleImageCandidate => ({ url, source, confidence, label, background });

export const buildVehicleImageCandidates = (vehicle: VehicleImageInput): VehicleImageCandidate[] => [
  candidate(vehicle.factoryCleanImageUrl, "factory_clean", 98, "Factory clean low-background image", "clean_low"),
  candidate(vehicle.transparentVehicleImageUrl, "transparent_png", 96, "Transparent vehicle image", "transparent"),
  candidate(vehicle.usedCarPrimaryPhotoUrl || vehicle.imageUrl, "dealer_inventory_photo", 86, "Dealer inventory photo", "photo"),
  candidate(vehicle.newCarImageUrl, "new_car_api", 78, "New-car API image", "clean_low"),
  candidate(vehicle.apiFallbackImageUrl, "generic_api_fallback", 60, "Generic API fallback image", "unknown"),
].filter((item) => Boolean(item.url));

const sortCandidates = (vehicle: VehicleImageInput, candidates: VehicleImageCandidate[]) => {
  const preference = vehicle.imagePreference || "factory_clean_first";
  const orderByPreference: Record<VehicleImagePreference, VehicleImageSourceType[]> = {
    factory_clean_first: ["factory_clean", "transparent_png", "dealer_inventory_photo", "new_car_api", "generic_api_fallback"],
    dealer_photo_first: ["dealer_inventory_photo", "factory_clean", "transparent_png", "new_car_api", "generic_api_fallback"],
    transparent_first: ["transparent_png", "factory_clean", "dealer_inventory_photo", "new_car_api", "generic_api_fallback"],
    api_fallback_only: ["factory_clean", "transparent_png", "new_car_api", "generic_api_fallback", "dealer_inventory_photo"],
  };

  const order = orderByPreference[preference];
  return [...candidates].sort((a, b) => {
    const aIndex = order.indexOf(a.source);
    const bIndex = order.indexOf(b.source);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return b.confidence - a.confidence;
  });
};

export const resolveVehicleImageForSticker = (vehicle: VehicleImageInput): VehicleImageResolution => {
  const candidates = buildVehicleImageCandidates(vehicle);
  const sorted = sortCandidates(vehicle, candidates);
  const chosen = sorted[0];

  if (!chosen) {
    return {
      source: "template_illustration",
      background: "unknown",
      confidence: 0,
      label: "Template illustration fallback",
      fallbackUsed: true,
      candidates,
    };
  }

  return {
    url: chosen.url,
    source: chosen.source,
    background: chosen.background,
    confidence: chosen.confidence,
    label: chosen.label,
    fallbackUsed: chosen.source === "generic_api_fallback",
    candidates,
  };
};

export const shouldRequestFactoryCleanImage = (vehicle: VehicleImageInput) => {
  const candidates = buildVehicleImageCandidates(vehicle);
  return !candidates.some((item) => item.source === "factory_clean" || item.source === "transparent_png");
};
