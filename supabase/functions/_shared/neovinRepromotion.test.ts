import { describe, it, expect } from "vitest";
import { planRepromotion, pickSnapshot, summarize, NEOVIN_REPROMOTION_VERSION, type SnapshotRow, type ListingRow } from "./neovinRepromotion.ts";
import { structuredSheet } from "./neovinSheet.ts";

const VIN = "3PCAJ5FB1SF109999";

const payload = (over: Record<string, unknown> = {}) => ({
  vin: VIN,
  msrp: 47950, delivery_charges: 1395, combined_msrp: 51345,
  installed_options_details: [{ name: "Sensory Package", code: "SNP", msrp: 2000 }],
  features: [{ description: "Heated seats", category: "Comfort" }],
  high_value_features: [{ description: "ProPILOT Assist", category: "Safety" }],
  warranty: { basic: { months: 48, miles: 60000 } },
  record_confidence: 97, record_source: "build_oem", decode_version: "v7",
  mc_msrp: 47950,
  ...over,
});

const snap = (over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  id: "s1", vin: VIN, endpoint: "/v2/decode/car/neovin/{vin}/specs", payload: payload(),
  payload_hash: "h1", http_status: 200, fetched_at: "2026-08-01T10:00:00.000Z", ...over,
});

const listing = (mc: Record<string, unknown> | null = {}): ListingRow => ({ id: "L1", vin: VIN, mc_attributes: mc });

/** A sheet stored by the parser before the extras existed: same equipment, no lifts. */
const legacySheet = () => {
  const s = structuredSheet(payload()) as Record<string, unknown>;
  const { warranty: _w, confidence: _c, taxonomy: _t, msrp_variants: _m, ...rest } = s;
  return { ...rest, decoded_at: "2026-08-01T10:00:05.000Z" };
};

