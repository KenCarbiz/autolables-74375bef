import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The parity fixture page only. The screen bodies are stubbed: these tests
// are about the frame drawn around them, not the Admin views.
vi.mock("@/components/admin/v2/AdminShell", () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <div data-testid="admin-body">{children}</div>,
}));
vi.mock("@/pages/admin/views", () => ({ ADMIN_VIEWS: {} }));
vi.mock("@/pages/admin/childRoutes", () => ({ ADMIN_CHILD_ROUTE_ELEMENTS: [] }));
vi.mock("@/pages/admin/fixtures", () => ({
  ADMIN_FIXTURES: { "01": { tabId: "overview", fixture: { views: {}, now: 0, label: "test" } } },
}));

import AdminDesignFixture from "./AdminDesignFixture";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  if (!g.ResizeObserver) g.ResizeObserver = RO;
});

const open = (query: string) =>
  render(
    <MemoryRouter initialEntries={[`/admin/design-fixture/01${query}`]}>
      <Routes>
        <Route path="/admin/design-fixture/:screen" element={<AdminDesignFixture />} />
      </Routes>
    </MemoryRouter>,
  );

describe("AdminDesignFixture", () => {
  it("renders the accepted stand-ins, unchanged, without ?chrome=1", () => {
    const { container } = open("?rail=243");
    const root = container.querySelector("[data-admin-fixture='01']") as HTMLElement;
    expect(root.className).toBe("min-h-screen bg-adm-workspace flex");
    const [rail, column] = Array.from(root.children) as HTMLElement[];
    expect(root.children).toHaveLength(2);
    expect(rail.className).toBe("hidden lg:block flex-shrink-0 bg-adm-sidebar");
    expect(rail.style.width).toBe("243px");
    expect(rail).toHaveAttribute("aria-hidden", "true");
    expect(column.className).toBe("flex-1 min-w-0");
    const [bar, body] = Array.from(column.children) as HTMLElement[];
    expect(bar.className).toBe("h-16 border-b border-adm-border bg-adm-surface");
    expect(body).toBe(screen.getByTestId("admin-body"));
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("draws the real rail at the requested mock width with ?chrome=1&rail=", () => {
    const { container } = open("?chrome=1&rail=243");
    const rail = container.querySelector("aside") as HTMLElement;
    expect(rail.style.width).toBe("243px");
    expect(within(rail).getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "Administration" })).toHaveAttribute("aria-current", "page");
    // Same content column, under a 64px bar, as the stand-in layout.
    const column = screen.getByTestId("admin-body").parentElement as HTMLElement;
    expect(column.className).toBe("flex-1 min-w-0");
    expect(screen.getByRole("banner").className).toMatch(/\bh-16\b/);
  });

  it("keeps the product rail at 229px by default", () => {
    const { container } = open("?chrome=1");
    expect((container.querySelector("aside") as HTMLElement).style.width).toBe("229px");
  });

  it("opens a labelled fixture note from every header control, so nothing looks live that is not", async () => {
    open("?chrome=1");
    const bar = screen.getByRole("banner");
    for (const name of [/switch rooftop/i, /Notifications/, /Account menu/]) {
      fireEvent.click(within(bar).getByRole("button", { name }));
      const note = await screen.findByRole("dialog");
      expect(note).toHaveTextContent("Design fixture");
      fireEvent.keyDown(note, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    fireEvent.click(within(bar).getAllByRole("button", { name: /Search vehicles, customers/ })[0]);
    expect(await screen.findByRole("dialog", { name: "Design fixture" })).toBeInTheDocument();
  });

  it("opens the drawer from the menu button below lg", () => {
    open("?chrome=1");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("dialog", { name: "Main menu" })).toBeInTheDocument();
  });
});
