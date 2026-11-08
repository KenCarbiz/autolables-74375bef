import { describe, it, expect } from "vitest";
import {
  ADMIN_CATEGORIES,
  CATALOG_DISPOSITIONS,
  TABS_OUTSIDE_CATEGORIES,
  canSeeRow,
  crumbsFor,
  locatePath,
  locateTab,
  rowHref,
  searchSettings,
  visibleCategories,
} from "./categories";
import { ADMIN_SECTIONS, resolveAdminLocation, resolveAdminTab } from "./sections";

const owner = { role: "owner", isAdmin: false } as const;
const sales = { role: "salesperson", isAdmin: false } as const;
const platform = { role: null, isAdmin: true } as const;

const rows = ADMIN_CATEGORIES.flatMap((c) => c.groups.flatMap((g) => g.rows));

describe("Administration V3 categories", () => {
  it("declares the eight categories in the handoff order", () => {
    expect(ADMIN_CATEGORIES.map((c) => c.label)).toEqual([
      "Dealership & Brand",
      "People & Access",
      "Pricing & Products",
      "Customer Experience",
      "Documents & Printing",
      "Workflow & Approvals",
      "Inventory & Integrations",
      "Billing & Plan",
    ]);
  });

  it("gives every row a unique key and a resolvable tab or gate", () => {
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of rows) {
      expect(r.tab || r.href, `${r.key} has no destination`).toBeTruthy();
      const gate = r.tab ?? r.gateTab;
      if (gate) expect(resolveAdminTab(gate), `${r.key} gate ${gate}`).not.toBeNull();
    }
  });

  it("re-homes every existing V2 tab exactly once (or documents why not)", () => {
    const owned = rows.filter((r) => r.tab).map((r) => r.tab as string);
    expect(new Set(owned).size).toBe(owned.length);
    for (const s of ADMIN_SECTIONS) {
      for (const t of s.tabs) {
        const homed = owned.includes(t.id) || t.id in TABS_OUTSIDE_CATEGORIES;
        expect(homed, `tab ${t.id} has no category row`).toBe(true);
      }
    }
  });

  it("never widens access: a salesperson sees no more rows than the tabs they could open", () => {
    for (const r of rows) {
      const gate = r.tab ?? r.gateTab;
      if (!gate) continue;
      const loc = resolveAdminLocation(gate, sales);
      if (canSeeRow(r, sales)) expect(loc.kind === "tab" && !loc.fallback, `${r.key} visible to sales`).toBe(true);
    }
  });

  it("hides platform-only rows from dealer owners", () => {
    for (const r of rows.filter((x) => x.platformOnly)) {
      expect(canSeeRow(r, owner)).toBe(false);
      expect(canSeeRow(r, platform)).toBe(true);
    }
  });

  it("shows owners all eight categories", () => {
    expect(visibleCategories(owner)).toHaveLength(8);
  });
});

describe("settings search", () => {
  it("finds a setting by an older name and links to the exact editor", () => {
    const hit = searchSettings("applicability", owner)[0];
    expect(hit.row.key).toBe("applicability");
    expect(hit.href).toBe("/admin?tab=applicability");
  });

  it("finds the doc fee editor", () => {
    expect(searchSettings("doc fee", owner)[0].row.key).toBe("price-rules");
  });

  it("matches 'Store settings' and 'Passport modules' aliases", () => {
    expect(searchSettings("store settings", owner).map((h) => h.row.key)).toContain("store-settings");
    expect(searchSettings("passport modules", owner).map((h) => h.row.key)).toContain("passport-modules");
  });

  it("filters results by permission", () => {
    expect(searchSettings("advanced network", owner)).toHaveLength(0);
    expect(searchSettings("advanced network", platform).map((h) => h.row.key)).toContain("inventory-sync");
  });

  it("returns nothing for an empty query", () => {
    expect(searchSettings("   ", owner)).toEqual([]);
  });
});

describe("breadcrumbs and redirects", () => {
  it("derives the breadcrumb for a legacy alias from the category model", () => {
    const loc = locateTab("incentives"); // legacy alias of price-rules
    expect(crumbsFor(loc).map((c) => c.label)).toEqual(["Administration", "Pricing & Products", "Price display & doc fee"]);
  });

  it("locates child routes", () => {
    expect(locatePath("/admin/pricing/integrity")?.category.id).toBe("pricing");
  });

  it("sends the old Invoices tab to Get Ready installer invoices, not billing", () => {
    expect(resolveAdminLocation("invoices", owner)).toEqual({ kind: "redirect", to: "/invoices" });
  });

  it("builds row hrefs from tab ids", () => {
    const r = rows.find((x) => x.key === "routing");
    expect(r && rowHref(r)).toBe("/admin?tab=routing");
  });
});

describe("catalog coverage register", () => {
  it("covers all 123 handoff catalog ids exactly once", () => {
    const ids = CATALOG_DISPOSITIONS.map((e) => e.id);
    expect(ids).toHaveLength(123);
    expect(new Set(ids).size).toBe(123);
    const groups = ["A", "D", "P", "R", "X", "T", "W", "I", "B", "S"];
    const counts = Object.fromEntries(groups.map((g) => [g, ids.filter((i) => i.startsWith(g)).length]));
    expect(counts).toEqual({ A: 4, D: 7, P: 8, R: 13, X: 17, T: 10, W: 17, I: 32, B: 4, S: 11 });
  });

  it("points every row-backed disposition at a real row", () => {
    const keys = new Set(rows.map((r) => r.key).concat(Object.keys(TABS_OUTSIDE_CATEGORIES)));
    for (const e of CATALOG_DISPOSITIONS) {
      if (e.target.startsWith("/") || e.disposition === "shared-component" || e.target.includes(" ")) continue;
      expect(keys.has(e.target), `${e.id} -> ${e.target}`).toBe(true);
    }
  });
});
