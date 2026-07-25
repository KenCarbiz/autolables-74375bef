// Client mirror of submit_safety_inspection's guard chain
// (20260726100000_service_qr_hub_token_fix.sql), so the QR station can explain
// an outcome before/without a round-trip and the rule stays testable in CI.
// The SQL is authoritative; this module must match it — k208SqlTruth.test.ts
// pins the SQL side of the same rules.

import { isExecutedSignoff, type SafetyInspectionRow } from "@/lib/commandCenter/inspectionState";

export type SubmitRefusal =
  | "not_found"
  | "used_or_revoked"
  | "expired"
  | "wrong_department"
  | "inspector_name_required"
  | "already_completed";

export interface SignoffTokenRow {
  department?: string | null;
  status?: string | null;
  expires_at?: string | null;
}

export interface SubmitOutcome {
  ok: boolean;
  reason?: SubmitRefusal;
  /** Only the legacy single-use 'service' token is consumed; the hub lives on. */
  consumesToken: boolean;
}

export function inspectionSubmitOutcome(
  token: SignoffTokenRow | null | undefined,
  existingRows: SafetyInspectionRow[],
  inspectorName: string,
  now: Date = new Date(),
): SubmitOutcome {
  const refuse = (reason: SubmitRefusal): SubmitOutcome => ({ ok: false, reason, consumesToken: false });
  if (!token) return refuse("not_found");
  if (String(token.status || "") !== "pending") return refuse("used_or_revoked");
  if (token.expires_at && new Date(token.expires_at) <= now) return refuse("expired");
  const dept = String(token.department || "");
  if (dept !== "service" && dept !== "vehicle") return refuse("wrong_department");
  if (!inspectorName.trim()) return refuse("inspector_name_required");
  if (existingRows.some(isExecutedSignoff)) return refuse("already_completed");
  return { ok: true, consumesToken: dept === "service" };
}
