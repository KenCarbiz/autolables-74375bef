import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, writeCalls } from "@/test/mocks/supabaseSpy";
import { AL97_11, AL97_12, AL97_15, AL97_16, AL97_18, AL97_19 } from "@/pages/admin/fixtures/al97-batch4";
import { AL97_20 } from "@/pages/admin/fixtures/al97-batch2";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import AccessActivityPage from "./AccessActivityPage";
import PermissionVerificationPage, { VERIFICATION_MATRIX, checklistText } from "./PermissionVerificationPage";
import ContactRoutingPage, { hoursLabel } from "./ContactRoutingPage";
import LegacyAssignmentsPage from "./LegacyAssignmentsPage";
import ConnectionsBillingPage, { connectionRows } from "./ConnectionsBillingPage";
import WorkerSetupPage, { WORKER_APPROVAL_REASON } from "./WorkerSetupPage";
import InventoryNetworkPage from "./InventoryNetworkPage";
import { RESUME_REASON } from "./inventoryNetwork/FeedActivationReview";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: true, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null, stores: [] }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "admin" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "UTC" }, loading: false }) }));

const noWrites = () => {
  expect(functionCalls()).toEqual([]);
  expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
  expect(writeCalls().filter((c) => c.kind === "rpc" && /save|set_|approve|decide|retry|enqueue|resolve|assign|associate|resume|enable|schedule/.test(c.fn))).toEqual([]);
};

beforeEach(() => resetSupabaseSpy());

describe("AL97 access activity", () => {
  it("keeps recorded events apart from actions that have no server event", () => {
    renderAdmin(<AccessActivityPage />, { route: ADMIN_CHILD_ROUTES.accessActivity, fixture: AL97_11.fixture });
    expect(screen.getByRole("heading", { level: 1, name: "Access activity" })).toBeInTheDocument();
    expect(screen.getAllByText("Recorded").every((el) => el.classList.contains("green"))).toBe(true);
    const target = screen.getByText("Member removed").closest("tr")!;
    expect(within(target).getByText("Target event")).toHaveClass("blue");
    expect(within(target).queryByText("Recorded")).toBeNull();
    noWrites();
  });
});

describe("AL97 permission verification", () => {
  it("shows the expected matrix as a test plan and the role preview as a simulation", () => {
    renderAdmin(<PermissionVerificationPage />, { route: ADMIN_CHILD_ROUTES.permissionVerification, fixture: AL97_19.fixture });
    expect(screen.getAllByRole("row")).toHaveLength(VERIFICATION_MATRIX.length + 1);
    expect(screen.getByText("Simulation")).toHaveClass("blue");
    expect(screen.getByText("Not run")).toHaveClass("amber");
    expect(checklistText()).toContain("[ ] Other tenant: expect Deny");
    noWrites();
  });
});

describe("AL97 contact and routing", () => {
  it("scopes routing to the whole account, sends no preview and keeps review disabled", () => {
    renderAdmin(<ContactRoutingPage />, { route: ADMIN_CHILD_ROUTES.contactRouting, fixture: AL97_12.fixture });
    expect(screen.getByText("Whole account, not Harte INFINITI only")).toBeInTheDocument();
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    expect(screen.getByText("Not deliverable")).toHaveClass("red");
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    expect(hoursLabel([])).toBe("Not configured");
    expect(hoursLabel([1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startTime: "09:00", endTime: "18:00" })))).toBe("Mon–Fri 09:00–18:00");
    noWrites();
  });
});

describe("AL97 legacy store assignments", () => {
  it("previews sets without assigning and states why apply is disabled", () => {
    renderAdmin(<LegacyAssignmentsPage />, { route: ADMIN_CHILD_ROUTES.legacyAssignments, fixture: AL97_15.fixture });
    const apply = screen.getByRole("button", { name: "Apply assignments" });
    expect(apply).toBeDisabled();
    expect(apply).toHaveAccessibleDescription(/No server writer applies store assignments/);
    expect(screen.getByText("Never rewritten")).toBeInTheDocument();
    noWrites();
  });
});

describe("AL97 connections and billing", () => {
  it("does not treat a manual entitlement as billing proof and keeps a paused crawl apart from an absent one", () => {
    renderAdmin(<ConnectionsBillingPage />, { route: ADMIN_CHILD_ROUTES.connections, fixture: AL97_16.fixture });
    const billing = screen.getByText("Autocurb billing").closest("tr")!;
    expect(within(billing).getByText("Not demonstrated")).toHaveClass("amber");
    expect(screen.getByText("Billing handshake is not demonstrated")).toBeInTheDocument();
    expect(screen.getByText("Exists · paused")).toBeInTheDocument();
    const rows = connectionRows({ files: null, marketcheck: null, billing: null, crawl: null });
    expect(rows.slice(0, 3).every((r) => r.state.label === "Unknown")).toBe(true);
    noWrites();
  });
});

describe("AL97 worker setup", () => {
  it("opens the review dialog with enable disabled and returns focus on Escape and Cancel", async () => {
    renderAdmin(<WorkerSetupPage />, { route: ADMIN_CHILD_ROUTES.workerSetup, fixture: AL97_18.fixture });
    const dialog = screen.getByRole("dialog", { name: "Review Files.com worker setup" });
    const enable = within(dialog).getByRole("button", { name: "Enable worker" });
    expect(enable).toBeDisabled();
    expect(enable).toHaveAttribute("title", WORKER_APPROVAL_REASON);
    expect(within(dialog).getByText("None found in inspection")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    const trigger = screen.getByRole("button", { name: "Review worker setup" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    noWrites();
  });
});

describe("AL97 store feed activation", () => {
  it("shows the gates with resume disabled and returns focus on Cancel", async () => {
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=mapping&file=%2Finbound%2FMP15397_inventory.csv&review=activation", fixture: AL97_20.fixture });
    const dialog = screen.getByRole("dialog", { name: "Review feed activation" });
    expect(within(dialog).getByText("Verified heartbeat and claim")).toBeInTheDocument();
    const resume = within(dialog).getByRole("button", { name: "Resume this store" });
    expect(resume).toBeDisabled();
    expect(resume).toHaveAttribute("title", RESUME_REASON);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Review feed activation" })).toHaveFocus());
    expect(screen.getByRole("heading", { name: "More inventory network views" })).toBeInTheDocument();
    noWrites();
  });
});
