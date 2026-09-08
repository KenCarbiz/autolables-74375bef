import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// One-truth harness over the migration FILES for Get Ready CREATION: whatever
// the lexically latest migration says a function is, IS what production runs
// after `db push`. Edge functions and SQL are outside tsconfig, so this is what
// stops a later migration from silently re-narrowing the seed.
//
// The measured defect this pins: create_draft_get_ready returned NULL for any
// condition other than used/cpo/certified, so on the live tenant 64 of 134
// active vehicles had a Get Ready record and 70 new cars had none — while a new
// car still has to be washed, detailed, photographed and made lot-ready before
// it can be sold.

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");

function latestDefinition(fn: string): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const marker = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`, "g");
  let hit: { file: string; body: string } | null = null;
  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    let m: RegExpExecArray | null = null;
    let last: number | null = null;
    while ((m = marker.exec(text)) !== null) last = m.index;
    marker.lastIndex = 0;
    if (last === null) continue;
    const rest = text.slice(last);
    const open = rest.match(/AS\s+(\$[a-zA-Z_]*\$)/);
    if (!open) { hit = { file, body: rest }; continue; }
    const tag = open[1];
    const bodyStart = (open.index as number) + open[0].length;
    const close = rest.indexOf(tag, bodyStart);
    hit = { file, body: close === -1 ? rest : rest.slice(0, close + tag.length) };
  }
  if (!hit) throw new Error(`no migration defines public.${fn}`);
  return hit;
}

const norm = (sql: string) =>
  sql.toLowerCase().replace(/--[^\n]*/g, "").replace(/\s+/g, " ").replace(/,\s+/g, ",");

describe("create_draft_get_ready — every vehicle gets Get Ready work", () => {
  const body = norm(latestDefinition("create_draft_get_ready").body);

  it("no longer abandons a vehicle for not being used or CPO", () => {
    expect(body).not.toContain("if v_cond not in ('used','cpo','certified') then return null");
  });

  it("uses the same used-vehicle test recompute_vehicle_lifecycle uses", () => {
    // Two different answers to "is this a used vehicle" is how the service
    // queue and the lifecycle would start disagreeing about the same car.
    expect(body).toContain("v_needs_service := v_cond in ('used','cpo','certified')");
    const lifecycle = norm(latestDefinition("recompute_vehicle_lifecycle").body);
    expect(lifecycle).toContain("condition not in ('used','cpo','certified')");
  });

  it("seeds the SERVICE worklist only for used/CPO", () => {
    const service = body.slice(body.indexOf("if v_needs_service then"));
    expect(body.indexOf("if v_needs_service then")).toBeGreaterThan(-1);
    expect(service.slice(0, service.indexOf("end if"))).toContain("ct k-208 safety inspection");
  });

  it("seeds the DETAIL worklist unconditionally — new stock included", () => {
    const detail = body.slice(body.indexOf("v_detail := public.get_ready_template_items"));
    const beforeAppend = detail.slice(0, detail.indexOf("v_items := v_items || v_detail"));
    expect(beforeAppend.length).toBeGreaterThan(0);
    expect(beforeAppend).not.toContain("if v_needs_service then");
    expect(detail).toContain("interior detail");
  });

  it("does not seed unowned vendor draft lines onto new stock", () => {
    // An unowned line still counts against the "every item complete" rollup
    // that moves a record to ready, so one per active installer on 70 new cars
    // would be work no department drains.
    const vendors = body.slice(body.indexOf("from public.installer_contacts"));
    expect(vendors.slice(0, 200)).toContain("and active and v_needs_service");
  });

  it("asks for no safety inspection on a vehicle that needs no service work", () => {
    // inspection_required tracks the department split; a new car must not show
    // an "Inspection due" chip or a CT-K208 form it will never have.
    expect(body).toContain("v_needs_service,case when v_needs_service then 'ct-k208' end");
  });

  it("prefers the dealer's own standard_prep_templates for both departments", () => {
    expect(body).toContain("public.get_ready_template_items(p_tenant_id,v_cond,'service')");
    expect(body).toContain("public.get_ready_template_items(p_tenant_id,v_cond,'detail')");
    const templates = norm(latestDefinition("get_ready_template_items").body);
    expect(templates).toContain("from public.standard_prep_templates");
    expect(templates).toContain("coalesce(t.active,true)");
  });

  it("is idempotent on (tenant, vin), including against a concurrent ingest", () => {
    const existing = body.slice(body.indexOf("select id into v_existing"));
    // Case-insensitive: dms-webhook and autocurb-sync store the provider's
    // spelling verbatim, and an equality test would mint a SECOND row for a car
    // whose record is stored lowercase — which the unique index cannot catch.
    expect(existing.slice(0, 200)).toContain("where tenant_id = p_tenant_id and upper(vin) = v_vin");
    expect(existing.slice(0, 400)).not.toContain("where tenant_id = p_tenant_id and vin = v_vin");
    expect(body).toContain("if v_existing is not null then return v_existing; end if");
    expect(body).toContain("on conflict do nothing");
    expect(body).toContain("if v_id is null then");
  });

  it("finds the listing whatever spelling its VIN was stored in", () => {
    expect(body).toContain("from public.vehicle_listings where tenant_id = p_tenant_id and upper(vin) = v_vin");
  });

  it("never seeds a record for an archived vehicle", () => {
    // Records for cars sold months ago are how the table reached 196 rows
    // against 134 active vehicles (20260907160000).
    expect(body).toContain("if v_status = 'archived' then return null; end if");
  });

  it("still asserts tenant membership before writing", () => {
    expect(body).toContain("perform public.assert_tenant_member_or_service(p_tenant_id)");
  });

  it("still reads stock from vehicle_files first", () => {
    expect(body).toContain("from public.vehicle_files");
    expect(body).toContain("stock_number");
  });

  it("does not invent lifecycle states or touch certification authority", () => {
    expect(body).not.toContain("vehicle_lifecycle");
    expect(body).not.toContain("k208_authority_roles");
    expect(body).not.toContain("k208_authorized_users");
    expect(body).not.toContain("k208_signer_allowed");
  });
});

describe("sweep_missing_get_ready — the safety net for the detail record", () => {
  const def = latestDefinition("sweep_missing_get_ready");
  const body = norm(def.body);

  it("covers every condition, unlike the used-only intake draft sweep", () => {
    expect(body).not.toContain("in ('used','cpo','certified')");
    expect(body).toContain("coalesce(v.status,'') <> 'archived'");
  });

  it("only fills the gap — a vehicle that already has a record is skipped", () => {
    expect(body).toContain("not exists");
    expect(body).toContain("from public.get_ready_records g");
    expect(body).toContain("upper(g.vin) = upper(trim(v.vin))");
  });

  it("is cron/service only: an interactive session cannot run a cross-tenant sweep", () => {
    expect(body).toContain("if (select auth.uid()) is not null then raise exception 'insufficient_permission'");
  });
});
