import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GetReadyItem } from "@/hooks/useGetReady";
import { createCommandDb, type CommandDb, type MockRow } from "@/test/mocks/commandCenterDb";

// ──────────────────────────────────────────────────────────────────────
// T1 — ONE VENDOR SET.
//
// INVARIANT: the set of vendors the manager is SHOWN under Vendor Assignments
// is identical to the set authorizeAndDispatch EMAILS.
//
// This has been "fixed" three times and re-broken three times, every time
// because the regression test called `vendorsFor` twice with the SAME array
// while the app called it with two DIFFERENT arrays. So every test in this file
// calls the two real entry points — `loadGetReadyCommand`, which is what the
// screen renders, and `deriveGetReadyDispatch`, which is what the dispatcher
// emails — and compares their outputs.
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

const item = (over: Partial<GetReadyItem> = {}): GetReadyItem => ({
  id: "i1", label: "Windshield replacement", category: "service",
  assignedTo: "", status: "pending", ...over,
});

const seed = (items: GetReadyItem[], extra: Record<string, MockRow[]> = {}) => {
  db = createCommandDb({
    tables: {
      vehicle_listings: [{
        id: VEHICLE_ID, tenant_id: TENANT, vin: VIN, ymm: "2025 INFINITI QX80",
        trim: "Sensory AWD", condition: "used", mileage: 12000, hero_image_url: null,
        mc_attributes: { stock_no: "H12345" }, created_at: "2026-07-01T10:00:00Z",
        slug: null, status: "draft",
      }],
      get_ready_records: [{
        id: "gr1", tenant_id: TENANT, vin: VIN, items, status: "pending",
        created_at: "2026-07-01T11:00:00Z",
      }],
      ...extra,
    },
  });
};

const shownVendorEmails = async (): Promise<string[]> => {
  const { loadGetReadyCommand } = await import("@/hooks/useCommandCenter");
  const { createSourceReader } = await import("@/lib/commandCenter/sourceReader");
  const data = await loadGetReadyCommand(createSourceReader(), TENANT, VEHICLE_ID);
  return data.columns
    .flatMap((c) => c.vendors ?? [])
    .map((v) => (v.email || "").toLowerCase())
    .filter(Boolean)
    .sort();
};

const emailedVendorAddresses = async (): Promise<string[]> => {
  const { deriveGetReadyDispatch } = await import("@/hooks/useGetReady");
  const { vendors } = await deriveGetReadyDispatch(TENANT, VIN);
  return vendors.map((v) => v.email.toLowerCase()).sort();
};

const vendorRows = async () => {
  const { loadGetReadyCommand } = await import("@/hooks/useCommandCenter");
  const { createSourceReader } = await import("@/lib/commandCenter/sourceReader");
  const data = await loadGetReadyCommand(createSourceReader(), TENANT, VEHICLE_ID);
  return data.columns.flatMap((c) => c.vendors ?? []);
};

const lineStatuses = async (): Promise<Record<string, string>> => {
  const { loadGetReadyCommand } = await import("@/hooks/useCommandCenter");
  const { createSourceReader } = await import("@/lib/commandCenter/sourceReader");
  const data = await loadGetReadyCommand(createSourceReader(), TENANT, VEHICLE_ID);
  const out: Record<string, string> = {};
  for (const c of data.columns) for (const i of c.items) out[i.id] = i.status;
  return out;
};

beforeEach(() => { seed([]); });

describe("T1/D1 — displayed vendors are the emailed vendors", () => {
  // Reachable through the real UI: in StartGetReadyModal click a recon-cost chip
  // carrying responsible_email (:268 sets department "vendor" + vendorEmail),
  // then switch the department select back to "service" (:280) — the email input
  // hides, the state is retained, and :139 emits it regardless.
  const retainedVendorEmail = item({
    id: "svc-glass", category: "service", department: "service",
    vendorEmail: "a@glass.test", status: "pending",
  });

  it("shows the vendor whose line is displayed in the SERVICE column", async () => {
    seed([retainedVendorEmail]);
    expect(await shownVendorEmails()).toEqual(["a@glass.test"]);
  });

  it("shows exactly the set the dispatch emails, for the same record", async () => {
    seed([retainedVendorEmail, item({ id: "detail-1", category: "detail" })]);
    expect(await shownVendorEmails()).toEqual(await emailedVendorAddresses());
  });

  it("holds when vendor lines are spread across all three columns", async () => {
    seed([
      retainedVendorEmail,
      item({ id: "acc-1", category: "accessory", vendorEmail: "tint@pros.test" }),
      item({ id: "prep-1", category: "detail", department: "vendor", vendorEmail: "wash@co.test" }),
    ]);
    expect(await shownVendorEmails()).toEqual(await emailedVendorAddresses());
  });
});

describe("T1/D2 — the proof clock is keyed on the identity the vendor was assigned by", () => {
  // StartGetReadyModal collects only an EMAIL for accessories and services, so
  // the vendor has no vendorName to match detail_signoffs.provider_company on.
  // GetReady's DetailStation writes provider_contact from the vendor's own
  // "Contact number / email" field (GetReady.tsx:472), which is the only value
  // the two sides can share.
  const signoff = (over: MockRow = {}): MockRow => ({
    id: "ds1", tenant_id: TENANT, vin: VIN, is_third_party: true,
    provider_company: "Tint Pros", provider_contact: "shop@tintpros.test",
    photos: ["https://files.test/proof.jpg"], status: "signed",
    signed_at: "2026-07-10T00:00:00Z", created_at: "2026-07-10T00:00:00Z",
    ...over,
  });

  it("does not read Pending Proof for a vendor who signed off with photos", async () => {
    seed(
      [item({ id: "acc-tint", category: "accessory", vendorEmail: "shop@tintpros.test" })],
      { detail_signoffs: [signoff()] },
    );
    expect((await lineStatuses())["acc-tint"]).not.toBe("pending_proof");
  });

  it("still holds a vendor who has NOT uploaded proof at Pending Proof", async () => {
    seed(
      [item({ id: "acc-other", category: "accessory", vendorEmail: "nobody@else.test" })],
      { detail_signoffs: [signoff()] },
    );
    expect((await lineStatuses())["acc-other"]).toBe("pending_proof");
  });
});

describe("T1/D3 — one real vendor is one row", () => {
  it("does not list the same vendor once by email and again by company name", async () => {
    seed(
      [item({ id: "acc-tint", category: "accessory", vendorEmail: "shop@tintpros.test" })],
      {
        detail_signoffs: [{
          id: "ds1", tenant_id: TENANT, vin: VIN, is_third_party: true,
          provider_company: "Tint Pros", provider_contact: "shop@tintpros.test",
          photos: ["https://files.test/proof.jpg"], status: "signed",
          signed_at: "2026-07-10T00:00:00Z", created_at: "2026-07-10T00:00:00Z",
        }],
      },
    );
    const rows = await vendorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Tint Pros");
  });

  it("still lists a third-party detailer who was never assigned a work item", async () => {
    seed([item({ id: "detail-1", category: "detail" })], {
      detail_signoffs: [{
        id: "ds1", tenant_id: TENANT, vin: VIN, is_third_party: true,
        provider_company: "Walk-In Detail", provider_contact: "203-555-0100",
        photos: ["https://files.test/proof.jpg"], status: "signed",
        signed_at: "2026-07-10T00:00:00Z", created_at: "2026-07-10T00:00:00Z",
      }],
    });
    expect((await vendorRows()).map((v) => v.name)).toEqual(["Walk-In Detail"]);
  });
});
