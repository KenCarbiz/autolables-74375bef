import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveVoiceProfile, voiceInstruction, checkLocalityUse, localitySlate,
} from "../../../supabase/functions/_shared/description-voice.ts";
import {
  buildFactSnapshot, buildDescriptionPacket, buildMasterPromptV3,
  preferredLengthBand,
} from "../../../supabase/functions/_shared/description-core.ts";
import {
  parseZips, marketAreaEnvelope, DEFAULT_RADIUS_MILES,
} from "../../../scripts/build-selling-areas.mjs";

// Edge functions are outside tsconfig, so these read the shipped source and
// exercise the pure functions directly. Nothing here proves runtime behaviour
// against a live provider or a live database.

const fnDir = join(__dirname, "../../../supabase/functions");
const core = readFileSync(join(fnDir, "_shared/description-core.ts"), "utf8");
const migration = readFileSync(join(fnDir,
  "../migrations/20260908150000_master_ceiling_3979_geo_radius_45.sql"), "utf8");

// ── 1. The band ──────────────────────────────────────────────────────

describe("the master ceiling becomes 3,979", () => {
  it("raises only the ceiling, and only from the band it replaces", () => {
    expect(migration).toMatch(/SET max_length = 3979/);
    expect(migration).toMatch(/WHERE min_length = 3221/);
    expect(migration).toMatch(/AND max_length = 3879/);
    // The floor is not touched: it matches vAuto's own recommendedMin and a
    // master cannot be shorter than the destination it feeds.
    expect(migration).not.toMatch(/SET min_length/);
  });

  it("is what the writer is asked for once it is stored", () => {
    expect(preferredLengthBand({ min_length: 3221, max_length: 3979 }))
      .toEqual({ min: 3221, max: 3979 });
  });

  it("still reserves the appended disclosure out of the writable band", () => {
    // The disclosure is appended after the writer stops but counts toward the
    // stored length. Cutting it off the end instead cost three production
    // investigations; the reserve is the reason it is never cut.
    const v3 = core.slice(core.indexOf("export function buildMasterPromptV3("),
                          core.indexOf("* V3 channel prompt."));
    expect(v3).toMatch(/const reserve = legalLen \? legalLen \+ 2 : 0;/);
    expect(v3).toMatch(/Math\.max\(400, band\.min - reserve\)/);
    expect(v3).toMatch(/Math\.max\(writeFloor \+ 200, band\.max - reserve\)/);
  });

  it("leaves the correction retry deriving its ceiling from the band", () => {
    // description-orchestrate is owned elsewhere. It must keep computing the
    // ceiling from preferredLengthBand rather than from a pinned number, or
    // the retry would correct toward 3,879 forever.
    const orch = readFileSync(join(fnDir, "description-orchestrate/index.ts"), "utf8");
    expect(orch).toMatch(/const ceiling = preferredLengthBand\(settings\)\.max/);
    expect(orch).toMatch(/outputTokenBudget\(ceiling, settings\.reasoning_effort\)/);
    // The only 3,879s left in that file are comments describing the band it
    // used to be. Nothing executable is pinned to the old ceiling.
    expect(orch.split("\n").filter((l) => l.includes("3879") && !l.trim().startsWith("//")))
      .toEqual([]);
  });
});

// ── 2. What is actually known about where the dealership is ──────────

