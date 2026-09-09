// Truth refresh, exercised against the real writer.
//
// refreshVehicleTruth is the database side of the truth layer and lives in
// the edge function; it is imported here rather than reimplemented, so these
// assertions are about the code that actually runs nightly. The fake client
// records every operation it is asked to perform, which is how "did this
// republish anything?" and "did this edit a stored snapshot?" become
// questions a test can answer.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { refreshVehicleTruth } from "../../../supabase/functions/factory-sticker-orchestrate/truth";

interface RecordedOp {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
}

interface SnapshotRow {
  id: string;
  vehicle_id: string;
  snapshot_version: number;
  snapshot_json: Record<string, unknown>;
  content_checksum: string;
  material_changes: unknown;
}

class FakeDatabase {
  readonly ops: RecordedOp[] = [];
  readonly snapshots: SnapshotRow[] = [];
  readonly facts = new Map<string, Record<string, unknown>>();
  readonly staleFlags: Array<Record<string, unknown>> = [];
  publishedDocuments: Array<{ id: string; document_type: string; document_status: string }> = [];

  get client(): unknown {
    return { from: (table: string) => this.chain(table), rpc: async () => ({ data: null, error: null }) };
  }

  /** Rows a caller would have to write to change what a customer sees. */
  get documentMutations(): RecordedOp[] {
    return this.ops.filter((o) =>
      o.op !== "select" &&
      ["generated_documents", "factory_sticker_records", "vehicle_listings", "document_assets"].includes(o.table));
  }

  get snapshotMutations(): RecordedOp[] {
    return this.ops.filter((o) => o.table === "vehicle_snapshots" && (o.op === "update" || o.op === "delete"));
  }

  factValue(key: string): unknown {
    for (const [composite, row] of this.facts) {
      if (composite.endsWith(`::${key}`)) return (row.fact_value as { v: unknown })?.v;
    }
    return undefined;
  }

  private chain(table: string) {
    let op: RecordedOp["op"] = "select";
    let payload: unknown;
    const self = this;
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => chain,
      upsert: (rows: unknown) => { op = "upsert"; payload = rows; return chain; },
      insert: (rows: unknown) => { op = "insert"; payload = rows; return chain; },
      update: (rows: unknown) => { op = "update"; payload = rows; return chain; },
      delete: () => { op = "delete"; return chain; },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        self.ops.push({ table, op, payload });
        try {
          return Promise.resolve(self.execute(table, op, payload)).then(resolve, reject);
        } catch (e) {
          return Promise.resolve().then(() => reject(e));
        }
      },
    };
    return chain;
  }

  private execute(table: string, op: RecordedOp["op"], payload: unknown): unknown {
    if (table === "vehicle_snapshots") {
      if (op === "update" || op === "delete") {
        // Mirrors trg_vehicle_snapshots_immutable, which raises on any
        // UPDATE or DELETE of a stored snapshot.
        throw new Error("vehicle_snapshots is append-only");
      }
      if (op === "insert") {
        const row = payload as Omit<SnapshotRow, "id">;
        const stored: SnapshotRow = { id: `snap-${this.snapshots.length + 1}`, ...row };
        this.snapshots.push(stored);
        return { data: { id: stored.id }, error: null };
      }
      const latest = this.snapshots[this.snapshots.length - 1] ?? null;
      return { data: latest, error: null };
    }
    if (table === "vehicle_facts" && op === "upsert") {
      for (const row of payload as Array<Record<string, unknown>>) {
        this.facts.set(`${row.vehicle_id}::${row.source_kind}::${row.fact_key}`, row);
      }
      return { error: null };
    }
    if (table === "vehicle_source_records") return { data: { id: "src-1" }, error: null };
    if (table === "generated_documents") return { data: this.publishedDocuments, error: null };
    if (table === "stale_document_flags") {
      if (op === "insert") this.staleFlags.push(...(payload as Array<Record<string, unknown>>));
      return { data: null, error: null };
    }
    if (table === "source_authority_rules") return { data: [], error: null };
    return { data: null, error: null };
  }
}

const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";

// JN8AZ3BEXV9730011, a 2027 INFINITI QX80 whose sticker is filed and whose
// NeoVIN decode was superseded three days later.
const listing = (pricing: { base: number; destination: number; total: number }) => ({
  id: "vehicle-1",
  tenant_id: TENANT,
  vin: "JN8AZ3BEXV9730011",
  ymm: "2027 INFINITI QX80",
  trim: "AUTOGRAPH",
  condition: "new",
  price: 103255,
  stock_number: "N9730011",
  mc_attributes: {
    specs_source: "neovin",
    engine: "3.5L V6",
    transmission: "9-Speed Automatic",
    drivetrain: "AWD",
    fuel_type: "Gasoline",
    exterior_color: "Radiant Silver",
    interior_color: "Graphite",
    base_msrp: pricing.base,
    delivery_charges: pricing.destination,
    total_msrp: pricing.total,
    build_sheet: {
      source: "neovin",
      generic: false,
      pricing: {
        base_msrp: pricing.base,
        destination_charge: pricing.destination,
        total_msrp: pricing.total,
      },
      standard: ["Leather Seats"],
      options: [{ code: "N10", name: "Illuminated Kick Plates", msrp: 580 }],
      packages: [],
    },
  },
});

const JULY = { base: 107995, destination: 2495, total: 111240 };
const SEPTEMBER = { base: 94590, destination: 2245, total: 98205 };

