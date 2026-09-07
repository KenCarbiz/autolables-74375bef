import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// AppShell is deeply wired to app contexts; mock each direct dependency down to
// a minimal stub so the test exercises only the sidebar's rendered behavior.
vi.mock("@/lib/navigation", () => ({ useViewTransitionNavigate: () => () => {} }));
vi.mock("@/lib/permissions/dealerRoleCapabilities", () => ({ hasDealerCapability: () => true }));
vi.mock("@/lib/permissions/adminTabAccess", () => ({ canSeeAdminTab: () => true, firstPermittedAdminTab: () => "settings" }));
vi.mock("qrcode.react", () => ({ QRCodeSVG: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {} }) }));
vi.mock("@/components/brand/Logo", () => ({ default: () => null }));
vi.mock("@/components/layout/CommandPalette", () => ({ default: () => null, useCommandPalette: () => ({ open: false, setOpen: () => {} }) }));
vi.mock("@/contexts/VinScanContext", async () => {
  const React = await import("react");
  return { VinScanContext: React.createContext(null), prefersLiveScanner: () => false };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { email: "ken@ken.cc" }, isAdmin: true, signOut: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", name: "Test Motors" }, currentStore: null, stores: [], setCurrentStore: () => {} }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { feature_lead_capture: true, dealer_name: "Test Motors" } }) }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ entries: [] }) }));
const shellRole = vi.hoisted(() => ({ value: "admin" }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: shellRole.value } }) }));
vi.mock("@/hooks/usePlatformEntitlements", () => ({ usePlatformEntitlements: () => ({ productIds: [], load: () => {} }) }));
vi.mock("@/hooks/useNavBadges", () => ({
  useNavBadges: () => ({ workQueue: 0, leads: 0, reconApprovals: 150, priceChangeReview: 0, complianceTasks: 0, returns: 0 }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: null }),
  });
  return { supabase: { from: () => chain, functions: { invoke: () => Promise.resolve({ data: null, error: null }) } } };
});

import AppShell from "./AppShell";

const renderShell = (route: string, collapsed = false) => {
  if (collapsed) localStorage.setItem("sidebar_collapsed", "1");
  else localStorage.removeItem("sidebar_collapsed");
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppShell>
        <div>content</div>
      </AppShell>
    </MemoryRouter>,
  );
};

const primaryNav = () => screen.getByRole("navigation", { name: "Primary" });

describe("AppShell sidebar rendering", () => {
  beforeEach(() => {
    localStorage.clear();
    shellRole.value = "admin";
  });

  it("marks exactly one leaf as aria-current for the active route", () => {
    const { container } = renderShell("/inventory");
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0].textContent).toContain("Inventory");
  });

  it("lights the parent Inventory row on a nested vehicle-file route", () => {
    const { container } = renderShell("/vehicle-file/abc-123");
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0].textContent).toContain("Inventory");
  });

  it("renders nav destinations as semantic, focusable links", () => {
    renderShell("/dashboard");
    const link = within(primaryNav()).getByRole("link", { name: "Inventory" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/inventory");
    link.focus();
    expect(document.activeElement).toBe(link);
    // The ring is asserted through its token, not a literal hex: the colour
    // is the shell palette's to change, a visible focus ring is not.
    expect(link.className).toContain("focus-visible:outline-shell-accent");
  });

  it("shows a 99+ recon badge with an accessible count label", () => {
    renderShell("/dashboard");
    const nav = primaryNav();
    expect(within(nav).getByText("99+")).toBeInTheDocument();
    expect(within(nav).getByLabelText("150 recon approvals pending")).toBeInTheDocument();
  });

  it("uses a collapsible section heading button (aria-expanded toggles)", () => {
    renderShell("/dashboard");
    const nav = primaryNav();
    const heading = within(nav).getByRole("button", { name: "COMPLIANCE" });
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("link", { name: "Compliance" })).toBeInTheDocument();
    fireEvent.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).queryByRole("link", { name: "Compliance" })).toBeNull();
  });

  it("keeps the global Add Vehicle, Create and Search controls out of the nav", () => {
    renderShell("/dashboard");
    expect(screen.getByRole("button", { name: "Add Vehicle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(within(primaryNav()).queryByRole("link", { name: "Add Vehicle" })).toBeNull();
    expect(within(primaryNav()).queryByRole("link", { name: "Create" })).toBeNull();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("gives a third-party vendor their assignments and no dealer surface", () => {
    // Capabilities are mocked wide open here on purpose: vendor containment
    // must not depend on a capability being set correctly.
    shellRole.value = "third_party_vendor";
    renderShell("/dashboard");
    const nav = primaryNav();
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/home/vendor"]);
    expect(screen.queryByRole("button", { name: "Add Vehicle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
  });

  it("gives a technician a bench and a board, and no administration", () => {
    shellRole.value = "detail";
    renderShell("/dashboard");
    const links = within(primaryNav()).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/home/technician", "/ready-board"]);
    expect(screen.queryByRole("button", { name: "Add Vehicle" })).toBeNull();
  });

  it("keeps an accessible name via aria-label when collapsed", () => {
    renderShell("/inventory", true);
    const nav = primaryNav();
    // Label text is hidden in the collapsed rail, but the link stays reachable.
    expect(within(nav).queryByText("Inventory")).toBeNull();
    expect(within(nav).getByRole("link", { name: "Inventory" })).toBeInTheDocument();
  });
});
