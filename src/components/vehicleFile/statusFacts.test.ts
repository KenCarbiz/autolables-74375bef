import { describe, it, expect } from "vitest";
import { deriveStatusFacts, recallFact } from "./statusFacts";

const vehicle = (over: Record<string, unknown> = {}) => ({
  status: "published" as const,
  condition: "used" as const,
  prep_status: null,
  recall_status: null,
  open_recall_count: null,
  recall_check: null,
  recall_payload: null,
  recall_checked_at: null,
  ...over,
});
const ready = { blockers: [], remaining: [] };
const tracked = (state: string | null, extra: Record<string, unknown> = {}) => ({
  tracked: true, loading: false, error: null, row: state ? ({ state } as never) : null, ...extra,
});

describe("deriveStatusFacts (F02)", () => {
  it("never says Retail ready while authorization is pending, even when published", () => {
    const f = deriveStatusFacts({ vehicle: vehicle(), ready, lifecycle: tracked("AWAITING_MANAGER_AUTHORIZATION") });
    expect(f.retail.ready).toBe(false);
    expect(f.retail.value).toBe("Not retail ready");
    expect(f.retail.detail).toBe("Authorization pending");
    expect(f.publication.value).toBe("Published");
  });

  it("never says Retail ready while an inspection is pending", () => {
    const f = deriveStatusFacts({ vehicle: vehicle(), ready, lifecycle: tracked("K208_READY_TO_CERTIFY") });
    expect(f.retail.value).toBe("Not retail ready");
    expect(f.retail.detail).toBe("Inspection pending");
    expect(f.signing.value).toBe("Inspection pending");
  });

  it("is Retail ready only when the lifecycle reached it and nothing blocks", () => {
    expect(deriveStatusFacts({ vehicle: vehicle(), ready, lifecycle: tracked("RETAIL_READY") }).retail.ready).toBe(true);
    const blocked = deriveStatusFacts({
      vehicle: vehicle(), ready: { blockers: [{ ok: false, label: "x", when: null }], remaining: [] }, lifecycle: tracked("RETAIL_READY"),
    });
    expect(blocked.retail.ready).toBe(false);
  });

  it("does not read a missing or failed lifecycle as ready", () => {
    expect(deriveStatusFacts({ vehicle: vehicle(), ready, lifecycle: tracked(null) }).retail.value).toBe("Unknown");
    expect(deriveStatusFacts({ vehicle: vehicle(), ready, lifecycle: tracked(null, { error: "boom" }) }).retail.value).toBe("Unknown");
    expect(deriveStatusFacts({ vehicle: vehicle(), ready, lifecycle: tracked(null, { loading: true }) }).retail.ready).toBe(false);
  });

  it("requires prep sign-off for untracked new stock", () => {
    const untracked = { tracked: false, loading: false, error: null, row: null };
    expect(deriveStatusFacts({ vehicle: vehicle({ condition: "new" }), ready, lifecycle: untracked }).retail.ready).toBe(false);
    const signed = vehicle({ condition: "new", prep_status: { foreman_signed_at: "2026-01-01T00:00:00Z" } });
    expect(deriveStatusFacts({ vehicle: signed, ready, lifecycle: untracked }).retail.ready).toBe(true);
  });
});

describe("recallFact (F27)", () => {
  it("reads Unknown, not cleared, when no VIN-level check answered", () => {
    const f = recallFact({ recall_status: "clear", open_recall_count: 0 } as never);
    expect(f.value).toBe("Unknown");
    expect(f.tone).toBe("neutral");
  });
});