describe("a NeoVIN update produces a new resolved truth version", () => {
  it("appends a version, resolves the superseded MSRP to the newer value, and republishes nothing", async () => {
    const db = new FakeDatabase();
    db.publishedDocuments = [
      { id: "doc-1", document_type: "factory_sticker", document_status: "published" },
    ];

    const first = await refreshVehicleTruth(db.client, TENANT, listing(JULY));
    expect(first.created).toBe(true);
    expect(first.version).toBe(1);
    expect(db.factValue("total_msrp")).toBe(111240);

    const second = await refreshVehicleTruth(db.client, TENANT, listing(SEPTEMBER));

    expect(second.created).toBe(true);
    expect(second.version).toBe(2);
    expect(db.snapshots).toHaveLength(2);
    expect(db.snapshots[0].snapshot_json).toMatchObject({ pricing: { totalMsrp: 111240 } });
    expect(db.snapshots[1].snapshot_json).toMatchObject({
      pricing: { baseMsrp: 94590, destinationCharge: 2245, totalMsrp: 98205 },
    });
    expect(db.factValue("total_msrp")).toBe(98205);
    expect(db.factValue("base_msrp")).toBe(94590);

    // The published sticker is flagged for a human, never regenerated,
    // restatused or republished by the refresh.
    expect(db.documentMutations).toEqual([]);
    expect(db.staleFlags.map((f) => f.generated_document_id)).toContain("doc-1");
  });

  it("never updates or deletes a stored snapshot row", async () => {
    const db = new FakeDatabase();
    await refreshVehicleTruth(db.client, TENANT, listing(JULY));
    await refreshVehicleTruth(db.client, TENANT, listing(SEPTEMBER));
    await refreshVehicleTruth(db.client, TENANT, listing(SEPTEMBER));

    expect(db.snapshotMutations).toEqual([]);
    const versions = db.snapshots.map((s) => s.snapshot_version);
    expect(versions).toEqual([1, 2]);
    expect(db.snapshots[0].snapshot_json).toMatchObject({ pricing: { totalMsrp: 111240 } });
  });

  it("re-resolving unchanged data reuses the current version rather than minting one", async () => {
    const db = new FakeDatabase();
    await refreshVehicleTruth(db.client, TENANT, listing(SEPTEMBER));
    const again = await refreshVehicleTruth(db.client, TENANT, listing(SEPTEMBER));

    expect(again.created).toBe(false);
    expect(again.version).toBe(1);
    expect(db.snapshots).toHaveLength(1);
    expect(again.facts_written).toBeGreaterThan(0);
  });
});

describe("a vehicle whose facts were never written gets them on the next refresh", () => {
  it("writes engine, drivetrain and MSRP for a vehicle with a settled sticker and no facts", async () => {
    const db = new FakeDatabase();
    // The four pilot vehicles in this state carry an ARCHIVED sticker record,
    // which is why the generation sweep never looked at them again.
    db.publishedDocuments = [
      { id: "doc-archived", document_type: "factory_sticker", document_status: "published" },
    ];
    expect(db.facts.size).toBe(0);

    const result = await refreshVehicleTruth(db.client, TENANT, listing(SEPTEMBER));

    expect(result.created).toBe(true);
    expect(result.facts_written).toBeGreaterThan(0);
    expect(result.fact_write_errors).toEqual([]);
    expect(db.factValue("engine")).toBe("3.5L V6");
    expect(db.factValue("drivetrain")).toBe("AWD");
    expect(db.factValue("total_msrp")).toBe(98205);
    expect(db.factValue("make")).toBe("INFINITI");
    expect(db.factValue("model")).toBe("QX80");
    expect(db.factValue("model_year")).toBe(2027);
    expect(db.documentMutations).toEqual([]);
  });
});

// The rules above are enforced by the pure functions. These guard the wiring
// that decides which vehicles reach them, which lives in the edge function and
// its migration and cannot be imported here.
describe("the served refresh path is decoupled from sticker state", () => {
  const root = join(__dirname, "../../..");
  const orchestrator = readFileSync(
    join(root, "supabase/functions/factory-sticker-orchestrate/index.ts"), "utf8");
  const migration = readFileSync(
    join(root, "supabase/migrations/20260909112000_truth_refresh_decoupling.sql"), "utf8");

  const handler = orchestrator
    .slice(orchestrator.indexOf('if (action === "refresh_truth_sweep")'))
    .split('if (action === "orchestrate_sweep")')[0];

  it("has a refresh_truth_sweep handler that resolves truth", () => {
    expect(handler).toContain("refreshVehicleTruth");
    expect(handler.length).toBeGreaterThan(500);
  });

  it("never consults the sticker sweep's terminal statuses", () => {
    expect(handler).not.toContain("SWEEP_NEVER_RERUN_STATUSES");
    expect(handler).not.toContain("SWEEP_RETRYABLE_STATUSES");
  });

  it("never generates, restatuses or republishes a document", () => {
    expect(handler).not.toContain("orchestrateVehicle");
    expect(handler).not.toContain("document_status");
    expect(handler).not.toContain("generated_documents");
    expect(handler).not.toContain("setRecord");
  });

  it("runs for every tenant, so the nightly cron can call it without naming one", () => {
    expect(orchestrator).toContain(
      'const ALL_TENANT_SWEEP_ACTIONS = new Set(["orchestrate_sweep", "refresh_truth_sweep"]);');
  });

  it("selects its worklist by resolution age, not by sticker status", () => {
    const fn = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.truth_refresh_candidates"),
      migration.indexOf("REVOKE ALL ON FUNCTION public.truth_refresh_candidates"));
    expect(fn).toContain("ORDER BY q.last_resolved_at ASC NULLS FIRST");
    expect(fn).not.toMatch(/WHERE[\s\S]*generation_status/);
  });

  it("schedules the path that had never run", () => {
    expect(migration).toContain("'truth-refresh-nightly'");
    expect(migration).toContain('"action": "refresh_truth_sweep"');
  });
});
