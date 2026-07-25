// ──────────────────────────────────────────────────────────────────────
// One derivation of the CT K-208 for every command surface.
//
// Re-inspections are first class (20260723020000_safety_inspection_revisions),
// so a vehicle carries several safety_inspections rows. The VIN Command Center
// used to read "newest by created_at" and the Print Center "newest signed by
// signed_at": a pending re-inspection masked the signed original on one screen
// and not the other, and the bundle note contradicted the package row.
//
// Order of truth:
//   1. a SIGNED failure is the newest word on the car and blocks it, even if an
//      earlier pass exists — that is what a re-inspection failing means;
//   2. otherwise any signed non-failing inspection is the executed K-208;
//   3. otherwise an existing row is prefilled work awaiting the inspector;
//   4. otherwise nothing has started.
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
  /** Newest row with status 'signed' whose result is not 'fail'. */
  signed: SafetyInspectionRow | null;
  /** Newest non-voided row of any status. */
  latest: SafetyInspectionRow | null;
}

/** A result only fails the car once an inspector has signed it. */
export const isFailedInspection = (r: SafetyInspectionRow | null | undefined): boolean =>
  !!r && String(r.status || "") === "signed" && String(r.result || "") === "fail";

export const isExecutedInspection = (r: SafetyInspectionRow | null | undefined): boolean =>
  !!r && String(r.status || "") === "signed" && String(r.result || "") !== "fail";

export function k208State({ signed, latest }: K208Sources): { state: K208State; at: string | null } {
  if (isFailedInspection(latest)) return { state: "failed", at: latest?.signed_at || latest?.created_at || null };
  if (isExecutedInspection(signed)) return { state: "signed", at: signed?.signed_at || signed?.created_at || null };
  if (latest) return { state: "prefilled", at: latest.created_at || null };
  return { state: "not_started", at: null };
}
