import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createCommandDb, type CommandDb, type MockRow } from "@/test/mocks/commandCenterDb";

// ──────────────────────────────────────────────────────────────────────
// T2 — REACHABILITY.
//
// INVARIANT: every row in the "Automation Complete" denominator has a finished
// state that a writer IN THIS REPO can actually produce.
//
// The previous two attempts asserted this against a hand-authored fixture —
// `{ label_type: "key_tag", status: "printed" }` — a row shape nothing in
// src/** or supabase/** emits. So the test passed while automationDone could
// never equal automationTotal and "Ready to Market" stayed a dead branch.
//
// Here the finished state is constructed through the writer the app actually
// calls (`issue_vehicle_ready_token`, exactly as VehicleQrPrint.tsx:32 calls
// it), and the loader is the real one.
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
const MASTER = "mv-1";

// A used car where every artifact the automation owns has been finished by a
// writer that exists: documents generated and published, K-208 signed, addendum
// signed by the customer, recall checked clean, get-ready authorized and worked
// to completion, description published. The QR sheet is minted separately, by
// the RPC, so a test can show the difference it makes.
const finishedUsedCar = (): Record<string, MockRow[]> => ({
  vehicle_listings: [{
    id: VEHICLE_ID, tenant_id: TENANT, vin: VIN, ymm: "2025 INFINITI QX80",
    trim: "Sensory AWD", condition: "used", mileage: 12000, hero_image_url: null,
    mc_attributes: { stock_no: "H12345" }, created_at: "2026-07-01T10:00:00Z",
    slug: "2025-infiniti-qx80", status: "published", published_at: "2026-07-06T00:00:00Z",
    packet_modules: null, recall_check: { checked_at: "2026-07-04T00:00:00Z", open_recall_count: 0 },
    recall_checked_at: "2026-07-04T00:00:00Z", open_recall_count: 0,
  }],
  generated_documents: [
    { id: "d1", tenant_id: TENANT, vehicle_id: VEHICLE_ID, template_id: "t", document_type: "buyers_guide", document_status: "published", version: 2, pdf_url: "https://files.test/bg.pdf", published_at: "2026-07-06T00:00:00Z", created_at: "2026-07-02T00:00:00Z" },
    { id: "d2", tenant_id: TENANT, vehicle_id: VEHICLE_ID, template_id: "t", document_type: "window", document_status: "approved", version: 3, pdf_url: "https://files.test/win.pdf", created_at: "2026-07-02T00:00:00Z" },
  ],
  safety_inspections: [{ id: "si1", tenant_id: TENANT, vin: VIN, status: "signed", result: "pass", form_type: "K208", signed_at: "2026-07-02T00:00:00Z", created_at: "2026-07-02T00:00:00Z" }],
  addendums: [{ id: "ad1", tenant_id: TENANT, vehicle_vin: VIN, status: "signed", lifecycle_status: "live", accepted_at: "2026-07-03T00:00:00Z", customer_signed_at: "2026-07-03T12:00:00Z", ready_at: "2026-07-03T00:00:00Z", created_at: "2026-07-02T00:00:00Z", getready_dispatched_at: null }],
  get_ready_records: [{ id: "gr1", tenant_id: TENANT, vin: VIN, status: "ready", created_at: "2026-07-01T11:00:00Z", get_ready_complete_date: "2026-07-05T00:00:00Z", inspection_complete: true, items: [
    { id: "g1", label: "Detail — interior", category: "detail", assignedTo: "", status: "complete" },
    { id: "g2", label: "Oil service", category: "service", assignedTo: "", status: "complete" },
  ] }],
  description_cases: [{ id: "dc1", tenant_id: TENANT, vehicle_id: VEHICLE_ID, status: "PUBLISHED", current_master_version_id: MASTER, published_master_version_id: MASTER, open_exception_count: 0 }],
  description_channel_versions: Array.from({ length: 6 }, (_, i) => ({ id: `cv${i}`, tenant_id: TENANT, master_version_id: MASTER })),
  audit_log: [{ action: "getready_dispatched", entity_type: "vehicle", entity_id: VIN, store_id: TENANT, created_at: "2026-07-04T09:00:00Z", details: {} }],
  recall_service_tasks: [],
  // Deliberately empty. See the writer-inventory test below: nothing in this
  // repo can put a key_tag row here, let alone one with status 'printed'.
  zebra_print_jobs: [],
  qr_codes: [],
  dept_signoff_tokens: [],
});

const load = async () => {
  const { loadVinCommand } = await import("@/hooks/useCommandCenter");
  const { createSourceReader } = await import("@/lib/commandCenter/sourceReader");
  return loadVinCommand(createSourceReader(), TENANT, VEHICLE_ID);
};

