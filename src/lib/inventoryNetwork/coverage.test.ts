import { describe, it, expect } from "vitest";
import { coverageFor, type CoverProduct } from "./coverage";

const p = (productKey: string, bundledFields: string[], rateUsd: number | null, quotaUnits = 1): CoverProduct => ({ productKey, label: productKey, bundledFields, rateUsd, quotaUnits });
const products = [
  p("neovin", ["build_identity", "installed_equipment", "factory_warranty_spec"], 0.08),
  p("basic", ["build_identity"], 0.0015),
  p("price", ["valuation"], 0.07),
  p("plus", ["valuation", "build_identity", "installed_equipment", "factory_warranty_spec"], 0.12),
];

describe("coverageFor", () => {
  it("picks the cheapest covering set", () => {
    const r = coverageFor(["build_identity"], products);
    expect(r.products.map((x) => x.productKey)).toEqual(["basic"]);
  });

  it("prefers one bundle over two requests and says unticking a bundled field changes nothing", () => {
    const r = coverageFor(["valuation", "installed_equipment", "build_identity"], products);
    expect(r.products.map((x) => x.productKey)).toEqual(["plus"]);
    expect(r.notes.join(" ")).toContain("Unticking build_identity would not change the price");
  });

  it("calculates derived fields from their inputs and reports fields nobody supplies", () => {
    const r = coverageFor(["warranty_remaining", "recall_status"], products);
    expect(r.derived).toEqual(["warranty_remaining"]);
    expect(r.uncoverable).toEqual(["recall_status"]);
    expect(r.products.map((x) => x.productKey)).toEqual(["neovin"]);
  });

  it("reports an unknown total when a product has no price", () => {
    expect(coverageFor(["valuation"], [p("x", ["valuation"], null)]).usd).toBeNull();
  });
});
