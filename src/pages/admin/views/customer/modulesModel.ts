import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import type { AdminIconName } from "@/components/admin/v3/editor";
import { PACKET_MODULES, packetVisible, type PacketModule } from "@/lib/packetModules";
import type { ReviewChangeRow } from "@/components/admin/v3/editor";

export type ModulesDraft = {
  packet_module_defaults: Record<string, boolean>;
  history_report_links_enabled: boolean;
};

export const MODULE_LABELS: Record<string, string> = {
  packet_module_defaults: "Passport module defaults",
  history_report_links_enabled: "History report links (store-wide)",
};

export const readModules = (s: DealerSettings): ModulesDraft => ({
  packet_module_defaults: { ...(s.packet_module_defaults ?? {}) },
  history_report_links_enabled: s.history_report_links_enabled !== false,
});

export const modulesToPatch = (changed: Partial<ModulesDraft>): Partial<DealerSettings> => changed as unknown as Partial<DealerSettings>;

export interface ModuleGroup { id: string; title: string; description: string; icon: AdminIconName; ids: string[] }

export const MODULE_GROUPS: ModuleGroup[] = [
  { id: "value", title: "Why this car", description: "The value story: why the price and the car make sense.", icon: "star", ids: ["insights", "marketValue", "programs"] },
  { id: "details", title: "Vehicle details", description: "What the car is and what it looks like.", icon: "car", ids: ["factoryOptions", "description", "photos", "videos"] },
  { id: "condition", title: "Condition and care", description: "Work done, and coverage that remains.", icon: "wrench", ids: ["recon", "warranty"] },
  { id: "documents", title: "Documents and reports", description: "Paperwork and manufacturer material shoppers can open.", icon: "file", ids: ["oemSticker", "documents", "historyReport", "brochure", "ownersManual"] },
  { id: "tools", title: "Shopper tools", description: "Interactive helpers.", icon: "calculator", ids: ["payment"] },
];

export const MODULE_ICONS: Record<string, AdminIconName> = {
  insights: "chart", marketValue: "dollar", programs: "award", factoryOptions: "list", description: "file", photos: "image", videos: "video",
  recon: "wrench", warranty: "shield-check", oemSticker: "tag", documents: "folder", historyReport: "history", brochure: "book", ownersManual: "book", payment: "calculator",
};

export const OEM_MODULE_IDS = ["oemSticker", "brochure", "ownersManual"];

export const DATA_NEED: Record<string, string> = {
  insights: "Market and history facts the Passport already holds for the vehicle.",
  recon: "An inspection result or recorded reconditioning work.",
  oemSticker: "A manufacturer window sticker link or stored copy.",
  programs: "Dealer programs that apply to the vehicle's condition.",
  marketValue: "A current market comparison for the vehicle.",
  factoryOptions: "A decoded factory options list.",
  photos: "More than one vehicle photo.",
  description: "A written vehicle description.",
  payment: "A published payment estimator for the store.",
  videos: "At least one walkaround video.",
  warranty: "Remaining warranty, service records or available accessories.",
  documents: "A stored window sticker or a dealer-added document.",
  brochure: "A manufacturer brochure link.",
  ownersManual: "A manufacturer owner's manual link.",
  historyReport: "A CARFAX or AutoCheck link found for the vehicle.",
};

export const REQUIRED_BY_POLICY = [
  { id: "recall", label: "Recall check", detail: "The recall banner always shows when a campaign is open." },
  { id: "price", label: "Drive-out price", detail: "The price breakdown always shows." },
  { id: "installs", label: "Verified installs", detail: "Installed products that were verified always show." },
] as const;

export const moduleById = (id: string): PacketModule | undefined => PACKET_MODULES.find((m) => m.id === id);

export const isOn = (defaults: Record<string, boolean>, id: string): boolean => packetVisible({ packet_defaults: defaults }, id);

export const unknownEntries = (defaults: Record<string, unknown>): string[] => Object.keys(defaults).filter((k) => !PACKET_MODULES.some((m) => m.id === k));
export const ignoredValues = (defaults: Record<string, unknown>): string[] => Object.keys(defaults).filter((k) => typeof defaults[k] !== "boolean");

/** Turning a module on removes a key that was absent so a toggled-back draft equals the saved one. Absent and true mean the same. */
export function setModule(draft: Record<string, boolean>, baseline: Record<string, boolean>, id: string, on: boolean): Record<string, boolean> {
  const next = { ...draft };
  if (!on) next[id] = false;
  else if (baseline[id] === undefined) delete next[id];
  else next[id] = true;
  return next;
}

export function overrideExamples(defaults: Record<string, boolean>, id: string) {
  const store = { packet_defaults: defaults };
  return {
    inherit: packetVisible(store, id),
    forcedOn: packetVisible({ ...store, packet_modules: { [id]: true } }, id),
    forcedOff: packetVisible({ ...store, packet_modules: { [id]: false } }, id),
  };
}

export function moduleChangeRows(before: ModulesDraft, after: ModulesDraft): ReviewChangeRow[] {
  const rows: ReviewChangeRow[] = [];
  for (const m of PACKET_MODULES) {
    const b = isOn(before.packet_module_defaults, m.id);
    const a = isOn(after.packet_module_defaults, m.id);
    if (b !== a) rows.push({ id: m.id, label: m.label, before: b ? "On by default" : "Off by default", after: a ? "On by default" : "Off by default" });
  }
  if (before.history_report_links_enabled !== after.history_report_links_enabled) {
    rows.push({ id: "history_report_links_enabled", label: MODULE_LABELS.history_report_links_enabled, before: before.history_report_links_enabled ? "Allowed" : "Off", after: after.history_report_links_enabled ? "Allowed" : "Off" });
  }
  return rows;
}
