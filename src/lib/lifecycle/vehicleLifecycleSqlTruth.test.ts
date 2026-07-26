import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// One-truth harness over the vehicle_lifecycle migration: the stored
// 22-state machine is the orchestration foundation every screen reads.
// A later migration that weakens the gate edges, the derivation order, or
// the grants fails CI instead of silently disconnecting the lifecycle.

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

describe("vehicle_lifecycle — stored state machine (L1)", () => {
  const sql = latestText(/CREATE TABLE IF NOT EXISTS public\.vehicle_lifecycle/);
  const body = norm(sql);

  it("declares all 22 lifecycle states in the CHECK constraint", () => {
    for (const s of STATES) expect(body).toContain(`'${s.toLowerCase()}'`);
  });

  it("is one row per (tenant, vehicle) with tenant-scoped read-only RLS", () => {
    expect(body).toContain("unique (tenant_id, vehicle_id)");
    expect(body).toContain("enable row level security");
    expect(body).toContain("for select to authenticated");
    expect(body).toContain("(select auth.uid())");
    expect(body).toContain("accepted_at is not null");
    // No client write policy — writes only via SECURITY DEFINER functions.
    expect(body).not.toMatch(/for (all|insert|update|delete)\s+to authenticated/);
  });

  it("guards the gate edges: REMOVED and AWAITING only exit through review or release", () => {
    expect(body).toContain("old.state = 'removed' and new.state <> 'awaiting_manager_authorization'");
    expect(body).toContain(
      "old.state = 'awaiting_manager_authorization' and new.state not in ('authorized_for_get_ready','on_hold','wholesale','removed','preload_exception')",
    );
    expect(body).toContain("old.state = 'retail_ready'");
  });
});

describe("recompute_vehicle_lifecycle — derivation truth (L2)", () => {
  const sql = latestText(/CREATE OR REPLACE FUNCTION public\.recompute_vehicle_lifecycle/);
  const body = norm(sql);

  it("never overrides the manager's gate states", () => {
    expect(body).toContain(
      "in ('awaiting_manager_authorization','on_hold','wholesale','removed','retail_ready') then return v_row.state",
    );
  });

  it("new vehicles wait at the manager gate; archived listings are REMOVED", () => {
    expect(body).toContain("'awaiting_manager_authorization') on conflict (tenant_id, vehicle_id) do nothing");
    expect(body).toContain("if v_listing.status = 'archived'");
  });

  it("derives in the agreed order: request decision > failure loop > in-progress > certified > signed > assignment", () => {
    // Scope to the derivation CASE inside the function — the state CHECK
    // list earlier in the file enumerates the same strings in enum order.
    const fn = body.slice(body.indexOf("function public.recompute_vehicle_lifecycle"));
    const start = fn.indexOf("v_next := case".replace(/\s+/g, " "));
    const derivation = fn.slice(start >= 0 ? start : 0);
    const order = [
      "'waiting_for_manager_decision'",
      "'returned_for_clarification'",
      "'repair_verification_required'",
      "'repair_in_progress'",
      "'service_findings_recorded'",
      "'k208_in_progress'",
      "'k208_ready_to_certify'",
      "'service_unassigned'",
    ];
    let last = -1;
    for (const s of order) {
      const idx = derivation.indexOf(s);
      expect(idx, s).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("voided inspections never drive the lifecycle", () => {
    expect(body).toContain("s.status <> 'voided'");
  });

  it("is revoked from anon and granted to authenticated + service_role", () => {
    expect(body).toContain("revoke all on function public.recompute_vehicle_lifecycle(uuid, uuid) from public, anon");
    expect(body).toContain("grant execute on function public.recompute_vehicle_lifecycle(uuid, uuid) to authenticated, service_role");
  });
});

describe("set_vehicle_lifecycle_gate — manager control (L3)", () => {
  const sql = latestText(/CREATE OR REPLACE FUNCTION public\.set_vehicle_lifecycle_gate/);
  const body = norm(sql);

  it("accepts only the five gate decisions", () => {
    expect(body).toContain(
      "not in ('on_hold','wholesale','removed','awaiting_manager_authorization','authorized_for_get_ready')",
    );
  });

  it("requires manager authority for interactive callers and audits every decision", () => {
    expect(body).toContain("'owner','general_manager','gsm','admin','manager','used_car_manager','inventory_manager','sales_manager'");
    expect(body).toContain("vehicle_lifecycle_gate_set");
  });

  it("a release stamps authorized_by/authorized_at and settles into the derived state", () => {
    expect(body).toContain("authorized_by = case when p_state = 'authorized_for_get_ready' then v_uid");
    expect(body).toContain("perform public.recompute_vehicle_lifecycle");
  });
});

describe("freshness + hygiene (L4)", () => {
  const sql = latestText(/trg_lifecycle_touch_inspections/);
  const body = norm(sql);

  it("every fact table that moves the lifecycle has a touch trigger", () => {
    for (const t of [
      "trg_lifecycle_touch_inspections",
      "trg_lifecycle_touch_failures",
      "trg_lifecycle_touch_requests",
      "trg_lifecycle_touch_clearance",
      "trg_lifecycle_touch_getready",
    ]) {
      expect(body).toContain(t);
    }
  });

  it("touch triggers swallow their own errors — lifecycle bookkeeping never breaks a legal write", () => {
    const touch = body.slice(body.indexOf("function public.touch_vehicle_lifecycle"));
    expect(touch).toContain("exception when others then null");
  });

  it("delisting voids the still-pending K-208 so orphans cannot recur, with a documented reason", () => {
    expect(body).toContain("trg_lifecycle_on_listing_delete");
    expect(body).toContain("auto-voided on delist");
  });

  it("backfill grandfathers existing inventory as authorized instead of freezing live work", () => {
    expect(body).toContain("'grandfathered at lifecycle rollout'");
    expect(body).toContain("on conflict (tenant_id, vehicle_id) do nothing");
  });
});

describe("authorize_vehicle_for_get_ready — the atomic release (L5)", () => {
  const sql = latestText(/CREATE OR REPLACE FUNCTION public\.authorize_vehicle_for_get_ready/);
  const body = norm(sql);

  it("locks the row and enforces manager authority for interactive callers", () => {
    expect(body).toContain("for update");
    expect(body).toContain("'owner','general_manager','gsm','admin','manager','used_car_manager','inventory_manager','sales_manager'");
  });

  it("is double-release-proof: an authorized vehicle returns already_authorized, never a second dispatch", () => {
    expect(body).toContain("'already_authorized'");
    expect(body).toContain("v_row.authorized_at is not null");
  });

  it("only releases from the pre-authorization states", () => {
    expect(body).toContain("not in ('awaiting_manager_authorization','ingested','preload_running','preload_exception')");
    expect(body).toContain("'not_awaiting'");
  });

  it("audits the release and notifies the service team once per VIN", () => {
    expect(body).toContain("vehicle_authorized_for_get_ready");
    expect(body).toContain("'vehicle_released_to_service'");
    expect(body).toContain("on conflict (dedupe_key) do nothing");
  });

  it("re-review clears the one-shot stamp so a deliberate second release is possible", () => {
    expect(body).toContain("new.authorized_at := null");
  });

  it("arrival notice: gate-born rows notify intake authority once per VIN and swallow their own errors", () => {
    expect(body).toContain("'new_vehicle_arrived'");
    expect(body).toContain("exception when others then null");
  });
});
