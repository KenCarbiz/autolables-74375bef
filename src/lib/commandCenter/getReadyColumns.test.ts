import { describe, it, expect } from "vitest";
import { columnFor, isThirdPartyItem, sumItemCosts } from "./getReadyColumns";
import type { GetReadyItem } from "@/hooks/useGetReady";

const item = (over: Partial<GetReadyItem> = {}): GetReadyItem => ({
  id: "i1",
  label: "Door edge guards",
  category: "accessory",
  assignedTo: "",
  status: "pending",
  ...over,
});

describe("columnFor", () => {
  it("routes accessories and vendor departments to the vendor column", () => {
    expect(columnFor(item())).toBe("vendor");
    expect(columnFor(item({ category: "detail", department: "vendor" }))).toBe("vendor");
  });

  it("routes inspection and service work to the service column", () => {
    expect(columnFor(item({ category: "inspection" }))).toBe("service");
    expect(columnFor(item({ category: "service" }))).toBe("service");
  });

  it("routes detail and photo work to the prep column", () => {
    expect(columnFor(item({ category: "detail" }))).toBe("prep");
    expect(columnFor(item({ category: "photo" }))).toBe("prep");
  });

  it("drops nothing: an unrouted line follows its department", () => {
    expect(columnFor(item({ category: "other" }))).toBe("prep");
    expect(columnFor(item({ category: "other", department: "service" }))).toBe("service");
  });
});

describe("isThirdPartyItem", () => {
  it("does not bill an in-house install as vendor work owing proof", () => {
    const inHouse = item({ installMethod: "internal_ro", department: "detail" });
    expect(columnFor(inHouse)).toBe("vendor");
    expect(isThirdPartyItem(inHouse)).toBe(false);
  });

  it("lets the row's own install method outrank its department", () => {
    expect(isThirdPartyItem(item({ installMethod: "internal_ro", department: "vendor" }))).toBe(false);
    expect(isThirdPartyItem(item({ installMethod: "third_party_check_request", department: "detail" }))).toBe(true);
  });

  it("treats an explicit vendor department as third party", () => {
    expect(isThirdPartyItem(item({ category: "detail", department: "vendor" }))).toBe(true);
  });

  it("treats an assigned vendor as third party when nothing else says otherwise", () => {
    expect(isThirdPartyItem(item({ vendorName: "Tint Pros" }))).toBe(true);
    expect(isThirdPartyItem(item({ vendorEmail: "shop@tintpros.test" }))).toBe(true);
  });

  it("leaves an unassigned accessory in-house", () => {
    expect(isThirdPartyItem(item())).toBe(false);
  });
});

describe("sumItemCosts", () => {
  it("is null when no line carries a cost, so nothing invents a total", () => {
    expect(sumItemCosts([item(), item()])).toBeNull();
    expect(sumItemCosts([])).toBeNull();
  });

  it("sums only real numbers", () => {
    expect(sumItemCosts([item({ cost: 120 }), item(), item({ cost: 60.5 })])).toBe(180.5);
    expect(sumItemCosts([item({ cost: Number.NaN }), item({ cost: 40 })])).toBe(40);
  });

  it("makes the rail total the sum of the column totals by construction", () => {
    const items = [
      item({ category: "service", cost: 300 }),
      item({ category: "detail", cost: 85 }),
      item({ category: "accessory", cost: 210 }),
    ];
    const perColumn = (["service", "prep", "vendor"] as const)
      .map((k) => sumItemCosts(items.filter((i) => columnFor(i) === k)) ?? 0)
      .reduce((a, b) => a + b, 0);
    expect(perColumn).toBe(sumItemCosts(items));
  });
});
