import { describe, it, expect } from "vitest";
import { dealerGroupMayInfluence, resolveDealershipGroup, sameDealershipGroup } from "./dealerGroup.ts";
import { capability, mayInfluenceVehicleScore } from "./providerRegistry.ts";

describe("resolveDealershipGroup prefers the provider's id", () => {
  it("is authoritative on an mc_dealership_group_id", () => {
    const g = resolveDealershipGroup({
      mcDealership: { mc_dealership_group_id: "g1", mc_dealership_group_name: "Example Group", mc_sub_dealership_group_id: "s1", mc_sub_dealership_group_name: "Example North" },
      observedAt: "2026-10-27T00:00:00Z",
    });
    expect(g.mappingConfidence).toBe("authoritative_id");
    expect(g.groupId).toBe("g1");
    expect(g.subGroupName).toBe("Example North");
    expect(g.source).toBe("marketcheck_feed");
    expect(g.checkedAt).toBe("2026-10-27T00:00:00Z");
  });

  it("falls to the provider's name when there is no id, and says so", () => {
    const g = resolveDealershipGroup({ dealerGroupName: "Example Group" });
    expect(g.mappingConfidence).toBe("provider_name");
    expect(g.groupId).toBeNull();
    expect(g.groupName).toBe("Example Group");
  });

  it("uses a tenant name match only as a last resort, labelled name_match", () => {
    const g = resolveDealershipGroup({ mcDealership: { name: "Example Motors of Town" }, tenantGroupNames: ["Example Motors"] });
    expect(g.mappingConfidence).toBe("name_match");
    expect(g.source).toBe("tenant_config");
  });

  it("reports none rather than guessing", () => {
    const g = resolveDealershipGroup({ mcDealership: { name: "Somebody" }, tenantGroupNames: ["Example Motors"] });
    expect(g.mappingConfidence).toBe("none");
    expect(g.reasons).toContain("no_group_evidence");
  });
});

describe("pooling by group needs authoritative ids on both sides", () => {
  it("matches on equal ids only", () => {
    const a = resolveDealershipGroup({ mcDealership: { mc_dealership_group_id: "g1" } });
    const b = resolveDealershipGroup({ mcDealership: { mc_dealership_group_id: "g1" } });
    const c = resolveDealershipGroup({ mcDealership: { mc_dealership_group_id: "g2" } });
    const d = resolveDealershipGroup({ dealerGroupName: "g1" });
    expect(sameDealershipGroup(a, b)).toBe(true);
    expect(sameDealershipGroup(a, c)).toBe(false);
    expect(sameDealershipGroup(a, d)).toBe(false);
  });
});

describe("dealership-group intelligence cannot modify Vehicle Score", () => {
  it("is allowed only into market context, acquisition intelligence and management analytics", () => {
    expect(dealerGroupMayInfluence("market_context")).toBe(true);
    expect(dealerGroupMayInfluence("vehicle_score")).toBe(false);
    expect(dealerGroupMayInfluence("data_confidence")).toBe(false);
    expect(dealerGroupMayInfluence("deal_rating")).toBe(false);
  });

  it("every group-bearing capability in the registry is barred from the score", () => {
    for (const k of ["dealership_groups_reference", "sold_summary_dealership_groups", "dealership_directory"]) {
      expect(capability(k)?.influences.vehicleScore, k).toBe(false);
      expect(mayInfluenceVehicleScore(k), k).toBe(false);
    }
  });
});
