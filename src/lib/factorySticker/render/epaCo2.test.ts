import { describe, expect, it } from "vitest";
import { adaptRenderData, resolveRenderTheme } from "./contract";
import { buildStickerLayout } from "./layout";
import { infinitiQx80NewFixture, themeFor } from "./__fixtures__/renderData";

const buildRenderLayout = (data: Parameters<typeof adaptRenderData>[0], theme: Parameters<typeof resolveRenderTheme>[1]) =>
  buildStickerLayout(adaptRenderData(data), resolveRenderTheme(data, theme));

const co2Line = (co2: number | null | undefined, combined = 18) => {
  const data = infinitiQx80NewFixture();
  data.epa = {
    city: 16, highway: 20, combined, annualFuelCost: 4550, ghgScore: 3, rangeMiles: null,
    fuelType: "Premium", ...(co2 === undefined ? {} : { co2TailpipeGpm: co2 }),
  };
  const model = buildRenderLayout(data, themeFor(null));
  return model.pages[0].primitives
    .flatMap((p) => (p.kind === "text" ? [p.str] : []))
    .join(" ")
    .match(/emits (\d+) grams CO2/)?.[1] ?? null;
};

describe("EPA tailpipe CO2 line", () => {
  it("prints the saved EPA figure, not a derivation that can be several grams off", () => {
    expect(Math.round(8887 / 18)).toBe(494);
    expect(co2Line(504)).toBe("504");
  });

  it("derives from combined MPG only when the EPA row carries no figure", () => {
    expect(co2Line(undefined)).toBe("494");
    expect(co2Line(null)).toBe("494");
  });

  it("prints nothing when there is no combined MPG and no saved figure", () => {
    const data = infinitiQx80NewFixture();
    data.epa = { city: null, highway: null, combined: null, annualFuelCost: null, ghgScore: null, rangeMiles: null, fuelType: "Premium" };
    const text = buildRenderLayout(data, themeFor(null)).pages[0].primitives
      .flatMap((p) => (p.kind === "text" ? [p.str] : [])).join(" ");
    expect(text).not.toMatch(/grams CO2/);
  });
});
