// Tiny, dependency-free companion to PassportPanel.tsx.
//
// The passport route needs the key list + type-guard synchronously (deep-link
// parsing on mount, useState typing) even when the full PassportPanel component
// is code-split. Keeping these here lets the 3200-line PassportPanel bundle
// stay in a lazy chunk without forcing the passport shell to import it.

export const PASSPORT_PANEL_KEYS = [
  "market-price", "market-demand", "price-confidence", "price-history",
  "comparable-vehicles", "inventory-trend", "factory-warranty",
  "owner-reviews", "highlights", "overview", "key-specs", "equipment", "ownership-timeline",
  "visit-dealer",
] as const;
export type PassportPanelKey = (typeof PASSPORT_PANEL_KEYS)[number];
export const isPassportPanelKey = (v: string | null | undefined): v is PassportPanelKey =>
  !!v && (PASSPORT_PANEL_KEYS as readonly string[]).includes(v);
