import { describe, expect, it } from "vitest";
import {
  buildSheetSource,
  candidatesFromDealerEdits,
  candidatesFromListing,
  type TruthListingRow,
} from "./ingest";
import { buildVehicleSnapshot } from "./snapshot";

const find = (list: ReturnType<typeof candidatesFromListing>, key: string) =>
  list.filter((c) => c.factKey === key);

const listing = (over: Partial<TruthListingRow> = {}): TruthListingRow => ({
  id: "veh-1",
  vin: "3PCAJ5BB1PF113139",
  ymm: "2023 INFINITI QX50",
  trim: "SENSORY AWD",
  condition: "used",
  mileage: 13127,
  price: 41995,
  mc_attributes: {},
  ...over,
});

const neovinSheet = {
  specs_source: "neovin",
  base_msrp: 47595,
  delivery_charges: 1195,
  total_msrp: 52785,
  build_sheet: {
    source: "neovin",
    manufacturer: "Nissan Motor Corporation",
    packages: [{ name: "SENSORY PACKAGE", msrp: 3200, contents: ["Bose Audio"] }],
    options: [{ name: "Illuminated Kick Plates", msrp: 495 }],
    key_features: { Interior: ["Leather Seats"], Safety: [{ name: "ProPILOT Assist" }] },
  },
};

describe("build sheet classification", () => {
  it("treats a NeoVIN sheet as manufacturer data", () => {
    expect(buildSheetSource(neovinSheet)).toBe("neovin");
  });

  it("demotes a generic configuration match", () => {
    expect(buildSheetSource({ ...neovinSheet, build_sheet: { ...neovinSheet.build_sheet, generic: true } }))
      .toBe("other_structured");
  });

  it("reports nothing when no sheet was purchased", () => {
    expect(buildSheetSource({ base_msrp: 47595 })).toBeNull();
  });
});

describe("candidates from a stored listing", () => {
  it("parses a multi-word make instead of splitting on whitespace", () => {
    // The defect that made every Land Rover resolve to the make "Land"
    // and fall back to the neutral template.
    const c = candidatesFromListing(listing({ ymm: "2024 Land Rover Defender 110" }));
    expect(find(c, "make")[0].value).toBe("Land Rover");
    expect(find(c, "model")[0].value).toBe("Defender 110");
  });

  it("attributes dealer columns to the dealer", () => {
    const c = candidatesFromListing(listing());
    for (const key of ["mileage", "advertised_price", "condition"]) {
      expect(find(c, key)[0].source, key).toBe("dealer_confirmed");
    }
  });

  it("never emits a manufacturer fact without a build sheet", () => {
    const c = candidatesFromListing(listing({ mc_attributes: { base_msrp: 47595, msrp: 47595 } }));
    expect(find(c, "base_msrp")).toEqual([]);
    expect(find(c, "total_msrp")).toEqual([]);
    expect(find(c, "manufacturer")).toEqual([]);
  });

  it("emits manufacturer pricing only alongside a real build sheet", () => {
    const c = candidatesFromListing(listing({ mc_attributes: neovinSheet }));
    const msrp = find(c, "base_msrp")[0];
    expect(msrp.value).toBe(47595);
    expect(msrp.source).toBe("neovin");
    expect(msrp.confidence).toBe("VERIFIED");
    expect(find(c, "total_msrp")[0].value).toBe(52785);
    expect(find(c, "factory_options_total")[0].value).toBe(3695);
  });

  it("caps a generic match below verified", () => {
    const generic = { ...neovinSheet, build_sheet: { ...neovinSheet.build_sheet, generic: true } };
    const c = candidatesFromListing(listing({ mc_attributes: generic }));
    expect(find(c, "base_msrp")[0].source).toBe("other_structured");
    expect(find(c, "base_msrp")[0].confidence).toBe("MEDIUM");
  });

  it("collects packages, options and standard equipment from the sheet", () => {
    const c = candidatesFromListing(listing({ mc_attributes: neovinSheet }));
    expect(find(c, "factory_packages")[0].value).toEqual(["SENSORY PACKAGE"]);
    expect(find(c, "factory_options")[0].value).toEqual(["Illuminated Kick Plates"]);
    expect(find(c, "standard_equipment")[0].value).toEqual(["Leather Seats", "ProPILOT Assist"]);
    expect(find(c, "standard_equipment")[0].source).toBe("neovin");
  });

  it("keeps feed feature text as a feed claim, not a manufacturer statement", () => {
    const c = candidatesFromListing(listing({ mc_attributes: { features: ["Sunroof"] } }));
    const std = find(c, "standard_equipment")[0];
    expect(std.source).toBe("marketcheck");
    expect(std.confidence).toBe("HIGH");
  });

  it("drops empty and absent values rather than emitting blank facts", () => {
    const c = candidatesFromListing({ id: "v", vin: "1", ymm: null, mc_attributes: {} });
    expect(c.filter((x) => x.value === "" || x.value === null)).toEqual([]);
  });

  it("carries lineage onto every fact it can", () => {
    const c = candidatesFromListing(listing({ mc_attributes: neovinSheet }), {
      retrievedAt: "2026-07-20T00:00:00Z",
      sourceRecordIds: { neovin: "src-neo", marketcheck: "src-mc", dealer_confirmed: "src-dealer" },
    });
    expect(find(c, "base_msrp")[0].sourceRecordId).toBe("src-neo");
    expect(find(c, "trim")[0].sourceRecordId).toBe("src-mc");
    expect(find(c, "mileage")[0].sourceRecordId).toBe("src-dealer");
  });
});

describe("dealer edits", () => {
  it("wins on the dealer's own stock number and loses on MSRP", () => {
    const provider = candidatesFromListing(listing({ mc_attributes: neovinSheet }));
    const edits = candidatesFromDealerEdits(
      { stock_number: "IN12567", base_msrp: 45000 },
      "2026-07-27T00:00:00Z",
    );
    const { snapshot, conflicts } = buildVehicleSnapshot("3PCAJ5BB1PF113139", [...provider, ...edits]);
    expect(snapshot.identity.stockNumber).toBe("IN12567");
    expect(snapshot.pricing.baseMsrp).toBe(47595);
    expect(conflicts.map((c) => c.factKey)).toEqual(["base_msrp"]);
    expect(conflicts[0].blocksGeneration).toBe(true);
  });

  it("ignores blank edits", () => {
    expect(candidatesFromDealerEdits({ trim: "", mileage: null }, "2026-07-27T00:00:00Z")).toEqual([]);
  });
});

describe("end to end from a stored row", () => {
  it("produces one resolved vehicle every generator can read", () => {
    const { snapshot, facts } = buildVehicleSnapshot(
      "3PCAJ5BB1PF113139",
      candidatesFromListing(listing({ mc_attributes: neovinSheet })),
    );
    expect(snapshot.identity).toMatchObject({
      manufacturer: "Nissan Motor Corporation",
      make: "INFINITI",
      model: "QX50",
      modelYear: 2023,
      trim: "SENSORY AWD",
    });
    expect(snapshot.pricing).toMatchObject({ baseMsrp: 47595, destinationCharge: 1195, totalMsrp: 52785 });
    expect(snapshot.condition).toBe("used");
    expect(snapshot.mileage).toBe(13127);
    expect(facts.base_msrp.status).toBe("verified");
    expect(facts.advertised_price.status).toBe("dealer_entered");
    expect(facts.make.status).toBe("feed_provided");
  });
});
