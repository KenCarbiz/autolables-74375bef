import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";
import { EXAMPLE_MEMBERS, FIXTURE_04 } from "@/pages/admin/fixtures/people";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());
const viewer = vi.hoisted(() => ({ role: "owner" }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock, from: fromMock } }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-example" }, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-example" }, isAdmin: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: viewer.role }, loading: false }) }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ log: logMock, entries: [] }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: {}, loading: false }) }));

import MemberRolePage from "./MemberRolePage";

const SALES = "example-member-salesperson";

const renderPage = (path: string, withFixture: boolean) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/people/:memberId" element={<MemberRolePage />} />
          <Route path="/admin/design-fixture/:screen" element={<MemberRolePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(withFixture ? <AdminFixtureProvider fixture={FIXTURE_04}>{tree}</AdminFixtureProvider> : tree);
};

const liveRows = (role = "salesperson") => EXAMPLE_MEMBERS.map((m) => (m.id === SALES ? { ...m, role } : m));

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  logMock.mockReset();
  viewer.role = "owner";
});

describe("MemberRolePage", () => {
  it("renders screen 04 from the fixture without a route param and calls no procedure", () => {
    renderPage("/admin/design-fixture/04", true);
    expect(screen.getByRole("heading", { level: 1, name: "Salesperson role" })).toBeTruthy();
    expect(screen.getByText("Policy draft")).toBeTruthy();
    expect(screen.getByText("Define the work this employee can perform.")).toBeTruthy();
    expect(screen.getByText("Back to Roles")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Role capabilities by task" });
    expect(within(table).getByText("Assigned customers")).toBeTruthy();
    expect(within(table).getByText("Vehicle Passport share")).toBeTruthy();
    expect(within(table).getByText("Publishing policy")).toBeTruthy();
    expect(screen.getAllByText("Must match role policy")).toHaveLength(4);
    expect(screen.queryByText("Verified")).toBeNull();
    expect(screen.getByText("Test role access")).toBeTruthy();
    expect(screen.getByText("Review policy changes")).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("marks the salesperson matrix exactly as the reference: read and act on customers and vehicles, nothing on dealer policy", () => {
    renderPage("/admin/design-fixture/04", true);
    expect(screen.getByText("Assigned customers read: allowed")).toBeTruthy();
    expect(screen.getByText("Assigned customers create or act: allowed")).toBeTruthy();
    expect(screen.getByText("Assigned customers manage: not allowed")).toBeTruthy();
    expect(screen.getByText("Price rules read: not allowed")).toBeTruthy();
    expect(screen.getByText("Publishing policy manage: not allowed")).toBeTruthy();
  });

  it("shows every permission value as labelled capability cards for narrow screens", () => {
    renderPage("/admin/design-fixture/04", true);
    const cards = screen.getByRole("group", { name: "Role capabilities by task" });
    const customers = within(cards).getByText("Assigned customers").closest("li") as HTMLElement;
    const values = within(customers).getAllByRole("definition").map((d) => d.textContent);
    expect(within(customers).getAllByRole("term").map((t) => t.textContent)).toEqual(["Read", "Create or act", "Manage"]);
    expect(values).toEqual(["Allowed", "Allowed", "Not allowed"]);
    const prices = within(cards).getByText("Price rules").closest("li") as HTMLElement;
    expect(within(prices).getAllByRole("definition").map((d) => d.textContent)).toEqual(["Not allowed", "Not allowed", "Not allowed"]);
  });

  it("opens the role preview as labelled test data without granting anything", () => {
    renderPage("/admin/design-fixture/04", true);
    fireEvent.click(screen.getByText("Test role access"));
    expect(screen.getByText("Preview as Salesperson")).toBeTruthy();
    expect(screen.getByText("Test data")).toBeTruthy();
    expect(screen.getByText("Administration is not shown to this role.")).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("resolves a role key from the Roles tab and keeps Review disabled with a reason", () => {
    renderPage("/admin/people/office", true);
    expect(screen.getByRole("heading", { level: 1, name: "Title Clerk / Office Mgr role" })).toBeTruthy();
    expect((screen.getByText("Review policy changes") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Open this policy from a team member to change their role.")).toBeTruthy();
  });

  it("disables Review for a viewer the server would refuse", () => {
    viewer.role = "gsm";
    rpcMock.mockResolvedValue({ data: liveRows(), error: null });
    renderPage(`/admin/people/${SALES}`, false);
    return screen.findByRole("heading", { level: 1, name: "Salesperson role" }).then(() => {
      expect((screen.getByText("Review policy changes") as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/Only an owner, admin or general manager/)).toBeTruthy();
      expect(rpcMock).toHaveBeenCalledTimes(1);
    });
  });

  it("applies a role change only after review, re-reading the role first and recording the reason", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "list_tenant_members") return { data: liveRows(), error: null };
      if (fn === "set_tenant_member_role") return { data: null, error: null };
      return { data: null, error: { message: `unexpected ${fn}` } };
    });
    renderPage(`/admin/people/${SALES}?from=team&sel=${SALES}`, false);
    await screen.findByRole("heading", { level: 1, name: "Salesperson role" });
    expect(screen.getByText("Back to Team")).toBeTruthy();
    expect(rpcMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Review policy changes"));
    const select = await screen.findByLabelText("New role");
    fireEvent.change(select, { target: { value: "sales_manager" } });
    fireEvent.click(screen.getByText("Review change"));
    await screen.findByText("Apply change");
    expect(screen.getByText("Assigned customers: manage")).toBeTruthy();
    expect(rpcMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Promoted after review" } });
    fireEvent.click(screen.getByText("Apply change"));
    await screen.findByText("Role updated.");
    const calls = rpcMock.mock.calls.map((c) => c[0]);
    expect(calls.filter((c) => c === "list_tenant_members").length).toBeGreaterThanOrEqual(2);
    expect(rpcMock).toHaveBeenCalledWith("set_tenant_member_role", { p_member_id: SALES, p_role: "sales_manager" });
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0][0]).toMatchObject({ action: "settings_updated", entity_type: "tenant_member_role", entity_id: SALES, details: { prev_role: "salesperson", new_role: "sales_manager", reason: "Promoted after review" } });
  });

  it("enables Review change only after a real role change: disabled on open and after changing back", async () => {
    rpcMock.mockResolvedValue({ data: liveRows(), error: null });
    renderPage(`/admin/people/${SALES}`, false);
    await screen.findByRole("heading", { level: 1, name: "Salesperson role" });
    fireEvent.click(screen.getByText("Review policy changes"));
    const select = (await screen.findByLabelText("New role")) as HTMLSelectElement;
    expect(select.value).toBe("salesperson");

    expect(screen.getByRole("button", { name: "Review change" })).toBeDisabled();
    expect(screen.queryByText("Apply change")).toBeNull();

    fireEvent.change(select, { target: { value: "sales_manager" } });
    expect(screen.getByRole("button", { name: "Review change" })).toBeEnabled();
    fireEvent.change(select, { target: { value: "salesperson" } });
    expect(screen.getByRole("button", { name: "Review change" })).toBeDisabled();
    expect(screen.queryByText("Apply change")).toBeNull();

    fireEvent.change(select, { target: { value: "sales_manager" } });
    fireEvent.click(screen.getByText("Review change"));
    expect(await screen.findByText("Apply change")).toBeTruthy();
    expect(screen.queryByText("Choose a different role.")).toBeNull();
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["list_tenant_members"]);
  });

  it("discards the role draft on Cancel, so reopening starts from the saved role", async () => {
    rpcMock.mockResolvedValue({ data: liveRows(), error: null });
    renderPage(`/admin/people/${SALES}`, false);
    await screen.findByRole("heading", { level: 1, name: "Salesperson role" });
    fireEvent.click(screen.getByText("Review policy changes"));
    fireEvent.change(await screen.findByLabelText("New role"), { target: { value: "sales_manager" } });
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByLabelText("New role")).toBeNull());

    fireEvent.click(screen.getByText("Review policy changes"));
    expect(((await screen.findByLabelText("New role")) as HTMLSelectElement).value).toBe("salesperson");
    expect(rpcMock.mock.calls.some((c) => c[0] === "set_tenant_member_role")).toBe(false);
    expect(logMock).not.toHaveBeenCalled();
  });

  it("shows a refused write as Not applied and never claims the role was updated", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "list_tenant_members") return { data: liveRows(), error: null };
      if (fn === "set_tenant_member_role") return { data: null, error: { message: "permission denied for function set_tenant_member_role" } };
      return { data: null, error: { message: `unexpected ${fn}` } };
    });
    renderPage(`/admin/people/${SALES}`, false);
    await screen.findByRole("heading", { level: 1, name: "Salesperson role" });
    fireEvent.click(screen.getByText("Review policy changes"));
    fireEvent.change(await screen.findByLabelText("New role"), { target: { value: "sales_manager" } });
    fireEvent.click(screen.getByText("Review change"));
    fireEvent.change(await screen.findByLabelText("Reason (optional)"), { target: { value: "Promoted" } });
    fireEvent.click(screen.getByText("Apply change"));

    expect(await screen.findByText("Not applied")).toBeTruthy();
    expect(screen.getByText("Only an owner, admin or general manager can change the team.")).toBeTruthy();
    expect(rpcMock).toHaveBeenCalledWith("set_tenant_member_role", { p_member_id: SALES, p_role: "sales_manager" });
    expect(screen.queryByText("Role updated.")).toBeNull();
    expect(screen.queryByText("Applied")).toBeNull();
    expect(screen.getByText("Policy draft")).toBeTruthy();
    expect(logMock).not.toHaveBeenCalled();
  });

  it("refuses to apply when the role changed since the review was opened", async () => {
    let reads = 0;
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "list_tenant_members") { reads += 1; return { data: liveRows(reads === 1 ? "salesperson" : "office"), error: null }; }
      return { data: null, error: null };
    });
    renderPage(`/admin/people/${SALES}`, false);
    await screen.findByRole("heading", { level: 1, name: "Salesperson role" });
    fireEvent.click(screen.getByText("Review policy changes"));
    fireEvent.change(await screen.findByLabelText("New role"), { target: { value: "sales_manager" } });
    fireEvent.click(screen.getByText("Review change"));
    fireEvent.click(await screen.findByText("Apply change"));
    await screen.findByText("Changed since you opened this review");
    await waitFor(() => expect(rpcMock.mock.calls.some((c) => c[0] === "set_tenant_member_role")).toBe(false));
    expect(logMock).not.toHaveBeenCalled();
  });
});
