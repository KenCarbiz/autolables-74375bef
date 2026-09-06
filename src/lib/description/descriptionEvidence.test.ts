import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  auditEvidence, suppliedFactIds, factRoles, DESCRIPTION_OUTPUT_SCHEMA,
} from "../../../supabase/functions/_shared/description-evidence.ts";
import { buildFactSnapshot } from "../../../supabase/functions/_shared/description-core.ts";

// Structured Outputs enforces the SHAPE of a response, not its truth. A writer
// that invents a Bose system can invent the fact key it cites for it just as
// easily. So used_fact_ids is testimony, and this is the cross-examination.

const SNAP = {
  facts: {
    warranty_eligible: { usable_in_copy: true },
    equipment: { usable_in_copy: true },
    mileage: { usable_in_copy: true },
    one_owner: { usable_in_copy: false },
  },
};

const output = (o: Partial<Record<string, string[]>> = {}) => ({
  used_fact_ids: [], hero_fact_ids: [], warranty_fact_ids: [], history_fact_ids: [], ...o,
});

describe("the writer may only cite what it was handed", () => {
  it("passes when every cited fact was supplied and usable", () => {
    const a = auditEvidence(output({ used_fact_ids: ["equipment", "mileage"] }), SNAP);
    expect(a.ok).toBe(true);
    expect(a.fabricated_ids).toEqual([]);
  });

  it("catches a fact key the snapshot never contained", () => {
    // The failure Structured Outputs cannot catch: a well-formed citation of
    // a source that does not exist.
    const a = auditEvidence(output({ used_fact_ids: ["equipment", "bose_audio"] }), SNAP);
    expect(a.ok).toBe(false);
    expect(a.fabricated_ids).toEqual(["bose_audio"]);
  });

  it("catches a fact that exists but was withheld from copy", () => {
    // one_owner is in the snapshot with usable_in_copy false — excluded for a
    // reason. Citing it means an excluded claim reached the page.
    const a = auditEvidence(output({ history_fact_ids: ["one_owner"] }), SNAP);
    expect(a.ok).toBe(false);
    expect(a.unusable_ids).toEqual(["one_owner"]);
    expect(a.fabricated_ids).toEqual([]);
  });

  it("audits every role, not just used_fact_ids", () => {
    const a = auditEvidence(output({ warranty_fact_ids: ["invented_warranty"] }), SNAP);
    expect(a.fabricated_ids).toEqual(["invented_warranty"]);
  });

  it("is case- and whitespace-insensitive about a citation", () => {
    const a = auditEvidence(output({ used_fact_ids: ["  Equipment  ", "MILEAGE"] }), SNAP);
    expect(a.ok).toBe(true);
    expect(a.claimed).toEqual(["equipment", "mileage"]);
  });

  it("reports supplied facts the writer ignored without failing the audit", () => {
    // A short honest description that uses less than it was offered is fine.
    const a = auditEvidence(output({ used_fact_ids: ["equipment"] }), SNAP);
    expect(a.ok).toBe(true);
    expect(a.unclaimed_supplied).toContain("mileage");
    expect(a.unclaimed_supplied).not.toContain("one_owner");
  });

  it("treats a writer that cites nothing as passing, not as proof", () => {
    // Citing nothing is not a violation — the prose validator is what decides
    // whether the copy is supported. This audit only judges the citations.
    expect(auditEvidence(output(), SNAP).ok).toBe(true);
  });
});

describe("supplied ids come from the real snapshot builder", () => {
  const snap = buildFactSnapshot({
    vin: "JN8AZ3CC5T9624253", ymm: "2027 INFINITI QX80", condition: "used", mileage: 12408,
    mc_attributes: { year: 2027, make: "INFINITI", model: "QX80", options: ["Panoramic roof"] },
    warranty_info: { program: "INFINITI Limited", months_remaining: 44 },
  }, {}, null);

  it("offers the facts the pipeline actually built", () => {
    const ids = suppliedFactIds(snap);
    expect(ids).toContain("equipment");
    expect(ids).toContain("warranty_eligible");
  });

  it("a citation of a real generated fact passes", () => {
    expect(auditEvidence(output({ used_fact_ids: ["warranty_eligible"] }), snap).ok).toBe(true);
  });

  it("a citation of a fact this vehicle does not have fails", () => {
    expect(auditEvidence(output({ used_fact_ids: ["cpo_status"] }), snap).fabricated_ids)
      .toEqual(["cpo_status"]);
  });
});

describe("roles are recorded for the ledger", () => {
  it("splits hero, warranty and history", () => {
    expect(factRoles(output({
      hero_fact_ids: ["equipment"], warranty_fact_ids: ["warranty_eligible"],
      history_fact_ids: [],
    }))).toEqual({ hero: ["equipment"], warranty: ["warranty_eligible"], history: [] });
  });
});

describe("the output schema is strict enough for enforced structured output", () => {
  it("forbids extra properties and requires every field", () => {
    expect(DESCRIPTION_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect([...DESCRIPTION_OUTPUT_SCHEMA.required].sort()).toEqual(
      Object.keys(DESCRIPTION_OUTPUT_SCHEMA.properties).sort());
  });
});

describe("the ledger stores claims as claims", () => {
  const sql = readFileSync(join(__dirname,
    "../../../supabase/migrations/20260906030000_description_evidence_ledger.sql"), "utf8");

  it("names the column for what it holds", () => {
    // Calling it used_fact_ids would invite a later reader to trust it.
    expect(sql).toMatch(/claimed_fact_ids/);
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS used_fact_ids/);
  });

  it("keeps the cross-check beside the claim", () => {
    expect(sql).toMatch(/evidence_audit_json/);
    expect(sql).toMatch(/idx_description_versions_evidence_failed/);
  });

  it("records which knowledge revision was loaded", () => {
    expect(sql).toMatch(/knowledge_revision/);
    expect(sql).toMatch(/truth_snapshot_id/);
  });
});
