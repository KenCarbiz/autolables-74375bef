import { describe, it, expect } from "vitest";
import { readDealerAlternatives } from "./dealerAlternatives";
import type { VehicleListing } from "@/hooks/useVehicleListing";

const listingWith = (over: Record<string, unknown>): VehicleListing =>
  ({ price: 50000, condition: "new", mc_attributes: {}, ...over } as unknown as VehicleListing);

const alt = (over: Record<string, unknown>) => ({
  slug: "v1", ymm: "2026 INFINITI QX60", trim: "LUXE", price: 48000, mileage: 10,
  condition: "new", image: null, same_model: true, tier: 1,
  package_count: null, option_value: null, top_packages: [], ...over,
});

describe("readDealerAlternatives", () => {
  it("returns empty when the edge attached nothing", () => {
    expect(readDealerAlternatives(listingWith({}), null)).toEqual([]);
  });

  it("labels a pre-owned same-model twin for a new-car shopper with the savings", () => {
    const [a] = readDealerAlternatives(listingWith({ dealer_similar: [alt({ condition: "used", price: 43600 })] }), null);
    expect(a.tag).toBe("Pre-owned option");
    expect(a.tagDetail).toBe("Save $6,400");
  });

  it("labels a CPO twin violet and a new twin for a used-car shopper", () => {
    const l = listingWith({ condition: "used", dealer_similar: [alt({ slug: "a", condition: "cpo", price: 46000 }), alt({ slug: "b", condition: "new", price: 54000 })] });
    const out = readDealerAlternatives(l, null);
    expect(out.find((x) => x.slug === "a")?.tag).toBe("Certified pre-owned");
    expect(out.find((x) => x.slug === "b")?.tag).toBe("Brand new option");
  });

  it("positions same-condition siblings by option value", () => {
    const l = listingWith({
      mc_attributes: { build_sheet: { packages: [{ name: "Premium Package", msrp: 2000, contents: [] }], options: [], key_features: {}, standard: { misc: ["Panoramic Moonroof"] }, generic: false } },
      dealer_similar: [
        alt({ slug: "up", option_value: 4450, package_count: 3 }),
        alt({ slug: "down", option_value: 500, package_count: 1, price: 46800 }),
      ],
    });
    const out = readDealerAlternatives(l, null);
    const up = out.find((x) => x.slug === "up")!;
    const down = out.find((x) => x.slug === "down")!;
    expect(up.tag).toBe("More equipment");
    expect(up.tagDetail).toBe("+$2,450 in factory options");
    expect(down.tag).toBe("Save");
    expect(down.tagDetail).toBe("Save $3,200");
  });

  it("keeps tier order (same model before competitive set)", () => {
    const l = listingWith({ dealer_similar: [
      alt({ slug: "comp-set", same_model: false, tier: 3, ymm: "2026 Nissan Pathfinder" }),
      alt({ slug: "twin", tier: 1 }),
    ] });
    const out = readDealerAlternatives(l, null);
    expect(out[0].slug).toBe("twin");
    expect(out[1].slug).toBe("comp-set");
  });

  it("re-ranks within a tier by shopper intent (price shoppers see savings first)", () => {
    const l = listingWith({ dealer_similar: [
      alt({ slug: "more", option_value: 9000, package_count: 4 }),
      alt({ slug: "save", price: 45000, option_value: 100, package_count: 0 }),
    ], mc_attributes: { build_sheet: { packages: [{ name: "Premium Package", msrp: 3000, contents: [] }], options: [], key_features: {}, standard: { misc: ["Moonroof"] }, generic: false } } });
    const neutral = readDealerAlternatives(l, null);
    expect(neutral[0].slug).toBe("more");          // equipment leads by default
    const priceShopper = readDealerAlternatives(l, "price");
    expect(priceShopper[0].slug).toBe("save");     // savings lead for price intent
  });
});
