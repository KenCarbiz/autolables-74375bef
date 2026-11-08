import { describe, it, expect } from "vitest";
import { joinList, parseList, reconRoute, signerModeFor, signerSelectionError, titleCadence, titlePolicyFromSettings } from "./servicePolicyModel";

describe("service policy model", () => {
  it("never treats an empty selection as everyone", () => {
    expect(signerSelectionError(true, "selected", [])).toMatch(/at least one/);
    expect(signerSelectionError(true, "any", [])).toBeNull();
    expect(signerSelectionError(false, "selected", [])).toBeNull();
    expect(signerModeFor([])).toBe("any");
    expect(signerModeFor(["service_manager"])).toBe("selected");
  });
  it("routes each line item against the threshold, with 0 meaning every amount", () => {
    expect(reconRoute(499, 500)).toBe("auto");
    expect(reconRoute(500, 500)).toBe("auto");
    expect(reconRoute(501, 500)).toBe("manager");
    expect(reconRoute(1, 0)).toBe("manager");
  });
  it("parses and joins comma lists without duplicates", () => {
    expect(parseList("a@example.com, b@example.com, A@example.com")).toHaveLength(2);
    expect(parseList("")).toEqual([]);
    expect(joinList(["x", "y"])).toBe("x, y");
  });
  it("describes reminder cadence from existing keys only", () => {
    const c = titleCadence(titlePolicyFromSettings({ title_clerk_email: "a@example.com, b@example.com", title_round_robin: true, title_reminders_enabled: true, title_reminder_days: 3 }));
    expect(c.recipients).toHaveLength(2);
    expect(c.frequency).toMatch(/3/);
  });
});
