import { describe, it, expect } from "vitest";
import { generateZpl } from "./useZebraPrint";

const STOCK = "A12345";
const VIN = "1HGCM82633A123456";
const YMM = "2024 Honda Accord";

describe("generateZpl", () => {
  it("wraps every label in the ZPL start/end markers", () => {
    for (const type of ["stock_number", "vin_barcode", "key_tag"]) {
      const zpl = generateZpl(STOCK, VIN, YMM, type);
      expect(zpl.startsWith("^XA")).toBe(true);
      expect(zpl.trimEnd().endsWith("^XZ")).toBe(true);
    }
  });

  it("renders the stock-number label with a VIN barcode and VIN text", () => {
    const zpl = generateZpl(STOCK, VIN, YMM, "stock_number");
    expect(zpl).toContain(`^FD${STOCK}^FS`);
    expect(zpl).toContain(`^BCN,80,Y,N,N^FD${VIN}^FS`);
    expect(zpl).toContain(`^FDVIN: ${VIN}^FS`);
    expect(zpl).toContain(`^FD${YMM}^FS`);
  });

  it("renders the vin_barcode label barcode-first with stock text", () => {
    const zpl = generateZpl(STOCK, VIN, YMM, "vin_barcode");
    expect(zpl).toContain(`^BCN,100,Y,N,N^FD${VIN}^FS`);
    expect(zpl).toContain(`^FDStock: ${STOCK}^FS`);
  });

  it("renders the compact key_tag label (stock + ymm, no barcode)", () => {
    const zpl = generateZpl(STOCK, VIN, YMM, "key_tag");
    expect(zpl).toContain(`^FD${STOCK}^FS`);
    expect(zpl).toContain(`^FD${YMM}^FS`);
    expect(zpl).not.toContain("^BC");
  });

  it("defaults to the key_tag layout for an unknown label type", () => {
    expect(generateZpl(STOCK, VIN, YMM, "nonsense")).toBe(generateZpl(STOCK, VIN, YMM, "key_tag"));
  });
});
