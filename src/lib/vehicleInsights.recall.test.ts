import { describe, expect, it } from "vitest";
import { vehicleInsights } from "./vehicleInsights";
import type { VehicleListing } from "@/hooks/useVehicleListing";

const listing = (over: Record<string, unknown>): VehicleListing =>
  ({ vin: "5N1AL1F83VC332076", condition: "used", ...over } as unknown as VehicleListing);

const hasNoRecalls = (l: VehicleListing) => vehicleInsights(l).some((i) => i.id === "no-recalls");

// "No open recalls" is one of the most load-bearing things a salesperson says
// about a used car, and it reaches AutoFilm and the Passport as a strength
// badge. It used to come from `open_recall_count === 0`, which is a MODEL-level
// NHTSA number and is zero on every vehicle whose lookup never answered.
describe("the no-open-recalls talking point", () => {
  it("is withheld when nothing has answered", () => {
    expect(hasNoRecalls(listing({ open_recall_count: null }))).toBe(false);
    expect(hasNoRecalls(listing({ open_recall_count: 0 }))).toBe(false);
  });

  it("is withheld on an unanswered NHTSA lookup that left a zero behind", () => {
    expect(hasNoRecalls(listing({
      recall_status: null,
      open_recall_count: 0,
      recall_payload: { source: "nhtsa", note: "no_nhtsa_record_http_400", checked_at: new Date().toISOString() },
    }))).toBe(false);
  });

  it("is withheld on a legitimate model-level zero", () => {
    expect(hasNoRecalls(listing({
      recall_status: "clear",
      open_recall_count: 0,
      recall_payload: {
        source: "nhtsa", checked_at: new Date().toISOString(),
        model_in_catalog: true, open_recall_count: 0,
      },
    }))).toBe(false);
  });

  it("is made only from a VIN-level check that answered", () => {
    const insights = vehicleInsights(listing({
      recall_status: "clear",
      open_recall_count: 0,
      recall_payload: {
        source: "marketcheck", scope: "vin", open_recall_count: 0,
        checked_at: new Date().toISOString(), campaigns: [],
      },
    }));
    const badge = insights.find((i) => i.id === "no-recalls");
    expect(badge).toBeDefined();
    expect(badge?.detail).toMatch(/VIN-level recall check/);
  });

  it("is withheld once the VIN answer has aged out", () => {
    expect(hasNoRecalls(listing({
      recall_status: "clear",
      open_recall_count: 0,
      recall_payload: {
        source: "marketcheck", scope: "vin", open_recall_count: 0,
        checked_at: "2026-01-01T00:00:00Z", campaigns: [],
      },
    }))).toBe(false);
  });
});
