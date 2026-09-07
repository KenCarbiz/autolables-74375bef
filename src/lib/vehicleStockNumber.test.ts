import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vehicleStockNumber } from "./vehicleStockNumber";

// The Vehicle File header showed no stock number for a QX80 the Command
// Palette could find BY its stock number. Three readers, three different
// derivations, and the one the header used didn't look where that car's number
// was filed.

describe("the stock number is found wherever ingest filed it", () => {
  it("prefers the DMS number on the feed", () => {
    expect(vehicleStockNumber({
      mc_attributes: { stock_no: "H4821" },
      sticker_snapshot: { stock_number: "OLD-1" },
    })).toBe("H4821");
  });

  it("reads the nested dealer block MarketCheck sometimes uses", () => {
    expect(vehicleStockNumber({ mc_attributes: { dealer: { stock_no: "I21567" } } })).toBe("I21567");
  });

  it("reads sticker_snapshot.stock_number — what the Command Palette searches", () => {
    // src/components/layout/CommandPalette.tsx queries
    // sticker_snapshot->>stock_number. A header that ignored it made a car
    // findable by a number the car's own page refused to display.
    expect(vehicleStockNumber({ sticker_snapshot: { stock_number: "H4821" } })).toBe("H4821");
  });

  it("still reads the decoded block older records used", () => {
    expect(vehicleStockNumber({ sticker_snapshot: { decoded: { stock: "H4821" } } })).toBe("H4821");
  });

  it("accepts a numeric stock number from the feed", () => {
    expect(vehicleStockNumber({ mc_attributes: { stock_no: 40821 } })).toBe("40821");
  });

  it("treats blank and whitespace as absent rather than printing an empty badge", () => {
    expect(vehicleStockNumber({ mc_attributes: { stock_no: "   " }, sticker_snapshot: {} })).toBeNull();
    expect(vehicleStockNumber({ mc_attributes: { stock_no: "  H1 " } })).toBe("H1");
  });

  it("returns null for a vehicle no source carries a number for", () => {
    expect(vehicleStockNumber(null)).toBeNull();
    expect(vehicleStockNumber({})).toBeNull();
    expect(vehicleStockNumber({ mc_attributes: null, sticker_snapshot: null })).toBeNull();
  });
});

describe("the Vehicle File never hand-rolls the stock number", () => {
  const page = readFileSync(join(__dirname, "../pages/VehicleFile.tsx"), "utf8");

  // The intent, not a call count: the page may read the stock number however
  // often it needs to, but it must get the answer from this module. Asserting
  // the number of calls only pinned the shape the page happened to have, and
  // punished deriving it once and passing it down.
  it("derives it through the shared helper", () => {
    expect(page).toMatch(/import \{ vehicleStockNumber \} from "@\/lib\/vehicleStockNumber"/);
    expect(page).toMatch(/vehicleStockNumber\(/);
  });

  it("reads none of the raw fields the helper exists to reconcile", () => {
    // Any of these appearing in the page is a second derivation: it is exactly
    // how the header came to show no stock number for a car the Command
    // Palette could find by one.
    for (const field of ["mc_attributes", "sticker_snapshot", "stock_no", "decoded"]) {
      expect(page, `VehicleFile.tsx reads ${field} directly`).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("always states the stock number, including when there isn't one", () => {
    // A missing badge reads as "this screen has no stock number field".
    expect(page).toContain("Stock # not on the feed");
  });
});
