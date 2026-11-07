import { describe, it, expect } from "vitest";
import {
  buildEpaSnapshot, mergeEpaSnapshot, parseFuelPrices, readEpa, retireEpaRecord, snapshotListingMismatch,
  fiveYearSentence, formatEpaDate, type EpaSnapshot,
} from "./epaSnapshot.ts";
import { VERIFIED_MATCHERS } from "./epaMatch.ts";

const VIN = "5NMJBCDEXTH775352";

// The stored production row for this VIN (written Nov 5, 2026 by matcher v3), copied read-only.
const LEGACY = {
  annualFuelCost: 2450, atvType: null, checkedAt: "2026-11-05T14:22:47.944Z", city: 24, co2TailpipeGpm: 337,
  combined: 26, fuelType: "Regular", ghgScore: 5, highway: 30,
  matchBasis: { candidates: 1, drive: "4", liters: "2.5", matcher_version: "epa-match-v3", powertrain: "gas", record_powertrain: "gas" },
  matchedOption: "2026 Hyundai Tucson AWD — Auto (S8), 4 cyl, 2.5 L", matcherVersion: "epa-match-v3",
  rangeMiles: null, source: "fueleconomy.gov", vehicleId: 49500,
};

// Shape of a fueleconomy.gov /vehicle/{id} response (fields as strings, as the service sends them).
// The $2,400 / -$1,000 pair is what the public page showed the owner on Nov 7; the fuel
// prices are illustrative test values, not retrieved figures.
const response = (over: Record<string, unknown> = {}) => ({
  id: "49500", year: "2026", make: "Hyundai", model: "Tucson AWD", city08: "24", highway08: "30", comb08: "26",
  fuelCost08: "2400", youSaveSpend: "-1000", co2TailpipeGpm: "337", ghgScore: "5", fuelType: "Regular", atvType: "",
  ...over,
});

const prices = (regular: string, at: string) => parseFuelPrices({ regular, midgrade: "3.71", premium: "4.10", diesel: "3.75", electric: "0.17", e85: "2.79", cng: "2.95", lpg: "3.40" }, at);

const snap = (at: string, over: Record<string, unknown> = {}, fuel = prices("3.18", at)): EpaSnapshot => buildEpaSnapshot(response(over), {
  listingVin: VIN, matchedOption: LEGACY.matchedOption, matchBasis: LEGACY.matchBasis, matcherVersion: "epa-match-v4",
  retrievedAt: at, fuelPrices: fuel,
})!;

describe("snapshot from one fueleconomy.gov response", () => {
  it("captures fuelCost08 and youSaveSpend together with the retrieval time and cost basis", () => {
    const s = snap("2026-11-07T17:40:00.000Z");
    expect(s).toMatchObject({
      vehicleId: 49500, modelYear: 2026, listingVin: VIN, annualFuelCost: 2400, fiveYearCostDifference: -1000,
      city: 24, highway: 30, combined: 26, checkedAt: "2026-11-07T17:40:00.000Z",
    });
    expect(s.costBasis).toMatchObject({ annualMiles: 15000, cityPercent: 55 });
    expect(s.costBasis.fuelPrices?.regular).toBe(3.18);
  });

  it("keeps the provider's sign: negative spends more, positive saves, zero is the same", () => {
    const view = (v: string) => readEpa(snap("2026-11-07T17:40:00.000Z", { youSaveSpend: v }))!.fiveYear;
    expect(view("-1000")).toEqual({ difference: -1000, amount: 1000, direction: "spend" });
    expect(view("750")).toEqual({ difference: 750, amount: 750, direction: "save" });
    expect(view("0")).toEqual({ difference: 0, amount: 0, direction: "same" });
    expect(fiveYearSentence(view("-1000"))).toBe("You spend $1,000 more in fuel costs over 5 years compared to the average new vehicle.");
    expect(fiveYearSentence(view("750"))).toBe("You save $750 in fuel costs over 5 years compared to the average new vehicle.");
  });

  it("leaves a missing or malformed figure empty instead of guessing", () => {
    const s = snap("2026-11-07T17:40:00.000Z", { youSaveSpend: undefined, fuelCost08: "" });
    expect(s.fiveYearCostDifference).toBeNull();
    expect(s.annualFuelCost).toBeNull();
    expect(snap("2026-11-07T17:40:00.000Z", { youSaveSpend: "about -1000" }).fiveYearCostDifference).toBeNull();
    expect(buildEpaSnapshot(response({ id: "" }), { listingVin: VIN, matchedOption: "", matchBasis: null, matcherVersion: "v", retrievedAt: "2026-11-07T00:00:00Z" })).toBeNull();
    expect(parseFuelPrices({ unexpected: true }, "2026-11-07T00:00:00Z")).toBeNull();
  });

  it("drops fuel prices that were not published the same day as the vehicle record", () => {
    const s = snap("2026-11-07T17:40:00.000Z", {}, prices("3.18", "2026-11-06T23:59:00.000Z"));
    expect(s.costBasis.fuelPrices).toBeNull();
  });
});

