import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { renderAdmin } from "@/test/adminRender";
import { resetSupabaseSpy, spyCalls } from "@/test/mocks/supabaseSpy";
import { ADMIN_CHILD_ROUTES, ADMIN_SECTIONS, adminTabHref } from "@/lib/admin/sections";
import { fixture01 } from "@/pages/admin/fixtures/01";
import OverviewView, { type OverviewFixture } from "./OverviewView";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: mod.DEFAULT_SETTINGS, updateSettings: async () => true, loading: false }) };
});

const LocationEcho = () => {
  const loc = useLocation();
  return <p data-testid="location">{loc.pathname + loc.search}</p>;
};

const renderOverview = () =>
  renderAdmin(
    <>
      <OverviewView />
      <LocationEcho />
    </>,
    { route: adminTabHref("overview"), fixture: fixture01.fixture },
  );

const overview = fixture01.fixture.views.overview as OverviewFixture;
const hrefOf = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href");

beforeEach(() => resetSupabaseSpy());

describe("OverviewView drill-ins (screen 01)", () => {
  it("points each settings shortcut at the first tab of its section", () => {
    renderOverview();
    const expected: Record<string, string> = {
      "Dealership & Brand": adminTabHref("identity"),
      "People & Access": adminTabHref("team"),
      "Pricing & Products": adminTabHref("price-rules"),
      "Customer Experience": adminTabHref("routing"),
      Publishing: adminTabHref("effective-policy"),
      "Documents & Service": adminTabHref("templates"),
    };
    for (const [title, href] of Object.entries(expected)) {
      const section = ADMIN_SECTIONS.find((s) => s.label === title)!;
      expect(href).toBe(adminTabHref(section.tabs[0].id));
      expect(hrefOf(new RegExp(`^${title}`))).toBe(href);
    }
  });

  it("points the banner, tiles and card actions at their routes", () => {
    renderOverview();
    expect(hrefOf("View feed health")).toBe(adminTabHref("inventory-feed"));
    expect(hrefOf(/^Setup complete/)).toBe(adminTabHref("identity"));
    expect(hrefOf(/^Active inventory/)).toBe("/inventory");
    expect(hrefOf(/^Policy reviews/)).toBe("/dashboard/document-review");
    expect(hrefOf(/^Open exceptions/)).toBe("/admin/exceptions");
    expect(hrefOf("View all")).toBe(adminTabHref("activity"));
  });

  it("links every attention action to the route its item names", () => {
    renderOverview();
    const queue = screen.getByRole("table", { name: "Ranked attention queue" });
    for (const item of overview.attention) {
      expect(within(queue).getByRole("link", { name: item.action.label })).toHaveAttribute("href", item.action.href);
    }
    expect(hrefOf("Configure")).toBe(ADMIN_CHILD_ROUTES.escalation);
  });

  it("navigates to the section when a shortcut is clicked, and writes nothing", () => {
    renderOverview();
    expect(screen.getByTestId("location")).toHaveTextContent(adminTabHref("overview"));
    fireEvent.click(screen.getByRole("link", { name: /^People & Access/ }));
    expect(screen.getByTestId("location")).toHaveTextContent(adminTabHref("team"));
    fireEvent.click(screen.getByRole("link", { name: "View feed health" }));
    expect(screen.getByTestId("location")).toHaveTextContent(adminTabHref("inventory-feed"));
    expect(spyCalls).toEqual([]);
  });
});
