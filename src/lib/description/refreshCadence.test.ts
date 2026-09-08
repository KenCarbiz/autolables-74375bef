import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  refreshDecision, inventoryAge, classifyMarketSupply, threshold, REFRESH_POLICY,
} from "../../../supabase/functions/_shared/description-refresh.ts";

// Owner rule: the description is written ONCE, on ingest, and then left alone.
// The only scheduled rewrite is age AND market — past the configured threshold
// (90-120 days) and comparable supply measurably abundant. Age on its own is
// the weaker half of that test and does not qualify. One orchestrate run is
// nine provider calls against a 500/day, ~1,350/month ceiling, so every rewrite
// this file prevents is nine calls the tenant keeps.
//
// Runtime behaviour is NOT verified here: edge functions sit outside
// tsconfig.app.json and never execute in this suite. These are unit tests over
// the pure module plus text assertions over the SQL and the orchestrator.

const NOW = new Date("2026-09-08T12:00:00Z");
const base = { hasDescription: true, now: NOW };

const meta = (over: Record<string, unknown> = {}) => ({
  checked_at: "2026-08-20T00:00:00Z",
  relaxation_tier: "trim_year_band",
  similar_count: 40,
  ...over,
});

describe("inventory age comes from the vehicle, not from our database", () => {
  it("prefers the provider's days on market", () => {
    // Our oldest row is 79 days old; the oldest vehicle has been listed 883
    // days. Anchoring to our ingest date would call that car brand new.
    expect(inventoryAge({ ...base, dom: 883, ingestedAt: "2026-06-19" }))
      .toEqual({ days: 883, source: "provider_dom" });
  });

  it("falls back to ingest date when the provider has no figure", () => {
    const r = inventoryAge({ ...base, dom: null, ingestedAt: "2026-08-09T12:00:00Z" });
    expect(r.source).toBe("ingest_date");
    expect(r.days).toBe(30);
  });

  it("reports unknown rather than guessing zero", () => {
    // Zero would mean "brand new", which would suppress a refresh forever.
    expect(inventoryAge({ ...base, dom: null, ingestedAt: null }).source).toBe("unknown");
  });

  it("ignores a nonsense provider value", () => {
    expect(inventoryAge({ ...base, dom: -5, ingestedAt: "2026-08-09T12:00:00Z" }).source)
      .toBe("ingest_date");
  });
});

describe("the age threshold", () => {
  it("defaults inside the range the owner named", () => {
    expect(REFRESH_POLICY.defaultAgeDays).toBeGreaterThanOrEqual(90);
    expect(REFRESH_POLICY.defaultAgeDays).toBeLessThanOrEqual(120);
    expect(threshold({})).toBe(REFRESH_POLICY.defaultAgeDays);
  });

  it("is configurable", () => {
    expect(threshold({ ageThresholdDays: 90 })).toBe(90);
    expect(threshold({ ageThresholdDays: 365 })).toBe(365);
  });

  it("clamps up to the floor the SQL is constrained to", () => {
    // A tenant configured below the floor would be selected by the sweep and
    // refused here — selected work that can never run, which is exactly the
    // failure this cadence already had once.
    expect(threshold({ ageThresholdDays: 10 })).toBe(REFRESH_POLICY.minAgeDays);
  });
});

