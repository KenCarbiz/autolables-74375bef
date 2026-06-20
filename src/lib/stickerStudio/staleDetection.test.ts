import { describe, it, expect } from "vitest";
import { detectStale } from "./staleDetection";
import { DEFAULT_DOCUMENT_RULES } from "@/lib/documentRules";

const snap = { vin: "5N1AL1F87VC331335", stock: "I21567", price: "58835", msrp: "62335", mileage: "17", vehicleTitle: "2027 INFINITI QX60" };

describe("detectStale", () => {
  it("finds nothing when live matches the snapshot", () => {
    const live = { vin: "5N1AL1F87VC331335", stock_number: "I21567", price: 58835, mileage: 17, ymm: "2027 INFINITI QX60", mc_attributes: { msrp: 62335 }, status: "active" };
    expect(detectStale(snap, live, DEFAULT_DOCUMENT_RULES)).toHaveLength(0);
  });

  it("flags a price change as a warning", () => {
    const live = { vin: snap.vin, price: 61000, mc_attributes: { msrp: 62335 } };
    const f = detectStale(snap, live, DEFAULT_DOCUMENT_RULES);
    expect(f.find((x) => x.field === "price")?.severity).toBe("warning");
  });

  it("flags a VIN mismatch as a compliance block", () => {
    const live = { vin: "DIFFERENTVIN000000", price: 58835 };
    const f = detectStale(snap, live, DEFAULT_DOCUMENT_RULES);
    expect(f.find((x) => x.field === "vin")?.severity).toBe("compliance_block");
  });

  it("flags a sold vehicle when the rule is on", () => {
    const live = { vin: snap.vin, price: 58835, status: "sold" };
    const f = detectStale(snap, live, DEFAULT_DOCUMENT_RULES);
    expect(f.some((x) => x.field === "status")).toBe(true);
  });

  it("respects a disabled stale rule (mileage off by default)", () => {
    const live = { vin: snap.vin, price: 58835, mileage: 5000 };
    const f = detectStale(snap, live, DEFAULT_DOCUMENT_RULES);
    expect(f.some((x) => x.field === "mileage")).toBe(false);
  });
});
