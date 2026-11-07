import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";

const h = vi.hoisted(() => ({
  ctx: { settings: {} as Record<string, unknown>, loading: false, updateSettings: vi.fn(async (_p: Record<string, unknown>): Promise<boolean> => true), reload: vi.fn(), tenantId: "tenant-a" as string | null, loadGeneration: 1, serverLoaded: true, loadError: null as string | null, lastSaveError: null as string | null },
  auth: { isAdmin: true },
  member: { role: "owner" } as { role: string } | null,
  profileUpdate: vi.fn(),
  tenantReload: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: h.member }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-a", name: "Example Auto Group", secondary_color: "#0B2041" }, currentStore: null, stores: [], reload: h.tenantReload }) }));
vi.mock("@/contexts/DealerSettingsContext", async (orig) => ({ ...(await orig<typeof import("@/contexts/DealerSettingsContext")>()), useDealerSettings: () => h.ctx }));
vi.mock("@/lib/storage", () => ({ uploadPhoto: vi.fn(async () => ({ url: "https://files.example.test/x.png" })) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }), update: (v: unknown) => ({ eq: () => ({ select: async () => h.profileUpdate(v) }) }) }),
  },
}));

import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import { WAVE_B_BRAND_FIXTURES } from "@/pages/admin/fixtures/WaveBBrandFixtures";
import IdentityView from "./IdentityView";
import AppearanceView from "./AppearanceView";
import HoursContactView from "./HoursContactView";
import WhyBuyView from "./WhyBuyView";

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const live = (View: () => JSX.Element) => render(<QueryClientProvider client={qc()}><MemoryRouter><View /></MemoryRouter></QueryClientProvider>);
const fixture = (View: () => JSX.Element, key: string, query = "") =>
  render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={[`/x${query}`]}><AdminFixtureProvider fixture={WAVE_B_BRAND_FIXTURES[key].fixture}><View /></AdminFixtureProvider></MemoryRouter></QueryClientProvider>);
const review = () => screen.getByRole("button", { name: "Review changes" });
const applyAll = async () => { fireEvent.click(review()); await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply changes" })); }); };

beforeEach(() => {
  h.ctx.settings = { ...DEFAULT_SETTINGS, dealer_name: "Example Motors", dealer_city: "Sampleville", dealer_state: "CT", dealer_timezone: "America/New_York", primary_color: "#2457D6", dealer_phone: "(860) 555-0142", dealer_hours: "Mon to Fri 9 to 5" };
  h.ctx.loading = false; h.ctx.serverLoaded = true; h.ctx.tenantId = "tenant-a";
  h.auth.isAdmin = true; h.member = { role: "owner" };
  h.ctx.updateSettings.mockReset(); h.ctx.updateSettings.mockResolvedValue(true);
  h.profileUpdate.mockReset(); h.profileUpdate.mockResolvedValue({ data: [{ tenant_id: "tenant-a" }], error: null });
  h.invoke.mockReset(); h.tenantReload.mockReset(); h.ctx.reload.mockReset();
});

describe("Identity", () => {
  it("loads without writing, with Review disabled while clean", () => {
    live(IdentityView);
    expect(screen.getByLabelText(/Public display name/)).toHaveProperty("value", "Example Motors");
    expect(review()).toHaveProperty("disabled", true);
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
  });

  it("blocks legal name behind its migration with no way to save it", () => {
    live(IdentityView);
    expect(screen.getByLabelText("Legal name")).toHaveProperty("disabled", true);
    expect(document.querySelector("[data-blocked-feature]")?.textContent).toContain("20261114000000");
  });

  it("reviews and applies only the changed key through the settings writer", async () => {
    live(IdentityView);
    fireEvent.change(screen.getByLabelText(/Public display name/), { target: { value: "Example Motors East" } });
    await applyAll();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledWith({ dealer_name: "Example Motors East" }));
    expect(h.ctx.updateSettings).toHaveBeenCalledTimes(1);
  });

  it("will not review a cleared name or an invalid state", () => {
    live(IdentityView);
    fireEvent.change(screen.getByLabelText(/Public display name/), { target: { value: " " } });
    expect(review()).toHaveProperty("disabled", true);
    expect(screen.getAllByText(/Enter the public display name/).length).toBeGreaterThan(0);
  });

  it("keeps the draft and shows the failure when the server refuses the save", async () => {
    h.ctx.updateSettings.mockResolvedValue(false);
    live(IdentityView);
    fireEvent.change(screen.getByLabelText(/^City/), { target: { value: "Elsewhere" } });
    await applyAll();
    await waitFor(() => expect(screen.getByText(/Save failed/)).toBeTruthy());
    expect(screen.getByLabelText(/^City/)).toHaveProperty("value", "Elsewhere");
  });

  it("is read-only for a role that cannot manage settings", () => {
    h.auth.isAdmin = false; h.member = { role: "viewer" };
    live(IdentityView);
    expect(screen.getByText(/You can view these settings but not change them/)).toBeTruthy();
    expect(screen.getByLabelText(/Public display name/)).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });

  it("explains an unreadable server row and disables fields", () => {
    h.ctx.serverLoaded = false;
    live(IdentityView);
    expect(screen.getByText("Saving is unavailable")).toBeTruthy();
    expect(screen.getByLabelText(/Public display name/)).toHaveProperty("disabled", true);
  });

  it("renders the fixture read-only variant", () => {
    fixture(IdentityView, "v3-identity", "?state=readonly");
    expect(screen.getByText("View only")).toBeTruthy();
    expect(screen.getByText("Example Auto Group")).toBeTruthy();
  });
});