describe("write once, then leave it alone", () => {
  it("writes a description for a vehicle that has none, at any age", () => {
    const d = refreshDecision({ ...base, hasDescription: false, dom: 3 });
    expect(d.due).toBe(true);
    expect(d.reason).toBe("initial");
  });

  it("gates neither the first write nor the repair path on the market", () => {
    // Nothing to preserve when nothing exists; a scarce car still needs copy.
    const d = refreshDecision({ ...base, hasDescription: false, dom: 3, supply: "scarce" });
    expect(d.due).toBe(true);
  });

  it("leaves a fresh vehicle alone", () => {
    const d = refreshDecision({ ...base, dom: 12, supply: "abundant" });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("too_new");
  });

  it("leaves an unchanged vehicle alone the whole way to the threshold", () => {
    for (const dom of [1, 30, 59, 60, 89, 119]) {
      expect(refreshDecision({ ...base, dom, supply: "abundant" }).due, `day ${dom}`).toBe(false);
    }
  });

  it("rewrites once at the threshold when supply is abundant", () => {
    const d = refreshDecision({ ...base, dom: 120, supply: "abundant" });
    expect(d.due).toBe(true);
    expect(d.reason).toBe("aged_and_abundant");
    expect(d.milestone).toBe(REFRESH_POLICY.defaultAgeDays);
  });

  it("never rewrites a second time, at any age", () => {
    // One aged rewrite per vehicle, ever. 9 provider calls, once.
    for (const dom of [121, 200, 400, 883]) {
      const d = refreshDecision({ ...base, dom, supply: "abundant", lastMilestone: 120 });
      expect(d.due, `day ${dom}`).toBe(false);
      expect(d.reason).toBe("already_refreshed");
    }
  });

  it("treats a stamp from the retired 60/200 ladder as already spent", () => {
    for (const stamped of [60, 200]) {
      expect(refreshDecision({ ...base, dom: 883, supply: "abundant", lastMilestone: stamped }).due)
        .toBe(false);
    }
  });

  it("honours a tenant threshold lower than the default", () => {
    expect(refreshDecision({ ...base, dom: 95, supply: "abundant", ageThresholdDays: 90 }).due)
      .toBe(true);
    expect(refreshDecision({ ...base, dom: 95, supply: "abundant" }).due).toBe(false);
  });
});

describe("age alone is the weaker trigger", () => {
  it("does not rewrite an aged car in a scarce market", () => {
    const d = refreshDecision({ ...base, dom: 300, supply: "scarce" });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("scarce");
  });

  it("does not rewrite when the market cannot be read", () => {
    // Better to keep the nine calls than to spend them on a guess.
    const d = refreshDecision({ ...base, dom: 300, supply: "unknown" });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("supply_unknown");
  });

  it("lets a dealer opt into age alone", () => {
    const d = refreshDecision({ ...base, dom: 300, supply: "unknown", requireAbundantSupply: false });
    expect(d.due).toBe(true);
  });

  it("carries the supply evidence into the decision for the audit trail", () => {
    const d = refreshDecision({
      ...base, dom: 300,
      supply: classifyMarketSupply(meta({ trim_count: 41 }), { now: NOW }),
    });
    expect(d.due).toBe(true);
    expect(d.supplyBasis).toBe("trim_count");
    expect(d.comparableCount).toBe(41);
  });

  it("defers to the caller's selector when no market evidence is passed", () => {
    // The orchestrator has no market fields at its call site, so the reconcile
    // SQL applies the supply gate before the vehicle ever reaches here. An
    // omitted supply must therefore mean "already gated", not "unknown" —
    // otherwise the refresh is unreachable in production.
    const d = refreshDecision({ ...base, dom: 300 });
    expect(d.due).toBe(true);
    expect(d.supply).toBe("delegated");
  });
});

describe("a human's copy is not overwritten by a calendar", () => {
  it("never refreshes a locked description on schedule", () => {
    const d = refreshDecision({ ...base, dom: 900, supply: "abundant", locked: true });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("locked");
  });

  it("still writes a first description even if the case is locked", () => {
    expect(refreshDecision({ ...base, hasDescription: false, locked: true, dom: 900 }).due)
      .toBe(true);
  });
});

describe("an unknown age does not trigger work", () => {
  it("holds rather than refreshing on a guess", () => {
    const d = refreshDecision({ ...base, dom: null, ingestedAt: null, supply: "abundant" });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("unknown_age");
  });
});

// ── Scarcity is measured, never invented ─────────────────────────────

