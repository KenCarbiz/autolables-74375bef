import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";
import { FIXTURE_03 } from "@/pages/admin/fixtures/people";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock, from: fromMock } }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-example" }, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-example" }, isAdmin: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, loading: false }) }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ log: logMock, entries: [] }) }));

import TeamView from "./TeamView";

const renderTeam = (entry: string, withFixture = true) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <TeamView />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(withFixture ? <AdminFixtureProvider fixture={FIXTURE_03}>{tree}</AdminFixtureProvider> : tree);
};

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  logMock.mockReset();
});

describe("TeamView", () => {
  it("renders screen 03 from the fixture with the role summary open and writes nothing", () => {
    renderTeam("/admin?tab=team");
    expect(screen.getAllByText("example.salesperson@example.test")).toHaveLength(2);
    expect(screen.getByText("example.office@example.test")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Role summary" })).toBeTruthy();
    expect(screen.getByText("View assigned customers")).toBeTruthy();
    expect(screen.getByText("Change dealer pricing")).toBeTruthy();
    expect(screen.getByText("Role preview does not grant permissions.")).toBeTruthy();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Invitation pending")).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it("restores department and selection filters from the URL", () => {
    renderTeam("/admin?tab=team&dept=Service&sel=example-member-service");
    expect(screen.getAllByText("example.service.advisor@example.test").length).toBe(2);
    expect(screen.queryByText("example.salesperson@example.test")).toBeNull();
    expect(screen.getByText("Showing 1 of 7.")).toBeTruthy();
    expect((screen.getByLabelText("Department") as HTMLSelectElement).value).toBe("Service");
    const rail = screen.getByRole("complementary", { name: "Role summary" });
    expect(rail.textContent).toContain("example.service.advisor@example.test");
  });

  it("shows a failed read as unavailable, never as an empty team, and issues no write", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "permission denied for function" } });
    renderTeam("/admin?tab=team", false);
    await screen.findByText("The team could not be read for this rooftop.");
    expect(screen.queryByText("No teammates yet")).toBeNull();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("list_tenant_members", { p_tenant_id: "tenant-example" });
  });

  it("renders live members and shows the empty filter state without clearing the team", async () => {
    rpcMock.mockResolvedValue({
      data: [{ id: "m1", user_id: "u1", email: "example.gm@example.test", role: "general_manager", accepted_at: "2026-09-01T00:00:00Z", invited_email: null }],
      error: null,
    });
    renderTeam("/admin?tab=team", false);
    await screen.findByText("example.gm@example.test");
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "Service" } });
    await waitFor(() => expect(screen.getByText("No team members match these filters")).toBeTruthy());
    expect(screen.getByText("1 member is on this rooftop.")).toBeTruthy();
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
