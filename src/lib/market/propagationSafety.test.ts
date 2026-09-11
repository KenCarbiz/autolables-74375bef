// ── Propagation cannot run away, spend, or cross a tenant ──────────────────

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildCohortKey } from "./cohort.ts";
import {
  planImpactedInventory, MAX_PLAN_PER_INVOCATION, MAX_PROPAGATION_DEPTH,
  NIGHTLY_CYCLE_HOURS, NEVER_PROPAGATED_FIELDS,
} from "./propagation.ts";
import { buildMarketSnapshot, decideMarketChange, vehicleValuationFingerprint } from "./marketSnapshot.ts";
import { MAX_SHADOW_COHORT } from "./shadowPipeline.ts";
import { MARKET_ENGINE_VERSION } from "./types.ts";

const TENANT = "t-a";
const COHORT = {
  year: 2023, make: "INFINITI", model: "QX60", trim: "LUXE", drivetrain: "AWD",
  powertrain: "3.5L V6", bodyType: "SUV", condition: "cpo", certified: true,
  equipment: ["Premium Package"], zip: "06120", radiusMiles: 100,
};
const cohortKey = buildCohortKey(COHORT);
const vin = (n: number) => `5N1DL1FS0PC${String(900000 + n)}`;

const inventoryOf = (count: number, over: Record<string, unknown> = {}) =>
  Array.from({ length: count }, (_, i) => ({
    vin: vin(i), tenantId: TENANT, cohortKey,
    lastValuationFingerprint: null as string | null,
    nextValuationFingerprint: `fp-${i}`,
    lastEvaluatedAt: null as string | null,
    ...over,
  }));

const plan = (over: Partial<Parameters<typeof planImpactedInventory>[0]> = {}) =>
  planImpactedInventory({
    tenantId: TENANT, cohortKey, subjectVin: vin(0), subjectAlreadyEvaluated: false,
    inventory: inventoryOf(5), pilotVins: Array.from({ length: 5 }, (_, i) => vin(i)),
    depth: 0, ...over,
  });

describe("loop safety", () => {
  it("plans nothing at depth 1 — propagation is one hop", () => {
    expect(MAX_PROPAGATION_DEPTH).toBe(1);
    const p = plan({ depth: 1 });
    expect(p.planned).toEqual([]);
    expect(p.reasons).toContain("propagation_depth_exhausted");
  });

  it("a propagated reevaluation cannot originate another snapshot event", () => {
    // Depth is the whole mechanism: a sibling evaluated at depth 1 plans zero
    // further work, so a storm cannot start.
    const first = plan({ depth: 0 });
    expect(first.planned.length).toBeGreaterThan(0);
    const second = plan({ depth: 1 });
    expect(second.planned.length).toBe(0);
  });

  it("caps fan-out per invocation and hands back a cursor instead of spawning", () => {
    const many = inventoryOf(MAX_PLAN_PER_INVOCATION + 10);
    const p = plan({
      inventory: many,
      pilotVins: many.slice(0, MAX_SHADOW_COHORT).map((c) => c.vin),
    });
    expect(p.planned.length).toBe(MAX_PLAN_PER_INVOCATION);
    expect(p.continuationCursor).not.toBeNull();
    expect(p.reasons).toContain("propagation_continuation_required");
  });

  it("continues deterministically from the cursor without repeating work", () => {
    const many = inventoryOf(MAX_PLAN_PER_INVOCATION + 10);
    const pilot = many.slice(0, MAX_SHADOW_COHORT).map((c) => c.vin);
    const first = plan({ inventory: many, pilotVins: pilot });
    const second = plan({ inventory: many, pilotVins: pilot, cursor: first.continuationCursor });
    const overlap = first.planned.map((p) => p.vin)
      .filter((v) => second.planned.some((s) => s.vin === v));
    expect(overlap).toEqual([]);
  });

  it("is deterministic: the same inputs give the same plan", () => {
    const a = JSON.stringify(plan().planned);
    const b = JSON.stringify(plan().planned);
    expect(a).toBe(b);
  });

  it("deduplicates a VIN listed twice", () => {
    const dupes = [...inventoryOf(3), ...inventoryOf(3)];
    const p = plan({ inventory: dupes, pilotVins: [vin(0), vin(1), vin(2)] });
    expect(new Set(p.planned.map((x) => x.vin)).size).toBe(p.planned.length);
  });
});

