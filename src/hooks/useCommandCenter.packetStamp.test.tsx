import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createCommandDb, type CommandDb, type MockRow } from "@/test/mocks/commandCenterDb";
import { PACKET_PRINTED_MESSAGE, PACKET_SHEET_TIMEOUT_MS, renderPacketPrintSheet } from "@/lib/commandCenter/packetPrintSheet";

// ──────────────────────────────────────────────────────────────────────
// T3 — NO STAMP WITHOUT PAPER.
//
// printed_at / print_count are the evidence a regulator reads as what was
// posted on the car, and `printed` has no mark_printed transition, so a false
// stamp is permanent. Every test here drives the REAL button —
// usePrintCenter().printCompletePacket() — through a real (fake) print window,
// because the two previous rounds stamped a set the sheet had already filtered.
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
let openCalls: number;

const makeSheet = (): FakeWindow => {
  const w: FakeWindow = {
    closed: false,
    written: "",
    document: {
      open: () => {},
      write: (html: string) => { w.written += html; },
      close: () => {},
    },
    close: () => { w.closed = true; },
  };
  return w;
};

const confirmPrinted = async () => {
  // The sheet is opened after the document read resolves, so wait for it to
  // exist rather than guessing a microtask count.
  await waitFor(() => expect(sheet.written).not.toBe(""));
  const ev = new MessageEvent("message", { data: { type: PACKET_PRINTED_MESSAGE } });
  Object.defineProperty(ev, "source", { value: sheet });
  window.dispatchEvent(ev);
};

const doc = (over: MockRow = {}): MockRow => ({
  id: "d1", tenant_id: TENANT, vehicle_id: VEHICLE_ID, template_id: "t",
  document_type: "window", document_status: "approved", version: 3,
  pdf_url: "https://files.test/win.pdf", png_url: null, online_url: null,
  print_count: 0, printed_at: null, published_at: null, created_at: "2026-07-02T00:00:00Z",
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

const stampedIds = (): string[] =>
  db.updates
    .filter((u) => u.table === "generated_documents" && u.patch.document_status === "printed")
    .map((u) => String(u.filters.find((f) => f.column === "id")?.value ?? ""));

beforeEach(() => {
  openCalls = 0;
  sheet = makeSheet();
  vi.spyOn(window, "open").mockImplementation(() => {
    openCalls += 1;
    return sheet as unknown as Window;
  });
});
afterEach(() => { vi.restoreAllMocks(); });

// D7. safeDocumentUrl drops a relative storage path by design
// (packetPrintSheet.test.ts:36). The document never reaches the sheet, the
// employee confirms the documents that DID, and this one used to be stamped
// anyway — permanently, because allowedActions("printed") has no mark_printed.
describe("T3/D7 — only what reached the sheet is stamped", () => {
  it("does not stamp a document the URL allowlist dropped", async () => {
    seed([
      doc({ id: "on-sheet", pdf_url: "https://files.test/win.pdf" }),
      doc({ id: "dropped", document_type: "buyers_guide", pdf_url: "vehicle-docs/abc.pdf" }),
    ]);
    const view = await mountPrintCenter();
    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      const pending = view.result.current.printCompletePacket();
      await confirmPrinted();
      outcome = await pending;
    });
    expect(sheet.written).not.toContain("vehicle-docs/abc.pdf");
    expect(stampedIds()).toEqual(["on-sheet"]);
    expect(outcome?.ok).toBe(true);
  });

  it("reports a document with no usable file as Blocked rather than Ready", async () => {
    seed([doc({ id: "dropped", pdf_url: "vehicle-docs/abc.pdf" })]);
    const view = await mountPrintCenter();
    const row = view.result.current.data?.documents.find((d) => d.id === "dropped");
    expect(row?.printStatus.label).toBe("Blocked");
    expect(view.result.current.data?.counts.ready).toBe(0);
  });
});

// D8. The sheet used to say "Print record filed. You can close this tab." on
// click, unconditionally, never waiting for an ack — and `window.opener &&`
// swallowed a null opener entirely.
describe("T3/D8 — the sheet does not claim a record it has not been told was filed", () => {
  const html = () => renderPacketPrintSheet(
    { ymm: "2025 INFINITI QX80", vin: VIN, stockNumber: "H12345" },
    [{ id: "d1", label: "Used-Car Sticker", version: "v3", url: "https://files.test/win.pdf" }],
  );

  it("waits for the app to acknowledge before saying the record was filed", () => {
    const source = html();
    expect(source).toContain("autolabels:packet-filed");
    // The confirmation text must not be reachable from the click handler alone.
    const clickHandler = source.slice(source.indexOf('addEventListener("click"'));
    const ackHandler = source.slice(source.indexOf('addEventListener("message"'));
    expect(clickHandler.slice(0, clickHandler.indexOf("})"))).not.toContain("Print record filed");
    expect(ackHandler).toContain("Print record filed");
  });

  it("says so when there is no opener to report to", () => {
    expect(html()).toContain("lost its connection");
  });
});

