export type VehicleCondition = "NEW" | "USED" | "CPO" | "DEMO";

export interface StickerVehicle {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  series?: string;
  bodyStyle?: string;
  stockNumber?: string;
  condition: VehicleCondition;
  exteriorColor?: string;
  exteriorColorCode?: string;
  interiorColor?: string;
  interiorColorCode?: string;
  engine?: string;
  transmission?: string;
  drivetrain?: string;
  fuelType?: string;
}

export type EquipmentCategory =
  | "EXTERIOR"
  | "INTERIOR"
  | "COMFORT_CONVENIENCE"
  | "FUNCTIONAL"
  | "POWERTRAIN"
  | "SAFETY_SECURITY"
  | "TECHNOLOGY"
  | "OTHER";

export type PriceStatus = "PRICED" | "INCLUDED" | "NO_CHARGE" | "UNAVAILABLE";

export interface StandardEquipmentGroup {
  category: EquipmentCategory;
  items: string[];
}

export interface StickerPackage {
  code?: string;
  name: string;
  description?: string;
  price?: number;
  priceStatus: PriceStatus;
  features: string[];
}

export interface StickerOption {
  code?: string;
  name: string;
  description?: string;
  price?: number;
  priceStatus: PriceStatus;
  features?: string[];
}

export interface StickerEquipment {
  standard: StandardEquipmentGroup[];
  packages: StickerPackage[];
  options: StickerOption[];
  /** Port-installed accessories: kept separate from factory-installed
   *  options and from dealer-installed accessories (which never appear
   *  on the factory document). */
  portInstalled?: StickerOption[];
}

export type ReconciliationStatus =
  | "MATCHED"
  | "MINOR_VARIATION"
  | "REVIEW_REQUIRED"
  | "INSUFFICIENT_DATA";

export interface StickerPricing {
  currency: "USD";
  baseMsrp?: number;
  packagesTotal?: number;
  optionsTotal?: number;
  factoryInstalledTotal?: number;
  portOptionsTotal?: number;
  destinationCharge?: number;
  /** Federal gas-guzzler tax when applicable and source-backed. */
  gasGuzzlerTax?: number;
  calculatedTotalMsrp?: number;
  sourceReportedTotalMsrp?: number;
  reconciliationDifference?: number;
  reconciliationStatus: ReconciliationStatus;
}

export type EpaStatus = "VERIFIED" | "UNAVAILABLE" | "NOT_APPLICABLE";
export type NhtsaStatus = "VERIFIED" | "NOT_RATED" | "UNAVAILABLE";

export interface StickerRegulatory {
  epaStatus: EpaStatus;
  cityMpg?: number;
  highwayMpg?: number;
  combinedMpg?: number;
  annualFuelCost?: number;
  gallonsPer100Miles?: number;
  fiveYearCostDifference?: number;
  greenhouseGasRating?: number;
  smogRating?: number;
  evRangeMiles?: number;
  gasolineCombinedMpg?: number;
  epaClassNote?: string;
  epaSourceReference?: string;
  nhtsaStatus: NhtsaStatus;
  overallRating?: number;
  frontalDriverRating?: number;
  frontalPassengerRating?: number;
  sideFrontRating?: number;
  sideRearRating?: number;
  rolloverRating?: number;
  nhtsaSourceReference?: string;
}

export interface PartsContentEntry {
  label: string;
  value: string;
  sourceVerified: boolean;
}

export interface StickerFactory {
  assemblyPlant?: string;
  assemblyCountry?: string;
  finalAssemblyPoint?: string;
  transportMethod?: string;
  orderNumber?: string;
  sequenceNumber?: string;
  dealerCode?: string;
  emissionsCode?: string;
  locationCode?: string;
  partsContent?: PartsContentEntry[];
}

export interface StickerWarranty {
  basic?: string;
  powertrain?: string;
  corrosion?: string;
  roadside?: string;
  emissions?: string;
  sourceVerified: boolean;
}

export interface StickerDealer {
  tenantId: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string;
  website?: string;
  authorizedLogoUrl?: string;
}

export type SourceProvider = "NEOVIN" | "OEM_PDF" | "DEALER_UPLOAD" | "MANUAL_REVIEW";

export type SourceClassification =
  | "ORIGINAL_OEM_DOCUMENT"
  | "OEM_BUILD_DATA"
  | "OEM_INVENTORY_MATCH"
  | "CONFIGURATION_MATCH"
  | "DEALER_VERIFIED";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export type VerificationStatus =
  | "AUTO_VERIFIED"
  | "DEALER_VERIFIED"
  | "REVIEW_REQUIRED"
  | "UNPUBLISHED";

export interface StickerDocument {
  vehicleId: string;
  documentId: string;
  sourceProvider: SourceProvider;
  sourceClassification: SourceClassification;
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
  generatedAt: string;
  passportUrl: string;
  templateVersion: string;
  rendererVersion: string;
  dataVersion: string;
}

export interface FactoryStickerData {
  vehicle: StickerVehicle;
  equipment: StickerEquipment;
  pricing: StickerPricing;
  regulatory: StickerRegulatory;
  factory: StickerFactory;
  warranty?: StickerWarranty;
  dealer: StickerDealer;
  document: StickerDocument;
}
