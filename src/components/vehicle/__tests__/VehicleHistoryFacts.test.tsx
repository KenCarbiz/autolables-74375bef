import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import VehicleHistoryFacts from "../VehicleHistoryFacts";
import { historyFactBadges } from "@/components/listing/TrustStrip";

// carfax_1_owner and carfax_clean_title are claims about a real car's history.
// The rule the whole product depends on is that only an exact `true` may speak
// -- and, since the flags are resolved through the precedence engine, only a
// `true` from a source with standing to say it.
const mc = (attrs: Record<string, unknown> | null | undefined) =>
  attrs === null ? null : attrs === undefined ? undefined : { mc_attributes: attrs };
describe("historyFactBadges", () => {
  it("returns both facts when both flags are exactly true", () => {
    expect(historyFactBadges(mc({ carfax_1_owner: true, carfax_clean_title: true })).map((f) => f.key))
      .toEqual(["one-owner", "clean-title"]);
  });

  it("says nothing for false, null, absent, or a truthy non-boolean", () => {
    for (const attrs of [
      {},
      { carfax_1_owner: false, carfax_clean_title: false },
      { carfax_1_owner: null, carfax_clean_title: null },
      { carfax_1_owner: undefined, carfax_clean_title: undefined },
      { carfax_1_owner: "true", carfax_clean_title: "true" },
      { carfax_1_owner: 1, carfax_clean_title: 1 },
      null,
      undefined,
    ]) {
      expect(historyFactBadges(mc(attrs as Record<string, unknown> | null))).toEqual([]);
    }
  });

  it("never infers a fact from a clean title brand, condition or recall status", () => {
    expect(historyFactBadges({
      mc_attributes: {
        title_brand: "Clean", recall_status: "clear", owner_count: 1,
        carfax_clean_title: null, carfax_1_owner: null,
      },
      condition: "cpo",
    })).toEqual([]);
  });

  it("shows each fact independently of the other", () => {
    expect(historyFactBadges(mc({ carfax_1_owner: true })).map((f) => f.key)).toEqual(["one-owner"]);
    expect(historyFactBadges(mc({ carfax_clean_title: true })).map((f) => f.key)).toEqual(["clean-title"]);
  });
});

// The reason the engine is in this path at all. AutoLabels writes the vehicle
// descriptions that appear on dealer websites; a detector reading one back and
// tagging it "the dealer's page said so" is us citing ourselves.
describe("historyFactBadges provenance", () => {
  it("renders a feed flag at full confidence", () => {
    const [badge] = historyFactBadges(mc({ carfax_1_owner: true }))!;
    expect(badge.confidence).toBe("HIGH");
    expect(badge.attribution).toBeNull();
  });

  it("renders a badge read off the dealer's page, but not as verified", () => {
    const [badge] = historyFactBadges(mc({ carfax_1_owner: true, one_owner_source: "dealer_vdp" }))!;
    expect(badge.confidence).toBe("MEDIUM");
    expect(badge.attribution).toBe("Per dealer listing");
    // The visible copy is unchanged: the passport is owner-approved and locked.
    expect(badge.sub).toBe("Single previous owner");
  });

  it("renders NOTHING for a claim traced back to generated copy", () => {
    expect(historyFactBadges(mc({
      carfax_clean_title: true, clean_title_source: "autolabels_description",
    }))).toEqual([]);
    expect(historyFactBadges(mc({
      carfax_clean_title: true, clean_title_source: "description",
    }))).toEqual([]);
  });

  it("treats provenance nobody recognises as untrusted, not as structured", () => {
    // Unknown must fall to the floor, not to a structured default. Defaulting
    // unknown provenance to "trustworthy" is exactly how the description ended
    // up in the clean-title flag.
    expect(historyFactBadges(mc({
      carfax_clean_title: true, clean_title_source: "some_new_scraper",
    }))).toEqual([]);
  });

  it("lets the provider overrule a badge scraped off the page", () => {
    // MarketCheck says no; the dealer's page shows the badge anyway. The
    // provider outranks the page, and no badge renders.
    expect(historyFactBadges(mc({
      carfax_1_owner: false, one_owner_source: "marketcheck",
    }))).toEqual([]);
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
