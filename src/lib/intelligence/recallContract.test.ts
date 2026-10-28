import { describe, it, expect } from "vitest";
import {
  CURRENT_AUTORECALLS_PATH, DEFAULT_RECALL_TTL_DAYS, FORBIDDEN_RECALL_WORDS, LEGACY_RECALL_PATHS, readAttemptOutcome,
  summarizeRecall,
} from "./recallContract";
import type { RecallRowInput } from "../vehicleTruth/recallView";

// Synthetic rows in the shape recallState.ts writes; no real vehicle.
const NOW = Date.parse("2026-10-28T00:00:00Z");
const day = 86_400_000;
const recent = new Date(NOW - 2 * day).toISOString();
const old = new Date(NOW - 45 * day).toISOString();

const vinClear = (checkedAt = recent): RecallRowInput => ({
  recall_status: "verified_clear",
  open_recall_count: 0,
  closed_recall_count: 0,
  recall_checked_at: checkedAt,
  recall_check: { scope: "vin", state: "verified_clear", source: "marketcheck_autorecalls", checked_at: checkedAt, vin: "SYNTHETICVIN00001", open_count: 0, closed_count: 0, campaigns: [] },
});

const vinOpen = (campaignText = "Fuel pump may fail", checkedAt = recent): RecallRowInput => ({
  recall_status: "open_recalls",
  open_recall_count: 1,
  closed_recall_count: 1,
  recall_checked_at: checkedAt,
  recall_check: {
    scope: "vin", state: "open_recalls", source: "marketcheck_autorecalls", checked_at: checkedAt, vin: "SYNTHETICVIN00001", open_count: 1, closed_count: 1,
    campaigns: [
      { campaign: "26V-001", component: "Fuel system", summary: campaignText, status: "open" },
      { campaign: "25V-900", component: "Software", summary: "Display reboot", status: "closed" },
    ],
  },
});

const unanswered = (note: string): RecallRowInput => ({
  recall_status: null,
  open_recall_count: null,
  recall_checked_at: recent,
  recall_check: { scope: "vin", state: "unknown", source: "marketcheck_autorecalls", attempted_at: recent, vin: "SYNTHETICVIN00001", campaigns: [], note },
});

const modelContext = (state: "model_campaigns_found" | "no_model_campaigns_found", count: number) => ({
  scope: "model", state, source: "nhtsa", checked_at: recent, campaign_count: count, campaigns: [],
});

