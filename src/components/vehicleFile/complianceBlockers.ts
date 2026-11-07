import type { ComplianceFacts } from "./useComplianceFacts";
import type { ReadinessSummary, VehicleRow } from "./types";
import { recallFact } from "./statusFacts";

// ONE list of the vehicle's current compliance blockers (L05).
//
// The Overview card, the Compliance tab and the identity strip all count these
// rows, so the same vehicle can never read "Blockers (0)" on one tab and
// "Current blockers (4)" on another. Listing visibility is NOT in this list:
// the store's publishing policy lists vehicles on intake, and the only server
// gate on publishing is a do-not-drive recall (enforce_prep_gate). Whether a
// vehicle is listed is reported as its own scope, never as a blocker.

export interface ComplianceBlockerRow {
  key: string;
  item: string;
  details: string;
  evidence?: { label: string; to: string };
  when: string | null;
}

export interface ComplianceBlockers {
  /** False while the compliance facts are still loading: the count is not known yet. */
  known: boolean;
  rows: ComplianceBlockerRow[];
}

export function buildComplianceBlockers(input: {
  vehicle: Parameters<typeof recallFact>[0] & Pick<VehicleRow, "recall_checked_at">;
  ready: Pick<ReadinessSummary, "blockers">;
  cf: ComplianceFacts;
}): ComplianceBlockers {
  const { vehicle, ready, cf } = input;
  const rows: ComplianceBlockerRow[] = [];
  if (recallFact(vehicle).tone === "neutral") {
    rows.push({ key: "recall", item: "Recall status unknown", details: "No VIN-level recall check has answered.", evidence: { label: "View recall card", to: "#vf-recall-card" }, when: vehicle.recall_checked_at });
  }
  for (const b of ready.blockers.filter((c) => /recall/i.test(c.label))) {
    rows.push({ key: `ready-${b.label}`, item: b.label, details: "Blocks publishing until the service department records an outcome.", when: b.when });
  }
  if (!cf.loading) {
    if (cf.price.tone === "danger") rows.push({ key: "price", item: "Price mismatch", details: cf.price.detail ?? "", evidence: { label: "View price card", to: "#vf-price-card" }, when: cf.price.checkedAt });
    if (cf.safety.tone === "danger") rows.push({ key: "safety", item: `Safety inspection ${cf.safety.value.toLowerCase()}`, details: cf.safety.detail ?? "", evidence: { label: "View inspection", to: "#vf-forms-card" }, when: cf.safety.checkedAt });
    if (cf.delivery.tone === "warning") rows.push({ key: "delivery", item: "Delivery sign-offs incomplete", details: `${cf.delivery.value}. ${cf.delivery.detail ?? ""}`.trim(), evidence: { label: "View sign-offs", to: "#vf-delivery-card" }, when: null });
    if (cf.title.tone === "warning") rows.push({ key: "title", item: "Title missing", details: cf.title.detail ?? "", evidence: { label: "View title", to: "#vf-title-card" }, when: null });
  }
  return { known: !cf.loading, rows };
}
