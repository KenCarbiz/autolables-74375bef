import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

const LIVE_MEMBERS = [
  { id: "m1", user_id: "u1", email: "example.gm@example.test", role: "general_manager", accepted_at: "2026-09-01T00:00:00Z", invited_email: null },
  { id: "m2", user_id: "u2", email: "example.sales@example.test", role: "salesperson", accepted_at: "2026-09-02T00:00:00Z", invited_email: null },
];

const LocationEcho = () => {
  const loc = useLocation();
  return <p data-testid="location">{loc.pathname + loc.search}</p>;
};

/** The row's selection button, not its actions menu. */
const rowButton = (scope: HTMLElement, email: string): HTMLElement => {
  const hit = within(scope).getAllByRole("button").find((b) => b.hasAttribute("aria-pressed") && b.textContent?.includes(email));
  if (!hit) throw new Error(`No row button for ${email}`);
  return hit;
};

const renderRouted = (entry: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/admin" element={<TeamView />} />
          <Route path="/admin/people/:memberId" element={<LocationEcho />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
    expect(screen.getByText("title.clerk@example.test")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Role summary" })).toBeTruthy();
    expect(screen.getByText("View assigned customers")).toBeTruthy();
    expect(screen.getByText("Change dealer pricing")).toBeTruthy();
    expect(screen.getByText("Role preview does not grant permissions.")).toBeTruthy();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.queryByText("Invited")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it("restores department and selection filters from the URL", () => {
    renderTeam("/admin?tab=team&dept=Service&sel=example-member-service");
    expect(screen.getAllByText("service.advisor@example.test").length).toBe(2);
    expect(screen.queryByText("example.salesperson@example.test")).toBeNull();
    expect(screen.getByText("Showing 1 of 5.")).toBeTruthy();
    expect((screen.getByLabelText("Department") as HTMLSelectElement).value).toBe("Service");
    const rail = screen.getByRole("complementary", { name: "Role summary" });
    expect(rail.textContent).toContain("service.advisor@example.test");
  });

  it("sorts by a column ascending, then descending, then back to the server order", () => {
    renderTeam("/admin?tab=team");
    const table = screen.getByRole("table", { name: "Team members" });
    const rowsInOrder = () => within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("[data-parity='member-name']")?.textContent);
    const server = rowsInOrder();
    expect(server).toEqual(["example.salesperson@example.test", "service.advisor@example.test", "inventory.manager@example.test", "title.clerk@example.test", "general.manager@example.test"]);
    const header = within(table).getByRole("columnheader", { name: /Employee/ });
    expect(header.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(rowsInOrder()).toEqual(["example.salesperson@example.test", "general.manager@example.test", "inventory.manager@example.test", "service.advisor@example.test", "title.clerk@example.test"]);
    fireEvent.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(rowsInOrder()[0]).toBe("title.clerk@example.test");
    fireEvent.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("none");
    expect(rowsInOrder()).toEqual(server);
  });

  it("shows a failed read as unavailable, never as an empty team, and issues no write", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "permission denied for function" } });
    renderTeam("/admin?tab=team", false);
    await screen.findByText("The team could not be read for this rooftop.");
    expect(screen.queryByText("No teammates yet")).toBeNull();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("list_tenant_members", { p_tenant_id: "tenant-example" });
  });

  it("opens the role summary for the member whose row is selected, and moves it when another row is selected", async () => {
    rpcMock.mockResolvedValue({ data: LIVE_MEMBERS, error: null });
    renderTeam("/admin?tab=team", false);
    const table = await screen.findByRole("table", { name: "Team members" });
    expect(screen.queryByRole("complementary", { name: "Role summary" })).toBeNull();

    const salesButton = rowButton(table, "example.sales@example.test");
    fireEvent.click(salesButton);
    expect(salesButton).toHaveAttribute("aria-pressed", "true");
    let rail = screen.getByRole("complementary", { name: "Role summary" });
    expect(within(rail).getByText("example.sales@example.test")).toBeTruthy();
    expect(within(rail).getByText("Salesperson")).toBeTruthy();

    fireEvent.click(rowButton(table, "example.gm@example.test"));
    rail = screen.getByRole("complementary", { name: "Role summary" });
    expect(within(rail).getByText("example.gm@example.test")).toBeTruthy();
    expect(within(rail).queryByText("example.sales@example.test")).toBeNull();
    expect(salesButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(within(rail).getByRole("button", { name: "Close role summary" }));
    expect(screen.queryByRole("complementary", { name: "Role summary" })).toBeNull();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(logMock).not.toHaveBeenCalled();
  });

  it("links the selected member's role policy to /admin/people/<id> and navigates there", async () => {
    rpcMock.mockResolvedValue({ data: LIVE_MEMBERS, error: null });
    renderRouted("/admin?tab=team&dept=Sales");
    fireEvent.click(rowButton(await screen.findByRole("table", { name: "Team members" }), "example.sales@example.test"));
    const link = within(screen.getByRole("complementary", { name: "Role summary" })).getByRole("link", { name: "View role policy" });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("/admin/people/m2?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("from")).toBe("team");
    expect(params.get("sel")).toBe("m2");
    expect(params.get("dept")).toBe("Sales");
    fireEvent.click(link);
    expect(screen.getByTestId("location").textContent).toBe(href);
    expect(rpcMock.mock.calls.every((c) => c[0] === "list_tenant_members")).toBe(true);
  });

  it("recovers from a failed read: Retry re-issues the read and the team appears", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "statement timeout" } }).mockResolvedValue({ data: LIVE_MEMBERS, error: null });
    renderTeam("/admin?tab=team", false);
    await screen.findByText("The team could not be read for this rooftop.");
    expect(screen.getByText("statement timeout")).toBeTruthy();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("example.gm@example.test")).toBeTruthy();
    expect(screen.queryByText("The team could not be read for this rooftop.")).toBeNull();
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenNthCalledWith(2, "list_tenant_members", { p_tenant_id: "tenant-example" });
  });

  it("renders live members, including a pending invitation, and shows the empty filter state without clearing the team", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { id: "m1", user_id: "u1", email: "example.gm@example.test", role: "general_manager", accepted_at: "2026-09-01T00:00:00Z", invited_email: null },
        { id: "m2", user_id: null, email: null, role: "salesperson", accepted_at: null, invited_email: "example.invited@example.test" },
      ],
      error: null,
    });
    renderTeam("/admin?tab=team", false);
    await screen.findByText("example.gm@example.test");
    expect(screen.getByText("example.invited@example.test")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Team members" })).getByText("Invited")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "Service" } });
    await waitFor(() => expect(screen.getByText("No team members match these filters")).toBeTruthy());
    expect(screen.getByText("2 members are on this rooftop.")).toBeTruthy();
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
