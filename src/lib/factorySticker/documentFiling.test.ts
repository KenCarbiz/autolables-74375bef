import { describe, expect, it } from "vitest";
import { planDocumentFiling, recordStatusFor, type FiledDocumentRow } from "./documentFiling";

const row = (id: string, version: number, document_status: string, content_hash: string | null = null): FiledDocumentRow =>
  ({ id, version, document_status, content_hash });

describe("planDocumentFiling", () => {
  it("files the first document as v1", () => {
    expect(planDocumentFiling([], "h1", true)).toMatchObject({
      action: "insert", version: 1, supersedeIds: [], targetStatus: "published", supersededPublished: false,
    });
    expect(planDocumentFiling([], "h1", false)).toMatchObject({ action: "insert", version: 1, targetStatus: "pending_approval" });
  });

  it("overwrites an unreviewed draft in place instead of stacking versions", () => {
    const plan = planDocumentFiling([row("a", 3, "pending_approval", "old")], "new", false);
    expect(plan).toMatchObject({ action: "update_in_place", documentId: "a", version: 3, supersedeIds: [] });
  });

  it("an unreviewed regeneration never supersedes the public version", () => {
    const plan = planDocumentFiling([row("a", 1, "published", "old")], "new", false);
    expect(plan).toMatchObject({ action: "insert", version: 2, supersedeIds: [], targetStatus: "pending_approval", supersededPublished: false });
  });

  it("a publishable regeneration retires the public version, keeping it", () => {
    const plan = planDocumentFiling([row("a", 1, "published", "old")], "new", true);
    expect(plan).toMatchObject({ action: "insert", version: 2, supersedeIds: ["a"], targetStatus: "published", supersededPublished: true });
  });

  it("byte-identical output reuses the existing version", () => {
    expect(planDocumentFiling([row("a", 1, "published", "same")], "same", true))
      .toMatchObject({ action: "reuse_identical", documentId: "a", version: 1 });
    expect(planDocumentFiling([row("a", 1, "published", "same")], "same", false))
      .toMatchObject({ action: "reuse_identical", documentId: "a", version: 1 });
  });

  it("numbers the next version past retired ones and ignores them otherwise", () => {
    const rows = [row("c", 4, "superseded", "x"), row("b", 3, "archived"), row("a", 2, "rejected")];
    expect(planDocumentFiling(rows, "h", true)).toMatchObject({ action: "insert", version: 5, supersedeIds: [] });
  });

  it("a pending draft above a public version is the one overwritten", () => {
    const rows = [row("b", 2, "pending_approval", "d"), row("a", 1, "published", "p")];
    expect(planDocumentFiling(rows, "n", false)).toMatchObject({ action: "update_in_place", documentId: "b", version: 2, supersedeIds: [] });
  });

  it("files REVIEW_REQUIRED unless the policy said publish", () => {
    expect(recordStatusFor(true)).toBe("PUBLISHED");
    expect(recordStatusFor(false)).toBe("REVIEW_REQUIRED");
  });
});
