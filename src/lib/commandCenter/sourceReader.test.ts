import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSourceReader } from "./sourceReader";

const ok = (data: unknown) => Promise.resolve({ data, error: null });
const fail = (message: string) => Promise.resolve({ data: null, error: { message } });

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("createSourceReader", () => {
  it("returns rows and records no degradation on success", async () => {
    const r = createSourceReader();
    expect(await r.rows(ok([{ id: 1 }]), "get_ready_records")).toEqual([{ id: 1 }]);
    expect(r.degraded).toEqual([]);
  });

  it("treats an empty table as empty, not degraded", async () => {
    const r = createSourceReader();
    expect(await r.rows(ok([]), "get_ready_records")).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  // An RLS denial and a genuinely empty table used to produce the same screen,
  // and only one of them is a bug somebody has to fix.
  it("names the source behind a denied read", async () => {
    const r = createSourceReader();
    expect(await r.rows(fail("permission denied for table get_ready_records"), "get_ready_records")).toEqual([]);
    expect(r.degraded).toEqual([
      { source: "get_ready_records", message: "permission denied for table get_ready_records" },
    ]);
  });

  it("records a thrown read too", async () => {
    const r = createSourceReader();
    expect(await r.rows(Promise.reject(new Error("Failed to fetch")), "audit_log")).toEqual([]);
    expect(r.degraded).toEqual([{ source: "audit_log", message: "Failed to fetch" }]);
  });

  it("reports each source once", async () => {
    const r = createSourceReader();
    await r.rows(fail("denied"), "qr_codes");
    await r.rows(fail("denied"), "qr_codes");
    expect(r.degraded).toHaveLength(1);
  });

  it("collects every distinct failing source", async () => {
    const r = createSourceReader();
    await r.rows(fail("a"), "qr_codes");
    await r.oneRow(fail("b"), "dealer_profiles");
    expect(r.degraded.map((d) => d.source)).toEqual(["qr_codes", "dealer_profiles"]);
  });

  it("oneRow returns the first row, or null", async () => {
    const r = createSourceReader();
    expect(await r.oneRow(ok([{ id: 1 }, { id: 2 }]), "s")).toEqual({ id: 1 });
    expect(await r.oneRow(ok([]), "s")).toBeNull();
  });
});