describe("the radius is measured, never asserted", () => {
  it("records the derivation beside the names", () => {
    expect(migration).toMatch(/geo_radius_miles\s+integer NOT NULL DEFAULT 45/);
    expect(migration).toMatch(/geo_origin_zip/);
    expect(migration).toMatch(/selling_areas_meta jsonb/);
  });

  it("takes the origin from the rooftop the dealership already maintains", () => {
    expect(migration).toMatch(/dealer_profiles/);
    expect(migration).toMatch(/marketcheck_sync_config/);
    expect(migration).toMatch(/dealer_zip/);
  });

  it("labels the existing list as what it is rather than back-filling distances", () => {
    expect(migration).toMatch(/'method', 'hand_entered'/);
    expect(migration).not.toMatch(/'method', 'radius_derived'/);
  });

  it("defaults the offline derivation to 45 miles", () => {
    expect(DEFAULT_RADIUS_MILES).toBe(45);
  });

  it("emits an envelope whose every distance was computed", () => {
    const csv = [
      "code,city,state,county,area_code,lat,lon",
      "06120,Hartford,CT,HARTFORD,,41.78007,-72.677099",
      "06108,East Hartford,CT,HARTFORD,,41.78,-72.62",
      "06010,Bristol,CT,HARTFORD,,41.681198,-72.939577",
      "01103,Springfield,MA,HAMPDEN,,42.1015,-72.5898",
      "90210,Beverly Hills,CA,LOS ANGELES,,34.0901,-118.4065",
    ].join("\n");
    const env = marketAreaEnvelope(parseZips(csv), "06120", 45, 20, "test-fixture");
    expect(env.method).toBe("radius_derived");
    expect(env.radius_miles).toBe(45);
    expect(env.areas.every((a) => Number.isFinite(a.miles))).toBe(true);
    expect(env.areas.map((a) => a.area)).toContain("Springfield, MA");
    expect(env.areas.map((a) => a.area)).not.toContain("Beverly Hills, CA");
  });
});

// ── 3. The profile only claims a radius when one was measured ────────

const AREAS = [
  "Hartford, CT", "East Hartford, CT", "West Hartford, CT", "Manchester, CT",
  "New Britain, CT", "Middletown, CT", "Bristol, CT", "Meriden, CT",
  "Springfield, MA", "New Haven, CT", "Waterbury, CT", "Torrington, CT",
];

const MEASURED = {
  method: "radius_derived",
  origin_zip: "06120",
  radius_miles: 45,
  dataset: "test-fixture",
  derived_at: "2026-09-08T00:00:00.000Z",
  areas: [
    { area: "Hartford, CT", miles: 1.2 }, { area: "East Hartford, CT", miles: 3.1 },
    { area: "West Hartford, CT", miles: 4.6 }, { area: "Manchester, CT", miles: 8.4 },
    { area: "New Britain, CT", miles: 12.7 }, { area: "Middletown, CT", miles: 16.2 },
    { area: "Bristol, CT", miles: 18.1 }, { area: "Meriden, CT", miles: 20.3 },
    { area: "Springfield, MA", miles: 22.5 }, { area: "New Haven, CT", miles: 33.8 },
    { area: "Waterbury, CT", miles: 28.4 }, { area: "Torrington, CT", miles: 34.9 },
  ],
};

const SETTINGS = {
  primary_city: "Hartford", state: "CT", selling_areas: AREAS,
  min_length: 3221, max_length: 3979,
};

const voiceOf = (over: Record<string, unknown> = {}) =>
  resolveVoiceProfile("t1", { profile_json: {}, version: "vp", status: "approved" },
    { ...SETTINGS, ...over }, { dealer_name: "Harte INFINITI", city: "Hartford", state: "CT" });

describe("a hand-entered list is not a radius", () => {
  const v = voiceOf();

  it("carries no distances", () => {
    expect(v.areaDistances).toEqual({});
    expect(v.geoMethod).toBe("hand_entered");
    expect(v.geoRadiusMiles).toBe(0);
  });

  it("still gates which places may be named", () => {
    expect(v.approvedAreas).toEqual(AREAS);
    expect(checkLocalityUse("Proudly serving Boston shoppers.", v)
      .some((f) => f.code === "UNAPPROVED_SERVICE_AREA" && f.severity === "blocking")).toBe(true);
  });

  it("never lets the prompt call itself a measured radius", () => {
    const snap = buildFactSnapshot(LISTING, SETTINGS, null);
    const p = buildMasterPromptV3(buildDescriptionPacket(snap, SETTINGS, v), SETTINGS);
    expect(p).not.toMatch(/-mile radius/);
  });
});