describe("summarizeRecall", () => {
  it("reports an open VIN recall as adverse with its count and date", () => {
    const s = summarizeRecall({ row: vinOpen(), nowMs: NOW });
    expect(s.vinState).toBe("OPEN");
    expect(s.truthState).toBe("OPEN");
    expect(s.publicState).toBe("adverse");
    expect(s.openCount).toBe(1);
    expect(s.closedCount).toBe(1);
    expect(s.doNotDrive).toBe(false);
    expect(s.publicStatement).toMatch(/^A VIN-level recall check reports 1 open manufacturer campaign as of /);
    expect(s.freshness.state).toBe("current");
    expect(s.freshness.ttlDays).toBe(DEFAULT_RECALL_TTL_DAYS);
  });

  it("flags do-not-drive language and keeps the state open", () => {
    const s = summarizeRecall({ row: vinOpen("Do not drive until the remedy is performed"), nowMs: NOW });
    expect(s.vinState).toBe("OPEN");
    expect(s.doNotDrive).toBe(true);
    expect(s.publicState).toBe("adverse");
    expect(s.publicStatement).toContain("do-not-drive language");
  });

  it("verifies a VIN-level no-open answer and tells closed-only history apart", () => {
    const clear = summarizeRecall({ row: vinClear(), nowMs: NOW });
    expect(clear.vinState).toBe("NO_OPEN");
    expect(clear.publicState).toBe("verified");
    expect(clear.openCount).toBe(0);
    expect(clear.publicStatement).toMatch(/^A VIN-level recall check reported no open campaigns for this vehicle as of /);

    const closedOnly = summarizeRecall({ row: { ...vinClear(), closed_recall_count: 2 }, nowMs: NOW });
    expect(closedOnly.vinState).toBe("CLOSED_CAMPAIGN_ONLY");
    expect(closedOnly.publicState).toBe("verified");
    expect(closedOnly.publicStatement).toContain("2 earlier campaigns are recorded as completed");

    const service = summarizeRecall({ row: vinClear(), oemServiceCampaignOnly: true, nowMs: NOW });
    expect(service.vinState).toBe("OEM_SERVICE_CAMPAIGN");
    expect(service.publicState).toBe("warning");
  });

  it("tells an entitlement block from a provider outage from a VIN not on file, and none of them is clear", () => {
    const blocked = summarizeRecall({ row: unanswered("marketcheck_http_403"), nowMs: NOW });
    expect(blocked.vinState).toBe("ENTITLEMENT_BLOCKED");
    expect(blocked.publicState).toBe("unavailable");
    expect(blocked.truthState).toBe("UNKNOWN");
    expect(blocked.openCount).toBeNull();

    const down = summarizeRecall({ row: unanswered("marketcheck_rate_limited"), nowMs: NOW });
    expect(down.vinState).toBe("PROVIDER_UNAVAILABLE");
    expect(down.publicState).toBe("unavailable");

    const unknown = summarizeRecall({ row: unanswered("marketcheck_vin_not_on_file"), nowMs: NOW });
    expect(unknown.vinState).toBe("UNKNOWN");
    expect(unknown.publicState).toBe("unknown");
    expect(unknown.publicStatement).toBe("VIN-level recall status has not been verified for this vehicle.");

    const nothing = summarizeRecall({ row: null, nowMs: NOW });
    expect(nothing.vinState).toBe("UNKNOWN");
    expect(nothing.checkedAt).toBeNull();
    expect(nothing.freshness.state).toBe("unknown");
  });

  it("carries NHTSA model context beside an unverified VIN and never lets it clear the VIN", () => {
    const found = summarizeRecall({
      row: { ...unanswered("marketcheck_vin_not_on_file"), recall_payload: modelContext("model_campaigns_found", 2) },
      nowMs: NOW,
    });
    expect(found.vinState).toBe("UNKNOWN");
    expect(found.modelState).toBe("MODEL_CAMPAIGNS_FOUND");
    expect(found.modelCampaignCount).toBe(2);
    expect(found.publicStatement).toContain("NHTSA lists 2 safety campaigns for this year, make and model; that is model-level context, not a check of this VIN.");

    const none = summarizeRecall({
      row: { recall_status: null, open_recall_count: null, recall_payload: modelContext("no_model_campaigns_found", 0) },
      nowMs: NOW,
    });
    expect(none.vinState).toBe("UNKNOWN");
    expect(none.publicState).toBe("unknown");
    expect(none.modelState).toBe("NO_MODEL_CAMPAIGNS_FOUND");
    expect(none.publicStatement).toContain("not a check of this VIN");
  });

  it("ages a clearance into stale and keeps an aged open recall open", () => {
    const staleClear = summarizeRecall({ row: vinClear(old), nowMs: NOW });
    expect(staleClear.vinState).toBe("UNKNOWN");
    expect(staleClear.publicState).toBe("stale");
    expect(staleClear.freshness.state).toBe("stale");
    expect(staleClear.publicStatement).toMatch(/older than 30 days/);

    const staleOpen = summarizeRecall({ row: vinOpen("Fuel pump may fail", old), nowMs: NOW });
    expect(staleOpen.vinState).toBe("OPEN");
    expect(staleOpen.publicState).toBe("adverse");
    expect(staleOpen.publicStatement).toContain("treated as open until");
  });

  it("reports a disagreement between stores as a warning, not a clearance", () => {
    const s = summarizeRecall({ row: { ...vinClear(), open_recall_count: 1 }, nowMs: NOW });
    expect(s.vinState).toBe("UNKNOWN");
    expect(s.publicState).toBe("warning");
    expect(s.publicStatement).toContain("Recall records on file disagree");
  });

  it("honours an explicit attempt outcome and a configurable TTL", () => {
    const s = summarizeRecall({ row: unanswered("marketcheck_response_shape_unrecognised"), attemptOutcome: "provider_unavailable", nowMs: NOW });
    expect(s.vinState).toBe("PROVIDER_UNAVAILABLE");
    const tight = summarizeRecall({ row: vinClear(), nowMs: NOW }, { ttlDays: 1 });
    expect(tight.publicState).toBe("stale");
  });

  it("never says clean, guaranteed or recall-free", () => {
    for (const row of [vinClear(), vinOpen(), unanswered("marketcheck_http_403"), null]) {
      const s = summarizeRecall({ row, nowMs: NOW });
      expect(s.publicStatement, s.vinState).not.toMatch(FORBIDDEN_RECALL_WORDS);
    }
  });
});

describe("readAttemptOutcome", () => {
  it("maps the classifier's stored notes", () => {
    expect(readAttemptOutcome("marketcheck_http_401")).toBe("entitlement_blocked");
    expect(readAttemptOutcome("marketcheck_http_403")).toBe("entitlement_blocked");
    expect(readAttemptOutcome("marketcheck_rate_limited")).toBe("provider_unavailable");
    expect(readAttemptOutcome("marketcheck_http_503")).toBe("provider_unavailable");
    expect(readAttemptOutcome("marketcheck_transport_error:timeout")).toBe("provider_unavailable");
    expect(readAttemptOutcome("marketcheck_vin_not_on_file")).toBe("not_on_file");
    expect(readAttemptOutcome("marketcheck_response_shape_unrecognised")).toBe("not_attempted");
    expect(readAttemptOutcome(null)).toBe("not_attempted");
  });

  it("names the current path and the legacy family the code still calls", () => {
    expect(CURRENT_AUTORECALLS_PATH).toBe("/v2/car/autorecalls/{vin}");
    expect(LEGACY_RECALL_PATHS).toHaveLength(4);
  });
});
