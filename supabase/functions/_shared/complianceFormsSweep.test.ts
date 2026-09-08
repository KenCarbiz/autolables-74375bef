import { describe, it, expect } from "vitest";
import {
  WINDOW_MAX_EMPTY_RENDERS, documentIsSettled, findVehiclesNeedingForms,
} from "./complianceFormsSweep.ts";

type Row = Record<string, unknown>;

// Minimal PostgREST-shaped fake: every builder method returns `this`, and the
// awaited result is whatever was queued for that table.
function makeAdmin(tables: Record<string, Row[]>) {
  const calls: Record<string, Row[][]> = {};
  const admin = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = new Proxy(q, {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: { data: Row[] }) => unknown) =>
              resolve({ data: tables[table] || [] });
          }
          return (...args: unknown[]) => {
            (calls[table] ||= []).push(args as Row[]);
            return chain;
          };
        },
      });
      return chain;
    },
  };
  return { admin, calls };
}

describe("findVehiclesNeedingForms", () => {
  const listing = (id: string, vin: string, condition = "used") =>
    ({ id, tenant_id: "t1", vin, condition });

  it("selects a vehicle whose form rows exist but hold no file", async () => {
    // The exact regression: presence of the row is not proof of a PDF.
    const { admin } = makeAdmin({
      vehicle_listings: [listing("l1", "VIN1")],
      generated_documents: [
        { vehicle_id: "l1", document_type: "buyers_guide", online_url: null, pdf_url: null },
        { vehicle_id: "l1", document_type: "k208", online_url: "", pdf_url: null },
      ],
    });
    expect(await findVehiclesNeedingForms(admin, "t1", 100))
      .toEqual([{ tenant_id: "t1", vin: "VIN1" }]);
  });

  it("skips a vehicle whose forms and window sticker are all filed", async () => {
    const { admin } = makeAdmin({
      vehicle_listings: [listing("l1", "VIN1")],
      generated_documents: [
        { vehicle_id: "l1", document_type: "buyers_guide", online_url: "https://f/bg.pdf", pdf_url: null },
        { vehicle_id: "l1", document_type: "k208", online_url: null, pdf_url: "https://f/k.pdf" },
        { vehicle_id: "l1", document_type: "window", pdf_url: "https://f/w.pdf", online_url: null, data_snapshot: { equipment_count: 12 } },
      ],
    });
    expect(await findVehiclesNeedingForms(admin, "t1", 100)).toEqual([]);
  });

  it("selects a vehicle whose window sticker was never rendered", async () => {
    // The measured production state: create_draft_window_sticker minted the
    // row at ingest, nothing rendered it, and no sweep looked at it.
    const { admin } = makeAdmin({
      vehicle_listings: [listing("l1", "VIN1")],
      generated_documents: [
        { vehicle_id: "l1", document_type: "buyers_guide", online_url: "https://f/bg.pdf", pdf_url: null },
        { vehicle_id: "l1", document_type: "k208", online_url: null, pdf_url: "https://f/k.pdf" },
        { vehicle_id: "l1", document_type: "window", online_url: null, pdf_url: null },
      ],
    });
    expect(await findVehiclesNeedingForms(admin, "t1", 100))
      .toEqual([{ tenant_id: "t1", vin: "VIN1" }]);
  });

  it("sweeps the pre-owned condition spellings a feed writes", async () => {
    const { admin } = makeAdmin({
      vehicle_listings: [listing("l1", "VIN1", "Pre-Owned"), listing("l2", "VIN2", "Certified Pre-Owned")],
      generated_documents: [],
    });
    expect(await findVehiclesNeedingForms(admin, "t1", 100)).toEqual([
      { tenant_id: "t1", vin: "VIN1" },
      { tenant_id: "t1", vin: "VIN2" },
    ]);
  });

  it("selects a vehicle that has one filed form and one missing entirely", async () => {
    const { admin } = makeAdmin({
      vehicle_listings: [listing("l1", "VIN1")],
      generated_documents: [
        { vehicle_id: "l1", document_type: "buyers_guide", online_url: "https://f/bg.pdf", pdf_url: null },
      ],
    });
    expect(await findVehiclesNeedingForms(admin, "t1", 100))
      .toEqual([{ tenant_id: "t1", vin: "VIN1" }]);
  });

  it("selects a vehicle with no document rows at all", async () => {
    const { admin } = makeAdmin({
      vehicle_listings: [listing("l1", "VIN1")],
      generated_documents: [],
    });
    expect(await findVehiclesNeedingForms(admin, "t1", 100))
      .toEqual([{ tenant_id: "t1", vin: "VIN1" }]);
  });

  it("ignores new cars — the Buyers Guide and K-208 are used-vehicle forms", async () => {
    const { admin } = makeAdmin({
      vehicle_listings: [listing("l1", "VIN1", "new")],
      generated_documents: [],
    });
    expect(await findVehiclesNeedingForms(admin, "t1", 100)).toEqual([]);
  });

  it("treats cpo and certified as used, and a blank condition as used", async () => {
    const { admin } = makeAdmin({
      vehicle_listings: [
        listing("l1", "VIN1", "cpo"),
        listing("l2", "VIN2", "CERTIFIED"),
        { id: "l3", tenant_id: "t1", vin: "VIN3", condition: null },
      ],
      generated_documents: [],
    });
    expect(await findVehiclesNeedingForms(admin, "t1", 100)).toEqual([
      { tenant_id: "t1", vin: "VIN1" },
      { tenant_id: "t1", vin: "VIN2" },
      { tenant_id: "t1", vin: "VIN3" },
    ]);
  });

  it("drops rows with no tenant or no VIN rather than sweeping them", async () => {
    const { admin } = makeAdmin({
      vehicle_listings: [
        { id: "l1", tenant_id: null, vin: "VIN1", condition: "used" },
        { id: "l2", tenant_id: "t1", vin: null, condition: "used" },
      ],
      generated_documents: [],
    });
    expect(await findVehiclesNeedingForms(admin, null, 100)).toEqual([]);
  });

  it("returns nothing when there are no published used vehicles", async () => {
    const { admin } = makeAdmin({ vehicle_listings: [], generated_documents: [] });
    expect(await findVehiclesNeedingForms(admin, "t1", 100)).toEqual([]);
  });
});

