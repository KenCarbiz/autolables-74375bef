import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  autoPreload,
  ensureComplianceDrafts,
  ensureReadyToken,
  recordArtifactFailure,
} from "./intake-autoprovision";

// ── Fake supabase admin client ─────────────────────────────────────────
// Chainable query builder that records writes per table and serves canned
// maybeSingle() results.

interface TableState {
  maybeSingleResults: Array<{ data: unknown }>;
  inserts: Record<string, unknown>[];
  updates: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>;
}

function makeAdmin(rpcErrors: Record<string, string> = {}) {
  const tables: Record<string, TableState> = {};
  const state = (t: string): TableState =>
    (tables[t] ||= { maybeSingleResults: [], inserts: [], updates: [] });
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcErrors[fn] ? { data: null, error: { message: rpcErrors[fn] } } : { data: null, error: null };
    },
    from: (table: string) => {
      const t = state(table);
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (k: string, v: unknown) => { filters[k] = v; return builder; },
        in: (k: string, v: unknown) => { filters[k] = v; return builder; },
        maybeSingle: async () => t.maybeSingleResults.shift() ?? { data: null },
        insert: async (row: Record<string, unknown>) => { t.inserts.push(row); return { data: null, error: null }; },
        update: (patch: Record<string, unknown>) => ({
          eq: async (k: string, v: unknown) => {
            t.updates.push({ patch, filters: { ...filters, [k]: v } });
            return { data: null, error: null };
          },
        }),
      };
      return builder;
    },
  };
  return { admin, tables, state, rpcCalls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const okFetch = () => vi.fn(async () => ({ ok: true, status: 200 }));

let originalFetch: typeof globalThis.fetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

describe("recordArtifactFailure", () => {
  it("inserts a high-severity artifact_autogen_failed exception naming the artifact", async () => {
    const { admin, state } = makeAdmin();
    await recordArtifactFailure(admin, "t1", "VIN123", "buyers_guide", "boom");
    const rows = state("vehicle_exceptions").inserts;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: "t1",
      vin: "VIN123",
      exception_type: "artifact_autogen_failed",
      severity: "high",
      status: "open",
    });
    expect((rows[0].source_values as { artifacts: Record<string, string> }).artifacts).toEqual({ buyers_guide: "boom" });
    expect(String(rows[0].explanation)).toContain("buyers_guide");
    expect(String(rows[0].explanation)).toContain("boom");
  });

  it("merges a second failed artifact into the existing open exception instead of duplicating", async () => {
    const { admin, state } = makeAdmin();
    state("vehicle_exceptions").maybeSingleResults.push({
      data: { id: "exc-1", source_values: { artifacts: { k208: "earlier" } } },
    });
    await recordArtifactFailure(admin, "t1", "VIN123", "addendum", "later");
    const t = state("vehicle_exceptions");
    expect(t.inserts).toHaveLength(0);
    expect(t.updates).toHaveLength(1);
    const patch = t.updates[0].patch;
    expect((patch.source_values as { artifacts: Record<string, string> }).artifacts).toEqual({
      k208: "earlier",
      addendum: "later",
    });
  });

  it("never throws even when the exception write itself fails", async () => {
    const admin = {
      rpc: async () => ({ data: null, error: null }),
      from: () => { throw new Error("db down"); },
    };
    await expect(recordArtifactFailure(admin, "t1", "V", "a", "m")).resolves.toBeUndefined();
  });
});

describe("ensureReadyToken", () => {
  it("mints a permanent vehicle hub token when none exists", async () => {
    const { admin, state } = makeAdmin();
    await ensureReadyToken(admin, "t1", "VIN123", "2024 Honda Civic", "l1");
    const rows = state("dept_signoff_tokens").inserts;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: "t1", vin: "VIN123", department: "vehicle", purpose: "get_ready",
      vehicle_listing_id: "l1",
    });
    expect(String(rows[0].token)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not mint a second token when a pending one exists", async () => {
    const { admin, state } = makeAdmin();
    state("dept_signoff_tokens").maybeSingleResults.push({ data: { id: "tok-1" } });
    await ensureReadyToken(admin, "t1", "VIN123", null, null);
    expect(state("dept_signoff_tokens").inserts).toHaveLength(0);
  });
});