describe("Appearance", () => {
  it("blocks the named palette and the dark logo with the migration id and no save", () => {
    live(AppearanceView);
    expect(document.querySelectorAll("[data-blocked-feature]").length).toBe(2);
    expect(screen.getByRole("button", { name: "Add colour", hidden: true })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Reset palette", hidden: true })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Upload Logo for dark backgrounds", hidden: true })).toHaveProperty("disabled", true);
  });

  it("rejects an invalid hex and applies a valid primary colour to settings only", async () => {
    live(AppearanceView);
    const primary = screen.getAllByLabelText(/Primary colour/)[0];
    fireEvent.change(primary, { target: { value: "#24G7" } });
    expect(review()).toHaveProperty("disabled", true);
    fireEvent.change(primary, { target: { value: "0f766e" } });
    await applyAll();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledWith({ primary_color: "#0F766E" }));
    expect(h.profileUpdate).not.toHaveBeenCalled();
  });

  it("persists the secondary colour in the shared profile and reports a refusal", async () => {
    live(AppearanceView);
    fireEvent.change(screen.getAllByLabelText(/Secondary colour/)[0], { target: { value: "#0F766E" } });
    await applyAll();
    await waitFor(() => expect(h.profileUpdate).toHaveBeenCalledWith({ secondary_color: "#0F766E" }));
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
  });

  it("confirms before removing the light logo and names the fallback", () => {
    h.ctx.settings = { ...h.ctx.settings, dealer_logo_url: "https://files.example.test/logo.png" };
    live(AppearanceView);
    fireEvent.click(screen.getByRole("button", { name: "Remove Logo for light backgrounds" }));
    expect(screen.getByText(/documents print the dealership name/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(review()).toHaveProperty("disabled", false);
  });

  it("shows light and dark customer and document previews", () => {
    live(AppearanceView);
    expect(screen.getAllByLabelText(/Customer Passport on a (light|dark) surface/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "Document" }));
    expect(screen.getAllByLabelText(/Document on a (light|dark) surface/)).toHaveLength(2);
  });
});

