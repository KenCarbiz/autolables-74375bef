import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { rpcCalls, resetSupabaseSpy } from "@/test/mocks/supabaseSpy";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { VEHICLE_RECORDS_BASE, VEHICLE_RECORDS_FIXTURES, VEHICLE_RECORDS_SNAPSHOT } from "@/pages/admin/fixtures/vehicleRecords";
import { NOT_INSTALLED_BANNER } from "@/lib/vehicleHistory/labels";
import type { VehicleRecordsActions } from "@/lib/vehicleHistory/types";
import VehicleRecordsPage, { VehicleRecordsScreen, type VehicleRecordsScreenProps } from "./VehicleRecordsPage";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: true, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null, stores: [] }) }));
vi.mock("@/contexts/DealerSettingsContext", async (orig) => ({ ...(await orig<typeof import("@/contexts/DealerSettingsContext")>()), useDealerSettings: () => ({ settings: { dealer_timezone: "UTC" }, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "admin" }, loading: false }) }));

beforeEach(() => resetSupabaseSpy());

const actions = (): VehicleRecordsActions => ({
  lookup: vi.fn(async () => ({ kind: "none" as const })),
  resolveReview: vi.fn(async () => ({ ok: true as const })),
  replay: vi.fn(async () => ({ ok: true as const })),
  saveSetting: vi.fn(async () => ({ ok: true as const })),
});

const props = (patch: Partial<VehicleRecordsScreenProps> = {}): VehicleRecordsScreenProps => ({
  account: "Synthetic Demo Motors", store: null, status: "ready", canManage: true, snapshot: VEHICLE_RECORDS_SNAPSHOT, actions: actions(), onChanged: vi.fn(), ...patch,
});

const at = (view: string) => `${ADMIN_CHILD_ROUTES.vehicleRecords}?view=${view}`;
const fixture = VEHICLE_RECORDS_FIXTURES["vehicle-records"].fixture;

