// ── Three separate permissions, never one ──────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  buildEvidenceState, decideClaimReadiness, customerMarketLanguage,
  assertsComparison, MARKET_LANGUAGE, COMPARATIVE_PHRASES,
  STRONG_COMPARABLES, STRONG_ROOFTOPS,
} from "./evidenceState.ts";
import { buildAwarenessState } from "./awareness.ts";
import { SUFFICIENT_COMPARABLES, SUFFICIENT_ROOFTOPS, SNAPSHOT_FRESH_DAYS } from "./marketSnapshot.ts";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const awareness = (over: Record<string, unknown> = {}) => buildAwarenessState({
  claims: {
    year: [{ value: 2023, source: "build_sheet" }],
    make: [{ value: "INFINITI", source: "build_sheet" }],
    model: [{ value: "QX60", source: "build_sheet" }],
    trim: [{ value: "LUXE", source: "window_sticker" }],
    drivetrain: [{ value: "AWD", source: "build_sheet" }],
    powertrain: [{ value: "3.5L V6", source: "build_sheet" }],
    bodyType: [{ value: "SUV", source: "build_sheet" }],
    vehicleClass: [{ value: "cpo", source: "dealer_confirmed" }],
    certification: [{ value: "certified", source: "dealer_confirmed" }],
    mileage: [{ value: 30496, source: "listing_feed" }],
    zip: [{ value: "06120", source: "dealer_confirmed" }],
    ...(over.claims as object ?? {}),
  },
  equipment: (over.equipment as never) ?? { entries: ["M93", "B10"], source: "build_sheet" },
  radiusMiles: 100, now: NOW,
});

const evidence = (over: Record<string, unknown> = {}) => buildEvidenceState({
  eligibleComparableCount: 5, independentRooftopCount: 3,
  observedAt: daysAgo(1), radiusMiles: 100, now: NOW, ...over,
});

describe("evidence strength uses the engine's own thresholds", () => {
  it("borrows the minimums rather than inventing new ones", () => {
    expect(SUFFICIENT_COMPARABLES).toBe(3);
    expect(SUFFICIENT_ROOFTOPS).toBe(2);
    expect(STRONG_COMPARABLES).toBe(6);
    expect(STRONG_ROOFTOPS).toBe(3);
  });

  it("is unavailable with nothing", () => {
    expect(evidence({ eligibleComparableCount: 0, independentRooftopCount: 0 }).strength).toBe("unavailable");
    expect(evidence({ eligibleComparableCount: 5, independentRooftopCount: 0 }).strength).toBe("unavailable");
  });

  it("is thin below either minimum, and says which", () => {
    const fewComps = evidence({ eligibleComparableCount: 2, independentRooftopCount: 3 });
    expect(fewComps.strength).toBe("thin");
    expect(fewComps.reasons).toContain("insufficient_comparables_2_of_3");

    const fewRooftops = evidence({ eligibleComparableCount: 5, independentRooftopCount: 1 });
    expect(fewRooftops.strength).toBe("thin");
    expect(fewRooftops.reasons).toContain("insufficient_competitor_rooftops_1_of_2");
  });

  it("is sufficient at the minimum and strong at twice it", () => {
    expect(evidence({ eligibleComparableCount: 3, independentRooftopCount: 2 }).strength).toBe("sufficient");
    expect(evidence({ eligibleComparableCount: 6, independentRooftopCount: 3 }).strength).toBe("strong");
  });

  it("uses the canonical freshness window, not a new one", () => {
    expect(SNAPSHOT_FRESH_DAYS).toBe(7);
    expect(evidence({ observedAt: daysAgo(7) }).fresh).toBe(true);
    expect(evidence({ observedAt: daysAgo(7.01) }).fresh).toBe(false);
    expect(evidence({ observedAt: null }).fresh).toBe(false);
    expect(evidence({ observedAt: null }).reasons).toContain("evidence_observation_time_unknown");
  });

  it("records owned rooftops as provenance, never as market", () => {
    const e = evidence({ ownedRooftopCount: 2 });
    expect(e.ownedRooftopCount).toBe(2);
    expect(e.independentRooftopCount).toBe(3);
    expect(e.reasons).toContain("evidence_owned_rooftop_excluded_2");
  });
});

