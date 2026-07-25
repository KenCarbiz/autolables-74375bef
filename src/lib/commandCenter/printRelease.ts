import { allowedActions, type DocumentStatus } from "@/lib/stickerStudio/documentWorkflow";
import { safeDocumentUrl } from "./packetPrintSheet";
import type { Tone } from "@/components/command/CommandPrimitives";

// ──────────────────────────────────────────────────────────────────────
// Two different questions about one document, kept apart on purpose:
//
//   printSheetIncludes() — will "Print Complete Vehicle Packet" put this on
//                          paper? All that takes is a printable file.
//   printReleasable()    — is mark_printed a legal and meaningful transition
//                          for it? That is a lifecycle question about
//                          printed_at / print_count, the fields a regulator
//                          reads as evidence of what was posted on the car.
//
// Conflating them excluded the signed K-208 — the single most legally required
// sheet on a used car — from the packet of every used car, because
// 20260724010000_autopublish_k208_on_signoff publishes it the moment service
// signs and mark_printed from `published` would pull it back OFF the Passport.
// It goes on the paper; it simply is not stamped.
//
// States:
//   releasable       — approved, holds a file, mark_printed is legal.
//   live_publication — published to the customer Passport and holds a file.
//                      Prints with the packet; never stamped, so it stays live.
//   already_printed  — printed_at / print_count says it was released before.
//   digital          — no printable file, but a live online_url. A `passport`
//                      document is a web page, not a sheet of paper; calling it
//                      Blocked put a red pill on the row whose Internal Status
//                      read Published and whose Passport Visibility read
//                      Customer Visible.
//   no_file          — nothing to send to a printer and nowhere to read it.
//   not_printable    — draft / pending / rejected / superseded / archived.
// ──────────────────────────────────────────────────────────────────────

export type PrintReleaseState =
  | "releasable"
  | "live_publication"
  | "already_printed"
  | "digital"
  | "no_file"
  | "not_printable";

export interface PrintableDocument {
  document_status?: string | null;
  document_type?: string | null;
  pdf_url?: string | null;
  png_url?: string | null;
  online_url?: string | null;
  printed_at?: string | null;
  print_count?: number | null;
}

// "Has a printable file" is ONE question, answered by the allowlist the sheet
// itself applies. Accepting any non-empty pdf_url put a green `Ready` pill and a
// Ready count on rows the sheet drops — a relative storage path such as
// "vehicle-docs/abc.pdf" cannot resolve in the about:blank window the packet is
// written into — so the rail promised a sheet the button could not deliver.
const hasPrintableFile = (d: PrintableDocument): boolean =>
  !!safeDocumentUrl(String(d.pdf_url || "")) || !!safeDocumentUrl(String(d.png_url || ""));

export function printReleaseState(d: PrintableDocument): PrintReleaseState {
  const status = String(d.document_status || "") as DocumentStatus;
  const hasFile = hasPrintableFile(d);
  const printed = status === "printed" || !!d.printed_at || Number(d.print_count || 0) > 0;
  if (printed) return "already_printed";
  if (!hasFile) return d.online_url ? "digital" : "no_file";
  if (!allowedActions(status, true).includes("mark_printed")) return "not_printable";
  if (status === "published") return "live_publication";
  return "releasable";
}

/** Goes on the paper when the packet is released. */
export const printSheetIncludes = (d: PrintableDocument): boolean => {
  const s = printReleaseState(d);
  return s === "releasable" || s === "live_publication";
};

/** Gets a mark_printed stamp. A strict subset of printSheetIncludes(). */
export const printReleasable = (d: PrintableDocument): boolean =>
  printReleaseState(d) === "releasable";

// Print Status pill for the documents table. `Ready` is exactly the set the
// packet button puts on paper, so counts.ready, the bundle lines and the button
// agree by construction. Whether a sheet is also stamped is bookkeeping the
// employee holding the vehicle has no action to take about.
export const PRINT_STATE_PILL: Record<PrintReleaseState, { label: string; tone: Tone }> = {
  releasable: { label: "Ready", tone: "emerald" },
  live_publication: { label: "Ready", tone: "emerald" },
  already_printed: { label: "Printed", tone: "blue" },
  digital: { label: "Digital", tone: "blue" },
  no_file: { label: "Blocked", tone: "red" },
  not_printable: { label: "Blocked", tone: "red" },
};

// Why the packet button put nothing on paper, phrased for the employee holding
// the vehicle. Derived from the same states as the counts, so the two never differ.
export function printBlockedReason(docs: PrintableDocument[]): string {
  if (docs.length === 0) return "No documents have been generated for this vehicle yet.";
  const states = docs.map(printReleaseState);
  const printed = states.filter((s) => s === "already_printed").length;
  // "Every packet document" has to mean every one of them. It used to fire
  // whenever ANY document was already printed, so a set of one printed sticker
  // and three documents with no file at all was reported as a completed packet.
  if (printed > 0 && printed === states.length) {
    return `Every packet document has already been released to the printer (${printed} document${printed === 1 ? "" : "s"}). Reprinting is not available from this screen — open the document and print the copy you need.`;
  }
  if (states.includes("digital")) {
    return "This vehicle's live documents are online links with no print-ready file. Open them from the document list — there is nothing for a printer to take.";
  }
  if (states.includes("no_file")) {
    return "No approved document has a print-ready file yet. Regenerate the packet documents, then print.";
  }
  return "No document is approved for printing. Approve the packet documents first.";
}

// The bundle note under the print rail. It explains the difference between what
// the vehicle has and what the button will put on paper, using the same states.
export function bundleNoteFor(args: {
  used: boolean;
  signedInspection: boolean;
  k208Docs: PrintableDocument[];
}): string | null {
  const { used, signedInspection, k208Docs } = args;
  if (!used) return null;
  // Presence on the sheet is decided FIRST, because it is the only thing this
  // note is about. 20260724010000 publishes the K-208 on any signed row without
  // consulting `result`, so a signed-but-FAILED inspection leaves
  // signedInspection false while a published K-208 with a pdf_url is on the
  // paper — the card said "excluded" while Letter Paper counted it, counts.ready
  // counted it and the button printed it. signedInspection only ever EXPLAINS an
  // absence.
  if (k208Docs.some(printSheetIncludes)) return null;
  if (!signedInspection) return "K-208 excluded until executed and signed.";
  if (k208Docs.length === 0) {
    return "The signed K-208 has no generated document yet, so it is not in this bundle.";
  }
  const states = k208Docs.map(printReleaseState);
  if (states.includes("already_printed")) {
    return "The K-208 has already been released to the printer, so it is not in this bundle.";
  }
  if (states.includes("digital")) {
    return "The signed K-208 is an online document with no print-ready file, so it is not in this bundle.";
  }
  if (states.includes("no_file")) {
    return "The signed K-208 has no print-ready file yet, so it is not in this bundle.";
  }
  return "The signed K-208 is not in a printable state, so it is not in this bundle.";
}
