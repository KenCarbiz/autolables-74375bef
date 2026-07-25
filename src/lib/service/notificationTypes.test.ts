import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVICE_NOTIFICATION_TYPES, notificationDedupeKey, isUnread } from "./notificationTypes";

describe("service notifications (S5)", () => {
  it("dedupe keys are stable and case-normalized on the subject", () => {
    expect(notificationDedupeKey("k208_ready", "1hgcm82633a004352"))
      .toBe(notificationDedupeKey("k208_ready", "1HGCM82633A004352"));
    expect(notificationDedupeKey("inspection_overdue", "VIN123", "2026-07-25"))
      .toBe("inspection_overdue:VIN123:2026-07-25");
  });

  it("distinct decisions produce distinct keys — same request, new decision, new bell", () => {
    const a = notificationDedupeKey("service_request_decision", "req-1", "approved");
    const b = notificationDedupeKey("service_request_decision", "req-1", "declined");
    expect(a).not.toBe(b);
  });

  it("the spec's notification set is covered", () => {
    for (const t of [
      "service_task_created", "inspection_overdue", "sold_still_blocked",
      "failure_entered", "ready_for_reinspection", "k208_ready",
      "k208_unsigned_past_threshold", "storage_failure", "delivery_compliance_conflict",
    ]) {
      expect(SERVICE_NOTIFICATION_TYPES).toContain(t);
    }
  });

  it("decide_service_request emits a type this vocabulary knows", () => {
    const sql = readFileSync(
      join(__dirname, "../../../supabase/migrations/20260726107000_service_request_decision.sql"),
      "utf8",
    );
    expect(sql).toContain("'service_request_decision'");
    expect(SERVICE_NOTIFICATION_TYPES).toContain("service_request_decision");
  });

  it("unread means no read_at stamp", () => {
    expect(isUnread({ read_at: null })).toBe(true);
    expect(isUnread({ read_at: "2026-07-25T00:00:00Z" })).toBe(false);
  });
});
