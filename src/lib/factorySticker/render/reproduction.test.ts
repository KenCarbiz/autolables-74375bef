import { describe, expect, it } from "vitest";
import { buildRenderLayout, type FactoryStickerRenderData } from "./contract";
import {
  hondaCrvHybridFixture,
  infinitiBenchmark,
  longEquipmentFixture,
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
  ["long equipment (continuation pages)", longEquipmentFixture, "infiniti"],
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

describe("continuation pages", () => {
  it("prints every standard-equipment item somewhere; nothing is silently dropped", () => {
    const data = longEquipmentFixture();
    const model = buildRenderLayout(data, themeFor("infiniti"));
    const printed = norm(model.drawnStrings.join(" ")).toUpperCase();
    const items = Object.values(data.standardEquipment).flat();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const words = norm(item).toUpperCase().split(" ");
      // Wrapped items break between words, so check each word survives.
      for (const w of words) expect(printed, item).toContain(w);
    }
    expect(model.pages.length).toBeGreaterThan(2);
    const last = model.pages.length;
    expect(pageStrings(model, last - 1)).toContain(`PAGE ${last} OF ${last}`);
  });

  it("paginates an extreme equipment list without truncation", () => {
    const data = longEquipmentFixture();
    const extra: string[] = [];
    for (let i = 0; i < 400; i++) extra.push(`Extended Equipment Line ${String(i).padStart(3, "0")}`);
    const model = buildRenderLayout(
      { ...data, standardEquipment: { ...data.standardEquipment, Technology: extra } },
      themeFor("infiniti"),
    );
    const printed = model.drawnStrings.join("\n");
    for (const line of extra) expect(printed).toContain(line);
    for (let i = 0; i < model.pages.length; i++) {
      expect(pageStrings(model, i)).toContain(PRINTED_BANNER);
    }
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
