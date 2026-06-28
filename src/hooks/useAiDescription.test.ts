import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

import { useAiDescription } from "./useAiDescription";

const NEW_CAR = {
  year: "2024", make: "Honda", model: "Accord", trim: "Sport", color: "Blue",
  condition: "New", mileage: "12", engine: "2.0L", transmission: "CVT", driveType: "FWD",
};

const gen = async (vehicle: Parameters<ReturnType<typeof useAiDescription>["generate"]>[0]) => {
  const { result } = renderHook(() => useAiDescription());
  let out = "";
  await act(async () => { out = await result.current.generate(vehicle); });
  expect(result.current.generating).toBe(false);
  return { out, result };
};

beforeEach(() => invoke.mockReset());

describe("useAiDescription.generate — edge function path", () => {
  it("returns the AI description on success", async () => {
    invoke.mockResolvedValue({ data: { success: true, description: "A pristine machine." }, error: null });
    const { out, result } = await gen(NEW_CAR);
    expect(out).toBe("A pristine machine.");
    expect(result.current.error).toBeNull();
  });
});

describe("useAiDescription.generate — graceful template fallback", () => {
  it("falls back to a template when the function errors (no error surfaced)", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "no key" } });
    const { out, result } = await gen(NEW_CAR);
    expect(out).toContain("Brand new 2024 Honda Accord Sport in Blue");
    expect(result.current.error).toBeNull(); // fallback is graceful, not an error
  });

  it("falls back when the function reports success:false", async () => {
    invoke.mockResolvedValue({ data: { success: false, error: "quota" }, error: null });
    const { out } = await gen(NEW_CAR);
    expect(out).toContain("Brand new");
  });

  it("falls back when the call throws", async () => {
    invoke.mockImplementationOnce(async () => { throw new Error("network"); });
    const { out } = await gen(NEW_CAR);
    expect(out).toContain("Brand new");
  });
});

describe("template wording branches (via fallback)", () => {
  const fail = () => invoke.mockResolvedValue({ data: null, error: { message: "x" } });

  it("renders a new car with color, mileage, specs, and a CTA", async () => {
    fail();
    const { out } = await gen(NEW_CAR);
    expect(out).toContain("Brand new 2024 Honda Accord Sport in Blue");
    expect(out).toContain("Only 12 miles");
    expect(out).toContain("Equipped with 2.0L, CVT, FWD");
    expect(out).toMatch(/Contact us today/);
  });

  it("labels a CPO vehicle as Certified Pre-Owned", async () => {
    fail();
    const { out } = await gen({ year: "2022", make: "Honda", model: "Civic", condition: "cpo" });
    expect(out).toContain("Certified Pre-Owned 2022 Honda Civic");
  });

  it("labels any other condition as Pre-owned", async () => {
    fail();
    const { out } = await gen({ year: "2021", make: "Toyota", model: "Camry", condition: "Used" });
    expect(out).toContain("Pre-owned 2021 Toyota Camry");
  });

  it("omits mileage when it is zero or absent", async () => {
    fail();
    const { out } = await gen({ year: "2024", make: "Honda", model: "Accord", condition: "New", mileage: "0" });
    expect(out).not.toMatch(/miles/);
  });

  it("formats large mileage with separators", async () => {
    fail();
    const { out } = await gen({ year: "2019", make: "Ford", model: "F-150", condition: "Used", mileage: "84500" });
    expect(out).toContain("Only 84,500 miles");
  });
});
