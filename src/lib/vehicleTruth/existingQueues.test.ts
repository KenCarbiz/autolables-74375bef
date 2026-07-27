import { describe, expect, it } from "vitest";
import {
  conflictException,
  documentTypesForFamily,
  familiesForDocumentType,
  staleFlagsForFamily,
  TRUTH_CONFLICT_EXCEPTION_TYPE,
} from "./existingQueues";
import type { FieldChange } from "./materialChange";
import type { FactConflict } from "./snapshot";

const change = (over: Partial<FieldChange> = {}): FieldChange => ({
  field: "pricing.baseMsrp",
  label: "Base MSRP",
  previous: 101710,
  next: 102500,
  affects: ["oem_window_sticker_reproduction"],
  ...over,
});

describe("matching stored document types", () => {
  it("includes the legacy names production actually holds", () => {
    // Production has buyers_guide (144), window (92), k208 (17) — matching
    // only the canonical documentType would flag nothing at all.
    expect(documentTypesForFamily("ftc_buyers_guide")).toContain("buyers_guide");
    expect(documentTypesForFamily("used_vehicle_window_sticker")).toContain("window");
    expect(documentTypesForFamily("oem_window_sticker_reproduction")).toContain("factory_sticker");
  });

  it("resolves a stored type back to its families", () => {
    expect(familiesForDocumentType("buyers_guide")).toEqual(["ftc_buyers_guide"]);
    expect(familiesForDocumentType("window")).toEqual(["used_vehicle_window_sticker"]);
    // "addendum" is genuinely ambiguous without the vehicle's condition.
    expect(familiesForDocumentType("addendum").length).toBe(2);
  });

  it("returns nothing for an unknown or empty type", () => {
    expect(familiesForDocumentType("")).toEqual([]);
    expect(familiesForDocumentType("not_a_document")).toEqual([]);
  });
});

describe("stale flags from snapshot changes", () => {
  it("flags only the families a change actually affects", () => {
    const changes = [change()];
    expect(staleFlagsForFamily("oem_window_sticker_reproduction", changes, 4)).toHaveLength(1);
    expect(staleFlagsForFamily("ftc_buyers_guide", changes, 4)).toEqual([]);
  });

  it("writes the shape stale_document_flags already uses", () => {
    const [row] = staleFlagsForFamily("oem_window_sticker_reproduction", [change()], 4);
    expect(row.changed_field).toBe("pricing.baseMsrp");
    expect(row.old_value).toBe(101710);
    expect(row.new_value).toBe(102500);
    expect(row.severity).toBe("warning");
    expect(row.reason).toContain("Base MSRP");
    expect(row.reason).toContain("v4");
  });

  it("treats an identity break as a compliance block, not a reprint", () => {
    const rows = staleFlagsForFamily("ftc_buyers_guide", [change({
      field: "condition", label: "New/used classification",
      previous: "used", next: "new", affects: ["ftc_buyers_guide"],
    })], 2);
    expect(rows[0].severity).toBe("compliance_block");
  });

  it("summarises a list rather than dumping 361 equipment items into a queue row", () => {
    const [row] = staleFlagsForFamily("oem_window_sticker_reproduction", [change({
      field: "equipment.standard", label: "Standard equipment",
      previous: ["a", "b"], next: ["a", "b", "c"],
      affects: ["oem_window_sticker_reproduction"],
    })], 3);
    expect(row.old_value).toBe("2 items");
    expect(row.new_value).toBe("3 items");
  });

  it("keeps a dealer price change away from the manufacturer document", () => {
    const changes = [change({
      field: "pricing.advertisedPrice", label: "Advertised price",
      affects: ["used_vehicle_window_sticker", "description", "passport"],
    })];
    expect(staleFlagsForFamily("oem_window_sticker_reproduction", changes, 5)).toEqual([]);
    expect(staleFlagsForFamily("used_vehicle_window_sticker", changes, 5)).toHaveLength(1);
  });

  it("produces nothing when no material field moved", () => {
    expect(staleFlagsForFamily("ftc_buyers_guide", [], 1)).toEqual([]);
  });
});

describe("conflicts into the exception queue", () => {
  const conflict = (over: Partial<FactConflict> = {}): FactConflict => ({
    factKey: "base_msrp",
    authority: "manufacturer",
    candidates: [
      { value: 101710, sourceKind: "neovin", confidence: "VERIFIED", observedAt: null },
      { value: 99500, sourceKind: "dealer_confirmed", confidence: "VERIFIED", observedAt: null },
    ],
    blocksGeneration: true,
    ...over,
  });

  it("raises nothing when there are no conflicts", () => {
    expect(conflictException([], 1)).toBeNull();
  });

  it("accumulates every disputed fact into one row per vehicle", () => {
    const row = conflictException([
      conflict(),
      conflict({ factKey: "trim", authority: "shared", blocksGeneration: false }),
    ], 3)!;
    expect(row.exception_type).toBe(TRUTH_CONFLICT_EXCEPTION_TYPE);
    expect(row.source_values.fields).toEqual(["base_msrp", "trim"]);
    expect(row.explanation).toContain("base_msrp");
    expect(row.explanation).toContain("trim");
  });

  it("escalates severity when generation is blocked", () => {
    expect(conflictException([conflict()], 1)!.severity).toBe("high");
    expect(conflictException([conflict({ blocksGeneration: false })], 1)!.severity).toBe("medium");
  });

  it("names the disagreeing sources so a manager can act without digging", () => {
    const row = conflictException([conflict()], 1)!;
    expect(row.explanation).toContain("neovin");
    expect(row.explanation).toContain("dealer_confirmed");
    expect(row.recommended_action).toMatch(/confirm the correct value/i);
  });

  it("does not claim a printed document must be regenerated", () => {
    // Staleness is decided by what changed, not by a disagreement existing.
    expect(conflictException([conflict()], 1)!.requires_new_document).toBe(false);
  });

  it("keeps the full candidate detail for the drawer", () => {
    const row = conflictException([conflict()], 7)!;
    const stored = row.source_values.conflicts as Array<Record<string, unknown>>;
    expect(row.source_values.snapshot_version).toBe(7);
    expect(stored[0].authority).toBe("manufacturer");
    expect((stored[0].candidates as unknown[]).length).toBe(2);
  });
});
