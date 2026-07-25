import { describe, it, expect } from "vitest";
import {
  deriveServicePriority,
  compareServicePriority,
  SERVICE_PRIORITY_LABELS,
  SERVICE_PRIORITY_CODES,
  type ServicePriorityInput,
} from "./priority";

const base: ServicePriorityInput = {
  sold: false,
  deliveryToday: false,
  blocked: false,
  failedItemsOpen: false,
  awaitingReinspection: false,
  readyForK208: false,
  inspectionStarted: false,
  overdue: false,
  assigned: true,
  ageHours: 4,
  cleared: false,
};

describe("deriveServicePriority — deterministic spec order", () => {
  it("rank 1: sold + delivery today + active blocker, code names the exact situation", () => {
    const notStarted = deriveServicePriority({ ...base, sold: true, deliveryToday: true, blocked: true });
    expect(notStarted.rank).toBe(1);
    expect(notStarted.code).toBe("DELIVERY_TODAY_INSPECTION_NOT_STARTED");
    expect(notStarted.level).toBe("High");
    const started = deriveServicePriority({ ...base, sold: true, deliveryToday: true, blocked: true, inspectionStarted: true });
    expect(started.code).toBe("DELIVERY_TODAY_DELIVERY_BLOCKED");
  });

  it("rank 2: sold with unresolved failure beats reinspection and everything below", () => {
    const p = deriveServicePriority({ ...base, sold: true, failedItemsOpen: true, awaitingReinspection: true, overdue: true });
    expect(p.rank).toBe(2);
    expect(p.code).toBe("SOLD_VEHICLE_FAILED_ITEMS_OPEN");
  });

  it("ranks 3-5: reinspection, then K-208 ready, then overdue", () => {
    expect(deriveServicePriority({ ...base, awaitingReinspection: true, readyForK208: true }).rank).toBe(3);
    expect(deriveServicePriority({ ...base, readyForK208: true, overdue: true }).rank).toBe(4);
    expect(deriveServicePriority({ ...base, overdue: true, assigned: false }).rank).toBe(5);
  });

  it("ranks 6-8: unassigned, oldest pending, newly ingested", () => {
    expect(deriveServicePriority({ ...base, assigned: false }).code).toBe("INSPECTION_UNASSIGNED");
    expect(deriveServicePriority({ ...base, ageHours: 30 }).code).toBe("OLDEST_PENDING_INSPECTION");
    expect(deriveServicePriority({ ...base, ageHours: 3 }).code).toBe("NEW_INVENTORY_PENDING_INSPECTION");
  });

  it("a cleared vehicle carries no action and sorts last", () => {
    const done = deriveServicePriority({ ...base, cleared: true, sold: true, deliveryToday: true, blocked: true });
    expect(done.code).toBe("NO_ACTION_REQUIRED");
    expect(done.rank).toBe(9);
  });

  it("every code has a plain-language label — codes are stored, words are shown", () => {
    for (const code of SERVICE_PRIORITY_CODES) {
      expect(SERVICE_PRIORITY_LABELS[code]).toBeTruthy();
      expect(SERVICE_PRIORITY_LABELS[code]).not.toMatch(/_/);
    }
  });

  it("comparator: rank first, oldest first within a rank — stable and total", () => {
    const a = { priority: deriveServicePriority({ ...base, overdue: true }), ageHours: 30 };
    const b = { priority: deriveServicePriority({ ...base, readyForK208: true }), ageHours: 2 };
    const c = { priority: deriveServicePriority({ ...base, overdue: true }), ageHours: 50 };
    expect(compareServicePriority(b, a)).toBeLessThan(0);
    expect(compareServicePriority(c, a)).toBeLessThan(0);
  });
});