describe("strict matching", () => {
  it("refuses a record for another VIN or model year", () => {
    const s = snap("2026-11-07T17:40:00.000Z");
    expect(snapshotListingMismatch(s, { vin: VIN, year: "2026" })).toBeNull();
    expect(snapshotListingMismatch(s, { vin: "5NMJBCDE0TH000000", year: "2026" })).toBe("vin_mismatch");
    expect(snapshotListingMismatch(s, { vin: VIN, year: "2025" })).toBe("model_year_mismatch");
    expect(snapshotListingMismatch(snap("2026-11-07T17:40:00.000Z", { year: "" }), { vin: VIN, year: "2026" })).toBe("model_year_missing");
  });

  it("readers reject a stored snapshot for another VIN or year", () => {
    const s = snap("2026-11-07T17:40:00.000Z");
    expect(readEpa(s, { vin: VIN, year: 2026 })).not.toBeNull();
    expect(readEpa(s, { vin: "5NMJBCDE0TH000000", year: 2026 })).toBeNull();
    expect(readEpa(s, { vin: VIN, year: 2025 })).toBeNull();
  });

  it("a different EPA vehicle id never replaces a verified match", () => {
    const m = mergeEpaSnapshot(LEGACY, snap("2026-11-07T17:40:00.000Z", { id: "49501" }), VERIFIED_MATCHERS);
    expect(m.outcome).toBe("conflict");
    expect(m.reason).toBe("vehicle_id_changed");
    expect(m.record.annualFuelCost).toBe(2450);
    expect(m.record.vehicleId).toBe(49500);
    expect(m.record.lastConflict).toMatchObject({ vehicleId: 49501 });
    expect(readEpa(m.record)!.annualFuelCost).toBe(2450);
  });
});

