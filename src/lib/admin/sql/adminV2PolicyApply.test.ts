// The migrations are applied through the Lovable migration path, not from
// here, so the RPCs cannot be exercised against Postgres in this suite. These
// assertions hold the migration text to the write-safety rules the Review &
// Apply flow depends on: pricing roles only, a version check, changed rows
// only, archived stock excluded unless asked for, the verification stamp
// never touched, one ledger row per idempotency key, and health reads that
// never leak the cron command text.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");

const SQL = read("20261029000000_admin_v2_policy_apply.sql");

const definition = (sql: string, name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`function ${name} is not defined`);
  const bodyStart = sql.indexOf("AS $function$", start);
  const bodyEnd = sql.indexOf("$function$;", bodyStart);
  return { header: sql.slice(start, bodyStart), body: sql.slice(bodyStart, bodyEnd) };
};

const policies = (sql: string) =>
  sql
    .split(/CREATE POLICY /)
    .slice(1)
    .map((chunk) => "CREATE POLICY " + chunk.slice(0, chunk.indexOf(";")));

const CONTRACT_RPCS = [
  "admin_policy_version",
  "admin_doc_fee_change_preview",
  "admin_doc_fee_change_apply",
  "admin_feed_last_success",
  "admin_job_status",
];
const HELPERS = ["tenant_role_in", "admin_tenant_member_ok"];
const PRICING_ROLES = "ARRAY['owner','admin','general_manager','gsm']";

const preview = definition(SQL, "admin_doc_fee_change_preview");
const apply = definition(SQL, "admin_doc_fee_change_apply");
const feed = definition(SQL, "admin_feed_last_success");
const jobs = definition(SQL, "admin_job_status");
const version = definition(SQL, "admin_policy_version");
const roleIn = definition(SQL, "tenant_role_in");
const memberOk = definition(SQL, "admin_tenant_member_ok");

describe("admin v2 policy apply migration: shape", () => {
  it("defines every RPC of the shared contract as SECURITY DEFINER with a pinned search_path", () => {
    for (const name of [...CONTRACT_RPCS, ...HELPERS]) {
      const { header } = definition(SQL, name);
      expect(header, name).toMatch(/SECURITY DEFINER/);
      expect(header, name).toMatch(/SET search_path TO 'public'/);
    }
  });

  it("never calls auth.uid() outside the initPlan wrap", () => {
    const all = SQL.match(/auth\.uid\(\)/g) ?? [];
    const wrapped = SQL.match(/\(SELECT auth\.uid\(\)\)/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBe(wrapped.length);
  });

  it("grants EXECUTE to authenticated and service_role only, never to anon or PUBLIC", () => {
    for (const name of [...CONTRACT_RPCS, ...HELPERS]) {
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon;`));
      expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated, service_role;`));
    }
    expect(SQL).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*\banon\b/);
    expect(SQL).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*\bPUBLIC\b/);
  });

  it("writes every policy TO authenticated in the CLAUDE.md shape", () => {
    const found = policies(SQL);
    expect(found.length).toBeGreaterThan(0);
    for (const p of found) {
      expect(p).toMatch(/\n\s+TO authenticated\n/);
      expect(p).toMatch(/WHERE user_id = \(SELECT auth\.uid\(\)\) AND accepted_at IS NOT NULL/);
    }
  });

  it("carries no production identifiers and leaves existing functions alone", () => {
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(SQL).not.toMatch(/(CREATE|ALTER|DROP)[^;]*recalc_tenant_doc_fee/);
    expect(SQL).not.toMatch(/DROP FUNCTION/);
    expect(SQL).not.toMatch(/DROP TABLE/);
  });
});

describe("admin v2 policy apply migration: helpers", () => {
  it("accepts a role only for an accepted member, normalised the way the client map normalises it", () => {
    expect(roleIn.body).toMatch(/tm\.accepted_at IS NOT NULL/);
    expect(roleIn.body).toMatch(/lower\(trim\(coalesce\(tm\.role, ''\)\)\) = ANY \(p_roles\)/);
    expect(roleIn.header).toMatch(/STABLE/);
  });

  it("treats a platform admin or an accepted member as a tenant reader", () => {
    expect(memberOk.body).toMatch(/public\.has_role\(\(SELECT auth\.uid\(\)\), 'admin'::public\.app_role\)/);
    expect(memberOk.body).toMatch(/tm\.accepted_at IS NOT NULL/);
  });
});

