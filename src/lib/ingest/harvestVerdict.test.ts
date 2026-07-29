import { describe, it, expect } from "vitest";
import { harvestVerdict, type HarvestKind } from "./harvestVerdict";

const KINDS: HarvestKind[] = ["brochure", "owners_manual"];

describe("harvestVerdict", () => {
  it("records a real link as succeeded and tells the operator so", () => {
    const v = harvestVerdict("brochure", { ok: true, cached: false, url: "https://toyota.com/b.pdf", year: 2026 }, null, "Toyota");
    expect(v.step).toBe("oem_brochure");
    expect(v.status).toBe("succeeded");
    expect(v.toastKind).toBe("success");
    expect(v.reason).toContain("https://toyota.com/b.pdf");
    expect(v.reason).toContain("2026");
    expect(v.reason).toMatch(/newly harvested/i);
  });

  it("notes a cache hit distinctly from a fresh harvest", () => {
    const v = harvestVerdict("owners_manual", { ok: true, cached: true, url: "https://toyota.com/m.pdf" }, null, "Toyota");
    expect(v.step).toBe("owners_manual");
    expect(v.status).toBe("succeeded");
    expect(v.reason).toMatch(/shared OEM link cache/i);
  });

  it("refuses to call ok:true with no url a success", () => {
    const v = harvestVerdict("brochure", { ok: true, url: "" }, null, "Toyota");
    expect(v.status).toBe("failed");
    expect(v.toastKind).toBe("error");
    expect(v.reason).toMatch(/answered ok but returned no link/i);
  });

  it("reports a link that did not persist as failed, naming the url and the detail", () => {
    const v = harvestVerdict("brochure", { error: "brochure_link_not_saved", url: "https://toyota.com/b.pdf", detail: "duplicate key" }, null, "Toyota");
    expect(v.status).toBe("failed");
    expect(v.reason).toContain("https://toyota.com/b.pdf");
    expect(v.reason).toContain("duplicate key");
    expect(v.reason).toMatch(/did not persist/i);
  });

  it("maps the manual's own not-saved code the same way", () => {
    const v = harvestVerdict("owners_manual", { error: "manual_link_not_saved", url: "https://toyota.com/m.pdf" }, null, "Toyota");
    expect(v.status).toBe("failed");
    expect(v.reason).toMatch(/did not persist/i);
  });

  it("separates 'never attempted' from 'attempted and failed'", () => {
    expect(harvestVerdict("brochure", { error: "make_not_supported" }, null, "Koenigsegg").status).toBe("skipped");
    expect(harvestVerdict("brochure", { error: "not_configured" }, null, "Toyota").status).toBe("skipped");
    expect(harvestVerdict("brochure", { error: "brochure_not_found" }, null, "Toyota").status).toBe("failed");
    expect(harvestVerdict("brochure", { error: "brochure_unreachable", url: "u" }, null, "Toyota").status).toBe("failed");
  });

  it("says why nothing was attempted when the harvester is unconfigured", () => {
    const v = harvestVerdict("owners_manual", { error: "not_configured" }, null, "Toyota");
    expect(v.reason).toMatch(/no search API key configured/i);
    expect(v.toastMessage).toMatch(/not configured/i);
  });

  it("treats a transport error as a failure, not a silent no-op", () => {
    const v = harvestVerdict("brochure", null, "FunctionsFetchError: failed to fetch", "Toyota");
    expect(v.status).toBe("failed");
    expect(v.reason).toContain("FunctionsFetchError");
    expect(v.toastKind).toBe("error");
  });

  it("still produces a failed verdict when the function answers with nothing at all", () => {
    const v = harvestVerdict("brochure", null, null, "Toyota");
    expect(v.status).toBe("failed");
    expect(v.reason).toMatch(/no result code/i);
  });

  it("carries an unknown error code through rather than inventing a cause", () => {
    const v = harvestVerdict("brochure", { error: "teapot" }, null, "Toyota");
    expect(v.status).toBe("failed");
    expect(v.reason).toContain("teapot");
  });

  it("never emits an empty reason, and never pairs a success toast with a non-success status", () => {
    const responses = [
      { ok: true, url: "https://x/y.pdf" }, { ok: true }, { error: "make_not_supported" },
      { error: "not_configured" }, { error: "brochure_not_found" }, { error: "manual_not_found" },
      { error: "brochure_unreachable" }, { error: "manual_unreachable" },
      { error: "brochure_link_not_saved" }, { error: "manual_link_not_saved" },
      { error: "teapot" }, {}, null,
    ];
    for (const kind of KINDS) {
      for (const res of responses) {
        for (const invokeError of [null, "boom"]) {
          const v = harvestVerdict(kind, res, invokeError, "Toyota");
          expect(v.reason.trim().length).toBeGreaterThan(0);
          expect(v.toastMessage.trim().length).toBeGreaterThan(0);
          if (v.toastKind === "success") expect(v.status).toBe("succeeded");
          if (v.status !== "succeeded") expect(v.toastKind).toBe("error");
        }
      }
    }
  });

  it("falls back to a readable make when the vehicle has none", () => {
    const v = harvestVerdict("brochure", { error: "make_not_supported" }, null, "");
    expect(v.reason).toContain("this make");
  });
});
