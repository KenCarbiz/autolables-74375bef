import { describe, it, expect } from "vitest";
import { deriveManagerAlerts, filterAcknowledged, type AlertEventRow } from "./managerAlerts";

const ev = (visitor: string, event_type: string, at: string, extra: Partial<AlertEventRow> = {}): AlertEventRow => ({
  visitor_id: visitor,
  session_id: extra.session_id ?? `${visitor}-s1`,
  event_type,
  vin: "VIN1",
  stock: "A100",
  vehicle_id: "veh1",
  created_at: at,
  metadata: extra.metadata,
  ...extra,
});

describe("deriveManagerAlerts — governance", () => {
  it("never alerts on passive views alone (no intent action)", () => {
    const alerts = deriveManagerAlerts([
      ev("a", "passport_opened", "2026-07-20T10:00:00Z"),
      ev("a", "photo_viewed", "2026-07-20T10:01:00Z"),
      ev("a", "scroll_depth", "2026-07-20T10:02:00Z"),
    ]);
    expect(alerts).toHaveLength(0);
  });

  it("a reserve request fires a HOT alert with the concrete signal, not a prediction", () => {
    const [alert] = deriveManagerAlerts([
      ev("a", "passport_opened", "2026-07-20T10:00:00Z"),
      ev("a", "customer_passport_reserve_clicked", "2026-07-20T10:05:00Z"),
    ]);
    expect(alert.severity).toBe("hot");
    expect(alert.signals[0].label).toBe("Reserve request");
    expect(alert.suggestedAction).toMatch(/follow up on their request/i);
    // no probability/prediction language anywhere in the surfaced copy
    const copy = `${alert.suggestedAction} ${alert.signals.map((s) => s.label).join(" ")}`.toLowerCase();
    expect(copy).not.toMatch(/likely|will buy|probab|guarantee/);
  });

  it("a single tap-to-call is a warm alert with a call-back action", () => {
    const [alert] = deriveManagerAlerts([ev("a", "call_clicked", "2026-07-20T10:05:00Z")]);
    expect(alert.severity).toBe("warm");
    expect(alert.suggestedAction).toMatch(/call or text back/i);
  });

  it("two distinct strong signals escalate to hot", () => {
    const [alert] = deriveManagerAlerts([
      ev("a", "call_clicked", "2026-07-20T10:05:00Z"),
      ev("a", "text_clicked", "2026-07-20T10:06:00Z"),
    ]);
    expect(alert.severity).toBe("hot");
  });

  it("repeat visits (distinct sessions) add a bounded amplifier", () => {
    const rows = [
      ev("a", "finance_clicked", "2026-07-20T10:00:00Z", { session_id: "a-s1" }), // weight 6, warm on its own? 6 < 8
      ev("a", "directions_clicked", "2026-07-21T10:00:00Z", { session_id: "a-s2" }), // +6, +4 repeat
    ];
    const [alert] = deriveManagerAlerts(rows);
    expect(alert.sessions).toBe(2);
    expect(alert.score).toBeGreaterThanOrEqual(8);
  });

  it("dedupes repeated signals of the same type, keeping the most recent timestamp", () => {
    const [alert] = deriveManagerAlerts([
      ev("a", "call_clicked", "2026-07-20T10:00:00Z"),
      ev("a", "call_clicked", "2026-07-20T12:00:00Z"),
    ]);
    const calls = alert.signals.filter((s) => s.type === "call_clicked");
    expect(calls).toHaveLength(1);
    expect(calls[0].at).toBe("2026-07-20T12:00:00Z");
  });

  it("resolves a reserve cta_clicked from metadata action", () => {
    const [alert] = deriveManagerAlerts([
      ev("a", "cta_clicked", "2026-07-20T10:05:00Z", { metadata: { cta_action: "reserve" } }),
    ]);
    expect(alert.severity).toBe("hot");
  });

  it("separates the same visitor's activity on different vehicles into distinct alerts", () => {
    const alerts = deriveManagerAlerts([
      ev("a", "call_clicked", "2026-07-20T10:00:00Z", { vehicle_id: "veh1", vin: "VIN1", stock: "A1" }),
      ev("a", "call_clicked", "2026-07-20T10:01:00Z", { vehicle_id: "veh2", vin: "VIN2", stock: "A2" }),
    ]);
    expect(alerts).toHaveLength(2);
  });

  it("orders hot before warm, then by most-recent activity", () => {
    const alerts = deriveManagerAlerts([
      ev("warm", "finance_clicked", "2026-07-22T10:00:00Z", { vehicle_id: "v_w", session_id: "w1" }),
      ev("warm", "directions_clicked", "2026-07-22T10:01:00Z", { vehicle_id: "v_w", session_id: "w2" }),
      ev("hot", "customer_passport_reserve_clicked", "2026-07-20T10:00:00Z", { vehicle_id: "v_h" }),
    ]);
    expect(alerts[0].severity).toBe("hot");
  });
});

describe("filterAcknowledged", () => {
  const base = deriveManagerAlerts([ev("a", "customer_passport_reserve_clicked", "2026-07-20T10:00:00Z")]);

  it("hides an acknowledged alert with no newer activity", () => {
    const acks = { [base[0].key]: "2026-07-20T10:00:00Z" };
    expect(filterAcknowledged(base, acks)).toHaveLength(0);
  });

  it("re-surfaces an acknowledged alert once new activity arrives", () => {
    const acks = { [base[0].key]: "2026-07-19T00:00:00Z" }; // acked before the latest activity
    expect(filterAcknowledged(base, acks)).toHaveLength(1);
  });
});
