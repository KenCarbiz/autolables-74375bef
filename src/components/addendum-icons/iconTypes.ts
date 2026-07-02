import type { AddendumIconColor } from "./colorTokens";

// Category ID ranges (the prefix letter encodes the category):
//   S001-S025  status / indicators
//   P001-P025  passport / trust / verification
//   V001-V050  vehicle / performance / drivetrain
//   A001-A075  accessories / aftermarket
//   C001-C050  coverage / warranty / protection
//   M001-M050  maintenance / service / fluids
//   D001-D050  documents / compliance
//   U001-U050  UI / actions / communication
//   W001-W025  warnings / alerts / recall
// The 200-series (numbered reference sheet) uses TWO-letter prefixes starting
// at 201 so it can never collide with the core single-letter ranges:
//   PR201+ pricing/compliance · ST201+ vehicle status · WC201+ coverage
//   SR201+ service/recon · DC201+ documents · CA201+ customer actions
//   AX201+ accessories · EV201+ EV/hybrid · WA201+ warnings
export type AddendumIconCategory =
  | "status"
  | "passport"
  | "vehicle"
  | "accessories"
  | "coverage"
  | "maintenance"
  | "documents"
  | "ui"
  | "warnings"
  | "pricing_compliance"
  | "vehicle_status"
  | "ev";

export const CATEGORY_PREFIX: Record<AddendumIconCategory, string> = {
  status: "S", passport: "P", vehicle: "V", accessories: "A",
  coverage: "C", maintenance: "M", documents: "D", ui: "U", warnings: "W",
  pricing_compliance: "PR", vehicle_status: "ST", ev: "EV",
};

// 200-series prefix → category (categories the sheet shares with the core
// set keep their core category; only the sheet-new concepts get new ones).
export const CATEGORY_PREFIX_200: Record<string, AddendumIconCategory> = {
  PR: "pricing_compliance", ST: "vehicle_status", WC: "coverage", SR: "maintenance",
  DC: "documents", CA: "ui", AX: "accessories", EV: "ev", WA: "warnings",
};

export const CATEGORY_LABEL: Record<AddendumIconCategory, string> = {
  status: "Status & Indicators",
  passport: "Passport & Trust",
  vehicle: "Vehicle & Drivetrain",
  accessories: "Accessories & Aftermarket",
  coverage: "Coverage & Protection",
  maintenance: "Maintenance & Service",
  documents: "Documents & Compliance",
  ui: "UI & Communication",
  warnings: "Warnings & Recalls",
  pricing_compliance: "Pricing & Compliance",
  vehicle_status: "Vehicle Status",
  ev: "EV & Hybrid",
};

export type AddendumIconStatus = "ready" | "placeholder" | "custom_required";
export type AddendumIconSource = "lucide" | "tabler" | "custom";

export interface AddendumIconMeta {
  iconId: string;
  name: string;
  category: AddendumIconCategory;
  description: string;
  recommendedUse: string;
  defaultColor: AddendumIconColor;
  allowedColors: AddendumIconColor[];
  tags: string[];
  status: AddendumIconStatus;
  source: AddendumIconSource;
}
