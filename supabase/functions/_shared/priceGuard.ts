// The above-feed guard, made aware of how old the feed is.
//
// The crawler refuses a website price that lands above the dealer's own feed
// price, because a scrape above the feed has always meant the extractor read
// the sticker, the MSRP or a lease figure instead of the selling price. That
// rule assumes the feed is current. On 2026-10-27 the feed had been refused
// for 24 days while the dealer's site had moved to a single "Selling Price"
// about $9,000 above the last feed price; every real price was being refused
// as a mis-parse against a baseline three weeks old.
//
// Rule: above a FRESH feed price is a mis-parse, as before. Above a STALE feed
// price is a mis-parse only when the figure is at or above the MSRP the feed
// last carried, or, with no MSRP known, far above the stale price. Otherwise
// the website is the dealer's advertisement and its price is recorded, with a
// note naming the stale baseline so a person can review it.

export interface AboveFeedInput {
  scraped: number | null | undefined;
  feedPrice: number | null | undefined;
  feedMsrp: number | null | undefined;
  /** Milliseconds since the feed last saw this vehicle; null when unknown. */
  feedAgeMs: number | null | undefined;
  freshMs: number;
  /** Above-feed tolerance before the guard looks at all (default 2%). */
  tolerance?: number;
  /** With no MSRP, how far above a stale feed price is still believable (default 25%). */
  staleCeiling?: number;
}

export type AboveFeedReason =
  | "feed_fresh_above"
  | "at_or_above_msrp"
  | "far_above_stale_feed";

export interface AboveFeedVerdict {
  misparse: boolean;
  reason: AboveFeedReason | null;
  feedStale: boolean;
  note: string;
}

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const days = (ms: number) => Math.round(ms / 86_400_000);

export function judgeAboveFeed(i: AboveFeedInput): AboveFeedVerdict {
  const scraped = i.scraped ?? null;
  const feedPrice = i.feedPrice ?? null;
  const tolerance = i.tolerance ?? 0.02;
  const staleCeiling = i.staleCeiling ?? 0.25;
  if (scraped == null || feedPrice == null || feedPrice <= 0) {
    return { misparse: false, reason: null, feedStale: false, note: "no feed baseline" };
  }
  if (scraped <= feedPrice * (1 + tolerance)) {
    return { misparse: false, reason: null, feedStale: false, note: "at or below the feed price" };
  }
  // Unknown age is treated as fresh: the guard keeps its old strictness unless
  // the feed is known to be stale.
  const feedStale = i.feedAgeMs != null && i.feedAgeMs > i.freshMs;
  if (!feedStale) {
    return {
      misparse: true, reason: "feed_fresh_above", feedStale: false,
      note: `Scraped advertised ${money(scraped)} exceeds feed price ${money(feedPrice)} by >2% - likely a sticker/MSRP or lease mis-parse; advertised price left unchanged.`,
    };
  }
  const feedMsrp = i.feedMsrp ?? null;
  const age = days(i.feedAgeMs as number);
  if (feedMsrp != null && feedMsrp > 0 && scraped >= feedMsrp * 0.995) {
    return {
      misparse: true, reason: "at_or_above_msrp", feedStale: true,
      note: `Scraped advertised ${money(scraped)} is at or above the MSRP the feed last carried (${money(feedMsrp)}); the feed baseline is ${age} days old, so this reads as the sticker, not the selling price; advertised price left unchanged.`,
    };
  }
  if (feedMsrp == null && scraped > feedPrice * (1 + staleCeiling)) {
    return {
      misparse: true, reason: "far_above_stale_feed", feedStale: true,
      note: `Scraped advertised ${money(scraped)} is more than ${Math.round(staleCeiling * 100)}% above a feed price ${age} days old (${money(feedPrice)}) with no MSRP to check against; advertised price left unchanged.`,
    };
  }
  return {
    misparse: false, reason: null, feedStale: true,
    note: `Website price ${money(scraped)} is above the feed price ${money(feedPrice)}, but that feed baseline is ${age} days old${feedMsrp != null ? ` and the figure is below the feed MSRP ${money(feedMsrp)}` : ""}; recorded from the dealer's page. Review when the feed resumes.`,
  };
}

// MarketCheck stamps first_seen_at / last_seen_at / scraped_at as epoch
// seconds; the feed row may also carry an ISO string. Returns epoch ms.
export function parseFeedTimestamp(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
