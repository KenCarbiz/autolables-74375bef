import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), canConfigure: true, row: null as Record<string, unknown> | null, rowError: false }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const result = () => (h.rowError ? { data: null, error: { message: "x" } } : { data: h.row, error: null });
  Object.assign(chain, {
    select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: () => Promise.resolve(result()),
    then: (res: (v: unknown) => unknown) => res({ data: [], error: null }),
  });
  return { supabase: { from: (...a: unknown[]) => { h.from(...a); return chain; }, rpc: (...a: unknown[]) => { h.rpc(...a); return Promise.resolve({ data: { ok: true }, error: null }); } } };
});
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "11111111-1111-1111-1111-111111111111", name: "Example Auto Group" }, currentStore: { id: "s1", name: "Example Honda" } }) }));
vi.mock("@/contexts/DealerSettingsContext", async (orig) => ({ ...(await orig<typeof import("@/contexts/DealerSettingsContext")>()), useDealerSettings: () => ({ settings: { dealer_name: "Example Honda", dealer_city: "Example City", dealer_state: "ST" } }) }));
vi.mock("@/hooks/useDescriptionOps", () => ({ useDescriptionPermissions: () => ({ canConfigure: h.canConfigure }) }));

import DestinationsView from "./DestinationsView";
import { WAVE_C_PUBLISHING_FIXTURES } from "@/pages/admin/fixtures/WaveCPublishingFixtures";

const live = (search = "") => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[`/admin?tab=destinations${search}`]}><DestinationsView /></MemoryRouter></QueryClientProvider>);
const fixture = (id: string, state = "") => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/x${state ? `?state=${state}` : ""}`]}><AdminFixtureProvider fixture={WAVE_C_PUBLISHING_FIXTURES[id].fixture}><DestinationsView /></AdminFixtureProvider></MemoryRouter></QueryClientProvider>);

beforeEach(() => { h.rpc.mockClear(); h.from.mockClear(); h.canConfigure = true; h.row = { review_mode: "EXCEPTION_REVIEW", review_mode_by_class: {}, enabled_channels: ["vauto"], internal_publication_enabled: true, updated_at: "t1", cta_template: "", required_legal_text: "" }; h.rowError = false; });

describe("Destinations and automation", () => {
  it("separates generate, delivery and automatic delivery, with no connected state for export-only destinations", () => {
    fixture("v3-destinations");
    const cards = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-destination"));
    expect(cards.length).toBe(8);
    expect(within(cards.find((c) => c.getAttribute("data-destination") === "vehicle_passport")!).getByText("Automatic delivery to Passport")).toBeInTheDocument();
    for (const c of cards.filter((c) => c.getAttribute("data-destination") !== "vehicle_passport")) {
      expect(within(c).queryByText(/Automatic delivery/)).toBeNull();
      expect(within(c).queryByText(/Connected/i)).toBeNull();
    }
    const cars = cards.find((c) => c.getAttribute("data-destination") === "cars_com")!;
    expect(within(cars).getByText("Connector not configured")).toBeInTheDocument();
    expect(within(cards.find((c) => c.getAttribute("data-destination") === "google_seo")!).getByText("Manual export")).toBeInTheDocument();
  });

  it("shows delivery facts only from records and none otherwise", () => {
    fixture("v3-destinations");
    const passport = screen.getAllByRole("listitem").find((li) => li.getAttribute("data-destination") === "vehicle_passport")!;
    expect(within(passport).getByText(/archived before the description/)).toBeInTheDocument();
    const facebook = screen.getAllByRole("listitem").find((li) => li.getAttribute("data-destination") === "facebook")!;
    expect(within(facebook).getAllByText("No deliveries recorded yet").length).toBe(1);
    expect(within(facebook).queryByText("None recorded")).toBeNull();
  });

  it("keeps all four modes and resolves inherited vs custom per type", () => {
    fixture("v3-destinations");
    for (const m of ["Full automation", "Exception review", "Approval required", "Draft only"]) expect(screen.getAllByText(m).length).toBeGreaterThan(0);
    const used = document.querySelector('[data-automation-type="used"]')!;
    expect(used).toHaveTextContent("Approval required");
    expect(used).toHaveTextContent("Custom for this type");
    expect(document.querySelector('[data-automation-type="new"]')).toHaveTextContent("Inherited default");
  });

  it("previews output without calling any writer", () => {
    fixture("v3-destinations");
    fireEvent.click(screen.getAllByRole("button", { name: /Preview output/ })[0]);
    const d = screen.getByRole("dialog");
    expect(within(d).getByText("Preview only")).toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it("states unavailable delivery history instead of zero when the read fails", () => {
    fixture("v3-destinations", "error");
    expect(screen.getByText("Description settings could not be read")).toBeInTheDocument();
  });

  it("blocked: no save is offered and apply stays off in a fixture", () => {
    fixture("v3-destinations", "blocked");
    expect(screen.getByText("Passport delivery is off")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Full automation/ }));
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply changes" })).toBeDisabled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("read-only users get a summary with disabled controls and no draft bar", () => {
    fixture("v3-destinations", "readonly");
    expect(screen.getByText("You can view these settings but not change them")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    screen.getAllByRole("radio").forEach((r) => expect(r).toBeDisabled());
  });

  it("starts with Review disabled, then applies through save_description_settings with the whole draft", async () => {
    live();
    await screen.findByText("Default automation mode");
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Draft only/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const d = screen.getByRole("dialog");
    expect(within(d).getByText("Default automation mode")).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("save_description_settings", expect.objectContaining({ p_tenant_id: "11111111-1111-1111-1111-111111111111", p_settings: expect.objectContaining({ review_mode: "DRAFT_ONLY", enabled_channels: ["vauto"], quality_threshold: 70 }) })));
  });

  it("reads nothing as defaults when the live read fails", async () => {
    h.rowError = true;
    live();
    expect(await screen.findByText("Description settings could not be read")).toBeInTheDocument();
    expect(screen.queryByText("Default automation mode")).toBeNull();
  });

  it("description settings: invalid values show errors and the engine notice uses dealer wording", () => {
    fixture("v3-description-settings", "invalid");
    expect(screen.getByText("Per-channel description rules are edited here")).toBeInTheDocument();
    expect(screen.getByText(/separate change that has not shipped/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/PR #?45/);
    expect(screen.getAllByText(/The maximum cannot be below the minimum/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/contains the prohibited phrase/).length).toBeGreaterThan(0);
    for (const t of ["Brand voice", "Output profiles", "Claims"]) expect(screen.getByRole("heading", { name: t })).toBeInTheDocument();
    expect(screen.getAllByText(/3,921 characters in total/).length).toBe(1);
  });

  it("vAuto card matches its drawer: valid defaults, readable max shown clamped to the limit", () => {
    fixture("v3-description-settings");
    const card = document.querySelector('[data-profile="vauto"]') as HTMLElement;
    expect(within(card).queryByText("Profile invalid")).toBeNull();
    expect(within(card).getByText(/shown here capped at the limit/)).toBeInTheDocument();
    expect(within(card).getByText("3,500 to 4,000")).toBeInTheDocument();
  });
});
