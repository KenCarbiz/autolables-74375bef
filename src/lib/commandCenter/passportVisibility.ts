import type { Tone } from "@/components/command/CommandPrimitives";

// ──────────────────────────────────────────────────────────────────────
// The single source of truth for "does the customer's Vehicle Passport
// actually serve this document".
//
// The passport reads generated_documents through
// get_published_documents_public (20260620232625:63) and its WHERE clause is
// `gd.document_status = 'published'` — nothing else. `approved` and `printed`
// are internal lifecycle states no shopper ever sees, so answering with
// isPublicDoc (approved | printed | published) told the dealer a document was
// "Customer Visible", counted it on the stat card and listed it in the
// Passport Preview while /v/:slug served nothing. That is a compliance
// question answered wrongly.
//
// Curation is the second half of the answer: packet_modules (per vehicle) over
// packet_module_defaults (store-wide) can hide a published document. That is
// "Hidden" — the document is live but the dealer switched its module off — and
// it is a different fact from "Internal Only".
// ──────────────────────────────────────────────────────────────────────

export type PassportVisibilityState = "customer_visible" | "hidden" | "internal_only";

export interface PassportDocument {
  document_status?: string | null;
  document_type?: string | null;
}

/** The one predicate. `published` is the only status the passport RPC returns. */
export const passportServesDocument = (d: PassportDocument): boolean =>
  String(d.document_status || "") === "published";

/** Which packet module curates this document type on the passport. */
export const passportModuleFor = (documentType?: string | null): string =>
  String(documentType || "") === "window" ? "oemSticker" : "documents";

export function passportVisibilityState(
  d: PassportDocument,
  moduleOn: boolean,
): PassportVisibilityState {
  if (!passportServesDocument(d)) return "internal_only";
  return moduleOn ? "customer_visible" : "hidden";
}

export const passportVisible = (d: PassportDocument, moduleOn: boolean): boolean =>
  passportVisibilityState(d, moduleOn) === "customer_visible";

export const PASSPORT_VISIBILITY_PILL: Record<PassportVisibilityState, { label: string; tone: Tone }> = {
  customer_visible: { label: "Customer Visible", tone: "blue" },
  hidden: { label: "Hidden", tone: "slate" },
  internal_only: { label: "Internal Only", tone: "violet" },
};
