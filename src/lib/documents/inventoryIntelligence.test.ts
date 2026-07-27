import { describe, expect, it } from "vitest";
import { buildIntelligenceRow, STAGE_TONE, type VehicleIntelligenceInput } from "./inventoryIntelligence";

const base: VehicleIntelligenceInput = {
  condition: "used",
  imported: true,
  hasStoredSourceData: true,
  hasBuildSheet: true,
};

const stageFor = (row: ReturnType<typeof buildIntelligenceRow>, family: string) =>
  row.families.find((f) => f.family === family)?.stage;

describe("inventory intelligence rows", () => {
  it("reports each document family independently", () => {
    const row = buildIntelligenceRow({
      ...base,
      oemRecordStatus: "REVIEW_REQUIRED",
      oemReviewReason: "msrp_reconciliation: computed 53195 differs from stated 52700",
      documentStatuses: { ftc_buyers_guide: "approved", used_vehicle_window_sticker: "published" },
    });
    // The vehicle has an approved Buyers Guide AND a blocked OEM sticker.
    // Both must be visible; neither may be averaged away.
    expect(stageFor(row, "ftc_buyers_guide")).toBe("Approved");
    expect(stageFor(row, "used_vehicle_window_sticker")).toBe("Published");
    expect(stageFor(row, "oem_window_sticker_reproduction")).toBe("Needs Review");
    expect(row.families.find((f) => f.family === "oem_window_sticker_reproduction")?.detail)
      .toContain("msrp_reconciliation");
  });

  it("marks new-vehicle-only families not applicable on a used car", () => {
    const row = buildIntelligenceRow(base);
    expect(stageFor(row, "new_vehicle_addendum")).toBe("Not Applicable");
    expect(row.families.find((f) => f.family === "ftc_buyers_guide")?.applicability).toBe("required");
  });

  it("marks used-vehicle families not applicable on a new car", () => {
    const row = buildIntelligenceRow({ ...base, condition: "new" });
    expect(stageFor(row, "ftc_buyers_guide")).toBe("Not Applicable");
    expect(stageFor(row, "used_vehicle_window_sticker")).toBe("Not Applicable");
    expect(stageFor(row, "used_vehicle_addendum")).toBe("Not Applicable");
    expect(stageFor(row, "new_vehicle_addendum")).not.toBe("Not Applicable");
  });

  it("surfaces a required family's problem ahead of an eligible one's", () => {
    const row = buildIntelligenceRow({
      ...base,
      oemRecordStatus: "REVIEW_REQUIRED",
      documentStatuses: { ftc_buyers_guide: "rejected" },
    });
    // Both are problems; the federally required document leads.
    expect(row.blocker).toContain("FTC Buyers Guide");
  });

  it("reports no blocker when everything applicable is settled", () => {
    const row = buildIntelligenceRow({
      ...base,
      oemRecordStatus: "PUBLISHED",
      documentStatuses: {
        ftc_buyers_guide: "published",
        used_vehicle_addendum: "approved",
        used_vehicle_window_sticker: "published",
      },
    });
    expect(row.blocker).toBeNull();
  });

  it("tracks the source-data pipeline separately from the documents", () => {
    expect(buildIntelligenceRow({ ...base, hasStoredSourceData: false }).sourceStage)
      .toBe("Enrichment Pending");
    expect(buildIntelligenceRow({ ...base, hasBuildSheet: false }).sourceStage)
      .toBe("NeoVIN Complete");
    expect(buildIntelligenceRow({ ...base, imported: false }).sourceStage)
      .toBe("Not Applicable");
  });

  it("decides nothing when the vehicle's condition is unresolved", () => {
    const row = buildIntelligenceRow({ ...base, condition: "clean one owner" });
    expect(row.conditionClass).toBe("unknown");
    for (const f of row.families) expect(f.stage, f.family).toBe("Not Applicable");
  });

  it("gives every stage a tone so nothing renders unstyled", () => {
    const row = buildIntelligenceRow({ ...base, oemRecordStatus: "FAILED_PERMANENT" });
    for (const f of row.families) expect(STAGE_TONE[f.stage], f.stage).toBeTruthy();
    expect(stageFor(row, "oem_window_sticker_reproduction")).toBe("Failed");
  });
});
