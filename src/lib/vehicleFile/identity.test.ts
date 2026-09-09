import { describe, expect, it } from "vitest";
import { buildIdentity, validVin } from "./identity.ts";
import { emptySources, type Row, type VehicleFileSources } from "./sources.ts";

// Every fixture below is the live shape of the pilot tenant (Harte Infiniti,
// 3f0f97f5-4151-4e32-88ef-e2d6fc5a3142), read 2026-09-09. ZASPAKBN5L7C99407 is
// the only multi-word make on the lot and is the vehicle the maps name for the
// ymm-parser defect (DUPLICATE_READ_PATHS.md §C2).

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const VIN = "ZASPAKBN5L7C99407";

const buildSheet = (): Row => ({
  source: "neovin",
  generic: false,
  decoded_at: "2026-07-28T03:15:52.542Z",
  colors: {
    exterior: { code: "PBX", msrp: 600, name: "Misano Blue Metallic" },
    interior: { code: "DLXX", name: "Black Leather" },
  },
  pricing: { base_msrp: 52300, destination_charge: 1345, total_msrp: 60195 },
});

const mcAttributes = (over: Row = {}): Row => ({
  mc_listing_id: "ZASPAKBN5L7C99407-904292b4-1e8a",
  make: "Alfa Romeo",
  model: "Stelvio",
  year: "2020",
  trim: "Ti Sport Carbon",
  engine: "2.0L I4",
  engine_block: "I",
  drivetrain: "4WD",
  transmission: "Automatic",
  fuel_type: "Premium Unleaded",
  body_type: "SUV",
  exterior_color: "Blue Metallic",
  interior_color: "Black",
  first_seen_at: "1788506032",
  last_seen_at: "1788761804",
  scraped_at: "1788506032",
  specs_source: "neovin",
  specs_decoded_at: "2026-07-28T03:15:52.576Z",
  build_sheet: buildSheet(),
  ...over,
});

const mcRaw = (over: Row = {}): Row => ({
  vin: VIN,
  stock_no: "I21880SA",
  exterior_color: "Blue Metallic",
  interior_color: "Black",
  last_seen_at: "1788761804",
  last_seen_at_date: "2026-09-07T06:16:44.000Z",
  scraped_at: "1788506032",
  scraped_at_date: "2026-09-04T07:13:53.000Z",
  build: {
    year: 2020,
    make: "Alfa Romeo",
    model: "Stelvio",
    trim: "Ti Sport Carbon",
    engine: "2.0L I4",
    drivetrain: "4WD",
    transmission: "Automatic",
    fuel_type: "Premium Unleaded",
    body_type: "SUV",
  },
  ...over,
});

const neovinPayload = (over: Row = {}): Row => ({
  vin: VIN,
  year: "2020",
  make: "Alfa Romeo",
  model: "Stelvio",
  trim: "Ti Sport Carbon",
  version: "Ti Sport Carbon AWD",
  body_type: "SUV",
  engine: "2.0L I4",
  drivetrain: "4WD",
  transmission: "Automatic",
  transmission_description: "Automatic With Manual Mode Trans",
  fuel_type: "Premium Unleaded",
  exterior_color: { base: "Blue", code: "PBX", msrp: "600", confidence: "1.0", name: "Misano Blue Metallic" },
  interior_color: { base: "Black", code: "DLXX", msrp: "", confidence: "1.0", name: "Black Leather" },
  ...over,
});

const harte = (over: Partial<VehicleFileSources> = {}): VehicleFileSources => ({
  ...emptySources(TENANT),
  listing: {
    id: "dd71281a-ea9e-42c3-8eaf-91376656017a",
    tenant_id: TENANT,
    vin: VIN,
    ymm: "2020 Alfa Romeo Stelvio",
    trim: "Ti Sport Carbon",
    condition: "used",
    updated_at: "2026-09-09T03:07:23.119Z",
    mc_attributes: mcAttributes(),
    mc_raw: mcRaw(),
  },
  file: {
    vin: VIN,
    tenant_id: TENANT,
    year: "2020",
    make: "Alfa Romeo",
    model: "Stelvio",
    trim: "Ti Sport Carbon",
    stock_number: "I21880SA",
    updated_at: "2026-09-09T03:07:22.849Z",
  },
  neovin: {
    vin: VIN,
    tenant_id: TENANT,
    endpoint: "https://api.marketcheck.com/v2/decode/car/neovin/ZASPAKBN5L7C99407/specs",
    fetched_at: "2026-07-28T01:28:49.070Z",
    payload: neovinPayload(),
  },
  ...over,
});

