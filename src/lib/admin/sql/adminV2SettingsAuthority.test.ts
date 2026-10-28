// The migrations are applied through the Lovable migration path, not from
// here, so the policies cannot be exercised against Postgres in this suite.
// These assertions hold the migration text to the authority rules: the server
// decides which role may change which settings key, members no longer write
// dealer_profiles directly, product writes need an add-on role, and a
// listing's price or recall override cannot be changed by an API caller whose
// role does not carry that capability, while service jobs are untouched.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");

const SQL = read("20261029001000_admin_v2_settings_authority.sql");
const PREVIOUS = read("20261029000000_admin_v2_policy_apply.sql");

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

const ADDON_ROLES = "ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance']";
const escape = (s: string) => s.replace(/[[\]().]/g, "\\$&");

const merge = definition(SQL, "merge_dealer_settings");
const guard = definition(SQL, "vehicle_listings_guard_priced_columns");

describe("admin v2 settings authority migration: shape", () => {
  it("follows the policy apply migration and uses the helper it defines", () => {
    expect("20261029001000_admin_v2_settings_authority.sql" > "20261029000000_admin_v2_policy_apply.sql").toBe(true);
    expect(PREVIOUS).toMatch(/CREATE OR REPLACE FUNCTION public\.tenant_role_in\(p_tenant_id uuid, p_roles text\[\]\)/);
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\.tenant_role_in/);
    expect(SQL).toMatch(/public\.tenant_role_in\(/);
  });

  it("never calls auth.uid() outside the initPlan wrap", () => {
    const all = SQL.match(/auth\.uid\(\)/g) ?? [];
    const wrapped = SQL.match(/\(SELECT auth\.uid\(\)\)/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBe(wrapped.length);
  });

  it("writes every policy TO authenticated and decides it with the server-side role helper", () => {
    const found = policies(SQL);
    expect(found.length).toBe(6);
    for (const p of found) {
      expect(p).toMatch(/\n\s+TO authenticated\n/);
      expect(p).toMatch(/public\.tenant_role_in\(tenant_id, ARRAY\[/);
      expect(p).not.toMatch(/FOR ALL/);
    }
  });

  it("carries no production identifiers and touches no existing migration's functions beyond the settings merge", () => {
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(SQL).not.toMatch(/(CREATE|ALTER|DROP)[^;]*recalc_tenant_doc_fee/);
    expect(SQL).not.toMatch(/DROP FUNCTION/);
    expect(SQL).not.toMatch(/DROP TABLE/);
    expect(SQL).not.toMatch(/DROP POLICY[^;]*ON public\.vehicle_listings/);
  });
});

describe("merge_dealer_settings: key-level authority", () => {
  it("keeps the signature, the definer context and the patch-only merge", () => {
    expect(merge.header).toMatch(/merge_dealer_settings\(_tenant_id uuid, _patch jsonb\)\s+RETURNS boolean/);
    expect(merge.header).toMatch(/SECURITY DEFINER/);
    expect(merge.body).toMatch(/SET settings\s+= coalesce\(dealer_profiles\.settings, '\{\}'::jsonb\) \|\| coalesce\(_patch, '\{\}'::jsonb\),/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.merge_dealer_settings\(uuid, jsonb\) FROM PUBLIC, anon;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.merge_dealer_settings\(uuid, jsonb\) TO authenticated, service_role;/);
  });

  it("still refuses a caller who is neither an accepted member nor a platform admin", () => {
    expect(merge.body).toMatch(/tm\.accepted_at IS NOT NULL/);
    expect(merge.body).toMatch(/IF v_role IS NULL AND NOT v_admin THEN\s+RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';/);
  });

  it("keeps the service policy keys and roles exactly as the hardening migration set them", () => {
    expect(merge.body).toMatch(/'k208_authority_roles','k208_authorized_users',\s+'require_safety_inspection','require_k208_licensee_certification',\s+'service_failure_photo_required','service_reinspection_managers_only',\s+'service_pass_all_enabled','service_overdue_hours'\]/);
    expect(merge.body).toMatch(/v_service_roles text\[\] := ARRAY\['owner','general_manager','gsm','admin','manager','service_manager'\];/);
  });

  it("gives pricing keys to the same roles the fee apply RPC accepts", () => {
    expect(merge.body).toMatch(/v_pricing_keys text\[\] := ARRAY\[\s+'doc_fee_enabled','doc_fee_amount','doc_fee_state',\s+'price_display_mode','price_label','comp_settings',/);
    expect(merge.body).toMatch(/v_pricing_roles text\[\] := ARRAY\['owner','admin','general_manager','gsm'\];/);
    expect(PREVIOUS).toMatch(/ARRAY\['owner','admin','general_manager','gsm'\]/);
  });

  it("gives routing keys to settings managers and deal managers", () => {
    expect(merge.body).toMatch(/v_routing_keys text\[\] := ARRAY\[\s+'passport_contact_routing','passport_agents','vehicle_agent_assignments','passport_rotation_state'\];/);
    expect(merge.body).toMatch(/v_routing_roles text\[\] := ARRAY\['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance'\];/);
  });

  it("gives publishing and brand keys to settings-managing roles", () => {
    expect(merge.body).toMatch(/v_publishing_keys text\[\] := ARRAY\[\s+'ingest_auto_publish','document_rules',/);
    expect(merge.body).toMatch(/v_settings_roles text\[\] := ARRAY\['owner','admin','general_manager','gsm','manager'\];/);
    expect(merge.body).toMatch(/\('publishing', v_publishing_keys, v_settings_roles\)/);
    expect(merge.body).toMatch(/IF array_length\(v_touched, 1\) > 0 AND NOT \(v_role = ANY \(v_settings_roles\)\) THEN\s+RAISE EXCEPTION 'not_authorized_for_settings_keys'/);
  });

  it("gives add-on claims to the roles that hold can_manage_addons", () => {
    expect(merge.body).toMatch(/v_addon_keys text\[\] := ARRAY\[\s+'dealer_programs','oem_factory_warranties','cpo_programs',/);
    expect(merge.body).toMatch(new RegExp(`v_addon_roles text\\[\\] := ${escape(ADDON_ROLES)};`));
  });

  it("leaves exactly three workspace preference keys open to any accepted member", () => {
    expect(merge.body).toMatch(/v_member_keys text\[\] := ARRAY\['label_defaults','used_sticker_options','inventory_show_quick_actions'\];/);
    expect(merge.body).toMatch(/v_service_keys \|\| v_pricing_keys \|\| v_routing_keys \|\| v_publishing_keys \|\| v_addon_keys \|\| v_member_keys/);
  });

  it("lets a platform admin through every class and refuses with a permission error otherwise", () => {
    expect(merge.body).toMatch(/v_admin := public\.has_role\(v_uid, 'admin'::public\.app_role\);/);
    expect(merge.body).toMatch(/IF NOT v_admin THEN\s+FOR v_class IN/);
    expect(merge.body).toMatch(/IF v_keys && v_class\.keys AND NOT \(v_role = ANY \(v_class\.roles\)\) THEN\s+RAISE EXCEPTION 'not_authorized_for_policy_keys' USING ERRCODE = '42501', DETAIL = v_class\.name;/);
  });

  it("audits every policy-class change with before and after values, keeping the service action name", () => {
    for (const action of ["service_policy_changed", "pricing_policy_changed", "routing_policy_changed", "publishing_policy_changed", "addon_policy_changed"]) {
      expect(merge.body).toContain(`('${action}',`);
    }
    expect(merge.body).toMatch(/INSERT INTO public\.audit_log \(action, entity_type, entity_id, store_id, user_id, details\)\s+VALUES \(v_class\.action, 'tenant', _tenant_id::text, _tenant_id::text, v_uid,/);
    expect(merge.body).toMatch(/'prev', \(SELECT jsonb_object_agg\(k, dp\.settings -> k\)/);
    expect(merge.body).toMatch(/'next', \(SELECT jsonb_object_agg\(k, _patch -> k\) FROM unnest\(v_touched\) AS k\)/);
    expect(merge.body.indexOf("INSERT INTO public.audit_log")).toBeLessThan(merge.body.indexOf("INSERT INTO public.dealer_profiles"));
  });
});

describe("dealer_profiles: RPC-only for members", () => {
  it("drops the member-wide insert and update policies and keeps the platform admin and read policies", () => {
    expect(SQL).toMatch(/DROP POLICY IF EXISTS dealer_profiles_update ON public\.dealer_profiles;/);
    expect(SQL).toMatch(/DROP POLICY IF EXISTS dealer_profiles_insert ON public\.dealer_profiles;/);
    expect(SQL).not.toMatch(/Platform admins write all dealer profiles/);
    expect(SQL).not.toMatch(/Platform admins read all dealer profiles/);
    expect(SQL).not.toMatch(/dealer_profiles_select/);
    expect(policies(SQL).some((p) => p.includes("public.dealer_profiles"))).toBe(false);
  });

  it("keeps SELECT for authenticated and removes the privileges row security never governed", () => {
    expect(SQL).not.toMatch(/REVOKE[^;]*SELECT[^;]*ON public\.dealer_profiles[^;]*authenticated/);
    expect(SQL).toMatch(/REVOKE TRUNCATE, REFERENCES, TRIGGER ON public\.dealer_profiles FROM anon, authenticated;/);
    expect(SQL).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.dealer_profiles FROM anon;/);
    expect(SQL).not.toMatch(/REVOKE[^;]*UPDATE[^;]*ON public\.dealer_profiles FROM[^;]*authenticated/);
  });
});

describe("products and product_rules: add-on roles write, everyone reads as before", () => {
  it("replaces the member-wide write policies with per-command add-on role policies", () => {
    expect(SQL).toMatch(/DROP POLICY IF EXISTS "products tenant members write" ON public\.products;/);
    expect(SQL).toMatch(/DROP POLICY IF EXISTS "Tenant members write product_rules" ON public\.product_rules;/);
    const found = policies(SQL);
    for (const table of ["products", "product_rules"]) {
      for (const command of ["INSERT", "UPDATE", "DELETE"]) {
        const p = found.find((x) => x.includes(`ON public.${table} FOR ${command}`));
        expect(p, `${table} ${command}`).toBeDefined();
        expect(p).toMatch(new RegExp(`public\\.tenant_role_in\\(tenant_id, ${escape(ADDON_ROLES)}\\)`));
      }
    }
  });

  it("never lets a tenant role write a platform template product", () => {
    for (const p of policies(SQL).filter((x) => x.includes("ON public.products FOR"))) {
      expect(p).toMatch(/tenant_id IS NOT NULL\s+AND public\.tenant_role_in/);
    }
  });

  it("leaves the read policies alone", () => {
    expect(SQL).not.toMatch(/products tenant members read/);
    expect(SQL).not.toMatch(/Tenant members read product_rules/);
    expect(SQL).not.toMatch(/Admins can (insert|update|delete) products/);
  });
});

describe("vehicle_listings: priced and recall-override column guard", () => {
  it("runs as the caller so it can tell an API request from a service job", () => {
    expect(guard.header).not.toMatch(/SECURITY DEFINER/);
    expect(guard.body).toMatch(/IF current_user <> 'authenticated' THEN\s+RETURN NEW;\s+END IF;/);
  });

  it("fires only when a guarded column is in the update list", () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_vehicle_listings_priced_columns_guard\s+BEFORE UPDATE OF price, doc_fee, website_sale_price, advertised_price_before_doc, dealer_discount, retail_cash,\s+recall_override_by, recall_override_notes, recall_override_at\s+ON public\.vehicle_listings\s+FOR EACH ROW/);
  });

  it("passes through when no guarded value changed, and for a platform admin", () => {
    expect(guard.body).toMatch(/IF NOT v_price_changed AND NOT v_recall_changed THEN\s+RETURN NEW;/);
    expect(guard.body).toMatch(/IF public\.has_role\(v_uid, 'admin'::public\.app_role\) THEN\s+RETURN NEW;/);
  });

  it("requires the roles that hold can_edit_inventory for price columns and can_manage_compliance for a recall override", () => {
    expect(guard.body).toMatch(/IF v_price_changed AND NOT public\.tenant_role_in\(v_tenant, ARRAY\['owner','admin','general_manager','gsm','manager','inventory_manager','used_car_manager'\]\) THEN/);
    expect(guard.body).toMatch(/IF v_recall_changed AND NOT public\.tenant_role_in\(v_tenant, ARRAY\['owner','admin','general_manager','gsm','manager','compliance','office','finance'\]\) THEN/);
    expect((guard.body.match(/ERRCODE = '42501'/g) ?? []).length).toBe(3);
  });

  it("lets the creator of a tenantless draft keep editing it and nobody else", () => {
    expect(guard.body).toMatch(/IF v_tenant IS NULL THEN\s+IF OLD\.created_by = v_uid THEN\s+RETURN NEW;\s+END IF;\s+RAISE EXCEPTION/);
  });

  it("compares every guarded column with IS DISTINCT FROM so a null-to-null write is not a change", () => {
    for (const column of ["price", "doc_fee", "website_sale_price", "advertised_price_before_doc", "dealer_discount", "retail_cash", "recall_override_by", "recall_override_notes", "recall_override_at"]) {
      expect(guard.body).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
    }
  });

  it("removes the table privileges row security never governed", () => {
    for (const table of ["products", "product_rules", "vehicle_listings"]) {
      expect(SQL).toMatch(new RegExp(`REVOKE TRUNCATE, REFERENCES, TRIGGER ON public\\.${table} FROM anon, authenticated;`));
    }
  });
});
