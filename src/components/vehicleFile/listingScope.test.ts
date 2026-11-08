// L05 regression tests: listing visibility and retail readiness are separate
// scopes, and the Overview / Compliance / strip all count one blocker list.
import { describe, it, expect } from "vitest";
import { buildComplianceBlockers } from "./complianceBlockers";
import { readinessSummary, type VehicleRow } from "./types";
import type { ComplianceFacts } from "./useComplianceFacts";
import { listingScopeLine, prepScopeCopy } from "./listingScope";

const vehicle = (o: Partial<VehicleRow> = {}): VehicleRow => ({
  id: "v1", tenant_id: "t1", vin: "5N1DL1ES4RC334645", ymm: "2024 INFINITI QX60", condition: "cpo", status: "published",
  published_at: "2026-11-07T03:30:13Z", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-07T00:00:00Z",
  recall_status: null, open_recall_count: null, recall_check: null, recall_payload: null, recall_checked_at: null,
  prep_status: null, documents: [], service_records: [], warranty_info: null, available_accessories: [],
  ...o,
} as unknown as VehicleRow);

const cf = (o: Partial<ComplianceFacts> = {}): ComplianceFacts => ({
  loading: false,
  price: { label: "Price consistency", value: "No issues detected", tone: "success", checkedAt: null },
  safety: { label: "Safety inspection", value: "Not executed", tone: "danger", detail: "Inspection not yet completed.", checkedAt: null },
  delivery: { label: "Delivery requirements", value: "0 / 3 complete", tone: "warning" },
  title: { label: "Title & registration", value: "Missing", tone: "warning", checkedAt: null },
  ...o,
});

describe("L05 — scoped listing vs readiness", () => {
  it("not being listed is not a readiness blocker", () => {
    const r = readinessSummary(vehicle({ status: "draft" }));
    expect(r.blockers.map((b) => b.label)).not.toContain("Listed on shopper portal");
    expect(r.blockers.some((b) => /publish|listed/i.test(b.label))).toBe(false);
  });

  it("Overview and Compliance count the same compliance blockers (QX60 …334645 shape)", () => {
    const v = vehicle();
    const ready = readinessSummary(v);
    const b = buildComplianceBlockers({ vehicle: v, ready, cf: cf() });
    expect(b.known).toBe(true);
    // recall unknown + safety + delivery + title = 4, as the audit observed.
    expect(b.rows.map((r) => r.key)).toEqual(["recall", "safety", "delivery", "title"]);
  });

  it("while compliance facts load, the count is unknown — never a false zero", () => {
    const v = vehicle({ recall_check: { source: "marketcheck", scope: "vin", has_open: false, open_recall_count: 0, checked_at: new Date().toISOString() } } as Partial<VehicleRow>);
    const b = buildComplianceBlockers({ vehicle: v, ready: readinessSummary(v), cf: cf({ loading: true }) });
    expect(b.known).toBe(false);
  });

  it("listing copy follows the listing-on-intake policy and never calls prep a listing gate", () => {
    expect(listingScopeLine("published", true)).toMatch(/lists vehicles on intake/);
    expect(listingScopeLine("published", false)).toMatch(/A person published it/);
    const copy = prepScopeCopy({ published: true, prepSignedOff: false, ingestAutoPublish: true });
    expect(copy.summary).toBe("Listed · prep sign-off pending");
    expect(copy.detail).toMatch(/does not control the public listing/);
    expect(copy.detail).toMatch(/do-not-drive recall/);
    expect(`${copy.title} ${copy.summary} ${copy.detail}`).not.toMatch(/gates the public listing|unlock/i);
  });
});