describe("Hours & Contact", () => {
  it("shows the free-text hours as the saved source and writes only that key through the settings writer", async () => {
    live(HoursContactView);
    const hours = screen.getByLabelText(/Store hours/) as HTMLTextAreaElement;
    expect(hours.value).toBe("Mon to Fri 9 to 5");
    fireEvent.change(hours, { target: { value: "Mon to Sat 9 to 6" } });
    await applyAll();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledWith({ dealer_hours: "Mon to Sat 9 to 6" }));
  });

  it("blocks department contacts, weekly hours, holidays and routing override with the migration id", () => {
    live(HoursContactView);
    expect(document.querySelectorAll("[data-blocked-feature]").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Add number", hidden: true })).toHaveProperty("disabled", true);
    expect(screen.queryByLabelText("Monday open")).toBeNull();
    expect(screen.getByText(/parity is not claimed/)).toBeTruthy();
  });

  it("keeps the SMS sender separate and explains a missing sales phone even with a main phone", () => {
    live(HoursContactView);
    expect(screen.getByText(/Never copied from the public phone/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Contact readiness" })).getByText(/does not count/)).toBeTruthy();
  });

  it("rejects an incomplete ZIP", () => {
    live(HoursContactView);
    fireEvent.change(screen.getByLabelText(/^ZIP/), { target: { value: "ABC" } });
    expect(review()).toHaveProperty("disabled", true);
  });
});

describe("Why Buy", () => {
  it("shows only populated facts and an empty message otherwise", () => {
    h.ctx.settings = { ...h.ctx.settings, dealer_tagline: "" };
    live(WhyBuyView);
    expect(screen.getByText(/Nothing to show yet/)).toBeTruthy();
    expect(screen.queryByText(/years in business/)).toBeNull();
  });

  it("requires a date on a new review, then writes the flat strings the Passport reads plus the profile", async () => {
    live(WhyBuyView);
    fireEvent.click(screen.getByRole("tab", { name: /Reviews/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add review" }));
    fireEvent.change(within(screen.getByRole("list", { name: "Review sources" })).getByLabelText("Source"), { target: { value: "Fixture Guide" } });
    fireEvent.change(within(screen.getByRole("list", { name: "Review sources" })).getByLabelText(/^Rating/), { target: { value: "4.5" } });
    fireEvent.change(within(screen.getByRole("list", { name: "Review sources" })).getByLabelText("Date"), { target: { value: "" } });
    expect(review()).toHaveProperty("disabled", true);
    fireEvent.change(within(screen.getByRole("list", { name: "Review sources" })).getByLabelText("Date"), { target: { value: "2026-11-01" } });
    await applyAll();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalled());
    const patch = h.ctx.updateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.dealer_review_sources).toBe("Fixture Guide | 4.5 |");
    expect((patch.why_buy_profile as { reviews: { asOf: string }[] }).reviews[0].asOf).toBe("2026-11-01");
    expect(Object.keys(patch).sort()).toEqual(["dealer_review_sources", "why_buy_profile"]);
  });

  it("shows the off-site address only when service is off-site", () => {
    live(WhyBuyView);
    fireEvent.click(screen.getByRole("tab", { name: /Amenities/ }));
    expect(screen.queryByLabelText("Off-site service address")).toBeNull();
    fireEvent.change(screen.getByLabelText("Service department"), { target: { value: "offsite" } });
    expect(screen.getByLabelText("Off-site service address")).toBeTruthy();
  });

  it("links the mobile slide-out CTA style instead of editing it", () => {
    live(WhyBuyView);
    fireEvent.click(screen.getByRole("tab", { name: /Amenities/ }));
    expect(screen.getByRole("link", { name: /Calls to action/ })).toBeTruthy();
    expect(screen.queryByLabelText(/Slide-Out CTA Style/i)).toBeNull();
  });

  it("adds amenities as chips and projects them to the comma string", async () => {
    live(WhyBuyView);
    fireEvent.click(screen.getByRole("tab", { name: /Amenities/ }));
    const input = screen.getByLabelText("Amenities");
    fireEvent.change(input, { target: { value: "Lounge" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await applyAll();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledWith({ dealer_amenities: "Lounge" }));
  });

  it("only calls Google after the confirm dialog, saves-now wording, and reloads the settings on success", async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, rating: "4.8", count: "100", matched: "Example" }, error: null });
    live(WhyBuyView);
    fireEvent.click(screen.getByRole("tab", { name: /Reviews/ }));
    expect(h.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh from Google and save now" }));
    expect(h.invoke).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot undo it/)).toBeTruthy();
    await act(async () => { fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Refresh and save now" })); });
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.ctx.reload).toHaveBeenCalled());
    expect(screen.getByText(/Saved to your account now/)).toBeTruthy();
  });

  it("leaves a failed Google refresh unchanged", async () => {
    h.invoke.mockResolvedValue({ data: { ok: false, error: "place_not_found" }, error: null });
    live(WhyBuyView);
    fireEvent.click(screen.getByRole("tab", { name: /Reviews/ }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh from Google and save now" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Refresh and save now" })); });
    await waitFor(() => expect(screen.getByText(/could not find this dealership/)).toBeTruthy());
    expect(h.ctx.reload).not.toHaveBeenCalled();
    expect(review()).toHaveProperty("disabled", true);
  });

  it("disables Google refresh in the design fixture", () => {
    fixture(WhyBuyView, "v3-why-buy");
    fireEvent.click(screen.getByRole("tab", { name: /Reviews/ }));
    expect(screen.getByRole("button", { name: /Refresh from Google/ })).toHaveProperty("disabled", true);
  });
});

