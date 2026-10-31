import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

import { buildMappingRows } from "./mappingBoard";
import type { FeedFile, FeedRun, InventorySourceMapping, DealerStore, InventoryFeedControls } from "./api";

const file = (path: string, sha = "sha-1"): FeedFile => ({ id: path, path, status: "pending", quarantine_reason: null, remote_size: 1, remote_mtime: "2026-10-30T00:00:00Z", latest_event_at: null, discovered_at: null, last_run_id: null, last_content_sha256: sha });
const partition = (id: string) => ({
  sourceDealerId: id, identity: { dealerId: id, dealerName: "Harte Hyundai", address: "1 Main St", city: "Old Saybrook", postal: "06475", region: "CT" }, identityVariants: 1,
  mapping: null, comparison: null, outcome: "unmapped" as const, reasons: [], counts: { rows: 10, valid: 10, invalid: 0, duplicateIdentical: 0, duplicateConflicts: 0, priceMissing: 1, priceZero: 0, photoMissing: 0 },
  errors: [], warnings: [], inventoryDiff: null,
});
const run = (path: string, ids: string[], sha = "sha-1"): FeedRun => ({
  id: `run-${path}`, path, kind: "dry_run", status: "passed", failure_reason: null, started_at: "2026-10-30T01:00:00Z", finished_at: "2026-10-30T01:01:00Z", affected_store_ids: [], job_id: null, content_sha256: sha, remote_mtime: null,
  report: { kind: "partition_dry_run", outcome: "passed", rejectReasons: [], headers: { missing: [], extra: [] }, identities: ids.length, partitions: ids.map(partition), inventoryWrites: 0, providerCalls: 0 },
});
const store = { id: "st1", group_id: "g1", display_name: "Harte Hyundai", inventory_feed_enabled: true, feed_import_paused: false } as DealerStore;
const controls = { id: 1, ingestion_paused: false, emergency_stop: false, reconcile_enabled: false, reason: null, updated_at: "" } as InventoryFeedControls;
const mapping = (over: Partial<InventorySourceMapping>): InventorySourceMapping => ({ id: "m1", provider: "vauto", source_dealer_id: "MP15395_inventory", group_id: "g1", store_id: "st1", status: "pending", observed_identity: null, evidence: { computed_by: "server", verdict: "match", run_id: "run-a.csv", content_sha256: "sha-1" }, identity_acknowledged: false, note: null, proposed_at: "", approved_at: null, revoked_at: null, created_at: "", updated_at: "", ...over });
const input = (over: Partial<Parameters<typeof buildMappingRows>[0]> = {}) => ({ files: [], runs: [], mappings: [], stores: [store], groups: [], bindings: [], controls, ...over });

describe("buildMappingRows", () => {
  it("keeps webhooktest files out of production readiness", () => {
    const r = buildMappingRows(input({ files: [file("prod/a.csv"), file("prod/webhooktest_1.csv")], runs: [run("prod/webhooktest_1.csv", ["X"])] }));
    expect(r.production.map((x) => x.path)).toEqual(["prod/a.csv"]);
    expect(r.production[0].state).toBe("source_unread");
    expect(r.tests.map((f) => f.path)).toEqual(["prod/webhooktest_1.csv"]);
  });

  it("keeps the DealerId exactly as written in the CSV", () => {
    const r = buildMappingRows(input({ files: [file("a.csv")], runs: [run("a.csv", ["MP15395_inventory", "MP15396_inventory"])] }));
    expect(r.production.map((x) => x.dealerId)).toEqual(["MP15395_inventory", "MP15396_inventory"]);
    expect(r.production.every((x) => x.state === "unmapped")).toBe(true);
  });

  it("marks a row stale when the file changed since the dry run", () => {
    const r = buildMappingRows(input({ files: [file("a.csv", "sha-2")], runs: [run("a.csv", ["MP15395_inventory"], "sha-1")] }));
    expect(r.production[0].state).toBe("stale");
    expect(r.production[0].stale).toBe(true);
  });

  it("classifies proposals by the server verdict", () => {
    const files = [file("a.csv")];
    const runs = [run("a.csv", ["MP15395_inventory"])];
    expect(buildMappingRows(input({ files, runs, mappings: [mapping({})] })).production[0].state).toBe("ready_for_approval");
    expect(buildMappingRows(input({ files, runs, mappings: [mapping({ evidence: { computed_by: "server", verdict: "mismatch" } })] })).production[0].state).toBe("identity_conflict");
    expect(buildMappingRows(input({ files, runs, mappings: [mapping({ evidence: { verdict: "match" } })] })).production[0].state).toBe("proposed");
  });

  it("shows an approved mapping as paused while ingestion is paused", () => {
    const r = buildMappingRows(input({ files: [file("a.csv")], runs: [run("a.csv", ["MP15395_inventory"])], mappings: [mapping({ status: "approved", approved_at: "2026-10-30T02:00:00Z" })], controls: { ...controls, ingestion_paused: true } }));
    expect(r.production[0].state).toBe("approved_paused");
    expect(r.production[0].nextAction).toMatch(/Ingestion is paused/);
  });
});
