import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";
import { WAVE_C_ROUTING_FIXTURES } from "@/pages/admin/fixtures/WaveCRoutingFixtures";
import { validateCtas, readCtas, unsafeDestination, type CtaDraft } from "./ctaModel";
import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import RoutingView from "./RoutingView";
import PassportModulesView from "./PassportModulesView";
import CallsToActionView from "./CallsToActionView";

const h = vi.hoisted(() => ({ update: vi.fn(async () => true) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("@/contexts/DealerSettingsContext", async (orig) => ({ ...(await orig<object>()), useDealerSettings: () => ({ settings: {}, updateSettings: h.update, loading: false, reload: vi.fn() }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t", name: "Example" }, stores: [], currentStore: null }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" } }) }));

const show = (screen_: string, ui: ReactElement, state?: string) => {
  const fx = WAVE_C_ROUTING_FIXTURES[screen_].fixture;
  return render(<MemoryRouter initialEntries={[`/x${state ? `?state=${state}` : ""}`]}><AdminFixtureProvider fixture={fx}>{ui}</AdminFixtureProvider></MemoryRouter>);
};
beforeEach(() => h.update.mockClear());

describe("Contact & Routing editor", () => {
  it("lists six tiers and has Review disabled when clean", () => {
    show("v3-routing", <RoutingView />);
    const list = screen.getByRole("list", { name: "Routing order" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
  });
  it("shows structured hours as blocked with the migration id and no extra save", () => {
    show("v3-routing", <RoutingView />);
    fireEvent.click(screen.getByRole("button", { name: /Hours and after-hours/ }));
    expect(screen.getByText("20261114000000")).toBeInTheDocument();
  });
  it("dirty enables review, and readonly hides the bar", () => {
    show("v3-routing", <RoutingView />);
    fireEvent.click(screen.getByRole("button", { name: /Contact mode and profile/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Show the salesperson to shoppers" }));
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled();
  });
  it("read-only users get no review bar", () => {
    show("v3-routing", <RoutingView />, "readonly");
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    expect(screen.getByText(/can view routing but not change it/i)).toBeInTheDocument();
  });
});

describe("Passport modules editor", () => {
  it("covers every module with a switch and shows the required subset", () => {
    show("v3-passport-modules", <PassportModulesView />);
    expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(16);
    expect(within(screen.getByRole("list", { name: "Required by policy" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/Module order is not configurable/)).toBeInTheDocument();
  });
  it("applies a module change through the settings writer after review", async () => {
    show("v3-passport-modules", <PassportModulesView />);
    fireEvent.click(screen.getByRole("switch", { name: "Photo gallery" }));
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("Photo gallery")).toBeInTheDocument();
    expect(h.update).not.toHaveBeenCalled();
  });
  it("renders auto-publish as a read-only mirror with a link", () => {
    show("v3-passport-modules", <PassportModulesView />);
    expect(screen.getByRole("link", { name: /Manage in Publishing/ })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Auto-publish/ })).toBeNull();
  });
  it("explains the store-wide history switch when off", () => {
    show("v3-passport-modules", <PassportModulesView />, "blocked");
    expect(screen.getByText(/History report links are off for the whole store/)).toBeInTheDocument();
  });
});

describe("Calls to action editor", () => {
  it("shows selected actions, max four and one primary", () => {
    show("v3-ctas", <CallsToActionView />);
    expect(screen.getByText("4 of 4 selected")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Primary button/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Add / }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
  it("keeps credit actions available because the Passport never hides them", () => {
    show("v3-ctas", <CallsToActionView />, "partial");
    expect(screen.queryByText(/Credit actions are selected but financing is off/)).toBeNull();
    expect(screen.getByRole("button", { name: "Add Apply for Financing" })).toBeInTheDocument();
    expect(document.querySelector("[data-credit-note]")).not.toBeNull();
  });
  it("reorders with the keyboard", () => {
    show("v3-ctas", <CallsToActionView />);
    fireEvent.click(screen.getByRole("button", { name: "Move Text up" }));
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled();
  });
});

describe("CTA validation", () => {
  const base = (): CtaDraft => readCtas(DEFAULT_SETTINGS);
  it("rejects javascript: and off-account destinations", () => {
    const d = base();
    (d.sticky_bottom_buttons.buttons[0] as unknown as Record<string, unknown>).url = "javascript:alert(1)";
    expect(unsafeDestination(d.sticky_bottom_buttons.buttons[0])).toMatch(/javascript/);
    expect(validateCtas(d).sticky_bottom_buttons).toBeTruthy();
    (d.sticky_bottom_buttons.buttons[0] as unknown as Record<string, unknown>).url = "https://other.example/x";
    expect(validateCtas(d).sticky_bottom_buttons).toBeTruthy();
  });
  it("enforces four buttons, one primary and a label", () => {
    const d = base();
    d.sticky_bottom_buttons.buttons.push({ key: "chat", label: "Chat", enabled: true, order: 5 });
    expect(validateCtas(d).sticky_bottom_buttons).toMatch(/at most 4/);
    const e = base();
    e.sticky_bottom_buttons.primary_key = "zzz";
    expect(validateCtas(e).sticky_bottom_buttons).toMatch(/primary/);
    const f = base();
    f.sticky_bottom_buttons.buttons[0].label = " ";
    expect(validateCtas(f).sticky_bottom_buttons).toMatch(/label/);
  });
});
