import { describe, it, expect } from "vitest";
import { buildMarketPassAssessment } from "./assessment";
import { NOW, newRow, settings, usedRow } from "./__fixtures__/rows";

const dc = (row: Parameters<typeof buildMarketPassAssessment>[0]["row"]) => buildMarketPassAssessment({ row, settings: settings(), nowMs: NOW }).dataConfidence;

describe("MarketPass Data Confidence exposes the existing module's coverage as 0-100", () => {
  it("a used row with decode, attestation and recall but no inspection or provenance is limited", () => {
    const r = dc(usedRow());
    // integrity: identity_exact 1, decode confidence 1, title_checked 1, odometer_checked 0 -> 3/4 = 75
    //   (a lone listing-feed odometer is not an odometer check)
    // condition 0/4 = 0; provenance 0/4 = 0
    // documentation: recall answered 1 of 5 facts (warranty, sticker, service records, inspection evidence unknown) = 20
    // mean (75 + 0 + 0 + 20) / 4 = 23.75 -> 24
    expect(r.domainCoverage).toEqual({ integrity: 75, condition: 0, provenance: 0, documentation_safety: 20 });
    expect(r.score).toBe(24);
    expect(r.level).toBe("limited");
    expect(r.moduleVersion).toBe("data-confidence-v1.0.0");
  });

  it("a new row expects only integrity and documentation facts", () => {
    const r = dc(newRow());
    // integrity 2/2 = 100; documentation 1 of 3 (recall) = 33.3; mean (100 + 33.3) / 2 = 66.7 -> 67, moderate (>= 60)
    expect(r.domainCoverage.condition).toBeNull();
    expect(r.score).toBe(67);
    expect(r.level).toBe("moderate");
  });

  it("missing evidence lowers coverage, never raises it", () => {
    const bare = dc(usedRow({ title_verification: null, recall_status: null, recall_check: null, recall_checked_at: null, open_recall_count: null, closed_recall_count: null, mc_attributes: {} }));
    expect(bare.score).toBeLessThan(24);
    expect(bare.level).toBe("limited");
  });
});
