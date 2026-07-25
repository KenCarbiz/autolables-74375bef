import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GetReadyItem } from "./useGetReady";

// deriveGetReadyDispatch is the WRITER half of vendor identity: what the shop
// and each vendor actually receive. The round-3 pass moved the reader
// (Vendor Assignments, "Pending Proof") onto isThirdPartyItem and left this on
// `department === "vendor"`, so a vendor the screen displayed with a live
// Contact button was never emailed while the authorization was still recorded —
// and authorization is one-shot, so the send could never be retried.

let items: GetReadyItem[] = [];
let vinFilter: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: (col: string, values: string[]) => { if (col === "vin") vinFilter = values; return chain; },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: { items }, error: null }),
      };
      return chain;
    },
  },
}));

const item = (over: Partial<GetReadyItem> = {}): GetReadyItem => ({
  id: "i1",
  label: "Install: Window tint",
  category: "accessory",
  assignedTo: "",
  status: "pending",
  ...over,
});

const derive = async () => {
  const { deriveGetReadyDispatch } = await import("./useGetReady");
  return deriveGetReadyDispatch("tenant-1", "1hgcv1f3xra000000");
};

beforeEach(() => { items = []; vinFilter = []; });

// W2: every command-surface read keys on vinKeys(vin) — BOTH spellings, because
// dms-webhook (:245) and autocurb-sync (:205) store the provider's VIN verbatim
// in vehicle_listings and InventoryModern's "Send to Get-Ready" (:95) passed
// that string straight through, while StartGetReadyModal and
// create_draft_get_ready uppercase. This side keyed on .eq(vin.toUpperCase()),
// so on a lowercase record the screen showed three populated columns while the
// dispatch matched no row, fell back to ["detail","service"] with no vendors,
// dropped every vendor email — and still returned a green success toast that
// could never be retried.
describe("deriveGetReadyDispatch VIN key", () => {
  it("asks for the same spellings the screen read", async () => {
    items = [item({ vendorName: "Tint Pros", vendorEmail: "shop@tintpros.test" })];
    await derive();
    expect(vinFilter).toContain("1hgcv1f3xra000000");
    expect(vinFilter).toContain("1HGCV1F3XRA000000");
  });

  it("finds the vendors on a record stored with the provider's own casing", async () => {
    items = [item({ vendorEmail: "shop@tintpros.test", department: "vendor" })];
    const { vendors } = await derive();
    expect(vendors.map((v) => v.email)).toEqual(["shop@tintpros.test"]);
  });
});

describe("deriveGetReadyDispatch vendors", () => {
  it("emails a vendor-assigned accessory that carries no explicit department", async () => {
    items = [item({ vendorName: "Tint Pros", vendorEmail: "shop@tintpros.test" })];
    const { vendors } = await derive();
    expect(vendors).toEqual([{ name: "Tint Pros", email: "shop@tintpros.test" }]);
  });

  it("still emails an explicit vendor department", async () => {
    items = [item({ category: "detail", department: "vendor", vendorName: "Glass Co", vendorEmail: "a@glass.test" })];
    const { vendors } = await derive();
    expect(vendors.map((v) => v.email)).toEqual(["a@glass.test"]);
  });

  it("does not email in-house work, even under a vendor department", async () => {
    items = [item({ department: "vendor", installMethod: "internal_ro", vendorName: "Us", vendorEmail: "shop@dealer.test" })];
    const { vendors } = await derive();
    expect(vendors).toEqual([]);
  });

  it("does not email a completed line or a vendor with no address", async () => {
    items = [
      item({ id: "a", status: "complete", vendorName: "Done Co", vendorEmail: "done@x.test" }),
      item({ id: "b", vendorName: "No Email Co" }),
    ];
    const { vendors } = await derive();
    expect(vendors).toEqual([]);
  });

  it("sends one work order per address", async () => {
    items = [
      item({ id: "a", vendorName: "Tint Pros", vendorEmail: "shop@tintpros.test" }),
      item({ id: "b", vendorName: "Tint Pros", vendorEmail: "shop@tintpros.test" }),
    ];
    const { vendors } = await derive();
    expect(vendors).toHaveLength(1);
  });
});
