// The migration is applied through the Lovable path, not from this suite, so
// these assertions hold its text to the approved rules: tenant-scoped reads,
// RPC-only writes, the existing role helpers, the active-inventory definition
// and the role arrays the client capability map grants.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { COMPLIANCE_ISSUE_KEY_PATTERN, COMPLIANCE_ISSUE_SOURCES } from "./complianceIssueKey";
import { rolesWithCapability } from "./complianceOwners";

const SQL = readFileSync("supabase/migrations/20261031000000_v2_approved_fields.sql", "utf8");
const CODE = SQL.replace(/--[^\n]*/g, "");

const policies = CODE.split(/CREATE POLICY /).slice(1).map((c) => "CREATE POLICY " + c.slice(0, c.indexOf(";")));

const fn = (name: string) => {
  const start = CODE.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`function ${name} is not defined`);
  const bodyStart = CODE.indexOf("AS $function$", start);
  const bodyEnd = CODE.indexOf("$function$;", bodyStart);
  return { header: CODE.slice(start, bodyStart), body: CODE.slice(bodyStart, bodyEnd) };
};

const definers = [...CODE.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)]
  .map((m) => m[1])
  .filter((n) => /SECURITY DEFINER/.test(fn(n).header));

const arrayIn = (text: string, needle: RegExp): string[] => {
  const m = text.match(needle);
  if (!m) throw new Error(`no array for ${needle}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
};

describe("v2 approved fields migration: policy shape", () => {
  it("writes every policy TO authenticated, SELECT only, tenant-scoped through the initPlan wrap", () => {
    expect(policies.length).toBe(3);
    for (const p of policies) {
      expect(p).toMatch(/\n\s+TO authenticated\n/);
      expect(p).toMatch(/FOR SELECT/);
      expect(p).toMatch(/tenant_id IN \(\s+SELECT tenant_id FROM public\.tenant_members\s+WHERE user_id = \(SELECT auth\.uid\(\)\) AND accepted_at IS NOT NULL/);
    }
  });

  it("never calls auth.uid() outside the (SELECT auth.uid()) wrap", () => {
    const all = CODE.match(/auth\.uid\(\)/g) ?? [];
    const wrapped = CODE.match(/\(SELECT auth\.uid\(\)\)/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBe(wrapped.length);
  });

  it("adds no policy on vehicle_listings and touches no shared profile schema", () => {
    expect(policies.some((p) => /ON public\.vehicle_listings/.test(p))).toBe(false);
    expect(CODE).not.toMatch(/ALTER TABLE public\.vehicle_listings/);
    expect(CODE).not.toMatch(/(ALTER|DROP) TABLE[^;]*public\.(onboarding_profiles|tenants|dealer_profiles)\b/);
    expect(CODE).not.toMatch(/onboarding_profiles/);
    expect(CODE).not.toMatch(/DROP (TABLE|FUNCTION|COLUMN)/);
  });

  it("is idempotent", () => {
    expect(CODE.match(/CREATE TABLE (?!IF NOT EXISTS)/g)).toBeNull();
    expect(CODE.match(/CREATE INDEX (?!IF NOT EXISTS)/g)).toBeNull();
    expect(CODE.match(/ADD COLUMN (?!IF NOT EXISTS)/g)).toBeNull();
    for (const m of CODE.matchAll(/CREATE POLICY "([^"]+)"\s+ON ([a-z_.]+)/g)) {
      expect(CODE).toContain(`DROP POLICY IF EXISTS "${m[1]}" ON ${m[2]};`);
    }
    for (const m of CODE.matchAll(/CREATE TRIGGER ([a-z_]+)[\s\S]*?ON (public\.[a-z_]+)/g)) {
      expect(CODE).toContain(`DROP TRIGGER IF EXISTS ${m[1]} ON ${m[2]};`);
    }
  });
});

describe("security definer functions", () => {
  it("are exactly the assignment RPC, the history logger and the platform counts", () => {
    expect(definers.sort()).toEqual(["assign_compliance_issue_owner", "item_failures_log_repair_approval", "platform_vehicle_counts"]);
  });

  it("pin search_path and are never executable by anon", () => {
    for (const name of definers) {
      expect(fn(name).header).toMatch(/SET search_path TO 'public'/);
      expect(CODE).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon`));
    }
  });

  it("check the caller before doing anything", () => {
    const assign = fn("assign_compliance_issue_owner").body;
    expect(assign).toMatch(/IF v_uid IS NULL THEN\s+RAISE EXCEPTION 'auth_required'/);
    expect(assign.indexOf("public.tenant_role_in(p_tenant_id")).toBeLessThan(assign.indexOf("INSERT INTO"));
    const counts = fn("platform_vehicle_counts").body;
    expect(counts.indexOf("IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN")).toBeGreaterThan(-1);
    expect(counts.indexOf("RAISE EXCEPTION 'platform admin required'")).toBeLessThan(counts.indexOf("RETURN QUERY"));
    const log = fn("item_failures_log_repair_approval");
    expect(log.header).toMatch(/RETURNS trigger/);
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION public\.item_failures_log_repair_approval\(\) FROM PUBLIC, anon, authenticated;/);
  });

  it("keeps the membership helper at invoker rights and out of a dealer's reach", () => {
    expect(fn("compliance_owner_eligible").header).not.toMatch(/SECURITY DEFINER/);
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION public\.compliance_owner_eligible\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
  });
});

