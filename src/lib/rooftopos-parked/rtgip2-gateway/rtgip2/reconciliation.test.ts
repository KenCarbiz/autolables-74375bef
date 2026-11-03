import { describe, expect, it } from "vitest";
import { INVARIANT_CHECKS } from "../reconcile";
import { compatibleCounters, validateV3Report, requestV3Reconciliation } from "./reconciliation";
const clean = Object.fromEntries(INVARIANT_CHECKS.map((k) => [k, 0]));
describe("reconciliation v2/v3 compatibility", () => {
  it("rejects missing counters and SQL timeout rather than fabricating a report", async () => {
    expect(
      await requestV3Reconciliation(async () => ({ data: { version: 3 }, error: null })),
    ).toEqual({ ok: false, reason: "invalid_report" });
    expect(
      await requestV3Reconciliation(async () => ({ data: null, error: { code: "57014" } })),
    ).toEqual({ ok: false, reason: "statement_timeout" });
    const result = await requestV3Reconciliation(async () => ({
      data: { version: 3, ...clean },
      error: null,
    }));
    expect(result).toEqual({ ok: true, details: { version: 3, ...clean } });
  });
  it("requires complete versions, never treats missing counters as zero", () => {
    expect(compatibleCounters({ version: 2, ...clean }, { version: 3, ...clean })).toBe(true);
    expect(compatibleCounters({ version: 2 }, { version: 3 })).toBe(false);
    expect(validateV3Report({ version: 2, ...clean })).toBe(false);
  });
  it.each(INVARIANT_CHECKS)("preserves %s independently", (counter) => {
    expect(
      compatibleCounters({ version: 2, ...clean }, { version: 3, ...clean, [counter]: 1 }),
    ).toBe(false);
    expect(
      compatibleCounters(
        { version: 2, ...clean, [counter]: 16 },
        { version: 3, ...clean, [counter]: 16 },
      ),
    ).toBe(true);
  });
});
