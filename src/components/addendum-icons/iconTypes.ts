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
export type AddendumIconCategory =
  | "status"
  | "passport"
  | "vehicle"
  | "accessories"
  | "coverage"
  | "maintenance"
  | "documents"
  | "ui"
  | "warnings";

export const CATEGORY_PREFIX: Record<AddendumIconCategory, string> = {
  status: "S", passport: "P", vehicle: "V", accessories: "A",
  coverage: "C", maintenance: "M", documents: "D", ui: "U", warnings: "W",
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
