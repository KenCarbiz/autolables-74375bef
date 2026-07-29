import { describe, it, expect } from "vitest";
import {
  packetLinkKeyFor,
  catalogCovers,
  shouldAttemptLink,
  selectStickerTargets,
  selectLinkTargets,
  interleaveByTenant,
  classifyHarvest,
  classifySticker,
  harvestChargesProvider,
  stickerChargesProvider,
  persistedLinkOutcome,
  stickerStampsChecked,
  describeTruncation,
  clampInt,
  linkKey,
  LINK_MAX_ATTEMPTS,
  LINK_NOT_FOUND_RETRY_DAYS,
  LINK_ERROR_RETRY_DAYS,
  type AttemptRow,
  type ListingRow,
  type InvokeLike,
} from "./packetBackfill.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-29T09:40:00.000Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const listing = (over: Partial<ListingRow> = {}): ListingRow => ({
  id: "l1", tenant_id: "t1", vin: "1HGCM82633A004352", ymm: "2021 Honda Accord",
  oem_sticker_url: null, oem_sticker_checked_at: null, ...over,
});

const attempt = (over: Partial<AttemptRow> = {}): AttemptRow => ({
  kind: "brochure", make_key: "honda", model_key: "accord", year_key: 2021,
  outcome: "not_found", attempts: 1, last_attempt_at: ago(1), ...over,
});

const res = (over: Partial<InvokeLike> = {}): InvokeLike => ({
  ok: true, status: 200, data: null, error: null, rateLimited: false, ...over,
});

describe("packetLinkKeyFor", () => {
  it("keys a vehicle the way the passport looks its links up", () => {
    expect(packetLinkKeyFor("2021 Honda Accord Sport")).toEqual({ year: 2021, make: "Honda", model: "Accord Sport" });
  });

  it("keeps the reader's naive split for multi-word makes rather than the correct one", () => {
    // "Land" is wrong, and deliberately so: public-listing-view looks the link
    // up by parts[1]. Filing it under "Land Rover" would make the harvest
    // invisible to the shopper page it exists to fill.
    expect(packetLinkKeyFor("2024 Land Rover Range Rover"))
      .toEqual({ year: 2024, make: "Land", model: "Rover Range Rover" });
  });

  it("refuses a ymm that cannot produce a key the reader would query", () => {
    expect(packetLinkKeyFor(null)).toBeNull();
    expect(packetLinkKeyFor("   ")).toBeNull();
    expect(packetLinkKeyFor("2021")).toBeNull();
    expect(packetLinkKeyFor("2021 Honda")).toBeNull();
    // No leading model year: the reader would read the make out of the model
    // position, so every link derived from this is wrong and harvesting one
    // is pure waste.
    expect(packetLinkKeyFor("Honda Accord Sport")).toBeNull();
  });
});

describe("catalogCovers", () => {
  const rows = [{ make: "Honda", model: "Accord", year: 2021 }];

  it("covers an exact year", () => {
    expect(catalogCovers(rows, "honda", "ACCORD", 2021)).toBe(true);
  });

  it("covers a year within two, matching the passport's nearest-year rule", () => {
    expect(catalogCovers(rows, "Honda", "Accord", 2023)).toBe(true);
    expect(catalogCovers(rows, "Honda", "Accord", 2019)).toBe(true);
  });

  it("does not cover a year further than two away", () => {
    expect(catalogCovers(rows, "Honda", "Accord", 2016)).toBe(false);
  });

  it("treats a year-less portal row as covering every year", () => {
    // The manual harvest falls back to a make's Manuals & Guides page, which
    // has no year; the passport shows it for any year, so re-harvesting would
    // buy nothing the shopper cannot already see.
    const portal = [{ make: "Kia", model: "Telluride", year: null }];
    expect(catalogCovers(portal, "Kia", "Telluride", 2018)).toBe(true);
    expect(catalogCovers(portal, "Kia", "Telluride", null)).toBe(true);
  });

  it("does not cross model or make boundaries", () => {
    expect(catalogCovers(rows, "Honda", "Civic", 2021)).toBe(false);
    expect(catalogCovers(rows, "Acura", "Accord", 2021)).toBe(false);
  });

  it("is false when make or model is missing", () => {
    expect(catalogCovers(rows, "", "Accord", 2021)).toBe(false);
    expect(catalogCovers(rows, "Honda", "", 2021)).toBe(false);
  });
});