describe("documentIsSettled", () => {
  const doc = (over: Record<string, unknown>) =>
    ({ vehicle_id: "l1", document_type: "window", online_url: null, pdf_url: "https://f/w.pdf", ...over }) as Parameters<typeof documentIsSettled>[0];

  it("is never settled without a file, whatever the type", () => {
    expect(documentIsSettled(doc({ pdf_url: null, online_url: "" }))).toBe(false);
    expect(documentIsSettled(doc({ document_type: "k208", pdf_url: null, online_url: null }))).toBe(false);
  });

  it("settles a government form the moment it points at a file", () => {
    // The Buyers Guide and K-208 have no equipment; only the sticker does.
    expect(documentIsSettled(doc({ document_type: "buyers_guide", data_snapshot: {} }))).toBe(true);
  });

  it("re-queues a window sticker rendered before the VIN decode landed", () => {
    expect(documentIsSettled(doc({ data_snapshot: { equipment_count: 0, render_attempts: 1 } }))).toBe(false);
    expect(documentIsSettled(doc({ data_snapshot: { equipment_count: 9, render_attempts: 1 } }))).toBe(true);
  });

  it("stops re-queueing a VIN that simply cannot be decoded", () => {
    expect(documentIsSettled(doc({
      data_snapshot: { equipment_count: 0, render_attempts: WINDOW_MAX_EMPTY_RENDERS },
    }))).toBe(true);
  });
});
