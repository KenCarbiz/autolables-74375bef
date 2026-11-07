import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";
import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import { checkUrl, conditionRows, validateWebsiteDraft } from "./websitesModel";
import { GROUPS, readStore, STORE_KEYS, validateStore, HIDDEN_KEYS } from "./storeSettingsModel";
import { buildEntries, compatibility, resolveSlot } from "./templateRegistry";
import { STUDIO_TEMPLATES } from "@/lib/stickerStudio/templates";
import { WAVE_B_FEEDS_FIXTURES } from "@/pages/admin/fixtures/WaveBFeedsFixtures";
import WebsitesFeedsView from "../WebsitesFeedsView";
import DocumentDefaultsView from "../DocumentDefaultsView";
import StoreSettingsView from "../StoreSettingsView";


const h = vi.hoisted(() => ({
  ctx: { settings: {} as Record<string, unknown>, loading: false, updateSettings: vi.fn(async (_p: Record<string, unknown>) => true), reload: vi.fn(), tenantId: "tenant-a" as string | null, loadGeneration: 1, serverLoaded: true, loadError: null as string | null, lastSaveError: null as string | null },
  invoke: vi.fn(async () => ({ data: { test: { price: 1, matched_label: "Internet Price" } }, error: null })),
  role: "owner" as string,
}));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-a", name: "Example Auto Group" }, currentStore: null, stores: [] }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: h.role } }) }));
vi.mock("@/contexts/DealerSettingsContext", async (orig) => ({ ...(await orig<typeof import("@/contexts/DealerSettingsContext")>()), useDealerSettings: () => h.ctx }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => (h.invoke as (...x: unknown[]) => unknown)(...a) }, from: () => ({ select: () => Promise.resolve({ data: null, error: { message: "x" } }), eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) } }));
vi.mock("@/components/admin/InstallerContactsCard", () => ({ default: () => <div>installers stub</div> }));
beforeEach(() => { h.ctx.settings = { ...DEFAULT_SETTINGS, vdp_price_labels: "Internet Price" }; h.ctx.updateSettings.mockClear(); h.invoke.mockClear(); h.role = "owner"; });
const live = (ui: JSX.Element) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const mount = (id: string, ui: JSX.Element, state = "") => {
  const entry = WAVE_B_FEEDS_FIXTURES[id];
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/x${state ? `?state=${state}` : ""}`]}>
        <AdminFixtureProvider fixture={entry.fixture}>{ui}</AdminFixtureProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("website models", () => {
  it("fails wrong addresses with a reason", () => {
    expect(checkUrl("ftp://x.example.com").state).toBe("invalid");
    expect(checkUrl("not a url").state).toBe("invalid");
    expect(checkUrl("https://localhost/a").state).toBe("invalid");
    const c = checkUrl("https://www.cargurus.com/x", ["cars.com"], "Cars.com");
    expect(c.state === "valid" && c.mismatch).toMatch(/CarGurus/);
  });
  it("maps condition terms by the real rule and flags unmapped", () => {
    const rows = conditionRows(["New", "Demo", "Used", "CPO", "Wholesale"]);
    expect(rows.map((r) => r.canonical)).toEqual(["new", "new", "used", "cpo", undefined]);
    expect(rows[1].note).toMatch(/Demo/);
  });
  it("rejects duplicate labels", () => {
    expect(validateWebsiteDraft({ ...DEFAULT_SETTINGS, vdp_price_labels: "A, a" }).vdp_price_labels).toBeTruthy();
  });
});

describe("store settings model", () => {
  it("keeps every legacy control and leaves auto-publish to its canonical editor", () => {
    expect(STORE_KEYS).not.toContain("ingest_auto_publish");
    const keys = GROUPS.flatMap((g) => g.items.flatMap((i) => ("key" in i ? [i.key] : [])));
    for (const k of STORE_KEYS) expect(keys).toContain(k);
    expect(GROUPS.some((g) => g.items.some((i) => i.kind === "linked"))).toBe(true);
    expect(HIDDEN_KEYS).toHaveLength(2);
  });
  it("reads defaults with the legacy rules", () => {
    const d = readStore({ ...DEFAULT_SETTINGS, price_drop_watch_enabled: undefined as never, getready_drives_addendum: undefined as never });
    expect(d.price_drop_watch_enabled).toBe(true);
    expect(d.getready_drives_addendum).toBe(false);
  });
  it("validates recipient lists", () => {
    const d = readStore({ ...DEFAULT_SETTINGS, detail_email: "a@x.com, b", service_email: "a@x.com,b@x.com,c@x.com,d@x.com" });
    expect(validateStore(d).detail_email).toMatch(/not an email/);
    expect(validateStore(d).service_email).toMatch(/at most 3/);
  });
});

describe("template registry", () => {
  const entries = buildEntries(STUDIO_TEMPLATES, [{ template_key: "addendum-value", is_active: false, current_version: 2 }]);
  it("disables incompatible and retired options with a reason", () => {
    const win = entries.find((e) => e.id === "window-modern")!;
    expect(compatibility(win, "addendum", "used").ok).toBe(false);
    expect(compatibility(entries.find((e) => e.id === "addendum-value")!, "addendum", "used").reason).toMatch(/Retired/);
    expect(compatibility(entries.find((e) => e.id === "new-car-sticker")!, "window", "used").ok).toBe(false);
  });
  it("flags a saved default missing from the registry", () => {
    expect(resolveSlot("addendum_new", { addendum_new: "studio:nope" }, entries).state).toBe("missing");
  });
});

describe("views", () => {
  it("websites: provider cards say a saved address is not a connection; read-only has no save bar", async () => {
    mount("v3-websites-feeds", <WebsitesFeedsView />, "readonly");
    expect(await screen.findByText(/not a connected account/i)).toBeTruthy();
    expect(screen.getByText(/view these settings but not change/i)).toBeTruthy();
    expect(screen.queryByText("Review changes")).toBeNull();
  });
  it("websites: the test is read-only and never runs on mount", async () => {
    mount("v3-websites-feeds", <WebsitesFeedsView />);
    expect(await screen.findByText(/Read-only\. The test stores nothing/)).toBeTruthy();
  });
  it("documents: shows registry id and version, estimator status and no save when unreadable", async () => {
    mount("v3-document-defaults", <DocumentDefaultsView />, "error");
    expect(await screen.findAllByText("Registry ID")).toBeTruthy();
    expect(screen.getByText(/Configured and on/)).toBeTruthy();
    expect(screen.getByText(/could not be read/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("store settings: groups with enabled counts and a linked auto-publish", async () => {
    mount("v3-store-settings", <StoreSettingsView />);
    expect(await screen.findByRole("button", { name: "Configure Feed automation on intake" })).toBeTruthy();
    expect(screen.getAllByText(/\d of \d on/).length).toBeGreaterThan(4);
  });
});

describe("live mode", () => {
  it("never writes or calls the crawler on mount", () => {
    live(<WebsitesFeedsView />);
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("review then apply writes only the changed keys through the settings writer", async () => {
    live(<WebsitesFeedsView />);
    fireEvent.change(screen.getByLabelText("DMS provider"), { target: { value: "Example DMS" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply changes" })); });
    expect(h.ctx.updateSettings).toHaveBeenCalledWith({ dms_provider: "Example DMS" });
  });
  it("an invalid address blocks review", () => {
    live(<WebsitesFeedsView />);
    fireEvent.change(screen.getByLabelText("New inventory page"), { target: { value: "not a url" } });
    expect((screen.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("the price test needs acknowledgement and runs only on click", async () => {
    live(<WebsitesFeedsView />);
    fireEvent.change(screen.getByLabelText("Vehicle page address"), { target: { value: "https://dealer.example/used/car" } });
    const run = screen.getByRole("button", { name: "Run test" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(run.disabled).toBe(false);
    await act(async () => { fireEvent.click(run); });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Price read/)).toBeTruthy();
  });
  it("a refused write keeps the draft and reports failure", async () => {
    h.ctx.updateSettings.mockResolvedValueOnce(false);
    live(<StoreSettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Configure Signing and printing" }));
    fireEvent.click(screen.getByRole("switch", { name: "Ink-saving mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply changes" })); });
    expect(await screen.findByText(/Save failed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry save" })).toBeTruthy();
  });
  it("document defaults write the chosen template into label_defaults", async () => {
    live(<DocumentDefaultsView />);
    fireEvent.click(screen.getAllByRole("button", { name: "Change template" })[0]);
    const radios = await screen.findAllByRole("radio", { name: /Clean Addendum Blue|Value Stack|Luxury Black Addendum/ });
    fireEvent.click(radios.find((r) => r.getAttribute("aria-disabled") !== "true")!);
    fireEvent.click(screen.getByRole("button", { name: "Use this template" }));
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply changes" })); });
    const patch = h.ctx.updateSettings.mock.calls[0][0] as { label_defaults: Record<string, string> };
    expect(Object.keys(patch)).toEqual(["label_defaults"]);
    expect(patch.label_defaults.addendum_new).toMatch(/^studio:addendum-/);
  });
  it("read-only members get a summary and no save bar", () => {
    h.role = "viewer";
    live(<StoreSettingsView />);
    expect(screen.getByText(/view these settings but not change/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  });
});