describe("shouldAttemptLink", () => {
  it("attempts a triple never asked before", () => {
    expect(shouldAttemptLink(undefined, { now: NOW })).toBe(true);
  });

  it("never re-asks a found triple", () => {
    expect(shouldAttemptLink(attempt({ outcome: "found", last_attempt_at: ago(400) }), { now: NOW })).toBe(false);
  });

  it("never re-asks an unsupported make", () => {
    expect(shouldAttemptLink(
      attempt({ outcome: "unsupported", last_attempt_at: ago(400) }), { now: NOW },
    )).toBe(false);
  });

  it("holds a not_found for the full cooldown, then re-asks once", () => {
    const row = attempt({ outcome: "not_found", attempts: 1 });
    expect(shouldAttemptLink({ ...row, last_attempt_at: ago(LINK_NOT_FOUND_RETRY_DAYS - 1) }, { now: NOW })).toBe(false);
    expect(shouldAttemptLink({ ...row, last_attempt_at: ago(LINK_NOT_FOUND_RETRY_DAYS) }, { now: NOW })).toBe(true);
  });

  it("re-asks an error the next day — a 502 is not evidence of absence", () => {
    const row = attempt({ outcome: "error", attempts: 1 });
    expect(shouldAttemptLink({ ...row, last_attempt_at: ago(0) }, { now: NOW })).toBe(false);
    expect(shouldAttemptLink({ ...row, last_attempt_at: ago(LINK_ERROR_RETRY_DAYS) }, { now: NOW })).toBe(true);
  });

  it("stops forever at the attempt ceiling", () => {
    expect(shouldAttemptLink(
      attempt({ outcome: "not_found", attempts: LINK_MAX_ATTEMPTS, last_attempt_at: ago(9999) }), { now: NOW },
    )).toBe(false);
  });

  it("refuses rather than re-spends when the timestamp is unreadable", () => {
    expect(shouldAttemptLink(attempt({ last_attempt_at: null }), { now: NOW })).toBe(false);
    expect(shouldAttemptLink(attempt({ last_attempt_at: "nonsense" }), { now: NOW })).toBe(false);
  });

  it("force overrides every terminal state", () => {
    expect(shouldAttemptLink(attempt({ outcome: "found" }), { now: NOW, force: true })).toBe(true);
    expect(shouldAttemptLink(
      attempt({ outcome: "unsupported", attempts: 99 }), { now: NOW, force: true },
    )).toBe(true);
  });
});

