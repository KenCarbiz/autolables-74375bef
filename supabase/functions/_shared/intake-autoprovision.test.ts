import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  artifactPostsIdle,
  setArtifactPostGapMs,
  autoPreload,
  ensureComplianceDrafts,
  ensureReadyToken,
  recommendedActionFor,
  recordArtifactFailure,
} from "./intake-autoprovision";

// ── Fake supabase admin client ─────────────────────────────────────────
// Chainable query builder that records writes per table and serves canned
// maybeSingle() results.

interface TableState {
  maybeSingleResults: Array<{ data: unknown }>;
  /** Served (FIFO) when a builder is awaited as a list read. */
  listResults: Array<{ data: unknown; error?: { message: string } | null }>;
  inserts: Record<string, unknown>[];
  updates: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>;
}

function makeAdmin(rpcErrors: Record<string, string> = {}) {
  const tables: Record<string, TableState> = {};
  const state = (t: string): TableState =>
    (tables[t] ||= { maybeSingleResults: [], listResults: [], inserts: [], updates: [] });
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
        not: () => builder,
        maybeSingle: async () => t.maybeSingleResults.shift() ?? { data: null },
        insert: async (row: Record<string, unknown>) => { t.inserts.push(row); return { data: null, error: null }; },
        update: (patch: Record<string, unknown>) => ({
          eq: async (k: string, v: unknown) => {
            t.updates.push({ patch, filters: { ...filters, [k]: v } });
            return { data: null, error: null };
          },
        }),
        then: (onFulfilled: (v: { data: unknown; error: { message: string } | null }) => unknown) => {
          const next = t.listResults.shift() ?? { data: [], error: null };
          return Promise.resolve({ data: next.data, error: next.error ?? null }).then(onFulfilled);
        },
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

  it("claims the nightly sweep only for sweep-covered artifacts", async () => {
    const { admin, state } = makeAdmin();
    await recordArtifactFailure(admin, "t1", "VIN123", "buyers_guide", "boom");
    const [row] = state("vehicle_exceptions").inserts;
    expect(String(row.recommended_action)).toContain("nightly intake sweep will also retry");
  });

  it("tells the truth for an edge-only artifact: nothing retries it", async () => {
    const { admin, state } = makeAdmin();
    await recordArtifactFailure(admin, "t1", "VIN123", "form_pdfs", "http_500");
    const [row] = state("vehicle_exceptions").inserts;
    const action = String(row.recommended_action);
    expect(action).not.toContain("sweep will also retry");
    expect(action).toContain("will not retry on its own");
    expect(action).toContain("form_pdfs");
  });

  it("recomputes the recommendation when an edge-only artifact merges into a sweep-covered row", async () => {
    const { admin, state } = makeAdmin();
    state("vehicle_exceptions").maybeSingleResults.push({
      data: { id: "exc-1", source_values: { artifacts: { k208: "earlier" } } },
    });
    await recordArtifactFailure(admin, "t1", "VIN123", "oem_window_sticker", "later");
    const [upd] = state("vehicle_exceptions").updates;
    const action = String(upd.patch.recommended_action);
    expect(action).toContain("nightly intake sweep will retry k208");
    expect(action).toContain("oem_window_sticker will not retry on its own");
  });
});

describe("recommendedActionFor", () => {
  it("splits sweep-covered from edge-only artifacts honestly", () => {
    expect(recommendedActionFor(["addendum", "get_ready_token"])).toContain("will also retry");
    expect(recommendedActionFor(["title_request_email"])).toContain("will not retry on its own");
    const mixed = recommendedActionFor(["window_sticker", "form_pdfs"]);
    expect(mixed).toContain("will retry window_sticker");
    expect(mixed).toContain("form_pdfs will not retry on its own");
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

  it("does not mint a second token when a live pending one exists", async () => {
    const { admin, state } = makeAdmin();
    state("dept_signoff_tokens").listResults.push({
      data: [{ id: "tok-1", expires_at: new Date(Date.now() + 864e5).toISOString() }],
    });
    await ensureReadyToken(admin, "t1", "VIN123", null, null);
    expect(state("dept_signoff_tokens").inserts).toHaveLength(0);
  });

  it("re-mints when every pending token is expired — dead media counts as missing", async () => {
    const { admin, state } = makeAdmin();
    state("dept_signoff_tokens").listResults.push({
      data: [{ id: "tok-1", expires_at: new Date(Date.now() - 864e5).toISOString() }],
    });
    await ensureReadyToken(admin, "t1", "VIN123", "2024 Honda Civic", "l1");
    const rows = state("dept_signoff_tokens").inserts;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: "t1", vin: "VIN123", department: "vehicle" });
  });

  it("treats a pending token without an expires_at as live", async () => {
    const { admin, state } = makeAdmin();
    state("dept_signoff_tokens").listResults.push({ data: [{ id: "tok-1", expires_at: null }] });
    await ensureReadyToken(admin, "t1", "VIN123", null, null);
    expect(state("dept_signoff_tokens").inserts).toHaveLength(0);
  });
});

