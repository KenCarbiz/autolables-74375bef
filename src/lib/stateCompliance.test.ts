import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStateRule,
  validateAddendum,
  summarizeFindings,
  STATE_RULES,
  type ComplianceDraft,
} from "./stateCompliance";

// ──────────────────────────────────────────────────────────────
// Compliance coverage: every failing path here represents a
// bright-line statutory violation. When these tests break it
// means a dealer just got less protected, so the fix is either
// (a) update the test because the law changed, or (b) fix the
// engine because it regressed. Never silence.
// ──────────────────────────────────────────────────────────────

describe("getStateRule", () => {
  it("resolves a known state by upper case", () => {
    expect(getStateRule("CA")?.code).toBe("CA");
    expect(getStateRule("ca")?.code).toBe("CA");
  });

  it("returns null for unknown / blank codes", () => {
    expect(getStateRule("")).toBeNull();
    expect(getStateRule(undefined)).toBeNull();
    expect(getStateRule("ZZ")).toBeNull();
  });

  it("has an entry for all 50 states + DC (51 total)", () => {
    expect(Object.keys(STATE_RULES).length).toBe(51);
  });

  it("CA keeps the $85 doc-fee cap (SB 791 vetoed)", () => {
    expect(getStateRule("CA")?.docFee.cap).toBe(85);
  });

  it("TX doc-fee cap is $225", () => {
    expect(getStateRule("TX")?.docFee.cap).toBe(225);
  });

  it("NY doc-fee cap is $175 (raised 2023)", () => {
    expect(getStateRule("NY")?.docFee.cap).toBe(175);
  });

  it("CA has SB 766 3-day return enabled with $50k threshold", () => {
    const ca = getStateRule("CA")!;
    expect(ca.threeDayReturn.applicable).toBe(true);
    expect(ca.threeDayReturn.priceThreshold).toBe(50000);
    expect(ca.threeDayReturn.effectiveDate).toBe("2026-10-01");
  });

  it("CA requires separate sign-off on add-ons (SB 766)", () => {
    expect(getStateRule("CA")?.addOnRules.separateSignoffRequired).toBe(true);
  });
});

describe("validateAddendum — unknown state", () => {
  it("warns when the state rule isn't registered", () => {
    const findings = validateAddendum({ state: "XX" } as ComplianceDraft);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].id).toBe("state-unknown");
  });
});

describe("validateAddendum — doc fee cap (CA $85)", () => {
  const base: ComplianceDraft = { state: "CA" };

  it("FAILS when doc fee exceeds the cap", () => {
    const findings = validateAddendum({ ...base, docFeeAmount: 600 });
    const fail = findings.find((f) => f.id === "docfee-over-cap");
    expect(fail?.severity).toBe("fail");
    expect(fail?.message).toMatch(/\$600/);
    expect(fail?.message).toMatch(/\$85/);
  });

  it("PASSES at the cap exactly", () => {
    const findings = validateAddendum({ ...base, docFeeAmount: 85 });
    expect(findings.find((f) => f.id === "docfee-cap-ok")?.severity).toBe("pass");
  });

  it("PASSES under the cap", () => {
    const findings = validateAddendum({ ...base, docFeeAmount: 50 });
    expect(findings.find((f) => f.id === "docfee-cap-ok")?.severity).toBe("pass");
  });
});

describe("validateAddendum — required disclosure verbiage", () => {
  it("WARNS when statutory phrases are missing", () => {
    const findings = validateAddendum({
      state: "CA",
      docFeeAmount: 80,
      stickerText: "nothing about voluntary charges here",
    });
    const missing = findings.find((f) => f.id === "docfee-verbiage-missing");
    expect(missing?.severity).toBe("warn");
    expect(missing?.message).toMatch(/Not a government fee/i);
  });

  it("PASSES when all required phrases are present", () => {
    const findings = validateAddendum({
      state: "CA",
      docFeeAmount: 80,
      stickerText:
        "Not a government fee. This is a voluntary charge by the dealer for document preparation services.",
    });
    expect(findings.find((f) => f.id === "docfee-verbiage-ok")?.severity).toBe("pass");
  });
});

describe("validateAddendum — mandatory add-ons ban", () => {
  it("FAILS a CA deal that has a mandatory product", () => {
    const findings = validateAddendum({
      state: "CA",
      products: [
        {
          id: "vin-etch", name: "VIN Etching",
          price: 199, badge_type: "installed", mandatory: true,
        },
      ],
    });
    const flag = findings.find((f) => f.id === "mandatory-addon-prohibited");
    expect(flag?.severity).toBe("fail");
    expect(flag?.message).toMatch(/VIN Etching/);
  });

  it("is silent when no products are mandatory", () => {
    const findings = validateAddendum({
      state: "CA",
      products: [
        {
          id: "paint", name: "Paint Protection",
          price: 799, badge_type: "optional", mandatory: false,
        },
      ],
    });
    expect(findings.find((f) => f.id === "mandatory-addon-prohibited")).toBeUndefined();
  });
});

describe("validateAddendum — CA SB 766 3-day ack", () => {
  // The 3-day ack finding is gated on SB 766's 10/1/2026 effective
  // date. Pin the clock past it so the "post-effective" cases assert
  // the live behavior instead of the pre-effective no-op.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("FAILS when under-$50k CA sale is post-effective and ack is missing", () => {
    const findings = validateAddendum({
      state: "CA",
      vehiclePrice: 32000,
      threeDayAck: false,
    });
    const ack = findings.find((f) => f.id === "three-day-return-ack-missing");
    expect(ack?.severity).toBe("fail");
  });

  it("PASSES when the ack is checked", () => {
    const findings = validateAddendum({
      state: "CA",
      vehiclePrice: 32000,
      threeDayAck: true,
    });
    expect(findings.find((f) => f.id === "three-day-return-ack-missing")).toBeUndefined();
  });

  it("doesn't fire for vehicles over the $50k threshold", () => {
    const findings = validateAddendum({
      state: "CA",
      vehiclePrice: 72000,
      threeDayAck: false,
    });
    expect(findings.find((f) => f.id === "three-day-return-ack-missing")).toBeUndefined();
  });
});

describe("summarizeFindings", () => {
  it("counts and resolves to fail when any fail present", () => {
    const summary = summarizeFindings([
      { id: "a", severity: "fail", rule: "r", message: "m", citation: "c" },
      { id: "b", severity: "warn", rule: "r", message: "m", citation: "c" },
      { id: "c", severity: "pass", rule: "r", message: "m", citation: "c" },
    ]);
    expect(summary.fails).toBe(1);
    expect(summary.warns).toBe(1);
    expect(summary.passes).toBe(1);
    expect(summary.status).toBe("fail");
  });

  it("resolves to warn when no fails and at least one warn", () => {
    const summary = summarizeFindings([
      { id: "b", severity: "warn", rule: "r", message: "m", citation: "c" },
    ]);
    expect(summary.status).toBe("warn");
  });

  it("resolves to pass when everything passes", () => {
    const summary = summarizeFindings([
      { id: "c", severity: "pass", rule: "r", message: "m", citation: "c" },
    ]);
    expect(summary.status).toBe("pass");
  });
});
