import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetSupabaseSpy, rpcCalls, spyCalls, spyResponses } from "@/test/mocks/supabaseSpy";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});

import { applyFeeChange, feeReviewHref, isMissingFunction, LEGACY_SPLIT_BLOCK, loadFeePreview, loadPolicyVersion, parseFeeReviewParams } from "./pricingData";

const draft = { enabled: true, amount: 925, stateCode: "CT" };
const rows = [
  { vin: "EXAMPLEVIN0000001", year: 2024, make: "Example", model: "Crossover", trim: "Base", archived_at: null, advertised_price_before_doc: 30_000, doc_fee: 895, website_sale_price: 30_895, price_parse_status: "ok", stock: "EX-1" },
  { vin: "EXAMPLEVIN0000002", year: 2023, make: "Example", model: "Sedan", trim: "Sport", archived_at: null, advertised_price_before_doc: 24_500, doc_fee: 925, website_sale_price: 25_425, price_parse_status: "ok", stock: "EX-2" },
  { vin: "EXAMPLEVIN0000003", year: 2022, make: "Example", model: "Hatch", trim: "Base", archived_at: "2026-09-01T00:00:00Z", advertised_price_before_doc: 18_900, doc_fee: 895, website_sale_price: 19_795, price_parse_status: "ok", stock: "EX-3" },
];

beforeEach(() => resetSupabaseSpy());

