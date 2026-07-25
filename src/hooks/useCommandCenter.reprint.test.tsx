import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createCommandDb, type CommandDb, type MockRow } from "@/test/mocks/commandCenterDb";
import { PACKET_PRINTED_MESSAGE } from "@/lib/commandCenter/packetPrintSheet";

// ──────────────────────────────────────────────────────────────────────
// B6a — Reprint. A reprint puts the SAME released document back on paper. It
// increments print_count under the same human-confirmation pattern as the
// packet, and it must NEVER transition document_status: printed_at and the
// status are the record of the FIRST release, and `printed` is already the
// row's state — rewriting it, or stamping printed_at again, would rewrite the
// regulator's evidence of when the paper first went on the car.
// ──────────────────────────────────────────────────────────────────────

let db: CommandDb;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.from(table),
    rpc: (fn: string, args?: MockRow) => db.rpc(fn, args ?? {}),
    functions: { invoke: (fn: string, opts?: { body?: MockRow }) => db.invoke(fn, opts) },
  },
}));

const TENANT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const VEHICLE_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const VIN = "JN8AZ2NE0P9300001";

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: TENANT }, loading: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isAdmin: false }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => ({ member: { role: "manager" }, loading: false }),
}));

interface FakeWindow {
  closed: boolean;
  written: string;
  document: { open(): void; write(html: string): void; close(): void };
  close(): void;
}

let sheet: FakeWindow;

const makeSheet = (): FakeWindow => {
  const w: FakeWindow = {
    closed: false,
    written: "",
    document: { open: () => {}, write: (html: string) => { w.written += html; }, close: () => {} },
    close: () => { w.closed = true; },
  };
  return w;
};

const confirmPrinted = async () => {
  await waitFor(() => expect(sheet.written).not.toBe(""));
  const ev = new MessageEvent("message", { data: { type: PACKET_PRINTED_MESSAGE } });
  Object.defineProperty(ev, "source", { value: sheet });
  window.dispatchEvent(ev);
};

const doc = (over: MockRow = {}): MockRow => ({
  id: "d1", tenant_id: TENANT, vehicle_id: VEHICLE_ID, template_id: "t",
  document_type: "buyers_guide", document_status: "printed", version: 2,
  pdf_url: "https://files.test/bg.pdf", png_url: null, online_url: null,
  print_count: 1, printed_at: "2026-07-05T00:00:00Z", published_at: null,
  created_at: "2026-07-02T00:00:00Z",
  ...over,
});

const seed = (docs: MockRow[]) => {
  db = createCommandDb({
    tables: {
      vehicle_listings: [{
        id: VEHICLE_ID, tenant_id: TENANT, vin: VIN, ymm: "2025 INFINITI QX80",
        trim: null, condition: "used", mileage: 12000, hero_image_url: null,
        mc_attributes: { stock_no: "H12345" }, created_at: "2026-07-01T10:00:00Z",
        slug: "qx80", status: "published",
      }],
      generated_documents: docs,
      qr_codes: [],
      dept_signoff_tokens: [],
      safety_inspections: [],
    },
  });
};

const mountPrintCenter = async () => {
  const { usePrintCenter } = await import("@/hooks/useCommandCenter");
  const view = renderHook(() => usePrintCenter(VEHICLE_ID));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
};

beforeEach(() => {
  sheet = makeSheet();
  vi.spyOn(window, "open").mockImplementation(() => sheet as unknown as Window);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("B6a — reprint increments the copy count and nothing else", () => {
  it("increments print_count without any status transition", async () => {
    seed([doc()]);
    const view = await mountPrintCenter();
    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      const pending = view.result.current.reprintDocument("d1");
      await confirmPrinted();
      outcome = await pending;
    });
    expect(outcome?.ok).toBe(true);
    const updates = db.updates.filter((u) => u.table === "generated_documents");
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ print_count: 2 });
    expect("document_status" in updates[0].patch).toBe(false);
    expect("printed_at" in updates[0].patch).toBe(false);
    const row = db.rows("generated_documents")[0];
    expect(row.document_status).toBe("printed");
    expect(row.printed_at).toBe("2026-07-05T00:00:00Z");
    expect(row.print_count).toBe(2);
  });

  it("files a document_reprinted event naming the copy", async () => {
    seed([doc()]);
    const view = await mountPrintCenter();
    await act(async () => {
      const pending = view.result.current.reprintDocument("d1");
      await confirmPrinted();
      await pending;
    });
    const events = db.inserts.filter((i) =>
      i.table === "document_lifecycle_events" && i.values.event_type === "document_reprinted");
    expect(events).toHaveLength(1);
    expect((events[0].values.metadata as MockRow).document_id).toBe("d1");
    expect((events[0].values.metadata as MockRow).copy).toBe(2);
  });

  it("records nothing when the sheet is closed without confirmation", async () => {
    seed([doc()]);
    const view = await mountPrintCenter();
    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      const pending = view.result.current.reprintDocument("d1");
      await waitFor(() => expect(sheet.written).not.toBe(""));
      sheet.closed = true;
      outcome = await pending;
    });
    expect(outcome?.ok).toBe(false);
    expect(db.updates.filter((u) => u.table === "generated_documents")).toEqual([]);
  });

  it("refuses a document that was never printed", async () => {
    seed([doc({ document_status: "approved", print_count: 0, printed_at: null })]);
    const view = await mountPrintCenter();
    const res = await view.result.current.reprintDocument("d1");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not been printed/i);
    expect(db.updates).toEqual([]);
  });

  it("refuses a printed document whose file is gone", async () => {
    seed([doc({ pdf_url: null, png_url: null })]);
    const view = await mountPrintCenter();
    const res = await view.result.current.reprintDocument("d1");
    expect(res.ok).toBe(false);
    expect(db.updates).toEqual([]);
  });
});

describe("B6a — the Print Center row carries the reprint offer", () => {
  it("offers Reprint (copy N) on a printed row", async () => {
    seed([doc({ print_count: 3 })]);
    const view = await mountPrintCenter();
    const row = view.result.current.data?.documents.find((d) => d.id === "d1");
    expect(row?.reprintCopy).toBe(4);
  });

  it("keeps the packet refusal pointing at Reprint once everything is printed", async () => {
    seed([doc()]);
    const view = await mountPrintCenter();
    expect(view.result.current.data?.packetBlockedReason).toMatch(/Reprint/);
    expect(view.result.current.data?.packetBlockedReason).not.toMatch(/not available from this screen/i);
  });

  it("keeps the plain refusal for rows that were never printed", async () => {
    seed([doc({ document_status: "draft", print_count: 0, printed_at: null, pdf_url: null })]);
    const view = await mountPrintCenter();
    const row = view.result.current.data?.documents.find((d) => d.id === "d1");
    expect(row?.reprintCopy).toBeUndefined();
    expect(view.result.current.data?.packetBlockedReason).not.toMatch(/Reprint/);
  });
});
