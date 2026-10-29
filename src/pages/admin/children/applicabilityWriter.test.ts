import { describe, it, expect, vi } from "vitest";
import { applicabilityWriter, PREVIEW_ONLY, PreviewOnlyError } from "./applicabilityWriter";

const deps = () => ({
  updateRule: vi.fn(async () => undefined),
  addRule: vi.fn(async () => ({ id: "rule-new" })),
  updateProduct: vi.fn(async () => ({ error: null })),
  audit: vi.fn(),
});
const RULE = { product_id: "p1", year_min: "", year_max: "", makes: [], models: [], trims: [], body_styles: [], condition: "used" as const, mileage_max: 0 };

describe("applicability writer", () => {
  it("in fixture mode refuses every write before calling the real writer", async () => {
    const d = deps();
    const w = applicabilityWriter(true, d);
    expect(w.preview).toBe(true);
    await expect(w.updateRule("r1", { condition: "used", mileage_max: 0, year_min: "", year_max: "" })).rejects.toThrow(PreviewOnlyError);
    await expect(w.addRule(RULE)).rejects.toThrow(PREVIEW_ONLY);
    await expect(w.updateTreatment("p1", "installed", 695)).rejects.toThrow(PREVIEW_ONLY);
    expect(() => w.audit({ action: "rule_updated" })).toThrow(PREVIEW_ONLY);
    expect(d.updateRule).not.toHaveBeenCalled();
    expect(d.addRule).not.toHaveBeenCalled();
    expect(d.updateProduct).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("outside fixture mode passes each write to the real writer", async () => {
    const d = deps();
    const w = applicabilityWriter(false, d);
    expect(w.preview).toBe(false);
    await w.updateRule("r1", { condition: "new", mileage_max: 0, year_min: "", year_max: "" });
    expect(await w.addRule(RULE)).toEqual({ id: "rule-new" });
    await w.updateTreatment("p1", "optional", 250);
    w.audit({ action: "rule_added" });
    expect(d.updateRule).toHaveBeenCalledWith("r1", { condition: "new", mileage_max: 0, year_min: "", year_max: "" });
    expect(d.addRule).toHaveBeenCalledWith(RULE);
    expect(d.updateProduct).toHaveBeenCalledWith("p1", { badge_type: "optional", price_label: "If Accepted", price: 250 });
    expect(d.audit).toHaveBeenCalledWith({ action: "rule_added" });
  });

  it("reports a refused product write and a rule insert that returns nothing", async () => {
    const w = applicabilityWriter(false, { ...deps(), updateProduct: vi.fn(async () => ({ error: { message: "permission denied for table products" } })), addRule: vi.fn(async () => null) });
    await expect(w.updateTreatment("p1", "installed", 1)).rejects.toThrow("permission denied for table products");
    await expect(w.addRule(RULE)).rejects.toThrow("The rule could not be created.");
  });
});
