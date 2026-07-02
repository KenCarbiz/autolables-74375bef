import type { DealerSettings } from "@/contexts/DealerSettingsContext";

// Print-readiness guard for customer-facing physical documents. An addendum
// or window sticker printed with the placeholder dealership identity is a
// compliance problem (the licensed seller line reads "Your Dealership"), so
// every print/PDF handler asks this before rendering to paper.
export interface PrintBlocker {
  field: string;
  message: string;
}

const PLACEHOLDER_NAMES = ["your dealership", ""];

export const printBlockers = (
  settings: Pick<DealerSettings, "dealer_name" | "dealer_address" | "dealer_state">,
  storeName?: string | null,
): PrintBlocker[] => {
  const blockers: PrintBlocker[] = [];
  const name = (storeName || settings.dealer_name || "").trim();
  if (PLACEHOLDER_NAMES.includes(name.toLowerCase())) {
    blockers.push({ field: "dealer_name", message: "Dealership name isn't set — documents would print \"Your Dealership\" as the seller. Set it in Admin → Branding." });
  }
  if (!(settings.dealer_state || "").trim()) {
    blockers.push({ field: "dealer_state", message: "Operating state isn't set — state-specific disclosures can't be selected. Set it in Admin → Branding." });
  }
  return blockers;
};

// True when printing should proceed. Blockers surface via the callback so
// callers toast/alert with specifics instead of printing a broken document.
export const confirmPrintReady = (
  settings: Pick<DealerSettings, "dealer_name" | "dealer_address" | "dealer_state">,
  storeName: string | null | undefined,
  onBlocked: (blockers: PrintBlocker[]) => void,
): boolean => {
  const blockers = printBlockers(settings, storeName);
  if (blockers.length === 0) return true;
  onBlocked(blockers);
  return false;
};