describe("Vehicle records & lifecycle", () => {
  it("shows four metrics with real counts from a successful read", () => {
    renderAdmin(<VehicleRecordsScreen {...props()} />, { route: at("search") });
    const list = screen.getByRole("list", { name: "Vehicle record counts" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(within(list).getByText("Open returns to review").closest("li")).toHaveTextContent("2");
    expect(within(list).getByText("Sync dead letters").closest("li")).toHaveTextContent("1");
  });

  it("shows Unknown, never 0, when the snapshot did not load", () => {
    renderAdmin(<VehicleRecordsScreen {...props({ status: "error", snapshot: null })} />, { route: at("search") });
    const list = screen.getByRole("list", { name: "Vehicle record counts" });
    const values = within(list).getAllByRole("listitem").map((li) => li.querySelector("b")?.textContent);
    expect(values).toEqual(["Unknown", "Unknown", "Unknown", "Unknown"]);
    expect(screen.getByText("Vehicle records could not be read")).toBeInTheDocument();
  });

  it("shows one unknown metric when only that count failed", () => {
    const snapshot = { ...VEHICLE_RECORDS_SNAPSHOT, counts: { ...VEHICLE_RECORDS_SNAPSHOT.counts, deadLetters: null } };
    renderAdmin(<VehicleRecordsScreen {...props({ snapshot })} />, { route: at("search") });
    const li = screen.getByText("Sync dead letters").closest("li")!;
    expect(li.querySelector("b")).toHaveTextContent("Unknown");
    expect(li.querySelector("b")).toHaveClass("unknown");
  });

  it("shows the not-installed banner and Unknown counts when the migration is missing", () => {
    renderAdmin(<VehicleRecordsScreen {...props({ status: "missing", snapshot: null })} />, { route: at("lifecycle") });
    expect(screen.getByText(NOT_INSTALLED_BANNER)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Vehicle record counts" });
    expect(within(list).getAllByText("Unknown")).toHaveLength(4);
    expect(screen.queryByText("No returns are waiting for a decision.")).not.toBeInTheDocument();
  });

  it("shows a loading state distinct from empty", () => {
    renderAdmin(<VehicleRecordsScreen {...props({ status: "loading", snapshot: null })} />, { route: at("search") });
    expect(screen.getByText("Reading vehicle records")).toBeInTheDocument();
  });

  it("hides action buttons and says why for a read-only role", () => {
    renderAdmin(<VehicleRecordsScreen {...props({ canManage: false })} />, { route: at("lifecycle") });
    expect(screen.getByText("Read-only for your role")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decide" })).not.toBeInTheDocument();
  });

  it("reports a real zero after a successful read", () => {
    const snapshot = { ...VEHICLE_RECORDS_SNAPSHOT, reviews: [] };
    renderAdmin(<VehicleRecordsScreen {...props({ snapshot })} />, { route: at("lifecycle") });
    expect(screen.getByText("No returns are waiting for a decision.")).toBeInTheDocument();
  });

  it("disables Restore for a delivered prior episode and explains why", () => {
    renderAdmin(<VehicleRecordsScreen {...props()} />, { route: at("lifecycle") });
    const row = screen.getByText("5FNRL6H78KB000193").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Decide" }));
    const restore = screen.getByRole("radio", { name: "Restore archived episode" });
    expect(restore).toBeDisabled();
    expect(screen.getByText(/Restore is only for an archived episode\. The prior episode is delivered/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Start new episode (reacquisition)" })).toBeEnabled();
  });

  it("enables Restore for an archived prior episode and records a decision only with a reason", async () => {
    const a = actions();
    renderAdmin(<VehicleRecordsScreen {...props({ actions: a })} />, { route: at("lifecycle") });
    const row = screen.getByText("JH4KA7561PC008269").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Decide" }));
    fireEvent.click(screen.getByRole("radio", { name: "Restore archived episode" }));
    expect(screen.getByText("No listing is published, merged or deleted. No customer access is granted.")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Record decision" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "abc" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Matches the archived record" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(a.resolveReview).toHaveBeenCalledWith("rv-1", "restore_episode", "Matches the archived record"));
  });

  it("labels repair items distinctly and never shows an authorization as completed work", () => {
    renderAdmin(<VehicleRecordsScreen {...props()} />, { route: at("service") });
    expect(screen.getByText("Customer authorized (not yet performed)")).toBeInTheDocument();
    expect(screen.getByText("Declined - still open")).toBeInTheDocument();
    expect(screen.getByText("Deferred - still open")).toBeInTheDocument();
    expect(screen.getByText("Completed (not independently verified)")).toBeInTheDocument();
    expect(screen.getByText("Completed and verified")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    const brakes = screen.getByText("Front brake pads").closest("tr")!;
    expect(brakes).not.toHaveTextContent(/Completed/);
  });

  it("shows awaiting-approval settings with their server consumer", () => {
    renderAdmin(<VehicleRecordsScreen {...props()} />, { route: at("settings") });
    const card = screen.getByRole("article", { name: "Largest replay batch" });
    expect(within(card).getByText("Awaiting approval")).toBeInTheDocument();
    expect(within(card).getByText("integration_replay_inbox")).toBeInTheDocument();
    expect(within(card).getByText("Platform + This account")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(8);
    expect(screen.getByText(/cannot raise a value past the platform limit/)).toBeInTheDocument();
    expect(screen.getByText(/strictest emergency hold wins/)).toBeInTheDocument();
  });

  it("sends the current tenant version and shows a plain message on a version conflict without retrying", async () => {
    const a = actions();
    (a.saveSetting as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, message: "Someone changed this setting; reload to see the current value." });
    renderAdmin(<VehicleRecordsScreen {...props({ actions: a })} />, { route: at("settings") });
    const card = screen.getByRole("article", { name: "Largest replay batch" });
    fireEvent.click(within(card).getByRole("button", { name: /Change Largest replay batch/ }));
    fireEvent.change(within(card).getByLabelText(/New value for this account/), { target: { value: "10" } });
    fireEvent.change(within(card).getByLabelText(/Reason/), { target: { value: "Smaller batches" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.saveSetting).toHaveBeenCalledWith("integration.replay_max_batch", 10, 1, "Smaller batches"));
    expect(await within(card).findByText("Someone changed this setting; reload to see the current value.")).toBeInTheDocument();
    expect(a.saveSetting).toHaveBeenCalledTimes(1);
  });

  it("refuses a replay above the effective cap and sends nothing", async () => {
    const a = actions();
    const snapshot = { ...VEHICLE_RECORDS_SNAPSHOT, replayCap: 1 };
    renderAdmin(<VehicleRecordsScreen {...props({ actions: a, snapshot })} />, { route: at("sync") });
    expect(screen.getByText(/Replay at most 1 row at a time/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /service_visit.closed/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /service_visit.opened/ }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Retry after fix" } });
    fireEvent.click(screen.getByRole("button", { name: "Replay selected rows" }));
    expect(await screen.findByText(/You selected 2 rows but the limit is 1/)).toBeInTheDocument();
    expect(a.replay).not.toHaveBeenCalled();
  });

  it("replays within the cap with a reason", async () => {
    const a = actions();
    renderAdmin(<VehicleRecordsScreen {...props({ actions: a })} />, { route: at("sync") });
    fireEvent.click(screen.getByRole("checkbox", { name: /service_visit.closed/ }));
    fireEvent.click(screen.getByRole("button", { name: "Replay selected rows" }));
    expect(await screen.findByText("Enter a reason of at least 5 characters.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Retry after fix" } });
    fireEvent.click(screen.getByRole("button", { name: "Replay selected rows" }));
    await waitFor(() => expect(a.replay).toHaveBeenCalledWith(["ib-1"], "Retry after fix"));
  });

  it("renders from the synthetic fixture, labels it synthetic, and searches by VIN without touching the database", async () => {
    renderAdmin(<VehicleRecordsPage />, { route: at("search"), fixture });
    expect(screen.getByText(/^Synthetic data:/)).toBeInTheDocument();
    expect(screen.getAllByText(/Synthetic Demo Motors/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("VIN or stock number"), { target: { value: VEHICLE_RECORDS_BASE.vehicles[0].vin } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("VIN 1HGCM82633A004352")).toBeInTheDocument();
    expect(screen.getByText("No active custody episode. Service and inspection history stays with the vehicle.")).toBeInTheDocument();
    const timeline = screen.getByRole("list", { name: "Timeline for 1HGCM82633A004352" });
    expect(within(timeline).getAllByText("Ownership").length).toBeGreaterThan(0);
    expect(within(timeline).getAllByText("Service")).toHaveLength(1);
    expect(within(timeline).getAllByText("Inventory").length).toBeGreaterThan(0);
    expect(rpcCalls()).toEqual([]);
  });

  it("links two episodes of a reacquired vehicle", async () => {
    renderAdmin(<VehicleRecordsPage />, { route: at("search"), fixture });
    fireEvent.change(screen.getByLabelText("VIN or stock number"), { target: { value: "sd1002" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("VIN 1M8GDM9AXKP042788")).toBeInTheDocument();
    expect(screen.getByText(/Follows the first time in stock episode/)).toBeInTheDocument();
    expect(screen.getAllByText("Reacquired").length).toBeGreaterThan(0);
  });

  it("renders the missing fixture as not installed", () => {
    renderAdmin(<VehicleRecordsPage />, { route: at("search"), fixture: VEHICLE_RECORDS_FIXTURES["vehicle-records-missing"].fixture });
    expect(screen.getByText(NOT_INSTALLED_BANNER)).toBeInTheDocument();
  });
});
