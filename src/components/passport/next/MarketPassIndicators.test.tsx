import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PassportNextLayout from "./PassportNextLayout";
import MarketPassIndicators from "./MarketPassIndicators";
import SegmentedArcGauge, { arcSegmentPath, litSegment } from "./SegmentedArcGauge";
import { previewMarketPassContract } from "@/lib/passport/marketPassPreview";
import { asPublicMarketPass } from "@/hooks/useMarketPassAssessment";
import { buildMarketPassAssessment } from "@/lib/intelligence/marketPass/assessment";
import { toDealerContract } from "@/lib/intelligence/marketPass/publicContract";
import { GAUGE_COLORS, USED_PRICE_FAIRNESS_SEGMENTS, type MarketPassPublicContract } from "@/lib/intelligence/marketPass/contracts";
import { NOW, settings, usedRow } from "@/lib/intelligence/marketPass/__fixtures__/rows";

const gaugeFor = (title: string) => document.querySelector(`figure[data-gauge="${title}"]`) as HTMLElement;

function expectGaugeMatches(title: string, ind: MarketPassPublicContract["priceFairness"] | MarketPassPublicContract["vehicleConfidence"]) {
  const fig = gaugeFor(title);
  expect(fig, title).not.toBeNull();
  expect(within(fig).getByRole("img").getAttribute("aria-label")).toBe(ind.ariaLabel);
  expect(fig.querySelector("[data-gauge-label]")!.textContent).toBe(ind.label);
  expect(fig.getAttribute("data-state")).toBe(ind.state);
  expect(fig.getAttribute("data-segment-index")).toBe(ind.segmentIndex == null ? "" : String(ind.segmentIndex));
  const paths = fig.querySelectorAll("path");
  expect(paths.length).toBe(ind.segments.length);
  paths.forEach((p, i) => {
    const lit = i === ind.segmentIndex;
    expect(p.getAttribute("data-lit")).toBe(lit ? "true" : "false");
    expect(p.getAttribute("stroke")).toBe(lit ? ind.segments[i].color : "#E5E7EB");
  });
}

describe("the /v-next gauges render the public contract and nothing else", () => {
  for (const scenario of [null, "new2026", "review", "sparse"]) {
    it(`labels, aria text and lit segment equal the contract (scenario ${scenario ?? "used"})`, () => {
      const contract = previewMarketPassContract(scenario);
      render(<PassportNextLayout marketPass={{ contract, synthetic: true }} />);
      expectGaugeMatches("Price Fairness", contract.priceFairness);
      expectGaugeMatches("Vehicle Confidence", contract.vehicleConfidence);
      expect(screen.getByText("Synthetic preview data")).toBeInTheDocument();
    });
  }

  it("the review scenario is adverse on Vehicle Confidence while its price is still rated", () => {
    const c = previewMarketPassContract("review");
    expect(c.vehicleConfidence.state).toBe("adverse");
    expect(c.vehicleConfidence.segmentIndex).toBe(0);
    expect(c.priceFairness.state).toBe("assessed");
  });

  it("renders nothing new when no contract is passed (flag off)", () => {
    render(<PassportNextLayout />);
    expect(screen.queryByText("MarketPass")).toBeNull();
    expect(document.querySelector("[data-gauge]")).toBeNull();
  });

  it("a live contract carries no synthetic badge", () => {
    render(<MarketPassIndicators contract={previewMarketPassContract(null)} />);
    expect(document.querySelector("[data-synthetic]")).toBeNull();
  });
});

describe("the gauge never shows a rating it was not given", () => {
  const base = { label: "Limited vehicle evidence", explanation: "x", ariaLabel: "Vehicle Confidence: Limited vehicle evidence, not rated. x", segments: USED_PRICE_FAIRNESS_SEGMENTS };

  it("qualified and unavailable light no segment and carry no green, even if a segment index slips through", () => {
    for (const state of ["qualified", "unavailable"] as const) {
      const { container, unmount } = render(<SegmentedArcGauge title="T" indicator={{ ...base, state, segmentIndex: 4 }} />);
      expect(container.querySelector('[data-lit="true"]')).toBeNull();
      const html = container.innerHTML;
      for (const green of [GAUGE_COLORS[3], GAUGE_COLORS[4]]) expect(html).not.toContain(green);
      expect(container.querySelector("[data-gauge-label]")!.getAttribute("style")).toContain("rgb(107, 114, 128)");
      unmount();
    }
  });

  it("lights only an in-range segment for a rated state", () => {
    const segs = USED_PRICE_FAIRNESS_SEGMENTS;
    expect(litSegment({ state: "assessed", segmentIndex: 4, segments: segs })).toBe(4);
    expect(litSegment({ state: "assessed", segmentIndex: 5, segments: segs })).toBeNull();
    expect(litSegment({ state: "adverse", segmentIndex: 0, segments: segs })).toBe(0);
    expect(litSegment({ state: "qualified", segmentIndex: 2, segments: segs })).toBeNull();
  });

  it("draws the arc left to right with the least favorable segment first", () => {
    // Centre (60,58), radius 46. Segment 0 of 5 starts at 180 deg: x = 60 - 46 = 14, y = 58.
    // It ends at 180 - 36 + 2 = 146 deg: x = 60 + 46cos(146) = 21.86, y = 58 - 46sin(146) = 32.28.
    expect(arcSegmentPath(0, 5)).toBe("M 14 58 A 46 46 0 0 1 21.86 32.28");
    // The last segment ends at 0 deg: x = 60 + 46 = 106, y = 58.
    expect(arcSegmentPath(4, 5).endsWith("106 58")).toBe(true);
  });
});

describe("the page accepts only a public contract", () => {
  it("rejects a dealer contract and junk", () => {
    const dealer = toDealerContract(buildMarketPassAssessment({ row: usedRow(), settings: settings(), nowMs: NOW }));
    expect(asPublicMarketPass(dealer)).toBeNull();
    expect(asPublicMarketPass({ error: "marketpass_disabled" })).toBeNull();
    expect(asPublicMarketPass(null)).toBeNull();
    expect(asPublicMarketPass(previewMarketPassContract(null))).not.toBeNull();
  });
});
