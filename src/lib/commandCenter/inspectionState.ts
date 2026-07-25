// ──────────────────────────────────────────────────────────────────────
// One derivation of the CT K-208, and one definition of "signed and not
// failed", for every command surface.
//
// Re-inspections are first class (20260723020000_safety_inspection_revisions),
// safety_inspections carries no unique key on VIN (20260629000000:53),
// ServiceDesk.tsx:296 inserts a new signed row per inspection and
// 20260722180000:60 inserts prefilled `pending` rows — so a vehicle routinely
// holds several rows in several statuses.
//
// The failure test therefore has to be asked of the newest SIGNED row, not the
// newest row of any status. Asking it of "newest row" meant a signed pass in
// January + a signed FAILURE in February + a prefilled revision in March
// resolved to the January pass: the screen read "Ready · Signed Jan 12" and
// counted the item as finished over a failed inspection.
//
// Order of truth:
//   1. the newest signed row wins outright — a signed failure is the newest
//      word on the car and blocks it, even if an earlier pass exists;
//   2. otherwise an existing row is prefilled work awaiting the inspector;
//   3. otherwise nothing has started.
// ──────────────────────────────────────────────────────────────────────

export interface SafetyInspectionRow {
  id?: string | null;
  status?: string | null;
  result?: string | null;
  signed_at?: string | null;
  created_at?: string | null;
}

export type K208State = "signed" | "failed" | "prefilled" | "not_started";

export interface K208Sources {
  /** Newest row with status 'signed', WHATEVER its result. */
  latestSigned: SafetyInspectionRow | null;
  /** Newest non-voided row of any status. */
  latest: SafetyInspectionRow | null;
}

/**
 * The one definition of "a sign-off that stands". `result` is nullable on both
 * safety_inspections and pdi_signoffs (20260629013549:12), so a legacy signed
 * row with no recorded result counts; only an explicit 'fail' does not. The
 * PDI side used to require result === 'pass' and silently dropped those legacy
 * rows — same fact, two rules.
 */
export const isExecutedSignoff = (r: SafetyInspectionRow | null | undefined): boolean =>
  !!r && String(r.status || "") === "signed" && String(r.result || "") !== "fail";

/** A result only fails the car once an inspector has signed it. */
export const isFailedInspection = (r: SafetyInspectionRow | null | undefined): boolean =>
  !!r && String(r.status || "") === "signed" && String(r.result || "") === "fail";

export const isExecutedInspection = isExecutedSignoff;

/**
 * Reduce a signed-rows query (any order, many rows per VIN) to the set of VINs
 * whose NEWEST signed row is an executed sign-off. Set-style consumers
 * (NextStepBanner, Ready Board) previously counted ANY signed row, so a signed
 * FAIL — or a stale pass behind a newer signed failure — read as done.
 */
export function executedVinSet(rows: (SafetyInspectionRow & { vin?: string | null })[]): Set<string> {
  const newestByVin = new Map<string, SafetyInspectionRow>();
  for (const r of rows) {
    const vin = String(r.vin || "");
    if (!vin || String(r.status || "") !== "signed") continue;
    const prev = newestByVin.get(vin);
    const at = r.signed_at || r.created_at || "";
    const prevAt = prev ? prev.signed_at || prev.created_at || "" : "";
    if (!prev || at >= prevAt) newestByVin.set(vin, r);
  }
  const out = new Set<string>();
  for (const [vin, row] of newestByVin) if (isExecutedSignoff(row)) out.add(vin);
  return out;
}

export function k208State({ latestSigned, latest }: K208Sources): { state: K208State; at: string | null } {
  if (isFailedInspection(latestSigned)) {
    return { state: "failed", at: latestSigned?.signed_at || latestSigned?.created_at || null };
  }
  if (isExecutedSignoff(latestSigned)) {
    return { state: "signed", at: latestSigned?.signed_at || latestSigned?.created_at || null };
  }
  if (latest) return { state: "prefilled", at: latest.created_at || null };
  return { state: "not_started", at: null };
}
