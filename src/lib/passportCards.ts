// ──────────────────────────────────────────────────────────────────────
// Passport card arsenal — the "book of cards".
//
// A vehicle passport can show many intelligence/value cards, but a wall of
// weak-data cards erodes trust. The arsenal is the canonical catalog of every
// card we CAN show; the selector picks the strongest 5-7 for a given vehicle by
// data quality and suppresses the thin ones. A card the dealer has explicitly
// turned on (packet override = true) is always shown; one turned off is always
// hidden; the rest auto-select on data strength.
//
// This module is pure and testable. The passport builds a CardSignals bundle
// from its derived PassportData, scores each candidate card, and hands the
// scored list to selectCards() to rank + cap. Card KEYS here match the
// data-module / MODULE_LABEL section keys used across the passport and the
// shopper-activity analytics so one vehicle speaks one vocabulary.
// ──────────────────────────────────────────────────────────────────────

export type PassportCardCategory = "value" | "trust" | "vehicle" | "ownership" | "dealer";

export interface PassportCardDef {
  key: string; // canonical section key (matches data-module + MODULE_LABEL)
  label: string;
  category: PassportCardCategory;
  // Which packet module gates the card for dealer include/exclude, or null when
  // the card has no dealer toggle (it is data-gated only). Reuses the existing
  // packetVisible() curation layer — never a parallel toggle store.
  packetId: string | null;
  basePriority: number; // tiebreak when scores are equal (higher = more prominent)
}

// The full arsenal. The Market Intelligence strip auto-selects from the "value"
// and "trust" cards; the remaining cards are catalogued here so the arsenal is
// the single source of truth for what a passport can surface and how the dealer
// curates it. Ordered by default prominence within category.
export const PASSPORT_CARD_ARSENAL: PassportCardDef[] = [
  // ── Value & market (the Market Intelligence strip) ──
  { key: "market-price", label: "Market Price", category: "value", packetId: "marketValue", basePriority: 95 },
  { key: "price-history", label: "Price History", category: "value", packetId: "marketValue", basePriority: 80 },
  { key: "comparable-vehicles", label: "Comparable Vehicles", category: "value", packetId: "marketValue", basePriority: 78 },
  { key: "price-confidence", label: "Price Confidence", category: "trust", packetId: "marketValue", basePriority: 70 },
  { key: "market-demand", label: "Market Demand", category: "value", packetId: "marketValue", basePriority: 60 },
  { key: "factory-warranty", label: "Warranty", category: "trust", packetId: "warranty", basePriority: 85 },
  // ── Vehicle detail cards (data-gated, dealer-curated; catalogued for the
  // complete arsenal — not part of the auto-selected strip today) ──
  { key: "highlights", label: "Vehicle Highlights", category: "vehicle", packetId: "factoryOptions", basePriority: 75 },
  { key: "key-specs", label: "Specifications", category: "vehicle", packetId: "factoryOptions", basePriority: 55 },
  { key: "equipment", label: "Equipment & Options", category: "vehicle", packetId: "factoryOptions", basePriority: 65 },
  { key: "recon", label: "Reconditioning & Inspection", category: "trust", packetId: "recon", basePriority: 72 },
  { key: "vehicle-history", label: "Vehicle History", category: "ownership", packetId: null, basePriority: 88 },
  { key: "owner-reviews", label: "Reviews", category: "trust", packetId: "programs", basePriority: 45 },
  { key: "overview", label: "Vehicle Overview", category: "vehicle", packetId: "description", basePriority: 40 },
  { key: "great-buy", label: "Why It's a Great Buy", category: "value", packetId: "insights", basePriority: 82 },
  { key: "dealer", label: "Why Buy Here", category: "dealer", packetId: "programs", basePriority: 50 },
];

const ARSENAL_BY_KEY = new Map(PASSPORT_CARD_ARSENAL.map((c) => [c.key, c]));

export const passportCard = (key: string): PassportCardDef | undefined => ARSENAL_BY_KEY.get(key);

// ── Data-quality signals ────────────────────────────────────────────────
// A normalized bundle the passport fills once from its PassportData. Every
// field is optional so a thin vehicle simply scores low, never throws.

