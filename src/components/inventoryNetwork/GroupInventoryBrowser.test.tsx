import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { GroupInventoryBrowser } from "./GroupInventoryBrowser";
import type { GroupInventoryData, GroupInventoryVehicle } from "@/lib/inventoryNetwork/api";

const home = { id: "s1", name: "Harte Hyundai of Old Saybrook", city: "Old Saybrook", state: "CT" };
const other = { id: "s2", name: "Harte Genesis of Hartford", city: "Hartford", state: "CT" };

const vehicle = (over: Partial<GroupInventoryVehicle> & Pick<GroupInventoryVehicle, "id">): GroupInventoryVehicle => ({
  rank: 1, inventory_group: "home", owning_store: home, vin: "1HGCM82633A004352", stock_number: null, condition: "used", certified: false,
  year: 2022, make: "Hyundai", model: "Tucson", trim: "SEL", mileage: 20000, exterior_color: "Blue", interior_color: null, price: 25000, price_status: "known",
  photo: null, photo_count: 0, enrichment_status: "not_requested", ...over,
});

const data: GroupInventoryData = {
  enabled: true, home_store: home, additional_sources: [{ ...other, priority: 100 }], total: 3,
  vehicles: [
    vehicle({ id: "v-extra", rank: 1, inventory_group: "additional", owning_store: other, model: "G80", make: "Genesis", price: null, price_status: "hidden" }),
    vehicle({ id: "v-home-2", rank: 2, model: "Elantra", price: null, price_status: "unknown" }),
    vehicle({ id: "v-home-1", rank: 1, model: "Tucson" }),
  ],
};

describe("GroupInventoryBrowser", () => {
  it("lists the home store first and the other locations under their own heading", () => {
    render(<GroupInventoryBrowser data={data} salesperson={{ id: "a1", name: "Dana Reed" }} />);
    const cards = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(cards[0]).toContain("Tucson");
    expect(cards[1]).toContain("Elantra");
    expect(cards[2]).toContain("G80");
    expect(screen.getByRole("heading", { name: "Additional group inventory" })).toBeInTheDocument();
  });

  it("names the actual location of each vehicle", () => {
    render(<GroupInventoryBrowser data={data} salesperson={null} />);
    expect(screen.getByText("At Harte Genesis of Hartford, Hartford CT")).toBeInTheDocument();
    expect(screen.getAllByText("At Harte Hyundai of Old Saybrook, Old Saybrook CT")).toHaveLength(2);
  });

  it("shows a price only when one exists and never shows zero", () => {
    render(<GroupInventoryBrowser data={data} salesperson={null} />);
    expect(screen.getAllByText("Price on request")).toHaveLength(2);
    expect(screen.getByText("$25,000")).toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("sends every contact to the originating salesperson and never links to another dealership", () => {
    const onContact = vi.fn();
    const { container } = render(<GroupInventoryBrowser data={data} salesperson={{ id: "a1", name: "Dana Reed" }} onContact={onContact} />);
    const buttons = screen.getAllByRole("button", { name: "Ask Dana Reed" });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[2]);
    expect(onContact).toHaveBeenCalledWith("v-extra");
    expect(container.querySelector("a")).toBeNull();
  });

  it("filters with the chips", () => {
    render(<GroupInventoryBrowser data={data} salesperson={null} />);
    const chips = screen.getByRole("group", { name: "Filter inventory" });
    fireEvent.click(within(chips).getByRole("button", { name: /Additional/ }));
    expect(screen.queryByText("Tucson", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText("Genesis G80", { exact: false })).toBeInTheDocument();
    fireEvent.click(within(chips).getByRole("button", { name: /Harte Hyundai of Old Saybrook/ }));
    expect(screen.queryByRole("heading", { name: "Additional group inventory" })).not.toBeInTheDocument();
  });

  it("explains a store that is not available", () => {
    render(<GroupInventoryBrowser data={{ enabled: false, reason: "home_store_unavailable" }} salesperson={null} />);
    expect(screen.getByText("Inventory is not available here")).toBeInTheDocument();
  });
});
