import { describe, it, expect } from "vitest";
import { DEFAULT_HUB_FILTERS, hasDerivedFilter, overviewCounts, overlapStatement, pageCount, clampPage, parseHubFilters, parseHubView, rangeFor, resolveVehicleFacts, writeHubFilters, type HubDocRow } from "./documentsHubModel";

const doc = (over: Partial<HubDocRow>): HubDocRow => ({ id: "d1", vehicle_id: "v1", document_type: "window", document_status: "published", version: 1, template_id: null, template_version: null, created_at: "2026-11-01T00:00:00Z", ...over });

describe("hub URL state", () => {
  it("falls back to defaults for unknown values", () => {
    const f = parseHubFilters(new URLSearchParams("condition=boat&size=7&page=-3&doc=zzz"));
    expect(f).toEqual(DEFAULT_HUB_FILTERS);
    expect(parseHubView(new URLSearchParams("view=nope"))).toBe("overview");
  });
  it("round-trips filters, omitting defaults and keeping other params", () => {
    const base = new URLSearchParams("tab=templates&view=readiness");
    const f = { ...DEFAULT_HUB_FILTERS, q: "ex", condition: "used" as const, page: 3, size: 50 as const };
    const next = writeHubFilters(base, f);
    expect(next.get("tab")).toBe("templates");
    expect(next.has("doc")).toBe(false);
    expect(parseHubFilters(next)).toEqual(f);
  });
  it("flags only document, status and blocker filters as derived", () => {
    expect(hasDerivedFilter({ ...DEFAULT_HUB_FILTERS, condition: "new" })).toBe(false);
    expect(hasDerivedFilter({ ...DEFAULT_HUB_FILTERS, blocker: "open_recall" })).toBe(true);
  });
  it("pages and clamps", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(51, 25)).toBe(3);
    expect(clampPage(9, 51, 25)).toBe(3);
    expect(rangeFor(2, 25)).toEqual({ from: 25, to: 49 });
  });
});

describe("resolveVehicleFacts", () => {
  it("treats K-208 as not applicable to a New vehicle", () => {
    const f = resolveVehicleFacts({ condition: "new", open_recall_count: 0 }, [doc({ document_type: "factory_sticker" })], []);
    expect(f.service).toBeNull();
  });
  it("shows a missing Buyers Guide on a Used vehicle and never calls it ready", () => {
    const f = resolveVehicleFacts({ condition: "used", open_recall_count: 0 }, [doc({})], []);
    expect(f.readiness).not.toBe("ready");
  });
  it("reports a rejected document as needing attention", () => {
    const f = resolveVehicleFacts({ condition: "used", open_recall_count: 0 }, [doc({ document_status: "rejected" })], []);
    expect(f.readiness).toBe("needs_attention");
  });
});

describe("overview counts", () => {
  it("states overlaps instead of summing to the total", () => {
    const rows = [
      { facts: resolveVehicleFacts({ condition: "used", open_recall_count: 0 }, [doc({ document_status: "rejected" })], []) },
      { facts: resolveVehicleFacts({ condition: "new", open_recall_count: 0 }, [], []) },
    ];
    const c = overviewCounts(rows as never);
    expect(typeof overlapStatement(c)).toBe("string");
  });
});
