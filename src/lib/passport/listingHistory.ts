// ── Marketplace listing history ───────────────────────────────
// history_payload.entries is MarketCheck's record of ONLINE LISTINGS for this
// VIN: who advertised it, at what asking price and odometer, and when it was
// seen. It is advertising data, NOT a vehicle history report — there is no
// accident, title, service or ownership record in it — so it is labelled as
// listing history everywhere it surfaces and never feeds a score.
//
// The raw feed is one row per crawled source page, so a single store appears
// many times (and sometimes under more than one of its own site names). Rows
// are folded by the advertised dealer name into one record each: an
// aggregation of what is there, never a merge of names that only look alike.

const SOURCE_ENTRY_CAP = 50;
const DAY_MS = 86_400_000;
const NUM0 = new Intl.NumberFormat("en-US");
const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const MY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

export type ListingHistoryEntry = {
  price?: number | null;
  miles?: number | null;
  seller_type?: string | null;
  inventory_type?: string | null;
  dealer?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
};

export type ListingHistoryRecord = {
  key: string;
  dealer: string | null;
  sightings: number;
  from: number | null;
  to: number | null;
  days: number | null;
  firstPrice: number | null;
  lastPrice: number | null;
  priceMoves: number;
  lowMiles: number | null;
  highMiles: number | null;
  sellerType: "fsbo" | "auction" | null;
  advertisedNew: boolean;
};

export type ListingHistory = {
  records: ListingHistoryRecord[];
  sightings: number;
  from: number | null;
  to: number | null;
  atSourceCap: boolean;
};

const millis = (v: unknown): number | null => {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Fold raw listing sightings into one record per advertised dealer name.
 * Every field is carried straight from the feed — a missing price, odometer
 * or date stays missing rather than being estimated from its neighbours.
 */
export function buildListingHistory(entries: ListingHistoryEntry[] | null | undefined): ListingHistory | null {
  const rows = Array.isArray(entries) ? entries : [];
  type Acc = { key: string; dealer: string | null; sightings: number; from: number | null; to: number | null; priced: { at: number | null; idx: number; price: number }[]; miles: number[]; seller: Set<string>; inv: Set<string> };
  const acc = new Map<string, Acc>();
  rows.forEach((e, idx) => {
    if (!e || typeof e !== "object") return;
    const dealer = typeof e.dealer === "string" ? e.dealer.trim() : "";
    const key = dealer.toLowerCase();
    let a = acc.get(key);
    if (!a) { a = { key, dealer: dealer || null, sightings: 0, from: null, to: null, priced: [], miles: [], seller: new Set(), inv: new Set() }; acc.set(key, a); }
    a.sightings += 1;
    const first = millis(e.first_seen), last = millis(e.last_seen);
    for (const t of [first, last]) {
      if (t == null) continue;
      a.from = a.from == null ? t : Math.min(a.from, t);
      a.to = a.to == null ? t : Math.max(a.to, t);
    }
    const price = positive(e.price);
    if (price != null) a.priced.push({ at: first ?? last, idx, price });
    const miles = positive(e.miles);
    if (miles != null) a.miles.push(miles);
    if (typeof e.seller_type === "string" && e.seller_type) a.seller.add(e.seller_type.trim().toLowerCase());
    a.inv.add(typeof e.inventory_type === "string" ? e.inventory_type.trim().toLowerCase() : "");
  });
  if (acc.size === 0) return null;

  const records: ListingHistoryRecord[] = [...acc.values()].map((a) => {
    // Undated prices cannot be placed in the sequence, so they are dropped from
    // the first/last derivation whenever any dated price exists.
    const dated = a.priced.filter((p) => p.at != null);
    const series = dated.length > 0
      ? [...dated].sort((x, y) => (x.at as number) - (y.at as number) || x.idx - y.idx)
      : [...a.priced].sort((x, y) => x.idx - y.idx);
    let priceMoves = 0;
    for (let i = 1; i < series.length; i++) if (series[i].price !== series[i - 1].price) priceMoves += 1;
    const only = a.seller.size === 1 ? [...a.seller][0] : null;
    return {
      key: a.key,
      dealer: a.dealer,
      sightings: a.sightings,
      from: a.from,
      to: a.to,
      days: a.from != null && a.to != null ? Math.max(1, Math.round((a.to - a.from) / DAY_MS)) : null,
      firstPrice: series.length > 0 ? series[0].price : null,
      lastPrice: series.length > 0 ? series[series.length - 1].price : null,
      priceMoves,
      lowMiles: a.miles.length > 0 ? Math.min(...a.miles) : null,
      highMiles: a.miles.length > 0 ? Math.max(...a.miles) : null,
      sellerType: only === "fsbo" || only === "auction" ? only : null,
      advertisedNew: a.inv.size === 1 && a.inv.has("new"),
    };
  });

  records.sort((x, y) => {
    if (x.to == null && y.to == null) return 0;
    if (x.to == null) return 1;
    if (y.to == null) return -1;
    return y.to - x.to || (y.from ?? 0) - (x.from ?? 0);
  });

  const froms = records.map((r) => r.from).filter((t): t is number => t != null);
  const tos = records.map((r) => r.to).filter((t): t is number => t != null);
  return {
    records,
    sightings: rows.length,
    from: froms.length > 0 ? Math.min(...froms) : null,
    to: tos.length > 0 ? Math.max(...tos) : null,
    atSourceCap: rows.length >= SOURCE_ENTRY_CAP,
  };
}

/** "Apr 10 – Apr 12, 2025 · 3 days on record" — null when no date survived. */
export const describeListingPeriod = (r: Pick<ListingHistoryRecord, "from" | "to" | "days">): string | null => {
  if (r.from == null && r.to == null) return null;
  if (r.from == null) return `Seen ${DAY_FMT.format(r.to as number)}`;
  if (r.to == null) return `Seen ${DAY_FMT.format(r.from)}`;
  const a = DAY_FMT.format(r.from), b = DAY_FMT.format(r.to);
  if (a === b) return `Seen ${a}`;
  return `${a} – ${b}${r.days != null && r.days >= 2 ? ` · ${r.days} days on record` : ""}`;
};

/** "31,150 mi" or "31,150 – 33,020 mi" — a range, never a direction. */
export const describeListingOdometer = (r: Pick<ListingHistoryRecord, "lowMiles" | "highMiles">): string | null => {
  if (r.lowMiles == null) return null;
  const hi = r.highMiles ?? r.lowMiles;
  return hi === r.lowMiles ? `${NUM0.format(r.lowMiles)} mi` : `${NUM0.format(r.lowMiles)} – ${NUM0.format(hi)} mi`;
};

/** "Jul 2026 – Sep 2026" across the whole set. */
export const describeListingSpan = (h: Pick<ListingHistory, "from" | "to">): string | null => {
  if (h.from == null || h.to == null) return null;
  const a = MY_FMT.format(h.from), b = MY_FMT.format(h.to);
  return a === b ? a : `${a} – ${b}`;
};
