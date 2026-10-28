import { worstOf, type CountValue, type HealthState, type HealthTone } from "@/lib/admin/health";
import { adminTabHref } from "@/lib/admin/sections";

// Data quality checks the dealer can act on. Each is a tenant-scoped count
// over active inventory with an exact destination; a count that could not be
// read stays Unavailable rather than becoming zero.

export interface DataQualityCheck {
  id: string;
  label: string;
  description: string;
  affectedOutput: string;
  destination: string;
  destinationLabel: string;
  /** A non-zero count is a problem (warning) or merely context (info). */
  severity: "warning" | "danger" | "info";
}

export const DATA_QUALITY_CHECKS: readonly DataQualityCheck[] = [
  { id: "source_conflicts", label: "Open source conflicts", description: "Exceptions raised by the feed reconciliation that no one has resolved.", affectedOutput: "Inventory accuracy", destination: "/admin/exceptions", destinationLabel: "Open exceptions", severity: "warning" },
  { id: "price_mismatch", label: "Price evidence mismatch", description: "Vehicles whose website price disagreed with the stored price at the last check.", affectedOutput: "Customer price truth", destination: adminTabHref("price-rules", "price-audit"), destinationLabel: "Review pricing", severity: "danger" },
  { id: "price_missing", label: "Price evidence missing", description: "Priced vehicles with no advertised-price observation on file.", affectedOutput: "Customer price truth", destination: adminTabHref("price-rules", "price-audit"), destinationLabel: "Review pricing", severity: "warning" },
  { id: "market_stale", label: "Stale market evidence", description: "Active vehicles whose market check is older than seven days or missing.", affectedOutput: "Market value and comparables", destination: "/inventory-intelligence", destinationLabel: "Open inventory intelligence", severity: "warning" },
  { id: "enrich_missing", label: "Market data never pulled", description: "Active vehicles that have never been enriched with market, build or history data.", affectedOutput: "Market value, exact build and history evidence", destination: "/inventory-intelligence", destinationLabel: "Open inventory intelligence", severity: "warning" },
  { id: "recall_unknown", label: "Recall not verified", description: "Active vehicles with no VIN-level recall answer.", affectedOutput: "VIN recall verification", destination: "/compliance", destinationLabel: "Open compliance", severity: "warning" },
  { id: "recall_stale", label: "Recall answer older than 30 days", description: "Active vehicles whose VIN recall check is older than its refresh window.", affectedOutput: "VIN recall verification", destination: "/compliance", destinationLabel: "Open compliance", severity: "info" },
  { id: "descriptions_blocked", label: "Descriptions blocked", description: "Description jobs that failed validation or generation.", affectedOutput: "Merchandising descriptions", destination: "/description-operations", destinationLabel: "Open descriptions", severity: "warning" },
];

export interface DataQualityRow {
  check: DataQualityCheck;
  count: CountValue;
  tone: HealthTone;
  state: HealthState;
}

export interface DataQualitySummary {
  state: HealthState;
  headline: string;
  rows: DataQualityRow[];
  unavailable: number;
}

export function summarizeDataQuality(counts: Partial<Record<string, CountValue>>): DataQualitySummary {
  const rows: DataQualityRow[] = DATA_QUALITY_CHECKS.map((check) => {
    const count = counts[check.id] ?? { kind: "failed" as const };
    let state: HealthState;
    let tone: HealthTone;
    if (count.kind === "loading") { state = "unknown"; tone = "neutral"; }
    else if (count.kind === "failed") { state = "unknown"; tone = "neutral"; }
    else if (count.value === 0) { state = "healthy"; tone = "success"; }
    else if (check.severity === "info") { state = "healthy"; tone = "info"; }
    else { state = "warning"; tone = check.severity; }
    return { check, count, tone, state };
  });
  const unavailable = rows.filter((r) => r.count.kind === "failed").length;
  const actionable = rows.filter((r) => r.count.kind === "known" && r.count.value > 0 && r.check.severity !== "info");
  const state = worstOf(rows.map((r) => r.state));
  const headline = unavailable > 0
    ? `${unavailable} ${unavailable === 1 ? "check" : "checks"} could not be read`
    : actionable.length > 0
      ? `${actionable.length} ${actionable.length === 1 ? "check needs" : "checks need"} attention`
      : "No data quality issues found in active inventory";
  return { state, headline, rows, unavailable };
}
