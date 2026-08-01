import { describe, it, expect } from "vitest";
import {
  billingProductForUrl, newCallMeter, recordCall, estimateCost, MC_CALL_PRICE_USD,
} from "../../../supabase/functions/_shared/mcCost";

const B = "https://api.marketcheck.com/v2";

describe("billingProductForUrl", () => {
  it("bills the syndication feed separately from the dealer directory", () => {
    // Both live under /dealerships — and they differ by 400x in price, so the
    // more specific path must win.
    expect(billingProductForUrl(`${B}/dealerships/inventory?mc_rooftop_id=1`)).toBe("dealer_inventory_syndication");
    expect(billingProductForUrl(`${B}/dealerships/car?inventory_url=x`)).toBe("dealer_api");
    expect(billingProductForUrl(`${B}/dealers/car?zip=06120`)).toBe("dealer_api");
  });

  it("maps the enrichment endpoints", () => {
    expect(billingProductForUrl(`${B}/search/car/active?vin=X`)).toBe("inventory_search");
    expect(billingProductForUrl(`${B}/search/car/recents?vin=X`)).toBe("recent_inventory");
    expect(billingProductForUrl(`${B}/history/car/1FT?api_key=k`)).toBe("vin_history");
    expect(billingProductForUrl(`${B}/mds/car?ymm=x`)).toBe("market_days_supply");
    expect(billingProductForUrl(`${B}/sales/car?ymm=x`)).toBe("sales_stats");
    expect(billingProductForUrl(`${B}/predict/car/us/marketcheck_price`)).toBe("price_prediction");
    expect(billingProductForUrl(`${B}/decode/car/neovin/1FT/specs`)).toBe("neovin");
    expect(billingProductForUrl(`${B}/decode/car/1FT/specs`)).toBe("basic_vin_decode");
    expect(billingProductForUrl(`${B}/recall/car/1FT`)).toBe("auto_recalls");
  });

  it("returns unknown rather than guessing a price for a new endpoint", () => {
    expect(billingProductForUrl(`${B}/something/new`)).toBe("unknown");
    expect(MC_CALL_PRICE_USD.unknown).toBe(0);
  });
});

describe("estimateCost", () => {
  it("prices a pinned nightly rooftop pull as a single syndication call", () => {
    const meter = newCallMeter();
    recordCall(meter, `${B}/dealerships/inventory?mc_rooftop_id=1&owned=true`);
    const est = estimateCost(meter, 30);
    expect(est.totalCalls).toBe(1);
    expect(est.estimatedUsd).toBe(1);
    expect(est.projectedMonthlyUsd).toBe(30);
  });

  it("prices a 125-car lot the same as a 1400-car lot — both are one page", () => {
    // Cost tracks pages, not vehicles. This is the whole reason turnover does
    // not move the syndication line.
    const onePage = newCallMeter();
    recordCall(onePage, `${B}/dealerships/inventory?start=0`);
    expect(estimateCost(onePage).projectedMonthlyUsd).toBe(30);
  });

  it("charges a second page when the lot exceeds one page", () => {
    const meter = newCallMeter();
    recordCall(meter, `${B}/dealerships/inventory?start=0`);
    recordCall(meter, `${B}/dealerships/inventory?start=1500`);
    expect(estimateCost(meter, 30).projectedMonthlyUsd).toBe(60);
  });

  it("counts an unpinned probe night as several syndication calls", () => {
    const meter = newCallMeter();
    for (const p of ["mc_rooftop_id", "mc_location_id", "mc_website_id"]) {
      recordCall(meter, `${B}/dealerships/inventory?${p}=x`);
    }
    recordCall(meter, `${B}/dealerships/car?inventory_url=x`);
    const est = estimateCost(meter, 30);
    expect(est.estimatedUsd).toBe(3.0); // 3 syndication + a fractional directory call
    expect(est.breakdown[0].product).toBe("dealer_inventory_syndication");
  });

  it("ranks the breakdown by spend so the expensive product is obvious", () => {
    const meter = newCallMeter();
    recordCall(meter, `${B}/dealerships/inventory?start=0`);
    for (let i = 0; i < 50; i++) recordCall(meter, `${B}/search/car/active?vin=${i}`);
    const est = estimateCost(meter);
    expect(est.breakdown[0].product).toBe("dealer_inventory_syndication");
    expect(est.breakdown[0].usd).toBe(1);
    expect(est.totalCalls).toBe(51);
  });

  it("flags calls it has no list price for instead of reporting zero silently", () => {
    const meter = newCallMeter();
    recordCall(meter, `${B}/brand/new/endpoint`);
    const est = estimateCost(meter);
    expect(est.hasUnpricedCalls).toBe(true);
    expect(est.estimatedUsd).toBe(0);
  });

  it("reports an empty run as zero, not as an error", () => {
    const est = estimateCost(newCallMeter());
    expect(est.totalCalls).toBe(0);
    expect(est.estimatedUsd).toBe(0);
    expect(est.hasUnpricedCalls).toBe(false);
  });
});