describe("comparable supply comes from stored provider counts", () => {
  it("prefers the trim count — the most specific whole-market number", () => {
    const r = classifyMarketSupply(meta({ trim_count: 3, similar_count: 400 }), { now: NOW });
    expect(r.basis).toBe("trim_count");
    expect(r.supply).toBe("scarce");
  });

  it("calls a large trim count abundant", () => {
    expect(classifyMarketSupply(meta({ trim_count: 40 }), { now: NOW }).supply).toBe("abundant");
  });

  it("uses similar_count when the search tier kept the year or the price band", () => {
    for (const tier of ["trim_year_band", "year_band", "year", "band"]) {
      const r = classifyMarketSupply(meta({ relaxation_tier: tier, similar_count: 60 }), { now: NOW });
      expect(r.basis, tier).toBe("similar_count");
      expect(r.supply).toBe("abundant");
    }
  });

  it("refuses a count from a model-wide search", () => {
    // The "model" tier drops both the year and the price band, so its
    // num_found counts cars that are not comparable to this one.
    const r = classifyMarketSupply(meta({ relaxation_tier: "model", similar_count: 900 }), { now: NOW });
    expect(r.supply).toBe("unknown");
    expect(r.basis).toBe("none");
  });

  it("never reads like_count", () => {
    // like_count is the length of the like-for-like subset of ONE returned
    // page, so it saturates at the page size. Reading it would report a
    // commodity model as scarce and suppress every legitimate refresh.
    const r = classifyMarketSupply(
      { checked_at: "2026-08-20T00:00:00Z", relaxation_tier: "model", like_count: 16 }, { now: NOW });
    expect(r.supply).toBe("unknown");
  });

  it("never reads market_position", () => {
    // market_position is a PRICE position (great_deal / above_market). It says
    // nothing about how many comparable cars exist.
    const r = classifyMarketSupply(
      { checked_at: "2026-08-20T00:00:00Z", market_position: "great_deal" }, { now: NOW });
    expect(r.supply).toBe("unknown");
  });

  it("falls back to regional market days supply", () => {
    const r = classifyMarketSupply(
      { checked_at: "2026-08-20T00:00:00Z", market_days_supply: 91 }, { now: NOW });
    expect(r.basis).toBe("market_days_supply");
    expect(r.supply).toBe("abundant");
    expect(classifyMarketSupply(
      { checked_at: "2026-08-20T00:00:00Z", market_days_supply: 18 }, { now: NOW }).supply)
      .toBe("scarce");
  });

  it("refuses evidence older than the window, and evidence with no date", () => {
    expect(classifyMarketSupply(meta({ checked_at: "2025-01-01T00:00:00Z", trim_count: 90 }), { now: NOW }).supply)
      .toBe("unknown");
    expect(classifyMarketSupply({ trim_count: 90 }, { now: NOW }).supply).toBe("unknown");
  });

  it("reports nothing at all as unknown rather than scarce", () => {
    expect(classifyMarketSupply(null, { now: NOW })).toMatchObject({ supply: "unknown", basis: "none" });
    expect(classifyMarketSupply({}, { now: NOW }).supply).toBe("unknown");
  });

  it("takes its thresholds from the caller", () => {
    expect(classifyMarketSupply(meta({ trim_count: 5 }), { now: NOW, abundantCount: 4 }).supply)
      .toBe("abundant");
  });
});

// ── The cadence has to be reachable, and has to agree with the SQL ───
//
// refreshDecision was once written, tested and imported by nothing. The
// reconcile sweep's other four candidate classes are all event-driven, so a
// vehicle whose description succeeded on day one was never selected again at
// any age. A rule that nothing can reach is the same as not having it.

