import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearFeedScope, countOf, loadJobStatus, loadLastSuccessAt, loadRunsPage, runFeedNow, saveFeedConfig } from "./queries";

type Op = [string, unknown[]];

const mocks = vi.hoisted(() => {
  const results: Record<string, unknown> = {};
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const makeChain = (table: string) => {
    const record = { table, ops: [] as Op[] };
    calls.push(record);
    const chain: any = new Proxy(() => chain, {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(results[table] ?? { data: null, error: null, count: null });
        return (...args: unknown[]) => { record.ops.push([String(prop), args]); return chain; };
      },
    });
    return chain;
  };
  return { results, calls, from: vi.fn((table: string) => makeChain(table)), rpc: vi.fn(), invoke: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));

const undefinedFunction = { data: null, error: { code: "42883", message: "function does not exist" } };
const opsFor = (table: string): Op[] => mocks.calls.filter((c) => c.table === table).flatMap((c) => c.ops);

describe("queries", () => {
  beforeEach(() => {
    for (const k of Object.keys(mocks.results)) delete mocks.results[k];
    mocks.calls.length = 0;
    mocks.from.mockClear();
    mocks.rpc.mockReset();
    mocks.invoke.mockReset();
  });

  it("reads the whole-ledger last success from the ledger when the RPC is pending migration", async () => {
    mocks.rpc.mockResolvedValueOnce(undefinedFunction);
    mocks.results.inventory_sync_runs = { data: { started_at: "2026-10-22T06:07:00Z" }, error: null };
    const r = await loadLastSuccessAt("tenant-1");
    expect(r).toEqual({ at: "2026-10-22T06:07:00Z", failed: false });
    const ops = opsFor("inventory_sync_runs");
    expect(ops).toContainEqual(["in", ["status", ["success", "partial"]]]);
    expect(ops).toContainEqual(["limit", [1]]);
    expect(ops.find((o) => o[0] === "range")).toBeUndefined();
  });

  it("prefers the tenant-safe RPC when it exists and reports a failed read honestly", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "2026-10-22T06:07:00Z", error: null });
    expect(await loadLastSuccessAt("tenant-1")).toEqual({ at: "2026-10-22T06:07:00Z", failed: false });
    expect(opsFor("inventory_sync_runs")).toHaveLength(0);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await loadLastSuccessAt("tenant-1")).toEqual({ at: null, failed: true });
  });

  it("pages the run ledger with exact ranges", async () => {
    mocks.results.inventory_sync_runs = { data: [], error: null, count: 60 };
    await loadRunsPage("tenant-1", 3, 25);
    expect(opsFor("inventory_sync_runs")).toContainEqual(["range", [50, 74]]);
  });

  it("falls back from admin_job_status to the admin cron read, and to unavailable for other roles", async () => {
    mocks.rpc.mockResolvedValueOnce(undefinedFunction);
    const dealer = await loadJobStatus("tenant-1", ["marketcheck-sync"], false);
    expect(dealer.source).toBe("unavailable");
    expect(dealer.cron["marketcheck-sync"]).toBe("unavailable");

    mocks.rpc.mockResolvedValueOnce(undefinedFunction).mockResolvedValueOnce({ data: [{ jobname: "marketcheck-sync", schedule: "7 * * * *", active: true, last_status: "succeeded", last_message: null, last_start: "2026-10-24T13:07:00Z", last_end: null }], error: null });
    const admin = await loadJobStatus("tenant-1", ["marketcheck-sync"], true);
    expect(admin.source).toBe("get_cron_job_status");
    expect(admin.cron["marketcheck-sync"]).toMatchObject({ schedule: "7 * * * *", active: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_cron_job_status", { _jobname: "marketcheck-sync" });

    mocks.rpc.mockResolvedValueOnce({ data: [{ job: "marketcheck-sync", schedule: "7 * * * *", active: true, last_attempt_at: "2026-10-24T06:07:04Z", last_success_at: "2026-10-22T06:07:00Z", last_outcome: "failed", scope: "tenant" }], error: null });
    const server = await loadJobStatus("tenant-1", ["marketcheck-sync", "specs-backfill"], false);
    expect(server.source).toBe("admin_job_status");
    expect(server.serverLedger["marketcheck-sync"]).toEqual({ lastAttemptAt: "2026-10-24T06:07:04Z", lastSuccessAt: "2026-10-22T06:07:00Z", lastOutcome: "failed" });
    expect(server.cron["specs-backfill"]).toBeNull();
  });

  it("turns a failed count into unavailable, never zero", async () => {
    expect(await countOf(Promise.resolve({ count: null, error: { message: "denied" } }))).toEqual({ kind: "failed" });
    expect(await countOf(Promise.resolve({ count: 5, error: null }))).toEqual({ kind: "known", value: 5, capped: false });
    expect(await countOf(Promise.reject(new Error("network")))).toEqual({ kind: "failed" });
  });

  it("calls the existing writers by name, only when invoked", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await clearFeedScope("tenant-1")).toEqual({ error: null });
    expect(mocks.rpc).toHaveBeenCalledWith("marketcheck_clear_scope", { _tenant_id: "tenant-1" });

    await saveFeedConfig("tenant-1", { enabled: true, source: " dealer.example ", frequency: "nightly", day_of_week: 0, run_hour: 6, max_vehicles: 500 });
    expect(mocks.rpc).toHaveBeenCalledWith("save_marketcheck_config", { _tenant_id: "tenant-1", _enabled: true, _source: "dealer.example", _max_vehicles: 500, _frequency: "nightly", _day_of_week: 0, _run_hour: 6, _dealer_id: "" });

    mocks.invoke.mockResolvedValueOnce({ data: { error: "not_configured" }, error: null });
    expect((await runFeedNow("tenant-1")).ok).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith("marketcheck-sync", { body: { tenant_id: "tenant-1", force: true } });
    mocks.invoke.mockResolvedValueOnce({ data: { listings_seen: 128, new_vehicles: 2, prices_recorded: 128 }, error: null });
    expect(await runFeedNow("tenant-1")).toEqual({ ok: true, message: "Run finished: 128 seen, 2 new, 128 prices recorded." });
  });
});
