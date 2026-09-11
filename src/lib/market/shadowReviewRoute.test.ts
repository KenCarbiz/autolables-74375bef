// ── Where the pilot is observed, and what it cannot do from there ──────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const APP = "src/App.tsx";
const HOST = "src/pages/InventorySyncCenter.tsx";
const HOOK = "src/hooks/useShadowEvidence.ts";
const COMPONENT = "src/components/admin/ShadowEvidenceTable.tsx";

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const app = read(APP);
const host = code(HOST);
const hook = code(HOOK);

describe("the review surface lives on an existing authenticated admin route", () => {
  it("is mounted inside InventorySyncCenter", () => {
    expect(host).toContain("<ShadowEvidenceTable rows={shadowEvidence.data ?? []} />");
    expect(read(HOST)).toContain('import ShadowEvidenceTable from "@/components/admin/ShadowEvidenceTable"');
  });

  it("reaches it through /admin/inventory-sync and no new route", () => {
    expect(app).toContain('<Route path="/admin/inventory-sync" element={<InventorySyncCenter />} />');
    // No route was added for the table itself.
    expect(app).not.toContain("ShadowEvidenceTable");
    expect(app).not.toContain("shadow-evidence");
  });

  it("sits behind the entitlement gate and the app shell", () => {
    // Every /admin/* route in this app is wrapped by the same Gated element.
    expect(app).toContain('<EntitlementGate app="autolabels">');
    expect(app).toContain("<AppShell>");
    const gateAt = app.indexOf('<EntitlementGate app="autolabels">');
    const routeAt = app.indexOf('path="/admin/inventory-sync"');
    expect(gateAt).toBeGreaterThan(-1);
    expect(routeAt).toBeGreaterThan(gateAt);
  });

  it("is not a public route", () => {
    for (const publicPath of ['path="/v/', 'path="/vehicle/', 'path="/scan"', 'path="/sign/']) {
      const idx = app.indexOf(publicPath);
      if (idx === -1) continue;
      const line = app.slice(idx, app.indexOf("\n", idx));
      expect(line).not.toContain("InventorySyncCenter");
      expect(line).not.toContain("ShadowEvidence");
    }
  });

  it("preserves the host page's existing layout and actions", () => {
    // The table is appended; nothing above it was restructured.
    expect(host).toContain("StatCard");
    expect(host).toContain("Last successful sync");
    expect(host).toContain("Raw diagnostics");
    expect(host).toMatch(/<div className="mt-8">\s*<ShadowEvidenceTable/);
  });
});

describe("the query is tenant-scoped and read-only", () => {
  it("filters every table on the viewer's tenant", () => {
    for (const table of ["vehicle_market_valuations", "vehicle_market_comparables", "vehicle_listings"]) {
      const at = hook.indexOf(`from("${table}")`);
      expect(at, table).toBeGreaterThan(-1);
      const block = hook.slice(at, at + 900);
      expect(block, table).toContain('.eq("tenant_id", tenantId)');
    }
  });

  it("passes the viewer tenant to the adapter, which refuses a mismatch", () => {
    expect(hook).toContain("viewerTenantId: tenantId");
  });

  it("returns nothing at all without a tenant", () => {
    expect(hook).toContain("enabled: !!tenantId");
    expect(hook).toContain("if (!tenantId) return [];");
  });

  it("performs no write of any kind", () => {
    for (const write of [".update(", ".insert(", ".upsert(", ".delete(", ".rpc("]) {
      expect(hook, write).not.toContain(write);
    }
  });

  it("cannot invoke a function, spend, or refresh a fleet", () => {
    for (const forbidden of [
      "functions.invoke", "fetch(", "market-valuation-write", "vehicle-enrich",
      "marketcheck", "market_provider_budgets", "market_reserve_provider_call",
      "useMutation",
    ]) {
      expect(hook, forbidden).not.toContain(forbidden);
    }
  });

  it("selects no raw provider payload or credential column", () => {
    for (const column of [
      "provider_request_params", "provider_response_hash", "subject_inputs", "api_key",
    ]) {
      expect(hook, column).not.toContain(column);
    }
  });
});

describe("the rendered surface offers no control", () => {
  const component = code(COMPONENT);

  it("has no button, form or input", () => {
    for (const control of ["<button", "<form", "<input", "<select", "onSubmit", "onChange", "onClick"]) {
      expect(component, control).not.toContain(control);
    }
  });

  it("labels itself as internal and not customer-facing", () => {
    expect(read(COMPONENT)).toContain("SHADOW_REVIEW_AUDIENCE_NOTICE");
    expect(read("src/lib/market/shadowReview.ts"))
      .toContain('"Internal only — shadow evaluation. Not shown to customers."');
  });

  it("may show Limited Market Evidence, because this is the place for it", () => {
    expect(component).toContain("r.verdict");
    expect(component).toContain("Abstention reasons");
  });
});
