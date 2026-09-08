import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import VehicleHistoryFacts from "../VehicleHistoryFacts";
import { historyFactBadges } from "@/components/listing/TrustStrip";

// carfax_1_owner and carfax_clean_title are claims about a real car's history.
// The rule the whole product depends on is that only an exact `true` may speak.
describe("historyFactBadges", () => {
  it("returns both facts when both flags are exactly true", () => {
    expect(historyFactBadges({ carfax_1_owner: true, carfax_clean_title: true }).map((f) => f.key))
      .toEqual(["one-owner", "clean-title"]);
  });

  it("says nothing for false, null, absent, or a truthy non-boolean", () => {
    for (const mc of [
      {},
      { carfax_1_owner: false, carfax_clean_title: false },
      { carfax_1_owner: null, carfax_clean_title: null },
      { carfax_1_owner: undefined, carfax_clean_title: undefined },
      { carfax_1_owner: "true", carfax_clean_title: "true" },
      { carfax_1_owner: 1, carfax_clean_title: 1 },
      null,
      undefined,
    ]) {
      expect(historyFactBadges(mc as Record<string, unknown> | null)).toEqual([]);
    }
  });

  it("never infers a fact from a clean title brand, condition or recall status", () => {
    expect(historyFactBadges({
      title_brand: "Clean", condition: "cpo", recall_status: "clear", owner_count: 1,
      carfax_clean_title: null, carfax_1_owner: null,
    })).toEqual([]);
  });

  it("shows each fact independently of the other", () => {
    expect(historyFactBadges({ carfax_1_owner: true }).map((f) => f.key)).toEqual(["one-owner"]);
    expect(historyFactBadges({ carfax_clean_title: true }).map((f) => f.key)).toEqual(["clean-title"]);
  });
});

describe("VehicleHistoryFacts", () => {
  it("renders nothing at all when neither flag is true", () => {
    // The live shape today: MarketCheck supplies no clean-title value at all.
    const { container } = render(
      <VehicleHistoryFacts vehicle={{ mc_attributes: { carfax_1_owner: null, carfax_clean_title: null } }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the 1-owner badge on today's real data shape", () => {
    render(<VehicleHistoryFacts vehicle={{ mc_attributes: { carfax_1_owner: true, carfax_clean_title: null } }} />);
    expect(screen.getByText("1-Owner Vehicle")).toBeTruthy();
    expect(screen.getByText("Single previous owner")).toBeTruthy();
    expect(screen.queryByText("Clean Title")).toBeNull();
  });

  it("renders the clean-title badge the moment the flag turns true", () => {
    render(<VehicleHistoryFacts vehicle={{ mc_attributes: { carfax_1_owner: null, carfax_clean_title: true } }} />);
    expect(screen.getByText("Clean Title")).toBeTruthy();
    expect(screen.getByText("No salvage, flood, or lemon")).toBeTruthy();
    expect(screen.queryByText("1-Owner Vehicle")).toBeNull();
  });

  it("links the badge group to the stored history report when there is one", () => {
    const url = "https://www.carfax.com/vehiclehistory/ar20/abc123";
    const { container } = render(
      <VehicleHistoryFacts vehicle={{ mc_attributes: { carfax_1_owner: true }, history_report_url: url }} />,
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(url);
    expect(screen.getByText("View history report")).toBeTruthy();
  });

  it("still shows the badge but invents no link when there is no report", () => {
    for (const url of [null, undefined, "", "   ", "not-a-url"]) {
      const { container } = render(
        <VehicleHistoryFacts vehicle={{ mc_attributes: { carfax_1_owner: true }, history_report_url: url }} />,
      );
      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent).toContain("1-Owner Vehicle");
    }
  });
});
