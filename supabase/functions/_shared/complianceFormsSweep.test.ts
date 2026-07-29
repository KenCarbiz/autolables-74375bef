import { describe, it, expect } from "vitest";
import { findVehiclesNeedingForms } from "./complianceFormsSweep.ts";

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

  it("skips a vehicle whose forms are both filed", async () => {
    const { admin } = makeAdmin({
      vehicle_listings: [listing("l1", "VIN1")],
      generated_documents: [
        { vehicle_id: "l1", document_type: "buyers_guide", online_url: "https://f/bg.pdf", pdf_url: null },
        { vehicle_id: "l1", document_type: "k208", online_url: null, pdf_url: "https://f/k.pdf" },
      ],
    });
    expect(await findVehiclesNeedingForms(admin, "t1", 100)).toEqual([]);
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