describe("the nightly cap", () => {
  it("refuses a vehicle already evaluated inside the cycle", () => {
    const recent = inventoryOf(3, { lastEvaluatedAt: new Date(Date.now() - 3_600_000).toISOString() });
    const p = plan({ inventory: recent, pilotVins: recent.map((c) => c.vin) });
    expect(p.planned).toEqual([]);
    expect(p.rejected[0].reasons).toContain("propagation_nightly_cap_reached");
  });

  it("allows it again once the cycle has elapsed", () => {
    const old = inventoryOf(3, {
      lastEvaluatedAt: new Date(Date.now() - (NIGHTLY_CYCLE_HOURS + 1) * 3_600_000).toISOString(),
    });
    const p = plan({ inventory: old, pilotVins: old.map((c) => c.vin) });
    expect(p.planned.length).toBe(3);
  });

  it("treats an unreadable timestamp as not recently evaluated", () => {
    for (const ts of [null, undefined, "", "never", 42]) {
      const rows = inventoryOf(1, { lastEvaluatedAt: ts });
      expect(plan({ inventory: rows, pilotVins: [vin(0)] }).planned.length, String(ts)).toBe(1);
    }
  });
});

describe("the pilot cohort bounds everything", () => {
  it("plans nothing when the pilot cohort is empty", () => {
    expect(plan({ pilotVins: [] }).reasons).toContain("propagation_pilot_cohort_empty");
  });

  it("refuses a pilot cohort over the cap", () => {
    const big = Array.from({ length: MAX_SHADOW_COHORT + 1 }, (_, i) => vin(i));
    expect(plan({ pilotVins: big }).reasons).toContain("propagation_pilot_cohort_too_large");
  });

  it("never plans a vehicle outside the pilot cohort", () => {
    const p = plan({ pilotVins: [vin(1)] });
    expect(p.planned.map((x) => x.vin)).toEqual([vin(1)]);
    expect(p.rejected.every((r) => r.reasons.includes("propagation_outside_pilot_cohort")
      || r.reasons.length > 0)).toBe(true);
  });

  it("refuses an unusable cohort key", () => {
    const unusable = buildCohortKey({ ...COHORT, trim: null });
    expect(plan({ cohortKey: unusable }).reasons).toContain("propagation_cohort_not_usable");
  });
});