describe("missing-function detection", () => {
  it("recognises Postgres 42883, the PostgREST schema-cache miss and the message forms", () => {
    expect(isMissingFunction({ code: "42883", message: "x" })).toBe(true);
    expect(isMissingFunction({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isMissingFunction({ message: "Could not find the function public.admin_policy_version in the schema cache" })).toBe(true);
    expect(isMissingFunction({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});

describe("fee review deep link", () => {
  it("round-trips the draft and scope through the query string", () => {
    const href = feeReviewHref(draft, "all");
    expect(href).toBe("/admin/pricing/fee-review?enabled=1&amount=925&state=CT&scope=all");
    const parsed = parseFeeReviewParams(new URLSearchParams(href.split("?")[1]), { enabled: false, amount: 0, stateCode: "" });
    expect(parsed).toEqual({ draft, scope: "all", provided: true });
  });

  it("falls back to the stored policy when nothing was provided", () => {
    expect(parseFeeReviewParams(new URLSearchParams(""), { enabled: true, amount: 895, stateCode: "CT" })).toEqual({ draft: { enabled: true, amount: 895, stateCode: "CT" }, scope: "active", provided: false });
  });
});

describe("fee preview", () => {
  it("uses the shared preview contract when it answers", async () => {
    spyResponses.rpcs.admin_doc_fee_change_preview = { data: { version: 7, eligible: 5, unchanged: 1, excluded_archived: 2, samples: [{ vin_suffix: "000001", selling_price: 30000, fee_before: 895, fee_after: 925, total_before: 30895, total_after: 30925 }], warnings: ["w"] }, error: null };
    const p = await loadFeePreview("tenant-1", draft, false);
    expect(p.source).toBe("server");
    expect(p.version).toBe(7);
    expect(p.impact).toMatchObject({ eligible: 5, unchanged: 1, excludedArchived: 2, warnings: ["w"] });
    expect(p.impact.samples[0]).toMatchObject({ vinSuffix: "000001", totalAfter: 30925 });
    expect(spyCalls.some((c) => c.kind === "table")).toBe(false);
  });

  it("holds a fee-inclusive dealership's change when the installed preview predates the fee basis contract", async () => {
    // The deployed routine's answer for the traced vehicle: before-fee + fee = $40,450 beside a $40,420 label.
    spyResponses.rpcs.admin_doc_fee_change_preview = { data: { version: 3, eligible: 1, unchanged: 0, excluded_archived: 0, samples: [{ vin_suffix: "040420", selling_price: 39525, fee_before: 895, fee_after: 925, total_before: 40420, total_after: 40450 }], warnings: [] }, error: null };
    const inclusive = await loadFeePreview("tenant-1", draft, false, "includes_fee");
    expect(inclusive.blocked).toBe(LEGACY_SPLIT_BLOCK);
    expect((await loadFeePreview("tenant-1", draft, false, "before_fee")).blocked).toBeNull();
  });

  it("reads the fee basis contract's answer: the total kept, the split moved, mismatches counted", async () => {
    spyResponses.rpcs.admin_doc_fee_change_preview = { data: { version: 3, basis: "includes_fee", eligible: 3, unchanged: 0, excluded_archived: 1, no_price_basis: 1, invalid: 1, source_mismatches: 1,
      samples: [{ vin_suffix: "040420", selling_price: 39495, selling_before: 39525, selling_after: 39495, fee_before: 895, fee_after: 925, total_before: 40420, total_after: 40420, source_mismatch: false }], warnings: [] }, error: null };
    const p = await loadFeePreview("tenant-1", draft, false, "includes_fee");
    expect(p.blocked).toBeNull();
    expect(p.impact).toMatchObject({ basis: "includes_fee", eligible: 3, invalid: 1, sourceMismatches: 1, noPrice: 1 });
    expect(p.impact.samples[0]).toMatchObject({ sellingBefore: 39_525, sellingPrice: 39_495, totalBefore: 40_420, totalAfter: 40_420 });
  });

  it("holds every change while the basis settings contradict each other", async () => {
    spyResponses.rpcs.admin_doc_fee_change_preview = { data: { version: 3, basis: "conflict", eligible: 0, samples: [], warnings: [] }, error: null };
    expect((await loadFeePreview("tenant-1", draft, false, "includes_fee")).blocked).toMatch(/contradict/);
  });

  it("computes the impact in the browser when the contract is not installed and says so", async () => {
    spyResponses.tables.vehicle_listings = { data: rows, error: null };
    const p = await loadFeePreview("tenant-1", draft, false);
    expect(p.source).toBe("client");
    expect(p.version).toBeNull();
    expect(p.impact).toMatchObject({ eligible: 1, unchanged: 1, excludedArchived: 1 });
    expect(p.notes[0]).toMatch(/pending migration/);
    expect(p.notes[1]).toMatch(/archived vehicles and refreshes/);
  });

  it("surfaces any other server error instead of inventing a result", async () => {
    spyResponses.rpcs.admin_doc_fee_change_preview = { data: null, error: { code: "42501", message: "permission denied for function" } };
    await expect(loadFeePreview("tenant-1", draft, false)).rejects.toThrow(/permission denied/);
  });

  it("fails the preview when inventory cannot be read in the fallback", async () => {
    spyResponses.tables.vehicle_listings = { data: null, error: { message: "read failed" } };
    await expect(loadFeePreview("tenant-1", draft, false)).rejects.toThrow(/read failed/);
  });
});

describe("policy version", () => {
  it("prefers the server version, then the profile stamp, else unknown", async () => {
    spyResponses.rpcs.admin_policy_version = { data: 12, error: null };
    expect(await loadPolicyVersion("tenant-1")).toEqual({ version: 12, source: "server" });
    resetSupabaseSpy();
    spyResponses.tables.dealer_profiles = { data: { updated_at: "2026-10-20T00:00:00Z" }, error: null };
    expect(await loadPolicyVersion("tenant-1")).toEqual({ version: "2026-10-20T00:00:00Z", source: "fallback" });
    resetSupabaseSpy();
    spyResponses.tables.dealer_profiles = { data: null, error: { message: "nope" } };
    expect(await loadPolicyVersion("tenant-1")).toEqual({ version: null, source: "unknown" });
    resetSupabaseSpy();
    spyResponses.rpcs.admin_policy_version = { data: null, error: { code: "42501", message: "denied" } };
    expect(await loadPolicyVersion("tenant-1")).toEqual({ version: null, source: "unknown" });
  });
});

describe("apply", () => {
  const base = { tenantId: "tenant-1", draft, expectedVersion: 12 as string | number | null, idempotencyKey: "k1", includeArchived: false };

  it("maps the server statuses and never falls back on a non-missing error", async () => {
    const updateSettings = vi.fn(async () => true);
    spyResponses.rpcs.admin_doc_fee_change_apply = { data: { status: "conflict" }, error: null };
    expect(await applyFeeChange({ ...base, updateSettings })).toEqual({ kind: "conflict", path: "server" });
    spyResponses.rpcs.admin_doc_fee_change_apply = { data: { status: "duplicate", affected: 3, audit_id: "a1" }, error: null };
    expect(await applyFeeChange({ ...base, updateSettings })).toMatchObject({ kind: "result", path: "server", result: { status: "applied", affected: 3, auditEventId: "a1" } });
    spyResponses.rpcs.admin_doc_fee_change_apply = { data: { status: "applied", affected: 48, audit_id: "a2" }, error: null };
    expect(await applyFeeChange({ ...base, updateSettings })).toMatchObject({ kind: "result", result: { status: "applied", affected: 48 } });
    spyResponses.rpcs.admin_doc_fee_change_apply = { data: { status: "partial", affected: 2 }, error: null };
    expect(await applyFeeChange({ ...base, updateSettings })).toMatchObject({ kind: "result", result: { status: "partial" } });
    spyResponses.rpcs.admin_doc_fee_change_apply = { data: null, error: { code: "42501", message: "denied" } };
    expect(await applyFeeChange({ ...base, updateSettings })).toMatchObject({ kind: "result", path: "server", result: { status: "failed", message: "denied" } });
    expect(updateSettings).not.toHaveBeenCalled();
    expect(rpcCalls()).not.toContain("recalc_tenant_doc_fee");
  });

  it("falls back to the existing routine only after the policy is saved, and states what that path touches", async () => {
    const updateSettings = vi.fn(async () => true);
    spyResponses.tables.dealer_profiles = { data: { updated_at: "v-1" }, error: null };
    spyResponses.rpcs.recalc_tenant_doc_fee = { data: 3, error: null };
    const outcome = await applyFeeChange({ ...base, expectedVersion: "v-1", updateSettings });
    expect(updateSettings).toHaveBeenCalledWith({ doc_fee_enabled: true, doc_fee_amount: 925, doc_fee_state: "CT" });
    expect(rpcCalls()).toEqual(["admin_doc_fee_change_apply", "admin_policy_version", "recalc_tenant_doc_fee"]);
    expect(outcome).toMatchObject({ kind: "result", path: "fallback", result: { status: "applied", affected: 3 } });
    expect(outcome.kind === "result" ? outcome.result.message : "").toMatch(/archived vehicles/);
  });

  it("does not recalculate when the policy save fails, and reports partial when the recalculation fails", async () => {
    spyResponses.tables.dealer_profiles = { data: { updated_at: "v-1" }, error: null };
    const failedSave = await applyFeeChange({ ...base, expectedVersion: "v-1", updateSettings: vi.fn(async () => false) });
    expect(failedSave).toMatchObject({ kind: "result", path: "fallback", result: { status: "failed" } });
    expect(rpcCalls()).not.toContain("recalc_tenant_doc_fee");
    resetSupabaseSpy();
    spyResponses.tables.dealer_profiles = { data: { updated_at: "v-1" }, error: null };
    spyResponses.rpcs.recalc_tenant_doc_fee = { data: null, error: { message: "boom" } };
    const partial = await applyFeeChange({ ...base, expectedVersion: "v-1", updateSettings: vi.fn(async () => true) });
    expect(partial).toMatchObject({ kind: "result", path: "fallback", result: { status: "partial" } });
  });

  it("refuses the fallback when the profile changed after the review", async () => {
    spyResponses.tables.dealer_profiles = { data: { updated_at: "v-2" }, error: null };
    const updateSettings = vi.fn(async () => true);
    expect(await applyFeeChange({ ...base, expectedVersion: "v-1", updateSettings })).toEqual({ kind: "conflict", path: "fallback" });
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
