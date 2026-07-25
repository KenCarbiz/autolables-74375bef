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
//   working_copy     — the pre-execution K-208 with a rendered file. INTAKE_SPEC
//                      S7: the dealer may print the UNEXECUTED form for service
//                      to work from. It goes on the paper labelled as a working
//                      copy; it is never stamped (the stamp is the record of a
//                      release) and never customer-visible (only `published` is
//                      served).
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
  | "working_copy"
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

// The pre-execution lifecycle: the states where the form exists but nobody has
// released or executed it.
const isPreReleaseStatus = (status: DocumentStatus): boolean =>
  status === "draft" || status === "pending_approval";

export function printReleaseState(d: PrintableDocument): PrintReleaseState {
  const status = String(d.document_status || "") as DocumentStatus;
  const hasFile = hasPrintableFile(d);
  const printed = status === "printed" || !!d.printed_at || Number(d.print_count || 0) > 0;
  if (printed) return "already_printed";
  if (!hasFile) return d.online_url ? "digital" : "no_file";
  if (String(d.document_type || "") === "k208" && isPreReleaseStatus(status)) return "working_copy";
  if (!allowedActions(status, true).includes("mark_printed")) return "not_printable";
  if (status === "published") return "live_publication";
  return "releasable";
}

/** Goes on the paper when the packet is released. */
export const printSheetIncludes = (d: PrintableDocument): boolean => {
  const s = printReleaseState(d);
  return s === "releasable" || s === "live_publication" || s === "working_copy";
};

/** Gets a mark_printed stamp. A strict subset of printSheetIncludes(). */
export const printReleasable = (d: PrintableDocument): boolean =>
  printReleaseState(d) === "releasable";

/** The line the print sheet prints beside a working copy, and nothing else. */
export const printSheetNoteFor = (d: PrintableDocument): string | undefined =>
  printReleaseState(d) === "working_copy" ? "Working copy — not executed" : undefined;

/**
 * What "Authorize Get Ready & Dispatch" releases to the Print Center: a
 * pre-release document holding a printable file. The K-208 is deliberately
 * excluded — pre-execution it prints only as a working copy, and approving it
 * here would let the packet stamp an unexecuted safety form as released.
 * Every released document (status -> approved) lands in printSheetIncludes.
 */
export const authorizationReleasable = (d: PrintableDocument): boolean => {
  const status = String(d.document_status || "") as DocumentStatus;
  if (!isPreReleaseStatus(status)) return false;
  if (String(d.document_type || "") === "k208") return false;
  return hasPrintableFile(d);
};

/** A pre-release document the authorization must hold back, with its reason left intact. */
export const authorizationHeldBack = (d: PrintableDocument): boolean =>
  isPreReleaseStatus(String(d.document_status || "") as DocumentStatus) && !authorizationReleasable(d);

/** A released document whose file can go back on paper as another copy. */
export const reprintable = (d: PrintableDocument): boolean =>
  printReleaseState(d) === "already_printed" && hasPrintableFile(d);

/**
 * The number the next copy wears. printed_at without a count is a legacy
 * release that still made one copy, so the floor is one copy already made.
 */
export const reprintCopyNumber = (d: PrintableDocument): number =>
  Math.max(Number(d.print_count || 0), 1) + 1;

// Print Status pill for the documents table. `Ready` is exactly the set the
// packet button puts on paper, so counts.ready, the bundle lines and the button
// agree by construction. Whether a sheet is also stamped is bookkeeping the
// employee holding the vehicle has no action to take about.
export const PRINT_STATE_PILL: Record<PrintReleaseState, { label: string; tone: Tone }> = {
  releasable: { label: "Ready", tone: "emerald" },
  live_publication: { label: "Ready", tone: "emerald" },
  working_copy: { label: "Working Copy", tone: "amber" },
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
    return `Every packet document has already been released to the printer (${printed} document${printed === 1 ? "" : "s"}). Use Reprint on a document row to print another copy.`;
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
  const onSheet = k208Docs.filter(printSheetIncludes);
  // An unexecuted K-208 on the sheet must never read as the executed form: the
  // sheet prints it, but only as a labelled working copy.
  if (onSheet.length > 0 && onSheet.every((d) => printReleaseState(d) === "working_copy")) {
    return "The K-208 prints as a working copy — it is not executed and is never shown to the customer.";
  }
  if (onSheet.length > 0) return null;
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
