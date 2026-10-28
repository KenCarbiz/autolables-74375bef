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

const renderView = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin?tab=service-policy"]}>
        <ServicePolicyView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("ServicePolicyView", () => {
  beforeEach(() => {
    mocks.updateSettings.mockReset();
    mocks.updateSettings.mockResolvedValue(true);
    mocks.log.mockReset();
    mocks.role = "owner";
    mocks.settings = baseSettings();
  });

  it("writes nothing on mount and keeps review disabled while clean", () => {
    renderView();
    expect(screen.getByRole("button", { name: "Review policy changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
    expect(screen.getByDisplayValue("Example Reconditioning")).toBeInTheDocument();
    expect(screen.getAllByText("Saves automatically")).toHaveLength(2);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("applies only the changed service keys, once, with a review warning", async () => {
    renderView();
    fireEvent.click(screen.getByRole("switch", { name: "Require K-208 before customer signing" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Roles whose signed K-208 satisfies the gate" })).getByRole("button", { name: "Service Manager" }));
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Review policy changes" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Used and CPO disclosures cannot be signed until a K-208 is completed; open deals may be held.")).toBeInTheDocument();
    const apply = within(dialog).getByRole("button", { name: "Apply" });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);

    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    expect(mocks.updateSettings.mock.calls[0][0]).toEqual({ require_safety_inspection: true, k208_authority_roles: ["service_manager"] });
    await waitFor(() => expect(mocks.log).toHaveBeenCalledTimes(1));
    expect(mocks.log.mock.calls[0][0]).toMatchObject({ action: "settings_updated", details: { scope: "service_policy", keys: ["require_safety_inspection", "k208_authority_roles"] } });
  });

  it("refuses a review that fails validation and writes nothing", async () => {
    renderView();
    fireEvent.change(screen.getByLabelText("Used-car manager email(s) for approvals"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Review policy changes" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Recon approval recipients must be valid email addresses.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("instant-saves only the title keys that changed, with visible status", async () => {
    renderView();
    fireEvent.click(screen.getByRole("switch", { name: "Round-robin the request" }));
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(mocks.updateSettings.mock.calls[0][0]).toEqual({ title_round_robin: true });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("shows the gates read-only to a role without service-settings capability", () => {
    mocks.role = "salesperson";
    renderView();
    expect(screen.getByRole("switch", { name: "Require K-208 before customer signing" })).toBeDisabled();
    expect(screen.getByText("Your role can view this policy but not change it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review policy changes" })).toBeDisabled();
  });
});
