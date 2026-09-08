import { describe, it, expect, beforeEach, vi } from "vitest";
import { createCommandDb, type CommandDb, type MockRow } from "@/test/mocks/commandCenterDb";

// ──────────────────────────────────────────────────────────────────────
// "Publish to Passport" makes a document readable by anyone with the URL.
//
// It used to flip the NEWEST generated_documents row for the vehicle with no
// filter on type or status. On this project's data that newest row is usually
// an auto-generated draft — a buyers_guide or a K-208 nobody approved — so the
// dealer's Publish button pushed a held, statutorily-unreviewed document onto
// the anonymous passport.
//
// The rule these tests pin: publish the sticker lane the studio owns, and only
// from a status documentWorkflow.allowedActions() offers `publish` from
// (approved / printed).
// ──────────────────────────────────────────────────────────────────────

let db: CommandDb;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.from(table),
    rpc: (fn: string, args?: MockRow) => db.rpc(fn, args ?? {}),
    functions: { invoke: (fn: string, opts?: { body?: MockRow }) => db.invoke(fn, opts) },
  },
}));

import { publishToPassport } from "./api";

const TENANT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const VEHICLE = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const doc = (over: Partial<MockRow> & { id: string }): MockRow => ({
  tenant_id: TENANT, vehicle_id: VEHICLE, template_id: "t", version: 1,
  document_type: "window", document_status: "draft", created_at: "2026-07-01T00:00:00Z",
  ...over,
});

const seed = (docs: MockRow[]) => {
  db = createCommandDb({
    tables: {
      vehicle_listings: [{ id: VEHICLE, tenant_id: TENANT, slug: "2026-qx60", vin: "5N1AL1F83VC332076", status: "draft" }],
      generated_documents: docs,
    },
  });
};

const statusOf = (id: string) =>
  db.rows("generated_documents").find((r) => r.id === id)?.document_status;

beforeEach(() => seed([]));

describe("publishToPassport — document eligibility", () => {
  it("never publishes a held buyers guide, even when it is the newest row", async () => {
    seed([
      doc({ id: "win", document_type: "window", document_status: "approved", created_at: "2026-07-01T00:00:00Z" }),
      doc({ id: "bg", document_type: "buyers_guide", document_status: "draft", created_at: "2026-07-09T00:00:00Z" }),
    ]);

    const r = await publishToPassport(VEHICLE, TENANT);

    expect(r.ok).toBe(true);
    expect(statusOf("bg")).toBe("draft");
    expect(statusOf("win")).toBe("published");
  });

  it("never publishes an unapproved K-208 (the newest row on most used cars)", async () => {
    seed([doc({ id: "k208", document_type: "k208", document_status: "draft", created_at: "2026-07-09T00:00:00Z" })]);

    const r = await publishToPassport(VEHICLE, TENANT);

    expect(r.ok).toBe(true);
    expect(statusOf("k208")).toBe("draft");
    expect(r.documentId).toBeUndefined();
  });

  it("leaves a sticker that is still draft or pending approval alone", async () => {
    seed([
      doc({ id: "d", document_type: "window", document_status: "draft" }),
      doc({ id: "p", document_type: "addendum", document_status: "pending_approval" }),
    ]);

    await publishToPassport(VEHICLE, TENANT);

    expect(statusOf("d")).toBe("draft");
    expect(statusOf("p")).toBe("pending_approval");
  });

  it("publishes only the named lane when the caller states one", async () => {
    seed([
      doc({ id: "win", document_type: "window", document_status: "approved", created_at: "2026-07-08T00:00:00Z" }),
      doc({ id: "add", document_type: "addendum", document_status: "approved", created_at: "2026-07-01T00:00:00Z" }),
    ]);

    const r = await publishToPassport(VEHICLE, TENANT, "addendum");

    expect(r.documentId).toBe("add");
    expect(statusOf("add")).toBe("published");
    expect(statusOf("win")).toBe("approved");
  });

  it("stamps the passport URL onto the document it publishes", async () => {
    seed([doc({ id: "win", document_status: "printed" })]);

    const r = await publishToPassport(VEHICLE, TENANT, "window");

    expect(r.url).toContain("/v/2026-qx60");
    expect(db.rows("generated_documents")[0].online_url).toBe(r.url);
  });

  it("still publishes the vehicle passport when no document is eligible", async () => {
    seed([doc({ id: "d", document_status: "draft" })]);

    const r = await publishToPassport(VEHICLE, TENANT);

    expect(r.ok).toBe(true);
    expect(r.url).toContain("/v/2026-qx60");
    expect(db.rows("vehicle_listings")[0].status).toBe("published");
  });

  it("does not reach across tenants for a document to publish", async () => {
    seed([doc({ id: "other", tenant_id: "cccccccc-3333-4333-8333-cccccccccccc", document_status: "approved" })]);

    const r = await publishToPassport(VEHICLE, TENANT);

    expect(statusOf("other")).toBe("approved");
    expect(r.documentId).toBeUndefined();
  });
});
