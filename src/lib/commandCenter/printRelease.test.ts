import { describe, it, expect } from "vitest";
import {
  authorizationReleasable,
  bundleNoteFor,
  printBlockedReason,
  printReleasable,
  printReleaseState,
  printSheetIncludes,
  PRINT_STATE_PILL,
  reprintable,
  reprintCopyNumber,
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
    expect(printSheetIncludes(doc())).toBe(true);
  });

  it("accepts a png-only document", () => {
    expect(printReleasable(doc({ pdf_url: null, png_url: "https://files.test/d.png" }))).toBe(true);
  });

  it("reports a missing file rather than a lifecycle problem", () => {
    expect(printReleaseState(doc({ pdf_url: null, png_url: null }))).toBe("no_file");
  });

  // P4: a published `passport` document holds only an online_url. Calling that
  // "no file" put a red Blocked pill and a +1 on the Blocked stat card on the
  // row whose Internal Status read Published and whose Passport Visibility read
  // Customer Visible — three answers to one question in one row.
  it("calls an online-only document Digital, not Blocked", () => {
    const online = doc({ document_type: "passport", document_status: "published", pdf_url: null, png_url: null, online_url: "https://dealer.test/v/qx80" });
    expect(printReleaseState(online)).toBe("digital");
    expect(PRINT_STATE_PILL[printReleaseState(online)].label).toBe("Digital");
    expect(printSheetIncludes(online)).toBe(false);
  });

  it("never re-releases a document that was already printed", () => {
    expect(printReleaseState(doc({ document_status: "printed" }))).toBe("already_printed");
    expect(printReleaseState(doc({ printed_at: "2026-07-01T00:00:00Z" }))).toBe("already_printed");
    expect(printReleaseState(doc({ print_count: 2 }))).toBe("already_printed");
    expect(printSheetIncludes(doc({ print_count: 2 }))).toBe(false);
  });

  it("excludes states with no mark_printed transition", () => {
    for (const s of ["draft", "pending_approval", "rejected", "superseded", "archived"]) {
      expect(printReleaseState(doc({ document_status: s }))).toBe("not_printable");
      expect(printSheetIncludes(doc({ document_status: s }))).toBe(false);
    }
  });

  // W5: "can this go on paper" and "is mark_printed a legal transition" are two
  // questions. Conflating them excluded the signed K-208 — the single most
  // legally required sheet on a used car — from the packet of every used car.
  it("puts a published document on the paper without stamping it", () => {
    const published = doc({ document_status: "published" });
    expect(printReleaseState(published)).toBe("live_publication");
    expect(printSheetIncludes(published)).toBe(true);
    expect(printReleasable(published)).toBe(false);
  });

  it("keeps the stamp set a strict subset of the sheet set", () => {
    const all = [
      doc(), doc({ document_status: "published" }), doc({ document_status: "printed" }),
      doc({ document_status: "draft" }), doc({ pdf_url: null, png_url: null }),
      doc({ pdf_url: null, png_url: null, online_url: "https://dealer.test/v/x" }),
    ];
    for (const d of all) {
      if (printReleasable(d)) expect(printSheetIncludes(d)).toBe(true);
    }
  });

  it("gives every state a pill, and the on-paper pills are exactly the sheet set", () => {
    const all: PrintableDocument[] = [
      doc(), doc({ document_status: "published" }), doc({ document_status: "printed" }),
      doc({ document_status: "draft" }), doc({ pdf_url: null, png_url: null }),
      doc({ pdf_url: null, png_url: null, online_url: "https://dealer.test/v/x" }),
      doc({ document_type: "k208", document_status: "draft" }),
    ];
    for (const d of all) {
      const label = PRINT_STATE_PILL[printReleaseState(d)].label;
      expect(label === "Ready" || label === "Working Copy").toBe(printSheetIncludes(d));
    }
    expect(PRINT_STATE_PILL.no_file.label).toBe("Blocked");
    expect(PRINT_STATE_PILL.not_printable.label).toBe("Blocked");
  });
});

