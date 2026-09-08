import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderUsedCarStickerPdf } from "./usedCarStickerPdf.ts";
import {
  buildUsedVehicleWindowSticker,
  type UsedStickerInput,
} from "./factorySticker/lib/documents/usedVehicleWindowSticker.ts";

// vitest.config.ts aliases the pinned esm.sh pdf-lib URL to the npm package,
// so this exercises the REAL renderer — the same code the edge function runs,
// against the same library version. What it still cannot prove is the Deno
// runtime, Supabase storage, or the database writes around it.

const VIN = "JN1FV7AR5KM800521";

const content = (over: Partial<UsedStickerInput["vehicle"]> = {}) =>
  buildUsedVehicleWindowSticker({
    vehicle: {
      vin: VIN, condition: "used", year: "2019", make: "INFINITI", model: "Q50",
      trim: "3.0t LUXE", stockNumber: "P4821", mileage: 41250, price: 27887,
      engine: "3.0L V6 Twin-Turbo", transmission: "7-Speed Automatic", drivetrain: "AWD",
      exteriorColor: "Graphite Shadow", interiorColor: "Graphite",
      equipment: ["Heated Front Seats", "Moonroof", "Around View Monitor"],
      ...over,
    },
    dealer: {
      name: "Harte INFINITI", address: "1 Auto Center Dr", city: "Wallingford",
      state: "CT", zip: "06492", phone: "203-555-0100",
      docFeeEnabled: true, docFeeAmount: 895,
    },
    passportUrl: "https://app.autolabels.io/v/2019-infiniti-q50-800521",
  });

describe("used-vehicle window sticker PDF", () => {
  it("renders one 8.5x11 portrait page", async () => {
    const bytes = await renderUsedCarStickerPdf(content());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(612);
    expect(Math.round(height)).toBe(792);
  });

  it("is byte-identical for identical content", async () => {
    // fileForm decides "is this the same sticker" by SHA-256 of these bytes.
    // If this ever stops holding, every nightly sweep supersedes the published
    // sticker and mints a new version for a vehicle nobody touched.
    const a = await renderUsedCarStickerPdf(content());
    const b = await renderUsedCarStickerPdf(content());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("changes bytes when the price changes", async () => {
    const a = await renderUsedCarStickerPdf(content());
    const b = await renderUsedCarStickerPdf(content({ price: 26500 }));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("survives a record with nothing but a VIN", async () => {
    const bare = buildUsedVehicleWindowSticker({
      vehicle: { vin: VIN, condition: "used", year: null, make: null, model: null },
      dealer: {},
    });
    const bytes = await renderUsedCarStickerPdf(bare);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("renders without a QR when the listing has no slug", async () => {
    const noQr = buildUsedVehicleWindowSticker({
      vehicle: { vin: VIN, condition: "used", year: "2019", make: "INFINITI", model: "Q50", mileage: 10, price: 100 },
      dealer: { name: "Harte INFINITI" },
      passportUrl: null,
    });
    const bytes = await renderUsedCarStickerPdf(noQr);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("does not overflow the page with a long equipment list", async () => {
    const many = Array.from({ length: 200 }, (_, i) => `A rather long equipment description number ${i}`);
    const bytes = await renderUsedCarStickerPdf(content({ equipment: many }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
