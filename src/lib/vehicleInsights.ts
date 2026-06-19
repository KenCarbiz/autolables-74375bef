import type { VehicleListing } from "@/hooks/useVehicleListing";

// ──────────────────────────────────────────────────────────────────────
// Shopper-facing vehicle insights — turns the MarketCheck enrichment and
// market pricing into confident, plain-language selling points for the
// public scan page (/v/:slug). Ordered strongest-first so the trust ribbon
// leads with the best reason to buy (e.g. "below market", "one owner").
// ──────────────────────────────────────────────────────────────────────

export type InsightTone = "emerald" | "blue" | "slate" | "amber";

export interface VehicleInsight {
  id: string;
  label: string;       // short badge text
  detail?: string;     // one-line explanation for the expanded block
  tone: InsightTone;
  strength: number;    // ordering weight (higher = stronger selling point)
}

const numAttr = (mc: Record<string, unknown>, ...keys: string[]): number | null => {
  for (const k of keys) {
    const v = mc[k];
    if (v != null && v !== "") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
};

export function vehicleInsights(l: VehicleListing): VehicleInsight[] {
  const mc = (l.mc_attributes || {}) as Record<string, unknown>;
  const out: VehicleInsight[] = [];

  // Below market — the strongest shopper signal we have.
  const mv = l.market_value != null ? Number(l.market_value) : null;
  const price = l.price != null ? Number(l.price) : null;
  if (mv != null && price != null && mv - price >= 250) {
    const delta = Math.round(mv - price);
    out.push({
      id: "below-market",
      label: `$${delta.toLocaleString()} below market`,
      detail: `Priced $${delta.toLocaleString()} under the typical market value of $${mv.toLocaleString()} for similar vehicles.`,
      tone: "emerald",
      strength: 100,
    });
  } else if (l.market_position === "good_deal" || l.market_position === "great_deal") {
    out.push({ id: "good-deal", label: "Great price", detail: "Priced below comparable listings in this market.", tone: "emerald", strength: 95 });
  } else if (l.market_position === "fair_deal" || l.market_position === "fair_price") {
    out.push({ id: "fair-price", label: "Fair market price", detail: "Priced in line with comparable listings in this market.", tone: "blue", strength: 55 });
  }

  // Certified Pre-Owned.
  if (l.condition === "cpo") {
    out.push({ id: "cpo", label: "Certified Pre-Owned", detail: "Manufacturer-backed certification with extended coverage.", tone: "blue", strength: 90 });
  }

  // History flags from the feed (the flags, not the full report).
  if (mc.carfax_1_owner === true) out.push({ id: "one-owner", label: "One owner", detail: "Vehicle history shows a single previous owner.", tone: "emerald", strength: 82 });
  if (mc.carfax_clean_title === true) out.push({ id: "clean-title", label: "Clean title", detail: "No branded-title history on record.", tone: "emerald", strength: 78 });

  // Low mileage heuristic (used/cpo only).
  if (l.mileage != null && l.mileage > 0 && l.mileage <= 30000 && l.condition !== "new") {
    out.push({ id: "low-miles", label: "Low mileage", detail: `Only ${l.mileage.toLocaleString()} miles.`, tone: "emerald", strength: 68 });
  }

  // Recall status.
  const openRecalls = l.open_recall_count != null ? Number(l.open_recall_count) : null;
  if (openRecalls === 0) {
    out.push({ id: "no-recalls", label: "No open recalls", detail: "No open NHTSA safety recalls at last check.", tone: "emerald", strength: 64 });
  }

  // Days on market — freshness.
  const dom = numAttr(mc, "dom_active", "dom");
  if (dom != null && dom <= 14) {
    out.push({ id: "fresh", label: "Just listed", detail: dom > 0 ? `New to the market — listed ${dom} day${dom === 1 ? "" : "s"} ago.` : "New to the market.", tone: "blue", strength: 58 });
  }

  // Fuel economy.
  const hwy = numAttr(mc, "highway_mpg", "mpg_hwy");
  const city = numAttr(mc, "city_mpg", "mpg_city");
  if (hwy != null && hwy >= 28) {
    out.push({
      id: "mpg",
      label: `Up to ${hwy} mpg hwy`,
      detail: city != null ? `EPA-estimated ${city} city / ${hwy} highway mpg.` : `EPA-estimated ${hwy} highway mpg.`,
      tone: "blue",
      strength: 48,
    });
  }

  return out.sort((a, b) => b.strength - a.strength);
}

// Flatten the feed's options/features into a clean list for the page.
export function listingOptions(l: VehicleListing): string[] {
  const mc = (l.mc_attributes || {}) as Record<string, unknown>;
  const flat = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .map((x) =>
            typeof x === "string"
              ? x
              : x && typeof x === "object"
                ? String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).label ?? (x as Record<string, unknown>).description ?? "")
                : String(x ?? "")
          )
          .filter(Boolean)
      : [];
  return Array.from(new Set([...flat(mc.options), ...flat(mc.features)]));
}