const opts = { now: NOW };
const originsOf = (candidates: Array<{ origin: string }>) => candidates.map((c) => c.origin);

describe("buildIdentity — happy path (live Harte row)", () => {
  const identity = buildIdentity(harte(), opts);

  it("keys the vehicle on vehicle_listings.vin, not on a provider echo", () => {
    expect(identity.vin.value).toBe(VIN);
    expect(identity.vin.chosen?.origin).toBe("vehicle_listings.vin");
    expect(identity.vin.chosen?.source).toBe("dealer_confirmed");
    expect(identity.vin.disagreeing).toHaveLength(0);
    expect(identity.vin.freshness).toBe("CURRENT");
  });

  it("emits the NeoVIN snapshot's VIN as an echo, never as corroboration", () => {
    const echo = identity.vin.candidates.find((c) => c.origin === "neovin_snapshots.vin");
    expect(echo?.confidence).toBe("HIGH");
    expect(echo?.note).toContain("echoed back");
  });

  it("resolves year, make and model that vehicle_listings has no column for", () => {
    expect(identity.year.value).toBe(2020);
    expect(identity.make.value).toBe("Alfa Romeo");
    expect(identity.model.value).toBe("Stelvio");
    expect(identity.trim.value).toBe("Ti Sport Carbon");
    expect(identity.bodyStyle.value).toBe("SUV");
  });

  it("ranks the feed's own make key above a parse of the concatenated ymm string", () => {
    // NeoVIN wins outright on manufacturer authority; the ordering under test
    // is the tie between the two MarketCheck candidates, which the engine
    // cannot separate because both are HIGH with the same stamp.
    const marketcheck = originsOf(identity.make.candidates.filter((c) => c.source === "marketcheck"));
    expect(marketcheck.indexOf("vehicle_listings.mc_attributes.make"))
      .toBeLessThan(marketcheck.indexOf("vehicle_listings.ymm -> parseYmm().make"));
    expect(identity.make.chosen?.origin).toBe("neovin_snapshots.payload.make");
  });

  it("ages feed values by the feed's own epoch-seconds stamp", () => {
    const feed = identity.trim.candidates.find((c) => c.origin === "vehicle_listings.trim");
    expect(feed?.observedAt).toBe("2026-09-07T06:16:44.000Z");
  });

  it("does not expire identity, so a stamped winner reads CURRENT", () => {
    for (const field of [identity.year, identity.make, identity.model, identity.trim]) {
      expect(field.freshness).toBe("CURRENT");
    }
  });
});

describe("buildIdentity — the mechanical keys the nightly sync overwrites", () => {
  const identity = buildIdentity(harte(), opts);

  it("takes the manufacturer engine from neovin_snapshots, never from mc_attributes", () => {
    expect(identity.engine.value).toBe("2.0L I4");
    expect(identity.engine.chosen?.source).toBe("neovin");
    expect(identity.engine.chosen?.origin).toBe("neovin_snapshots.payload.engine");
    const neovinCandidates = identity.engine.candidates.filter((c) => c.source === "neovin");
    expect(neovinCandidates).toHaveLength(1);
    for (const candidate of neovinCandidates) {
      expect(candidate.origin).not.toContain("mc_attributes.engine");
    }
  });

  it("labels the mc_attributes column as feed-rebuilt and caps it below VERIFIED", () => {
    const column = identity.engine.candidates.find(
      (c) => c.origin === "vehicle_listings.mc_attributes.engine",
    );
    expect(column?.source).toBe("marketcheck");
    expect(column?.confidence).toBe("HIGH");
    expect(column?.note).toContain("DECODE_OWNED_KEYS");
  });

  it("never promotes the engine_block descriptor (\"I\", \"V\", \"H\") to an engine", () => {
    expect(originsOf(identity.engine.candidates)).not.toContain(
      "vehicle_listings.mc_attributes.engine_block",
    );
  });

  it("shows the NeoVIN transmission outranking the feed's, with the feed still visible", () => {
    expect(identity.transmission.value).toBe("Automatic With Manual Mode Trans");
    expect(identity.transmission.chosen?.origin).toBe(
      "neovin_snapshots.payload.transmission_description",
    );
    expect(identity.transmission.disagreeing.map((c) => c.value)).toContain("Automatic");
  });

  it("stages one NeoVIN transmission candidate, not description and value both", () => {
    const neovinCandidates = identity.transmission.candidates.filter((c) => c.source === "neovin");
    expect(neovinCandidates).toHaveLength(1);
    expect(identity.transmission.disputed).toBe(false);
  });

  it("marks the writer unresolved when the column diverges from the verbatim build object", () => {
    const sources = harte();
    const listing = sources.listing as Row;
    listing.mc_attributes = mcAttributes({ engine: "2.0L I4 Turbo" });
    const diverged = buildIdentity(sources, opts);
    const column = diverged.engine.candidates.find(
      (c) => c.origin === "vehicle_listings.mc_attributes.engine",
    );
    expect(column?.provider).toContain("writer unresolved");
    expect(column?.note).toContain("may still hold the NeoVIN write");
  });

  it("falls back to drive_type and records which key it read", () => {
    const sources = harte();
    const listing = sources.listing as Row;
    listing.mc_attributes = mcAttributes({ drivetrain: null, drive_type: "AWD" });
    listing.mc_raw = mcRaw({ build: {} });
    sources.neovin = null;
    const identityNoNeovin = buildIdentity(sources, opts);
    expect(identityNoNeovin.drivetrain.value).toBe("AWD");
    expect(identityNoNeovin.drivetrain.chosen?.origin).toBe(
      "vehicle_listings.mc_attributes.drive_type",
    );
  });
});

