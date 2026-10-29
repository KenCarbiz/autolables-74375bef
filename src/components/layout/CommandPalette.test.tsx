import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paletteSearchScope, searchPrompt } from "./searchScope";

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ useViewTransitionNavigate: () => nav.navigate }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));
vi.mock("@/contexts/VinScanContext", () => ({ useVinScan: () => ({ openScan: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false, signOut: async () => {} }) }));
const who = vi.hoisted(() => ({ role: "salesperson" }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: who.role } }) }));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "t1", name: "Test Motors" }, currentStore: { id: "s1", name: "Test Motors North" } }),
}));
const db = vi.hoisted(() => ({ tables: [] as string[], leads: [] as Array<Record<string, unknown>> }));
vi.mock("@/integrations/supabase/client", () => {
  const make = (table: string) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: table === "leads" ? db.leads : [], error: null }),
    });
    return chain;
  };
  return { supabase: { from: (t: string) => { db.tables.push(t); return make(t); }, functions: { invoke: async () => ({ data: null }) } } };
});

import CommandPalette, { useCommandPalette } from "./CommandPalette";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  if (!g.ResizeObserver) g.ResizeObserver = RO;
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
});

beforeEach(() => {
  who.role = "salesperson";
  db.tables = [];
  db.leads = [];
  nav.navigate.mockClear();
});

// Wired the way AppShell wires it.
const Frame = () => {
  const { open, setOpen, restoreFocus } = useCommandPalette();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open search</button>
      <a href="#elsewhere">Content link</a>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <CommandPalette open={open} onOpenChange={setOpen} onCloseAutoFocus={(e) => { if (restoreFocus()) e.preventDefault(); }} />
    </>
  );
};

describe("useCommandPalette", () => {
  it("opens and closes on Cmd+K and Ctrl+K", () => {
    render(<Frame />);
    const state = screen.getByTestId("state");
    act(() => { fireEvent.keyDown(window, { key: "k", metaKey: true }); });
    expect(state).toHaveTextContent("open");
    act(() => { fireEvent.keyDown(window, { key: "K", ctrlKey: true }); });
    expect(state).toHaveTextContent("closed");
    act(() => { fireEvent.keyDown(window, { key: "k" }); });
    expect(state).toHaveTextContent("closed");
  });
});

describe("CommandPalette dialog", () => {
  it("has an accessible name and returns focus to the control that opened it", async () => {
    render(<Frame />);
    const opener = screen.getByRole("button", { name: "Open search" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Search AutoLabels" });
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus after Cmd+K from a content link", async () => {
    render(<Frame />);
    const link = screen.getByRole("link", { name: "Content link" });
    link.focus();
    act(() => { fireEvent.keyDown(window, { key: "k", metaKey: true }); });
    const dialog = await screen.findByRole("dialog", { name: "Search AutoLabels" });
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(link);
  });

  it("finds customers for a role that can view them and opens the customer record", async () => {
    db.leads = [{ id: "l1", name: "Dana Buyer", email: "Dana@Example.test", phone: null, vehicle_vin: null, vehicle_interest: "2021 Example Sedan" }];
    render(<Frame />);
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    const dialog = await screen.findByRole("dialog", { name: "Search AutoLabels" });
    const input = within(dialog).getByRole("combobox");
    expect(input).toHaveAttribute("placeholder", "Search vehicles, customers, pages, settings…");
    fireEvent.change(input, { target: { value: "dana" } });
    const hit = await within(dialog).findByRole("option", { name: /Dana Buyer/ }, { timeout: 2000 });
    expect(db.tables).toContain("leads");
    fireEvent.click(hit);
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith(`/customers/${encodeURIComponent("e:dana@example.test")}`));
  });

  it("runs no customer or vehicle lookup for a role that holds neither", async () => {
    who.role = "service_advisor";
    render(<Frame />);
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    const dialog = await screen.findByRole("dialog", { name: "Search AutoLabels" });
    const input = within(dialog).getByRole("combobox");
    expect(input).toHaveAttribute("placeholder", "Search commands…");
    fireEvent.change(input, { target: { value: "dana" } });
    await new Promise((r) => setTimeout(r, 350));
    expect(db.tables).toEqual([]);
  });

  it("shows no keyboard shortcut it does not handle", () => {
    // "N" was printed beside Add Vehicle with no handler anywhere.
    const source = readFileSync(join(__dirname, "CommandPalette.tsx"), "utf8");
    expect(source).not.toMatch(/CommandShortcut/);
  });
});

describe("paletteSearchScope and the header's words", () => {
  const base = { isAdmin: false, hasMember: true, tenantId: "t1", storeId: "s1" };
  it("names vehicles and customers only where the palette searches them", () => {
    expect(searchPrompt(paletteSearchScope({ ...base, role: "owner" }))).toBe("Search vehicles, customers, or anything");
    expect(searchPrompt(paletteSearchScope({ ...base, role: "readonly" }))).toBe("Search vehicles or anything");
    expect(searchPrompt(paletteSearchScope({ ...base, role: "biller" }))).toBe("Search commands");
    expect(searchPrompt(paletteSearchScope({ ...base, role: "service_advisor" }))).toBe("Search commands");
    expect(searchPrompt(paletteSearchScope({ ...base, role: "third_party_vendor" }))).toBe("Search commands");
    expect(searchPrompt(paletteSearchScope({ ...base, role: "detail" }))).toBe("Search commands");
  });
  it("needs a real tenant, and a rooftop for customers", () => {
    expect(paletteSearchScope({ ...base, role: "owner", tenantId: null })).toEqual({ vehicles: false, customers: false });
    expect(paletteSearchScope({ ...base, role: "owner", storeId: null })).toEqual({ vehicles: true, customers: false });
  });
  it("keeps vendors out of customer search even with platform authority", () => {
    expect(paletteSearchScope({ ...base, role: "third_party_vendor", isAdmin: true }).customers).toBe(false);
  });
});