// B6b — the pre-execution K-208 working copy. INTAKE_SPEC S7: the dealer may
// print an UNEXECUTED K-208 for service to work from. It goes on the paper
// labelled as a working copy; it is never stamped (stamping is the record of a
// release) and never customer-visible (only `published` is served).
describe("the K-208 working copy", () => {
  const workingCopy = doc({ document_type: "k208", document_status: "draft" });

  it("is its own state, on the sheet but never stamped", () => {
    expect(printReleaseState(workingCopy)).toBe("working_copy");
    expect(printSheetIncludes(workingCopy)).toBe(true);
    expect(printReleasable(workingCopy)).toBe(false);
    expect(PRINT_STATE_PILL.working_copy.label).toBe("Working Copy");
  });

  it("covers pending_approval too, and only with a real file", () => {
    expect(printReleaseState(doc({ document_type: "k208", document_status: "pending_approval" }))).toBe("working_copy");
    expect(printReleaseState(doc({ document_type: "k208", document_status: "draft", pdf_url: null, png_url: null }))).toBe("no_file");
  });

  it("is only ever the K-208 — other drafts stay not printable", () => {
    expect(printReleaseState(doc({ document_status: "draft" }))).toBe("not_printable");
  });

  it("yields to the executed lifecycle: printed and published K-208s keep their states", () => {
    expect(printReleaseState(doc({ document_type: "k208", document_status: "published" }))).toBe("live_publication");
    expect(printReleaseState(doc({ document_type: "k208", document_status: "draft", printed_at: "2026-07-01T00:00:00Z" }))).toBe("already_printed");
  });

  it("is named in the bundle note so nobody reads it as the executed form", () => {
    expect(bundleNoteFor({ used: true, signedInspection: false, k208Docs: [workingCopy] }))
      .toMatch(/working copy/i);
  });
});

// B4 — which documents an authorization releases to the Print Center.
describe("authorizationReleasable", () => {
  it("releases a draft or pending document that holds a printable file", () => {
    expect(authorizationReleasable(doc({ document_status: "draft" }))).toBe(true);
    expect(authorizationReleasable(doc({ document_status: "pending_approval" }))).toBe(true);
  });

  it("never releases the pre-execution K-208 — it prints only as a working copy", () => {
    expect(authorizationReleasable(doc({ document_type: "k208", document_status: "draft" }))).toBe(false);
  });

  it("never releases a document with no printable file", () => {
    expect(authorizationReleasable(doc({ document_status: "draft", pdf_url: null, png_url: null }))).toBe(false);
    expect(authorizationReleasable(doc({ document_status: "draft", pdf_url: null, png_url: null, online_url: "https://dealer.test/v/x" }))).toBe(false);
  });

  it("leaves already-released lifecycles alone", () => {
    for (const s of ["approved", "printed", "published", "rejected", "superseded", "archived"]) {
      expect(authorizationReleasable(doc({ document_status: s }))).toBe(false);
    }
  });

  it("every released document lands on the print sheet once approved", () => {
    const candidates = [
      doc({ document_status: "draft" }),
      doc({ document_status: "pending_approval" }),
      doc({ document_status: "draft", pdf_url: null, png_url: "https://files.test/d.png" }),
    ];
    for (const d of candidates) {
      if (!authorizationReleasable(d)) continue;
      expect(printSheetIncludes({ ...d, document_status: "approved" })).toBe(true);
      expect(printReleasable({ ...d, document_status: "approved" })).toBe(true);
    }
  });
});

// B6a — the reprint predicate and copy numbering.
describe("reprintable", () => {
  it("offers a reprint only for a released document whose file still exists", () => {
    expect(reprintable(doc({ document_status: "printed", print_count: 1 }))).toBe(true);
    expect(reprintable(doc({ document_status: "printed", print_count: 1, pdf_url: null, png_url: null }))).toBe(false);
    expect(reprintable(doc())).toBe(false);
    expect(reprintable(doc({ document_status: "draft" }))).toBe(false);
  });

  it("numbers the next copy from the recorded count", () => {
    expect(reprintCopyNumber(doc({ document_status: "printed", print_count: 1 }))).toBe(2);
    expect(reprintCopyNumber(doc({ document_status: "printed", print_count: 3 }))).toBe(4);
    // A legacy release stamped printed_at without a count still made one copy.
    expect(reprintCopyNumber(doc({ document_status: "printed", print_count: 0 }))).toBe(2);
  });
});

