import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GetReadyItem } from "./useGetReady";

// deriveGetReadyDispatch is the WRITER half of vendor identity: what the shop
// and each vendor actually receive. The round-3 pass moved the reader
// (Vendor Assignments, "Pending Proof") onto isThirdPartyItem and left this on
// `department === "vendor"`, so a vendor the screen displayed with a live
// Contact button was never emailed while the authorization was still recorded —
// and authorization is one-shot, so the send could never be retried.

let items: GetReadyItem[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
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

beforeEach(() => { items = []; });

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
