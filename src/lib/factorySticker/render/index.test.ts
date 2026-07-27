import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { FACTORY_STICKER_RENDERER_VERSION, renderFactorySticker } from "./index";
import {
  genericDecodeFixture,
  infinitiBenchmark,
  longEquipmentFixture,
  newConditionBenchmark,
  noEpaFixture,
  themeFor,
} from "./__fixtures__/renderData";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("renderFactorySticker (orchestrator contract)", () => {
  it("exports renderer version 1.0.0", () => {
    expect(FACTORY_STICKER_RENDERER_VERSION).toBe("1.0.0");
  });

  it("satisfies the orchestrator QA invariants", async () => {
    const data = infinitiBenchmark();
    const result = await renderFactorySticker(data, themeFor("infiniti"));
    expect(result.layout.drawnStrings).toContain(data.vin);
    expect(data.barcodePayload).toBe(data.vin);
    expect(data.passportUrl).toBe("https://autolabels.io/v/demo-qx80");
    expect(result.layout.pages).toBeGreaterThanOrEqual(1);
    expect(result.layout.pages).toBeLessThanOrEqual(2);
    expect(new TextDecoder().decode(result.pdfBytes.slice(0, 5))).toBe("%PDF-");
    expect(result.previewSvg.startsWith("<svg")).toBe(true);
  });

  it("is fully deterministic end to end", async () => {
    const a = await renderFactorySticker(infinitiBenchmark(), themeFor("infiniti"));
    const b = await renderFactorySticker(infinitiBenchmark(), themeFor("infiniti"));
    expect(sha256(a.pdfBytes)).toBe(sha256(b.pdfBytes));
    expect(a.previewSvg).toBe(b.previewSvg);
    expect(a.layout).toEqual(b.layout);
  });

  it("reports two pages for the long-equipment fixture", async () => {
    const result = await renderFactorySticker(longEquipmentFixture(), themeFor("infiniti"));
    expect(result.layout.pages).toBe(2);
  });

  it("labels generic decodes instead of asserting them", async () => {
    const result = await renderFactorySticker(genericDecodeFixture(), themeFor("infiniti"));
    expect(result.layout.drawnStrings.some((s) => s.includes("TYPICAL FACTORY CONFIGURATION"))).toBe(true);
    expect(result.layout.drawnStrings.some((s) => s.includes("saved VIN-specific factory-build data"))).toBe(false);
    expect(result.layout.drawnStrings.some((s) => s.includes("typical factory-configuration data"))).toBe(true);
  });

  it("falls back to the AutoLabels theme for unknown makes", async () => {
    const data = { ...infinitiBenchmark(), identity: { year: "2026", make: "Zoomcar", model: "Roadster", trim: null } };
    const result = await renderFactorySticker(data, themeFor(null));
    expect(result.layout.drawnStrings.some((s) => s.includes("AUTOLABELS"))).toBe(true);
    expect(result.layout.pages).toBe(1);
  });
});

const WRITE_SAMPLES = !!process.env.WRITE_SAMPLES;
const SAMPLES_DIR =
  "/tmp/claude-0/-home-user-autolables-74375bef/4bd5b04c-fe84-5e26-8567-dd019c94e8b0/scratchpad/sticker-samples";

describe.runIf(WRITE_SAMPLES)("sample sticker PDFs (WRITE_SAMPLES=1)", () => {
  it("writes the sample matrix to the scratchpad", async () => {
    mkdirSync(SAMPLES_DIR, { recursive: true });
    const samples: Array<[string, Parameters<typeof renderFactorySticker>]> = [
      ["infiniti-benchmark-used", [infinitiBenchmark(), themeFor("infiniti")]],
      ["infiniti-new-monroney", [newConditionBenchmark(), themeFor("infiniti")]],
      [
        "ford-f150",
        [
          {
            ...infinitiBenchmark(),
            vin: "1FTFW1E58PFA10234",
            barcodePayload: "1FTFW1E58PFA10234",
            identity: { year: "2025", make: "Ford", model: "F-150", trim: "Lariat" },
            passportUrl: "https://autolabels.io/v/demo-f150",
          },
          themeFor("ford"),
        ],
      ],
      [
        "tesla-no-barcode",
        [
          {
            ...noEpaFixture(),
            vin: "5YJ3E1EA8PF123456",
            barcodePayload: "5YJ3E1EA8PF123456",
            identity: { year: "2025", make: "Tesla", model: "Model 3", trim: "Long Range" },
            passportUrl: "https://autolabels.io/v/demo-model3",
          },
          themeFor("tesla"),
        ],
      ],
      ["long-equipment-continuation", [longEquipmentFixture(), themeFor("infiniti")]],
      [
        "fallback-unknown-make",
        [
          {
            ...infinitiBenchmark(),
            identity: { year: "2026", make: "Zoomcar", model: "Roadster GT", trim: null },
          },
          themeFor(null),
        ],
      ],
    ];
    for (const [name, [data, theme]] of samples) {
      const result = await renderFactorySticker(data, theme);
      const path = `${SAMPLES_DIR}/${name}.pdf`;
      writeFileSync(path, result.pdfBytes);
      writeFileSync(`${SAMPLES_DIR}/${name}.svg`, result.previewSvg);
      const doc = await PDFDocument.load(result.pdfBytes);
      console.log(
        `[sample] ${path} pages=${doc.getPageCount()} bytes=${result.pdfBytes.length} sha256=${sha256(result.pdfBytes)}`,
      );
      expect(doc.getPageCount()).toBe(result.layout.pages);
    }
  });
});
