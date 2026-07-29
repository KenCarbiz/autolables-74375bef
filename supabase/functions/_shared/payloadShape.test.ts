import { describe, it, expect } from "vitest";
import { describeShape, detectDrift, shapeHash } from "./payloadShape.ts";

describe("describeShape", () => {
  it("records sorted top-level keys and the type of every dependency", () => {
    const s = describeShape({ vin: "X", features: [], msrp: 49150, options_packages: {} });
    expect(s.keys).toEqual(["features", "msrp", "options_packages", "vin"]);
    expect(s.dependencyTypes.features).toBe("array");
    expect(s.dependencyTypes.msrp).toBe("number");
    expect(s.dependencyTypes.options_packages).toBe("object");
    expect(s.dependencyTypes.installed_options).toBe("absent");
  });

  it("survives a non-object payload rather than throwing", () => {
    expect(describeShape(null).keys).toEqual([]);
    expect(describeShape([1, 2, 3]).keyCount).toBe(0);
  });
});

describe("detectDrift", () => {
  const rich = (extra: Record<string, unknown> = {}) =>
    describeShape({
      vin: "3PCAJ5JR1SF103167", year: 2025, make: "INFINITI", model: "QX55", trim: "Luxe",
      body_type: "SUV", drivetrain: "AWD", engine: "2.0L I4", transmission: "CVT",
      fuel_type: "Premium", doors: 4, cylinders: 4, ...extra,
    });

  it("is silent when the payload parsed cleanly", () => {
    expect(detectDrift(rich({ features: { Safety: ["ABS"] } }), { parsedSheet: true })).toEqual([]);
  });

  it("calls a rich payload that produced nothing a parser failure, not a coverage gap", () => {
    // The exact regression: the provider answered fully, we extracted nothing.
    const findings = detectDrift(rich(), { parsedSheet: false });
    expect(findings.map((f) => f.kind)).toContain("parse_failure");
    expect(findings.find((f) => f.kind === "parse_failure")!.detail).toMatch(/parser gap/);
  });

  it("does NOT cry parser failure on a genuinely thin response", () => {
    // A real coverage gap must stay distinguishable — it needs the opposite
    // response (stop retrying, tell the dealer).
    const thin = describeShape({ vin: "X", year: 2025 });
    expect(detectDrift(thin, { parsedSheet: false }).map((f) => f.kind)).not.toContain("parse_failure");
  });

  it("flags a dependency that changed JSON type", () => {
    const findings = detectDrift(rich({ options_packages: "Cargo Package, Splash Guards" }), { parsedSheet: true });
    const hit = findings.find((f) => f.kind === "dependency_retyped");
    expect(hit).toBeDefined();
    expect(hit!.detail).toMatch(/options_packages arrived as string/);
  });

  it("accepts both documented shapes for features without complaining", () => {
    for (const features of [[{ description: "ABS" }], { Safety: ["ABS"] }]) {
      const findings = detectDrift(rich({ features }), { parsedSheet: true });
      expect(findings.filter((f) => f.kind === "dependency_retyped")).toEqual([]);
    }
  });

  it("reports added and removed top-level keys against the last accepted shape", () => {
    const shape = describeShape({ vin: "X", msrp: 1, brand_new_key: 2 });
    const findings = detectDrift(shape, { parsedSheet: true, priorKeys: ["vin", "msrp", "gone_key"] });
    const hit = findings.find((f) => f.kind === "shape_changed")!;
    expect(hit.detail).toMatch(/removed: gone_key/);
    expect(hit.detail).toMatch(/added: brand_new_key/);
  });

  it("says nothing about shape when there is no prior shape to compare", () => {
    const findings = detectDrift(describeShape({ vin: "X" }), { parsedSheet: true });
    expect(findings.filter((f) => f.kind === "shape_changed")).toEqual([]);
  });
});

describe("shapeHash", () => {
  it("is stable across key order and changes when a dependency is retyped", async () => {
    const a = await shapeHash(describeShape({ vin: "X", features: [] }));
    const b = await shapeHash(describeShape({ features: [], vin: "X" }));
    const c = await shapeHash(describeShape({ vin: "X", features: {} }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
