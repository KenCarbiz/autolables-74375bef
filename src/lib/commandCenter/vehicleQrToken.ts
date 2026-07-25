import { fmtDate } from "./format";
import type { PackageItemStatus } from "./packageState";
import type { ReaderRow } from "./sourceReader";

// ──────────────────────────────────────────────────────────────────────
// Both vehicle QR rows measure the artifact their own link prints.
//
// `/print/vehicle-qr/:vin` mints-or-reuses ONE permanent token through
// issue_vehicle_ready_token (20260629010000:62-83) —
// dept_signoff_tokens(department='vehicle', purpose='get_ready',
// status='pending', expires_at = now() + 1 year) — and renders TWO cut-outs
// from it: the rear-glass cling and the key-fob tag (VehicleQrPrint.tsx:70-107).
// That token is the whole artifact for both rows.
//
// What they used to be derived from could not answer the question:
//
//  * "Rear Service QR" accepted ANY active qr_codes row, and qrTracking.ts only
//    ever creates window / addendum / passport tracking codes (20260620120000:13)
//    — no value there means rear service. A vehicle whose only QR was the
//    window-sticker tracking code rendered "Rear Service QR · Ready".
//  * "Key-Tag QR" required zebra_print_jobs.status = 'printed'. No call site in
//    this repo queues a key_tag job at all, and nothing anywhere advances a
//    zebra job past 'queued' — so that state had no writer, which made
//    countFinished === items.length impossible and "Ready to Market" a dead
//    branch for every vehicle in the dealership.
//
// A 'vehicle' token is deliberately never consumed by a sign-off
// (20260629080000:88 consumes only the legacy 'service' token), so `pending`
// really is the live state and not a race.
// ──────────────────────────────────────────────────────────────────────

export interface VehicleQrRow {
  department?: string | null;
  purpose?: string | null;
  status?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
}

export const isLiveVehicleQrToken = (t: VehicleQrRow, now: number = Date.now()): boolean =>
  String(t.department || "") === "vehicle" &&
  String(t.purpose || "") === "get_ready" &&
  String(t.status || "") === "pending" &&
  !!t.expires_at && new Date(String(t.expires_at)).getTime() > now;

export function vehicleQrPackageState(
  tokens: ReaderRow[],
  media: string,
  now: number = Date.now(),
): { status: PackageItemStatus; detail: string } {
  const live = tokens.find((t) => isLiveVehicleQrToken(t as VehicleQrRow, now));
  if (live) {
    const issued = fmtDate(live.created_at as string | null);
    return { status: "ready", detail: `${media} ready to print${issued ? ` · issued ${issued}` : ""}` };
  }
  if (tokens.length > 0) {
    return { status: "retry_required", detail: "Service code expired — reprint the QR sheet to re-issue it" };
  }
  return { status: "pending", detail: "Not started" };
}

/** One token, one sheet: the cling and the tag are printed together or not at all. */
export const vehicleQrInBundle = (tokens: ReaderRow[], now: number = Date.now()): boolean =>
  tokens.some((t) => isLiveVehicleQrToken(t as VehicleQrRow, now));
