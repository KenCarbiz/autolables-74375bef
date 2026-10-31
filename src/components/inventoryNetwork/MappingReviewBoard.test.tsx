import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, spyCalls, spyResponses } from "@/test/mocks/supabaseSpy";
import { MappingReviewBoard } from "./MappingReviewBoard";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});

const PATH = "prod/inventory/vauto/inbound/harte_group.csv";
const identity = { dealerId: "MP15395_inventory", dealerName: "Harte Hyundai", address: "1 Main St", city: "Old Saybrook", postal: "06475", region: "CT" };
const runRow = {
  id: "run-1", path: PATH, kind: "dry_run", status: "passed", failure_reason: null, started_at: "2026-10-30T01:00:00Z", finished_at: "2026-10-30T01:01:00Z", affected_store_ids: [], job_id: null, content_sha256: "sha-1", remote_mtime: "2026-10-30T00:00:00Z",
  report: { kind: "partition_dry_run", outcome: "passed", rejectReasons: [], headers: { missing: [], extra: [] }, identities: 1, inventoryWrites: 0, providerCalls: 0, partitions: [{
    sourceDealerId: "MP15395_inventory", identity, identityVariants: 1, mapping: null, comparison: null, outcome: "unmapped", reasons: [],
    counts: { rows: 12, valid: 12, invalid: 0, duplicateIdentical: 0, duplicateConflicts: 0, priceMissing: 2, priceZero: 0, photoMissing: 0 }, errors: [], warnings: [], inventoryDiff: null,
  }] },
};
const store = { id: "st1", group_id: "g1", tenant_id: "t1", display_name: "Harte Hyundai of Old Saybrook", legal_name: null, street: "1 Main Street", city: "Old Saybrook", state: "CT", zip: "06475", status: "active", subscription_status: "unsubscribed", is_primary_inventory_store: false, inventory_feed_enabled: false, feed_import_paused: false, updated_at: "2026-10-01T00:00:00Z" };
const comparison = (verdict: string, fields: Record<string, string>) => ({
  partition: runRow.report.partitions[0], run_id: "run-1", path: PATH, content_sha256: "sha-1", remote_mtime: null, finished_at: null,
  comparison: { verdict, fields, observed: { name: "Harte Hyundai", street: "1 Main St", city: "Old Saybrook", state: "CT", zip: "06475" }, store: { name: store.display_name, legal_name: null, street: "1 Main Street", city: "Old Saybrook", state: "CT", zip: "06475" }, store_updated_at: store.updated_at },
});
const pending = (verdict: string) => ({ id: "m1", provider: "vauto", source_dealer_id: "MP15395_inventory", group_id: "g1", store_id: "st1", status: "pending", observed_identity: identity, evidence: { computed_by: "server", verdict, run_id: "run-1", content_sha256: "sha-1" }, identity_acknowledged: false, note: null, proposed_at: "2026-10-30T02:00:00Z", approved_at: null, revoked_at: null, created_at: "", updated_at: "" });

beforeEach(() => {
  resetSupabaseSpy();
  spyResponses.tables.inventory_feed_files = { data: [
    { id: "f1", path: PATH, status: "pending", quarantine_reason: null, remote_size: 1, remote_mtime: "2026-10-30T00:00:00Z", latest_event_at: null, discovered_at: null, last_run_id: "run-1", last_content_sha256: "sha-1" },
    { id: "f2", path: "prod/inventory/vauto/inbound/webhooktest_001.csv", status: "quarantined", quarantine_reason: "unmapped", remote_size: 1, remote_mtime: null, latest_event_at: null, discovered_at: null, last_run_id: null, last_content_sha256: null },
  ] };
  spyResponses.tables.inventory_feed_runs = { data: [runRow] };
  spyResponses.tables.dealer_stores = { data: [store] };
  spyResponses.tables.dealer_groups = { data: [{ id: "g1", tenant_id: "t1", name: "Harte Auto Group", legal_name: null, created_at: "", updated_at: "" }] };
  spyResponses.tables.inventory_feed_controls = { data: [{ id: 1, ingestion_paused: true, emergency_stop: false, reconcile_enabled: false, reason: null, updated_at: "" }] };
});

