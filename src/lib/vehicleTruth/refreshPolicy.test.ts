import { describe, it, expect } from "vitest";
import {
  countByStickerStatus,
  isDueForTruthRefresh,
  parseTruthRefreshMode,
  selectTruthRefreshWorklist,
  TRUTH_REFRESH_MIN_AGE_MS,
  type TruthRefreshCandidate,
} from "./refreshPolicy";

const NOW = Date.parse("2026-09-09T07:30:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

// The five sticker states factory-sticker-orchestrate's SWEEP_NEVER_RERUN_STATUSES
// excludes from regeneration. None of them may exclude a vehicle from truth.
const SETTLED_STICKER_STATUSES = [
  "PUBLISHED", "APPROVED", "SUPERSEDED", "ARCHIVED", "FAILED_PERMANENT",
];

const candidate = (over: Partial<TruthRefreshCandidate> = {}): TruthRefreshCandidate => ({
  vehicleId: "v1",
  tenantId: "t1",
  listingStatus: "published",
  stickerStatus: "PUBLISHED",
  lastResolvedAt: daysAgo(30),
  hasSnapshot: true,
  ...over,
});

describe("a published sticker does not prevent a truth refresh", () => {
  it("treats every settled sticker state as due when its truth is stale", () => {
    for (const stickerStatus of SETTLED_STICKER_STATUSES) {
      expect(isDueForTruthRefresh(candidate({ stickerStatus }), { mode: "due", now: NOW }))
        .toBe(true);
    }
  });

  it("selects the same worklist whatever the sticker states are", () => {
    const rows = SETTLED_STICKER_STATUSES.map((stickerStatus, i) =>
      candidate({ vehicleId: `v${i}`, stickerStatus, lastResolvedAt: daysAgo(30 - i) }));
    const withoutStickers = rows.map(({ stickerStatus: _drop, ...rest }) => rest);

    const a = selectTruthRefreshWorklist(rows, { mode: "due", now: NOW }).map((r) => r.vehicleId);
    const b = selectTruthRefreshWorklist(withoutStickers, { mode: "due", now: NOW }).map((r) => r.vehicleId);
    expect(a).toEqual(b);
    expect(a).toHaveLength(SETTLED_STICKER_STATUSES.length);
  });

  it("refreshes a vehicle whose sticker is PUBLISHED and whose facts were never written", () => {
    const never = candidate({ stickerStatus: "PUBLISHED", lastResolvedAt: null, hasSnapshot: false });
    for (const mode of ["only_missing", "due", "all"] as const) {
      expect(isDueForTruthRefresh(never, { mode, now: NOW })).toBe(true);
    }
  });
});

describe("refresh eligibility", () => {
  it("never resolves an archived listing", () => {
    expect(isDueForTruthRefresh(
      candidate({ listingStatus: "archived", lastResolvedAt: null }), { mode: "all", now: NOW },
    )).toBe(false);
  });

  it("skips a vehicle resolved inside the minimum age, so a night's passes do not repeat work", () => {
    const fresh = candidate({ lastResolvedAt: new Date(NOW - 60_000).toISOString() });
    expect(isDueForTruthRefresh(fresh, { mode: "due", now: NOW })).toBe(false);
    expect(isDueForTruthRefresh(fresh, { mode: "all", now: NOW })).toBe(true);
  });

  it("uses a minimum age below 24h so a nightly cadence never skips a night", () => {
    const lastNight = candidate({ lastResolvedAt: new Date(NOW - 23 * 3_600_000).toISOString() });
    expect(TRUTH_REFRESH_MIN_AGE_MS).toBeLessThan(24 * 3_600_000);
    expect(isDueForTruthRefresh(lastNight, { mode: "due", now: NOW })).toBe(true);
  });

  it("only_missing keeps its old meaning: never-resolved vehicles only", () => {
    expect(isDueForTruthRefresh(candidate({ lastResolvedAt: daysAgo(60) }), { mode: "only_missing", now: NOW }))
      .toBe(false);
    expect(isDueForTruthRefresh(
      candidate({ lastResolvedAt: null, hasSnapshot: false }), { mode: "only_missing", now: NOW },
    )).toBe(true);
  });

  it("counts an unparseable resolution time as unknown, not as recent", () => {
    expect(isDueForTruthRefresh(candidate({ lastResolvedAt: "not-a-date" }), { mode: "due", now: NOW }))
      .toBe(true);
  });

  it("requires a tenant", () => {
    expect(isDueForTruthRefresh(candidate({ tenantId: null }), { mode: "all", now: NOW })).toBe(false);
  });
});

describe("worklist ordering makes the sweep resumable", () => {
  const rows: TruthRefreshCandidate[] = [
    candidate({ vehicleId: "recent", lastResolvedAt: daysAgo(8) }),
    candidate({ vehicleId: "never", lastResolvedAt: null, hasSnapshot: false }),
    candidate({ vehicleId: "oldest", lastResolvedAt: daysAgo(40) }),
    candidate({ vehicleId: "middle", lastResolvedAt: daysAgo(20) }),
  ];

  it("puts never-resolved first, then oldest truth first", () => {
    expect(selectTruthRefreshWorklist(rows, { mode: "due", now: NOW }).map((r) => r.vehicleId))
      .toEqual(["never", "oldest", "middle", "recent"]);
  });

  it("a budget-limited pass leaves the rest at the head of the next pass", () => {
    const firstPass = selectTruthRefreshWorklist(rows, { mode: "due", now: NOW, limit: 2 });
    expect(firstPass.map((r) => r.vehicleId)).toEqual(["never", "oldest"]);

    const after = rows.map((r) =>
      firstPass.some((p) => p.vehicleId === r.vehicleId)
        ? { ...r, lastResolvedAt: new Date(NOW).toISOString(), hasSnapshot: true }
        : r);
    expect(selectTruthRefreshWorklist(after, { mode: "due", now: NOW, limit: 2 }).map((r) => r.vehicleId))
      .toEqual(["middle", "recent"]);
  });

  it("is stable for vehicles resolved at the same instant", () => {
    const same = [
      candidate({ vehicleId: "b", lastResolvedAt: daysAgo(9) }),
      candidate({ vehicleId: "a", lastResolvedAt: daysAgo(9) }),
    ];
    expect(selectTruthRefreshWorklist(same, { mode: "due", now: NOW }).map((r) => r.vehicleId))
      .toEqual(["a", "b"]);
  });
});

describe("reporting", () => {
  it("parses the mode, defaulting rather than throwing", () => {
    expect(parseTruthRefreshMode("due")).toBe("due");
    expect(parseTruthRefreshMode(" ALL ")).toBe("all");
    expect(parseTruthRefreshMode(undefined, "only_missing")).toBe("only_missing");
    expect(parseTruthRefreshMode("nonsense", "only_missing")).toBe("only_missing");
  });

  it("reports which sticker states were refreshed", () => {
    expect(countByStickerStatus([
      candidate({ stickerStatus: "PUBLISHED" }),
      candidate({ stickerStatus: "PUBLISHED" }),
      candidate({ stickerStatus: "ARCHIVED" }),
      candidate({ stickerStatus: null }),
    ])).toEqual({ PUBLISHED: 2, ARCHIVED: 1, NO_RECORD: 1 });
  });
});
