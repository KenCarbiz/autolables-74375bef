import { describe, it, expect } from "vitest";
import { haversine, parseZips, marketArea } from "../../../scripts/build-selling-areas.mjs";

// A dealership's market area is a property of the dealership, resolved once
// from its rooftop ZIP — not a radius recomputed on every vehicle.

const CSV = [
  "code,city,state,county,area_code,lat,lon",
  "06120,Hartford,CT,HARTFORD,,41.78007,-72.677099",
  "06108,East Hartford,CT,HARTFORD,,41.78,-72.62",
  "06010,Bristol,CT,HARTFORD,,41.681198,-72.939577",
  // Four PO-Box-only ZIPs sharing a county centroid, the trap that put
  // Bristol 2.6 miles from Hartford instead of eighteen.
  "06011,Bristol,CT,HARTFORD,,41.791776,-72.718832",
  "06030,Farmington,CT,HARTFORD,,41.791776,-72.718832",
  "06034,Farmington,CT,HARTFORD,,41.791776,-72.718832",
  "06045,Manchester,CT,HARTFORD,,41.791776,-72.718832",
  "06102,Hartford,CT,HARTFORD,,41.791776,-72.718832",
  "01103,Springfield,MA,HAMPDEN,,42.1015,-72.5898",
  "90210,Beverly Hills,CA,LOS ANGELES,,34.0901,-118.4065",
].join("\n");

describe("county-centroid fallbacks are excluded", () => {
  const zips = parseZips(CSV);

  it("drops coordinates shared by too many ZIPs", () => {
    for (const code of ["06011", "06030", "06034", "06045", "06102"]) {
      expect(zips.has(code), `${code} should be dropped`).toBe(false);
    }
  });

  it("keeps the real delivery ZIPs", () => {
    for (const code of ["06120", "06108", "06010", "01103"]) {
      expect(zips.has(code), code).toBe(true);
    }
  });

  it("would otherwise place Bristol next door to Hartford", () => {
    // The bug this filter exists for, stated as a measurement.
    const fallback = { lat: 41.791776, lon: -72.718832 };
    const hartford = { lat: 41.78007, lon: -72.677099 };
    expect(haversine(hartford, fallback)).toBeLessThan(4);
    expect(haversine(hartford, { lat: 41.681198, lon: -72.939577 })).toBeGreaterThan(13);
  });
});

describe("distance is measured, not assumed", () => {
  it("computes a known separation", () => {
    // Hartford to Springfield is about 21 miles.
    const d = haversine({ lat: 41.78007, lon: -72.677099 }, { lat: 42.1015, lon: -72.5898 });
    expect(d).toBeGreaterThan(19);
    expect(d).toBeLessThan(24);
  });
});

describe("the market area spans the radius", () => {
  const zips = parseZips(CSV);

  it("includes the dealership's own city", () => {
    expect(marketArea(zips, "06120", 40, 10).map((a) => a.area)).toContain("Hartford, CT");
  });

  it("excludes anything beyond the radius", () => {
    const areas = marketArea(zips, "06120", 40, 10).map((a) => a.area);
    expect(areas).not.toContain("Beverly Hills, CA");
    expect(areas).toContain("Springfield, MA");
  });

  it("respects a tighter radius", () => {
    expect(marketArea(zips, "06120", 10, 10).map((a) => a.area)).not.toContain("Springfield, MA");
  });

  it("caps the list rather than naming every town in range", () => {
    // Two hundred town names in a prompt is keyword spam, which the writing
    // standard forbids outright.
    expect(marketArea(zips, "06120", 40, 3).length).toBeLessThanOrEqual(3);
  });

  it("refuses an unknown origin instead of guessing one", () => {
    expect(() => marketArea(zips, "99999", 40, 10)).toThrow(/unknown ZIP/);
  });
});