const fnDir = join(__dirname, "../../../supabase/functions");
const orchestrator = readFileSync(join(fnDir, "description-orchestrate/index.ts"), "utf8");
const core = readFileSync(join(fnDir, "_shared/description-core.ts"), "utf8");
const migration = readFileSync(join(fnDir,
  "../migrations/20260908160000_description_refresh_write_once.sql"), "utf8");

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
    expect(orchestrator).toMatch(/r\.reason === "refresh_due"/);
  });

  it("stamps the threshold it satisfied, so it is not re-selected nightly", () => {
    expect(orchestrator).toMatch(/last_refresh_milestone: refreshMilestone/);
    expect(migration).toMatch(/dc\.last_refresh_milestone IS NULL/);
  });

  it("never rewrites copy a human locked", () => {
    // Enforced twice on purpose: SQL keeps locked cases out of the batch at
    // all, and refreshDecision refuses if one reaches it by another path.
    expect(migration).toMatch(/dc\.master_locked IS NOT TRUE/);
    expect(refreshDecision({ ...base, dom: 883, locked: true }).due).toBe(false);
  });

  it("prefers provider days-on-market in SQL too, as the module does", () => {
    expect(migration).toMatch(/mc_attributes->>'dom'/);
    expect(migration).toMatch(/vl\.created_at/);
  });
});

describe("the SQL gate and the module agree", () => {
  it("keeps the age floor and default in lockstep", () => {
    // The SQL owns the tenant's exact threshold; the module enforces the floor.
    // If these drift, the sweep hands over cars the module then refuses.
    expect(migration).toContain(`GREATEST(COALESCE(s.refresh_age_days, ${REFRESH_POLICY.defaultAgeDays}), ${REFRESH_POLICY.minAgeDays})`);
    expect(migration).toContain(`CHECK (refresh_age_days >= ${REFRESH_POLICY.minAgeDays})`);
    expect(migration).toContain(`DEFAULT ${REFRESH_POLICY.defaultAgeDays}`);
  });

  it("keeps the supply thresholds in lockstep", () => {
    expect(migration).toContain(`COALESCE(s.refresh_abundant_supply_count, ${REFRESH_POLICY.abundantSupplyCount})`);
    expect(migration).toContain(`COALESCE(s.refresh_abundant_days_supply, ${REFRESH_POLICY.abundantDaysSupply})`);
    expect(migration).toContain(`COALESCE(s.refresh_supply_evidence_max_age_days, ${REFRESH_POLICY.supplyEvidenceMaxAgeDays})`);
  });

  it("reads the same market columns the module reads, and no others", () => {
    expect(migration).toMatch(/market_meta->>'trim_count'/);
    expect(migration).toMatch(/market_meta->>'similar_count'/);
    expect(migration).toMatch(/market_meta->>'market_days_supply'/);
    expect(migration).toMatch(/market_meta->>'checked_at'/);
    expect(migration).not.toMatch(/->>'like_count'/);
    expect(migration).not.toMatch(/vl\.market_position/);
  });

  it("only accepts a relaxation tier the module accepts", () => {
    expect(migration).toContain("IN ('trim_year_band','year_band','year','band')");
    expect(migration).not.toMatch(/'model'/);
  });
});

describe("input changes still regenerate — this is not 'never update'", () => {
  it("keeps every event-driven candidate class", () => {
    for (const cls of ["'stalled'", "'source_changed'", "'retryable'", "'missing_case'"]) {
      expect(migration, cls).toContain(cls);
    }
  });

  it("keeps source_data_version invalidation intact", () => {
    // A price change, an equipment change or a config_version bump moves
    // current_source_data_version, and that selects the vehicle regardless of
    // age, market or how recently its copy was written.
    expect(migration).toMatch(
      /dc\.current_source_data_version IS DISTINCT FROM dc\.processed_source_data_version/);
    expect(orchestrator).toMatch(/computeSourceDataVersion\(/);
    expect(orchestrator).toMatch(/mark_description_stale/);
  });

  it("keeps the refresh gate out of the copy fingerprint", () => {
    // computeConfigVersion hashes an allow-list. Adding a cadence field to it
    // would change every tenant's config_version and invalidate every
    // description on the lot — thousands of provider calls from a scheduling
    // knob that does not change a single word of copy.
    for (const col of ["refresh_age_days", "refresh_require_abundant_supply",
                       "refresh_abundant_supply_count", "refresh_abundant_days_supply",
                       "refresh_supply_evidence_max_age_days"]) {
      expect(core, col).not.toContain(col);
    }
  });
});
