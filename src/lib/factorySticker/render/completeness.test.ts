import { describe, expect, it } from "vitest";
import { buildRenderLayout } from "./contract";
import {
  buildContentManifest,
  buildSingletonExpectations,
  checkRenderedCompleteness,
} from "./completeness";
import {
  audiQ5Fixture, buickEnvisionFixture, cadillacEscaladeFixture,
  chryslerPacificaFixture, dodgeDurangoFixture, jeepFixture,
  landRoverSportFixture, longEquipmentFixture, porsche911Fixture,
  ramFixture, themeFor,
} from "./__fixtures__/renderData";

describe("content manifest", () => {
  it("requires every package member the buyer is charged for", () => {
    const data = buickEnvisionFixture();
    const manifest = buildContentManifest(data);
    const members = manifest.filter((m) => m.category === "package_member").map((m) => m.expected);
    expect(members).toEqual([
      "HD Surround Vision",
      "Adaptive Cruise Control",
      "Head-Up Display",
      "Reverse Automatic Braking",
      "Speed Limit Recognition",
      "Enhanced Automatic Park Assist",
    ]);
  });

  it("requires the VIN, both MSRP anchors and the reproduction disclosure", () => {
    const manifest = buildContentManifest(buickEnvisionFixture());
    const byLabel = new Map(manifest.map((m) => [m.label, m.expected]));
    expect(byLabel.get("VIN")).toBe("LRBFZSE41SD012345");
    expect(byLabel.get("Base MSRP")).toBe("$47,595.00");
    expect(byLabel.get("Total MSRP")).toBe("$53,195.00");
    expect(byLabel.get("Reproduction disclosure")).toContain("Not an original Buick-issued Monroney label");
  });

  it("expects a priced package to be listed exactly once", () => {
    const singles = buildSingletonExpectations(buickEnvisionFixture());
    expect(singles).toEqual([
      { label: "Package Avenir Technology Package listed once", expected: "Avenir Technology Package", expectedCount: 1 },
    ]);
  });
});

describe("rendered completeness", () => {
  // Every option-heavy or package-heavy fixture in the suite. A brand
  // whose page cannot hold its content overflows to the approved
  // continuation page; nothing is ever dropped to make it fit.
  const cases: Array<[string, () => ReturnType<typeof buickEnvisionFixture>]> = [
    ["Buick Envision", buickEnvisionFixture],
    ["Audi Q5", audiQ5Fixture],
    ["Cadillac Escalade", cadillacEscaladeFixture],
    ["Ram 1500", ramFixture],
    ["Chrysler Pacifica", chryslerPacificaFixture],
    ["Dodge Durango", dodgeDurangoFixture],
    ["Jeep Wrangler", jeepFixture],
    ["Land Rover Sport", landRoverSportFixture],
    ["Porsche 911", porsche911Fixture],
    ["Maximum equipment", longEquipmentFixture],
  ];

  for (const [name, fixture] of cases) {
    it(`${name} prints everything its manifest requires`, () => {
      const data = fixture();
      const model = buildRenderLayout(data, themeFor(null));
      const report = checkRenderedCompleteness(data, model);
      expect(report.missing.map((m) => m.label), name).toEqual([]);
      expect(report.miscounted, name).toEqual([]);
      expect(report.pass, name).toBe(true);
      expect(report.checked, name).toBeGreaterThan(10);
    });
  }

  it("prints all six Envision APF members with the package priced once", () => {
    const data = buickEnvisionFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const drawn = model.pages.flatMap((p) =>
      p.primitives.filter((x) => x.kind === "text").map((x) => (x.kind === "text" ? x.str : "")));
    for (const member of [
      "HD Surround Vision", "Adaptive Cruise Control", "Head-Up Display",
      "Reverse Automatic Braking", "Speed Limit Recognition", "Enhanced Automatic Park Assist",
    ]) {
      expect(drawn, member).toContain(member);
    }
    expect(drawn.filter((s) => s === "Avenir Technology Package").length).toBe(1);
    // The package price appears on its own leader row and again in nothing
    // else — 1,965.00 is not a destination charge or a rollup subtotal here.
    expect(drawn.filter((s) => s === "1,965.00").length).toBe(1);
  });

  it("reports a dropped package member rather than passing silently", () => {
    const data = buickEnvisionFixture();
    const model = buildRenderLayout(data, themeFor(null));
    // Simulate the old truncating behaviour: strip two members from what
    // the renderer is considered to have drawn.
    const damaged = {
      ...model,
      drawnStrings: model.drawnStrings.filter(
        (s) => s !== "Speed Limit Recognition" && s !== "Enhanced Automatic Park Assist",
      ),
    };
    const report = checkRenderedCompleteness(data, damaged);
    expect(report.pass).toBe(false);
    expect(report.code).toBe("LAYOUT_OVERFLOW");
    expect(report.missing.map((m) => m.expected)).toEqual([
      "Speed Limit Recognition",
      "Enhanced Automatic Park Assist",
    ]);
  });

  it("reports a package listed twice as a document-integrity failure", () => {
    const data = buickEnvisionFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const doubled = { ...model, drawnStrings: [...model.drawnStrings, "Avenir Technology Package"] };
    const report = checkRenderedCompleteness(data, doubled);
    expect(report.pass).toBe(false);
    expect(report.code).toBe("PDF_VALIDATION_FAILED");
    expect(report.miscounted[0].actualCount).toBe(2);
  });

  it("counts content that moved to the continuation page as present", () => {
    const data = longEquipmentFixture();
    const model = buildRenderLayout(data, themeFor(null));
    expect(model.pages.length).toBeGreaterThan(1);
    expect(checkRenderedCompleteness(data, model).pass).toBe(true);
  });
});
