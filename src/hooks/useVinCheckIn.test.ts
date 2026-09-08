import { describe, it, expect } from "vitest";
import { denialMessage, checkInDept, checkInHref, type CheckInVehicle } from "./useVinCheckIn";

const vehicle = (over: Partial<CheckInVehicle> = {}): CheckInVehicle => ({
  mode: "staff",
  vin: "1HGCM82633A004352",
  ymm: "2019 Honda Accord",
  stockNumber: "H1234",
  tenantId: "t1",
  tenantName: "Harte Infiniti",
  role: "detail",
  vehicleListingId: "v1",
  readyToken: "tok",
  installToken: null,
  assignments: [],
  ...over,
});

describe("check-in denials name the thing the person can act on", () => {
  it("separates a VIN the store does not have from work that is not yours", () => {
    const missing = denialMessage({
      reason: "vehicle_not_found",
      vin: "1HGCM82633A004352",
      tenant_name: "Harte Infiniti",
    });
    expect(missing).toContain("1HGCM82633A004352");
    expect(missing).toContain("Harte Infiniti");

    const unassigned = denialMessage({
      reason: "not_assigned",
      tenant_name: "Harte Infiniti",
      email: "vendor@proshield.example",
    });
    expect(unassigned).toContain("has this vehicle");
    expect(unassigned).toContain("vendor@proshield.example");
    expect(unassigned).not.toEqual(missing);
  });

  it("names the role when the role is the reason", () => {
    const out = denialMessage({ reason: "role_not_permitted", role: "salesperson", tenant_name: "Harte Infiniti" });
    expect(out).toContain("Salesperson");
  });

  it("never falls through to a bare error for a reason it knows", () => {
    const generic = denialMessage({ reason: "unknown_to_this_build" });
    for (const reason of [
      "not_authenticated",
      "invalid_vin",
      "no_membership",
      "vehicle_not_found",
      "not_assigned",
      "role_not_permitted",
    ]) {
      expect(denialMessage({ reason })).not.toEqual(generic);
    }
  });
});

describe("where a resolved VIN lands each role", () => {
  it("scopes the get-ready hub to the department the person works in", () => {
    expect(checkInDept("detail")).toBe("detail");
    expect(checkInDept("service_advisor")).toBe("service");
    expect(checkInDept("service_manager")).toBe("service");
    expect(checkInDept("technician")).toBe("service");
    // A manager gets the unscoped hub rather than a wrong department.
    expect(checkInDept("general_manager")).toBeNull();
  });

  it("reuses the existing token route so the printed labels and a scan agree", () => {
    expect(checkInHref(vehicle())).toBe("/ready/tok?dept=detail");
    expect(checkInHref(vehicle({ role: "owner" }))).toBe("/ready/tok");
  });

  it("offers no sign-off surface to a vendor, who never receives a hub token", () => {
    expect(checkInHref(vehicle({ mode: "vendor", role: "third_party_vendor", readyToken: null }))).toBeNull();
  });
});
