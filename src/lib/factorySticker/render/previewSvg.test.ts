import { describe, expect, it } from "vitest";
import { buildRenderLayout } from "./contract";
import { layoutToSvg } from "./previewSvg";
import { infinitiBenchmark, longEquipmentFixture, themeFor } from "./__fixtures__/renderData";

describe("previewSvg", () => {
  const model = buildRenderLayout(infinitiBenchmark(), themeFor("infiniti"));
  const svg = layoutToSvg(model);

  it("emits a well-formed standalone SVG document", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.tagName).toBe("svg");
  });

  it("contains the VIN, total, barcode bars and QR cells", () => {
    expect(svg).toContain("JN8AZ3NE5S9123456");
    expect(svg).toContain("$95,695.00");
    expect(svg).toContain('data-barcode="code128"');
    expect(svg).toContain('data-qr="1"');
  });

  it("escapes markup-sensitive characters and has no placeholder artifacts", () => {
    expect(svg).toContain("&amp;");
    expect(svg).not.toMatch(/\bundefined\b|\bNaN\b/);
  });

  it("stacks continuation pages vertically", () => {
    const two = layoutToSvg(buildRenderLayout(longEquipmentFixture(), themeFor("infiniti")));
    expect(two).toContain('data-page="1"');
    expect(two).toContain('data-page="2"');
    const doc = new DOMParser().parseFromString(two, "image/svg+xml");
    expect(Number(doc.documentElement.getAttribute("height"))).toBe(612 * 2 + 12);
  });

  it("is deterministic", () => {
    const again = layoutToSvg(buildRenderLayout(infinitiBenchmark(), themeFor("infiniti")));
    expect(again).toBe(svg);
  });
});
