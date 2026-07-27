import { describe, expect, it } from "vitest";
import { buildStickerBlockers, hasBlockingIssue } from "./blockers";

const byCode = (blockers: ReturnType<typeof buildStickerBlockers>, code: string) =>
  blockers.find((b) => b.code === code);

describe("dealer-facing blockers", () => {
  it("reports nothing for a clean record", () => {
    expect(buildStickerBlockers({
      generationStatus: "PUBLISHED",
      reconciliationStatus: "MATCHED",
      qaMetadata: { checks: { vin_drawn: true, barcode_is_vin: true, qr_is_canonical_passport: true } },
    })).toEqual([]);
  });

  it("explains a missing build sheet as a retrieval, not a correction", () => {
    const b = byCode(buildStickerBlockers({ missingSourceData: true }), "MISSING_SOURCE_DATA");
    expect(b?.severity).toBe("blocking");
    expect(b?.correctionPermitted).toBe(false);
    expect(b?.requiredPermission).toBe("window_sticker.refresh_neovin");
    expect(b?.recommendedResolution).toContain("provider charge");
  });

  it("turns the raw reconciliation code into an amount and a resolution", () => {
    const b = byCode(buildStickerBlockers({
      reconciliationStatus: "REVIEW_REQUIRED",
      reconciliationDifference: 495,
      reviewReason: "msrp_reconciliation: computed 53195 differs from stated 52700",
      sourceProvider: "neovin",
      sourceRetrievedAt: "2026-07-27T10:00:00Z",
    }), "OEM_PRICING_MISMATCH");
    expect(b?.affectedField).toBe("Total MSRP");
    expect(b?.currentValue).toContain("$495");
    expect(b?.conflictingValue).toContain("computed 53195");
    expect(b?.source).toBe("neovin");
    expect(b?.retrievedAt).toBe("2026-07-27T10:00:00Z");
    expect(b?.requiredPermission).toBe("window_sticker.override_source_data");
    // The customer document never shows the discrepancy.
    expect(b?.recommendedResolution).toContain("never printed on the customer document");
  });

  it("treats a minor variance as a warning, not a block", () => {
    const blockers = buildStickerBlockers({
      reconciliationStatus: "MINOR_VARIANCE", reconciliationDifference: 5,
    });
    expect(blockers[0].severity).toBe("warning");
    expect(hasBlockingIssue(blockers)).toBe(false);
  });

  it("distinguishes a make conflict from an unsupported make", () => {
    const conflict = byCode(buildStickerBlockers({
      qaMetadata: { selection: { status: "conflict", reasons: ["Chevrolet vs GMC"] } },
    }), "OEM_TEMPLATE_CONFLICT");
    expect(conflict?.title).toContain("disagree");
    expect(conflict?.affectedField).toBe("Make");

    const unsupported = buildStickerBlockers({
      qaMetadata: { selection: { status: "unsupported", reasons: ["no registered template"] } },
    })[0];
    expect(unsupported.code).toBe("OEM_TEMPLATE_UNSUPPORTED");
    expect(unsupported.title).toContain("No OEM template");
  });

  it("lists the specific content a rendered document is missing", () => {
    const b = byCode(buildStickerBlockers({
      qaMetadata: {
        completeness: {
          code: "LAYOUT_OVERFLOW",
          missing: [
            { label: "Avenir Technology Package — Head-Up Display" },
            { label: "Avenir Technology Package — Speed Limit Recognition" },
          ],
        },
      },
    }), "LAYOUT_OVERFLOW");
    expect(b?.currentValue).toBe("2 items not printed");
    expect(b?.affectedField).toContain("Head-Up Display");
  });

  it("flags a duplicated package as correctable at the source", () => {
    const b = byCode(buildStickerBlockers({
      qaMetadata: { completeness: { miscounted: [{ label: "Package Tow Package listed once", actualCount: 2 }] } },
    }), "PDF_VALIDATION_FAILED");
    expect(b?.correctionPermitted).toBe(true);
    expect(b?.currentValue).toBe("2×");
    expect(b?.conflictingValue).toBe("expected exactly once");
    expect(b?.recommendedResolution).toContain("double-price");
  });

  it("reports each failed identity check separately", () => {
    const blockers = buildStickerBlockers({
      qaMetadata: { checks: { vin_drawn: true, barcode_is_vin: false, qr_is_canonical_passport: false } },
    });
    expect(blockers.map((b) => b.code).sort())
      .toEqual(["QA_BARCODE_IS_VIN", "QA_QR_IS_CANONICAL_PASSPORT"]);
    expect(byCode(blockers, "QA_QR_IS_CANONICAL_PASSPORT")?.affectedField).toBe("Passport URL");
  });

  it("lets a condition conflict be corrected but not a disabled setting", () => {
    const conflict = buildStickerBlockers({
      qaMetadata: { eligibility: { status: "ineligible_condition_conflict", reasons: ["new vs used"] } },
    })[0];
    expect(conflict.correctionPermitted).toBe(true);
    expect(conflict.affectedField).toContain("Condition");

    const off = buildStickerBlockers({
      qaMetadata: { eligibility: { status: "ineligible_used", reasons: ["turned off"] } },
    })[0];
    expect(off.correctionPermitted).toBe(false);
  });

  it("surfaces an unrecognised review reason verbatim rather than hiding it", () => {
    const blockers = buildStickerBlockers({
      reviewRequired: true, reviewReason: "something the UI has no reading for",
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].code).toBe("REVIEW_REQUIRED");
    expect(blockers[0].currentValue).toBe("something the UI has no reading for");
  });

  it("does not add the catch-all when a specific blocker already explains it", () => {
    const blockers = buildStickerBlockers({
      reviewRequired: true,
      reviewReason: "msrp_reconciliation: ...",
      reconciliationStatus: "REVIEW_REQUIRED",
      reconciliationDifference: 100,
    });
    expect(blockers.map((b) => b.code)).toEqual(["OEM_PRICING_MISMATCH"]);
  });

  it("reports several independent problems at once", () => {
    const blockers = buildStickerBlockers({
      missingSourceData: true,
      reconciliationStatus: "REVIEW_REQUIRED",
      reconciliationDifference: 250,
      qaMetadata: {
        selection: { status: "manual_review", reasons: ["model year missing"] },
        geometry: { code: "LAYOUT_OVERFLOW", reasons: ["rendered 3 pages"] },
      },
    });
    expect(blockers.length).toBe(4);
    expect(hasBlockingIssue(blockers)).toBe(true);
  });
});