export interface CardSignals {
  belowMarket?: number | null; // $ below market average (a discount, positive)
  marketAvg?: number | null;
  price?: number | null;
  similarCount?: number | null; // comparable/same-model listings backing the comp set
  soldCount?: number | null; // sold in the trailing window
  viewCount?: number | null;
  domFavorable?: boolean; // days-on-market at/below the local average
  priceDrop?: number | null; // $ magnitude of a recent price decrease
  ratingOverall?: number | null; // unified vehicle score 0-100
  demandPartsCount?: number; // how many demand signals lined up
  // 0 none · 1 available plans · 2 factory remaining · 3 CPO · 4 dealer-included
  warrantyStrength?: 0 | 1 | 2 | 3 | 4;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const num = (v: number | null | undefined): number | null =>
  v != null && Number.isFinite(v) ? v : null;

// Per-card scorer. Returns 0 to suppress (no worthwhile data), else a 1-100
// data-quality/strength score. Stronger buy signals score higher so the best
// cards float to the front of the strip.
export const scorePassportCard = (key: string, s: CardSignals): number => {
  switch (key) {
    case "market-price": {
      const below = num(s.belowMarket);
      const avg = num(s.marketAvg);
      if (below != null && below > 0) {
        // A real below-market discount is the strongest value signal. Scale the
        // discount as a share of market average, capped.
        const pct = avg && avg > 0 ? below / avg : 0;
        return clamp(70 + pct * 300, 70, 100);
      }
      const price = num(s.price);
      if (avg != null && price != null && price <= avg) return 48; // fairly priced, still worth showing
      return 0;
    }
    case "price-history": {
      const drop = num(s.priceDrop);
      if (drop != null && drop > 0) return clamp(58 + Math.min(drop / 500, 1) * 22); // a drop is a strong nudge
      return 0;
    }
    case "comparable-vehicles": {
      const c = num(s.similarCount) ?? 0;
      const sold = num(s.soldCount) ?? 0;
      if (c < 3 && sold < 3) return 0; // too thin to be credible
      return clamp(45 + Math.min(c, 40) * 0.9 + Math.min(sold, 20) * 0.5);
    }
    case "price-confidence": {
      const r = num(s.ratingOverall);
      if (r == null) return 0;
      return clamp(40 + r * 0.4); // 90 score -> 76
    }
    case "market-demand": {
      const parts = s.demandPartsCount ?? 0;
      if (parts <= 0) return 0;
      return clamp(28 + parts * 12);
    }
    case "factory-warranty": {
      const w = s.warrantyStrength ?? 0;
      return [0, 42, 56, 66, 76][w] ?? 0; // none/available/factory/cpo/included
    }
    default:
      return 0;
  }
};

// ── Selection ─────────────────────────────────────────────────────────────

export interface CardCandidate {
  key: string;
  score: number;
}

export interface SelectCardsOptions {
  // Hard cap on cards shown (the "5-7" ceiling). Default 7.
  max?: number;
  // A dealer override resolver: true = force show, false = force hide,
  // undefined = auto (data-quality). Wraps packetVisible in the caller.
  override?: (key: string) => boolean | undefined;
  // Minimum data-quality score for an auto (non-forced) card to appear.
  minScore?: number;
}

// Rank candidates by data-quality score (basePriority breaks ties), drop cards
// the dealer hid or that score below the floor, force-include cards the dealer
// pinned, and cap at `max`. Forced cards keep their slots before auto cards
// compete for the remainder. Returns the winning keys in display order.
export function selectCards(candidates: CardCandidate[], opts: SelectCardsOptions = {}): CardCandidate[] {
  const max = opts.max ?? 7;
  const minScore = opts.minScore ?? 1;
  const override = opts.override ?? (() => undefined);

  const rank = (a: CardCandidate, b: CardCandidate) => {
    if (b.score !== a.score) return b.score - a.score;
    return (passportCard(b.key)?.basePriority ?? 0) - (passportCard(a.key)?.basePriority ?? 0);
  };

  const forced: CardCandidate[] = [];
  const auto: CardCandidate[] = [];
  for (const c of candidates) {
    const ov = override(c.key);
    if (ov === false) continue; // dealer hid it
    if (ov === true) {
      forced.push(c);
      continue;
    }
    if (c.score >= minScore) auto.push(c);
  }
  forced.sort(rank);
  auto.sort(rank);

  const chosen: CardCandidate[] = [];
  const seen = new Set<string>();
  for (const c of [...forced, ...auto]) {
    if (seen.has(c.key)) continue;
    if (chosen.length >= max) break;
    seen.add(c.key);
    chosen.push(c);
  }
  return chosen;
}
