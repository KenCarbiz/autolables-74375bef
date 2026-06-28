import { describe, it, expect } from "vitest";
import { pickStr, brandsToStr, mapAutocurbProfile } from "./autocurbProfile";

describe("pickStr", () => {
  it("returns the first non-empty, trimmed value", () => {
    expect(pickStr(null, "", "  ", " Harte ", "Other")).toBe("Harte");
  });

  it("returns empty string when nothing qualifies", () => {
    expect(pickStr(null, undefined, "", "   ")).toBe("");
  });

  it("coerces non-strings, treating 0 as a present value", () => {
    expect(pickStr(null, 42)).toBe("42");
    expect(pickStr(0, "x")).toBe("0");
  });
});

describe("brandsToStr", () => {
  it("joins a non-empty array, trimming and dropping blanks", () => {
    expect(brandsToStr([" INFINITI ", "", "Nissan"])).toBe("INFINITI, Nissan");
  });

  it("falls back to the first non-empty string", () => {
    expect(brandsToStr([], "  ", "Honda")).toBe("Honda");
  });

  it("returns empty string when nothing qualifies", () => {
    expect(brandsToStr([], "", null)).toBe("");
  });
});

describe("mapAutocurbProfile", () => {
  it("returns {} for a null/empty profile", () => {
    expect(mapAutocurbProfile(null)).toEqual({});
    expect(mapAutocurbProfile({})).toEqual({});
  });

  it("omits keys with no resolvable value (gap-filling layer)", () => {
    const out = mapAutocurbProfile({ name: "Harte INFINITI" });
    expect(out.dealer_name).toBe("Harte INFINITI");
    expect("dealer_tagline" in out).toBe(false);
    expect("dealer_phone" in out).toBe(false);
  });

  it("prefers legal_entity_name over name for dealer_name", () => {
    expect(mapAutocurbProfile({ legal_entity_name: "Harte Nissan INFINITI LLC", name: "Harte INFINITI" }).dealer_name)
      .toBe("Harte Nissan INFINITI LLC");
  });

  it("probes branding and the first store for nested fields", () => {
    const out = mapAutocurbProfile({
      name: "Harte",
      branding: { logo_url: "https://cdn/logo.png", primary_color: "#2563EB" },
      stores: [{ city: "Hartford", state: "CT", zip: "06101", oem_brands: ["INFINITI"] }],
    });
    expect(out.dealer_logo_url).toBe("https://cdn/logo.png");
    expect(out.primary_color).toBe("#2563EB");
    expect(out.dealer_city).toBe("Hartford");
    expect(out.dealer_state).toBe("CT");
    expect(out.dealer_zip).toBe("06101");
    expect(out.dealer_oem_brands).toBe("INFINITI");
  });

  it("prefers governing_law_state over the store state for dealer_state", () => {
    const out = mapAutocurbProfile({ name: "x", governing_law_state: "CT", stores: [{ state: "MA" }] });
    expect(out.dealer_state).toBe("CT");
  });
});