describe("admin v2 policy apply migration: policy version", () => {
  it("adds the version column with a non-null default of 1", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.dealer_profiles\s+ADD COLUMN IF NOT EXISTS policy_version bigint NOT NULL DEFAULT 1;/);
  });

  it("bumps the version only when settings actually change", () => {
    const bump = definition(SQL, "dealer_profiles_bump_policy_version");
    expect(bump.body).toMatch(/IF NEW\.settings IS DISTINCT FROM OLD\.settings THEN\s+NEW\.policy_version := coalesce\(OLD\.policy_version, 1\) \+ 1;/);
    expect(SQL).toMatch(/CREATE TRIGGER dealer_profiles_bump_policy_version\s+BEFORE UPDATE ON public\.dealer_profiles/);
  });

  it("reads the version only for a platform admin or an accepted member", () => {
    expect(version.body).toMatch(/IF NOT public\.admin_tenant_member_ok\(p_tenant_id\) THEN/);
    expect(version.body).toMatch(/ERRCODE = '42501'/);
    expect(version.body).toMatch(/coalesce\(\(SELECT policy_version FROM public\.dealer_profiles WHERE tenant_id = p_tenant_id\), 1\)/);
  });
});

describe("admin v2 policy apply migration: recalculation stamp", () => {
  it("adds a recalculation stamp separate from the verification stamp", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.vehicle_listings\s+ADD COLUMN IF NOT EXISTS price_recalculated_at timestamp with time zone;/);
    expect(SQL).not.toMatch(/ALTER COLUMN price_last_verified_at/);
  });
});

describe("admin v2 policy apply migration: idempotency ledger", () => {
  it("keys the ledger on the idempotency key and scopes it to a tenant", () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_policy_applications \(\s+idempotency_key text PRIMARY KEY,\s+tenant_id uuid NOT NULL REFERENCES public\.tenants\(id\) ON DELETE CASCADE/);
    expect(SQL).toMatch(/ALTER TABLE public\.admin_policy_applications ENABLE ROW LEVEL SECURITY;/);
  });

  it("lets accepted members read their tenant's rows and nobody write from the client", () => {
    const ledgerPolicies = policies(SQL).filter((p) => p.includes("public.admin_policy_applications"));
    expect(ledgerPolicies).toHaveLength(1);
    expect(ledgerPolicies[0]).toMatch(/FOR SELECT\s+TO authenticated/);
    expect(SQL).toMatch(/REVOKE ALL ON public\.admin_policy_applications FROM PUBLIC, anon, authenticated;\s+GRANT SELECT ON public\.admin_policy_applications TO authenticated;/);
    expect(SQL).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL) ON public\.admin_policy_applications/);
  });
});

describe("admin_doc_fee_change_preview", () => {
  it("is read-only", () => {
    expect(preview.header).toMatch(/STABLE/);
    expect(preview.body).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
  });

  it("accepts pricing roles or a platform admin only", () => {
    expect(preview.body).toMatch(new RegExp(`public\\.tenant_role_in\\(p_tenant_id, ${PRICING_ROLES.replace(/[[\]]/g, "\\$&")}\\)`));
    expect(preview.body).toMatch(/public\.has_role\(\(SELECT auth\.uid\(\)\), 'admin'::public\.app_role\)/);
    expect(preview.body).toMatch(/ERRCODE = '42501'/);
  });

  it("counts under the changed-value predicate and excludes archived stock unless asked for", () => {
    expect(preview.body).toMatch(/doc_fee IS DISTINCT FROM v_fee\s+OR website_sale_price IS DISTINCT FROM advertised_price_before_doc \+ v_fee/);
    expect(preview.body).toMatch(/\(archived_at IS NULL OR p_include_archived\)/);
    expect(preview.body).toMatch(/archived_at IS NOT NULL AND NOT p_include_archived/);
    expect(preview.body).toMatch(/'excluded_archived', v_archived_changed/);
  });

  it("samples by VIN suffix, never the full VIN", () => {
    expect(preview.body).toMatch(/'vin_suffix', right\(vin, 6\)/);
    expect(preview.body).not.toMatch(/'vin', vin/);
    expect(preview.body).toMatch(/LIMIT 5/);
  });

  it("returns the version the review was computed against", () => {
    expect(preview.body).toMatch(/'version', v_version/);
    expect(preview.body).toMatch(/'computed_at', now\(\)/);
    expect(preview.body).toMatch(/'warnings', to_jsonb\(v_warnings\)/);
  });

  it("derives the fee the same way as apply: zero when disabled, rounded to cents when enabled", () => {
    const rule = /v_fee := CASE WHEN p_enabled THEN round\(p_amount, 2\) ELSE 0 END;/;
    expect(preview.body).toMatch(rule);
    expect(apply.body).toMatch(rule);
  });
});

