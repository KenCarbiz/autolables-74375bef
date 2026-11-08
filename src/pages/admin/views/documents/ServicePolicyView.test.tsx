import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  log: vi.fn(),
  role: "owner" as string,
  settings: {} as Record<string, unknown>,
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {} }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: mocks.settings, updateSettings: mocks.updateSettings, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-test", name: "Example Motors" }, currentStore: null, stores: [] }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-test", email: "manager@example.test" }, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: mocks.role }, loading: false }) }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ entries: [], log: mocks.log }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    Object.assign(c, {
      select: () => c,
      eq: () => c,
      neq: () => c,
      is: () => c,
      in: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null, count: 12 }),
    });
    return c;
  };
  return {
    supabase: {
      from: () => chain(),
      rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
    },
  };
});

import ServicePolicyView from "./ServicePolicyView";

const baseSettings = (): Record<string, unknown> => ({
  require_safety_inspection: false,
  k208_authority_roles: [],
  require_k208_licensee_certification: false,
  require_install_verification: false,
  recon_auto_approve_amount: 500,
  recon_approval_email: "",
  prep_require_ro: false,
  prep_detail_photos_required: false,
  prep_service_photo_tasks: "",
  get_ready_services: [{ name: "Example Reconditioning", responsible_name: "Example Service", responsible_email: "service@dealership.example", cost: "150" }],
  title_clerk_email: "",
  title_email_on_intake: true,
  title_round_robin: false,
  title_reminders_enabled: true,
  title_reminder_days: 3,
});

const renderView = (group?: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin?tab=service-policy${group ? `&group=${group}` : ""}`]}>
        <ServicePolicyView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const applyReview = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Review policy changes" }));
  const dialog = await screen.findByRole("dialog");
  const apply = within(dialog).getByRole("button", { name: "Apply" });
  await waitFor(() => expect(apply).toBeEnabled());
  fireEvent.click(apply);
  return dialog;
};

describe("ServicePolicyView", () => {
  beforeEach(() => {
    mocks.updateSettings.mockReset();
    mocks.updateSettings.mockResolvedValue(true);
    mocks.log.mockReset();
    mocks.role = "owner";
    mocks.settings = baseSettings();
  });

  it("writes nothing on mount, shows four summaries and keeps review disabled while clean", () => {
    renderView();
    for (const name of ["Inspection & signing", "Technician requirements", "Recon spending approvals", "Title & MCO collection"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review policy changes" })).toBeDisabled();
    expect(screen.getByText(/1 service configured/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open service catalog" })).toHaveAttribute("href", "/admin/documents/service-catalog");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("applies only the changed service keys, once, with a review warning", async () => {
    renderView("inspection");
    fireEvent.click(screen.getByRole("switch", { name: "Require K-208 before customer signing" }));
    fireEvent.click(screen.getByRole("radio", { name: /Selected authorized roles/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Roles whose signed K-208 satisfies the gate" })).getByRole("checkbox", { name: "Service Manager" }));
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    const dialog = await applyReview();
    expect(within(dialog).getByText("Used and CPO disclosures cannot be signed until a K-208 is completed; open deals may be held.")).toBeInTheDocument();
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    expect(mocks.updateSettings.mock.calls[0][0]).toEqual({ require_safety_inspection: true, k208_authority_roles: ["service_manager"] });
    await waitFor(() => expect(mocks.log).toHaveBeenCalledTimes(1));
    expect(mocks.log.mock.calls[0][0]).toMatchObject({ action: "settings_updated", details: { scope: "service_policy" } });
  });

  it("never lets an empty role selection mean everyone", () => {
    mocks.settings = { ...baseSettings(), require_safety_inspection: true, k208_authority_roles: ["service_manager"] };
    renderView("inspection");
    const roles = within(screen.getByRole("group", { name: "Roles whose signed K-208 satisfies the gate" }));
    fireEvent.click(roles.getByRole("checkbox", { name: "Service Manager" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("saves 0 for approve-every-amount and restores the stored 500 when toggled back", async () => {
    renderView("recon");
    expect(screen.getByLabelText("Auto-approve up to ($)")).toHaveValue(500);
    fireEvent.click(screen.getByRole("radio", { name: /Require approval for every amount/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Auto-approve up to an amount/ }));
    expect(screen.getByLabelText("Auto-approve up to ($)")).toHaveValue(500);
    expect(screen.getByRole("button", { name: "Review policy changes" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Require approval for every amount/ }));
    await applyReview();
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    expect(mocks.updateSettings.mock.calls[0][0]).toEqual({ recon_auto_approve_amount: 0 });
    expect(screen.getByText("Not available")).toBeInTheDocument();
  });

  it("moves title settings into the review flow and writes only the changed key", async () => {
    renderView("title");
    fireEvent.click(screen.getByRole("radio", { name: /Rotate: one recipient at a time/ }));
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    await applyReview();
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    expect(mocks.updateSettings.mock.calls[0][0]).toEqual({ title_round_robin: true });
  });

  it("title preview opens without writing anything", () => {
    renderView("title");
    fireEvent.click(screen.getByRole("button", { name: "Preview request" }));
    expect(screen.getByText(/sends nothing/)).toBeInTheDocument();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("shows the gates read-only to a role without service-settings capability", () => {
    mocks.role = "salesperson";
    renderView("inspection");
    expect(screen.getByRole("switch", { name: "Require K-208 before customer signing" })).toBeDisabled();
    expect(screen.getByText(/Your role can view this policy but not change it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review policy changes" })).toBeDisabled();
  });
});
