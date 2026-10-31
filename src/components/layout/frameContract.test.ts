import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  FRAME_LINKS,
  bottomNavCandidates,
  buildAdminNavSections,
  filterNavSections,
  type NavMode,
} from "./adminNav";
import { LEGACY_TAB_REDIRECTS, resolveAdminTab } from "@/lib/admin/sections";
import { ADMIN_CHILD_ROUTE_ELEMENTS } from "@/pages/admin/childRoutes";

// Every door the frame draws must open a page that exists, inside the layout
// that page lives in. The route table is read from App.tsx itself, so a route
// removed or moved there fails here.

const APP = readFileSync(join(__dirname, "../../App.tsx"), "utf8");
const gatedStart = APP.indexOf("<Route element={<GatedLayout />}>");
const adminStart = APP.indexOf("<Route element={<AdminLayout />}>");
const devStart = APP.indexOf("{import.meta.env.DEV && (");
const pathsIn = (text: string) => Array.from(text.matchAll(/<Route[^>]*\spath="([^"]+)"/g)).map((m) => m[1]);
const ROUTES = {
  public: pathsIn(APP.slice(0, gatedStart)),
  gated: [...pathsIn(APP.slice(gatedStart, adminStart)), ...ADMIN_CHILD_ROUTE_ELEMENTS.map((r) => r.path)],
  platform: pathsIn(APP.slice(adminStart, devStart)),
};
type Layout = keyof typeof ROUTES;

const toRegex = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]+/g, "[^/]+").replace(/\*$/, ".*")}$`);

const layoutOf = (href: string): Layout | null => {
  const pathname = href.split("?")[0];
  for (const layout of ["gated", "platform", "public"] as Layout[]) {
    if (ROUTES[layout].some((p) => toRegex(p).test(pathname))) return layout;
  }
  return null;
};

// /admin?tab=<id> must name a tab Admin V2 knows, or a legacy id it redirects.
const adminTabResolves = (href: string) => {
  const [pathname, query = ""] = href.split("?");
  if (pathname !== "/admin" || !query) return true;
  const tab = new URLSearchParams(query).get("tab");
  return !!tab && (!!resolveAdminTab(tab) || !!LEGACY_TAB_REDIRECTS[tab]);
};

const ZERO = { workQueue: 0, leads: 0, reconApprovals: 0, priceChangeReview: 0, complianceTasks: 0, returns: 0 };
const ALLOW_ALL = { isAdmin: true, isManager: true, can: () => true, hasFeature: () => true };
const ROLE_FOR: Record<NavMode, string> = { dealer: "admin", technician: "detail", vendor: "third_party_vendor" };

describe("the route table is readable", () => {
  it("finds the three layouts in App.tsx", () => {
    expect(gatedStart).toBeGreaterThan(0);
    expect(adminStart).toBeGreaterThan(gatedStart);
    expect(devStart).toBeGreaterThan(adminStart);
    expect(ROUTES.gated).toContain("/dashboard");
    expect(ROUTES.platform).toEqual(["/platform-admin", "/platform-admin/tenants/:tenantId", "/platform-admin/members/:memberId", "/platform-console/*"]);
  });
});

describe("every frame destination resolves to a registered route", () => {
  for (const mode of ["dealer", "technician", "vendor"] as NavMode[]) {
    it(`rail leaves in ${mode} mode`, () => {
      const sections = filterNavSections(buildAdminNavSections({ badges: ZERO, anyAdminTab: true, role: ROLE_FOR[mode] }), ALLOW_ALL);
      const leaves = sections.flatMap((s) => s.items.map((i) => i.path));
      expect(leaves.length).toBeGreaterThan(0);
      for (const href of leaves) {
        const expected: Layout = href === "/platform-admin" ? "platform" : "gated";
        expect([href, layoutOf(href)]).toEqual([href, expected]);
        expect([href, adminTabResolves(href)]).toEqual([href, true]);
      }
    });

    it(`bottom bar in ${mode} mode`, () => {
      for (const { path } of bottomNavCandidates(mode)) {
        expect([path, layoutOf(path)]).toEqual([path, "gated"]);
      }
    });
  }

  it("header, account menu, rooftop switcher, bell and brand links", () => {
    const links = Object.entries(FRAME_LINKS).map(([key, value]) => [key, typeof value === "function" ? value("1HGCM82633A004352") : value] as const);
    for (const [key, href] of links) {
      const expected: Layout = key === "trust" ? "public" : "gated";
      expect([key, href, layoutOf(href)]).toEqual([key, href, expected]);
      expect([key, adminTabResolves(href)]).toEqual([key, true]);
    }
  });

  it("every command palette destination", () => {
    const source = readFileSync(join(__dirname, "CommandPalette.tsx"), "utf8");
    const targets = Array.from(source.matchAll(/go\("([^"]+)"\)/g)).map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(10);
    for (const href of targets) {
      expect([href, layoutOf(href)]).not.toEqual([href, null]);
      expect([href, adminTabResolves(href)]).toEqual([href, true]);
    }
  });
});

describe("no development fixture name in production frame code", () => {
  // The mock's dealership, city and user are fixture data. They may appear in
  // the design fixture and in tests, never as a label or fallback the product
  // can show a real dealer.
  const FIXTURE_NAMES = /Harte|Honda|Hartford|Ken Admin|Manchester/;
  const files = readdirSync(__dirname).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("scans the whole frame", () => {
    expect(files).toEqual(expect.arrayContaining(["AppShell.tsx", "AppRail.tsx", "AppHeader.tsx", "adminNav.tsx", "CommandPalette.tsx", "searchScope.ts", "useNavDrawer.ts"]));
  });

  // Comments are not labels (OnboardingGate's doc comment names the HarteCash
  // embedding host); everything a user could see is code or a string.
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it.each(files)("%s", (file) => {
    expect(code(readFileSync(join(__dirname, file), "utf8"))).not.toMatch(FIXTURE_NAMES);
  });

  it("would catch a fixture name used as a label", () => {
    expect(code('const fallback = "Harte Honda"; // a comment')).toMatch(FIXTURE_NAMES);
    expect(code("/* Harte Auto Group */ const x = 1;")).not.toMatch(FIXTURE_NAMES);
  });
});
