import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The scheduling bug was only half the problem. The other half was that a
// tenant the scheduler passed over left NO record at all, so after the fact
// there was no way to distinguish a rooftop that never ran from one that ran
// and legitimately found nothing. Both halves are pinned here.

const sync = readFileSync(join(__dirname, "..", "marketcheck-sync", "index.ts"), "utf8");

describe("the sync reads its schedule from the tested module", () => {
  it("imports the shared scheduler", () => {
    expect(sync).toMatch(/import \{ isDue, overdueBy, skipReason \} from "\.\.\/_shared\/syncSchedule\.ts";/);
  });

  it("no longer carries a local exact-hour gate", () => {
    // `now.getUTCHours() !== cfg.run_hour` gave each tenant exactly one chance
    // per cadence period; one missed hourly tick cost a nightly dealer a day.
    expect(sync).not.toMatch(/getUTCHours\(\) !== cfg\.run_hour/);
    expect(sync).not.toMatch(/^const isDue = /m);
  });

  it("keeps the manual force path bypassing the schedule", () => {
    expect(sync).toMatch(/const forced = !!\(body\.force && body\.tenant_id\);/);
    expect(sync).toMatch(/reachable\.filter\(\(c: SyncConfig\) => forced \? true : isDue\(c, now\)\)/);
  });
});

describe("a skipped tenant leaves a trace", () => {
  it("reports why every considered tenant was passed over", () => {
    expect(sync).toMatch(/reason: skipReason\(c, now\)/);
    expect(sync).toMatch(/overdue_hours: overdueBy\(c, now\)/);
  });

  it("writes an overdue tenant to the same table a failure lands in", () => {
    expect(sync).toMatch(/status: "skipped"/);
    expect(sync).toMatch(/error_summary: `overdue by \$\{sk\.overdue_hours\}h/);
  });

  it("does not write a row for a tenant that is merely waiting for its slot", () => {
    // Otherwise every tenant writes ~23 rows a day and the signal is buried.
    expect(sync).toMatch(/if \(sk\.overdue_hours <= 0\) continue;/);
  });

  it("returns the skip list so an empty run is readable without a query", () => {
    expect(sync).toMatch(/tenants_considered: reachable\.length, skipped,/);
  });

  it("does not log skips on a forced manual run", () => {
    expect(sync).toMatch(/const skipped = forced \? \[\] : reachable/);
  });
});
