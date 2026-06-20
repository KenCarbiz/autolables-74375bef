import { describe, it, expect } from "vitest";
import { mapProductsToStickerItems, type SnapshotProduct } from "./addendumMapping";
import { validateStickerPacketMatch, type PacketContext } from "./validateStickerPacketMatch";
import type { StickerData } from "./templates";

const blankSticker = (over: Partial<StickerData> = {}): StickerData => ({
  vehicleTitle: "2027 INFINITI QX60 LUXE", vin: "5N1AL1F87VC331335", stock: "I21567",
  mileage: "17", msrp: "62335", price: "58835",
  installed: [], upgrades: [], benefits: [], notes: "", qrUrl: "https://x/v/demo", ...over,
});

describe("mapProductsToStickerItems", () => {
  it("itemizes in-advertised installed items WITHOUT a price (not re-added)", () => {
    const products: SnapshotProduct[] = [{ name: "VIN Etch", price: 299, badge_type: "installed", price_in_advertised: true }];
    const m = mapProductsToStickerItems(products);
    expect(m.installed).toHaveLength(1);
    expect(m.installed[0].price).toBeFalsy();
    expect(m.includedInstalledCount).toBe(1);
    expect(m.aboveAdvertisedTotal).toBe(0);
  });

  it("prices added-above-advertised installed items as additive", () => {
    const products: SnapshotProduct[] = [{ name: "Ceramic Coating", price: 999, badge_type: "installed", price_in_advertised: false }];
    const m = mapProductsToStickerItems(products);
    expect(m.installed[0].price).toBe("999");
    expect(m.installed[0].note).toContain("above advertised");
    expect(m.aboveAdvertisedTotal).toBe(999);
  });

  it("routes optional products to upgrades, not the total", () => {
    const products: SnapshotProduct[] = [{ name: "Extended Warranty", price: 1500, badge_type: "optional" }];
    const m = mapProductsToStickerItems(products);
    expect(m.upgrades).toHaveLength(1);
    expect(m.optionalTotal).toBe(1500);
    expect(m.installed).toHaveLength(0);
  });

  it("routes zero-price items to benefits", () => {
    const m = mapProductsToStickerItems([{ name: "Lifetime Car Washes", price: 0, badge_type: "installed" }]);
    expect(m.benefits.map((b) => b.name)).toContain("Lifetime Car Washes");
  });
});

describe("validateStickerPacketMatch", () => {
  it("passes when sticker matches packet", () => {
    const products: SnapshotProduct[] = [{ name: "VIN Etch", price: 299, badge_type: "installed", price_in_advertised: true }];
    const sticker = blankSticker({ installed: [{ name: "VIN Etch", note: "included" }] });
    const ctx: PacketContext = { vin: "5N1AL1F87VC331335", stock: "I21567", products, hasDisclaimer: true, qrRequired: true, hasQr: true, documentStatus: "draft" };
    expect(validateStickerPacketMatch(sticker, ctx).status).toBe("pass");
  });

  it("blocks on VIN mismatch", () => {
    const sticker = blankSticker({ vin: "WRONGVIN0000000000" });
    const r = validateStickerPacketMatch(sticker, { vin: "5N1AL1F87VC331335" });
    expect(r.status).toBe("blocked");
    expect(r.findings.some((x) => x.field === "vin" && x.severity === "fail")).toBe(true);
  });

  it("blocks when an optional packet item is shown as installed", () => {
    const products: SnapshotProduct[] = [{ name: "Extended Warranty", price: 1500, badge_type: "optional" }];
    const sticker = blankSticker({ installed: [{ name: "Extended Warranty", price: "1500" }] });
    const r = validateStickerPacketMatch(sticker, { products });
    expect(r.status).toBe("blocked");
    expect(r.findings.some((x) => x.field === "item_type")).toBe(true);
  });

  it("warns when a packet item is missing from the sticker", () => {
    const products: SnapshotProduct[] = [{ name: "Paint Protection", price: 999, badge_type: "installed", price_in_advertised: false }];
    const r = validateStickerPacketMatch(blankSticker(), { products });
    expect(r.status).toBe("warn");
    expect(r.findings.some((x) => x.field === "item")).toBe(true);
  });

  it("blocks a required QR that is missing", () => {
    const r = validateStickerPacketMatch(blankSticker(), { qrRequired: true, hasQr: false });
    expect(r.status).toBe("blocked");
  });

  it("blocks when signed packet changed afterward", () => {
    const r = validateStickerPacketMatch(blankSticker(), { signed: true, signedAfterGenerated: true });
    expect(r.status).toBe("blocked");
    expect(r.findings.some((x) => x.field === "signed")).toBe(true);
  });
});
