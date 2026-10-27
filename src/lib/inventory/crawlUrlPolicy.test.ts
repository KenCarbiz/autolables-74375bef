import { describe, it, expect } from "vitest";
import {
  classifyRenderedPage, collectPageVins, discoverVdpUrls, normalizeCrawlUrl, pageTitle,
  preferCrawlUrl, sameUrl, shouldBackoffMismatch, vinFromUrl,
} from "../../../supabase/functions/_shared/crawlUrlPolicy";

// Synthetic VINs and hosts throughout; none of these are real vehicles.
const VIN = "1ABCD23EFGH456789";
const OTHER = "9ZYXW87VUTS654321";
const SITE = "https://dealer.example";

describe("preferCrawlUrl", () => {
  it("prefers a crawler-discovered URL, then the listing's feed URL, then the snapshot", () => {
    expect(preferCrawlUrl({ scrapeUrl: `${SITE}/a`, listingUrl: `${SITE}/b`, snapshotUrl: `${SITE}/c` })).toEqual({ url: `${SITE}/a`, source: "scrape" });
    expect(preferCrawlUrl({ scrapeUrl: " ", listingUrl: `${SITE}/b`, snapshotUrl: `${SITE}/c` })).toEqual({ url: `${SITE}/b`, source: "listing" });
    expect(preferCrawlUrl({ scrapeUrl: null, listingUrl: undefined, snapshotUrl: `${SITE}/c` })).toEqual({ url: `${SITE}/c`, source: "snapshot" });
    expect(preferCrawlUrl({ scrapeUrl: null, listingUrl: null, snapshotUrl: "" })).toEqual({ url: "", source: "none" });
  });
});

describe("normalizeCrawlUrl / sameUrl", () => {
  it("ignores host case, a trailing slash, a fragment and finance view params", () => {
    expect(sameUrl(`${SITE}/viewdetails/new/${VIN}/x?type=finance#top`, `https://DEALER.example/viewdetails/new/${VIN}/x/`)).toBe(true);
    expect(sameUrl(`${SITE}/viewdetails/new/${VIN}/x`, `${SITE}/viewdetails/new/${OTHER}/x`)).toBe(false);
    expect(sameUrl(null, `${SITE}/x`)).toBe(false);
    expect(normalizeCrawlUrl("not a url")).toBe("not a url");
  });
});

describe("discoverVdpUrls / vinFromUrl / collectPageVins", () => {
  it("finds absolute and root-relative VIN-bearing links, deduplicated and stripped of query strings", () => {
    const body = `
      <a href="${SITE}/inventory/new/${VIN}/qx80?type=finance">a</a>
      <a href='/inventory/used/${OTHER}/sedan#photos'>b</a>
      <a href="${SITE}/inventory/new/${VIN}/qx80&amp;x=1">dup</a>
      <a href="/about-us">no vin</a>`;
    const urls = discoverVdpUrls(body, SITE);
    expect(urls).toContain(`${SITE}/inventory/new/${VIN}/qx80`);
    expect(urls).toContain(`${SITE}/inventory/used/${OTHER}/sedan`);
    expect(urls).toHaveLength(3);
    expect(vinFromUrl(urls[0])).toBe(VIN);
    expect(vinFromUrl("/about-us")).toBeNull();
  });

  it("honours the safety predicate", () => {
    const body = `<a href="http://169.254.169.254/${VIN}">meta</a>`;
    expect(discoverVdpUrls(body, SITE, (u) => !u.includes("169.254"))).toEqual([]);
  });

  it("collects VINs from the page and the url", () => {
    const vins = collectPageVins(`<div data-vin="${OTHER}">x</div>`, `${SITE}/v/${VIN}`);
    expect(vins.has(VIN)).toBe(true);
    expect(vins.has(OTHER)).toBe(true);
  });
});