describe("refused writes and the secondary colour", () => {
  it("keeps the draft dirty after a refused write even when the context already applied it, and Discard re-reads the server", async () => {
    h.ctx.updateSettings.mockImplementation(async (p: Record<string, unknown>) => { h.ctx.settings = { ...h.ctx.settings, ...p }; return false; });
    live(IdentityView);
    fireEvent.change(screen.getByLabelText(/Public display name/), { target: { value: "Refused Name" } });
    await applyAll();
    await waitFor(() => expect(screen.getByText(/Save failed: The server did not accept the change. Nothing was saved. Your changes are kept./)).toBeTruthy());
    expect(screen.getByLabelText(/Public display name/)).toHaveProperty("value", "Refused Name");
    expect(screen.getByRole("button", { name: "Retry save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toHaveProperty("disabled", false);
    expect(h.ctx.reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(h.ctx.reload).toHaveBeenCalledTimes(1);
  });

  it("retries the refused write with the same values", async () => {
    h.ctx.updateSettings.mockImplementationOnce(async (p: Record<string, unknown>) => { h.ctx.settings = { ...h.ctx.settings, ...p }; return false; });
    live(IdentityView);
    fireEvent.change(screen.getByLabelText(/Public display name/), { target: { value: "Retry Name" } });
    await applyAll();
    await waitFor(() => screen.getByRole("button", { name: "Retry save" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry save" })); });
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledTimes(2));
    expect(h.ctx.updateSettings).toHaveBeenLastCalledWith({ dealer_name: "Retry Name" });
  });

  it("refreshes the tenant after a successful secondary colour write", async () => {
    live(AppearanceView);
    fireEvent.change(screen.getAllByLabelText(/Secondary colour/)[0], { target: { value: "#0F766E" } });
    await applyAll();
    await waitFor(() => expect(h.tenantReload).toHaveBeenCalled());
  });

  it("writes the secondary colour first and saves nothing else when it is refused", async () => {
    h.profileUpdate.mockResolvedValue({ data: [], error: null });
    live(AppearanceView);
    fireEvent.change(screen.getAllByLabelText(/Secondary colour/)[0], { target: { value: "#0F766E" } });
    fireEvent.change(screen.getAllByLabelText(/Primary colour/)[0], { target: { value: "#0F766E" } });
    await applyAll();
    await waitFor(() => expect(screen.getByText(/Save failed/)).toBeTruthy());
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
  });

  it("says plainly when only the secondary colour was saved", async () => {
    h.ctx.updateSettings.mockResolvedValue(false);
    live(AppearanceView);
    fireEvent.change(screen.getAllByLabelText(/Secondary colour/)[0], { target: { value: "#0F766E" } });
    fireEvent.change(screen.getAllByLabelText(/Primary colour/)[0], { target: { value: "#0F766E" } });
    await applyAll();
    await waitFor(() => expect(screen.getByText(/The secondary colour was saved, but the other changes were not/)).toBeTruthy());
  });

  it("makes the secondary colour read-only with a reason for roles that cannot write the shared profile", () => {
    h.auth.isAdmin = false; h.member = { role: "manager" };
    live(AppearanceView);
    expect(screen.getAllByLabelText(/Secondary colour/)[0]).toHaveProperty("disabled", true);
    expect(screen.getByText(/Only an owner or admin can change the shared dealer profile/)).toBeTruthy();
    expect(screen.getAllByLabelText(/Primary colour/)[0]).toHaveProperty("disabled", false);
  });

  it("offers an accessible alternative for a failing colour and applies it", () => {
    h.ctx.settings = { ...h.ctx.settings, primary_color: "#9FB6E6" };
    live(AppearanceView);
    const use = screen.getAllByRole("button", { name: /^Use #[0-9A-F]{6}/ })[0];
    fireEvent.click(use);
    expect(review()).toHaveProperty("disabled", false);
  });
});
