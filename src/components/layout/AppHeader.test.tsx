import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { AppHeader, MOCK_SEARCH_LABEL } from "./AppHeader";

const base = {
  groupName: "Example Auto Group",
  storeLocation: "Springfield, MA",
  storeName: "Example Motors North",
  onOpenSearch: () => {},
  notificationCount: 0,
  userName: "Pat Example",
  userInitials: "PE",
};

describe("AppHeader", () => {
  it("draws no bell and no account button when no menu is supplied for them", () => {
    render(<AppHeader {...base} />);
    const bar = screen.getByRole("banner");
    expect(within(bar).queryByRole("button", { name: /Notifications/ })).toBeNull();
    expect(within(bar).queryByRole("button", { name: /Account menu/ })).toBeNull();
  });

  it("draws each control inside the slot that gives it behaviour", () => {
    const slot = vi.fn((trigger) => <span data-testid="slot">{trigger}</span>);
    render(<AppHeader {...base} notificationCount={7} renderNotifications={slot} renderUserMenu={slot} renderRooftopMenu={slot} />);
    expect(slot).toHaveBeenCalledTimes(3);
    for (const wrapped of screen.getAllByTestId("slot")) expect(wrapped.querySelector("button")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Notifications (7 unread)" })).toBeInTheDocument();
  });

  it("draws a single rooftop as static text with no chevrons", () => {
    render(<AppHeader {...base} />);
    const rooftop = screen.getByTitle("Example Auto Group, Springfield, MA | Example Motors North");
    expect(rooftop.tagName).toBe("DIV");
    expect(rooftop.querySelectorAll("svg")).toHaveLength(0);
  });

  it("draws no rooftop at all when there is nothing true to name", () => {
    render(<AppHeader {...base} groupName="" storeLocation="" storeName="" />);
    expect(screen.queryByTitle(/./)).toBeNull();
    expect(screen.queryByText(/Select store/)).toBeNull();
  });

  it("opens search from both the box and the phone button, with the platform's shortcut", () => {
    const onOpenSearch = vi.fn();
    const { unmount } = render(<AppHeader {...base} onOpenSearch={onOpenSearch} isMac />);
    const [box, phone] = screen.getAllByRole("button", { name: MOCK_SEARCH_LABEL });
    expect(box).toHaveAttribute("aria-keyshortcuts", "Meta+K");
    expect(within(box).getByText("⌘")).toBeInTheDocument();
    fireEvent.click(box);
    fireEvent.click(phone);
    expect(onOpenSearch).toHaveBeenCalledTimes(2);
    unmount();
    render(<AppHeader {...base} isMac={false} searchLabel="Search commands" />);
    const [other] = screen.getAllByRole("button", { name: "Search commands" });
    expect(other).toHaveAttribute("aria-keyshortcuts", "Control+K");
    expect(within(other).getByText("Ctrl")).toBeInTheDocument();
  });

  it("gives the menu button a ref for focus return and states the drawer it controls", () => {
    const ref = { current: null as HTMLButtonElement | null };
    const onOpenMenu = vi.fn();
    render(<AppHeader {...base} onOpenMenu={onOpenMenu} menuOpen={false} menuControls="app-rail" menuButtonRef={ref} />);
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute("aria-controls", "app-rail");
    fireEvent.click(button);
    expect(onOpenMenu).toHaveBeenCalled();
  });

  it("sizes phone controls to a 44px target and keeps the mock's sizes from lg", () => {
    render(<AppHeader {...base} onOpenMenu={() => {}} renderNotifications={(t) => t} renderUserMenu={(t) => t} />);
    expect(screen.getByRole("button", { name: "Open menu" }).className).toMatch(/\bh-11 w-11\b/);
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(bell.className).toMatch(/\bh-11 w-11\b/);
    expect(bell.className).toMatch(/\blg:h-10 lg:w-10\b/);
    expect(screen.getByRole("button", { name: /Account menu/ }).className).toMatch(/\bmin-h-11\b/);
  });
});
