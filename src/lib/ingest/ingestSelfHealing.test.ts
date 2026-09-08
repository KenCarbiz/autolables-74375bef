import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Harte: 134 active vehicles, 122 description cases, 102 published factory
// stickers. Every one of those gaps was produced by a step that ran, failed or
// was never reached, and wrote nothing down — so "no exception" read as
// success and no sweep could find the vehicle again.
//
// ingest-orchestrate and marketcheck-sync both carry Deno globals and remote
// imports, so they are read as text here. The behaviour that CAN be executed
// is exercised directly in
// supabase/functions/_shared/intake-autoprovision.test.ts. Runtime behaviour
// of the two functions below is unverified in this repo: nothing here runs an
// edge function.

const fn = (p: string) => readFileSync(join(__dirname, "../../../supabase/functions", p), "utf8");
const orchestrate = fn("ingest-orchestrate/index.ts");
const sync = fn("marketcheck-sync/index.ts");
const shared = fn("_shared/intake-autoprovision.ts");
const ledgerSql = readFileSync(
  join(__dirname, "../../../supabase/migrations/20260729010000_vehicle_ingest_ledger.sql"),
  "utf8",
);

describe("the ledger finally has a producer", () => {
  it("writes through the RPC that enforces the tenant check and the non-empty reason", () => {
    // The table, the RPC and the reader (ingestOutcome.ts) all shipped in
    // 20260729010000 and nothing in the pipeline ever wrote a row.
    expect(ledgerSql).toMatch(/CREATE OR REPLACE FUNCTION public\.record_ingest_step/);
    expect(shared).toMatch(/admin\.rpc\("record_ingest_step"/);
    expect(shared).toMatch(/export async function recordIngestStep/);
    expect(orchestrate).toMatch(/import \{ recordIngestStep \} from "\.\.\/_shared\/intake-autoprovision\.ts"/);
  });

  it("keys the OEM manual under the step name the reader looks for", () => {
    // ingestOutcome.INGEST_STEPS calls it owners_manual; the artifact is
    // oem_owners_manual. A row filed under the wrong step is a row nobody reads.
    expect(shared).toMatch(/LEDGER_STEP: Record<string, string> = \{ oem_owners_manual: "owners_manual" \}/);
  });

  it("records a success as well as a failure", () => {
    // vehicle_exceptions is failure-only, so silence meant both "fine" and
    // "never happened". Absence can only mean something once presence does.
    const block = shared.slice(shared.indexOf("function firePost("));
    expect(block).toMatch(/if \(res\.ok\) \{[\s\S]*?"succeeded"/);
  });
});

describe("the paced queue admits what it cannot dispatch", () => {
  it("caps dispatches per isolate rather than queueing work the isolate outlives", () => {
    // A serial 250ms queue is a duration: a large feed queued minutes of
    // dispatch into a worker that is torn down first, and everything past that
    // point vanished with no invocation, no exception and no row.
    expect(shared).toMatch(/const ARTIFACT_DISPATCH_CAP = \d+/);
    expect(shared).toMatch(/if \(artifactDispatched >= ARTIFACT_DISPATCH_CAP\)/);
  });

  it("files the deferral instead of dropping it", () => {
    const block = shared.slice(shared.indexOf("if (artifactDispatched >= ARTIFACT_DISPATCH_CAP)"));
    expect(block.slice(0, 1600)).toMatch(/recordIngestStep\([\s\S]*?"parked"/);
    // An artifact no sweep re-runs has to reach the queue a human works too.
    expect(block.slice(0, 1600)).toMatch(/if \(!SWEEP_RETRIED\.has\(artifact\)\) \{[\s\S]*?recordArtifactFailure/);
  });
});

describe("the feed sync verifies descriptions instead of re-firing the lot", () => {
  it("no longer fans 200 unawaited fetches into one tick", () => {
    // The burst was the throttle, and `.catch(() => {})` made every casualty
    // invisible. It was also spent almost entirely on vehicles the
    // orchestrator answers "unchanged".
    expect(sync).not.toMatch(/for \(const vehicleId of updatedListingIds/);
    expect(sync).not.toMatch(/description-orchestrate`, \{\s*\n\s*method: "POST"/);
    expect(sync).toMatch(/await queueDescriptionRefresh\(/);
  });

  it("carries the VIN, so a dispatch can be recorded against the vehicle", () => {
    expect(sync).toMatch(/const updatedListingIds: Array<\{ id: string; vin: string \}> = \[\]/);
    expect(sync).toMatch(/updatedListingIds\.push\(\{ id: vl\.id, vin \}\)/);
  });

  it("files the run's verdict where last_status and audit_log both keep it", () => {
    // The cron discards the response body, so a count that only appears there
    // is not a record of anything.
    expect(sync).toMatch(/description_refresh: descriptionRefresh/);
    expect(sync).toMatch(/action: "marketcheck_sync"[\s\S]{0,200}details: \{ source, \.\.\.status \}/);
  });
});

describe("the fire-once claim survives a failure", () => {
  it("releases the claim so the sweep can see the vehicle again", () => {
    // claim_listing_orchestration stamps orchestrated_at BEFORE the work and
    // the sweep selects `orchestrated_at IS NULL`, so a run that claimed and
    // then failed removed the vehicle from its own self-heal forever.
    expect(orchestrate).toMatch(/async function orchestrateOneClaimSafe\(/);
    expect(orchestrate).toMatch(/update\(\{ orchestrated_at: null \}\)/);
    expect(orchestrate).toMatch(/The claim has been released so the nightly ingest-orchestrate sweep retries this vehicle/);
  });

  it("routes both entry points through the claim-safe wrapper", () => {
    // The wrapper is the only caller left; both the single-vehicle hook and
    // the sweep go through it.
    expect(orchestrate.match(/[^e] orchestrateOne\(admin,/g) || []).toHaveLength(1);
    expect(orchestrate.match(/orchestrateOneClaimSafe\(admin,/g) || []).toHaveLength(2);
  });
});

describe("the intake notifications stop disappearing", () => {
  it("has no bare fire-and-forget fetch left in the function", () => {
    // `await fetch(...).catch(() => {})` for notify-getready, notify-installer
    // and notify-recon-approval: a silent 500 and a delivered email were the
    // same event.
    const code = orchestrate.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/fetch\(`\$\{SUPABASE_URL\}/);
    expect(code).toMatch(/invokeFunction\(`\$\{SUPABASE_URL\}\/functions\/v1\/\$\{fn\}`/);
  });

  it("names the consequence, not just the HTTP status", () => {
    expect(orchestrate).toMatch(/the used-car manager never got the approve link/);
    expect(orchestrate).toMatch(/the detail department was not told this vehicle arrived/);
  });
});

describe("the sweep reconciles state, not a replay of what was queued", () => {
  it("re-attempts a publish that was lost inside the claimed window", () => {
    // The intake publish is a single UPDATE with no retry behind it, and the
    // claim is stamped before it runs, so a blocked or dropped publish left a
    // draft nothing would look at again. A draft passport is not served to
    // shoppers at all.
    expect(orchestrate).toMatch(/if \(v\.status === "draft" && \(publishAllowed\.get\(v\.tenant_id\) \?\? true\)\)/);
    // The dealer's own setting still decides, read once per tenant.
    expect(orchestrate).toMatch(/ingest_auto_publish\) !== "false"/);
    expect(orchestrate).toMatch(/"auto_publish", "parked"/);
  });

  it("asks what is missing rather than replaying a queue", () => {
    expect(orchestrate).toMatch(/async function reconcileArtifacts\(/);
    expect(orchestrate).toMatch(/readByVehicle\(admin, "description_cases"/);
    expect(orchestrate).toMatch(/readByVehicle\(admin, "factory_sticker_records"/);
  });

  it("re-fires only sticker records the pipeline left short of a document", () => {
    // Re-running an in-flight, review, terminal or published record is the
    // dedicated sweep's decision, not this one's.
    expect(orchestrate).toMatch(
      /STICKER_RETRYABLE = new Set\(\["PENDING_DATA", "FAILED_RETRYABLE", "READY_TO_GENERATE"\]\)/);
    for (const terminal of ["FAILED_PERMANENT", "SUPERSEDED", "PUBLISHED", "APPROVED"]) {
      expect(orchestrate).not.toContain(`STICKER_RETRYABLE.add("${terminal}")`);
    }
  });

  it("dispatches nothing when it could not read the state, and says so", () => {
    // Guessing here re-renders the fleet; silence here is the original defect.
    expect(orchestrate).toMatch(/if \(cases\.unreadable\.has\(v\.id\) \|\| stickers\.unreadable\.has\(v\.id\)\)/);
    expect(orchestrate).toMatch(/"ingest_reconcile", "parked"/);
  });

  it("is paced and bounded, so a fleet cannot become a burst", () => {
    expect(orchestrate).toMatch(/mapWithConcurrency\(targets, RECONCILE_CONCURRENCY/);
    expect(orchestrate).toMatch(/\{ gapMs: RECONCILE_GAP_MS \}/);
    expect(orchestrate).toMatch(/const deadline = Date\.now\(\) \+ RECONCILE_BUDGET_MS/);
    expect(orchestrate).toMatch(/if \(Date\.now\(\) >= deadline\) return/);
  });

  it("leaves a run summary the cron cannot discard", () => {
    // The schedule calls this through net.http_post and throws the body away.
    expect(orchestrate).toMatch(/action: "ingest_orchestrate_sweep"/);
    expect(orchestrate).toMatch(/details: summary/);
    expect(orchestrate).toMatch(/capped: boolean/);
  });
});
