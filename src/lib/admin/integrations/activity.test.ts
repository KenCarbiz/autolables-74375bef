import { describe, it, expect } from "vitest";
import { activityServerFilter, activityTone, actorLabel, classifyAuditAction, entityLabel, humanizeAction } from "./activity";

describe("classifyAuditAction", () => {
  it("splits configuration changes from provider and job events", () => {
    expect(classifyAuditAction("settings_updated")).toBe("configuration");
    expect(classifyAuditAction("member_role_changed")).toBe("configuration");
    expect(classifyAuditAction("marketcheck_sync_refused_429")).toBe("provider_job");
    expect(classifyAuditAction("lead_escalation_sent")).toBe("provider_job");
    expect(classifyAuditAction("price_rule_sync")).toBe("provider_job");
    expect(classifyAuditAction("addendum_signed")).toBe("other");
    expect(classifyAuditAction(null)).toBe("other");
  });

  it("builds a server filter only for a narrowed kind", () => {
    expect(activityServerFilter("all")).toBeNull();
    expect(activityServerFilter("configuration")).toContain("action.ilike.%setting%");
    expect(activityServerFilter("provider_job")).toContain("action.ilike.%sync%");
  });
});

describe("labels", () => {
  it("humanizes actions and names actors honestly", () => {
    expect(humanizeAction("provider_refused.rate")).toBe("Provider refused rate");
    expect(humanizeAction("")).toBe("Event");
    expect(actorLabel({ user_email: "ops@example.test", user_id: "u" })).toBe("ops@example.test");
    expect(actorLabel({ user_email: null, user_id: "u" })).toBe("Signed-in user");
    expect(actorLabel({ user_email: null, user_id: null })).toBe("System");
    expect(entityLabel({ entity_type: "vehicle", entity_id: "abcdefgh-1234" })).toBe("vehicle · abcdefgh");
    expect(entityLabel({ entity_type: null, entity_id: null })).toBe("—");
  });

  it("tones refusals as warnings and completions as success", () => {
    expect(activityTone("marketcheck_sync_refused_429")).toBe("warning");
    expect(activityTone("addendum_signed")).toBe("success");
    expect(activityTone("settings_updated")).toBe("neutral");
  });
});