// Exactly what /print/vehicle-qr/:vin does on mount (VehicleQrPrint.tsx:32).
// One token backs BOTH cut-outs on that sheet: the rear-glass cling and the
// key-fob tag.
const printVehicleQrSheet = async () => {
  const { supabase } = await import("@/integrations/supabase/client");
  // deno-lint-ignore no-explicit-any
  const { data } = await (supabase as unknown as { rpc: (f: string, a: MockRow) => Promise<{ data: unknown }> })
    .rpc("issue_vehicle_ready_token", { p_tenant_id: TENANT, p_vin: VIN });
  return data;
};

beforeEach(() => { db = createCommandDb({ tables: finishedUsedCar() }); });

// The D4 decision, recorded as an executable claim rather than a caveat: there
// is no out-of-repo print agent to document, because no code path anywhere in
// this repository can even create a key_tag job, never mind advance one to
// 'printed'. A denominator row that depends on that state is unreachable, so it
// does not belong in the denominator.
describe("T2/D4 — the key-tag zebra job has no writer", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".git") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|sql)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  };
  const sources = () => [...walk("src"), ...walk("supabase")]
    .filter((p) => !p.endsWith("src/integrations/supabase/types.ts"))
    .map((p) => ({ p, text: readFileSync(p, "utf8") }));

  // useZebraPrint.printLabel accepts 'key_tag' in its union, but no caller in
  // this repo ever passes it — UsedCarSticker:623 asks for 'stock_number', and
  // so does printByStock. So the row itself never exists.
  it("no call site queues a key_tag label", () => {
    const callers = sources().filter(({ p, text }) =>
      p !== join("src", "hooks", "useZebraPrint.ts") &&
      /labelType:\s*["']key_tag["']|label_type:\s*["']key_tag["']/.test(text));
    expect(callers.map((w) => w.p)).toEqual([]);
  });

  it("nothing advances a zebra job to 'printed'", () => {
    const writers = sources().filter(({ text }) =>
      /zebra_print_jobs/.test(text) &&
      (/UPDATE\s+public\.zebra_print_jobs/i.test(text) ||
        /status:\s*["']printed["']/.test(text)));
    expect(writers.map((w) => w.p)).toEqual([]);
  });
});

describe("T2 — every denominator row has a producible finished state", () => {
  it("is NOT complete before the QR sheet has been minted", async () => {
    const before = await load();
    expect(before.counts.automationDone).toBeLessThan(before.counts.automationTotal);
  });

  it("is 100% complete and Ready to Market once /print/vehicle-qr has minted the token", async () => {
    await printVehicleQrSheet();
    const after = await load();
    const unfinished = after.packageItems
      .filter((i) => i.status !== "ready" && i.status !== "published")
      .map((i) => `${i.key}=${i.status}`);
    expect(unfinished).toEqual([]);
    expect(after.counts.automationDone).toBe(after.counts.automationTotal);
    expect(after.readiness.state).toBe("Ready to Market");
  });

  it("reaches it with no qr_codes and no zebra_print_jobs row at all", async () => {
    await printVehicleQrSheet();
    expect(db.rows("qr_codes")).toEqual([]);
    expect(db.rows("zebra_print_jobs")).toEqual([]);
    const after = await load();
    expect(after.counts.automationDone).toBe(after.counts.automationTotal);
  });
});

// D5: "Rear Service QR" used to be inferred from ANY active qr_codes row, and
// qrTracking.ts only ever creates window/addendum/passport tracking codes — no
// value there means "rear service". The rear-glass cling is a dept_signoff_token.
describe("T2/D5 — the QR rows measure the artifact their own link prints", () => {
  it("a window-sticker tracking code is not a rear service QR", async () => {
    db.rows("qr_codes").push({ id: "q1", tenant_id: TENANT, vehicle_id: VEHICLE_ID, is_active: true, sticker_type: "window" });
    const data = await load();
    const svcQr = data.packageItems.find((i) => i.key === "service_qr");
    expect(svcQr?.status).toBe("pending");
  });

  it("an expired token is an exception the manager can act on, not a finished row", async () => {
    await printVehicleQrSheet();
    db.rows("dept_signoff_tokens")[0].expires_at = "2020-01-01T00:00:00Z";
    const data = await load();
    const svcQr = data.packageItems.find((i) => i.key === "service_qr");
    const keyTag = data.packageItems.find((i) => i.key === "key_tag_qr");
    expect(svcQr?.status).toBe("retry_required");
    expect(keyTag?.status).toBe("retry_required");
  });
});