beforeEach(() => { setArtifactPostGapMs(0); });

describe("ensureComplianceDrafts", () => {
  it("calls the four VIN-idempotent draft RPCs", async () => {
    const { admin, rpcCalls } = makeAdmin();
    await ensureComplianceDrafts(admin, "t1", "VIN123");
    await artifactPostsIdle();
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
    await artifactPostsIdle();
    const rows = state("vehicle_exceptions").inserts;
    expect(rows).toHaveLength(1);
    expect((rows[0].source_values as { artifacts: Record<string, string> }).artifacts).toEqual({
      get_ready: "rls denied",
    });
  });

  const settledSticker = { data: { id: "r1", generation_status: "PUBLISHED" } };

  it("fires generate-vehicle-forms on the resync path when a form draft was missing", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    state("vehicle_listings").maybeSingleResults.push({ data: { id: "l1", condition: "used" } });
    // buyers_guide exists; the K-208 form doc does not — the drafts created
    // here would otherwise sit file-less forever.
    state("generated_documents").listResults.push({
      data: [{ id: "d1", document_type: "buyers_guide", online_url: "https://f/bg.pdf" }],
    });
    state("factory_sticker_records").maybeSingleResults.push(settledSticker);
    await ensureComplianceDrafts(admin, "t1", "VIN123", { supabaseUrl: "https://x.supabase.co", serviceKey: "svc" });
    await artifactPostsIdle();
    await flush();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://x.supabase.co/functions/v1/generate-vehicle-forms",
    ]);
  });

  it("does not re-render when both form documents already exist and the sticker record is settled", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    state("vehicle_listings").maybeSingleResults.push({ data: { id: "l1", condition: "cpo" } });
    state("generated_documents").listResults.push({
      data: [
        { id: "d1", document_type: "buyers_guide", online_url: "https://f/bg.pdf" },
        { id: "d2", document_type: "k208", pdf_url: "https://f/k208.pdf" },
      ],
    });
    state("factory_sticker_records").maybeSingleResults.push(settledSticker);
    await ensureComplianceDrafts(admin, "t1", "VIN123", { supabaseUrl: "https://x.supabase.co", serviceKey: "svc" });
    await artifactPostsIdle();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-renders when a form draft exists but holds no PDF", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    state("vehicle_listings").maybeSingleResults.push({ data: { id: "l1", condition: "used" } });
    // Both rows are present, but the render that should have filled them was
    // rate-limited away. Row presence alone used to read as "done" here, which
    // is how file-less drafts became permanent.
    state("generated_documents").listResults.push({
      data: [
        { id: "d1", document_type: "buyers_guide", online_url: null, pdf_url: null },
        { id: "d2", document_type: "k208", online_url: "", pdf_url: null },
      ],
    });
    state("factory_sticker_records").maybeSingleResults.push(settledSticker);
    await ensureComplianceDrafts(admin, "t1", "VIN123", { supabaseUrl: "https://x.supabase.co", serviceKey: "svc" });
    await artifactPostsIdle();
    await flush();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://x.supabase.co/functions/v1/generate-vehicle-forms",
    ]);
  });

  it("never renders the form PDFs for a new car or without a render target", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    state("vehicle_listings").maybeSingleResults.push({ data: { id: "l1", condition: "new" } });
    state("factory_sticker_records").maybeSingleResults.push(settledSticker);
    await ensureComplianceDrafts(admin, "t1", "VIN123", { supabaseUrl: "https://x.supabase.co", serviceKey: "svc" });
    await artifactPostsIdle();
    await ensureComplianceDrafts(admin, "t1", "VIN456");
    await artifactPostsIdle();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the render when the form-document read fails, instead of rendering blind", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    state("vehicle_listings").maybeSingleResults.push({ data: { id: "l1", condition: "used" } });
    state("generated_documents").listResults.push({ data: null, error: { message: "denied" } });
    state("factory_sticker_records").maybeSingleResults.push(settledSticker);
    await ensureComplianceDrafts(admin, "t1", "VIN123", { supabaseUrl: "https://x.supabase.co", serviceKey: "svc" });
    await artifactPostsIdle();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fires factory-sticker-orchestrate on resync while the record is missing or retryable", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    // A NEW car: the form docs never render, but the factory sticker does.
    state("vehicle_listings").maybeSingleResults.push({ data: { id: "l1", condition: "new" } });
    // no factory_sticker_records row queued → maybeSingle returns null → missing
    await ensureComplianceDrafts(admin, "t1", "VIN123", { supabaseUrl: "https://x.supabase.co", serviceKey: "svc" });
    await artifactPostsIdle();
    await flush();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://x.supabase.co/functions/v1/factory-sticker-orchestrate",
    ]);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as { body: string }).body));
    expect(body).toMatchObject({ action: "orchestrate", tenant_id: "t1", vehicle_id: "l1", reason: "resync" });
  });

  it("re-fires factory-sticker-orchestrate for retryable/renderer-waiting records but not settled ones", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    state("vehicle_listings").maybeSingleResults.push({ data: { id: "l1", condition: "new" } });
    state("factory_sticker_records").maybeSingleResults.push({ data: { id: "r1", generation_status: "FAILED_RETRYABLE" } });
    await ensureComplianceDrafts(admin, "t1", "VIN123", { supabaseUrl: "https://x.supabase.co", serviceKey: "svc" });
    await artifactPostsIdle();
    // READY_TO_GENERATE waits on the renderer — resync must keep re-firing it
    // so the fleet generates the night the renderer lands.
    state("vehicle_listings").maybeSingleResults.push({ data: { id: "l2", condition: "new" } });
    state("factory_sticker_records").maybeSingleResults.push({ data: { id: "r2", generation_status: "READY_TO_GENERATE" } });
    await ensureComplianceDrafts(admin, "t1", "VIN456", { supabaseUrl: "https://x.supabase.co", serviceKey: "svc" });
    await artifactPostsIdle();
    // REVIEW_REQUIRED is a human decision in flight — never re-posted.
    state("vehicle_listings").maybeSingleResults.push({ data: { id: "l3", condition: "new" } });
    state("factory_sticker_records").maybeSingleResults.push({ data: { id: "r3", generation_status: "REVIEW_REQUIRED" } });
    await ensureComplianceDrafts(admin, "t1", "VIN789", { supabaseUrl: "https://x.supabase.co", serviceKey: "svc" });
    await artifactPostsIdle();
    await flush();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://x.supabase.co/functions/v1/factory-sticker-orchestrate",
      "https://x.supabase.co/functions/v1/factory-sticker-orchestrate",
    ]);
  });
});