describe("a derived list carries its measurements", () => {
  const v = voiceOf({ selling_areas_meta: MEASURED, geo_radius_miles: 45 });

  it("reads the radius and the per-area distance", () => {
    expect(v.geoMethod).toBe("radius_derived");
    expect(v.geoRadiusMiles).toBe(45);
    expect(v.areaDistances["Springfield, MA"]).toBe(22.5);
  });

  it("drops a distance for a place that is not on the allowlist", () => {
    const odd = voiceOf({
      selling_areas: ["Hartford, CT"],
      selling_areas_meta: {
        ...MEASURED, areas: [...MEASURED.areas, { area: "Nowhere, ZZ", miles: 9 }],
      },
    });
    expect(odd.areaDistances["Nowhere, ZZ"]).toBeUndefined();
  });

  it("refuses to treat an envelope with no measured rows as a radius", () => {
    const empty = voiceOf({ selling_areas_meta: { ...MEASURED, areas: [] } });
    expect(empty.geoMethod).toBe("hand_entered");
    expect(empty.geoRadiusMiles).toBe(0);
  });
});

// ── 4. Reach comes from the fleet, not from one description ──────────

describe("the locality slate", () => {
  const v = voiceOf({ selling_areas_meta: MEASURED, geo_radius_miles: 45 });

  it("is stable for a vehicle, so a regeneration is the same page", () => {
    expect(localitySlate(v, "1C4HJXDN4PW657311"))
      .toEqual(localitySlate(v, "1C4HJXDN4PW657311"));
  });

  it("differs across the fleet, which is where the reach comes from", () => {
    const seeds = ["VIN0000000000001", "VIN0000000000002", "VIN0000000000003",
                   "VIN0000000000004", "VIN0000000000005", "VIN0000000000006"];
    const named = new Set(seeds.flatMap((s) => localitySlate(v, s)));
    expect(named.size).toBeGreaterThan(4);
  });

  it("never offers a place that is not on the allowlist", () => {
    for (const s of ["a", "b", "c", "d", "e"]) {
      for (const name of localitySlate(v, s)) expect(AREAS).toContain(name);
    }
  });

  it("spans the radius rather than clustering on the nearest towns", () => {
    // The whole point of widening to 45 miles: a slate of the four closest
    // towns is a 10-mile market area with a bigger number written on it.
    const far = localitySlate(v, "VIN0000000000009")
      .some((a) => (v.areaDistances[a] ?? 0) > 20);
    expect(far).toBe(true);
  });

  it("still rotates when nothing was measured", () => {
    const plain = voiceOf();
    expect(localitySlate(plain, "VIN1")).not.toEqual(localitySlate(plain, "VIN7"));
  });

  it("returns the whole list when the dealership has fewer areas than the slate", () => {
    const small = voiceOf({ selling_areas: ["Hartford, CT", "Manchester, CT"] });
    expect(localitySlate(small, "VIN1")).toEqual(["Hartford, CT", "Manchester, CT"]);
  });
});

const LISTING = {
  id: "v1", vin: "1C4HJXDN4PW657311", ymm: "2023 Jeep Wrangler 4-Door",
  trim: "Altitude", condition: "used", mileage: 36087,
  mc_attributes: { year: 2023, make: "Jeep", model: "Wrangler 4-Door",
                   options: ["Backup Camera"] },
};

describe("the prompt offers this vehicle's slate, not the whole list", () => {
  const v = voiceOf({ selling_areas_meta: MEASURED, geo_radius_miles: 45 });
  const snap = buildFactSnapshot(LISTING, SETTINGS, null);
  const packet = buildDescriptionPacket(snap, SETTINGS, v);
  const prompt = buildMasterPromptV3(packet, SETTINGS);

  it("puts a slate on the packet", () => {
    expect(packet.localities.length).toBeGreaterThan(0);
    expect(packet.localities.length).toBeLessThanOrEqual(4);
  });

  it("does not hand the writer all twelve", () => {
    const offered = AREAS.filter((a) => prompt.includes(a));
    expect(offered.length).toBeLessThanOrEqual(4);
  });

  it("names the measured radius so the geography is not a guess", () => {
    expect(prompt).toMatch(/45-mile radius around this rooftop/);
  });

  it("allows the store's own city plus two others, and no more", () => {
    expect(prompt).toMatch(/identify the store by its own city/);
    expect(prompt).toMatch(/at most two of the approved localities/);
    expect(prompt).toMatch(/never write a "serving \.\.\." list/);
  });

  it("forbids a distance the platform measured but never verified as a drive", () => {
    expect(prompt).toMatch(/Never state a distance, a drive time, a direction/);
    expect(voiceInstruction(v, undefined, packet.localities))
      .toMatch(/Never state a distance, a drive time or a direction/);
  });

  it("asks for a sentence an answer engine could quote on its own", () => {
    expect(prompt).toMatch(/quoted on its own/);
  });
});

