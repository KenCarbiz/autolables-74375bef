// ── Sold Vehicles Summary evidence ─────────────────────────────────────────
//
// The change order (§5, add-on item 4) asks that a Sold Vehicles Summary answer
// be kept whole: what we asked, what the provider says it applied, its
// warnings and notices, how many rows it summarised, whether it truncated,
// the month window, the geography, and the statistics. The provider envelope
// carries the request side; this module normalizes the answer side so the
// trend reader and AutoCurb read one record.
//
// Every price here is the last advertised price before an inferred sale. The
// record says so in fields, not only in copy, so no consumer can mistake it
// for a transaction price.

import { buildProviderEnvelope, type ProviderResultEnvelope } from "./providerEnvelope.ts";
import type { ProviderAttemptOutcome } from "./freshness.ts";
import type { CostOverrides } from "./providerRegistry.ts";

export const SOLD_SUMMARY_MEASURES = ["price", "miles", "dom_active", "dos_active", "msrp", "mc_msrp"] as const;
export type SoldSummaryMeasure = (typeof SOLD_SUMMARY_MEASURES)[number];

export type SoldSummaryScope = "national" | "state" | "city_state";

export interface SoldSummaryStat {
  count: number | null;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  /** Percentile label ("p25", "p75", ...) to value, as the provider sent them. */
  percentiles: Record<string, number>;
}

export interface SoldSummaryRow {
  /** Ranking dimensions and grouping keys for this row (month, state, make, ...). */
  dimensions: Record<string, string | number | null>;
  /** Inferred sales in this row. */
  inferredSoldCount: number | null;
  statistics: Partial<Record<SoldSummaryMeasure, SoldSummaryStat>>;
}

export interface SoldSummaryEvidence {
  envelope: ProviderResultEnvelope;
  inventoryType: string | null;
  scope: SoldSummaryScope | null;
  /** Month-aligned window the provider actually used; falls back to the request. */
  period: { from: string | null; to: string | null; source: "applied" | "requested" | "unknown" };
  resultCount: number | null;
  truncated: boolean | null;
  rows: SoldSummaryRow[];
  /** Fixed: a sale here is inferred from a listing leaving the market. */
  saleBasis: "inferred_listing_exit";
  /** Fixed: every price is the last advertised price before the inferred sale. */
  priceBasis: "last_advertised_price";
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const SCOPES: readonly SoldSummaryScope[] = ["national", "state", "city_state"];
const scopeOf = (v: unknown): SoldSummaryScope | null => (SCOPES as readonly unknown[]).includes(v) ? (v as SoldSummaryScope) : null;

function parseStat(v: unknown): SoldSummaryStat | null {
  const o = obj(v);
  if (!o) return null;
  const percentiles: Record<string, number> = {};
  for (const [k, raw] of Object.entries(o)) {
    const m = /^(?:p|percentile_?)(\d{1,2})$/i.exec(k);
    const n = num(raw);
    if (m && n != null) percentiles[`p${m[1]}`] = n;
  }
  const nested = obj(o.percentiles);
  if (nested) for (const [k, raw] of Object.entries(nested)) {
    const n = num(raw);
    const m = /(\d{1,2})/.exec(k);
    if (m && n != null) percentiles[`p${m[1]}`] = n;
  }
  return {
    count: num(o.count),
    mean: num(o.mean ?? o.avg ?? o.average),
    median: num(o.median ?? o.p50),
    min: num(o.min),
    max: num(o.max),
    percentiles,
  };
}

function parseRow(v: unknown): SoldSummaryRow | null {
  const o = obj(v);
  if (!o) return null;
  const statistics: SoldSummaryRow["statistics"] = {};
  const dimensions: SoldSummaryRow["dimensions"] = {};
  const stats = obj(o.stats) ?? obj(o.statistics) ?? o;
  for (const m of SOLD_SUMMARY_MEASURES) {
    const s = parseStat(stats[m] ?? o[`${m}_stats`]);
    if (s) statistics[m] = s;
  }
  for (const [k, raw] of Object.entries(o)) {
    if (k === "stats" || k === "statistics" || (SOLD_SUMMARY_MEASURES as readonly string[]).includes(k) || k.endsWith("_stats")) continue;
    if (raw === null || typeof raw === "string" || typeof raw === "number") dimensions[k] = raw;
  }
  return {
    dimensions,
    inferredSoldCount: num(o.sold_count ?? o.count ?? o.total_sold ?? o.sales_count),
    statistics,
  };
}

export interface SoldSummaryInput {
  requestedFilters: Record<string, unknown>;
  body: unknown;
  fetchedAt: string;
  outcome: ProviderAttemptOutcome;
  httpStatus?: number | null;
  contractVersion?: string;
  capabilityKey?: "sold_summary" | "sold_summary_dealership_groups";
  costOverrides?: CostOverrides | null;
}

/**
 * Normalize one Sold Vehicles Summary answer. A failed or refused call keeps
 * its envelope and yields no rows, never an empty-but-successful trend.
 */
export function normalizeSoldSummary(input: SoldSummaryInput): SoldSummaryEvidence {
  const body = obj(input.body) ?? {};
  const applied = obj(body.applied);
  const succeeded = input.outcome === "succeeded";
  const rowsRaw = Array.isArray(body.data) ? body.data : Array.isArray(body.results) ? body.results : Array.isArray(body.rows) ? body.rows : [];
  const rows = succeeded ? rowsRaw.map(parseRow).filter((r): r is SoldSummaryRow => r != null) : [];
  const resultCount = succeeded ? num(body.result_count) ?? (rowsRaw.length || null) : null;
  const truncated = succeeded && typeof body.truncated === "boolean" ? body.truncated : null;

  const appliedFrom = str(applied?.date_from), appliedTo = str(applied?.date_to);
  const reqFrom = str(input.requestedFilters.date_from), reqTo = str(input.requestedFilters.date_to);
  const period: SoldSummaryEvidence["period"] = appliedFrom || appliedTo
    ? { from: appliedFrom, to: appliedTo, source: "applied" }
    : reqFrom || reqTo
      ? { from: reqFrom, to: reqTo, source: "requested" }
      : { from: null, to: null, source: "unknown" };

  const scope = scopeOf(applied?.summary_by) ?? scopeOf(input.requestedFilters.summary_by);
  const notices = [...(Array.isArray(body.notices) ? body.notices : body.notices != null ? [body.notices] : [])];
  if (truncated) notices.push("provider_truncated_result");

  const envelope = buildProviderEnvelope({
    capabilityKey: input.capabilityKey ?? "sold_summary",
    endpoint: "/v2/sold-vehicles/summary",
    contractVersion: input.contractVersion ?? "mcp-schema-2026-10-27",
    requestedFilters: input.requestedFilters,
    applied,
    warnings: body.warnings,
    notices,
    geography: scope ? { summary_by: scope, state: applied?.state ?? input.requestedFilters.state ?? null, city_state: applied?.city_state ?? input.requestedFilters.city_state ?? null } : null,
    fetchedAt: input.fetchedAt,
    outcome: input.outcome,
    httpStatus: input.httpStatus ?? null,
    sampleSize: resultCount,
    responseKeys: Object.keys(body),
    costOverrides: input.costOverrides,
  });

  return {
    envelope,
    inventoryType: str(applied?.inventory_type) ?? str(input.requestedFilters.inventory_type),
    scope,
    period,
    resultCount,
    truncated,
    rows,
    saleBasis: "inferred_listing_exit",
    priceBasis: "last_advertised_price",
  };
}
