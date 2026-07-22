import { describe, it, expect } from "vitest";
import {
  K208_INSPECTION_CATEGORIES,
  K208_INSPECTION_RESULTS,
  K208_CERTIFICATION_TEXT,
} from "./ctK208Form";

// ──────────────────────────────────────────────────────────────
// K-208 official-form structural guard.
//
// The CT K-208 is a state compliance document. Its 19 inspection items must
// never be renamed, reordered, combined, or removed, and the A/B/C result
// classifications carry exact statutory meaning. This test pins that structure
// so an accidental edit to the form data fails the build — the data-model
// equivalent of the locked-master PDF guard. Change these only on a deliberate,
// re-verified update to the State form.
// ──────────────────────────────────────────────────────────────

const OFFICIAL_ITEMS: [string, string][] = [
  ["service_brakes", "Service Brakes"],
  ["parking_brake", "Parking Brake"],
  ["tires_wheels", "Tires / Wheels"],
  ["steering_system", "Steering System"],
  ["suspension", "Suspension"],
  ["frame_chassis", "Frame / Chassis"],
  ["exhaust", "Exhaust"],
  ["fuel_system", "Fuel System"],
  ["headlights", "Headlights"],
  ["stop_turn_lights", "Stop / Turn Lights"],
  ["misc_lights", "Misc. Lights"],
  ["wipers_washer", "Wipers / Washer"],
  ["windshield_tint", "Windshield, Tint"],
  ["horn", "Horn"],
  ["vin_verified", "VIN Verified"],
  ["mirrors", "Mirrors"],
  ["seat_belts", "Seat Belts"],
  ["air_bags", "Air Bags"],
  ["emissions", "Emissions"],
];

describe("CT K-208 official form structure", () => {
  const items = K208_INSPECTION_CATEGORIES.flatMap((c) => c.items);

  it("has exactly the 19 official inspection items, in order, unrenamed", () => {
    expect(items.length).toBe(19);
    expect(items.map((i) => [i.id, i.label])).toEqual(OFFICIAL_ITEMS);
  });

  it("keeps all items under the single official Safety Inspection section", () => {
    expect(K208_INSPECTION_CATEGORIES.length).toBe(1);
    expect(K208_INSPECTION_CATEGORIES[0].category).toBe("Safety Inspection");
  });

  it("has the A/B/C inspection results with their statutory meaning", () => {
    expect(K208_INSPECTION_RESULTS.map((r) => r.code)).toEqual(["A", "B", "C"]);
    expect(K208_INSPECTION_RESULTS[1].label).toMatch(/AS IS.*42-224/);
    expect(K208_INSPECTION_RESULTS[2].label).toMatch(/NOT in condition/);
  });

  it("keeps the penalty-of-false-statement licensee certification language", () => {
    expect(K208_CERTIFICATION_TEXT).toMatch(/penalty of false statement/i);
    expect(K208_CERTIFICATION_TEXT).toMatch(/14-110/);
  });
});