// ── 5. The guardrails that make the wider radius safe ────────────────

describe("the validator holds the line the prompt draws", () => {
  const v = voiceOf({ selling_areas_meta: MEASURED, geo_radius_miles: 45 });

  it("blocks a stated distance to an approved place", () => {
    const f = checkLocalityUse(
      "This Wrangler sits about 12 miles from Manchester and is ready to go.", v);
    expect(f.some((x) => x.code === "UNVERIFIED_DISTANCE_CLAIM" && x.severity === "blocking")).toBe(true);
  });

  it("blocks a drive time to the store", () => {
    const f = checkLocalityUse("Twenty minutes from our showroom in any weather.", v)
      .concat(checkLocalityUse("Just 20 minutes from our showroom.", v));
    expect(f.some((x) => x.code === "UNVERIFIED_DISTANCE_CLAIM")).toBe(true);
  });

  it("does not mistake an odometer reading for a distance claim", () => {
    // "36,087 miles from a single owner" is the sentence this check must not
    // break: every used description on the lot states a mileage.
    const f = checkLocalityUse(
      "It shows 36,087 miles from a single owner and 12 miles of fresh tread.", v);
    expect(f).toHaveLength(0);
  });

  it("warns when a fourth approved locality appears", () => {
    const f = checkLocalityUse(
      "A Hartford commute suits it. Manchester buyers like the ground clearance. "
      + "It is a favourite in Bristol. Meriden shoppers ask for this trim.", v);
    expect(f.some((x) => x.code === "LOCALITY_STUFFING" && x.severity === "warning")).toBe(true);
  });

  it("counts East Hartford as one locality, not two", () => {
    const f = checkLocalityUse(
      "An East Hartford favourite that also suits a Manchester commute.", v);
    expect(f).toHaveLength(0);
  });

  it("still allows the store city plus two others", () => {
    const f = checkLocalityUse(
      "Sold and serviced in Hartford. It suits a Manchester commute, and the "
      + "ground clearance earns its keep on a Torrington winter road.", v);
    expect(f).toHaveLength(0);
  });

  it("still blocks an enumerated list of approved places", () => {
    const f = checkLocalityUse(
      "Serving Hartford, Manchester, New Britain and Middletown drivers.", v);
    expect(f.some((x) => x.code === "LOCALITY_STUFFING" && x.severity === "blocking")).toBe(true);
  });

  it("still blocks a place the dealership never approved", () => {
    const f = checkLocalityUse("Proudly serving Boston shoppers every day.", v);
    expect(f.some((x) => x.code === "UNAPPROVED_SERVICE_AREA")).toBe(true);
  });
});

// ── 6. A changed market area has to reach the copy ───────────────────

describe("re-deriving the area is a configuration change", () => {
  it("moves the settings fingerprint", () => {
    expect(core).toMatch(/JSON\.stringify\(settings\.selling_areas_meta \?\? \{\}\), settings\.geo_radius_miles/);
  });

  it("moves the voice profile version", () => {
    const voice = readFileSync(join(fnDir, "_shared/description-voice.ts"), "utf8");
    const hash = voice.slice(voice.indexOf("export async function computeVoiceProfileVersion"));
    expect(hash.slice(0, 900)).toMatch(/areaDistances/);
    expect(hash.slice(0, 900)).toMatch(/geoRadiusMiles/);
  });
});
