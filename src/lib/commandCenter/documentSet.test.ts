import { describe, it, expect } from "vitest";
import {
  currentDocumentOfType,
  currentVersionByType,
  isRetiredDocument,
  liveDocuments,
} from "./documentSet";

const doc = (document_type: string, version: number, document_status: string, id = `${document_type}-v${version}`) =>
  ({ id, document_type, version, document_status });

describe("liveDocuments", () => {
  it("drops superseded and archived rows", () => {
    const kept = liveDocuments([
      doc("window", 3, "superseded"),
      doc("window", 2, "approved"),
      doc("addendum", 1, "archived"),
    ]);
    expect(kept.map((d) => d.id)).toEqual(["window-v2"]);
  });

  it("keeps a rejected row — it is a live exception, not retired paper", () => {
    expect(isRetiredDocument({ document_status: "rejected" })).toBe(false);
    expect(liveDocuments([doc("window", 1, "rejected")])).toHaveLength(1);
  });
});

describe("currentDocumentOfType", () => {
  // 20260724000000 keeps the row with a real file first and only then the
  // highest version, so the keeper is routinely NOT the highest version. Reading
  // "highest version" over an unfiltered list picked the superseded row: a dead
  // link on screen 1 and a status screen 3 contradicted.
  it("ignores a superseded higher version and returns the live keeper", () => {
    const current = currentDocumentOfType(
      [doc("window", 3, "superseded"), doc("window", 2, "approved")],
      "window",
    );
    expect(current?.id).toBe("window-v2");
  });

  it("returns the highest version among live rows", () => {
    const current = currentDocumentOfType(
      [doc("window", 1, "approved"), doc("window", 4, "published"), doc("window", 2, "draft")],
      "window",
    );
    expect(current?.id).toBe("window-v4");
  });

  it("does not cross document types", () => {
    expect(currentDocumentOfType([doc("addendum", 9, "approved")], "window")).toBeNull();
  });

  it("returns null when every row of the type is retired", () => {
    expect(currentDocumentOfType([doc("window", 2, "archived")], "window")).toBeNull();
  });
});

describe("currentVersionByType", () => {
  it("marks the live keeper as current, not the superseded higher version", () => {
    const map = currentVersionByType([doc("window", 3, "superseded"), doc("window", 2, "approved")]);
    expect(map.get("window")).toBe(2);
  });
});