describe("selectStickerTargets", () => {
  it("selects a published VIN with no sticker and no record of being asked", () => {
    expect(selectStickerTargets([listing()], { now: NOW })).toEqual([
      { vehicleId: "l1", tenantId: "t1", vin: "1HGCM82633A004352" },
    ]);
  });

  it("skips a VIN that already has a sticker on file", () => {
    expect(selectStickerTargets(
      [listing({ oem_sticker_url: "https://x/s.pdf" })], { now: NOW },
    )).toEqual([]);
  });

  it("skips a VIN already checked — the provider is not paid twice for one answer", () => {
    expect(selectStickerTargets(
      [listing({ oem_sticker_checked_at: ago(900) })], { now: NOW },
    )).toEqual([]);
  });

  it("re-opens a checked VIN only when a recheck window is explicitly asked for", () => {
    const rows = [listing({ oem_sticker_checked_at: ago(40) })];
    expect(selectStickerTargets(rows, { now: NOW, recheckAfterDays: 90 })).toEqual([]);
    expect(selectStickerTargets(rows, { now: NOW, recheckAfterDays: 30 })).toHaveLength(1);
  });

  it("drops rows with no tenant, no VIN, or a malformed VIN", () => {
    expect(selectStickerTargets([
      listing({ id: "a", tenant_id: null }),
      listing({ id: "b", vin: null }),
      listing({ id: "c", vin: "NOTAVIN" }),
      listing({ id: "d", vin: "1HGCM82633A00435I" }),
    ], { now: NOW })).toEqual([]);
  });

  it("bills one VIN once even when the dealer lists it twice", () => {
    expect(selectStickerTargets([
      listing({ id: "l1" }), listing({ id: "l2" }),
    ], { now: NOW })).toEqual([{ vehicleId: "l1", tenantId: "t1", vin: "1HGCM82633A004352" }]);
  });

  it("treats a blank sticker url as missing, not as filed", () => {
    expect(selectStickerTargets([listing({ oem_sticker_url: "   " })], { now: NOW })).toHaveLength(1);
  });
});

