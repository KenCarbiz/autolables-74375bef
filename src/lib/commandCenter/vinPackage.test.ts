import { describe, it, expect } from "vitest";
import type { GetReadyItem } from "@/hooks/useGetReady";
import { getReadyStep } from "./getReadyColumns";
import { countExceptions, countFinished, isReadyToMarket } from "./packageState";
import { buildVinPackageItems, recallPackageState, type VinPackageSources } from "./vinPackage";
import { vehicleQrPackageState } from "./vehicleQrToken";

const grItem = (over: Partial<GetReadyItem> = {}): GetReadyItem => ({
  id: "g1", label: "Detail — interior", category: "detail",
  assignedTo: "", status: "complete", ...over,
});

// A used car where EVERY artifact the automation owns is finished. Nothing here
// is a special case: it is the ordinary end state of a car that has been
// inspected, stickered, QR'd, key-tagged, worked and published.
const finishedUsedCar = (): VinPackageSources => ({
  vehicleId: "veh-1",
  vin: "JN8AZ2NE0P9300001",
  used: true,
  dispatched: true,
  liveDocs: [
    { id: "d1", document_type: "buyers_guide", document_status: "published", version: 2, published_at: "2026-07-01T00:00:00Z" },
    { id: "d2", document_type: "window", document_status: "approved", version: 3 },
  ],
  inspection: {
    latestSigned: { id: "i1", status: "signed", result: "pass", signed_at: "2026-07-02T00:00:00Z" },
    latest: { id: "i1", status: "signed", result: "pass", signed_at: "2026-07-02T00:00:00Z" },
  },
  addendum: { id: "a1", customer_signed_at: "2026-07-03T00:00:00Z" },
  recall: { checkedAt: "2026-07-04T00:00:00Z", doNotDrive: false, openCount: 0, tasks: [] },
  // The shape issue_vehicle_ready_token writes (20260629010000:80-81). Nothing
  // here is hand-shaped to satisfy a predicate: it is what the RPC inserts.
  qrTokens: [{
    id: "dst1", department: "vehicle", purpose: "get_ready", status: "pending",
    expires_at: "2027-07-05T00:00:00Z", created_at: "2026-07-05T00:00:00Z",
  }],
  getReady: {
    record: { id: "gr1" },
    items: [grItem(), grItem({ id: "g2", category: "service" })],
  },
  description: { row: { id: "dc1", status: "PUBLISHED" }, channelCount: 6 },
});

describe("buildVinPackageItems", () => {
  it("builds the ten used-car rows the spec orders", () => {
    const items = buildVinPackageItems(finishedUsedCar());
    expect(items.map((i) => i.key)).toEqual([
      "k208", "buyers_guide", "addendum", "window_sticker", "recall",
      "service_qr", "key_tag_qr", "get_ready_service", "get_ready_prep", "description",
    ]);
  });

  it("drops the used-car-only artifacts on a new car rather than reporting them incomplete", () => {
    const items = buildVinPackageItems({ ...finishedUsedCar(), used: false });
    expect(items.map((i) => i.key)).not.toContain("k208");
    expect(items.map((i) => i.key)).not.toContain("buyers_guide");
    expect(items).toHaveLength(8);
  });

  // V1, the whole point of this file. The previous round narrowed countFinished
  // to ready|published without checking every row in the denominator could
  // REACH one of those states: Rear Service QR could only ever emit `created`,
  // so automationDone === automationTotal was IMPOSSIBLE, "Automation Complete"
  // could never hit 100%, and "Ready to Market" was a dead branch for every
  // vehicle in the dealership.
  it("a fully finished vehicle counts 100% finished and IS Ready to Market", () => {
    const s = finishedUsedCar();
    const items = buildVinPackageItems(s);
    const unfinished = items.filter((i) => i.status !== "ready" && i.status !== "published");
    expect(unfinished.map((i) => `${i.key}=${i.status}`)).toEqual([]);
    expect(countFinished(items)).toBe(items.length);
    expect(countExceptions(items)).toBe(0);
    expect(isReadyToMarket({
      items,
      getReadyStep: getReadyStep({ dispatched: s.dispatched, items: s.getReady.items }),
    })).toBe(true);
  });

  it("the same holds for a fully finished new car", () => {
    const s: VinPackageSources = { ...finishedUsedCar(), used: false };
    const items = buildVinPackageItems(s);
    expect(countFinished(items)).toBe(items.length);
    expect(isReadyToMarket({
      items,
      getReadyStep: getReadyStep({ dispatched: s.dispatched, items: s.getReady.items }),
    })).toBe(true);
  });

  it("every row in the denominator has a reachable finished state", () => {
    // Each key must be finished in the all-finished fixture. A key that cannot
    // appear there is a row that can never be counted done.
    const items = buildVinPackageItems(finishedUsedCar());
    for (const i of items) {
      expect([i.key, i.status === "ready" || i.status === "published"]).toEqual([i.key, true]);
    }
  });

  it("is not ready to market while one artifact is only produced", () => {
    const s = finishedUsedCar();
    s.liveDocs = [...s.liveDocs.filter((d) => d.document_type !== "window"),
      { id: "d2", document_type: "window", document_status: "draft", version: 3 }];
    const items = buildVinPackageItems(s);
    expect(countFinished(items)).toBeLessThan(items.length);
    expect(isReadyToMarket({ items, getReadyStep: 4 })).toBe(false);
  });
});

