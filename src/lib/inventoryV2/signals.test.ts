import { describe, expect, it } from "vitest";
import { queueMatches, signalOf, stickerStateOf } from "./signals";

const base = { ymm: "2024 Honda Civic", price: 25000, status: "draft", condition: "used" };
const vinClear = () => ({
  recall_status: "clear", open_recall_count: 0,
  recall_payload: { source: "marketcheck", scope: "vin", checked_at: new Date().toISOString(), open_recall_count: 0, campaigns: [] },
});

describe("inventory v2 sticker status", () => {
  it("a draft with no document read is unknown, not missing", () => {
    expect(stickerStateOf("used", false, [])).toBe("unknown");
  });
  it("unresolved condition is unknown even when docs loaded", () => {
    expect(stickerStateOf(null, true, [])).toBe("unknown");
  });
  it("missing only when docs loaded and no live sticker of the right family", () => {
    expect(stickerStateOf("used", true, [])).toBe("missing");
    expect(stickerStateOf("used", true, [{ vehicle_id: "a", document_type: "window", document_status: "rejected" }])).toBe("missing");
  });
  it("a live used window sticker counts as present", () => {
    expect(stickerStateOf("used", true, [{ vehicle_id: "a", document_type: "window", document_status: "draft" }])).toBe("present");
  });
  it("an addendum is not a sticker", () => {
    expect(stickerStateOf("used", true, [{ vehicle_id: "a", document_type: "addendum", document_status: "approved" }])).toBe("missing");
  });
});

describe("inventory v2 recall readiness", () => {
  it("no recall evidence earns no readiness credit and is not ready", () => {
    const s = signalOf(base, true, "unknown");
    expect(s.recall).toBe("unknown");
    expect(s.score).toBe(0.75);
    expect(s.readyToPublish).toBe(false);
  });
  it("model-level clear does not make a car ready", () => {
    const s = signalOf({ ...base, recall_status: "clear", open_recall_count: 0 }, true, "unknown");
    expect(s.recallClear).toBe(false);
    expect(s.readyToPublish).toBe(false);
  });
  it("VIN-verified clear with all checks is ready", () => {
    const s = signalOf({ ...base, ...vinClear() }, true, "unknown");
    expect(s.recall).toBe("clear");
    expect(s.readyToPublish).toBe(true);
  });
});

describe("inventory v2 queues", () => {
  it("vin issue queue matches undecoded vehicles only", () => {
    const bad = signalOf({ ...base, ymm: null }, true, "unknown");
    const good = signalOf(base, true, "unknown");
    expect(queueMatches("vin_issues", base, bad, false)).toBe(true);
    expect(queueMatches("vin_issues", base, good, false)).toBe(false);
  });
  it("needs-sticker queue never includes unknown sticker state", () => {
    const s = signalOf(base, true, "unknown");
    expect(queueMatches("needs_sticker", base, s, false)).toBe(false);
  });
  it("blocked queue excludes a clean draft that is only waiting on recall evidence", () => {
    const s = signalOf(base, true, "unknown");
    expect(queueMatches("blocked", base, s, false)).toBe(false);
  });
});