// 20260724010000_autopublish_k208_on_signoff publishes the K-208 the instant
// the safety inspection is signed. The bundle rail and the packet button must
// agree about it in that exact case.
describe("the signed K-208", () => {
  const k208Published = doc({ document_type: "k208", document_status: "published" });

  it("is on the paper once the trigger has published it, and is not stamped", () => {
    expect(printSheetIncludes(k208Published)).toBe(true);
    expect(printReleasable(k208Published)).toBe(false);
  });

  it("no longer needs excusing in the bundle note, because it is in the bundle", () => {
    expect(bundleNoteFor({ used: true, signedInspection: true, k208Docs: [k208Published] })).toBeNull();
  });

  it("still counts in the bundle when the doc is approved and unprinted", () => {
    const approved = doc({ document_type: "k208" });
    expect(printReleasable(approved)).toBe(true);
    expect(bundleNoteFor({ used: true, signedInspection: true, k208Docs: [approved] })).toBeNull();
  });
});

describe("bundleNoteFor", () => {
  it("says nothing on a new car", () => {
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

  // M2: 20260724010000 publishes the K-208 on `status = signed` without ever
  // consulting `result`, so a signed FAILED inspection leaves signedInspection
  // false (k208State -> failed) while a published K-208 with a pdf_url is on the
  // sheet. The card said "excluded" while Letter Paper counted it, counts.ready
  // counted it, and the button printed it.
  it("does not claim the K-208 is excluded when it is on the sheet", () => {
    const published = doc({ document_type: "k208", document_status: "published" });
    expect(printSheetIncludes(published)).toBe(true);
    expect(bundleNoteFor({ used: true, signedInspection: false, k208Docs: [published] })).toBeNull();
  });
});

describe("printBlockedReason", () => {
  it("distinguishes an empty vehicle from a blocked one", () => {
    expect(printBlockedReason([])).toMatch(/No documents have been generated/);
  });

  it("reports a genuine reprint truthfully", () => {
    expect(printBlockedReason([doc({ document_status: "printed" })])).toMatch(/already been released/);
  });

  // M3: "Every packet document has already been released" used to fire whenever
  // ANY document was printed, so a set of one printed sticker and one document
  // with no file at all was reported as a completed packet.
  it("does not call a mixed set a completed packet", () => {
    const reason = printBlockedReason([
      doc({ document_status: "printed" }),
      doc({ pdf_url: null, png_url: null }),
    ]);
    expect(reason).not.toMatch(/already been released/);
    expect(reason).toMatch(/print-ready file/);
  });

  // D11/M8: a relative storage path is a real file the sheet cannot open, so it
  // is Blocked here for the same reason it never reaches the paper.
  it("treats a file the print sheet cannot open as no file at all", () => {
    expect(printReleaseState(doc({ pdf_url: "vehicle-docs/abc.pdf" }))).toBe("no_file");
    expect(printSheetIncludes(doc({ pdf_url: "vehicle-docs/abc.pdf" }))).toBe(false);
  });

  it("asks for a regenerate when the file is missing", () => {
    expect(printBlockedReason([doc({ pdf_url: null, png_url: null })])).toMatch(/print-ready file/);
  });

  it("explains an online-only package rather than calling it unapproved", () => {
    expect(printBlockedReason([doc({ pdf_url: null, png_url: null, online_url: "https://dealer.test/v/x" })]))
      .toMatch(/online links/);
  });

  it("asks for approval when nothing is approved", () => {
    expect(printBlockedReason([doc({ document_status: "draft" })])).toMatch(/approved for printing/);
  });
});