describe("ensureComplianceDrafts", () => {
  it("calls the four VIN-idempotent draft RPCs", async () => {
    const { admin, rpcCalls } = makeAdmin();
    await ensureComplianceDrafts(admin, "t1", "VIN123");
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "create_draft_buyers_guide",
      "create_draft_safety_inspection",
      "create_draft_get_ready",
      "create_draft_window_sticker",
    ]);
    for (const c of rpcCalls) expect(c.args).toEqual({ p_tenant_id: "t1", p_vin: "VIN123" });
  });

  it("records a supabase-style { error } RPC result instead of swallowing it", async () => {
    const { admin, state } = makeAdmin({ create_draft_get_ready: "rls denied" });
    await ensureComplianceDrafts(admin, "t1", "VIN123");
    const rows = state("vehicle_exceptions").inserts;
    expect(rows).toHaveLength(1);
    expect((rows[0].source_values as { artifacts: Record<string, string> }).artifacts).toEqual({
      get_ready: "rls denied",
    });
  });
});

describe("autoPreload", () => {
  const input = { tenantId: "t1", vin: "VIN123", ymm: "2024 Honda Civic", listingId: "l1" };

  it("runs every draft RPC and every fire-and-forget endpoint for a new listing", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, rpcCalls } = makeAdmin();
    await autoPreload(admin, "https://x.supabase.co", "svc-key", { ...input, emailTitle: true });
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "create_draft_addendum",
      "create_draft_buyers_guide",
      "create_draft_safety_inspection",
      "create_draft_get_ready",
      "create_draft_window_sticker",
    ]);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "https://x.supabase.co/functions/v1/generate-vehicle-forms",
      "https://x.supabase.co/functions/v1/oem-window-sticker",
      "https://x.supabase.co/functions/v1/email-title-request",
      "https://x.supabase.co/functions/v1/ingest-orchestrate",
      "https://x.supabase.co/functions/v1/description-orchestrate",
    ]);
  });

  it("skips the title email by default and the listing-scoped calls without a listing id", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin } = makeAdmin();
    await autoPreload(admin, "https://x.supabase.co", "svc-key", { ...input, listingId: null });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "https://x.supabase.co/functions/v1/generate-vehicle-forms",
      "https://x.supabase.co/functions/v1/oem-window-sticker",
    ]);
  });

  it("resolves even when every RPC fails, recording each failed artifact (draft failure never blocks ingest)", async () => {
    globalThis.fetch = okFetch() as unknown as typeof fetch;
    const { admin, state } = makeAdmin({
      create_draft_addendum: "e1",
      create_draft_buyers_guide: "e2",
      create_draft_safety_inspection: "e3",
      create_draft_get_ready: "e4",
      create_draft_window_sticker: "e5",
    });
    await expect(autoPreload(admin, "https://x.supabase.co", "svc-key", input)).resolves.toBeUndefined();
    // The fake never persists the open row, so each failure lands as its own
    // insert; the artifact set across all writes must cover every failed RPC.
    const t = state("vehicle_exceptions");
    expect(t.inserts.length + t.updates.length).toBe(5);
    const artifacts = t.inserts.flatMap((r) =>
      Object.keys((r.source_values as { artifacts: Record<string, string> }).artifacts));
    expect(artifacts.sort()).toEqual(["addendum", "buyers_guide", "get_ready", "k208", "window_sticker"]);
  });

  it("resolves even when fetch rejects, and records the fire-and-forget failure", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    await expect(autoPreload(admin, "https://x.supabase.co", "svc-key", input)).resolves.toBeUndefined();
    await flush(); await flush();
    const t = state("vehicle_exceptions");
    expect(t.inserts.length + t.updates.length).toBeGreaterThan(0);
    const artifacts = t.inserts.flatMap((r) =>
      Object.keys((r.source_values as { artifacts: Record<string, string> }).artifacts));
    expect(artifacts).toContain("form_pdfs");
  });

  it("records a non-ok HTTP status from a fire-and-forget endpoint", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    await autoPreload(admin, "https://x.supabase.co", "svc-key", { ...input, listingId: null });
    await flush(); await flush();
    const t = state("vehicle_exceptions");
    const all = [...t.inserts, ...t.updates.map((u) => u.patch)];
    const msgs = all.map((r) => JSON.stringify(r.source_values));
    expect(msgs.some((m) => m.includes("http_500"))).toBe(true);
  });
});
