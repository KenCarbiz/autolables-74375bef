import { describe, it, expect } from "vitest";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { derivePassport } from "@/lib/passportV2Data";
import { resolveFuelEconomy } from "@/lib/passport/fuelEconomy";
import { normalizeForSticker } from "../factory-sticker-orchestrate/normalize.ts";
import { buildEpaSnapshot, mergeEpaSnapshot } from "./epaSnapshot.ts";
import { VERIFIED_MATCHERS } from "./epaMatch.ts";

const VIN = "5NMJBCDEXTH775352";
const NOV5 = {
  annualFuelCost: 2450, atvType: null, checkedAt: "2026-11-05T14:22:47.944Z", city: 24, co2TailpipeGpm: 337,
  combined: 26, fuelType: "Regular", ghgScore: 5, highway: 30, matchBasis: { candidates: 1 },
  matchedOption: "2026 Hyundai Tucson AWD — Auto (S8), 4 cyl, 2.5 L", matcherVersion: "epa-match-v3",
  rangeMiles: null, source: "fueleconomy.gov", vehicleId: 49500,
};
const nov7 = buildEpaSnapshot(
  { id: "49500", year: "2026", make: "Hyundai", model: "Tucson AWD", city08: "24", highway08: "30", comb08: "26", fuelCost08: "2400", youSaveSpend: "-1000", fuelType: "Regular", ghgScore: "5", co2TailpipeGpm: "337" },
  { listingVin: VIN, matchedOption: NOV5.matchedOption, matchBasis: null, matcherVersion: "epa-match-v4", retrievedAt: "2026-11-07T17:40:00.000Z" },
)!;

const listing = (epa: unknown, vin = VIN) => ({
  id: "l1", vin, ymm: "2026 Hyundai Tucson", trim: "SE AWD", condition: "new", mc_attributes: {}, epa_economy: epa,
}) as unknown as VehicleListing;

const sticker = (l: VehicleListing) => normalizeForSticker(l as unknown as Record<string, unknown>, {}, "https://autolabels.io/v/x", "t").data.epa;

describe("Passport V2 and the window sticker read one EPA snapshot", () => {
  it("both show the same annual cost and retrieval date for the stored production shape", () => {
    const l = listing(NOV5);
    const fuel = resolveFuelEconomy(derivePassport(l).epa);
    expect(fuel.annualFuelCost).toBe(2450);
    expect(sticker(l)?.annualFuelCost).toBe(2450);
    expect(fuel.retrievedAt).toBe(NOV5.checkedAt);
    expect(fuel.retrievedLabel).toBe("Retrieved Nov 5, 2026");
    expect(fuel.note).toContain("retrieved from fueleconomy.gov on Nov 5, 2026");
    expect(fuel.fiveYear).toBeNull();
  });

  it("after a refresh both move to the new snapshot together, with the provider's spend wording", () => {
    const l = listing(mergeEpaSnapshot(NOV5, nov7, VERIFIED_MATCHERS).record);
    const fuel = resolveFuelEconomy(derivePassport(l).epa);
    expect(fuel.annualFuelCost).toBe(2400);
    expect(sticker(l)?.annualFuelCost).toBe(2400);
    expect(fuel.fiveYear).toEqual({ difference: -1000, amount: 1000, direction: "spend" });
    expect(fuel.fiveYearSentence).toBe("You spend $1,000 more in fuel costs over 5 years compared to the average new vehicle.");
    expect(fuel.retrievedLabel).toBe("Retrieved Nov 7, 2026");
  });

  it("the approved masters get exactly the fields they had before, so their fingerprint only moves when a printed value does", () => {
    const before = sticker(listing(NOV5));
    expect(Object.keys(before!).sort()).toEqual(["annualFuelCost", "city", "combined", "fuelType", "gallonsPer100Miles", "ghgScore", "highway", "rangeMiles"]);
    expect(before).toEqual({ city: 24, highway: 30, combined: 26, annualFuelCost: 2450, ghgScore: 5, rangeMiles: null, fuelType: "Regular", gallonsPer100Miles: 3.8 });
    const confirmed = mergeEpaSnapshot(NOV5, { ...nov7, annualFuelCost: 2450, fiveYearCostDifference: null }, VERIFIED_MATCHERS).record;
    const reconfirmed = mergeEpaSnapshot(confirmed, { ...nov7, annualFuelCost: 2450, fiveYearCostDifference: null, checkedAt: "2026-12-07T04:45:00.000Z" }, VERIFIED_MATCHERS);
    expect(reconfirmed.outcome).toBe("confirmed");
    expect(sticker(listing(reconfirmed.record))).toEqual(before);
  });

  it("a snapshot taken for another VIN is shown on neither surface", () => {
    const l = listing(nov7, "5NMJBCDE0TH000000");
    expect(derivePassport(l).epa).toBeNull();
    expect(sticker(l)).toBeNull();
  });
});
