import { fmtDate } from "./format";
import type { PackageItemStatus } from "./packageState";

// ──────────────────────────────────────────────────────────────────────
// One reading of the Zebra key-tag queue for both surfaces.
//
// zebra_print_jobs.status is CHECK ('queued','printing','printed','failed')
// (20260517020000:37). Only `printed` used to be special-cased on the VIN
// screen, so a FAILED job reported as "Queued" — while the Print Center's
// bundle line already excluded failed jobs. Same fact, two rules.
//
// There is no printed_at column on the table, so the queue time is never
// presented as the print time.
// ──────────────────────────────────────────────────────────────────────

export interface LabelJobRow {
  label_type?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface KeyTagState {
  status: PackageItemStatus;
  detail: string;
}

const keyTagJobs = (jobs: LabelJobRow[]): LabelJobRow[] =>
  jobs.filter((j) => String(j.label_type || "") === "key_tag");

export function keyTagState(jobs: LabelJobRow[]): KeyTagState {
  const kt = keyTagJobs(jobs);
  if (kt.length === 0) return { status: "pending", detail: "Not started" };
  const printed = kt.find((j) => String(j.status || "") === "printed");
  if (printed) return { status: "ready", detail: `Printed · queued ${fmtDate(printed.created_at)}`.trim() };
  const open = kt.find((j) => String(j.status || "") !== "failed");
  if (open) return { status: "created", detail: `Queued ${fmtDate(open.created_at)}`.trim() };
  const failed = kt[0];
  return { status: "retry_required", detail: `Print failed ${fmtDate(failed.created_at)} — send it to the printer again`.trim() };
}

/**
 * Whether the packet bundle carries a key tag. One tag per vehicle: counting
 * every queued job made a label reprinted three times read as three tags.
 * Derived from the SAME state the VIN screen prints, so a failed job cannot be
 * an exception on one screen and an item in the bundle on the other.
 */
export function keyTagInBundle(jobs: LabelJobRow[]): boolean {
  const s = keyTagState(jobs).status;
  return s === "ready" || s === "created";
}
