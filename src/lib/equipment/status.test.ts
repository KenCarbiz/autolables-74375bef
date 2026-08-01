import { describe, it, expect } from "vitest";
import {
  equipmentTotals, proofBadge, proofDeadlineFrom, nextWorkflowStatus,
  statusFromItemType, ITEM_TYPE_BY_STATUS, PROOF_WINDOW_HOURS,
  type EquipmentItem,
} from "./status";

const item = (over: Partial<EquipmentItem>): EquipmentItem => ({
  id: "eq-1", name: "Ceramic Protection Package", price: "1495",
  customerStatus: "optional", workflowStatus: "not_applicable", displayOrder: 0, ...over,
});

describe("equipmentTotals", () => {
  const base = "29822";

  it("adds pre-installed equipment to the adjusted total and leaves optional out", () => {
    const items = [
      item({ id: "a", price: "1495", customerStatus: "pre_installed" }),
      item({ id: "b", price: "500", customerStatus: "pre_installed" }),
      item({ id: "c", price: "494", customerStatus: "optional" }),
    ];
    const t = equipmentTotals(items, base);
    expect(t.installedTotal).toBe(1995);
    expect(t.optionalTotal).toBe(494);
    expect(t.adjustedTotal).toBe(31817);
  });

  it("moving an item to pre-installed raises the adjusted total by its price", () => {
    const before = equipmentTotals([item({ customerStatus: "optional" })], base);
    const after = equipmentTotals([item({ customerStatus: "pre_installed" })], base);
    expect(after.adjustedTotal - before.adjustedTotal).toBe(1495);
  });

  it("moving it back to optional removes exactly that price again", () => {
    const installed = equipmentTotals([item({ customerStatus: "pre_installed" })], base);
    const optional = equipmentTotals([item({ customerStatus: "optional" })], base);
    expect(installed.adjustedTotal - optional.adjustedTotal).toBe(1495);
    expect(optional.adjustedTotal).toBe(29822);
  });

  it("never charges the customer for an included benefit", () => {
    const t = equipmentTotals([item({ customerStatus: "included_benefit", price: "999" })], base);
    expect(t.installedTotal).toBe(0);
    expect(t.adjustedTotal).toBe(29822);
  });

  it("does not invent an adjusted total without a base price", () => {
    expect(equipmentTotals([item({ customerStatus: "pre_installed" })], "").adjustedTotal).toBe(0);
  });
});

describe("proof workflow", () => {
  it("puts a newly pre-installed item without proof into the 96-hour window", () => {
    expect(nextWorkflowStatus("pre_installed", false)).toBe("awaiting_proof");
    const from = new Date("2026-08-01T12:00:00Z");
    expect(proofDeadlineFrom(from).toISOString()).toBe("2026-08-05T12:00:00.000Z");
    expect(PROOF_WINDOW_HOURS).toBe(96);
  });

  it("marks it verified straight away when proof already exists", () => {
    expect(nextWorkflowStatus("pre_installed", true)).toBe("verified_installed");
  });

  it("clears the workflow when the item is not pre-installed", () => {
    expect(nextWorkflowStatus("optional", false)).toBe("not_applicable");
    expect(nextWorkflowStatus("included_benefit", true)).toBe("not_applicable");
  });

  it("shows an amber awaiting badge carrying the due date", () => {
    const badge = proofBadge({ customerStatus: "pre_installed", workflowStatus: "awaiting_proof", proofDueAt: "2026-08-05T12:00:00Z" }, "UTC");
    expect(badge.tone).toBe("awaiting");
    expect(badge.label).toContain("Awaiting proof");
    expect(badge.label).toContain("Aug 5");
    expect(badge.internalOnly).toBe(true);
  });

  it("shows a verified badge, and keeps every proof badge internal", () => {
    const badge = proofBadge({ customerStatus: "pre_installed", workflowStatus: "verified_installed" });
    expect(badge.tone).toBe("verified");
    expect(badge.internalOnly).toBe(true);
  });

  it("shows an optional row as customer-safe 'Not installed'", () => {
    const badge = proofBadge({ customerStatus: "optional", workflowStatus: "not_applicable" });
    expect(badge.label).toBe("Not installed");
    expect(badge.internalOnly).toBe(false);
  });

  it("flags an item the automation demoted", () => {
    const badge = proofBadge({ customerStatus: "optional", workflowStatus: "verification_overdue" });
    expect(badge.tone).toBe("overdue");
    expect(badge.internalOnly).toBe(true);
  });
});

describe("legacy projection", () => {
  it("round-trips between customer status and item_type", () => {
    for (const status of ["pre_installed", "optional", "included_benefit"] as const) {
      expect(statusFromItemType(ITEM_TYPE_BY_STATUS[status])).toBe(status);
    }
  });

  it("treats an unknown legacy type as optional rather than charging for it", () => {
    expect(statusFromItemType(undefined)).toBe("optional");
    expect(statusFromItemType("mystery")).toBe("optional");
  });
});
