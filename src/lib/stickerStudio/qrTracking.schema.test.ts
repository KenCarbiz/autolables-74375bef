import { describe, it, expect, beforeEach, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────
// The QR tracking writer used to address columns that do not exist on the
// live qr_codes table — token / destination_url / generated_document_id /
// sticker_type — so every create failed and the table stayed empty (0 rows in
// qr_codes, 0 in qr_scan_events). PostgREST answers an unknown column with a
// 400 the resilient wrapper swallows, so the sticker simply fell back to the
// untracked passport URL and nothing looked broken.
//
// LIVE_QR_CODES_COLUMNS is the real table, from information_schema.columns.
// The insert/update payloads are asserted against it here so a column that
// only exists in an unapplied migration cannot reach the client again.
// ──────────────────────────────────────────────────────────────────────

const LIVE_QR_CODES_COLUMNS = new Set([
  "id", "tenant_id", "vehicle_id", "document_id", "code", "target_url",
  "surface", "label", "is_active", "created_at", "updated_at",
]);

interface Recorded { table: string; op: "insert" | "update"; payload: Record<string, unknown> }
interface Selected { table: string; filters: [string, unknown][] }

let inserts: Recorded[] = [];
let updates: Recorded[] = [];
let selects: Selected[] = [];
let existingRows: Record<string, unknown>[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let inserted: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (payload: Record<string, unknown>) => {
        inserted = { ...payload };
        inserts.push({ table, op: "insert", payload: { ...payload } });
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, op: "update", payload: { ...payload } });
        return chain;
      },
      maybeSingle: async () => ({ data: inserted, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
        selects.push({ table, filters: [...filters] });
        return Promise.resolve({ data: existingRows, error: null }).then(resolve);
      },
    };
    return chain;
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: null }) } };
});

const { ensureQrCode, newQrCode } = await import("./qrTracking");

const TENANT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const VEHICLE = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

beforeEach(() => {
  inserts = [];
  updates = [];
  selects = [];
  existingRows = [];
});

describe("newQrCode", () => {
  it("mints the token the NOT NULL, default-less qr_codes.code needs", () => {
    const code = newQrCode();
    expect(code).toMatch(/^[0-9a-f]{16}$/);
    expect(newQrCode()).not.toBe(code);
  });
});

describe("ensureQrCode — writes only columns that exist on qr_codes", () => {
  it("creates a code and returns the /q/ tracking URL", async () => {
    const url = await ensureQrCode({
      tenantId: TENANT,
      vehicleId: VEHICLE,
      stickerType: "window",
      destinationUrl: "https://dealer.test/v/2025-qx80",
    });
    expect(inserts).toHaveLength(1);
    const payload = inserts[0].payload;
    expect(Object.keys(payload).every((k) => LIVE_QR_CODES_COLUMNS.has(k))).toBe(true);
    expect(payload.surface).toBe("window");
    expect(payload.target_url).toBe("https://dealer.test/v/2025-qx80");
    expect(payload.code).toMatch(/^[0-9a-f]{16}$/);
    expect(url).toBe(`${window.location.origin}/q/${payload.code}`);
  });

  it("never sends the legacy column names the empty table was addressed with", async () => {
    await ensureQrCode({
      tenantId: TENANT,
      vehicleId: VEHICLE,
      stickerType: "addendum",
      destinationUrl: "https://dealer.test/v/abc",
      generatedDocumentId: "cccccccc-3333-4333-8333-cccccccccccc",
    });
    const payload = inserts[0].payload;
    for (const legacy of ["token", "destination_url", "generated_document_id", "sticker_type"]) {
      expect(payload).not.toHaveProperty(legacy);
    }
    expect(payload.document_id).toBe("cccccccc-3333-4333-8333-cccccccccccc");
  });

  it("looks the existing code up by surface, not sticker_type", async () => {
    await ensureQrCode({
      tenantId: TENANT, vehicleId: VEHICLE, stickerType: "passport",
      destinationUrl: "https://dealer.test/v/abc",
    });
    const columns = selects[0].filters.map(([c]) => c);
    expect(columns).toContain("surface");
    expect(columns).not.toContain("sticker_type");
  });

  it("refreshes an existing row through target_url/document_id keyed on code", async () => {
    existingRows = [{ code: "0123456789abcdef" }];
    const url = await ensureQrCode({
      tenantId: TENANT, vehicleId: VEHICLE, stickerType: "window",
      destinationUrl: "https://dealer.test/v/new-slug",
    });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0].payload).every((k) => LIVE_QR_CODES_COLUMNS.has(k))).toBe(true);
    expect(updates[0].payload.target_url).toBe("https://dealer.test/v/new-slug");
    expect(url).toBe(`${window.location.origin}/q/0123456789abcdef`);
  });
});
