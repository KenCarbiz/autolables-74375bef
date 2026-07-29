import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  artifactPostsIdle,
  setArtifactPostGapMs,
  autoPreload,
  ensureComplianceDrafts,
  ensureOemDocLinks,
  ensureReadyToken,
  recommendedActionFor,
  recordArtifactFailure,
  resetOemHarvestDedupe,
} from "./intake-autoprovision";
import { oemDocKeyFromYmm, oemDocKeyString, resolveOemMake } from "./oemDocKey";

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

function makeAdmin(rpcErrors: Record<string, string> = {}, rpcData: Record<string, unknown> = {}) {
  const tables: Record<string, TableState> = {};
  const state = (t: string): TableState =>
    (tables[t] ||= { maybeSingleResults: [], listResults: [], inserts: [], updates: [] });
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  // The real try_acquire_service_lock answers true to the first caller; the
  // fake grants it unless a case says otherwise, so the harvest is exercised.
  const defaultRpcData: Record<string, unknown> = { try_acquire_service_lock: true };

  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (rpcErrors[fn]) return { data: null, error: { message: rpcErrors[fn] } };
      const data = fn in rpcData ? rpcData[fn] : defaultRpcData[fn] ?? null;
      return { data, error: null };
    },
    from: (table: string) => {
      const t = state(table);
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (k: string, v: unknown) => { filters[k] = v; return builder; },
        in: (k: string, v: unknown) => { filters[k] = v; return builder; },
        ilike: (k: string, v: unknown) => { filters[k] = v; return builder; },
        order: () => builder,
        limit: () => builder,
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

const OEM_BROCHURE_URL = "https://x.supabase.co/functions/v1/oem-brochure";
const OEM_MANUAL_URL = "https://x.supabase.co/functions/v1/oem-owners-manual";
const isOemHarvest = (url: string) => url === OEM_BROCHURE_URL || url === OEM_MANUAL_URL;

/** A fetch fake that answers the OEM harvests with a real JSON body. */
const harvestFetch = (body: unknown, status = 200) =>
  vi.fn(async (url: unknown) => (isOemHarvest(String(url))
    ? { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
    : { ok: true, status: 200 }));

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

beforeEach(() => { setArtifactPostGapMs(0); resetOemHarvestDedupe(); });

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
    expect(rpcCalls.map((c) => c.fn).filter((f) => f.startsWith("create_draft"))).toEqual([
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
      OEM_BROCHURE_URL,
      OEM_MANUAL_URL,
    ]);
  });

  it("decodes the VIN before asking the sticker orchestrator to build", async () => {
    // The orchestrator never fetches a build sheet on an automatic run, so if
    // the decode has not already landed on the listing it parks the record at
    // PENDING_DATA and the sticker never appears without a human pressing
    // Generate. The post queue is serial, so this ordering is the guarantee.
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin } = makeAdmin();
    await autoPreload(admin, "https://x.supabase.co", "svc-key", input);
    await artifactPostsIdle();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const decodedAt = urls.indexOf("https://x.supabase.co/functions/v1/marketcheck-specs");
    const stickerAt = urls.indexOf("https://x.supabase.co/functions/v1/factory-sticker-orchestrate");
    expect(decodedAt).toBeGreaterThanOrEqual(0);
    expect(stickerAt).toBeGreaterThan(decodedAt);
  });

  it("skips the title email by default and the listing-scoped calls without a listing id", async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin } = makeAdmin();
    await autoPreload(admin, "https://x.supabase.co", "svc-key", { ...input, listingId: null });
    await artifactPostsIdle();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    // The OEM link harvests are model-scoped, not listing-scoped, so they are
    // the one pair that still runs for a vehicle with no listing row yet.
    expect(urls).toEqual([
      "https://x.supabase.co/functions/v1/generate-vehicle-forms",
      "https://x.supabase.co/functions/v1/oem-window-sticker",
      OEM_BROCHURE_URL,
      OEM_MANUAL_URL,
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

  it("does not harvest OEM links for a ymm with no leading model year", async () => {
    // The passport reads the make out of token 1, so a ymm that does not start
    // with a year produces a key nothing will ever query. Paying for it is the
    // worst of both outcomes.
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin } = makeAdmin();
    await autoPreload(admin, "https://x.supabase.co", "svc-key", { ...input, ymm: "Honda Civic EX", listingId: null });
    await artifactPostsIdle();
    expect(fetchMock.mock.calls.map((c) => String(c[0])).filter(isOemHarvest)).toEqual([]);
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

describe("oemDocKeyFromYmm", () => {
  it("splits a ymm exactly the way the passport does, trim and all", () => {
    // public-listing-view: parts[0] year, parts[1] make, parts.slice(2) model.
    // The trim is deliberately left in the model — storing "QX80" while the
    // passport asks for "QX80 Sensory" buys a link the shopper never sees.
    expect(oemDocKeyFromYmm("2025 INFINITI QX80 Sensory")).toEqual({
      year: 2025, make: "INFINITI", model: "QX80 Sensory",
    });
    expect(oemDocKeyFromYmm("2024 Honda Civic")).toEqual({
      year: 2024, make: "Honda", model: "Civic",
    });
    expect(oemDocKeyFromYmm("2024   Nissan    Rogue  SV ")).toEqual({
      year: 2024, make: "Nissan", model: "Rogue SV",
    });
  });

  it("refuses a ymm that cannot produce the key the passport queries", () => {
    expect(oemDocKeyFromYmm("Honda Civic EX")).toBeNull();
    expect(oemDocKeyFromYmm("2024 Honda")).toBeNull();
    expect(oemDocKeyFromYmm("")).toBeNull();
    expect(oemDocKeyFromYmm(null)).toBeNull();
  });

  it("keys case-insensitively on (make, model, year), like the unique index", () => {
    const a = oemDocKeyFromYmm("2024 Nissan Rogue SV")!;
    const b = oemDocKeyFromYmm("2024 NISSAN rogue sv")!;
    expect(oemDocKeyString(a)).toBe(oemDocKeyString(b));
    expect(oemDocKeyString(oemDocKeyFromYmm("2023 Nissan Rogue SV")!)).not.toBe(oemDocKeyString(a));
  });
});

describe("resolveOemMake", () => {
  const domains = { honda: ["honda.com"], "land rover": ["landroverusa.com"] };

  it("resolves a one-word make untouched", () => {
    expect(resolveOemMake("Honda", "Civic", domains)).toEqual({
      domains: ["honda.com"], make: "Honda", model: "Civic",
    });
  });

  it("rejoins a two-word make split across the make/model boundary", () => {
    // Every ymm reader takes token 1 as the make, so "2024 Land Rover
    // Defender 110" arrives as make "Land". Before this, every Land Rover on
    // every lot answered make_not_supported.
    expect(resolveOemMake("Land", "Rover Defender 110", domains)).toEqual({
      domains: ["landroverusa.com"], make: "Land Rover", model: "Defender 110",
    });
  });

  it("still refuses a make no allow-list entry can explain", () => {
    expect(resolveOemMake("Koenigsegg", "Jesko", domains)).toBeNull();
    expect(resolveOemMake("Land", "Rover", domains)).toBeNull();
  });
});

describe("ensureOemDocLinks", () => {
  const KEY = { make: "Nissan", model: "Rogue SV", year: 2024 };
  const YMM = "2024 Nissan Rogue SV";

  const harvestUrls = (m: { mock: { calls: unknown[][] } }) =>
    m.mock.calls.map((c) => String(c[0])).filter(isOemHarvest);

  it("harvests each document exactly once for a whole sync window of one model", async () => {
    // The requirement in one test: 40 vehicles of one model must cost one
    // brochure harvest and one manual harvest, not 40 of each.
    const fetchMock = harvestFetch({ ok: true, cached: false });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin } = makeAdmin();
    for (let i = 0; i < 40; i++) {
      await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", `VIN${i}`, YMM);
    }
    await artifactPostsIdle();
    expect(harvestUrls(fetchMock)).toEqual([OEM_BROCHURE_URL, OEM_MANUAL_URL]);
  });

  it("sends the passport's key, verbatim, as the body", async () => {
    const fetchMock = harvestFetch({ ok: true, cached: false });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin } = makeAdmin();
    await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", "VIN1", YMM);
    await artifactPostsIdle();
    const call = fetchMock.mock.calls.find((c) => String(c[0]) === OEM_BROCHURE_URL)!;
    expect(JSON.parse(String((call[1] as { body: string }).body))).toEqual(KEY);
  });

  it("spends nothing when the link cache already answers the passport", async () => {
    const fetchMock = harvestFetch({ ok: true, cached: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    // Exact year for the brochure; a year-less portal row for the manual —
    // both are rows the passport's own pick would show.
    state("oem_brochure_links").listResults.push({ data: [{ id: "b1", year: 2024 }] });
    state("oem_owners_manual_links").listResults.push({ data: [{ id: "m1", year: null }] });
    await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", "VIN1", YMM);
    await artifactPostsIdle();
    expect(harvestUrls(fetchMock)).toEqual([]);
  });

  it("spends nothing when the negative cache says we already looked", async () => {
    // The expensive case: a model with no brochure writes no link row, so
    // without this every night re-runs the full paid query set forever.
    const fetchMock = harvestFetch({ ok: true, cached: false });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    for (const outcome of ["not_found", "unsupported"]) {
      state("oem_packet_backfill_attempts").maybeSingleResults.push({
        data: {
          kind: outcome === "unsupported" ? "owners_manual" : "brochure",
          make_key: "nissan", model_key: "rogue sv", year_key: 2024,
          outcome, attempts: 1, last_attempt_at: new Date().toISOString(),
        },
      });
    }
    await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", "VIN1", YMM);
    await artifactPostsIdle();
    expect(harvestUrls(fetchMock)).toEqual([]);
  });

  it("spends nothing when the negative cache itself cannot be read", async () => {
    // No negative cache means no way to stop tomorrow re-asking, so the safe
    // reading of an unreadable attempt table is "do not spend".
    const fetchMock = harvestFetch({ ok: true, cached: false });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    state("oem_packet_backfill_attempts").maybeSingleResults.push(
      { data: null, error: { message: "relation does not exist" } } as unknown as { data: unknown },
      { data: null, error: { message: "relation does not exist" } } as unknown as { data: unknown },
    );
    await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", "VIN1", YMM);
    await artifactPostsIdle();
    expect(harvestUrls(fetchMock)).toEqual([]);
  });

  it("spends nothing when another runner holds the harvest lock", async () => {
    const fetchMock = harvestFetch({ ok: true, cached: false });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin, rpcCalls } = makeAdmin({}, { try_acquire_service_lock: false });
    await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", "VIN1", YMM);
    await artifactPostsIdle();
    expect(harvestUrls(fetchMock)).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn === "try_acquire_service_lock")).toHaveLength(2);
  });

  it("caps how many harvests one isolate can dispatch, leaving the rest to the sweep", async () => {
    const fetchMock = harvestFetch({ ok: true, cached: false });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { admin } = makeAdmin();
    // Ten distinct models in one feed page: the cap, not the feed, decides.
    for (let i = 0; i < 10; i++) {
      await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", `VIN${i}`, `202${i % 4} Honda Model${i}`);
    }
    await artifactPostsIdle();
    expect(harvestUrls(fetchMock)).toHaveLength(6);
  });

  it("writes the verdict to the shared negative cache, but never for a throttle", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => (isOemHarvest(String(url))
      ? { ok: false, status: 404, text: async () => JSON.stringify({ error: "brochure_not_found" }) }
      : { ok: true, status: 200 })) as unknown as typeof fetch;
    const { admin, rpcCalls } = makeAdmin();
    await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", "VIN1", YMM);
    await artifactPostsIdle();
    const verdicts = rpcCalls.filter((c) => c.fn === "record_packet_backfill_attempt");
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0].args).toMatchObject({
      _kind: "brochure", _make: "Nissan", _model: "Rogue SV", _year: 2024, _outcome: "not_found",
    });

    // A 429 teaches us nothing about the model — remembering it as "no
    // brochure" would be the negative cache lying.
    resetOemHarvestDedupe();
    const { admin: admin2, rpcCalls: rpc2 } = makeAdmin();
    globalThis.fetch = vi.fn(async (url: unknown) => (isOemHarvest(String(url))
      ? { ok: false, status: 429, text: async () => "Rate limit exceeded for function. Retry after 900ms." }
      : { ok: true, status: 200 })) as unknown as typeof fetch;
    await ensureOemDocLinks(admin2, "https://x.supabase.co", "svc", "t1", "VIN1", YMM);
    await artifactPostsIdle();
    expect(rpc2.filter((c) => c.fn === "record_packet_backfill_attempt")).toHaveLength(0);
  });

  it("does not open an exception for a model the manufacturer simply does not publish", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => (isOemHarvest(String(url))
      ? { ok: false, status: 404, text: async () => JSON.stringify({ error: "make_not_supported" }) }
      : { ok: true, status: 200 })) as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", "VIN1", YMM);
    await artifactPostsIdle();
    expect(state("vehicle_exceptions").inserts).toHaveLength(0);
  });

  it("treats a harvest that did not persist as a failure, and frees the lock for a retry", async () => {
    // oem-brochure answers 500 brochure_link_not_saved when the row did not
    // land. Reporting that as success is what left the passport empty while
    // the dealer was told the document was linked.
    globalThis.fetch = vi.fn(async (url: unknown) => (isOemHarvest(String(url))
      ? { ok: false, status: 500, text: async () => JSON.stringify({ error: "brochure_link_not_saved" }) }
      : { ok: true, status: 200 })) as unknown as typeof fetch;
    const { admin, state, rpcCalls } = makeAdmin();
    await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", "VIN1", YMM);
    await artifactPostsIdle();
    await flush();
    const artifacts = state("vehicle_exceptions").inserts.flatMap((r) =>
      Object.keys((r.source_values as { artifacts: Record<string, string> }).artifacts));
    expect(artifacts).toContain("oem_brochure");
    expect(artifacts).toContain("oem_owners_manual");
    expect(rpcCalls.filter((c) => c.fn === "release_service_lock")).toHaveLength(2);
    // An error is a transient verdict, not "this model has no brochure".
    const verdicts = rpcCalls.filter((c) => c.fn === "record_packet_backfill_attempt");
    expect(verdicts.map((v) => v.args._outcome)).toEqual(["error", "error"]);
  });

  it("does not claim a failure when the link landed after our client gave up", async () => {
    // The harvest is its own invocation and outlives our budget; the row is
    // the truth, so it is re-read before anything is called a failure.
    globalThis.fetch = vi.fn(async (url: unknown) => (isOemHarvest(String(url))
      ? { ok: false, status: 500, text: async () => "boom" }
      : { ok: true, status: 200 })) as unknown as typeof fetch;
    const { admin, state } = makeAdmin();
    // First read (pre-dispatch) misses for both; the post-failure re-read hits.
    state("oem_brochure_links").listResults.push(
      { data: [] }, { data: [] }, { data: [{ id: "b1", year: 2024 }] });
    state("oem_owners_manual_links").listResults.push(
      { data: [] }, { data: [] }, { data: [{ id: "m1", year: 2024 }] });
    await ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", "VIN1", YMM);
    await artifactPostsIdle();
    await flush();
    expect(state("vehicle_exceptions").inserts).toHaveLength(0);
  });

  it("never throws back into the ingest loop", async () => {
    globalThis.fetch = okFetch() as unknown as typeof fetch;
    const admin = { rpc: async () => ({ data: true, error: null }), from: () => { throw new Error("db down"); } };
    await expect(
      ensureOemDocLinks(admin, "https://x.supabase.co", "svc", "t1", "VIN1", YMM),
    ).resolves.toBeUndefined();
  });
});
