import { describe, it, expect } from "vitest";
import {
  ADMIN_SECTIONS,
  LEGACY_TAB_REDIRECTS,
  adminTabHref,
  canSeeTab,
  capabilitiesForTab,
  defaultAdminTab,
  legacyAliasTable,
  resolveAdminLocation,
  resolveAdminTab,
  visibleSections,
} from "./sections";
import { ADMIN_TABS, TAB_CAPS, canSeeAdminTab } from "@/lib/permissions/adminTabAccess";

const owner = { role: "owner", isAdmin: false } as const;
const sales = { role: "salesperson", isAdmin: false } as const;
const platform = { role: null, isAdmin: true } as const;

describe("Administration V2 section registry", () => {
  it("declares the eight sections in the required order", () => {
    expect(ADMIN_SECTIONS.map((s) => s.id)).toEqual([
      "overview", "brand", "people", "pricing", "customer-experience", "publishing", "documents", "integrations",
    ]);
  });

  it("gives every section at least one tab and every tab a unique id", () => {
    const ids = ADMIN_SECTIONS.flatMap((s) => s.tabs.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ADMIN_SECTIONS) expect(s.tabs.length).toBeGreaterThan(0);
  });

  it("resolves every legacy tab id to a child tab or a standalone screen, never to nothing", () => {
    for (const row of legacyAliasTable()) {
      const stranded = row.tab === null && row.redirect === null;
      expect(stranded, `legacy tab ${row.legacy} is stranded`).toBe(false);
    }
  });

  it("uses each legacy alias at most once", () => {
    const aliases = ADMIN_SECTIONS.flatMap((s) => s.tabs.flatMap((t) => t.aliases ?? []));
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("never widens visibility beyond the legacy tab a child absorbs", () => {
    for (const s of ADMIN_SECTIONS) {
      for (const t of s.tabs) {
        for (const legacy of t.aliases ?? []) {
          for (const role of ["owner", "salesperson", "readonly", "service_advisor", "office", "inventory_manager", "third_party_vendor"]) {
            const legacyCan = canSeeAdminTab(role, legacy, false);
            const v2Can = canSeeTab(t, { role, isAdmin: false });
            if (!legacyCan) expect(v2Can, `${role} gained ${t.id} through alias ${legacy}`).toBe(false);
          }
        }
      }
    }
  });

  it("gives every tab a non-empty capability set", () => {
    for (const s of ADMIN_SECTIONS) for (const t of s.tabs) expect(capabilitiesForTab(t).length, t.id).toBeGreaterThan(0);
  });

  it("translates a legacy alias and reports it", () => {
    expect(resolveAdminTab("branding")).toMatchObject({ section: { id: "brand" }, tab: { id: "identity" }, viaAlias: true });
    expect(resolveAdminTab("identity")).toMatchObject({ viaAlias: false });
    expect(resolveAdminTab("audit")?.tab.id).toBe("activity");
    expect(resolveAdminTab("inventory")?.tab.id).toBe("inventory-feed");
    expect(resolveAdminTab("not-a-tab")).toBeNull();
  });

  it("redirects the tabs whose content lives on standalone screens", () => {
    expect(resolveAdminLocation("leads", owner)).toEqual({ kind: "redirect", to: "/leads" });
    expect(Object.keys(LEGACY_TAB_REDIRECTS).sort()).toEqual(["analytics", "funnel", "leads", "queue"]);
    for (const id of Object.keys(LEGACY_TAB_REDIRECTS)) expect(ADMIN_TABS).toContain(id);
  });

  it("falls back to the first permitted tab for an unknown or forbidden tab", () => {
    const unknown = resolveAdminLocation("nope", owner);
    expect(unknown).toMatchObject({ kind: "tab", fallback: true, resolved: { tab: { id: "overview" } } });
    // An office role holds reports and compliance capabilities, so it lands on
    // Overview, but it cannot manage the team, so the Roles tab falls back.
    const forbidden = resolveAdminLocation("roles", { role: "office", isAdmin: false });
    expect(forbidden).toMatchObject({ kind: "tab", fallback: true, resolved: { tab: { id: "overview" } } });
  });

  it("lands a salesperson nowhere in Administration, as before", () => {
    expect(visibleSections(sales)).toEqual([]);
    expect(defaultAdminTab(sales)).toBeNull();
    expect(resolveAdminLocation("overview", sales)).toEqual({ kind: "none" });
  });

  it("shows a platform admin everything and hides feature-gated tabs when the feature is off", () => {
    expect(visibleSections(platform).length).toBe(ADMIN_SECTIONS.length);
    const applicability = ADMIN_SECTIONS.find((s) => s.id === "pricing")!.tabs.find((t) => t.id === "applicability")!;
    expect(canSeeTab(applicability, { ...owner, features: { feature_product_rules: false } })).toBe(false);
    expect(canSeeTab(applicability, { ...owner, features: { feature_product_rules: true } })).toBe(true);
    expect(canSeeTab(applicability, owner)).toBe(true);
  });

  it("keeps the legacy home capability for Overview", () => {
    const overview = ADMIN_SECTIONS[0].tabs[0];
    expect(capabilitiesForTab(overview)).toEqual(TAB_CAPS.home);
  });

  it("builds deep links with an optional panel anchor", () => {
    expect(adminTabHref("price-rules")).toBe("/admin?tab=price-rules");
    expect(adminTabHref("price-rules", "doc-fee")).toBe("/admin?tab=price-rules&panel=doc-fee");
  });
});
