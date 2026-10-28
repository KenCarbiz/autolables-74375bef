import { describe, it, expect } from "vitest";
import { deriveJobRow, describeCron, JOB_CATALOG, type CronStatusRow, type JobSpec } from "./jobs";

const NOW = Date.parse("2026-10-24T14:30:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const spec = (id: string): JobSpec => JOB_CATALOG.find((j) => j.id === id) as JobSpec;
const cron = (patch: Partial<CronStatusRow> = {}): CronStatusRow => ({ jobname: "marketcheck-sync", schedule: "7 * * * *", active: true, last_status: "succeeded", last_message: null, last_start: hoursAgo(1), last_end: hoursAgo(1), ...patch });

describe("deriveJobRow", () => {
  it("never reads healthy from a cron row alone", () => {
    const row = deriveJobRow({ spec: spec("inventory_sync"), cron: cron(), ledger: null, now: NOW });
    expect(row.verdict.state).toBe("unknown");
    expect(row.evidence).toBe("none");
  });

  it("is healthy from the rooftop ledger inside the cadence window", () => {
    const row = deriveJobRow({ spec: spec("inventory_sync"), cron: cron(), ledger: { lastAttemptAt: hoursAgo(8), lastSuccessAt: hoursAgo(8), lastOutcome: "succeeded" }, now: NOW });
    expect(row.verdict.state).toBe("healthy");
    expect(row.evidence).toBe("rooftop_ledger");
  });

  it("degrades when the newest attempt failed after an older success", () => {
    const row = deriveJobRow({ spec: spec("inventory_sync"), cron: cron(), ledger: { lastAttemptAt: hoursAgo(8), lastSuccessAt: hoursAgo(56), lastOutcome: "failed" }, now: NOW });
    expect(row.verdict.state).toBe("degraded");
    expect(row.verdict.headline).toBe("Last run failed");
  });

  it("uses the scheduler record only for jobs without a rooftop ledger", () => {
    const global = deriveJobRow({ spec: spec("incentives"), cron: cron({ jobname: "marketcheck-incentives", last_start: hoursAgo(10) }), ledger: null, now: NOW });
    expect(global.verdict.state).toBe("healthy");
    expect(global.evidence).toBe("scheduler");
    const perRooftop = deriveJobRow({ spec: spec("price_crawl"), cron: cron({ jobname: "autolabels_crawl_advertised_prices" }), ledger: null, now: NOW });
    expect(perRooftop.verdict.state).toBe("unknown");
  });

  it("reads unavailable, paused and unscheduled honestly", () => {
    expect(deriveJobRow({ spec: spec("specs_backfill"), cron: "unavailable", ledger: null, now: NOW }).verdict.state).toBe("unknown");
    expect(deriveJobRow({ spec: spec("specs_backfill"), cron: cron({ active: false }), ledger: null, now: NOW }).verdict.state).toBe("disabled");
    expect(deriveJobRow({ spec: spec("specs_backfill"), cron: null, ledger: null, now: NOW }).verdict.state).toBe("not_configured");
    expect(deriveJobRow({ spec: spec("price_crawl"), cron: "unavailable", ledger: null, ledgerLoadFailed: true, now: NOW }).verdict.headline).toBe("Job status could not be read");
  });
});

describe("describeCron", () => {
  it("reads the shapes the app schedules", () => {
    expect(describeCron("7 * * * *")).toBe("Hourly at :07");
    expect(describeCron("20 7 * * *")).toBe("Daily at 07:20 UTC");
    expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
    expect(describeCron(null)).toBe("Schedule not readable");
    expect(describeCron("0 3 * * 1")).toBe("0 3 * * 1");
  });
});
