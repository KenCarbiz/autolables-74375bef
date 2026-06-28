import { describe, it, expect } from "vitest";
import {
  isPublicDoc,
  allowedActions,
  PUBLIC_STATUSES,
  STATUS_META,
  type DocumentStatus,
} from "./documentWorkflow";

const ALL_STATUSES: DocumentStatus[] = [
  "draft", "pending_approval", "approved", "printed", "published", "superseded", "archived", "rejected",
];

describe("isPublicDoc / PUBLIC_STATUSES", () => {
  it("marks only approved, printed, and published as customer-visible", () => {
    expect(PUBLIC_STATUSES).toEqual(["approved", "printed", "published"]);
    expect(isPublicDoc("approved")).toBe(true);
    expect(isPublicDoc("printed")).toBe(true);
    expect(isPublicDoc("published")).toBe(true);
  });

  it("hides draft, pending, superseded, archived, and rejected", () => {
    for (const s of ["draft", "pending_approval", "superseded", "archived", "rejected"] as DocumentStatus[]) {
      expect(isPublicDoc(s)).toBe(false);
    }
  });
});

describe("STATUS_META", () => {
  it("has presentation metadata for every status", () => {
    for (const s of ALL_STATUSES) {
      expect(STATUS_META[s]).toBeDefined();
      expect(STATUS_META[s].label.length).toBeGreaterThan(0);
    }
  });
});

describe("allowedActions — manager gating", () => {
  it("lets a manager approve a draft directly, a non-manager only submit/archive", () => {
    expect(allowedActions("draft", true)).toContain("approve");
    expect(allowedActions("draft", false)).not.toContain("approve");
    expect(allowedActions("draft", false)).toEqual(["submit", "archive"]);
  });

  it("only a manager can approve or reject a pending doc", () => {
    expect(allowedActions("pending_approval", true)).toEqual(["approve", "reject", "archive"]);
    expect(allowedActions("pending_approval", false)).toEqual(["archive"]);
  });
});

describe("allowedActions — lifecycle transitions", () => {
  it("approved docs can print, publish, supersede, or archive", () => {
    expect(allowedActions("approved", false)).toEqual(["mark_printed", "publish", "supersede", "archive"]);
  });

  it("published docs can be unpublished or re-printed", () => {
    expect(allowedActions("published", true)).toContain("unpublish");
    expect(allowedActions("published", true)).toContain("mark_printed");
  });

  it("rejected docs can be resubmitted", () => {
    expect(allowedActions("rejected", false)).toContain("submit");
  });

  it("archived is terminal — no actions", () => {
    expect(allowedActions("archived", true)).toEqual([]);
    expect(allowedActions("superseded", true)).toEqual(["archive"]);
  });
});
