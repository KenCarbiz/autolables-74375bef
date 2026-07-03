import { describe, it, expect } from "vitest";
import { deriveInvoice, nextInvoiceNumber, serviceCatalogPrices } from "./invoices";
import type { GetReadyRecord } from "@/hooks/useGetReady";

const baseRecord = (overrides: Partial<GetReadyRecord> = {}): GetReadyRecord => ({
  id: "rec-1",
  storeId: "store-1",
  vin: "1FTEW1EP5NKD12345",
  stockNumber: "A1234",
  ymm: "2022 Ford F-150",
  condition: "used",
  acquiredDate: "2026-06-01",
  getReadyStartDate: "2026-06-02T00:00:00Z",
  getReadyCompleteDate: "",
  inventoryDate: "",
  items: [],
  accessoriesToInstall: [],
  inspectionRequired: false,
  inspectionComplete: false,
  assignedTechnician: "Sam",
  serviceAdvisor: "",
  roNumber: "RO-88",
  status: "in_progress",
  createdAt: "2026-06-02T00:00:00Z",
  createdBy: "user-1",
  updatedAt: "2026-06-02T00:00:00Z",
  ...overrides,
});

describe("deriveInvoice", () => {
  it("returns null when no billable work is complete", () => {
    const record = baseRecord({
      accessoriesToInstall: [{ productId: "p1", productName: "Mud Flaps", installed: false }],
      items: [{ id: "i1", label: "Reconditioning", category: "service", assignedTo: "", status: "pending" }],
    });
    expect(deriveInvoice(record, { p1: 199 })).toBeNull();
  });

  it("prices installed accessories from the product catalog", () => {
    const record = baseRecord({
      accessoriesToInstall: [
        { productId: "p1", productName: "Mud Flaps", installed: true, installedBy: "Sam", installedDate: "2026-06-03T12:00:00Z" },
        { productId: "p2", productName: "All-Weather Mats", installed: true },
        { productId: "p3", productName: "Roof Rack", installed: false },
      ],
    });
    const inv = deriveInvoice(record, { p1: 199, p2: 249.5 });
    expect(inv).not.toBeNull();
    expect(inv!.lines).toHaveLength(2);
    expect(inv!.lines[0]).toMatchObject({ kind: "accessory", label: "Mud Flaps", amount: 199 });
    expect(inv!.lines[0].detail).toContain("Sam");
    expect(inv!.total).toBe(448.5);
  });

  it("includes completed service items with their captured cost", () => {
    const record = baseRecord({
      items: [
        { id: "i1", label: "Reconditioning", category: "service", assignedTo: "", status: "complete", cost: 350, internal: true, completedBy: "Lou" },
        { id: "i2", label: "Emissions", category: "service", assignedTo: "", status: "pending", cost: 40, internal: true },
        { id: "i3", label: "Detail — interior", category: "detail", assignedTo: "", status: "complete" },
      ],
    });
    const inv = deriveInvoice(record, {});
    expect(inv!.lines).toHaveLength(1);
    expect(inv!.lines[0]).toMatchObject({ kind: "service", label: "Reconditioning", amount: 350 });
  });

  it("falls back to the service-catalog cost when the item has none", () => {
    const record = baseRecord({
      items: [{ id: "i1", label: "Key Cut", category: "service", assignedTo: "", status: "complete" }],
    });
    const inv = deriveInvoice(record, {}, { "key cut": 85 });
    expect(inv!.lines[0].amount).toBe(85);
    expect(inv!.total).toBe(85);
  });

  it("carries the vehicle identity onto the invoice", () => {
    const record = baseRecord({
      accessoriesToInstall: [{ productId: "p1", productName: "Mud Flaps", installed: true }],
    });
    const inv = deriveInvoice(record, { p1: 100 });
    expect(inv).toMatchObject({ recordId: "rec-1", vin: "1FTEW1EP5NKD12345", stockNumber: "A1234", roNumber: "RO-88" });
  });
});

describe("serviceCatalogPrices", () => {
  it("parses dollar-formatted costs and keys by lowercased name", () => {
    const prices = serviceCatalogPrices([
      { name: "Key Cut", responsible_name: "", responsible_email: "", cost: "$85" },
      { name: "Emissions", responsible_name: "", responsible_email: "", cost: "45.50" },
      { name: "Free Wash", responsible_name: "", responsible_email: "", cost: "" },
    ]);
    expect(prices).toEqual({ "key cut": 85, emissions: 45.5 });
  });
});

describe("nextInvoiceNumber", () => {
  it("uses the VIN tail and suffixes on collision", () => {
    expect(nextInvoiceNumber("1FTEW1EP5NKD12345", [])).toBe("INV-D12345");
    expect(nextInvoiceNumber("1FTEW1EP5NKD12345", ["INV-D12345"])).toBe("INV-D12345-2");
    expect(nextInvoiceNumber("1FTEW1EP5NKD12345", ["INV-D12345", "INV-D12345-2"])).toBe("INV-D12345-3");
  });
});