describe("compliance issue owners", () => {
  it("is unique per dealership and issue key, with a key format matching the TS helper", () => {
    expect(CODE).toMatch(/CONSTRAINT compliance_issue_owners_tenant_issue_key UNIQUE \(tenant_id, issue_key\)/);
    expect(CODE).toMatch(/tenant_id uuid NOT NULL REFERENCES public\.tenants\(id\) ON DELETE CASCADE,\s+issue_key text NOT NULL,/);
    const sqlPattern = CODE.match(/issue_key ~ '([^']+)'/)?.[1];
    expect(sqlPattern).toBe(COMPLIANCE_ISSUE_KEY_PATTERN.source);
    expect(CODE).toContain(`p_issue_key !~ '${COMPLIANCE_ISSUE_KEY_PATTERN.source}'`);
    for (const s of COMPLIANCE_ISSUE_SOURCES) expect(sqlPattern).toContain(s);
  });

  it("is written only through the RPC", () => {
    expect(CODE).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\.compliance_issue_owners FROM anon, authenticated;/);
    expect(CODE).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\.compliance_issue_owner_history FROM anon, authenticated;/);
  });

  it("lets only can_manage_compliance roles assign, and only can_view_compliance members own", () => {
    const assign = fn("assign_compliance_issue_owner").body;
    expect(arrayIn(assign, /public\.tenant_role_in\(p_tenant_id, (ARRAY\[[^\]]+\])\)/)).toEqual(rolesWithCapability("can_manage_compliance"));
    const eligible = fn("compliance_owner_eligible").body;
    expect(eligible).toMatch(/tm\.tenant_id = p_tenant_id\s+AND tm\.user_id = p_user_id\s+AND tm\.accepted_at IS NOT NULL/);
    expect(arrayIn(eligible, /= ANY \((ARRAY\[[^\]]+\])\)/)).toEqual(rolesWithCapability("can_view_compliance"));
    expect(CODE).toMatch(/BEFORE INSERT OR UPDATE OF owner_user_id, tenant_id ON public\.compliance_issue_owners/);
  });

  it("appends history on every change and treats a null owner as unassign", () => {
    const assign = fn("assign_compliance_issue_owner");
    expect(assign.header).toMatch(/p_owner_user_id uuid DEFAULT NULL/);
    expect(assign.body).toMatch(/ON CONFLICT \(tenant_id, issue_key\) DO UPDATE/);
    expect(assign.body).toMatch(/INSERT INTO public\.compliance_issue_owner_history \(tenant_id, issue_key, previous_owner_user_id, owner_user_id, changed_by\)/);
    expect(CODE).not.toMatch(/(UPDATE|DELETE FROM) public\.compliance_issue_owner_history/);
  });
});

describe("prep due date", () => {
  it("adds a nullable due_at guarded to can_manage_work_queue roles", () => {
    expect(CODE).toMatch(/ALTER TABLE public\.prep_sign_offs\s+ADD COLUMN IF NOT EXISTS due_at timestamptz;/);
    const guard = fn("prep_sign_offs_guard_due_at");
    expect(guard.header).not.toMatch(/SECURITY DEFINER/);
    expect(arrayIn(guard.body, /public\.tenant_role_in\(NEW\.tenant_id, (ARRAY\[[^\]]+\])\)/)).toEqual(rolesWithCapability("can_manage_work_queue"));
    expect(CODE).toMatch(/BEFORE INSERT OR UPDATE OF due_at ON public\.prep_sign_offs/);
  });
});

