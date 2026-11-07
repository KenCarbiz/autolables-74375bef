import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";
import { WAVE_D_PRINT_FIXTURES } from "@/pages/admin/fixtures/WaveDPrintFixtures";

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  role: "owner" as string,
  settings: {
    get_ready_services: [
      { name: "Example reconditioning", responsible_name: "Example service", responsible_email: "service@example.com", cost: "150" },
      { name: "Example mud flaps installed", responsible_name: "Example vendor", responsible_email: "", cost: "85" },
    ],
    prep_service_photo_tasks: "Example mud flaps installed",
  },
}));

vi.mock("@/contexts/DealerSettingsContext", () => ({
  useDealerSettings: () => ({ settings: mocks.settings, updateSettings: mocks.updateSettings, loading: false, serverLoaded: true, tenantId: "tenant-test" }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: mocks.role } }) }));
vi.mock("@/pages/admin/views/people/useTeamMembers", () => ({
  useTeamMembers: () => ({ members: [{ id: "m1", userId: "u1", email: "lead@example.com", role: "service_manager", roleLabel: "Service Manager", department: "Service", status: "active", acceptedAt: "x", initials: "L" }], state: "ready", error: null, fixture: null, refetch: async () => null }),
}));

import ServiceCatalogView from "./ServiceCatalogView";

const renderIt = (fixture?: ReturnType<typeof Object>) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{fixture ? <AdminFixtureProvider fixture={fixture as never}><ServiceCatalogView /></AdminFixtureProvider> : <ServiceCatalogView />}</MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  mocks.updateSettings.mockReset();
  mocks.updateSettings.mockResolvedValue(true);
  mocks.role = "owner";
});

describe("Service catalog", () => {
  it("shows the required headers and explains internal services are not billed", () => {
    renderIt();
    for (const h of ["Service", "Assigned team/person", "Default internal cost", "Required proof", "Status", "Actions"]) expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    expect(screen.getByText("Internal services are not billed to the buyer")).toBeInTheDocument();
    expect(screen.getByText("$150.00")).toBeInTheDocument();
    expect(screen.getByText("Photo required")).toBeInTheDocument();
  });

  it("validates before it writes and keeps the entries", async () => {
    renderIt();
    fireEvent.click(screen.getAllByRole("button", { name: "Add service" })[0]);
    const panel = await screen.findByRole("dialog");
    fireEvent.change(within(panel).getByLabelText(/Email/), { target: { value: "nope" } });
    fireEvent.change(within(panel).getByLabelText(/Default internal cost/), { target: { value: "12.345" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add service" }));
    expect(await within(panel).findByText("Enter the service name.")).toBeInTheDocument();
    expect(within(panel).getByText("Enter one valid email address.")).toBeInTheDocument();
    expect(within(panel).getByText(/up to two decimals/)).toBeInTheDocument();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects a duplicate name", async () => {
    renderIt();
    fireEvent.click(screen.getAllByRole("button", { name: "Add service" })[0]);
    const panel = await screen.findByRole("dialog");
    fireEvent.change(within(panel).getByLabelText(/^Service/), { target: { value: "example RECONDITIONING" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add service" }));
    expect(await within(panel).findByText("A service with this name already exists.")).toBeInTheDocument();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("adds a service by writing the catalog once, with the entered cost and no invented defaults", async () => {
    renderIt();
    fireEvent.click(screen.getAllByRole("button", { name: "Add service" })[0]);
    const panel = await screen.findByRole("dialog");
    fireEvent.change(within(panel).getByLabelText(/^Service/), { target: { value: "Example key cut" } });
    fireEvent.change(within(panel).getByLabelText(/Default internal cost/), { target: { value: "$20.5" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add service" }));
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    const patch = mocks.updateSettings.mock.calls[0][0] as { get_ready_services: Array<Record<string, string>> };
    expect(Object.keys(mocks.updateSettings.mock.calls[0][0])).toEqual(["get_ready_services"]);
    expect(patch.get_ready_services).toHaveLength(3);
    expect(patch.get_ready_services[2]).toEqual({ name: "Example key cut", responsible_name: "", responsible_email: "", cost: "20.5" });
    expect(patch.get_ready_services[0]).toBe(mocks.settings.get_ready_services[0]);
  });

  it("keeps the panel and the entries open when the server refuses the save", async () => {
    mocks.updateSettings.mockResolvedValue(false);
    renderIt();
    fireEvent.click(screen.getAllByRole("button", { name: "Add service" })[0]);
    const panel = await screen.findByRole("dialog");
    fireEvent.change(within(panel).getByLabelText(/^Service/), { target: { value: "Example tint" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add service" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/did not accept/);
    expect(within(panel).getByLabelText(/^Service/)).toHaveValue("Example tint");
  });

  it("shows Archive as unsupported and removal names its references", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Edit Example mud flaps installed" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("button", { name: "Archive unavailable" })).toBeDisabled();
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove Example mud flaps installed" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/Archive is not available/)).toBeInTheDocument();
    expect(within(confirm).getByText(/Jobs already started/)).toBeInTheDocument();
    expect(within(confirm).getByText(/Photo-proof rule/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove service" }));
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    expect((mocks.updateSettings.mock.calls[0][0] as { get_ready_services: Array<{ name: string }> }).get_ready_services.map((s) => s.name)).toEqual(["Example reconditioning"]);
  });

  it("states that proof is bound by label because no task id exists", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Photo required" }));
    expect(await screen.findByText("Matched by task label, not by a stable id")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Service policy" })).toBeInTheDocument();
  });

  it("warns that renaming breaks the label-bound proof rule", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Edit Example mud flaps installed" }));
    const panel = await screen.findByRole("dialog");
    fireEvent.change(within(panel).getByLabelText(/^Service/), { target: { value: "Example mud guards" } });
    expect(within(panel).getByText("Renaming breaks the proof rule")).toBeInTheDocument();
  });

  it("gives a read-only member a summary and no controls", async () => {
    mocks.role = "sales";
    renderIt();
    expect(screen.queryByRole("button", { name: "Add service" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
    expect(await screen.findByText("You can view this service but not change it")).toBeInTheDocument();
  });

  it("is empty with a working Add service action", async () => {
    mocks.settings.get_ready_services = [];
    renderIt();
    expect(screen.getByText("No services yet")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Add service" });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    mocks.settings.get_ready_services = [
      { name: "Example reconditioning", responsible_name: "Example service", responsible_email: "service@example.com", cost: "150" },
      { name: "Example mud flaps installed", responsible_name: "Example vendor", responsible_email: "", cost: "85" },
    ];
  });

  it("renders the fixture without writing", () => {
    renderIt(WAVE_D_PRINT_FIXTURES["v3-service-catalog"].fixture);
    expect(screen.getByText("Example key cut")).toBeInTheDocument();
    expect(screen.getByText("Needs assignment")).toBeInTheDocument();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
