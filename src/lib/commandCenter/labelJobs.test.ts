import { describe, it, expect } from "vitest";
import { keyTagInBundle, keyTagState, type LabelJobRow } from "./labelJobs";

const job = (over: Partial<LabelJobRow> = {}): LabelJobRow => ({
  label_type: "key_tag",
  status: "queued",
  created_at: "2026-07-20T14:00:00Z",
  ...over,
});

describe("keyTagState", () => {
  it("is not started when the vehicle has no key-tag job", () => {
    expect(keyTagState([])).toEqual({ status: "pending", detail: "Not started" });
    expect(keyTagState([job({ label_type: "stock_number" })]).status).toBe("pending");
  });

  it("is queued while a job is waiting on the printer", () => {
    const s = keyTagState([job()]);
    expect(s.status).toBe("created");
    expect(s.detail).toMatch(/^Queued /);
  });

  // V4: the CHECK is ('queued','printing','printed','failed') (20260517020000:37)
  // and only `printed` was special-cased, so a FAILED job reported as "Queued" —
  // while the Print Center's bundle line already excluded failed jobs.
  it("reports a failed print as an exception, not as queued", () => {
    const s = keyTagState([job({ status: "failed" })]);
    expect(s.status).toBe("retry_required");
    expect(s.detail).toMatch(/failed/i);
  });

  it("lets a later successful print outrank an earlier failure", () => {
    expect(keyTagState([job({ status: "failed" }), job({ status: "printed" })]).status).toBe("ready");
  });

  // zebra_print_jobs has no printed_at column, so the queue time was being
  // presented as the print time.
  it("never presents the queue time as the print time", () => {
    expect(keyTagState([job({ status: "printed" })]).detail).toMatch(/^Printed · queued /);
  });
});

describe("keyTagInBundle", () => {
  it("counts one tag per vehicle however many times the label was queued", () => {
    expect(keyTagInBundle([job(), job(), job()])).toBe(true);
  });

  it("agrees with the VIN screen about a failed job", () => {
    expect(keyTagState([job({ status: "failed" })]).status).toBe("retry_required");
    expect(keyTagInBundle([job({ status: "failed" })])).toBe(false);
  });

  it("is empty when nothing was ever queued", () => {
    expect(keyTagInBundle([])).toBe(false);
  });
});