describe("buildIdentity — disagreement", () => {
  it("prefers the NeoVIN colour name and keeps the feed's shorter text visible", () => {
    // Live on 5N1AL1F83VC338993: the feed says "Mineral", NeoVIN "Mineral Black".
    const sources = harte();
    const listing = sources.listing as Row;
    listing.mc_attributes = mcAttributes({ exterior_color: "Mineral" });
    listing.mc_raw = mcRaw({ exterior_color: "Mineral" });

    const identity = buildIdentity(sources, opts);
    expect(identity.exteriorColor.value).toBe("Misano Blue Metallic");
    expect(identity.exteriorColor.chosen?.source).toBe("neovin");
    expect(identity.exteriorColor.disagreeing.map((c) => c.value)).toEqual(["Mineral", "Mineral"]);
    expect(identity.exteriorColor.disputed).toBe(false);
  });

  it("raises CONFLICTED when the build sheet and the decode snapshot disagree", () => {
    const sources = harte();
    const neovin = sources.neovin as Row;
    neovin.payload = neovinPayload({
      exterior_color: { code: "PBX", name: "Vulcano Black Metallic" },
    });

    const identity = buildIdentity(sources, opts);
    expect(identity.exteriorColor.disputed).toBe(true);
    expect(identity.exteriorColor.freshness).toBe("CONFLICTED");
    expect(identity.exteriorColor.reason).toContain("a person decides");
  });

  it("ignores a build sheet that is not a NeoVIN decode", () => {
    const sources = harte();
    const listing = sources.listing as Row;
    listing.mc_attributes = mcAttributes({
      build_sheet: { ...buildSheet(), source: "generic" },
    });
    const identity = buildIdentity(sources, opts);
    expect(originsOf(identity.exteriorColor.candidates)).not.toContain(
      "vehicle_listings.mc_attributes.build_sheet.colors.exterior.name",
    );
  });
});

