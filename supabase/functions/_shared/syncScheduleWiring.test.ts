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
    expect(sync).toMatch(/overdue by \$\{sk\.overdue_hours\}h/);
  });

  it("records an on-time skip too, not just an overdue one", () => {
    // This filter used to be `sk.overdue_hours <= 0`, written when the cron ran
    // hourly and would have logged ~23 no-op rows a day. The cron has been
    // daily since 20260620030000, so the filter now only hides the one skip an
    // operator actually needs: a tenant passed over because a manual run reset
    // its clock leaves NO run row, and is indistinguishable from a run that
    // died partway through.
    expect(sync).toMatch(/if \(!sk\.reason \|\| sk\.reason === "due"\) continue;/);
    expect(sync).not.toMatch(/if \(sk\.overdue_hours <= 0\) continue;/);
  });

  it("does not let a manual run reset the schedule clock", () => {
    // last_run_at paces the nightly, which requires a 20-hour gap. A manual
    // "Sync now" during the dealership's day used to write it, silently
    // cancelling that night's run — so troubleshooting a quiet nightly
    // guaranteed the next one never happened.
    expect(sync).toMatch(/const scheduleClock = \(\) => \(forced \? \{\} : \{ last_run_at: now\.toISOString\(\) \}\)/);
    // Counting the writers, not just confirming one is guarded. The first
    // attempt at this fix guarded the success path and left the two failure
    // paths writing the clock raw — and a presence-only assertion passed,
    // certifying a fix that did not work on the paths that produce the bug.
    // A dealer presses Sync now precisely BECAUSE the feed is not resolving.
    expect(sync.match(/last_run_at: now\.toISOString\(\)/g) ?? []).toHaveLength(1);
    expect(sync.match(/\.\.\.scheduleClock\(\)/g) ?? []).toHaveLength(2);
  });

  it("returns the skip list so an empty run is readable without a query", () => {
    expect(sync).toMatch(/tenants_considered: reachable\.length, skipped,/);
  });

  it("does not log skips on a forced manual run", () => {
    expect(sync).toMatch(/const skipped = forced \? \[\] : reachable/);
  });
});
