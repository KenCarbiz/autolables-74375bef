import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: true, loading: false }) }));
const { stub } = vi.hoisted(() => ({ stub: (name: string) => ({ default: () => name + " panel" }) }));
vi.mock("@/components/admin/PlatformTenants", () => stub("Tenants"));
vi.mock("@/components/admin/PlatformMembers", () => stub("Members"));
vi.mock("@/components/admin/PlatformEntitlements", () => stub("Entitlements"));
vi.mock("@/components/admin/PlatformAudit", () => stub("Audit"));
vi.mock("@/components/admin/RecallRefreshTool", () => stub("Recall"));
vi.mock("@/components/admin/BillingHandshakeDiagnostic", () => stub("Billing"));
vi.mock("@/components/admin/StripeConfigPanel", () => stub("Stripe"));
vi.mock("@/components/admin/StickerTemplatesAdminPanel", () => stub("Templates"));
vi.mock("@/components/admin/PassportEngagementDashboard", () => stub("Engagement"));
vi.mock("@/components/admin/MarketcheckApiUsagePanel", () => stub("Usage"));
vi.mock("@/components/admin/ProviderBudgetsPanel", () => stub("Budgets"));

import PlatformAdmin from "./PlatformAdmin";

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <PlatformAdmin />
    </MemoryRouter>,
  );

describe("Platform Console local navigation", () => {
  it("lists every platform section as a link, without needing the palette", () => {
    renderAt("/platform-admin");
    const links = Array.from(document.querySelectorAll("nav[aria-label='Platform sections'] a, nav[aria-label='Platform tools'] a"));
    expect(links).toHaveLength(11);
    expect(links.map((a) => a.getAttribute("href"))).toContain("/platform-admin?tab=budgets");
  });

  it("marks the section named in the URL as current and renders it", () => {
    renderAt("/platform-admin?tab=members");
    expect(screen.getByRole("link", { name: "Members" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Members panel")).toBeTruthy();
  });

  it("falls back to Tenants for a bare or unknown section", () => {
    renderAt("/platform-admin?tab=nope");
    expect(screen.getByRole("link", { name: "Tenants" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Tenants panel")).toBeTruthy();
  });
});