describe("history", () => {
  it("keeps the November 5 production record intact when fuel prices change the cost", () => {
    const next = snap("2026-11-07T17:40:00.000Z");
    const m = mergeEpaSnapshot(LEGACY, next, VERIFIED_MATCHERS);
    expect(m.outcome).toBe("replaced");
    expect(m.record.annualFuelCost).toBe(2400);
    expect(m.record.fiveYearCostDifference).toBe(-1000);
    expect(m.record.history).toHaveLength(1);
    expect(m.record.history![0]).toMatchObject({ ...LEGACY, schema: 1, supersededAt: next.checkedAt });
  });

  it("each later price change adds one entry and never edits an earlier one", () => {
    const a = mergeEpaSnapshot(LEGACY, snap("2026-11-07T17:40:00.000Z"), VERIFIED_MATCHERS).record;
    const b = mergeEpaSnapshot(a, snap("2026-12-07T04:45:00.000Z", { fuelCost08: "2300", youSaveSpend: "-500" }, prices("3.02", "2026-12-07T04:45:00.000Z")), VERIFIED_MATCHERS).record;
    expect(b.annualFuelCost).toBe(2300);
    expect(b.history!.map((h) => [h.checkedAt, h.annualFuelCost, h.fiveYearCostDifference ?? null])).toEqual([
      ["2026-11-07T17:40:00.000Z", 2400, -1000],
      ["2026-11-05T14:22:47.944Z", 2450, null],
    ]);
  });

  it("a duplicate refresh confirms the snapshot without a new history entry", () => {
    const a = mergeEpaSnapshot(LEGACY, snap("2026-11-07T17:40:00.000Z"), VERIFIED_MATCHERS).record;
    const m = mergeEpaSnapshot(a, snap("2026-11-07T18:10:00.000Z", {}, prices("3.18", "2026-11-07T18:10:00.000Z")), VERIFIED_MATCHERS);
    expect(m.outcome).toBe("confirmed");
    expect(m.record.checkedAt).toBe("2026-11-07T17:40:00.000Z");
    expect(m.record.confirmedAt).toBe("2026-11-07T18:10:00.000Z");
    expect(m.record.history).toHaveLength(1);
    expect(readEpa(m.record)!.retrievedAt).toBe("2026-11-07T18:10:00.000Z");
  });

  it("an out-of-order or repeated retrieval changes nothing", () => {
    const a = mergeEpaSnapshot(LEGACY, snap("2026-11-07T17:40:00.000Z"), VERIFIED_MATCHERS).record;
    expect(mergeEpaSnapshot(a, snap("2026-11-07T17:40:00.000Z"), VERIFIED_MATCHERS)).toMatchObject({ outcome: "stale", record: a });
    expect(mergeEpaSnapshot(a, snap("2026-11-06T09:00:00.000Z", { fuelCost08: "2500" }), VERIFIED_MATCHERS)).toMatchObject({ outcome: "stale", record: a });
  });

  it("the same costs at different published fuel prices are a new snapshot", () => {
    const a = mergeEpaSnapshot(null, snap("2026-11-07T17:40:00.000Z"), VERIFIED_MATCHERS).record;
    const m = mergeEpaSnapshot(a, snap("2026-11-08T04:45:00.000Z", {}, prices("3.19", "2026-11-08T04:45:00.000Z")), VERIFIED_MATCHERS);
    expect(m.outcome).toBe("replaced");
    expect(m.record.history).toHaveLength(1);
  });

  it("a refusal retires the record into history instead of deleting it", () => {
    const r = retireEpaRecord(LEGACY, "ambiguous", "2026-11-08T04:45:00.000Z")!;
    expect(r.status).toBe("retired");
    expect(r.history![0]).toMatchObject({ vehicleId: 49500, annualFuelCost: 2450 });
    expect(readEpa(r)).toBeNull();
    const back = mergeEpaSnapshot(r, snap("2026-11-09T04:45:00.000Z"), VERIFIED_MATCHERS);
    expect(back.outcome).toBe("replaced");
    expect(back.record.history).toHaveLength(1);
  });
});

describe("the single reader", () => {
  it("reads the existing production shape unchanged, dated by its own retrieval", () => {
    const v = readEpa(LEGACY, { vin: VIN, year: 2026 })!;
    expect(v).toMatchObject({ vehicleId: 49500, combined: 26, annualFuelCost: 2450, fiveYear: null, retrievedAt: LEGACY.checkedAt });
    expect(formatEpaDate(v.retrievedAt)).toBe("Nov 5, 2026");
  });

  it("never pairs the current cost with a five-year figure from another retrieval", () => {
    const current = { ...LEGACY, history: [{ ...LEGACY, annualFuelCost: 2400, fiveYearCostDifference: -1000, checkedAt: "2026-11-07T17:40:00.000Z", supersededAt: "x" }] };
    const v = readEpa(current)!;
    expect(v.annualFuelCost).toBe(2450);
    expect(v.fiveYear).toBeNull();
    expect(v.retrievedAt).toBe(LEGACY.checkedAt);
  });

  it("withholds undated cost figures but keeps MPG", () => {
    const { checkedAt: _c, ...undated } = LEGACY;
    const v = readEpa({ ...undated, fiveYearCostDifference: -1000 })!;
    expect(v.combined).toBe(26);
    expect(v.annualFuelCost).toBeNull();
    expect(v.fiveYear).toBeNull();
    expect(v.retrievedAt).toBeNull();
  });

  it("returns nothing for missing, errored or retired data", () => {
    expect(readEpa(null)).toBeNull();
    expect(readEpa({ error: "no_match" })).toBeNull();
    expect(readEpa({ status: "retired", history: [LEGACY] })).toBeNull();
  });
});