describe("deal number", () => {
  it("is a nullable text column with no uniqueness anywhere", () => {
    expect(CODE).toMatch(/ALTER TABLE public\.addendums\s+ADD COLUMN IF NOT EXISTS deal_number text/);
    expect(CODE).not.toMatch(/UNIQUE[^;]*deal_number/i);
    expect(CODE).not.toMatch(/deal_number[^;]*UNIQUE/i);
    expect(CODE).toMatch(/CREATE INDEX IF NOT EXISTS addendums_tenant_deal_number_idx\s+ON public\.addendums \(tenant_id, deal_number\)/);
    expect(CODE).not.toMatch(/deal_number[^;\n]*DEFAULT/);
  });
});

describe("repair approval", () => {
  it("defaults to pending with three explicit states and leaves repair and inspection status alone", () => {
    expect(CODE).toMatch(/ADD COLUMN IF NOT EXISTS repair_approval text NOT NULL DEFAULT 'pending'/);
    expect(CODE).toMatch(/CHECK \(repair_approval IN \('pending','approved','not_approved'\)\)/);
    expect(CODE).not.toMatch(/repair_state\s*(=|:=)/);
    expect(CODE).not.toMatch(/inspection_passed|reinspected_by|item_failure_reinspector_required/);
    expect(SQL).toMatch(/Internal service-manager authorization, not customer consent/);
  });

  it("lets only can_approve_service_work roles change it and stamps who and when", () => {
    const guard = fn("item_failures_guard_repair_approval");
    expect(guard.header).not.toMatch(/SECURITY DEFINER/);
    expect(guard.body).toMatch(/IF current_user = 'authenticated' THEN/);
    expect(arrayIn(guard.body, /public\.tenant_role_in\(NEW\.tenant_id, (ARRAY\[[^\]]+\])\)/)).toEqual(rolesWithCapability("can_approve_service_work"));
    expect(guard.body).toMatch(/NEW\.repair_approval_by := coalesce\(v_uid, NEW\.repair_approval_by\);\s+NEW\.repair_approval_at := now\(\);/);
    expect(guard.body).toMatch(/NEW\.repair_approval_by := OLD\.repair_approval_by;/);
    expect(CODE).toMatch(/BEFORE INSERT OR UPDATE OF repair_approval, repair_approval_by, repair_approval_at\s+ON public\.safety_inspection_item_failures/);
  });

  it("records every change in an append-only history that survives the failure row", () => {
    expect(CODE).toMatch(/AFTER INSERT OR UPDATE OF repair_approval ON public\.safety_inspection_item_failures/);
    expect(CODE).toMatch(/failure_id uuid NOT NULL,\n/);
    expect(CODE).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\.safety_inspection_repair_approval_history FROM anon, authenticated;/);
    expect(fn("set_repair_approval").header).toMatch(/SECURITY INVOKER/);
  });
});

describe("platform vehicle counts", () => {
  const counts = fn("platform_vehicle_counts");

  it("returns counts per dealership only and is executable by authenticated alone", () => {
    expect(counts.header).toMatch(/RETURNS TABLE \(tenant_id uuid, active_vehicles bigint\)/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION public\.platform_vehicle_counts\(\) TO authenticated;/);
    expect(CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.platform_vehicle_counts\(\) TO [^;]*(anon|service_role)/);
    expect(counts.body).toMatch(/SELECT t\.id AS tenant_id, count\(v\.id\)::bigint AS active_vehicles/);
    expect(counts.body).not.toMatch(/v\.vin|v\.\*|SELECT \*/);
  });

  it("matches operating_metrics' active inventory: not archived, never published_at", () => {
    expect(counts.body).toContain("coalesce(v.status,'') <> 'archived'");
    expect(counts.body).not.toContain("published_at");
    const canonical = readFileSync("supabase/migrations/20260907140000_canonical_operating_metrics.sql", "utf8");
    expect(canonical).toContain("AND coalesce(v.status,'') <> 'archived'");
  });
});

describe("role arrays stay in lockstep with the capability map", () => {
  it("uses the same literal arrays the existing guards use", () => {
    const recallGuard = readFileSync("supabase/migrations/20261029001000_admin_v2_settings_authority.sql", "utf8");
    expect(recallGuard).toContain("ARRAY['owner','admin','general_manager','gsm','manager','compliance','office','finance']");
    expect(CODE).toContain("ARRAY['owner','admin','general_manager','gsm','manager','compliance','office','finance']");
    const decide = readFileSync("supabase/migrations/20260726107000_service_request_decision.sql", "utf8");
    expect(decide).toMatch(/'owner','general_manager','gsm','admin','manager',\s+'sales_manager','used_car_manager','service_manager'/);
  });
});