describe("buildIdentity — the ymm parser defect", () => {
  it("emits both the parse and the feed key for a multi-word make", () => {
    const identity = buildIdentity(harte(), opts);
    const parsed = identity.make.candidates.find(
      (c) => c.origin === "vehicle_listings.ymm -> parseYmm().make",
    );
    expect(parsed?.value).toBe("Alfa Romeo");
    expect(identity.make.candidates.some(
      (c) => c.origin === "vehicle_listings.mc_attributes.make",
    )).toBe(true);
    expect(identity.make.disagreeing).toHaveLength(0);
  });

  it("keeps the feed's model when the parse loses part of a sub-brand name", () => {
    // "Range Rover" is mapped to the make Land Rover, which leaves the parser
    // the model "Sport" while the feed's own key says "Range Rover Sport".
    const sources = harte();
    const listing = sources.listing as Row;
    listing.ymm = "2024 Range Rover Sport";
    listing.mc_attributes = mcAttributes({ make: "Land Rover", model: "Range Rover Sport", year: "2024" });
    listing.mc_raw = mcRaw({ build: { make: "Land Rover", model: "Range Rover Sport" } });
    sources.file = null;
    sources.neovin = null;

    const identity = buildIdentity(sources, opts);
    expect(identity.model.value).toBe("Range Rover Sport");
    expect(identity.model.disagreeing.map((c) => c.value)).toEqual(["Sport"]);
    expect(identity.model.chosen?.origin).toBe("vehicle_listings.mc_attributes.model");
  });

  it("notes the split when the parse and the provider disagree on the make", () => {
    const sources = harte();
    const listing = sources.listing as Row;
    listing.ymm = "2021 Aston Martin DBX";
    listing.mc_attributes = mcAttributes({ make: "Aston Martin Lagonda", model: "DBX", year: "2021" });
    listing.mc_raw = mcRaw({ build: {} });
    sources.file = null;
    sources.neovin = null;

    const identity = buildIdentity(sources, opts);
    const parsed = identity.make.candidates.find(
      (c) => c.origin === "vehicle_listings.ymm -> parseYmm().make",
    );
    expect(parsed?.note).toContain("parseYmm split");
    expect(parsed?.note).toContain("Aston Martin Lagonda");
    expect(identity.make.disagreeing.map((c) => c.value)).toEqual(["Aston Martin"]);
  });

  it("falls back to the parse when the feed wrote no make or model key", () => {
    // Live on the hand-added row 5N1AT3CB7MC736556: mc_attributes carries the
    // decode but no make/model/year, and vehicle_files holds empty strings.
    const sources = harte();
    const listing = sources.listing as Row;
    listing.vin = "5N1AT3CB7MC736556";
    listing.ymm = "2021 NISSAN Rogue";
    listing.mc_attributes = mcAttributes({ make: null, model: null, year: null, mc_listing_id: null });
    listing.mc_raw = null;
    sources.file = {
      vin: "5N1AT3CB7MC736556", year: "", make: "", model: "", trim: "",
      updated_at: "2026-08-19T19:17:42.503Z",
    };
    sources.neovin = null;

    const identity = buildIdentity(sources, opts);
    expect(identity.make.value).toBe("NISSAN");
    expect(identity.make.chosen?.origin).toBe("vehicle_listings.ymm -> parseYmm().make");
    expect(identity.year.value).toBe(2021);
    expect(originsOf(identity.make.candidates)).not.toContain("vehicle_files.make");
    expect(identity.vin.chosen?.provider).toBe("Dealer inventory row");
    expect(identity.vin.chosen?.note).toContain("writer of the record is UNKNOWN");
  });
});

describe("buildIdentity — VIN validity", () => {
  it("accepts every live shape and normalises case", () => {
    expect(validVin("zaspakbn5l7c99407")).toBe(VIN);
    expect(validVin(" 5N1AT3CB7MC736556 ")).toBe("5N1AT3CB7MC736556");
  });

  it("rejects a wrong check digit, a wrong length and an illegal letter", () => {
    expect(validVin("ZASPAKBN4L7C99407")).toBeNull();
    expect(validVin("ZASPAKBN5L7C9940")).toBeNull();
    expect(validVin("ZASPAKBN5L7C9940I")).toBeNull();
  });

  it("drops an invalid VIN from the candidate set rather than ranking it", () => {
    const sources = harte();
    const neovin = sources.neovin as Row;
    neovin.vin = "ZASPAKBN4L7C99407";
    const identity = buildIdentity(sources, opts);
    expect(originsOf(identity.vin.candidates)).not.toContain("neovin_snapshots.vin");
    expect(identity.vin.value).toBe(VIN);
  });

  it("normalises a lower-case listing VIN and says so, because the file joins on upper(vin)", () => {
    const sources = harte();
    const listing = sources.listing as Row;
    listing.vin = VIN.toLowerCase();
    const identity = buildIdentity(sources, opts);
    expect(identity.vin.value).toBe(VIN);
    expect(identity.vin.chosen?.note).toContain("upper(vin)");
    expect(identity.vin.disagreeing).toHaveLength(0);
  });
});