const rpcArgs = (fn: string) => spyCalls.filter((c): c is Extract<typeof c, { kind: "rpc" }> => c.kind === "rpc" && c.fn === fn).map((c) => c.args as Record<string, unknown>);
const openReview = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /harte_group\.csv/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Mapping/ }));
  return screen.getByRole("dialog", { name: "Identity review" });
};

describe("MappingReviewBoard", () => {
  it("loads with reads only, shows the exact DealerId and keeps test files apart", async () => {
    renderAdmin(<MappingReviewBoard />);
    expect(await screen.findByText("MP15395_inventory")).toBeInTheDocument();
    expect(screen.getByText("Test files, never mapped (1)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /webhooktest/ })).not.toBeInTheDocument();
    expect(functionCalls()).toEqual([]);
    expect(spyCalls.filter((c) => c.kind === "rpc")).toEqual([]);
  });

  it("never lets a mismatch be approved", async () => {
    spyResponses.tables.inventory_source_mappings = { data: [pending("mismatch")] };
    spyResponses.rpcs.inv_admin_preview_mapping = { data: comparison("mismatch", { street: "mismatch", city: "match", state: "match", zip: "match", name: "differs" }) };
    renderAdmin(<MappingReviewBoard />);
    const d = await openReview();
    expect(await within(d).findByText(/A mismatch can never be approved/)).toBeInTheDocument();
    expect(within(d).getByRole("link", { name: "Fix store identity" })).toHaveAttribute("href", "/admin/integrations/inventory-network?view=stores&store=st1");
    expect(within(d).getByRole("button", { name: /Approve mapping/ })).toBeDisabled();
  });

  it("requires the name acknowledgement for name_review and sends it", async () => {
    spyResponses.tables.inventory_source_mappings = { data: [pending("name_review")] };
    spyResponses.rpcs.inv_admin_preview_mapping = { data: comparison("name_review", { street: "match", city: "match", state: "match", zip: "match", name: "differs" }) };
    spyResponses.rpcs.inv_admin_decide_mapping = { data: null };
    renderAdmin(<MappingReviewBoard />);
    const d = await openReview();
    const approve = await within(d).findByRole("button", { name: /Approve mapping/ });
    await within(d).findByText(/is a name used by/);
    expect(approve).toBeDisabled();
    fireEvent.click(within(d).getByRole("checkbox"));
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(rpcArgs("inv_admin_decide_mapping")).toEqual([{ p_mapping_id: "m1", p_decision: "approve", p_acknowledge_identity: true, p_note: null }]));
  });

  it("proposes with the dry-run id as evidence", async () => {
    spyResponses.rpcs.inv_admin_preview_mapping = { data: comparison("match", { street: "match", city: "match", state: "match", zip: "match", name: "match" }) };
    spyResponses.rpcs.inv_admin_propose_mapping = { data: "m-new" };
    renderAdmin(<MappingReviewBoard />);
    const d = await openReview();
    fireEvent.change(within(d).getByLabelText("Destination store"), { target: { value: "st1" } });
    const propose = within(d).getByRole("button", { name: /Propose mapping/ });
    await waitFor(() => expect(propose).toBeEnabled());
    fireEvent.click(propose);
    await waitFor(() => expect(rpcArgs("inv_admin_propose_mapping")).toEqual([{ p_source_dealer_id: "MP15395_inventory", p_store_id: "st1", p_observed_identity: {}, p_evidence: { run_id: "run-1" }, p_note: null }]));
    expect(functionCalls()).toEqual([]);
  });

  it("keeps Import now disabled with a reason until the mapping is approved", async () => {
    renderAdmin(<MappingReviewBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /harte_group\.csv/ }));
    expect(screen.getByRole("button", { name: /Import now/ })).toBeDisabled();
    expect(screen.getByText(/Approve the mapping first/)).toBeInTheDocument();
  });
});
