import { describe, it, expect } from "vitest";
import {
  PASSPORT_VISIBILITY_PILL,
  passportModuleFor,
  passportServesDocument,
  passportVisibilityState,
} from "./passportVisibility";

describe("passportServesDocument", () => {
  it("serves published documents only", () => {
    expect(passportServesDocument({ document_status: "published" })).toBe(true);
  });

  // The old rule was isPublicDoc = approved | printed | published. It answered a
  // compliance question wrongly: get_published_documents_public filters on
  // document_status = 'published' and nothing else.
  it("does not serve approved or printed documents", () => {
    expect(passportServesDocument({ document_status: "approved" })).toBe(false);
    expect(passportServesDocument({ document_status: "printed" })).toBe(false);
  });

  it("does not serve drafts, rejections or retired paper", () => {
    for (const s of ["draft", "pending_approval", "rejected", "superseded", "archived", ""]) {
      expect(passportServesDocument({ document_status: s })).toBe(false);
    }
  });

  it("treats a missing status as not served", () => {
    expect(passportServesDocument({})).toBe(false);
  });
});

describe("passportVisibilityState", () => {
  it("is Customer Visible only when published AND its module is on", () => {
    expect(passportVisibilityState({ document_status: "published" }, true)).toBe("customer_visible");
  });

  it("is Hidden when published but the dealer switched the module off", () => {
    expect(passportVisibilityState({ document_status: "published" }, false)).toBe("hidden");
  });

  it("is Internal Only for an approved document even with the module on", () => {
    expect(passportVisibilityState({ document_status: "approved" }, true)).toBe("internal_only");
  });

  it("labels each state with the vocabulary the table uses", () => {
    expect(PASSPORT_VISIBILITY_PILL.customer_visible.label).toBe("Customer Visible");
    expect(PASSPORT_VISIBILITY_PILL.hidden.label).toBe("Hidden");
    expect(PASSPORT_VISIBILITY_PILL.internal_only.label).toBe("Internal Only");
  });
});

describe("passportModuleFor", () => {
  it("curates window stickers under oemSticker and everything else under documents", () => {
    expect(passportModuleFor("window")).toBe("oemSticker");
    expect(passportModuleFor("addendum")).toBe("documents");
    expect(passportModuleFor("k208")).toBe("documents");
    expect(passportModuleFor(null)).toBe("documents");
  });
});
