import { describe, it, expect } from "vitest";
import {
  bundleNoteFor,
  printBlockedReason,
  printReleasable,
  printReleaseState,
  PRINT_STATE_PILL,
  type PrintableDocument,
} from "./printRelease";

const doc = (over: Partial<PrintableDocument> = {}): PrintableDocument => ({
  document_type: "buyers_guide",
  document_status: "approved",
  pdf_url: "https://files.test/doc.pdf",
  ...over,
});

describe("printReleaseState", () => {
  it("releases an approved document that holds a file", () => {
    expect(printReleaseState(doc())).toBe("releasable");
    expect(printReleasable(doc())).toBe(true);
  });

  it("accepts a png-only document", () => {
    expect(printReleasable(doc({ pdf_url: null, png_url: "https://files.test/d.png" }))).toBe(true);
  });

  it("reports a missing file rather than a lifecycle problem", () => {
    expect(printReleaseState(doc({ pdf_url: null, png_url: null }))).toBe("no_file");
  });

  it("never re-releases a document that was already printed", () => {
    expect(printReleaseState(doc({ document_status: "printed" }))).toBe("already_printed");
    expect(printReleaseState(doc({ printed_at: "2026-07-01T00:00:00Z" }))).toBe("already_printed");
    expect(printReleaseState(doc({ print_count: 2 }))).toBe("already_printed");
  });

  it("holds a published document off the bundle so it stays on the Passport", () => {
    expect(printReleaseState(doc({ document_status: "published" }))).toBe("live_publication");
    expect(printReleasable(doc({ document_status: "published" }))).toBe(false);
  });

  it("excludes states with no mark_printed transition", () => {
    for (const s of ["draft", "pending_approval", "rejected", "superseded", "archived"]) {
      expect(printReleaseState(doc({ document_status: s }))).toBe("not_printable");
    }
  });

  it("gives every state a pill, and only releasable ones read Ready", () => {
    expect(PRINT_STATE_PILL.releasable.label).toBe("Ready");
    expect(PRINT_STATE_PILL.no_file.label).toBe("Blocked");
    expect(PRINT_STATE_PILL.not_printable.label).toBe("Blocked");
    expect(PRINT_STATE_PILL.already_printed.label).not.toBe("Ready");
    expect(PRINT_STATE_PILL.live_publication.label).not.toBe("Ready");
  });
});

// 20260724010000_autopublish_k208_on_signoff publishes the K-208 the instant
// the safety inspection is signed. The bundle rail and the packet button must
// agree about it in that exact case.
describe("the signed K-208", () => {
  const k208Published = doc({ document_type: "k208", document_status: "published" });

  it("is not releasable once the trigger has published it", () => {
    expect(printReleasable(k208Published)).toBe(false);
  });

  it("explains itself in the bundle note instead of silently vanishing", () => {
    const note = bundleNoteFor({ used: true, signedInspection: true, k208Docs: [k208Published] });
    expect(note).toMatch(/Passport/);
    expect(note).not.toBe("K-208 excluded until executed and signed.");
  });

  it("does not tell the employee the packet already printed", () => {
    expect(printBlockedReason([k208Published])).not.toMatch(/already been released/);
    expect(printBlockedReason([k208Published])).toMatch(/Passport/);
  });

  it("still counts in the bundle when the doc is approved and unprinted", () => {
    const approved = doc({ document_type: "k208" });
    expect(printReleasable(approved)).toBe(true);
    expect(bundleNoteFor({ used: true, signedInspection: true, k208Docs: [approved] })).toBeNull();
  });
});

describe("bundleNoteFor", () => {
  it("says nothing on a new car", () => {
    expect(bundleNoteFor({ used: true, signedInspection: false, k208Docs: [] }))
      .toBe("K-208 excluded until executed and signed.");
    expect(bundleNoteFor({ used: false, signedInspection: false, k208Docs: [] })).toBeNull();
  });

  it("keeps the unsigned wording the compliance copy expects", () => {
    expect(bundleNoteFor({ used: true, signedInspection: false, k208Docs: [] }))
      .toBe("K-208 excluded until executed and signed.");
  });

  it("names the missing document when the inspection is signed but nothing was generated", () => {
    expect(bundleNoteFor({ used: true, signedInspection: true, k208Docs: [] }))
      .toMatch(/no generated document/);
  });

  it("names an already-printed K-208", () => {
    expect(bundleNoteFor({
      used: true, signedInspection: true,
      k208Docs: [doc({ document_type: "k208", document_status: "printed" })],
    })).toMatch(/already been released/);
  });

  it("names a K-208 that has no file yet", () => {
    expect(bundleNoteFor({
      used: true, signedInspection: true,
      k208Docs: [doc({ document_type: "k208", pdf_url: null, png_url: null })],
    })).toMatch(/no print-ready file/);
  });
});

describe("printBlockedReason", () => {
  it("distinguishes an empty vehicle from a blocked one", () => {
    expect(printBlockedReason([])).toMatch(/No documents have been generated/);
  });

  it("reports a genuine reprint truthfully", () => {
    expect(printBlockedReason([doc({ document_status: "printed" })])).toMatch(/already been released/);
  });

  it("asks for a regenerate when the file is missing", () => {
    expect(printBlockedReason([doc({ pdf_url: null, png_url: null })])).toMatch(/print-ready file/);
  });

  it("asks for approval when nothing is approved", () => {
    expect(printBlockedReason([doc({ document_status: "draft" })])).toMatch(/approved for printing/);
  });
});
