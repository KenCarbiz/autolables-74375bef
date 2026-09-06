import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  refreshDecision, inventoryAge, REFRESH_MILESTONES,
} from "../../../supabase/functions/_shared/description-refresh.ts";

// Owner rule: write once on ingest, refresh at 60 days in inventory and again
// at 200. Nothing in between — a description that is still accurate does not
// need rewriting because a week passed, and every rewrite spends credits
// across the whole lot.

const NOW = new Date("2026-09-06T12:00:00Z");
const base = { hasDescription: true, now: NOW };

describe("inventory age comes from the vehicle, not from our database", () => {
  it("prefers the provider's days on market", () => {
    // Our oldest row is 79 days old; the oldest vehicle has been listed 883
    // days. Anchoring to our ingest date would call that car brand new.
    expect(inventoryAge({ ...base, dom: 883, ingestedAt: "2026-06-19" }))
      .toEqual({ days: 883, source: "provider_dom" });
  });

  it("falls back to ingest date when the provider has no figure", () => {
    const r = inventoryAge({ ...base, dom: null, ingestedAt: "2026-08-07T12:00:00Z" });
    expect(r.source).toBe("ingest_date");
    expect(r.days).toBe(30);
  });

  it("reports unknown rather than guessing zero", () => {
    // Zero would mean "brand new", which would suppress a refresh forever.
    expect(inventoryAge({ ...base, dom: null, ingestedAt: null }).source).toBe("unknown");
  });

  it("ignores a nonsense provider value", () => {
    expect(inventoryAge({ ...base, dom: -5, ingestedAt: "2026-08-07T12:00:00Z" }).source)
      .toBe("ingest_date");
  });
});

describe("the two milestones, and nothing between them", () => {
  it("writes a description for a vehicle that has none, at any age", () => {
    const d = refreshDecision({ ...base, hasDescription: false, dom: 3 });
    expect(d.due).toBe(true);
    expect(d.reason).toBe("initial");
  });

  it("leaves a fresh vehicle alone", () => {
    expect(refreshDecision({ ...base, dom: 12 }).due).toBe(false);
  });

  it("refreshes at sixty days", () => {
    const d = refreshDecision({ ...base, dom: 60 });
    expect(d.due).toBe(true);
    expect(d.milestone).toBe(60);
  });

  it("does not refresh again on day 61", () => {
    expect(refreshDecision({ ...base, dom: 61, lastMilestone: 60 }).due).toBe(false);
  });

  it("does not refresh anywhere between the milestones", () => {
    for (const dom of [61, 90, 120, 150, 199]) {
      expect(refreshDecision({ ...base, dom, lastMilestone: 60 }).due, `day ${dom}`).toBe(false);
    }
  });

  it("refreshes again at two hundred days", () => {
    const d = refreshDecision({ ...base, dom: 200, lastMilestone: 60 });
    expect(d.due).toBe(true);
    expect(d.milestone).toBe(200);
  });

  it("stops after the last milestone", () => {
    expect(refreshDecision({ ...base, dom: 900, lastMilestone: 200 }).due).toBe(false);
  });

  it("skips straight to the highest milestone reached", () => {
    // A car onboarded at 300 days should not generate twice to catch up.
    const d = refreshDecision({ ...base, dom: 300, lastMilestone: 0 });
    expect(d.milestone).toBe(200);
  });

  it("carries the milestones the owner set", () => {
    expect([...REFRESH_MILESTONES]).toEqual([60, 200]);
  });
});

describe("a human's copy is not overwritten by a calendar", () => {
  it("never refreshes a locked description on schedule", () => {
    const d = refreshDecision({ ...base, dom: 900, locked: true });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("locked");
  });

  it("still writes a first description even if the case is locked", () => {
    // Nothing to protect when nothing exists.
    expect(refreshDecision({ ...base, hasDescription: false, locked: true, dom: 900 }).due)
      .toBe(true);
  });
});

describe("an unknown age does not trigger work", () => {
  it("holds rather than refreshing on a guess", () => {
    const d = refreshDecision({ ...base, dom: null, ingestedAt: null });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("unknown_age");
  });
});

// ── The cadence has to be reachable ──────────────────────────────────
//
// refreshDecision was written, tested and imported by nothing. The reconcile
// sweep's four candidate classes -- stalled, source_changed, retryable,
// missing_case -- are all event-driven, so a vehicle whose description
// succeeded on day one and whose source data never moved was never selected
// again at any age. The rule was correct and unreachable, which is the same as
// not having it.

const fnDir = join(__dirname, "../../../supabase/functions");
const orchestrator = readFileSync(join(fnDir, "description-orchestrate/index.ts"), "utf8");
const migration = readFileSync(join(fnDir,
  "../migrations/20260906193000_description_refresh_cadence.sql"), "utf8");

describe("the cadence is wired to something that runs", () => {
  it("is imported and called by the orchestrator", () => {
    expect(orchestrator).toMatch(
      /import \{ refreshDecision \} from "\.\.\/_shared\/description-refresh\.ts"/);
    expect(orchestrator).toMatch(/refreshDecision\(\{/);
  });

  it("has a candidate class in the sweep that selects ageing vehicles", () => {
    expect(migration).toMatch(/'refresh_due', 5/);
    expect(migration).toMatch(/next_description_reconcile_batch/);
  });

  it("forces the run, because a time-based refresh is unchanged by definition", () => {
    // Without force the orchestrator returns "unchanged" on identical source
    // data and nothing would ever be rewritten on age alone.
    expect(orchestrator).toMatch(/r\.reason === "refresh_due"/);
  });

  it("stamps the milestone it satisfied, so it is not re-selected nightly", () => {
    expect(orchestrator).toMatch(/last_refresh_milestone: refreshMilestone/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS last_refresh_milestone integer/);
  });

  it("keeps the SQL bound in lockstep with the ladder", () => {
    // The migration deliberately does NOT encode the ladder -- it is a coarse
    // bound and refreshDecision picks the milestone. But the bound still has
    // to bracket the real milestones, or the sweep hands over the wrong cars:
    // too low and every fresh vehicle is examined nightly, too high and the
    // ones that are due are never offered.
    const lowest = Math.min(...REFRESH_MILESTONES);
    const highest = Math.max(...REFRESH_MILESTONES);
    expect(migration).toContain(`) >= ${lowest}`);
    expect(migration).toContain(`COALESCE(dc.last_refresh_milestone, 0) < ${highest}`);
  });

  it("never rewrites copy a human locked", () => {
    // Enforced twice on purpose: SQL keeps locked cases out of the batch at
    // all, and refreshDecision refuses if one reaches it by another path.
    expect(migration).toMatch(/dc\.master_locked IS NOT TRUE/);
    expect(refreshDecision({ ...base, dom: 883, locked: true }).due).toBe(false);
  });

  it("prefers provider days-on-market in SQL too, as the module does", () => {
    // Anchoring the sweep to created_at would have made every car on the lot
    // look brand new at onboarding, so the 883-day vehicle would wait 60 more
    // days for a refresh it was 14 months overdue for.
    expect(migration).toMatch(/mc_attributes->>'dom'/);
    expect(migration).toMatch(/vl\.created_at/);
  });
});
