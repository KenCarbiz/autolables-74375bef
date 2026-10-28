import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider, type AdminFixture } from "@/lib/admin/dataSource";
import { DEFAULT_DOCUMENT_RULES } from "@/lib/documentRules";
import { FIXTURE_11 } from "@/pages/admin/fixtures/11";

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  log: vi.fn(),
  role: "owner" as string,
  count: 3 as number | null,
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
      then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null, count: mocks.count }),
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

import ApprovalRulesView from "./ApprovalRulesView";

const baseSettings = (): Record<string, unknown> => ({
  document_rules: {},
  label_defaults: { window_used: "builder:used-car-sticker", window_new: "builder:new-car-sticker" },
  require_safety_inspection: false,
  k208_authority_roles: [],
  require_k208_licensee_certification: false,
  require_install_verification: false,
});

/** The screen fixture without its depicted pending change and viewer override, so the role decides. */
const readOnlyFixture = (): AdminFixture => {
  const { pendingDraft: _draft, canEdit: _canEdit, ...rules } = FIXTURE_11.fixture.views["approval-rules"] as Record<string, unknown>;
  return { ...FIXTURE_11.fixture, views: { ...FIXTURE_11.fixture.views, "approval-rules": rules } };
};

const renderView = (fixture?: AdminFixture) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = <ApprovalRulesView />;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{fixture ? <AdminFixtureProvider fixture={fixture}>{view}</AdminFixtureProvider> : view}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("ApprovalRulesView", () => {
  beforeEach(() => {
    mocks.updateSettings.mockReset();
    mocks.updateSettings.mockResolvedValue(true);
    mocks.log.mockReset();
    mocks.role = "owner";
    mocks.count = 3;
    mocks.settings = baseSettings();
  });

  it("renders the fixture rows and rail without writing anything", () => {
    renderView(FIXTURE_11.fixture);
    expect(screen.getByRole("heading", { name: "Addendum approval" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Approval rules by document" });
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(within(table).getByText("Inspection record")).toBeInTheDocument();
    expect(within(table).getByText("Authorized signer (Service Manager)")).toBeInTheDocument();
    expect(screen.getByText("Version 4")).toBeInTheDocument();
    expect(screen.getByText("Needs test")).toBeInTheDocument();
    expect(screen.getByText("4 configured")).toBeInTheDocument();
    expect(screen.getByText("Review required")).toBeInTheDocument();
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.getByText("1 change pending review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review policy changes" })).toBeEnabled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("starts clean when the fixture carries no pending draft", () => {
    renderView(readOnlyFixture());
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("No changes pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review policy changes" })).toBeDisabled();
  });

  it("never renders a failed readiness read as zero", () => {
    const fixture: AdminFixture = {
      ...FIXTURE_11.fixture,
      views: {
        ...FIXTURE_11.fixture.views,
        "documents-readiness": { calibration: { kind: "failed" }, templatesConfigured: { kind: "failed" }, disclosuresMissing: { kind: "failed" }, policyVersion: null, versionCheck: "unavailable" },
      },
    };
    renderView(fixture);
    expect(screen.getAllByText("Unknown")).toHaveLength(3);
    expect(screen.getAllByText("Could not be read")).toHaveLength(3);
    expect(screen.queryByText(/^0 /)).toBeNull();
    expect(screen.getByText("In effect")).toBeInTheDocument();
  });

  it("applies only document_rules, once, after an explicit review", async () => {
    renderView();
    await screen.findByText("Needs setup");
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit Addendum rules" }));
    const sw = screen.getByRole("switch", { name: "Require manager approval before printing" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.getByText("1 change pending review")).toBeInTheDocument();

    const reviewButton = screen.getByRole("button", { name: "Review policy changes" });
    expect(reviewButton).toBeEnabled();
    fireEvent.click(reviewButton);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Require manager approval before printing")).toBeInTheDocument();
    const apply = within(dialog).getByRole("button", { name: "Apply" });
    await waitFor(() => expect(apply).toBeEnabled());
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    fireEvent.click(apply);
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    const payload = mocks.updateSettings.mock.calls[0][0] as { document_rules: typeof DEFAULT_DOCUMENT_RULES };
    expect(Object.keys(payload)).toEqual(["document_rules"]);
    expect(payload.document_rules).toEqual({ ...DEFAULT_DOCUMENT_RULES, requireApprovalBeforePrint: true });
    await waitFor(() => expect(mocks.log).toHaveBeenCalledTimes(1));
    expect(mocks.log.mock.calls[0][0]).toMatchObject({ action: "settings_updated", entity_type: "dealer_settings", store_id: "tenant-test", details: { keys: ["document_rules"] } });
    expect(await within(dialog).findByText("Applied")).toBeInTheDocument();
  });

  it("blocks apply while the impact count is unavailable", async () => {
    mocks.count = null;
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit Window sticker rules" }));
    fireEvent.click(screen.getByRole("switch", { name: "Track QR scans" }));
    fireEvent.click(screen.getByRole("button", { name: "Review policy changes" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Unavailable")).toBeInTheDocument());
    expect(within(dialog).getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("opens editing for the document whose Edit is pressed, and selecting a row alone does not edit", async () => {
    renderView();
    await screen.findByText("Needs setup");
    expect(screen.queryByText(/^Rules for /)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit Window sticker rules" }));
    expect(screen.getByRole("heading", { name: "Window sticker approval" })).toBeInTheDocument();
    expect(screen.getByText("Rules for window sticker")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Track QR scans" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Require manager approval before sending an addendum packet" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit Addendum rules" }));
    expect(screen.getByRole("heading", { name: "Addendum approval" })).toBeInTheDocument();
    expect(screen.getByText("Rules for addendum")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Require manager approval before sending an addendum packet" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Track QR scans" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText(/^Rules for /)).toBeNull();

    const table = screen.getByRole("table", { name: "Approval rules by document" });
    fireEvent.click(within(table).getByText("Buyers Guide"));
    expect(screen.getByRole("heading", { name: "Buyers Guide approval" })).toBeInTheDocument();
    expect(screen.queryByText(/^Rules for /)).toBeNull();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("enables review only for a real change: toggling a rule back clears the pending change", async () => {
    renderView();
    await screen.findByText("Needs setup");
    const reviewButton = () => screen.getByRole("button", { name: "Review policy changes" });
    expect(reviewButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Edit Addendum rules" }));
    const sw = screen.getByRole("switch", { name: "Require manager approval before printing" });
    fireEvent.click(sw);
    expect(reviewButton()).toBeEnabled();
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    fireEvent.click(sw);
    expect(reviewButton()).toBeDisabled();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("No changes pending")).toBeInTheDocument();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("keeps the pending change when the review is cancelled, without writing", async () => {
    renderView();
    await screen.findByText("Needs setup");
    fireEvent.click(screen.getByRole("button", { name: "Edit Addendum rules" }));
    fireEvent.click(screen.getByRole("switch", { name: "Require manager approval before printing" }));
    fireEvent.click(screen.getByRole("button", { name: "Review policy changes" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Apply" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Require manager approval before printing" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Review policy changes" })).toBeEnabled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it.each([
    ["resolves false", () => mocks.updateSettings.mockResolvedValue(false)],
    ["throws", () => mocks.updateSettings.mockRejectedValue(new Error("network down"))],
  ])("shows Not applied and records nothing when the save %s", async (_label, arrange) => {
    arrange();
    renderView();
    await screen.findByText("Needs setup");
    fireEvent.click(screen.getByRole("button", { name: "Edit Addendum rules" }));
    fireEvent.click(screen.getByRole("switch", { name: "Require manager approval before printing" }));
    fireEvent.click(screen.getByRole("button", { name: "Review policy changes" }));
    const dialog = await screen.findByRole("dialog");
    const apply = within(dialog).getByRole("button", { name: "Apply" });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    expect(await within(dialog).findByText("Not applied")).toBeInTheDocument();
    expect(within(dialog).getByText("The server did not accept the change. Nothing was written.")).toBeInTheDocument();
    expect(within(dialog).queryByText("Applied")).toBeNull();
    expect(mocks.log).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Pending review")).toBeInTheDocument();
  });

  it("lets a salesperson read the rules but not change them", () => {
    mocks.role = "salesperson";
    renderView(readOnlyFixture());
    fireEvent.click(screen.getByRole("button", { name: "Edit Addendum rules" }));
    expect(screen.getByRole("switch", { name: "Require manager approval before printing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review policy changes" })).toBeDisabled();
  });
});