describe("vehicleQrPackageState", () => {
  const live = {
    id: "dst1", department: "vehicle", purpose: "get_ready", status: "pending",
    expires_at: "2027-07-05T00:00:00Z", created_at: "2026-07-05T00:00:00Z",
  };

  it("a live token is the whole finished artifact — there is no publish step", () => {
    expect(vehicleQrPackageState([live], "Rear-glass cling").status).toBe("ready");
  });

  it("an expired token is an exception the manager can clear by reprinting", () => {
    expect(vehicleQrPackageState([{ ...live, expires_at: "2020-01-01T00:00:00Z" }], "Key-fob tag"))
      .toEqual({ status: "retry_required", detail: "Service code expired — reprint the QR sheet to re-issue it" });
  });

  it("no token at all is not started", () => {
    expect(vehicleQrPackageState([], "Rear-glass cling").status).toBe("pending");
  });
});

describe("recallPackageState", () => {
  const base = { checkedAt: "2026-07-04T00:00:00Z", doNotDrive: false, openCount: 1 };

  // V2, the most dangerous single defect. 20260627070000:56-63 blocks publish
  // while ANY recall_service_task is `open_review`, and 20260627060000:126-135
  // raises a NEW task when the campaign signature changes — so a task resolved
  // in May coexisting with a new open July task is NORMAL. Reading "some task is
  // resolved" rendered "Ready · Resolved by service" with no date, dropped the
  // vehicle out of both the exception count and the blocking panel, and left the
  // manager staring at a publish the database refuses.
  it("an open review blocks even when an earlier campaign was resolved", () => {
    const state = recallPackageState({
      ...base,
      tasks: [
        { status: "open_review", open_recall_count: 2, completed_at: null },
        { status: "resolved", open_recall_count: 1, completed_at: "2026-05-02T00:00:00Z" },
      ],
    });
    expect(state.status).toBe("retry_required");
    expect(state.detail).toMatch(/service review required/);
  });

  it("is ready, with the RESOLVED task's own date, once nothing is open", () => {
    const state = recallPackageState({
      ...base,
      tasks: [{ status: "resolved", open_recall_count: 1, completed_at: "2026-05-02T00:00:00Z" }],
    });
    expect(state.status).toBe("ready");
    expect(state.detail).toMatch(/Resolved by service \w/);
  });

  it("still asks for review when there are open recalls and no task row at all", () => {
    expect(recallPackageState({ ...base, tasks: [] }).status).toBe("retry_required");
  });

  it("blocks outright on a do-not-drive campaign", () => {
    expect(recallPackageState({ ...base, doNotDrive: true, tasks: [] }).status).toBe("blocked");
  });

  it("is not started until a check has been run", () => {
    expect(recallPackageState({ ...base, checkedAt: null, tasks: [] }).status).toBe("pending");
  });

  it("is finished when the check found nothing", () => {
    expect(recallPackageState({ ...base, openCount: 0, tasks: [] }).status).toBe("ready");
  });
});