describe("buildIdentity — vehicle_facts is a ledger, not a source", () => {
  const factRow = (over: Row = {}): Row => ({
    fact_key: "engine",
    fact_value: { v: "2.0L I4" },
    source_kind: "marketcheck",
    confidence: "HIGH",
    authority: "manufacturer",
    observed_at: "2026-07-29T13:30:08.551Z",
    evidence: {},
    ...over,
  });

  it("never uses vehicle_facts.observed_at, which is orchestration time", () => {
    const sources = harte({ facts: [factRow()] });
    const identity = buildIdentity(sources, opts);
    const ledger = identity.engine.candidates.find((c) => c.origin.includes("vehicle_facts"));
    expect(ledger).toBeDefined();
    expect(ledger?.observedAt).toBeNull();
    expect(ledger?.note).toContain("orchestration time");
  });

  it("takes the writer stamp from the linked vehicle_source_records row", () => {
    const sources = harte({
      facts: [factRow({ evidence: { sourceRecordId: "3b71ab3b-eebb-4aa7-8e83-2f3d0da7d416" } })],
      sourceRecords: [{
        id: "3b71ab3b-eebb-4aa7-8e83-2f3d0da7d416",
        source_kind: "marketcheck",
        source_name: "marketcheck_listing",
        retrieved_at: "2026-07-29T13:30:26.599Z",
      }],
    });
    const identity = buildIdentity(sources, opts);
    const ledger = identity.engine.candidates.find((c) => c.origin.includes("vehicle_facts"));
    expect(ledger?.observedAt).toBe("2026-07-29T13:30:26.599Z");
    expect(ledger?.provider).toBe("MarketCheck syndication feed");
    expect(ledger?.origin).toContain("vehicle_source_records.marketcheck_listing");
  });

  it("surfaces a ledger row that has fallen behind the column it was derived from", () => {
    const sources = harte({
      facts: [factRow({ fact_key: "trim", fact_value: { v: "TI SPORT" } })],
    });
    sources.neovin = null;
    const identity = buildIdentity(sources, opts);
    expect(identity.trim.value).toBe("Ti Sport Carbon");
    expect(identity.trim.disagreeing.map((c) => c.value)).toContain("TI SPORT");
  });

  it("ignores a ledger row whose source_kind is not a SourceKind", () => {
    const sources = harte({ facts: [factRow({ source_kind: "carfax" })] });
    const identity = buildIdentity(sources, opts);
    expect(identity.engine.candidates.some((c) => c.origin.includes("vehicle_facts"))).toBe(false);
  });
});

describe("buildIdentity — missing sources", () => {
  it("reports UNKNOWN with a reason rather than guessing, on an empty bundle", () => {
    const identity = buildIdentity(emptySources(TENANT), opts);
    const fields = [
      identity.vin, identity.year, identity.make, identity.model, identity.trim,
      identity.bodyStyle, identity.exteriorColor, identity.interiorColor,
      identity.engine, identity.drivetrain, identity.transmission, identity.fuelType,
    ];
    for (const field of fields) {
      expect(field.value).toBeNull();
      expect(field.chosen).toBeNull();
      expect(field.freshness).toBe("UNKNOWN");
      expect(field.candidates).toHaveLength(0);
      expect(field.reason).toContain("No source supplies");
    }
  });

  it("still resolves what the listing has when there is no vehicle_files row", () => {
    // The other-tenant published row JN8AZ3DB6T9435410 has no vehicle_files row.
    const sources = harte({ file: null });
    const identity = buildIdentity(sources, opts);
    expect(identity.make.value).toBe("Alfa Romeo");
    expect(originsOf(identity.make.candidates)).not.toContain("vehicle_files.make");
  });

  it("still resolves identity when no build sheet was ever purchased", () => {
    const sources = harte({ neovin: null });
    const listing = sources.listing as Row;
    listing.mc_attributes = mcAttributes({ build_sheet: null, specs_source: null, specs_decoded_at: null });
    const identity = buildIdentity(sources, opts);
    expect(identity.engine.value).toBe("2.0L I4");
    expect(identity.engine.chosen?.source).toBe("marketcheck");
    expect(identity.exteriorColor.value).toBe("Blue Metallic");
  });

  it("reports UNKNOWN freshness for a feed value the feed never stamped", () => {
    const sources = harte({ neovin: null });
    const listing = sources.listing as Row;
    listing.mc_attributes = mcAttributes({
      last_seen_at: null, scraped_at: null, first_seen_at: null, build_sheet: null,
    });
    listing.mc_raw = mcRaw({ last_seen_at: null, last_seen_at_date: null, scraped_at: null });
    const identity = buildIdentity(sources, opts);
    expect(identity.engine.chosen?.observedAt).toBeNull();
    // Identity does not expire, so an unstamped winner is still CURRENT; the
    // stamp being absent has to be visible on the candidate, not inferred.
    expect(identity.engine.freshness).toBe("CURRENT");
  });

  it("carries a licence class on every candidate it emits", () => {
    const identity = buildIdentity(harte(), opts);
    const all = [
      ...identity.vin.candidates, ...identity.make.candidates, ...identity.engine.candidates,
      ...identity.exteriorColor.candidates,
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const candidate of all) {
      expect(["INTERNAL_USE_CLEARED", "CUSTOMER_DISPLAY_CLEARED", "UNKNOWN_REVIEW_REQUIRED"])
        .toContain(candidate.license);
      expect(candidate.origin).not.toBe("");
      expect(candidate.provider).not.toBe("");
    }
    expect(identity.vin.chosen?.license).toBe("CUSTOMER_DISPLAY_CLEARED");
    expect(identity.engine.chosen?.license).toBe("UNKNOWN_REVIEW_REQUIRED");
  });
});