// D9. handle.printed used to resolve only on postMessage or on win.closed, so
// leaving the sheet tab open and returning to the app latched printing.current
// true for the rest of the session: "A packet release is already in progress."
describe("T3/D9 — the packet button cannot latch dead", () => {
  it("gives up on an abandoned sheet and allows another release", async () => {
    seed([doc({ id: "on-sheet" })]);
    const view = await mountPrintCenter();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let first: { ok: boolean; error?: string } | undefined;
      const pending = view.result.current.printCompletePacket().then((r) => { first = r; });
      await vi.waitFor(() => expect(sheet.written).not.toBe(""));
      // The employee never confirms and never closes the tab.
      vi.advanceTimersByTime(PACKET_SHEET_TIMEOUT_MS + 1000);
      await pending;
      expect(first?.ok).toBe(false);
      expect(stampedIds()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }

    const second = view.result.current.printCompletePacket();
    await waitFor(() => expect(openCalls).toBe(2));
    expect(sheet.written).not.toBe("");
    sheet.closed = true;
    const res = await second;
    expect(res.error).not.toMatch(/already in progress/i);
  });

  it("releases the guard when the screen unmounts mid-release", async () => {
    seed([doc({ id: "on-sheet" })]);
    const view = await mountPrintCenter();
    let settled = false;
    const pending = view.result.current.printCompletePacket().then(() => { settled = true; });
    await waitFor(() => expect(sheet.written).not.toBe(""));
    view.unmount();
    await pending;
    expect(settled).toBe(true);
    expect(stampedIds()).toEqual([]);
  });
});

// D10. Doc rows are read, then an UNBOUNDED human wait, then the write. A
// manager regenerating the addendum mid-wait supersedes the row this loop is
// holding; without a precondition the superseded row is written back to
// `printed`, re-enters liveDocuments and competes with the new version.
describe("T3/D10 — the stamp cannot resurrect a row superseded during the wait", () => {
  it("writes with the status it read", async () => {
    seed([doc({ id: "on-sheet" })]);
    const view = await mountPrintCenter();
    await act(async () => {
      const pending = view.result.current.printCompletePacket();
      await confirmPrinted();
      await pending;
    });
    const stamp = db.updates.find((u) => u.table === "generated_documents" && u.patch.document_status === "printed");
    expect(stamp?.filters.some((f) => f.column === "document_status" && f.value === "approved")).toBe(true);
  });

  it("stamps nothing when the row was superseded while the employee was printing", async () => {
    seed([doc({ id: "on-sheet" })]);
    const view = await mountPrintCenter();
    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      const pending = view.result.current.printCompletePacket();
      await waitFor(() => expect(sheet.written).not.toBe(""));
      // supersedePriorLive, fired by a regenerate on another tab.
      db.rows("generated_documents")[0].document_status = "superseded";
      await confirmPrinted();
      outcome = await pending;
    });
    expect(db.rows("generated_documents")[0].document_status).toBe("superseded");
    expect(outcome?.ok).toBe(false);
  });
});

// D11. openPacketPrintSheet returned null for THREE causes and all three
// reported "Allow pop-ups for this site."
describe("T3/D11 — the three ways a sheet fails to open are three messages", () => {
  it("names a blocked pop-up", async () => {
    seed([doc({ id: "on-sheet" })]);
    vi.spyOn(window, "open").mockImplementation(() => null);
    const view = await mountPrintCenter();
    const res = await view.result.current.printCompletePacket();
    expect(res.error).toMatch(/pop-ups/i);
  });

  it("does not blame pop-ups when the window could not be written to", async () => {
    seed([doc({ id: "on-sheet" })]);
    const broken = makeSheet();
    broken.document.write = () => { throw new Error("denied"); };
    vi.spyOn(window, "open").mockImplementation(() => broken as unknown as Window);
    const view = await mountPrintCenter();
    const res = await view.result.current.printCompletePacket();
    expect(res.error).not.toMatch(/pop-ups/i);
    expect(res.ok).toBe(false);
  });
});
