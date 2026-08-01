import { describe, it, expect } from "vitest";
import { reconcileGetReadyAccessories, type GetReadyAccessory, type GetReadyChecklistItem } from "./api";

const item = (label: string, status = "pending"): GetReadyChecklistItem => ({
  id: label, label, category: "accessory", status, assignedTo: "",
});

describe("reconcileGetReadyAccessories", () => {
  it("queues install work for a line moved into installed equipment", () => {
    const next = reconcileGetReadyAccessories([], [], ["Ceramic Protection Package"]);
    expect(next.added).toHaveLength(1);
    expect(next.accessories[0]).toMatchObject({ productName: "Ceramic Protection Package", installed: false });
    expect(next.items.some((i) => i.label === "Install: Ceramic Protection Package" && i.status === "pending")).toBe(true);
  });

  it("retires its own pending work when a line moves to available upgrades", () => {
    const accessories: GetReadyAccessory[] = [{ productId: "addendum:vin etch", productName: "VIN Etch", installed: false }];
    const next = reconcileGetReadyAccessories(accessories, [item("Install: VIN Etch")], []);
    expect(next.accessories).toHaveLength(0);
    expect(next.retired).toHaveLength(1);
    expect(next.items).toHaveLength(0);
  });

  it("never retires an accessory that is already installed", () => {
    const accessories: GetReadyAccessory[] = [{ productId: "addendum:vin etch", productName: "VIN Etch", installed: true }];
    const next = reconcileGetReadyAccessories(accessories, [item("Install: VIN Etch", "complete")], []);
    expect(next.accessories).toEqual(accessories);
    expect(next.retired).toHaveLength(0);
    expect(next.items).toHaveLength(1);
  });

  it("leaves catalog-queued shop work alone", () => {
    const accessories: GetReadyAccessory[] = [{ productId: "prod-123", productName: "Paint Protection", installed: false }];
    const next = reconcileGetReadyAccessories(accessories, [item("Install: Paint Protection")], []);
    expect(next.accessories).toEqual(accessories);
    expect(next.retired).toHaveLength(0);
  });

  it("does not duplicate an accessory the shop already has queued", () => {
    const accessories: GetReadyAccessory[] = [{ productId: "prod-123", productName: "Paint Protection", installed: false }];
    const next = reconcileGetReadyAccessories(accessories, [item("Install: Paint Protection")], ["paint protection"]);
    expect(next.added).toHaveLength(0);
    expect(next.accessories).toHaveLength(1);
  });

  it("keeps a completed checklist item when an unrelated line is retired", () => {
    const accessories: GetReadyAccessory[] = [{ productId: "addendum:vin etch", productName: "VIN Etch", installed: false }];
    const items = [item("Install: VIN Etch", "complete"), item("Detail — interior")];
    const next = reconcileGetReadyAccessories(accessories, items, []);
    expect(next.items.map((i) => i.label)).toEqual(["Install: VIN Etch", "Detail — interior"]);
  });
});
