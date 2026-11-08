import { describe, expect, it } from "vitest";
import { adaptRenderData, type FactoryStickerRenderData } from "../contract.ts";
import { cadillacReferenceMatchData, cadillacRenderData } from "../__fixtures__/cadillac.ts";
import { carbGrades } from "./carbPanel.ts";

const grades = (d: FactoryStickerRenderData) => carbGrades(adaptRenderData(d).data);
const ref = (): FactoryStickerRenderData => cadillacReferenceMatchData(cadillacRenderData());

describe("CARB A+/A+ rule (MDV EPL specifications, sections 1(a) and 6)", () => {
  it("applies to a verified 2021+ medium-duty vehicle whose only fuel is electricity", () => {
    expect(grades(ref())).toEqual({ ghg: "A+", smog: "A+" });
  });

  it("never applies without verified medium-duty class evidence, even for an electric vehicle", () => {
    expect(grades({ ...ref(), carbMediumDutyEvidence: null })).toBeNull();
  });

  it("never applies before model year 2021", () => {
    const d = ref();
    expect(grades({ ...d, identity: { ...d.identity, year: "2020" } })).toBeNull();
  });

  it("never applies to any fuel other than electricity alone", () => {
    const d = ref();
    for (const fuelType of ["Diesel", "Regular Gasoline", "Premium and Electricity", "Hydrogen", null]) {
      expect(grades({ ...d, epa: { ...d.epa!, fuelType } })).toBeNull();
    }
  });

  it("is never set by the normalizer: saved production records carry no class evidence", () => {
    expect(cadillacRenderData().carbMediumDutyEvidence ?? null).toBeNull();
    expect(grades(cadillacRenderData())).toBeNull();
  });
});
