import { describe, it, expect } from "vitest";
import { isDue, overdueBy, skipReason, hoursSinceSlot, slotDayOfWeek, CATCH_UP_HOURS } from "./syncSchedule";

// The gate used to be `now.getUTCHours() !== cfg.run_hour`, which gives a
// tenant exactly one chance per cadence period. One missed hourly tick and a
// nightly dealer loses a full day of inventory — silently, because a tenant
// that was never considered writes no row, so "never ran" and "ran and found
// nothing" are indistinguishable afterwards.
//
// Dates are constructed in UTC and the clock is injected, so none of this
// depends on when the suite happens to run.

const at = (iso: string) => new Date(iso);
const nightly = (runHour: number, lastRunAt: string | null) =>
  ({ frequency: "nightly", run_hour: runHour, day_of_week: 0, last_run_at: lastRunAt });
const weekly = (runHour: number, dow: number, lastRunAt: string | null) =>
  ({ frequency: "weekly", run_hour: runHour, day_of_week: dow, last_run_at: lastRunAt });

describe("a tenant runs at its scheduled hour", () => {
  it("fires on the slot when the period has elapsed", () => {
    expect(isDue(nightly(3, "2026-07-28T03:04:00Z"), at("2026-07-29T03:01:00Z"))).toBe(true);
  });

  it("does not fire before its slot", () => {
    expect(isDue(nightly(3, "2026-07-28T03:04:00Z"), at("2026-07-29T02:00:00Z"))).toBe(false);
  });

  it("never runs twice in one night", () => {
    // Ran at 03:00; every later tick inside the window must decline.
    for (const h of [4, 5, 6, 7, 8]) {
      const now = at(`2026-07-29T0${h}:00:00Z`);
      expect(isDue(nightly(3, "2026-07-29T03:00:00Z"), now)).toBe(false);
    }
  });
});

describe("a missed tick no longer costs a whole day", () => {
  it("catches up on the next hour when the slot was missed", () => {
    // 03:00 never fired — cold start, deploy, or the 120s http_post timeout.
    expect(isDue(nightly(3, "2026-07-28T03:00:00Z"), at("2026-07-29T04:00:00Z"))).toBe(true);
  });

  it("keeps catching up across the whole window", () => {
    for (let h = 0; h < CATCH_UP_HOURS; h++) {
      const now = new Date(Date.UTC(2026, 6, 29, 3 + h, 0, 0));
      expect(isDue(nightly(3, "2026-07-28T03:00:00Z"), now)).toBe(true);
    }
  });

  it("gives up once the window closes, rather than running mid-afternoon", () => {
    const now = new Date(Date.UTC(2026, 6, 29, 3 + CATCH_UP_HOURS, 0, 0));
    expect(isDue(nightly(3, "2026-07-28T03:00:00Z"), now)).toBe(false);
    expect(isDue(nightly(3, "2026-07-28T03:00:00Z"), at("2026-07-29T14:00:00Z"))).toBe(false);
  });

  it("catches up across midnight for a late-evening slot", () => {
    // The old exact-hour test made 23:00 the worst possible run_hour: a miss
    // could not be recovered because the next hour is a different day.
    expect(isDue(nightly(23, "2026-07-27T23:00:00Z"), at("2026-07-29T01:00:00Z"))).toBe(true);
  });
});

describe("weekly cadences are judged on the slot's day, not today's", () => {
  it("runs on its day", () => {
    // 2026-07-26 is a Sunday.
    expect(isDue(weekly(3, 0, "2026-07-19T03:00:00Z"), at("2026-07-26T03:00:00Z"))).toBe(true);
  });

  it("does not run on the wrong day", () => {
    expect(isDue(weekly(3, 0, "2026-07-19T03:00:00Z"), at("2026-07-27T03:00:00Z"))).toBe(false);
  });

  it("still belongs to Sunday when a 23:00 slot is caught up after midnight", () => {
    // Slot: Sunday 23:00. Picked up Monday 01:00. Testing `now`'s weekday would
    // read Monday and wrongly reject the tenant's only chance that week.
    const cfg = weekly(23, 0, "2026-07-19T23:00:00Z");
    expect(slotDayOfWeek(23, at("2026-07-27T01:00:00Z"))).toBe(0);
    expect(isDue(cfg, at("2026-07-27T01:00:00Z"))).toBe(true);
  });
});

describe("slot arithmetic wraps correctly", () => {
  it("is zero at the slot itself", () => {
    expect(hoursSinceSlot(3, at("2026-07-29T03:30:00Z"))).toBe(0);
  });

  it("wraps rather than going negative before the slot", () => {
    expect(hoursSinceSlot(3, at("2026-07-29T02:00:00Z"))).toBe(23);
    expect(hoursSinceSlot(0, at("2026-07-29T23:00:00Z"))).toBe(23);
  });
});

describe("a tenant that stopped syncing becomes a number, not an absence", () => {
  it("reports zero while on schedule", () => {
    expect(overdueBy(nightly(3, "2026-07-29T03:00:00Z"), at("2026-07-29T09:00:00Z"))).toBe(0);
  });

  it("stays quiet through the normal wait plus the catch-up window", () => {
    expect(overdueBy(nightly(3, "2026-07-28T03:00:00Z"), at("2026-07-29T04:00:00Z"))).toBe(0);
  });

  it("counts the hours once a nightly tenant has clearly missed", () => {
    // Last ran three days ago.
    expect(overdueBy(nightly(3, "2026-07-26T03:00:00Z"), at("2026-07-29T03:00:00Z"))).toBe(72 - 26);
  });

  it("treats a tenant that has never run as a full period behind", () => {
    expect(overdueBy(nightly(3, null), at("2026-07-29T03:00:00Z"))).toBe(20);
  });
});

describe("the skip reason says which rule declined", () => {
  it("names the window", () => {
    expect(skipReason(nightly(3, "2026-07-28T03:00:00Z"), at("2026-07-29T14:00:00Z")))
      .toBe("outside_window:11h_past_300z");
  });

  it("names a recent run", () => {
    expect(skipReason(nightly(3, "2026-07-29T03:00:00Z"), at("2026-07-29T05:00:00Z")))
      .toBe("ran_2h_ago");
  });

  it("names the wrong day", () => {
    expect(skipReason(weekly(3, 0, "2026-07-19T03:00:00Z"), at("2026-07-27T03:00:00Z")))
      .toMatch(/^wrong_day:/);
  });

  it("says due when nothing declined", () => {
    expect(skipReason(nightly(3, "2026-07-28T03:00:00Z"), at("2026-07-29T03:00:00Z"))).toBe("due");
  });

  it("agrees with isDue on every hour of a day", () => {
    // The reason string and the decision must never disagree — a diagnostic
    // that contradicts the behaviour is worse than none.
    const cfg = nightly(3, "2026-07-28T03:00:00Z");
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 6, 29, h, 0, 0));
      expect(skipReason(cfg, now) === "due").toBe(isDue(cfg, now));
    }
  });
});

describe("an unrecognised cadence is never guessed at", () => {
  it("declines rather than defaulting to nightly", () => {
    const cfg = { frequency: "hourly", run_hour: 3, day_of_week: 0, last_run_at: null };
    expect(isDue(cfg, at("2026-07-29T03:00:00Z"))).toBe(false);
    expect(skipReason(cfg, at("2026-07-29T03:00:00Z"))).toBe("unknown_frequency:hourly");
  });
});
