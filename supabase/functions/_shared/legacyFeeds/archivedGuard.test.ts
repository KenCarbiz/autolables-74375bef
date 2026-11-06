import { describe, expect, it } from "vitest";
import { planListingWrite } from "./archivedGuard.ts";

const row = (status: string | null, archived_at: string | null = null) => ({ id: "l1", status, archived_at, archive_reason: null });

describe("planListingWrite", () => {
  it("inserts when there is no listing", () => expect(planListingWrite(null)).toBe("insert"));
  it("holds archived listings", () => expect(planListingWrite(row("archived"))).toBe("hold_archived"));
  it("holds any row carrying archived_at", () => {
    expect(planListingWrite(row("published", "2026-10-01T00:00:00Z"))).toBe("hold_archived");
    expect(planListingWrite(row("draft", "2026-10-01T00:00:00Z"))).toBe("hold_archived");
  });
  it("holds sold and expired listings", () => {
    expect(planListingWrite(row("sold"))).toBe("hold_archived");
    expect(planListingWrite(row("expired"))).toBe("hold_archived");
  });
  it("updates current listings", () => {
    for (const s of ["draft", "pending", "active", "published", "Published"]) expect(planListingWrite(row(s))).toBe("update");
  });
  it("holds an unknown or missing status", () => {
    expect(planListingWrite(row(null))).toBe("hold_archived");
    expect(planListingWrite(row("mystery"))).toBe("hold_archived");
  });
});