describe("autoPreload", () => {
  const input = { tenantId: "t1", vin: "VIN123", ymm: "2024 Honda Civic", listingId: "l1" };

  it("runs every draft RPC and every fire-and-forget endpoint for a new listing", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, rpcCalls } = makeAdmin();
    await autoPreload(admin, "https://x.supabase.co", "svc-key", { ...input, emailTitle: true });
    await artifactPostsIdle();
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
      "https://x.supabase.co/functions/v1/marketcheck-specs",
      "https://x.supabase.co/functions/v1/ingest-orchestrate",
      "https://x.supabase.co/functions/v1/description-orchestrate",
      "https://x.supabase.co/functions/v1/factory-sticker-orchestrate",
    ]);
  });

  it("decodes the VIN before the sticker orchestrator is asked to build it", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin } = makeAdmin();
    await autoPreload(admin, "https://x.supabase.co", "svc-key", input);
    await artifactPostsIdle();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const decode = urls.indexOf("https://x.supabase.co/functions/v1/marketcheck-specs");
    const sticker = urls.indexOf("https://x.supabase.co/functions/v1/factory-sticker-orchestrate");
    const description = urls.indexOf("https://x.supabase.co/functions/v1/description-orchestrate");
    expect(decode).toBeGreaterThanOrEqual(0);
    expect(decode).toBeLessThan(sticker);
    expect(decode).toBeLessThan(description);
  });


  it("skips the title email by default and the listing-scoped calls without a listing id", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin } = makeAdmin();
    await autoPreload(admin, "https://x.supabase.co", "svc-key", { ...input, listingId: null });
    await artifactPostsIdle();
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
    await artifactPostsIdle();
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
    await artifactPostsIdle();
    await flush(); await flush();
    const t = state("vehicle_exceptions");
    const all = [...t.inserts, ...t.updates.map((u) => u.patch)];
    const msgs = all.map((r) => JSON.stringify(r.source_values));
    expect(msgs.some((m) => m.includes("http_500"))).toBe(true);
  });
});
