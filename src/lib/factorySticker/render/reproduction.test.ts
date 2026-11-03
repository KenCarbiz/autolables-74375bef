import { describe, expect, it } from "vitest";
import { buildRenderLayout, type FactoryStickerRenderData } from "./contract";
import {
  hondaCrvHybridFixture,
  infinitiBenchmark,
  longEquipmentFixture,
  qx55ClassFixture,
  newConditionBenchmark,
  noEpaFixture,
  themeFor,
} from "./__fixtures__/renderData";
import { expectNoTextOverlap, pageStrings } from "./__fixtures__/layoutAsserts";
import {
  FACTORY_BUILD_UNVERIFIED,
  PASSPORT_QR_CAPTION,
  REPRODUCTION_DISCLOSURE,
  provenanceSentence,
} from "../reproduction";

// The renderer sanitizes typographic dashes to ASCII for the WinAnsi fonts.
const PRINTED_BANNER = "REPRODUCTION WINDOW STICKER - NOT AN ORIGINAL MANUFACTURER LABEL";
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

const fixtures: Array<[string, () => FactoryStickerRenderData, string | null]> = [
  ["used INFINITI benchmark", infinitiBenchmark, "infiniti"],
  ["new-condition benchmark", newConditionBenchmark, "infiniti"],
  ["no-EPA vehicle on the fallback theme", noEpaFixture, null],
  ["QX55-class equipment", qx55ClassFixture, "infiniti"],
  ["long equipment (review-required one page)", longEquipmentFixture, "infiniti"],
];

describe("reproduction identification", () => {
  for (const [label, make, theme] of fixtures) {
    describe(label, () => {
      const model = buildRenderLayout(make(), themeFor(theme));

      it("prints the banner and the full disclosure on every page", () => {
        for (let i = 0; i < model.pages.length; i++) {
          const strings = pageStrings(model, i);
          expect(strings, `page ${i + 1}`).toContain(PRINTED_BANNER);
          expect(norm(strings.join(" ")), `page ${i + 1}`).toContain(norm(REPRODUCTION_DISCLOSURE));
          expect(norm(strings.join(" ")), `page ${i + 1}`).toContain(FACTORY_BUILD_UNVERIFIED);
        }
      });

      it("never claims to be the federally required label", () => {
        const all = model.drawnStrings.join(" ");
        expect(all).not.toMatch(/applied pursuant to Federal law/i);
        expect(all).not.toMatch(/Do not remove prior to delivery/i);
        expect(all).not.toMatch(/FACTORY BUILD RECORD/);
      });
    });
  }

  it("keeps the page free of overlapping text with the banner in place", () => {
    expectNoTextOverlap(buildRenderLayout(infinitiBenchmark(), themeFor("infiniti")), 0);
  });

  it("uses the stronger provenance sentence only for verified factory build data with a named source", () => {
    expect(provenanceSentence({ verified: true, source: "the manufacturer build record" }))
      .toBe("Derived from original factory build specifications supplied by the manufacturer build record.");
    expect(provenanceSentence({ verified: true, source: "  " })).toBe(FACTORY_BUILD_UNVERIFIED);
    expect(provenanceSentence({ verified: false, source: "MarketCheck NeoVIN" })).toBe(FACTORY_BUILD_UNVERIFIED);
    expect(provenanceSentence(null)).toBe(FACTORY_BUILD_UNVERIFIED);

    const verified = buildRenderLayout(
      { ...infinitiBenchmark(), factoryBuild: { verified: true, source: "Example OEM Build Feed" } },
      themeFor("infiniti"),
    );
    const text = norm(verified.drawnStrings.join(" "));
    expect(text).toContain("Derived from original factory build specifications supplied by Example OEM Build Feed.");
    expect(text).not.toContain(FACTORY_BUILD_UNVERIFIED);
  });
});

describe("Vehicle Passport QR", () => {
  it("captions the QR exactly", () => {
    const model = buildRenderLayout(infinitiBenchmark(), themeFor("infiniti"));
    expect(pageStrings(model, 0)).toContain(PASSPORT_QR_CAPTION);
  });

  it("omits the QR and caption when there is no published Passport", () => {
    const model = buildRenderLayout({ ...infinitiBenchmark(), passportUrl: "" }, themeFor("infiniti"));
    const qrs = model.pages.flatMap((p) => p.primitives).filter((p) => p.kind === "qr");
    expect(qrs.every((q) => q.kind === "qr" && !/autolabels|\/v\//i.test(q.payload))).toBe(true);
    expect(model.drawnStrings).not.toContain(PASSPORT_QR_CAPTION);
  });
});

describe("one-page rule", () => {
  it("prints every QX55-class standard-equipment word on the single page", () => {
    const data = qx55ClassFixture();
    const model = buildRenderLayout(data, themeFor("infiniti"));
    expect(model.pages.length).toBe(1);
    const printed = norm(model.drawnStrings.join(" ")).toUpperCase();
    for (const item of Object.values(data.standardEquipment).flat()) {
      for (const w of norm(item).toUpperCase().split(" ")) expect(printed, item).toContain(w);
    }
  });

  it("holds an extreme equipment list for review on one page and never paginates", () => {
    const data = longEquipmentFixture();
    const extra: string[] = [];
    for (let i = 0; i < 400; i++) extra.push(`Extended Equipment Line ${String(i).padStart(3, "0")}`);
    const model = buildRenderLayout(
      { ...data, standardEquipment: { ...data.standardEquipment, Technology: extra } },
      themeFor("infiniti"),
    );
    expect(model.pages.length).toBe(1);
    expect(model.fit.ok).toBe(false);
    expect(pageStrings(model, 0)).toContain(PRINTED_BANNER);
  });
});

describe("dealer block", () => {
  it("omits the current listing dealer unless it is the proven original delivery dealer", () => {
    const base = hondaCrvHybridFixture();
    const proven = buildRenderLayout(base, themeFor(null));
    expect(proven.drawnStrings.some((s) => s.startsWith("SHIP TO"))).toBe(true);
    const unproven = buildRenderLayout({ ...base, dealerRole: null }, themeFor(null));
    expect(unproven.drawnStrings.some((s) => s.startsWith("SHIP TO"))).toBe(false);
    expect(unproven.drawnStrings.join(" ")).not.toContain("ABC Honda");
    expect(unproven.drawnStrings.join(" ")).not.toContain("123 Main Street");
  });
});
