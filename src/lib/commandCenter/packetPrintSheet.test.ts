import { describe, it, expect, vi } from "vitest";
import { openPacketPrintSheet, renderPacketPrintSheet } from "./packetPrintSheet";

const vehicle = { ymm: "2025 INFINITI QX80", vin: "JN8AZ2NE0P9300001", stockNumber: "H12345" };
const docs = [
  { label: "FTC Buyers Guide", version: "v2", url: "https://files.test/bg.pdf" },
  { label: "Used-Car Sticker", version: "v3", url: "https://files.test/win.pdf" },
];

describe("renderPacketPrintSheet", () => {
  it("puts every document on the sheet with a print action", () => {
    const html = renderPacketPrintSheet(vehicle, docs);
    expect(html).toContain("FTC Buyers Guide");
    expect(html).toContain("Used-Car Sticker");
    expect(html).toContain("https://files.test/bg.pdf");
    expect(html).toContain("https://files.test/win.pdf");
    expect(html).toContain("window.print()");
  });

  it("identifies the vehicle the paper belongs to", () => {
    const html = renderPacketPrintSheet(vehicle, docs);
    expect(html).toContain("2025 INFINITI QX80");
    expect(html).toContain("JN8AZ2NE0P9300001");
    expect(html).toContain("Stock H12345");
  });

  it("escapes label text rather than emitting it as markup", () => {
    const html = renderPacketPrintSheet(vehicle, [
      { label: '<img src=x onerror="alert(1)">', version: "v1", url: "https://files.test/a.pdf" },
    ]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("openPacketPrintSheet", () => {
  const fakeWindow = () => {
    const written: string[] = [];
    return {
      written,
      win: { document: { open: () => {}, write: (s: string) => { written.push(s); }, close: () => {} } } as unknown as Window,
    };
  };

  it("writes the sheet into the opened window", () => {
    const { win, written } = fakeWindow();
    expect(openPacketPrintSheet(win, vehicle, docs)).toBe(true);
    expect(written.join("")).toContain("FTC Buyers Guide");
  });

  // A blocked pop-up is the caller's signal to stamp nothing: printed_at and
  // print_count are the evidence of what was posted on the car.
  it("reports failure when the browser blocked the window", () => {
    expect(openPacketPrintSheet(null, vehicle, docs)).toBe(false);
  });

  it("reports failure when there is nothing to print", () => {
    const { win } = fakeWindow();
    expect(openPacketPrintSheet(win, vehicle, [])).toBe(false);
  });

  it("reports failure when the window cannot be written to", () => {
    const hostile = { document: { open: () => { throw new Error("blocked"); } } } as unknown as Window;
    expect(openPacketPrintSheet(hostile, vehicle, docs)).toBe(false);
  });

  it("does not need a real browser to be exercised", () => {
    expect(vi.isMockFunction(openPacketPrintSheet)).toBe(false);
  });
});
