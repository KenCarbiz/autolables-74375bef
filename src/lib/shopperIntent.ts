// ── Shopper intent signals ───────────────────────────────────────────────────
// A lightweight, on-device heat map of what THIS shopper keeps opening on the
// passport this session. No identity, nothing leaves the browser — just
// per-session counts in sessionStorage, bucketed into the three intents that
// change what we should suggest:
//   price     → they keep opening pricing/market panels → lead with savings
//   equipment → they keep opening equipment/features    → lead with higher-packaged cars
//   coverage  → they keep opening warranty/history      → lead with CPO / newer options
// Used by dealerAlternatives to re-rank the same-rooftop suggestions.

export type ShopperIntent = "price" | "equipment" | "coverage";

const KEY = "al_passport_intent_v1";

const PANEL_BUCKET: [RegExp, ShopperIntent][] = [
  [/market-price|price-confidence|price-history|market-demand|inventory-trend/, "price"],
  [/equipment|highlights|key-specs|overview/, "equipment"],
  [/factory-warranty|ownership-timeline|owner-reviews/, "coverage"],
];

const read = (): Record<ShopperIntent, number> => {
  try {
    const raw = sessionStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    return { price: Number(p.price) || 0, equipment: Number(p.equipment) || 0, coverage: Number(p.coverage) || 0 };
  } catch {
    return { price: 0, equipment: 0, coverage: 0 };
  }
};

export function recordPanelView(panelKey: string): void {
  const bucket = PANEL_BUCKET.find(([re]) => re.test(panelKey))?.[1];
  if (!bucket) return;
  try {
    const counts = read();
    counts[bucket] += 1;
    sessionStorage.setItem(KEY, JSON.stringify(counts));
  } catch { /* storage unavailable (private mode) — suggestions stay neutral */ }
}

// The dominant intent once the shopper has shown a clear lean (2+ opens and
// strictly ahead of the other buckets); null while the signal is ambiguous.
export function getShopperIntent(): ShopperIntent | null {
  const counts = read();
  const entries = (Object.entries(counts) as [ShopperIntent, number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = entries;
  return top[1] >= 2 && top[1] > (second?.[1] ?? 0) ? top[0] : null;
}
