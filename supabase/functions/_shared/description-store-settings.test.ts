import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyStoreOverrides, loadStoreSettings, renderVehicleSettings, STORE_OVERRIDABLE_KEYS } from "./description-store-settings.ts";
import { formatMoney, VAUTO_GATE_VERSION } from "./vauto-export-gate.ts";

const settingsSql = readFileSync("supabase/proposed/20261109000000_description_store_settings.sql", "utf8");
const gateSql = readFileSync("supabase/proposed/20261109000100_vauto_export_gate.sql", "utf8");
const exportFn = readFileSync("supabase/functions/description-export/index.ts", "utf8");

describe("applyStoreOverrides", () => {
  const tenant = { brand_voice: "group", cta_template: "Call the group.", advertised_includes_doc_fee: true, review_mode: "EXCEPTION_REVIEW" };
  it("keeps the dealership row when the store has none", () => {
    expect(applyStoreOverrides(tenant, null)).toEqual(tenant);
  });
  it("store keys win; unlisted keys never override", () => {
    const out = applyStoreOverrides(tenant, { store_id: "north", version: 3, overrides: { brand_voice: "warm", advertised_includes_doc_fee: false } });
    expect(out.brand_voice).toBe("warm");
    expect(out.advertised_includes_doc_fee).toBe(true);
    expect(out.cta_template).toBe("Call the group.");
    expect(out._store_id).toBe("north");
    expect(out._store_version).toBe(3);
  });
  it("one store's overrides never leak into another", () => {
    const north = applyStoreOverrides(tenant, { store_id: "north", version: 1, overrides: { cta_template: "Call North." } });
    const south = applyStoreOverrides(tenant, { store_id: "south", version: 1, overrides: {} });
    expect(north.cta_template).toBe("Call North.");
    expect(south.cta_template).toBe("Call the group.");
    expect(tenant.cta_template).toBe("Call the group.");
  });
});

describe("renderVehicleSettings", () => {
  it("fills the conveyance fee from the vehicle", () => {
    const s = renderVehicleSettings({ required_legal_text: "Dealer Conveyance Fee: {conveyance_fee}." }, { doc_fee: 499 });
    expect(s.required_legal_text).toBe("Dealer Conveyance Fee: $499.");
  });
  it("leaves the placeholder visible when the fee is unknown, so the gate blocks", () => {
    const s = renderVehicleSettings({ required_legal_text: "Dealer Conveyance Fee: {conveyance_fee}." }, { doc_fee: null });
    expect(s.required_legal_text).toContain("{conveyance_fee}");
  });
});

describe("loadStoreSettings", () => {
  const client = (result: { data: unknown; error: unknown }) => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }) }),
  });
  it("no store id reads nothing", async () => {
    expect(await loadStoreSettings(client({ data: null, error: null }), "t", null)).toBeNull();
  });
  it("missing table (migration not applied) falls back to the dealership row", async () => {
    expect(await loadStoreSettings(client({ data: null, error: { code: "42P01" } }), "t", "s")).toBeNull();
  });
  it("any other read error fails closed", async () => {
    await expect(loadStoreSettings(client({ data: null, error: { code: "57014", message: "timeout" } }), "t", "s")).rejects.toThrow();
  });
  it("returns the row", async () => {
    expect(await loadStoreSettings(client({ data: { store_id: "s", version: 2, overrides: { brand_voice: "x" } }, error: null }), "t", "s"))
      .toEqual({ store_id: "s", version: 2, overrides: { brand_voice: "x" } });
  });
});

describe("SQL proposals agree with the TypeScript gate", () => {
  it("allowed per-store keys are identical", () => {
    const m = settingsSql.match(/v_allowed text\[\] := ARRAY\[([^\]]+)\]/);
    const sqlKeys = (m?.[1] ?? "").match(/'([a-z_]+)'/g)?.map((k) => k.slice(1, -1)) ?? [];
    expect(sqlKeys.sort()).toEqual([...STORE_OVERRIDABLE_KEYS].sort());
  });
  it("gate version is identical", () => {
    expect(gateSql).toContain(`SELECT '${VAUTO_GATE_VERSION}'::text`);
  });
  it("the money format the SQL renders matches formatMoney", () => {
    expect(formatMoney(499)).toBe("$499");
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(28995)).toBe("$28,995");
  });
  it("the vAuto target is enforced in SQL", () => {
    expect(gateSql).toContain("char_length(v_cv.content) <> 3921");
  });
  it("RLS policies use the wrapped auth.uid() and TO authenticated", () => {
    for (const sql of [settingsSql, gateSql]) {
      const policies = sql.split("CREATE POLICY").slice(1);
      expect(policies.length).toBeGreaterThan(0);
      for (const p of policies) {
        expect(p).toMatch(/TO authenticated/);
        expect(p).toContain("(SELECT auth.uid())");
      }
    }
  });
  it("the export function approves and exports only as the caller", () => {
    expect(exportFn).toMatch(/asCaller\.rpc\("approve_vauto_export"/);
    expect(exportFn).toMatch(/asCaller\.rpc\("export_vauto_description"/);
    expect(exportFn).not.toMatch(/description_export_approvals"\)\.insert/);
    expect(exportFn).not.toMatch(/admin\.rpc\("approve_vauto_export"/);
  });
});
