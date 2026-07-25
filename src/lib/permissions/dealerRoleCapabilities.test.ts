import { describe, it, expect } from "vitest";
import {
  dealerRoleCapabilityMap,
  getDealerCapabilities,
  hasDealerCapability,
  dealerRoleHome,
  type DealerCapability,
} from "./dealerRoleCapabilities";

const ALL_ROLES = Object.keys(dealerRoleCapabilityMap);

const holders = (cap: DealerCapability) =>
  ALL_ROLES.filter((r) => hasDealerCapability(r, cap)).sort();

describe("service-desk capabilities (S7)", () => {
  it("can_execute_k208 is granted to NO role — not even owner or platform admin", () => {
    expect(holders("can_execute_k208")).toEqual([]);
    expect(getDealerCapabilities("owner", true)).not.toContain("can_execute_k208");
  });

  it("can_conduct_inspection: admin tier + service roles + detail (the technician mapping)", () => {
    expect(holders("can_conduct_inspection")).toEqual(
      ["owner", "general_manager", "gsm", "admin", "manager", "service_manager", "service_advisor", "detail"].sort(),
    );
  });

  it("can_assign_service_work: admin tier + service writer/manager", () => {
    expect(holders("can_assign_service_work")).toEqual(
      ["owner", "general_manager", "gsm", "admin", "manager", "service_manager", "service_advisor"].sort(),
    );
  });

  it("can_approve_service_work: the managers who decide additional work", () => {
    expect(holders("can_approve_service_work")).toEqual(
      ["owner", "general_manager", "gsm", "admin", "manager", "sales_manager", "used_car_manager", "service_manager"].sort(),
    );
  });

  it("can_void_inspection: admin tier + service manager only", () => {
    expect(holders("can_void_inspection")).toEqual(
      ["owner", "general_manager", "gsm", "admin", "manager", "service_manager"].sort(),
    );
  });

  it("can_manage_service_settings: admin tier + service manager only", () => {
    expect(holders("can_manage_service_settings")).toEqual(
      ["owner", "general_manager", "gsm", "admin", "manager", "service_manager"].sort(),
    );
  });

  it("technicians and vendors never approve work, void, or change settings", () => {
    for (const role of ["service_advisor", "detail", "third_party_vendor", "salesperson", "readonly"]) {
      expect(hasDealerCapability(role, "can_approve_service_work")).toBe(false);
      expect(hasDealerCapability(role, "can_void_inspection")).toBe(false);
      expect(hasDealerCapability(role, "can_manage_service_settings")).toBe(false);
    }
  });
});

describe("existing capability surface is untouched (additive only)", () => {
  it("gsm still has everything but billing", () => {
    expect(hasDealerCapability("gsm", "can_manage_billing")).toBe(false);
    expect(hasDealerCapability("gsm", "can_manage_settings")).toBe(true);
  });

  it("legacy aliases and the safe default still resolve", () => {
    expect(getDealerCapabilities("staff")).toEqual(getDealerCapabilities("salesperson"));
    expect(getDealerCapabilities("unknown_role")).toEqual([
      "can_view_dashboard", "can_view_inventory", "can_view_work_queue",
    ]);
  });

  it("role homes are unchanged", () => {
    expect(dealerRoleHome("service_manager")).toBe("/ready-board");
    expect(dealerRoleHome("service_advisor")).toBe("/service");
    expect(dealerRoleHome("third_party_vendor")).toBe("/queue");
  });

  it("service_advisor keeps its original base capabilities", () => {
    for (const cap of ["can_view_dashboard", "can_view_work_queue", "can_view_get_ready", "can_complete_get_ready", "can_upload_service_proof"] as DealerCapability[]) {
      expect(hasDealerCapability("service_advisor", cap)).toBe(true);
    }
  });
});
