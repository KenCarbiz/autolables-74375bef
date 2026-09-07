import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// One-truth harness over public.operating_metrics.
//
// The dashboard once claimed 196 vehicles in recon against 134 active
// vehicles, because each screen derived its own counts. These assertions pin
// the definitions that fixed it, so a later migration that reintroduces
// published_at as the current-inventory test, or counts task rows as
// vehicles, fails CI instead of silently returning a wrong number.

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");

function latestText(pattern: RegExp): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let hit = "";
  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    if (pattern.test(text)) hit = text;
  }
  if (!hit) throw new Error(`no migration matches ${pattern}`);
  return hit;
}

const norm = (sql: string) =>
  sql.toLowerCase().replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("operating_metrics — canonical definitions (M1)", () => {
  const body = norm(latestText(/CREATE OR REPLACE FUNCTION public\.operating_metrics/));

  it("defines active inventory by status, never by published_at", () => {
    expect(body).toContain("coalesce(v.status,'') <> 'archived'");
    // published_at stays set on archived rows, so it is historical evidence a
    // vehicle was once published -- not proof it is still on the lot.
    const active = body.slice(body.indexOf("with active as"), body.indexOf("lc as"));
    expect(active).not.toContain("published_at");
  });

  it("keeps publication separate from active inventory", () => {
    expect(body).toContain("'published_inventory'");
    expect(body).toContain("'active_inventory'");
  });

  it("counts recon as unique vehicles, not estimate rows", () => {
    expect(body).toContain("count(distinct r.vehicle_listing_id)");
  });

  it("reads the lifecycle, not get_ready_records, for in-get-ready", () => {
    expect(body).toContain("vehicle_lifecycle");
    const inGr = body.slice(body.indexOf("'in_get_ready'"), body.indexOf("'get_ready_intake'"));
    expect(inGr).not.toContain("get_ready_records");
  });

  it("runs as SECURITY INVOKER so RLS decides tenant visibility", () => {
    expect(body).toContain("security invoker");
    expect(body).not.toContain("security definer");
  });

  it("counts vehicles needing a price review, never flag rows", () => {
    // 7,080 open flags on one tenant resolve to 2 vehicles, neither still on
    // the lot. Counting rows is what made the badge read 99+ forever.
    expect(body).toContain("'price_review_required'");
    expect(body).toContain("count(distinct f.vehicle_id)");
    // Joined to active inventory, so a flag on a sold car cannot count.
    const block = body.slice(body.indexOf("'price_review_required'"), body.indexOf("'used_missing_lifecycle'"));
    expect(block).toContain("join active a on a.id = f.vehicle_id");
  });

  it("reports used vehicles missing a lifecycle row as the real defect", () => {
    // New stock legitimately has no lifecycle row; used/CPO without one does not.
    expect(body).toContain("'used_missing_lifecycle'");
    expect(body).toContain("cond in ('used','cpo','certified')");
  });
});

describe("lifecycle_bucket — every canonical state is mapped (M2)", () => {
  const body = norm(latestText(/CREATE OR REPLACE FUNCTION public\.lifecycle_bucket/));
  const STATES = [
    "INGESTED", "PRELOAD_RUNNING", "PRELOAD_EXCEPTION",
    "AWAITING_MANAGER_AUTHORIZATION", "AUTHORIZED_FOR_GET_READY",
    "SERVICE_UNASSIGNED", "K208_IN_PROGRESS", "SERVICE_FINDINGS_RECORDED",
    "WAITING_FOR_MANAGER_DECISION", "RETURNED_FOR_CLARIFICATION",
    "WORK_AUTHORIZED", "REPAIR_IN_PROGRESS", "REPAIR_VERIFICATION_REQUIRED",
    "K208_READY_TO_CERTIFY", "K208_FINALIZED",
    "DETAIL_PENDING", "DETAIL_IN_PROGRESS", "FINAL_READY_VERIFICATION",
    "RETAIL_READY", "ON_HOLD", "WHOLESALE", "REMOVED",
  ];

  it("maps all 22 states from the lifecycle CHECK constraint", () => {
    const missing = STATES.filter((s) => !body.includes(s.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it("does not count terminal or gate states as get-ready work", () => {
    const gr = body.slice(0, body.indexOf("'ready'"));
    expect(gr).not.toContain("'retail_ready' then 'intake'");
    expect(body).toContain("when p_state = 'retail_ready' then 'ready'");
    expect(body).toContain("in ('on_hold','wholesale') then 'gated'");
  });
});
