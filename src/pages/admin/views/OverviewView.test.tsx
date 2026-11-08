import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { resetSupabaseSpy, spyCalls } from "@/test/mocks/supabaseSpy";
import { ADMIN_CATEGORIES, categoryHref } from "@/lib/admin/categories";
import { adminTabHref } from "@/lib/admin/sections";
import { WAVE_E_FIXTURES } from "@/pages/admin/fixtures/WaveEFixtures";
import OverviewView from "./OverviewView";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, loading: false }) }));
vi.mock("@/components/admin/v2/useAdminVisibility", () => ({ useAdminVisibility: () => ({ ctx: { role: "owner", isAdmin: false }, ready: true }) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: mod.DEFAULT_SETTINGS, updateSettings: async () => true, loading: false }) };
});

const fixture = WAVE_E_FIXTURES["v3-overview"].fixture;
const open = (query = "") => renderAdmin(<OverviewView />, { route: `${adminTabHref("overview")}${query}`, fixture });
const hrefOf = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href");

beforeEach(() => resetSupabaseSpy());

describe("Overview summary", () => {
  it("shows four cards with counts that name what they count", () => {
    open();
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getAllByRole("link")).toHaveLength(4);
    expect(within(summary).getByText("128")).toBeTruthy();
    expect(within(summary).getByText("5 of 6")).toBeTruthy();
    expect(within(summary).getByText("9 vehicles")).toBeTruthy();
    expect(within(summary).getByText(/14 open issues in total/)).toBeTruthy();
  });

  it("gives setup an accessible progress bar and does not style 5 of 6 as complete", () => {
    open();
    const bar = screen.getByRole("progressbar", { name: "Setup completion" });
    expect(bar).toHaveAttribute("aria-valuenow", "5");
    expect(bar).toHaveAttribute("aria-valuemax", "6");
    expect(bar).toHaveAttribute("aria-valuetext", "5 of 6 setup steps complete");
    expect(bar.innerHTML).not.toContain("bg-adm-success");
    expect(screen.getByText("Finish setup")).toBeTruthy();
  });

  it("renders a failed read as Unavailable, never zero", () => {
    open("&state=error");
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getAllByText("Unavailable")).toHaveLength(3);
    expect(within(summary).queryByText("0")).toBeNull();
    expect(within(summary).queryByText(/^0 vehicles/)).toBeNull();
    expect(screen.getByText(/Activity is unavailable right now/)).toBeTruthy();
  });

  it("shows a real zero as zero", () => {
    open("&state=empty");
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getAllByText("0").length).toBeGreaterThanOrEqual(2);
    expect(within(summary).getByText("0 vehicles")).toBeTruthy();
    expect(screen.getByText("0 of 6")).toBeTruthy();
  });
});

describe("Overview sync banner and attention queue", () => {
  it("summarizes the sync problem without a status code and links to the feed diagnostics", () => {
    const { container } = open();
    const banner = container.querySelector("[data-feed-banner]") as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("Last successful sync");
    expect(banner.textContent).not.toMatch(/429|HTTP/);
    expect(within(banner).getByRole("link", { name: "Review sync" })).toHaveAttribute("href", adminTabHref("inventory-feed"));
    expect(container.textContent).not.toMatch(/HTTP 429/);
  });

  it("lists issue, severity, count, owner and a next action that resolves to its page and filter", () => {
    open();
    const queue = screen.getByRole("table", { name: "Attention queue" });
    expect(within(queue).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Issue", "Severity", "Count", "Owner", "Next action"]);
    expect(within(queue).getByRole("link", { name: "Open diagnostics" })).toHaveAttribute("href", adminTabHref("inventory-feed"));
    const exceptions = within(queue).getAllByRole("link", { name: "Open exceptions" })[0];
    expect(exceptions).toHaveAttribute("href", "/admin/exceptions?status=active");
    expect(within(queue).getByText("9 vehicles")).toBeTruthy();
    expect(within(queue).getByRole("link", { name: "Open queue" })).toHaveAttribute("href", "/description-operations?status=blocked");
    expect(within(queue).getAllByText("Review required").length).toBeGreaterThan(0);
  });

  it("shows no banner when the feed is healthy", () => {
    const { container } = open("&state=empty");
    expect(container.querySelector("[data-feed-banner]")).toBeNull();
    const queue = screen.getByRole("table", { name: "Attention queue" });
    expect(within(queue).queryByRole("link", { name: "Open diagnostics" })).toBeNull();
    expect(within(queue).queryByRole("link", { name: "Open exceptions" })).toBeNull();
    expect(within(queue).getByRole("link", { name: "Configure" })).toHaveAttribute("href", "/admin/customer-experience/escalation");
  });
});

describe("Overview policy, shortcuts and activity", () => {
  it("keeps four policy concepts apart, each with View details", () => {
    open();
    for (const title of ["Listing visibility", "Document publication", "Retail readiness", "Customer routing"]) {
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.getByRole("link", { name: `View details: ${title}` }).getAttribute("href")).toMatch(/panel=policy&concept=/);
    }
  });

  it("links all eight settings categories", () => {
    const { container } = open();
    expect(ADMIN_CATEGORIES).toHaveLength(8);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    for (const c of ADMIN_CATEGORIES) expect(hrefs).toContain(categoryHref(c.id));
  });

  it("lists only the categories a limited role can open", () => {
    open("&state=readonly");
    expect(screen.queryByRole("link", { name: /^People & Access/ })).toBeNull();
    expect(screen.getByRole("link", { name: /^Documents & Printing/ })).toBeTruthy();
  });

  it("shows administration events and links to the full list", () => {
    open();
    expect(screen.getAllByText(/Price rule updated/).length).toBeGreaterThan(0);
    expect(hrefOf("View all")).toBe(adminTabHref("overview", "activity"));
  });
});

describe("Overview child screens", () => {
  it("shows the filtered exception queue", () => {
    open("&panel=exceptions&severity=critical");
    expect(screen.getByRole("heading", { name: "Open exceptions" })).toBeTruthy();
    expect(screen.getByText(/14 open issues across 9 vehicles/)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Open exceptions" });
    expect(within(table).getAllByRole("row").length).toBe(1 + 2);
    expect(screen.getByRole("link", { name: "Work the queue" })).toHaveAttribute("href", "/admin/exceptions?status=active&severity=critical");
  });

  it("lists every setup step with the editor that owns it", () => {
    open("&panel=setup");
    expect(screen.getByText("5 of 6 steps complete. Each step opens the one editor that owns the setting.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up: Lead routing people" })).toHaveAttribute("href", adminTabHref("routing"));
    expect(screen.getAllByText("Done")).toHaveLength(5);
  });

  it("explains each policy concept", () => {
    open("&panel=policy&concept=routing");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(expect.arrayContaining(["Listing visibility", "Customer routing"]));
    expect(screen.getByRole("link", { name: "Open Routing" })).toHaveAttribute("href", adminTabHref("routing"));
  });

  it("paginates the full activity list", () => {
    open("&panel=activity");
    expect(screen.getByText("Showing 1 to 25 of 42")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to overview" })).toHaveAttribute("href", adminTabHref("overview"));
  });

  it("makes no database call and no write while rendering a fixture", () => {
    open();
    open("&panel=activity");
    expect(spyCalls).toEqual([]);
  });
});
