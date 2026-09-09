import { describe, expect, it } from "vitest";
import {
  upsertRowsWithFallback,
  type RowUpsert,
} from "../../../supabase/functions/factory-sticker-orchestrate/truth.ts";

// A multi-row upsert is one statement, and supabase-js resolves rather than
// throws when Postgres rejects it. The helper under test is what stops one
// bad row from silently taking the other nineteen facts for a VIN with it.

type Row = { fact_key: string; v: number };
const rows: Row[] = [
  { fact_key: "engine", v: 1 },
  { fact_key: "drivetrain", v: 2 },
  { fact_key: "carfax_one_owner", v: 3 },
];

function fake(opts: { batchError?: string; rowErrors?: Record<string, string>; throwOn?: string[] }) {
  const calls: Row[][] = [];
  const upsert: RowUpsert<Row> = async (batch) => {
    calls.push(batch);
    if (batch.length > 1) {
      return opts.batchError ? { error: { message: opts.batchError } } : { error: null };
    }
    const key = batch[0].fact_key;
    if (opts.throwOn?.includes(key)) throw new Error(`threw on ${key}`);
    const msg = opts.rowErrors?.[key];
    return msg ? { error: { message: msg } } : { error: null };
  };
  return { calls, upsert };
}

describe("upsertRowsWithFallback", () => {
  it("writes the batch once and never retries per row when it succeeds", async () => {
    const f = fake({});
    const out = await upsertRowsWithFallback(rows, f.upsert);
    expect(out).toEqual({ written: 3, batch_failed: false, errors: [] });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toHaveLength(3);
  });

  it("does nothing for an empty batch", async () => {
    const f = fake({});
    const out = await upsertRowsWithFallback([], f.upsert);
    expect(out).toEqual({ written: 0, batch_failed: false, errors: [] });
    expect(f.calls).toHaveLength(0);
  });

  it("falls back to one row at a time when the batch is refused", async () => {
    const f = fake({ batchError: "check constraint violated" });
    const out = await upsertRowsWithFallback(rows, f.upsert);
    expect(out).toEqual({ written: 3, batch_failed: true, errors: [] });
    expect(f.calls).toHaveLength(4);
    expect(f.calls.slice(1).map((c) => c.length)).toEqual([1, 1, 1]);
  });

  it("keeps the good rows and records exactly the bad one by fact_key", async () => {
    const f = fake({
      batchError: 'new row violates check constraint "vehicle_facts_authority_check"',
      rowErrors: { carfax_one_owner: 'new row violates check constraint "vehicle_facts_authority_check"' },
    });
    const out = await upsertRowsWithFallback(rows, f.upsert);
    expect(out.written).toBe(2);
    expect(out.batch_failed).toBe(true);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].fact_key).toBe("carfax_one_owner");
    expect(out.errors[0].message).toMatch(/vehicle_facts_authority_check/);
    expect(f.calls.slice(1).map((c) => c[0].fact_key)).toEqual(["engine", "drivetrain", "carfax_one_owner"]);
  });

  it("never throws, even when the client itself throws", async () => {
    const throwing: RowUpsert<Row> = async () => { throw new Error("network down"); };
    const out = await upsertRowsWithFallback(rows, throwing);
    expect(out.written).toBe(0);
    expect(out.batch_failed).toBe(true);
    expect(out.errors.map((e) => e.fact_key)).toEqual(["engine", "drivetrain", "carfax_one_owner"]);
    expect(out.errors[0].message).toBe("network down");

    const f = fake({ batchError: "refused", throwOn: ["drivetrain"] });
    const partial = await upsertRowsWithFallback(rows, f.upsert);
    expect(partial.written).toBe(2);
    expect(partial.errors).toEqual([{ fact_key: "drivetrain", message: "threw on drivetrain" }]);
  });

  it("uses the batch message when a row is refused without one", async () => {
    const upsert: RowUpsert<Row> = async (batch) =>
      batch.length > 1 ? { error: { message: "batch refused" } }
        : batch[0].fact_key === "engine" ? { error: {} } : { error: null };
    const out = await upsertRowsWithFallback(rows, upsert);
    expect(out.errors).toEqual([{ fact_key: "engine", message: "batch refused" }]);
  });
});