describe("selectLinkTargets", () => {
  const base = { brochureCatalog: [], manualCatalog: [], attempts: [], now: NOW };

  it("asks for both kinds on an unknown triple", () => {
    const out = selectLinkTargets([listing()], base);
    expect(out.map((t) => t.kind).sort()).toEqual(["brochure", "owners_manual"]);
    expect(out[0]).toMatchObject({ make: "Honda", model: "Accord", year: 2021, tenantId: "t1" });
  });

  it("collapses a hundred identical cars into one harvest per kind", () => {
    const fleet = Array.from({ length: 100 }, (_, i) => listing({ id: `l${i}`, vin: `1HGCM82633A0043${String(i).padStart(2, "0")}` }));
    const out = selectLinkTargets(fleet, base);
    expect(out).toHaveLength(2);
    expect(out[0].vehicleCount).toBe(100);
  });

  it("costs nothing for a triple the link cache already answers", () => {
    const out = selectLinkTargets([listing()], {
      ...base,
      brochureCatalog: [{ make: "Honda", model: "Accord", year: 2021 }],
      manualCatalog: [{ make: "Honda", model: "Accord", year: 2020 }],
    });
    expect(out).toEqual([]);
  });

  it("costs nothing for a triple the attempt cache has already settled", () => {
    const out = selectLinkTargets([listing()], {
      ...base,
      attempts: [
        attempt({ kind: "brochure", outcome: "not_found", last_attempt_at: ago(1) }),
        attempt({ kind: "owners_manual", outcome: "unsupported", last_attempt_at: ago(500) }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("re-running immediately after a run selects nothing new", () => {
    // Idempotence end to end: last night's outcomes are this night's cache.
    const fleet = [listing(), listing({ id: "l2", vin: "2HGCM82633A004352", ymm: "2022 Kia Telluride" })];
    const first = selectLinkTargets(fleet, base);
    expect(first).toHaveLength(4);
    const settled: AttemptRow[] = first.map((t) => ({
      kind: t.kind, make_key: t.make.toLowerCase(), model_key: t.model.toLowerCase(),
      year_key: t.year ?? 0, outcome: "found", attempts: 1, last_attempt_at: ago(0),
    }));
    expect(selectLinkTargets(fleet, { ...base, attempts: settled })).toEqual([]);
  });

  it("orders the highest-leverage harvest first", () => {
    const fleet = [
      ...Array.from({ length: 5 }, (_, i) => listing({ id: `a${i}`, ymm: "2021 Honda Accord" })),
      listing({ id: "b0", ymm: "2021 Kia Telluride" }),
    ];
    const brochures = selectLinkTargets(fleet, base).filter((t) => t.kind === "brochure");
    expect(brochures.map((t) => t.model)).toEqual(["Accord", "Telluride"]);
  });

  it("skips vehicles whose ymm cannot produce the key the passport will query", () => {
    expect(selectLinkTargets([
      listing({ ymm: "2021" }), listing({ ymm: null }), listing({ ymm: "Honda Accord Sport" }),
    ], base)).toEqual([]);
  });

  it("honours a restricted kind list", () => {
    const out = selectLinkTargets([listing()], { ...base, kinds: ["brochure"] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("brochure");
  });

  it("keys year-less inventory apart from a specific year", () => {
    expect(linkKey("brochure", "Honda", "Accord", null))
      .not.toBe(linkKey("brochure", "Honda", "Accord", 2021));
  });
});

describe("interleaveByTenant", () => {
  it("round-robins so one dealer's backlog cannot eat the whole budget", () => {
    const items = [
      { t: "a", v: 1 }, { t: "a", v: 2 }, { t: "a", v: 3 }, { t: "a", v: 4 },
      { t: "b", v: 5 }, { t: "c", v: 6 },
    ];
    expect(interleaveByTenant(items, (i) => i.t).map((i) => i.v)).toEqual([1, 5, 6, 2, 3, 4]);
  });

  it("preserves each tenant's own order", () => {
    const items = [{ t: "a", v: 1 }, { t: "b", v: 2 }, { t: "a", v: 3 }, { t: "b", v: 4 }];
    expect(interleaveByTenant(items, (i) => i.t).map((i) => i.v)).toEqual([1, 2, 3, 4]);
  });

  it("returns every item exactly once", () => {
    const items = Array.from({ length: 37 }, (_, i) => ({ t: `t${i % 4}`, v: i }));
    const out = interleaveByTenant(items, (i) => i.t);
    expect(out).toHaveLength(37);
    expect(new Set(out.map((i) => i.v)).size).toBe(37);
  });

  it("handles an empty list", () => {
    expect(interleaveByTenant([], () => "a")).toEqual([]);
  });
});

describe("classifyHarvest", () => {
  it("reads a fresh harvest", () => {
    expect(classifyHarvest(res({ data: { ok: true, cached: false } }))).toBe("found");
  });

  it("reads a cache hit the function answered without touching Firecrawl", () => {
    expect(classifyHarvest(res({ data: { ok: true, cached: true } }))).toBe("cached");
  });

  it("reads make_not_supported off the 404 body", () => {
    expect(classifyHarvest(res({
      ok: false, status: 404, error: 'http_404: {"error":"make_not_supported","make":"Land"}',
    }))).toBe("unsupported");
  });

  it("reads a genuine miss", () => {
    expect(classifyHarvest(res({ ok: false, status: 404, error: 'http_404: {"error":"brochure_not_found"}' })))
      .toBe("not_found");
    expect(classifyHarvest(res({ ok: false, status: 404, error: 'http_404: {"error":"manual_unreachable"}' })))
      .toBe("not_found");
  });

  it("reads a missing Firecrawl key as not_configured, not as a miss", () => {
    expect(classifyHarvest(res({ data: { error: "not_configured" } }))).toBe("not_configured");
  });

  it("reads a platform throttle as a throttle", () => {
    expect(classifyHarvest(res({ ok: false, status: 429, rateLimited: true, error: "rate_limited_gave_up" })))
      .toBe("rate_limited");
  });

  it("falls back to error on anything else", () => {
    expect(classifyHarvest(res({ ok: false, status: 500, error: "http_500" }))).toBe("error");
    expect(classifyHarvest(res({ data: { error: "brochure_link_not_saved" } }))).toBe("error");
    expect(classifyHarvest(res({ data: null }))).toBe("error");
  });
});

describe("classifySticker", () => {
  it("reads a successful pull", () => {
    expect(classifySticker(res({ data: { ok: true, url: "https://x/s.pdf" } }))).toBe("found");
  });

  it("reads the provider having no sticker for the VIN", () => {
    expect(classifySticker(res({ data: { ok: false, error: "no_sticker (404)" } }))).toBe("miss");
  });

  it("reads an unconfigured provider apart from a miss", () => {
    expect(classifySticker(res({ data: { ok: false, error: "not_configured" } }))).toBe("not_configured");
  });

  it("reads a throttle apart from a failure", () => {
    expect(classifySticker(res({ ok: false, status: 429, rateLimited: true }))).toBe("rate_limited");
  });

  it("reads a non-2xx as an error", () => {
    expect(classifySticker(res({ ok: false, status: 500, error: "http_500" }))).toBe("error");
  });
});

describe("budget accounting", () => {
  it("charges only outcomes that could have reached a provider", () => {
    expect(harvestChargesProvider("found")).toBe(true);
    expect(harvestChargesProvider("not_found")).toBe(true);
    expect(harvestChargesProvider("error")).toBe(true);
    expect(harvestChargesProvider("cached")).toBe(false);
    expect(harvestChargesProvider("unsupported")).toBe(false);
    expect(harvestChargesProvider("not_configured")).toBe(false);
    expect(harvestChargesProvider("rate_limited")).toBe(false);
  });

  it("never charges a throttle against the sticker budget", () => {
    expect(stickerChargesProvider("found")).toBe(true);
    expect(stickerChargesProvider("miss")).toBe(true);
    expect(stickerChargesProvider("error")).toBe(true);
    expect(stickerChargesProvider("rate_limited")).toBe(false);
    expect(stickerChargesProvider("not_configured")).toBe(false);
  });
});

describe("negative-cache writes", () => {
  it("remembers a settled verdict", () => {
    expect(persistedLinkOutcome("found")).toBe("found");
    expect(persistedLinkOutcome("cached")).toBe("found");
    expect(persistedLinkOutcome("not_found")).toBe("not_found");
    expect(persistedLinkOutcome("unsupported")).toBe("unsupported");
    expect(persistedLinkOutcome("error")).toBe("error");
  });

  it("remembers nothing when nothing was learned about the triple", () => {
    expect(persistedLinkOutcome("rate_limited")).toBeNull();
    expect(persistedLinkOutcome("not_configured")).toBeNull();
  });

  it("stamps the listing only on a confirmed provider miss", () => {
    expect(stickerStampsChecked("miss")).toBe(true);
    expect(stickerStampsChecked("found")).toBe(false);
    expect(stickerStampsChecked("error")).toBe(false);
    expect(stickerStampsChecked("rate_limited")).toBe(false);
    expect(stickerStampsChecked("not_configured")).toBe(false);
  });
});

describe("describeTruncation", () => {
  const clean = {
    vehicleCapHit: false, stickerTargets: 3, stickerAttempted: 3, stickerDeferred: 0,
    linkTargets: 2, linkAttempted: 2, linkDeferred: 0,
  };

  it("says nothing when the run covered everything it selected", () => {
    expect(describeTruncation(clean)).toBeNull();
  });

  it("names each cap that bit, with the counts behind it", () => {
    const note = describeTruncation({
      ...clean, vehicleCapHit: true, stickerTargets: 90, stickerAttempted: 20, stickerDeferred: 70,
      linkTargets: 30, linkAttempted: 8, linkDeferred: 22,
    });
    expect(note).toContain("page limit");
    expect(note).toContain("70 of 90 VINs deferred");
    expect(note).toContain("22 of 30 OEM link triples deferred");
  });
});

describe("clampInt", () => {
  it("clamps into range and falls back on nonsense", () => {
    expect(clampInt(50, 20, 0, 200)).toBe(50);
    expect(clampInt(9999, 20, 0, 200)).toBe(200);
    expect(clampInt(-5, 20, 0, 200)).toBe(0);
    expect(clampInt("abc", 20, 0, 200)).toBe(20);
    expect(clampInt(undefined, 20, 0, 200)).toBe(20);
  });

  it("accepts an explicit zero, so an operator can disable a phase", () => {
    expect(clampInt(0, 20, 0, 200)).toBe(0);
  });
});