describe("NeoVIN re-promotion from saved responses", () => {
  it("lifts taxonomy, confidence and warranty with snapshot provenance and the snapshot's own time", () => {
    const plan = planRepromotion(listing({ build_sheet: legacySheet(), engine: "2.0L" }), [snap()]);
    expect(plan.outcome).toBe("would_update");
    const next = plan.next!;
    expect(next.taxonomy).toEqual({ decode_version: "v7", record_source: "build_oem" });
    expect(next.neovin_confidence).toEqual({ record_confidence: 97 });
    expect(next.factory_warranty).toMatchObject({ basis: "original_factory", source: "neovin" });
    expect(next.engine).toBe("2.0L");
    const sheet = next.build_sheet as Record<string, unknown>;
    expect(sheet.decoded_at).toBe("2026-08-01T10:00:05.000Z");
    expect(sheet.request_tier).toBe("neovin_strict");
    expect(sheet.repromoted_from).toMatchObject({ snapshot_id: "s1", payload_hash: "h1", parser_version: NEOVIN_REPROMOTION_VERSION });
  });

  it("dates a sheet it creates from the snapshot, not from the backfill run", () => {
    const plan = planRepromotion(listing({}), [snap()]);
    expect((plan.next!.build_sheet as Record<string, unknown>).decoded_at).toBe("2026-08-01T10:00:00.000Z");
  });

  it("is idempotent: applying the plan and planning again changes nothing", () => {
    const first = planRepromotion(listing({ build_sheet: legacySheet() }), [snap()]);
    const second = planRepromotion(listing(first.next), [snap()]);
    expect(second.outcome).toBe("already_current");
    expect(second.next).toBeNull();
  });

  it("never overwrites a value the listing already holds", () => {
    const plan = planRepromotion(listing({ build_sheet: legacySheet(), taxonomy: { record_source: "build_oem", decode_version: "v6" } }), [snap()]);
    expect(plan.next!.taxonomy).toEqual({ record_source: "build_oem", decode_version: "v6" });
    expect(plan.addedKeys).not.toContain("taxonomy");
  });

  it("writes nothing when the listing already holds a different record_source", () => {
    const plan = planRepromotion(listing({ taxonomy: { record_source: "used_mc_listing" } }), [snap()]);
    expect(plan.outcome).toBe("provenance_conflict");
    expect(plan.next).toBeNull();
  });

  it("never writes null", () => {
    const plan = planRepromotion(listing({}), [snap({ payload: payload({ warranty: null, record_confidence: null }) })]);
    for (const v of Object.values(plan.next!)) expect(v).not.toBeNull();
    expect(plan.next!.factory_warranty).toBeUndefined();
  });

  it("copies record_source as sent and never claims factory verification", () => {
    const plan = planRepromotion(listing({}), [snap({ payload: payload({ record_source: "used_mc_listing" }) })]);
    expect((plan.next!.taxonomy as Record<string, unknown>).record_source).toBe("used_mc_listing");
    expect(JSON.stringify(plan.next)).not.toMatch(/factory_verified|verified/i);
  });

  it("labels an include_generic or basic decoder answer by its request tier", () => {
    const g = planRepromotion(listing({}), [snap({ endpoint: "/v2/decode/car/neovin/{vin}/specs?include_generic=true" })]);
    expect((g.next!.build_sheet as Record<string, unknown>).request_tier).toBe("neovin_include_generic");
    const b = planRepromotion(listing({}), [snap({ endpoint: "/v2/decode/car/{vin}/specs" })]);
    const sheet = b.next!.build_sheet as Record<string, unknown>;
    expect(sheet.request_tier).toBe("basic_decoder");
    expect(sheet.source).toBe("basic_decode");
    expect(b.next!.specs_source).toBeUndefined();
  });

  it("refuses a snapshot for another VIN", () => {
    expect(planRepromotion(listing({}), [snap({ payload: payload({ vin: "1N4BL4BV0KC000001" }) })]).outcome).toBe("rejected_vin_mismatch");
    expect(planRepromotion(listing({}), [snap({ vin: "1N4BL4BV0KC000001" })]).outcome).toBe("rejected_vin_mismatch");
  });

  it("refuses a non-2xx snapshot", () => {
    expect(planRepromotion(listing({}), [snap({ http_status: 422 })]).outcome).toBe("rejected_http");
    expect(planRepromotion(listing({}), [snap({ http_status: null })]).outcome).toBe("rejected_http");
  });

  it("treats a payload with nothing readable as a failure, not an empty decode", () => {
    const plan = planRepromotion(listing({}), [snap({ payload: { vin: VIN, status: "ok" } })]);
    expect(plan.outcome).toBe("unparseable");
    expect(plan.next).toBeNull();
  });

  it("writes nothing when the stored sheet came from a different decode", () => {
    const other = { ...legacySheet(), options: [{ name: "Something else" }] };
    const plan = planRepromotion(listing({ build_sheet: other }), [snap()]);
    expect(plan.outcome).toBe("sheet_conflict");
    expect(plan.next).toBeNull();
  });

  it("uses the latest usable snapshot and breaks time ties on id", () => {
    const older = snap({ id: "a", fetched_at: "2026-07-01T00:00:00.000Z" });
    const newer = snap({ id: "b", fetched_at: "2026-09-01T00:00:00.000Z" });
    const failed = snap({ id: "c", fetched_at: "2026-10-01T00:00:00.000Z", http_status: 500 });
    expect(pickSnapshot(VIN, [older, failed, newer]).snapshot!.id).toBe("b");
    expect(pickSnapshot(VIN, [snap({ id: "z" }), snap({ id: "y" })]).snapshot!.id).toBe("y");
  });

  it("reports no snapshot without inventing one", () => {
    expect(planRepromotion(listing({}), []).outcome).toBe("no_snapshot");
  });

  it("summarizes outcomes for the dry-run report", () => {
    const s = summarize([planRepromotion(listing({}), [snap()]), planRepromotion(listing({}), [])]);
    expect(s.outcomes).toEqual({ would_update: 1, no_snapshot: 1 });
  });
});

describe("re-promotion never creates a factory verification claim", () => {
  it("records which keys came from the cache", () => {
    const plan = planRepromotion(listing({ build_sheet: legacySheet() }), [snap()]);
    const rp = (plan.next!.build_sheet as Record<string, unknown>).repromoted_from as Record<string, unknown>;
    expect(rp.added_keys).toEqual(expect.arrayContaining(["build_sheet.taxonomy", "taxonomy"]));
    expect(rp.added_keys).not.toContain("build_sheet.repromoted_from");
  });

  it("keeps an undocumented partial_build_* source exactly as sent", () => {
    const plan = planRepromotion(listing({}), [snap({ payload: payload({ record_source: "partial_build_specs" }) })]);
    expect((plan.next!.taxonomy as Record<string, unknown>).record_source).toBe("partial_build_specs");
    expect(((plan.next!.build_sheet as Record<string, unknown>).taxonomy as Record<string, unknown>).record_source).toBe("partial_build_specs");
  });
});
