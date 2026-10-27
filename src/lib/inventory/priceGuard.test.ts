import { describe, it, expect } from "vitest";
import { judgeAboveFeed, parseFeedTimestamp } from "../../../supabase/functions/_shared/priceGuard";

const day = 86_400_000;
const FRESH = 3 * day;

describe("judgeAboveFeed", () => {
  it("is quiet without a baseline or when the scrape is at or below the feed", () => {
    expect(judgeAboveFeed({ scraped: 50000, feedPrice: null, feedMsrp: null, feedAgeMs: 0, freshMs: FRESH }).misparse).toBe(false);
    expect(judgeAboveFeed({ scraped: null, feedPrice: 50000, feedMsrp: null, feedAgeMs: 0, freshMs: FRESH }).misparse).toBe(false);
    expect(judgeAboveFeed({ scraped: 50900, feedPrice: 50000, feedMsrp: null, feedAgeMs: 0, freshMs: FRESH }).misparse).toBe(false);
  });

  it("keeps refusing a price above a fresh feed, and treats an unknown age as fresh", () => {
    const fresh = judgeAboveFeed({ scraped: 62225, feedPrice: 55598, feedMsrp: 64000, feedAgeMs: 1 * day, freshMs: FRESH });
    expect(fresh.misparse).toBe(true);
    expect(fresh.reason).toBe("feed_fresh_above");
    expect(fresh.note).toMatch(/left unchanged/);
    const unknown = judgeAboveFeed({ scraped: 62225, feedPrice: 55598, feedMsrp: 64000, feedAgeMs: null, freshMs: FRESH });
    expect(unknown.misparse).toBe(true);
    expect(unknown.reason).toBe("feed_fresh_above");
  });

  it("records a website price above a stale feed when it sits below the feed MSRP", () => {
    // The 2026-10-27 case: feed 24 days old at 96,876 with MSRP 108,240; the
    // site now shows a single selling price of 105,981 (105,086 before doc fee).
    const v = judgeAboveFeed({ scraped: 105086, feedPrice: 96876, feedMsrp: 108240, feedAgeMs: 24 * day, freshMs: FRESH });
    expect(v.misparse).toBe(false);
    expect(v.feedStale).toBe(true);
    expect(v.note).toMatch(/24 days old/);
    expect(v.note).toMatch(/below the feed MSRP 108,240/);
  });

  it("still refuses a sticker read against a stale feed", () => {
    const v = judgeAboveFeed({ scraped: 108240, feedPrice: 96876, feedMsrp: 108240, feedAgeMs: 24 * day, freshMs: FRESH });
    expect(v.misparse).toBe(true);
    expect(v.reason).toBe("at_or_above_msrp");
    const nearly = judgeAboveFeed({ scraped: 107900, feedPrice: 96876, feedMsrp: 108240, feedAgeMs: 24 * day, freshMs: FRESH });
    expect(nearly.reason).toBe("at_or_above_msrp");
  });

  it("without an MSRP, allows a modest rise over a stale feed and refuses a wild one", () => {
    expect(judgeAboveFeed({ scraped: 60000, feedPrice: 50000, feedMsrp: null, feedAgeMs: 10 * day, freshMs: FRESH }).misparse).toBe(false);
    const wild = judgeAboveFeed({ scraped: 70000, feedPrice: 50000, feedMsrp: null, feedAgeMs: 10 * day, freshMs: FRESH });
    expect(wild.misparse).toBe(true);
    expect(wild.reason).toBe("far_above_stale_feed");
  });
});

describe("parseFeedTimestamp", () => {
  it("reads epoch seconds, epoch milliseconds, ISO strings, and nothing else", () => {
    expect(parseFeedTimestamp(1759460000)).toBe(1759460000 * 1000);
    expect(parseFeedTimestamp("1759460000")).toBe(1759460000 * 1000);
    expect(parseFeedTimestamp(1759460000000)).toBe(1759460000000);
    expect(parseFeedTimestamp("2026-10-03T03:07:00Z")).toBe(Date.parse("2026-10-03T03:07:00Z"));
    expect(parseFeedTimestamp(null)).toBeNull();
    expect(parseFeedTimestamp("")).toBeNull();
    expect(parseFeedTimestamp("soon")).toBeNull();
    expect(parseFeedTimestamp(0)).toBeNull();
  });
});