describe("tamper: the boundaries that must hold", () => {
  it("a prediction can never be copied between VINs", () => {
    // The plan is a list of VINs to RECOMPUTE. There is no field to put a
    // prediction in, asserted against the entry's own key set.
    const p = plan();
    for (const entry of p.planned) {
      expect(Object.keys(entry).sort()).toEqual(["providerPolicy", "reasons", "vin"]);
    }
    // Comments stripped, and the forbidden LIST excised: the module header
    // names these fields in order to rule them out, and the list declares them.
    // A guard that fires on its own documentation teaches people to delete it.
    const src: string = readFileSync("src/lib/market/propagation.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/export const NEVER_PROPAGATED_FIELDS[\s\S]*?\] as const;/, "");
    for (const field of NEVER_PROPAGATED_FIELDS) {
      // Zero uses in executable code: the planner never reads or writes one.
      expect(src, field).not.toContain(field);
    }
  });

  it("the shared snapshot key contains no VIN of ours and no asking price", () => {
    const snap = buildMarketSnapshot({
      cohortKey,
      observations: [{ vin: "COMP00000000000A1", dealerName: "X", price: 100, mileage: 1 }],
      algorithmVersion: MARKET_ENGINE_VERSION,
    });
    const src = readFileSync("src/lib/market/marketSnapshot.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const fingerprintBlock = src.slice(src.indexOf('kind: "market_snapshot"'), src.indexOf("});", src.indexOf('kind: "market_snapshot"')));
    for (const banned of ["subjectVin", "advertisedPrice", "internalComparisonPrice", "apiKey", "api_key"]) {
      expect(fingerprintBlock, banned).not.toContain(banned);
    }
    expect(snap.fingerprint).toHaveLength(16);
  });

  it("provider contact is impossible during propagation", () => {
    const src = readFileSync("src/lib/market/propagation.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const spend of ["fetch(", "MC_KEY", "market_reserve_provider_call", "predictionUrl", "callProvider", "budget"]) {
      expect(src, spend).not.toContain(spend);
    }
    const p = plan();
    expect(p.providerCallsCaused).toBe(0);
    expect(p.providerCostCaused).toBe(0);
  });

  it("incompatible equipment is never accepted", () => {
    const other = buildCohortKey({ ...COHORT, equipment: ["Sensory Package"] });
    const rows = inventoryOf(2).map((c) => ({ ...c, cohortKey: other }));
    const p = plan({ inventory: rows, pilotVins: rows.map((c) => c.vin) });
    expect(p.planned).toEqual([]);
    expect(p.rejected[0].reasons).toContain("cohort_equipment_differs");
  });

  it("own inventory cannot become independent scarcity evidence", () => {
    const withOwn = buildMarketSnapshot({
      cohortKey,
      observations: [
        { vin: "COMP00000000000A1", dealerName: "Competitor", dealerId: "9", price: 100, mileage: 1 },
      ],
      ownRooftopExcluded: 12,
      algorithmVersion: MARKET_ENGINE_VERSION,
    });
    // Twelve own cars excluded and the market is still one rooftop.
    expect(withOwn.independentRooftopCount).toBe(1);
    expect(withOwn.eligibleCount).toBe(1);
  });

  it("cross-tenant propagation is refused before anything else is considered", () => {
    const foreign = inventoryOf(3).map((c) => ({ ...c, tenantId: "t-b" }));
    const p = plan({ inventory: foreign, pilotVins: foreign.map((c) => c.vin) });
    expect(p.planned).toEqual([]);
    for (const r of p.rejected) expect(r.reasons).toEqual(["propagation_cross_tenant_refused"]);
  });

  it("duplicate processing of the same snapshot does nothing", () => {
    const snap = buildMarketSnapshot({
      cohortKey, observations: [{ vin: "COMP00000000000A1", dealerName: "X", price: 100 }],
      algorithmVersion: MARKET_ENGINE_VERSION,
    });
    expect(decideMarketChange(snap, snap).material).toBe(false);
  });

  it("a price oscillation moves the vehicle fingerprint and never the snapshot", () => {
    const snap = buildMarketSnapshot({
      cohortKey, observations: [{ vin: "COMP00000000000A1", dealerName: "X", price: 100 }],
      algorithmVersion: MARKET_ENGINE_VERSION,
    });
    const at = (price: number) => vehicleValuationFingerprint({
      vin: vin(1), equipmentSignature: cohortKey.equipmentSignature,
      marketSnapshotFingerprint: snap.fingerprint, algorithmVersion: MARKET_ENGINE_VERSION,
      advertisedPrice: price,
    });
    expect(at(35788)).not.toBe(at(34995));
    expect(at(35788)).toBe(at(35788));
    // And the market never noticed.
    const again = buildMarketSnapshot({
      cohortKey, observations: [{ vin: "COMP00000000000A1", dealerName: "X", price: 100 }],
      algorithmVersion: MARKET_ENGINE_VERSION,
    });
    expect(again.fingerprint).toBe(snap.fingerprint);
  });
});

describe("the shadow flag remains the kill switch", () => {
  it("propagation is reachable only through the shadow decision", () => {
    // The planner does not read a flag; it is called from the path that does,
    // so disabling shadow stops new work without this module needing to know.
    const src = readFileSync("src/lib/market/propagation.ts", "utf8");
    expect(src).not.toContain("readMarketFlag");
    expect(src).toContain('from "./shadowPipeline.ts"');
  });

  it("disabling shadow deletes no evidence", () => {
    // The planner only plans. It has no delete, no update and no write.
    const src = readFileSync("src/lib/market/propagation.ts", "utf8");
    for (const write of [".delete(", ".update(", ".insert(", "DROP", "TRUNCATE"]) {
      expect(src, write).not.toContain(write);
    }
  });
});

describe("the authored migration is additive and guarded", () => {
  const FILE = "supabase/migrations/20260912000000_market_cohort_snapshots.sql";
  const sql = readFileSync(FILE, "utf8");
  const code = sql.replace(/^\s*--.*$/gm, "");

  it("creates the table additively and drops nothing", () => {
    expect(code).toContain("CREATE TABLE IF NOT EXISTS public.market_cohort_snapshots");
    expect(code).toContain("ADD COLUMN IF NOT EXISTS market_snapshot_id uuid");
    for (const destructive of [/DROP\s+TABLE/i, /DROP\s+COLUMN/i, /TRUNCATE/i, /DELETE\s+FROM/i, /ALTER\s+COLUMN/i]) {
      expect(code, String(destructive)).not.toMatch(destructive);
    }
  });

  it("is append-only: no UPDATE or DELETE is granted to anyone", () => {
    expect(code).toContain("GRANT SELECT ON public.market_cohort_snapshots TO authenticated");
    expect(code).toContain("GRANT SELECT, INSERT ON public.market_cohort_snapshots TO service_role");
    expect(code).not.toMatch(/GRANT[^;]*UPDATE[^;]*market_cohort_snapshots/i);
    expect(code).not.toMatch(/GRANT[^;]*DELETE[^;]*market_cohort_snapshots/i);
    expect(code).not.toMatch(/FOR\s+UPDATE\s/i);
  });

  it("revokes PUBLIC and anon", () => {
    expect(code).toContain("REVOKE ALL ON public.market_cohort_snapshots FROM PUBLIC");
    expect(code).toContain("REVOKE ALL ON public.market_cohort_snapshots FROM anon");
    expect(code).not.toMatch(/GRANT[^;]*TO\s+anon/i);
  });

  it("enables RLS with the canonical wrapped-uid, role-scoped policy", () => {
    expect(code).toContain("ENABLE ROW LEVEL SECURITY");
    expect(code).toContain("TO authenticated");
    expect(code).toContain("(SELECT auth.uid())");
    // The unwrapped form is the performance defect the repo standard forbids.
    expect(code).not.toMatch(/=\s*auth\.uid\(\)/);
  });

  it("enforces idempotency for the same tenant, cohort, fingerprint and version", () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX[^;]*market_cohort_snapshots \(tenant_id, cohort_hash, snapshot_fingerprint, algorithm_version\)/,
    );
  });

  it("keeps history rather than overwriting it", () => {
    expect(code).toContain("superseded_by uuid REFERENCES public.market_cohort_snapshots(id)");
  });

  it("stores no credential, image, description or subject VIN", () => {
    // `--` comments AND `COMMENT ON ... ;` documentation stripped: the table
    // comment states what the table does not store, by name.
    const columns = code
      .replace(/COMMENT ON[\s\S]*?;/gi, "")
      .toLowerCase();
    for (const forbidden of ["api_key", "apikey", "image", "photo", "description", "vdp_url", "subject_vin"]) {
      expect(columns, forbidden).not.toContain(forbidden);
    }
  });

  it("documents the provider licensing and retention position", () => {
    expect(sql).toMatch(/PROVIDER LICENSING AND RETENTION/);
    expect(sql).toMatch(/retention sweep|fresh_days|superseded/i);
  });

  it("is the only migration that mentions the snapshot table", () => {
    const mentions = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => readFileSync(`supabase/migrations/${f}`, "utf8").includes("market_cohort_snapshots"));
    expect(mentions).toEqual(["20260912000000_market_cohort_snapshots.sql"]);
  });

  it("leaves every previously applied Market V2 migration byte-identical", () => {
    const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    expect(sha("supabase/migrations/20260910140209_d9884db9-8fc7-4d63-bd50-b5e2ba5e5002.sql"))
      .toBe("bdeb39417866aa351dd65245490f14f28df79d335139a859b11e7da64c6e0c7a");
    expect(sha("supabase/migrations/20260910140315_62c76cbb-6d47-4745-9ebe-a8568a3b9bc4.sql"))
      .toBe("41b0a4a87c9929024ca5b05b5513107c300ccf4266fcb3cb494ef0d6a6831dd4");
  });
});
