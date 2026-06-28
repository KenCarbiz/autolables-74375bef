import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Mock the load query chain: from(...).select(...).eq(...).order(...) is awaited.
const { order } = vi.hoisted(() => ({ order: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order }) }) }) },
}));

import { usePrepSignOff, type PrepSignOff, type InstalledAccessory } from "./usePrepSignOff";

const acc = (over: Partial<InstalledAccessory> = {}): InstalledAccessory => ({
  product_id: "p1", product_name: "Window Tint", installed_date: "2026-06-20",
  installed_by: "tech", photo_urls: [], ...over,
});

const signOff = (over: Partial<PrepSignOff>): PrepSignOff => ({
  id: "id", store_id: "store1", vin: "VIN", stock_number: null, ymm: null,
  get_ready_record_id: null, accessories_installed: [], inspection_passed: true,
  inspection_form_type: null, install_photos: [], foreman_name: "Foreman",
  foreman_signature_data: null, foreman_ip: null, signed_at: null, status: "pending",
  rejection_reason: null, listing_unlocked: false, notes: null, created_by: null,
  created_at: "2026-06-01", updated_at: "2026-06-01", ...over,
});

const RECORDS: PrepSignOff[] = [
  signOff({ id: "a", vin: "AAA", status: "signed", listing_unlocked: true, accessories_installed: [acc()] }),
  signOff({ id: "b", vin: "BBB", status: "pending", listing_unlocked: false }),
  signOff({ id: "c", vin: "CCC", status: "rejected", listing_unlocked: false, rejection_reason: "Failed brakes" }),
  signOff({ id: "d", vin: "DDD", status: "signed", listing_unlocked: true,
    accessories_installed: [acc(), acc({ product_name: "Mud Flaps", installed_date: "" })] }),
];

const mountLoaded = async () => {
  order.mockResolvedValue({ data: RECORDS });
  const { result } = renderHook(() => usePrepSignOff("store1"));
  await waitFor(() => expect(result.current.signOffs).toHaveLength(RECORDS.length));
  return result;
};

beforeEach(() => order.mockReset());

describe("usePrepSignOff — load + derived state", () => {
  it("loads sign-offs and derives pending / ready buckets", async () => {
    const r = await mountLoaded();
    expect(r.current.pending.map((s) => s.vin)).toEqual(["BBB"]);
    expect(r.current.ready.map((s) => s.vin).sort()).toEqual(["AAA", "DDD"]);
    expect(r.current.getByVin("AAA")?.id).toBe("a");
    expect(r.current.getByVin("NOPE")).toBeNull();
  });
});

describe("usePrepSignOff.isListingAllowed — the compliance gate", () => {
  it("blocks a VIN with no sign-off on file", async () => {
    const r = await mountLoaded();
    const g = r.current.isListingAllowed("ZZZ");
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/No prep sign-off/i);
  });

  it("blocks an unsigned (pending) sign-off awaiting the foreman", async () => {
    const r = await mountLoaded();
    const g = r.current.isListingAllowed("BBB");
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/Awaiting shop foreman/i);
  });

  it("blocks a rejected sign-off and surfaces the reason", async () => {
    const r = await mountLoaded();
    const g = r.current.isListingAllowed("CCC");
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/rejected: Failed brakes/i);
  });

  it("blocks when an accessory is unlocked but not yet installed", async () => {
    const r = await mountLoaded();
    const g = r.current.isListingAllowed("DDD");
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/not yet installed: Mud Flaps/);
  });

  it("allows a fully prepped, installed, and signed-off VIN", async () => {
    const r = await mountLoaded();
    const g = r.current.isListingAllowed("AAA");
    expect(g.allowed).toBe(true);
    expect(g.reason).toMatch(/signed off/i);
  });
});
