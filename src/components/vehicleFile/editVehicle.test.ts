import { describe, expect, it } from "vitest";
import { buildEditPatch, editFormFromVehicle } from "./editVehicle";

const before = { ymm: "2024 Honda CR-V", trim: "EX", mileage: 1200, condition: "used" as const };

describe("buildEditPatch", () => {
  it("returns only changed fields", () => {
    const form = { ...editFormFromVehicle(before), mileage: "1,500" };
    expect(buildEditPatch(before, form)).toEqual({ ok: true, patch: { mileage: 1500 } });
  });
  it("clears blank text fields to null", () => {
    const form = { ...editFormFromVehicle(before), trim: " " };
    expect(buildEditPatch(before, form)).toEqual({ ok: true, patch: { trim: null } });
  });
  it("rejects bad mileage and condition", () => {
    expect(buildEditPatch(before, { ...editFormFromVehicle(before), mileage: "12.5" }).ok).toBe(false);
    expect(buildEditPatch(before, { ...editFormFromVehicle(before), condition: "salvage" }).ok).toBe(false);
  });
  it("reports no change as an empty patch", () => {
    expect(buildEditPatch(before, editFormFromVehicle(before))).toEqual({ ok: true, patch: {} });
  });
});
