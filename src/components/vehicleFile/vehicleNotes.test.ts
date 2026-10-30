import { describe, expect, it } from "vitest";
import { cleanNote, notesFromAudit, MAX_NOTE_LENGTH } from "./vehicleNotes";

describe("vehicle notes", () => {
  it("rejects blank notes and trims the rest", () => {
    expect(cleanNote("  \n ")).toBeNull();
    expect(cleanNote("  Check rear tire ")).toBe("Check rear tire");
    expect(cleanNote("x".repeat(MAX_NOTE_LENGTH + 50))?.length).toBe(MAX_NOTE_LENGTH);
  });
  it("maps audit rows and skips rows without text", () => {
    const out = notesFromAudit([
      { id: "a", created_at: "2026-10-01", user_email: "a@b.test", details: { text: "Hello" } },
      { id: "b", created_at: "2026-10-01", user_email: null, details: {} },
    ]);
    expect(out).toEqual([{ key: "a", when: "2026-10-01", who: "a@b.test", text: "Hello" }]);
  });
});