describe("claim readiness separates the three permissions", () => {
  it("is eligible only when identity and evidence both hold", () => {
    const r = decideClaimReadiness({ awareness: awareness(), evidence: evidence() });
    expect(r.readiness).toBe("eligible");
    expect(r.safeForPropagation).toBe(true);
    expect(r.usableInternally).toBe(true);
    expect(r.reasons).toContain("claim_ready");
  });

  it("refuses everything on a cohort identity conflict", () => {
    const conflicted = awareness({
      claims: { drivetrain: [
        { value: "AWD", source: "window_sticker" }, { value: "FWD", source: "build_sheet" },
      ] },
    });
    const r = decideClaimReadiness({ awareness: conflicted, evidence: evidence() });
    expect(r.readiness).toBe("conflicted");
    expect(r.safeForPropagation).toBe(false);
    expect(r.reasons).toContain("subject_identity_conflict_drivetrain");
  });

  it("keeps context-only evidence out of any claim", () => {
    const r = decideClaimReadiness({
      awareness: awareness(), evidence: evidence(), contextOnlyEvidence: true,
    });
    expect(r.readiness).toBe("context_only");
    expect(r.safeForPropagation).toBe(false);
    expect(r.reasons).toContain("adjacent_year_context_only");
  });

  it("calls stale evidence stale, whatever its quality was", () => {
    const r = decideClaimReadiness({
      awareness: awareness(), evidence: evidence({ observedAt: daysAgo(8), eligibleComparableCount: 20, independentRooftopCount: 9 }),
    });
    expect(r.readiness).toBe("stale");
    expect(r.safeForPropagation).toBe(false);
    expect(r.reasons).toContain("snapshot_stale");
  });

  it("calls thin evidence internal_only, still usable for calculation", () => {
    const r = decideClaimReadiness({
      awareness: awareness(), evidence: evidence({ eligibleComparableCount: 2, independentRooftopCount: 1 }),
    });
    expect(r.readiness).toBe("internal_only");
    expect(r.usableInternally).toBe(true);
    expect(r.safeForPropagation).toBe(false);
    expect(r.reasons).toContain("insufficient_comparables_2_of_3");
    expect(r.reasons).toContain("insufficient_competitor_rooftops_1_of_2");
  });

  it("refuses propagation and public claims on indeterminate equipment", () => {
    const noEquipment = awareness({ equipment: { entries: null, source: "none" } });
    const r = decideClaimReadiness({ awareness: noEquipment, evidence: evidence() });
    expect(r.readiness).toBe("internal_only");
    expect(r.safeForPropagation).toBe(false);
    expect(r.reasons).toContain("equipment_indeterminate");
  });

  it("names an unknown certification rather than assuming one", () => {
    const noCert = awareness({ claims: { certification: [] } });
    const r = decideClaimReadiness({ awareness: noCert, evidence: evidence() });
    expect(r.reasons).toContain("certification_unknown");
    expect(r.readiness).toBe("internal_only");
  });

  it("records a missing provider prediction without disqualifying the claim", () => {
    const r = decideClaimReadiness({
      awareness: awareness(), evidence: evidence(), providerPredictionAvailable: false,
    });
    expect(r.readiness).toBe("eligible");
    expect(r.reasons).toContain("provider_prediction_unavailable");
  });

  it("never makes a claim eligible with no evidence at all", () => {
    const r = decideClaimReadiness({
      awareness: awareness(), evidence: evidence({ eligibleComparableCount: 0, independentRooftopCount: 0 }),
    });
    expect(r.readiness).toBe("unavailable");
  });
});

describe("the customer language contract", () => {
  it("says one fixed sentence per readiness state", () => {
    expect(customerMarketLanguage("eligible")).toBe("Compared with current similar vehicles in your market.");
    expect(customerMarketLanguage("conflicted")).toBe("Vehicle configuration is being verified.");
    for (const state of ["internal_only", "context_only", "stale", "unavailable"] as const) {
      expect(customerMarketLanguage(state), state).toBe("Market comparison currently unavailable.");
    }
  });

  it("asserts a comparison in exactly one state, and only the neutral one elsewhere", () => {
    for (const [state, copy] of Object.entries(MARKET_LANGUAGE)) {
      expect(assertsComparison(copy), state).toBe(false);
    }
  });

  it("names every comparative phrase that requires an explicit claim", () => {
    for (const phrase of COMPARATIVE_PHRASES) {
      expect(assertsComparison(`This one is ${phrase}!`), phrase).toBe(true);
    }
    expect(assertsComparison("Compared with current similar vehicles in your market.")).toBe(false);
  });

  it("never exposes an internal verdict or a diagnostic", () => {
    for (const copy of Object.values(MARKET_LANGUAGE)) {
      for (const internal of [
        "Limited Market Evidence", "insufficient", "abstain", "fingerprint",
        "confidence", "rooftop", "comparable", "$", "snapshot",
      ]) {
        expect(copy, internal).not.toContain(internal);
      }
    }
  });

  it("has no generation step — the mapping is a literal table", () => {
    const src = require("node:fs").readFileSync("src/lib/market/evidenceState.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const generative of ["prompt", "openai", "anthropic", "completion", "generate", "llm", "template`"]) {
      expect(src.toLowerCase(), generative).not.toContain(generative);
    }
    expect(src).toContain("satisfies Record<ClaimReadiness, string>");
  });

  it("cannot be extended with a new state that has no sentence", () => {
    // `satisfies Record<ClaimReadiness, string>` makes this a compile-time
    // guarantee; asserted here so the intent survives a refactor.
    const states = Object.keys(MARKET_LANGUAGE).sort();
    expect(states).toEqual([
      "conflicted", "context_only", "eligible", "internal_only", "stale", "unavailable",
    ]);
  });
});
