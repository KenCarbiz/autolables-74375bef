import { allowedActions, type DocumentStatus } from "@/lib/stickerStudio/documentWorkflow";
import type { Tone } from "@/components/command/CommandPrimitives";

// ──────────────────────────────────────────────────────────────────────
// The single source of truth for "will Print Complete Vehicle Packet put
// this document on paper". The Documents & Print Center derives the print
// stat cards, every row's Print Status pill, the bundle line counts, the
// bundle note AND the button's own eligibility from this one function, so
// the rail can never promise a sheet the button will not release.
//
// States:
//   releasable       — approved, holds a file, mark_printed is legal.
//   already_printed  — printed_at / print_count says it was released before.
//                      Reprinting from this screen would re-stamp the fields a
//                      regulator reads as evidence of what was posted on the
//                      car without producing new paper.
//   live_publication — published to the customer Passport. mark_printed is
//                      technically allowed from `published`, but it rewrites
//                      document_status to `printed`, which pulls the document
//                      OFF the Passport. The CT K-208 lands here on every used
//                      car: 20260724010000_autopublish_k208_on_signoff.sql
//                      publishes it the moment the inspection is signed.
//   no_file          — nothing to send to a printer yet.
//   not_printable    — draft / pending / rejected / superseded / archived.
// ──────────────────────────────────────────────────────────────────────

export type PrintReleaseState =
  | "releasable"
  | "already_printed"
  | "live_publication"
  | "no_file"
  | "not_printable";

export interface PrintableDocument {
  document_status?: string | null;
  document_type?: string | null;
  pdf_url?: string | null;
  png_url?: string | null;
  printed_at?: string | null;
  print_count?: number | null;
}

export function printReleaseState(d: PrintableDocument): PrintReleaseState {
  const status = String(d.document_status || "") as DocumentStatus;
  const hasFile = !!(d.pdf_url || d.png_url);
  const printed = status === "printed" || !!d.printed_at || Number(d.print_count || 0) > 0;
  if (printed) return "already_printed";
  if (!hasFile) return "no_file";
  if (!allowedActions(status, true).includes("mark_printed")) return "not_printable";
  if (status === "published") return "live_publication";
  return "releasable";
}

export const printReleasable = (d: PrintableDocument): boolean =>
  printReleaseState(d) === "releasable";

// Print Status pill for the documents table. `Ready` is exactly the set the
// packet button will move, so counts.ready and the button agree by construction.
export const PRINT_STATE_PILL: Record<PrintReleaseState, { label: string; tone: Tone }> = {
  releasable: { label: "Ready", tone: "emerald" },
  already_printed: { label: "Printed", tone: "blue" },
  live_publication: { label: "Published", tone: "violet" },
  no_file: { label: "Blocked", tone: "red" },
  not_printable: { label: "Blocked", tone: "red" },
};

// Why the packet button released nothing, phrased for the employee holding the
// vehicle. Derived from the same states as the counts, so the two never differ.
export function printBlockedReason(docs: PrintableDocument[]): string {
  if (docs.length === 0) return "No documents have been generated for this vehicle yet.";
  const states = docs.map(printReleaseState);
  const printed = states.filter((s) => s === "already_printed").length;
  if (printed > 0) {
    return `Every packet document has already been released to the printer (${printed} document${printed === 1 ? "" : "s"}). Reprinting is not available from this screen — open the document and print the copy you need.`;
  }
  if (states.includes("live_publication")) {
    return "The remaining documents are live on the customer Passport. Releasing them here would take them off the Passport, so print those from the document itself.";
  }
  if (states.includes("no_file")) {
    return "No approved document has a print-ready file yet. Regenerate the packet documents, then print.";
  }
  return "No document is approved for printing. Approve the packet documents first.";
}

// The bundle note under the print rail. It explains the difference between what
// the vehicle has and what the button will release, using the same states.
export function bundleNoteFor(args: {
  used: boolean;
  signedInspection: boolean;
  k208Docs: PrintableDocument[];
}): string | null {
  const { used, signedInspection, k208Docs } = args;
  if (!used) return null;
  if (!signedInspection) return "K-208 excluded until executed and signed.";
  if (k208Docs.some(printReleasable)) return null;
  if (k208Docs.length === 0) {
    return "The signed K-208 has no generated document yet, so it is not in this bundle.";
  }
  const states = k208Docs.map(printReleaseState);
  if (states.includes("already_printed")) {
    return "The K-208 has already been released to the printer, so it is not in this bundle.";
  }
  if (states.includes("live_publication")) {
    return "The signed K-208 is live on the customer Passport. Releasing it here would take it off the Passport, so print it from the document itself.";
  }
  if (states.includes("no_file")) {
    return "The signed K-208 has no print-ready file yet, so it is not in this bundle.";
  }
  return "The signed K-208 is not in a printable state, so it is not in this bundle.";
}
