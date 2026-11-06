import { describe, expect, it } from "vitest";
import { buildRenderLayout } from "./contract";
import { layoutToSvg } from "./previewSvg";
import { infinitiBenchmark, qx55ClassFixture, themeFor } from "./__fixtures__/renderData";

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

  it("draws a single page and refuses a multi-page model", () => {
    const one = layoutToSvg(buildRenderLayout(qx55ClassFixture(), themeFor("infiniti")));
    expect(one).toContain('data-page="1"');
    expect(one).not.toContain('data-page="2"');
    const doc = new DOMParser().parseFromString(one, "image/svg+xml");
    expect(Number(doc.documentElement.getAttribute("height"))).toBe(612);
    const model = buildRenderLayout(qx55ClassFixture(), themeFor("infiniti"));
    expect(() => layoutToSvg({ ...model, pages: [model.pages[0], model.pages[0]] })).toThrow(/one_page_only/);
  });

  it("is deterministic", () => {
    const again = layoutToSvg(buildRenderLayout(infinitiBenchmark(), themeFor("infiniti")));
    expect(again).toBe(svg);
  });
});