describe("admin_doc_fee_change_apply", () => {
  const listingUpdateStart = apply.body.indexOf("UPDATE public.vehicle_listings");
  const listingUpdate = apply.body.slice(listingUpdateStart, apply.body.indexOf("GET DIAGNOSTICS", listingUpdateStart));

  it("accepts pricing roles or a platform admin only", () => {
    expect(apply.body).toMatch(new RegExp(`public\\.tenant_role_in\\(p_tenant_id, ${PRICING_ROLES.replace(/[[\]]/g, "\\$&")}\\)`));
    expect(apply.body).toMatch(/public\.has_role\(v_uid, 'admin'::public\.app_role\)/);
  });

  it("requires an idempotency key, a non-negative amount and an expected version", () => {
    expect(apply.body).toMatch(/length\(trim\(p_idempotency_key\)\) < 8/);
    expect(apply.body).toMatch(/p_amount IS NULL OR p_amount < 0/);
    expect(apply.body).toMatch(/IF p_expected_version IS NULL THEN/);
  });

  it("answers a repeated key from the ledger before any write, and again under the lock", () => {
    const firstLedgerRead = apply.body.indexOf("FROM public.admin_policy_applications");
    const firstWrite = apply.body.indexOf("INSERT INTO public.dealer_profiles");
    expect(firstLedgerRead).toBeGreaterThan(-1);
    expect(firstLedgerRead).toBeLessThan(firstWrite);
    const lock = apply.body.indexOf("FOR UPDATE;");
    const secondLedgerRead = apply.body.indexOf("FROM public.admin_policy_applications", lock);
    expect(secondLedgerRead).toBeGreaterThan(lock);
    expect(secondLedgerRead).toBeLessThan(apply.body.indexOf("UPDATE public.dealer_profiles"));
    expect(apply.body).toMatch(/jsonb_build_object\('status', 'duplicate', 'original_status', v_existing->>'status'\)/);
  });

  it("refuses a stale review as a conflict without writing anything", () => {
    const conflict = apply.body.indexOf("IF v_current IS DISTINCT FROM p_expected_version THEN");
    expect(conflict).toBeGreaterThan(apply.body.indexOf("FOR UPDATE;"));
    expect(conflict).toBeLessThan(apply.body.indexOf("UPDATE public.dealer_profiles"));
    expect(apply.body).toMatch(/RETURN jsonb_build_object\('status', 'conflict', 'affected', 0, 'version', v_current, 'audit_id', NULL\);/);
  });

  it("patches only the two fee keys and takes the new version from the row", () => {
    expect(apply.body).toMatch(/\|\| jsonb_build_object\('doc_fee_enabled', p_enabled, 'doc_fee_amount', p_amount\)/);
    expect(apply.body).toMatch(/RETURNING policy_version INTO v_current;/);
  });

  it("rewrites changed rows only, active stock unless archived is asked for", () => {
    expect(listingUpdate).toMatch(/AND advertised_price_before_doc IS NOT NULL/);
    expect(listingUpdate).toMatch(/AND \(archived_at IS NULL OR p_include_archived\)/);
    expect(listingUpdate).toMatch(/AND \(doc_fee IS DISTINCT FROM v_fee\s+OR website_sale_price IS DISTINCT FROM advertised_price_before_doc \+ v_fee\)/);
  });

  it("never touches the verification stamp or the parse status, and records its own stamp", () => {
    expect(listingUpdate).not.toMatch(/price_last_verified_at/);
    expect(listingUpdate).not.toMatch(/price_parse_status/);
    expect(listingUpdate).not.toMatch(/price_parse_notes/);
    expect(listingUpdate).toMatch(/price_recalculated_at = now\(\)/);
    expect(listingUpdate).toMatch(/SET doc_fee = v_fee,\s+website_sale_price = advertised_price_before_doc \+ v_fee,/);
  });

  it("leaves one audit row and one ledger row per key", () => {
    expect(apply.body).toMatch(/'doc_fee_policy_applied', 'tenant', p_tenant_id::text, p_tenant_id::text, v_uid/);
    expect(apply.body).toMatch(/'affected', v_count/);
    expect(apply.body).toMatch(/'idempotency_key', p_idempotency_key/);
    expect(apply.body).toMatch(/RETURNING id INTO v_audit_id;/);
    expect(apply.body).toMatch(/INSERT INTO public\.admin_policy_applications \(idempotency_key, tenant_id, policy, requested, result, applied_by\)\s+VALUES \(p_idempotency_key, p_tenant_id, 'doc_fee'/);
    expect(apply.body).toMatch(/jsonb_build_object\('status', 'applied', 'affected', v_count, 'version', v_current, 'audit_id', v_audit_id\)/);
  });

  it("answers a concurrent same-key winner as a duplicate instead of failing", () => {
    expect(apply.body).toMatch(/EXCEPTION\s+WHEN unique_violation THEN/);
    expect(apply.body).toMatch(/\|\| jsonb_build_object\('status', 'duplicate'\);/);
  });
});

describe("admin_feed_last_success", () => {
  it("reads the whole ledger for a success or partial run, independent of any page window", () => {
    expect(feed.body).toMatch(/SELECT max\(started_at\)\s+FROM public\.inventory_sync_runs\s+WHERE tenant_id = p_tenant_id\s+AND status IN \('success', 'partial'\)/);
    expect(feed.body).not.toMatch(/LIMIT/);
    expect(feed.body).toMatch(/IF NOT public\.admin_tenant_member_ok\(p_tenant_id\) THEN/);
  });
});

describe("admin_job_status", () => {
  it("is role-checked and never selects the cron command text or the run return message", () => {
    expect(jobs.body).toMatch(/IF NOT public\.admin_tenant_member_ok\(p_tenant_id\) THEN/);
    expect(jobs.body).not.toMatch(/\bcommand\b/);
    expect(jobs.body).not.toMatch(/return_message/);
    expect(jobs.header).toMatch(/SET search_path TO 'public', 'cron'/);
  });

  it("reads only name, schedule, enabled state and run times from cron", () => {
    expect(jobs.body).toMatch(/j\.jobname::text AS jobname,\s+j\.schedule::text AS schedule,\s+j\.active,/);
    expect(jobs.body).toMatch(/d\.status = 'succeeded'/);
    expect(jobs.body).toMatch(/'scope', 'platform'/);
  });

  it("names the platform jobs explicitly instead of exposing every schedule", () => {
    expect(jobs.body).toMatch(/WHERE j\.jobname = ANY \(v_jobs\)/);
    for (const job of ["marketcheck-sync", "autolabels_crawl_advertised_prices", "enrich-sweep-nightly", "description-reconcile-nightly"]) {
      expect(jobs.body).toContain(`'${job}'`);
    }
  });

  it("derives the tenant rows from the ledgers with the right success vocabulary", () => {
    expect(jobs.body).toMatch(/'job', 'inventory_sync'/);
    expect(jobs.body).toMatch(/inventory_sync_runs WHERE tenant_id = p_tenant_id AND status <> 'skipped'/);
    expect(jobs.body).toMatch(/inventory_sync_runs WHERE tenant_id = p_tenant_id AND status IN \('success', 'partial'\)/);
    expect(jobs.body).toMatch(/'job', 'price_crawl'/);
    expect(jobs.body).toMatch(/advertised_price_crawl_attempts WHERE tenant_id = p_tenant_id AND outcome = 'captured'/);
    expect(jobs.body).toMatch(/'job', 'description_pipeline'/);
    expect(jobs.body).toMatch(/description_jobs WHERE tenant_id = p_tenant_id AND status = 'succeeded'/);
    expect((jobs.body.match(/'scope', 'tenant'/g) ?? []).length).toBe(3);
  });
});