describe("classifyRenderedPage", () => {
  const notChallenge = () => false;
  const base = { requestedUrl: `${SITE}/viewdetails/new/${VIN}/qx80`, pageStatus: 200, targetVin: VIN };

  it("names a challenge page before anything else", () => {
    const r = classifyRenderedPage({ ...base, html: "<title>Just a moment</title>", finalUrl: base.requestedUrl, isChallenge: () => true });
    expect(r.verdict).toBe("challenge");
  });

  it("recognises the vehicle, even through a redirect", () => {
    const r = classifyRenderedPage({ ...base, html: `<title>2026 QX80</title><span>${VIN}</span>`, finalUrl: `${SITE}/inventory/new/${VIN}/qx80`, isChallenge: notChallenge });
    expect(r.verdict).toBe("vehicle");
    expect(r.redirected).toBe(true);
    expect(r.title).toBe("2026 QX80");
  });

  it("calls a page with other VINs another vehicle, and a VIN-less page no vehicle", () => {
    const other = classifyRenderedPage({ ...base, html: `<span>${OTHER}</span>`, finalUrl: `${SITE}/inventory/used/${OTHER}/sedan`, isChallenge: notChallenge });
    expect(other.verdict).toBe("other_vehicle");
    expect(other.redirected).toBe(true);
    expect(other.note).toMatch(/redirected to another vehicle/);
    const none = classifyRenderedPage({ ...base, html: "<title>New Inventory</title> starting at $51,765", finalUrl: `${SITE}/inventory/new`, isChallenge: notChallenge });
    expect(none.verdict).toBe("no_vehicle");
    expect(none.redirected).toBe(true);
    expect(none.pageVins).toBe(0);
  });

  it("does not call a page redirected when the provider reports the same path", () => {
    const stockUrl = `${SITE}/inventory/new/qx80-stock-123`;
    const r = classifyRenderedPage({ ...base, requestedUrl: stockUrl, html: "<p>nothing</p>", finalUrl: `${stockUrl}/`, isChallenge: notChallenge });
    expect(r.verdict).toBe("no_vehicle");
    expect(r.redirected).toBe(false);
  });

  it("counts a VIN-bearing final URL as the vehicle even when the markup hides the VIN", () => {
    const r = classifyRenderedPage({ ...base, html: "<p>rendered by script</p>", finalUrl: base.requestedUrl, isChallenge: notChallenge });
    expect(r.verdict).toBe("vehicle");
    expect(r.redirected).toBe(false);
  });

  it("without a target VIN a page with any VIN is a vehicle page", () => {
    const r = classifyRenderedPage({ ...base, targetVin: null, html: `<span>${OTHER}</span>`, finalUrl: null, isChallenge: notChallenge });
    expect(r.verdict).toBe("vehicle");
  });
});

describe("shouldBackoffMismatch", () => {
  const now = Date.parse("2026-10-27T22:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const url = `${SITE}/viewdetails/new/${VIN}/qx80`;
  const base = { candidateUrl: url, ledgerUrl: `${url}?type=finance`, now, windowMs: 7 * day, threshold: 3 };

  it("backs off the same dead URL after the threshold inside the window", () => {
    expect(shouldBackoffMismatch({ ...base, attempts: 3, lastAttemptAt: new Date(now - day).toISOString() })).toBe(true);
    expect(shouldBackoffMismatch({ ...base, attempts: 66, lastAttemptAt: new Date(now - 6 * day).toISOString() })).toBe(true);
  });

  it("never backs off a refreshed URL, a young count, or an old attempt", () => {
    expect(shouldBackoffMismatch({ ...base, attempts: 66, lastAttemptAt: new Date(now - day).toISOString(), candidateUrl: `${SITE}/inventory/new/${VIN}/qx80` })).toBe(false);
    expect(shouldBackoffMismatch({ ...base, attempts: 2, lastAttemptAt: new Date(now - day).toISOString() })).toBe(false);
    expect(shouldBackoffMismatch({ ...base, attempts: 9, lastAttemptAt: new Date(now - 8 * day).toISOString() })).toBe(false);
    expect(shouldBackoffMismatch({ ...base, attempts: 9, lastAttemptAt: null })).toBe(false);
  });
});

describe("pageTitle", () => {
  it("reads a trimmed title and tolerates its absence", () => {
    expect(pageTitle("<html><title> New  Inventory | Dealer </title>")).toBe("New Inventory | Dealer");
    expect(pageTitle("<html><body>x</body></html>")).toBeNull();
  });
});
