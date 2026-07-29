// How many records the Documents page can put in front of a shopper right
// now. Derived, never a literal: the badge and the Document Status panel both
// read this, and a hard-coded 3 or 4 goes wrong the moment a dealer excludes
// a module or a harvest lands.
//
// An external link counts. The owner's manual and the OEM brochure live on
// the manufacturer's site by design -- we hold the URL and deliberately do
// not ingest the file -- and a record the shopper can open in one click is
// available whether or not we are storing its bytes.

export interface AvailableDocumentsInput {
  /** Documents stored on the vehicle and already filtered for curation. */
  uploadedCount: number;
  /** The generated factory build record, when one is published. */
  hasFactoryRecord: boolean;
  /**
   * Resolved external URLs (history report, brochure, owner's manual, OEM
   * sticker). Callers pass null for a module the dealer excluded or a link
   * that failed validation, so only real destinations are counted here.
   */
  externalLinks: (string | null | undefined)[];
}

export function countAvailableDocuments(input: AvailableDocumentsInput): number {
  const external = input.externalLinks.filter((u) => typeof u === "string" && u.trim().length > 0).length;
  return Math.max(0, input.uploadedCount) + external + (input.hasFactoryRecord ? 1 : 0);
}
