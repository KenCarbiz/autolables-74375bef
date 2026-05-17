import { describe, it, expect } from "vitest";
import { buildAuditPacket } from "./auditPacket";

// ──────────────────────────────────────────────────────────────
// Audit-Defense Packet integration tests (Wave 14.4 → 14.1).
//
// The packet's compliance promise is the SHA-256 chain root:
// "Any change to any included artifact changes this root." If
// that property breaks, every claim the packet makes downstream
// — to counsel, AG, FTC, SB 766 enforcement — is unprovable.
//
// These tests stub the Supabase client surface buildAuditPacket
// touches (no msw needed) and assert:
//   1. The chain root is deterministic across reruns on the
//      same source data.
//   2. The chain root changes when ANY section's data changes.
//   3. Section ordering is stable.
//   4. The summary stats match the input.
//   5. The recall snapshot is included.
// ──────────────────────────────────────────────────────────────

// Tiny supabase stub. Mirrors enough of the Postgrest builder
// chain that buildAuditPacket can call .from().select().eq()...
// .order().limit() and get back canned rows, plus
// .functions.invoke() for the recall edge function.
type Canned = Partial<{
  vehicle_listings: unknown[];
  vehicle_files: unknown[];
  addendums: unknown[];
  addendum_signings: unknown[];
  prep_sign_offs: unknown[];
  deal_signing_tokens: unknown[];
  audit_log: unknown[];
  signed_document_archive: unknown[];
}>;

const makeSupabase = (canned: Canned, recall: unknown = { recalls: [], do_not_drive: false }) => {
  // Builder returns "this" for every chain step, then resolves
  // to { data } on await. PromiseLike on the builder gives us
  // the .eq().order().limit() → await behaviour.
  const makeBuilder = (rows: unknown[]) => {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (onF: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: rows }).then(onF),
    };
    return builder;
  };
  return {
    from: (table: string) => makeBuilder((canned as any)[table] || []),
    functions: {
      invoke: async () => ({ data: recall, error: null }),
    },
  } as any;
};

describe("buildAuditPacket — chain root determinism", () => {
  it("returns the same chain root for the same input twice", async () => {
    const sb = makeSupabase({
      vehicle_listings: [{ id: "v1", vin: "1HGCM82633A123456", price: 19000 }],
      addendums: [{ id: "a1", status: "signed" }],
      addendum_signings: [{ id: "s1", signer_type: "customer", content_hash: "abc" }],
    });
    const a = await buildAuditPacket({
      supabase: sb,
      vin: "1HGCM82633A123456",
      tenantId: "t1",
      tenantName: "Demo Dealer",
    });
    const b = await buildAuditPacket({
      supabase: sb,
      vin: "1HGCM82633A123456",
      tenantId: "t1",
      tenantName: "Demo Dealer",
    });
    expect(a.manifest.chain_root).toBe(b.manifest.chain_root);
    expect(a.manifest.chain_root).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does NOT depend on object key order — canonicalisation works", async () => {
    const sbA = makeSupabase({
      addendums: [{ id: "a1", status: "signed", vin: "X", price: 1 }],
    });
    const sbB = makeSupabase({
      addendums: [{ price: 1, vin: "X", status: "signed", id: "a1" }],
    });
    const a = await buildAuditPacket({ supabase: sbA, vin: "X", tenantId: null, tenantName: null });
    const b = await buildAuditPacket({ supabase: sbB, vin: "X", tenantId: null, tenantName: null });
    expect(a.manifest.chain_root).toBe(b.manifest.chain_root);
  });
});

describe("buildAuditPacket — tamper detection", () => {
  it("changes the chain root when any addendum field changes", async () => {
    const sbA = makeSupabase({ addendums: [{ id: "a1", price: 19000, status: "signed" }] });
    const sbB = makeSupabase({ addendums: [{ id: "a1", price: 19500, status: "signed" }] });
    const a = await buildAuditPacket({ supabase: sbA, vin: "X", tenantId: null, tenantName: null });
    const b = await buildAuditPacket({ supabase: sbB, vin: "X", tenantId: null, tenantName: null });
    expect(a.manifest.chain_root).not.toBe(b.manifest.chain_root);
  });

  it("changes the chain root when a signing's content_hash changes", async () => {
    const sbA = makeSupabase({ addendum_signings: [{ id: "s1", content_hash: "before" }] });
    const sbB = makeSupabase({ addendum_signings: [{ id: "s1", content_hash: "after" }] });
    const a = await buildAuditPacket({ supabase: sbA, vin: "X", tenantId: null, tenantName: null });
    const b = await buildAuditPacket({ supabase: sbB, vin: "X", tenantId: null, tenantName: null });
    expect(a.manifest.chain_root).not.toBe(b.manifest.chain_root);
  });

  it("changes the chain root when the recall snapshot changes", async () => {
    const sb1 = makeSupabase({}, { recalls: [], do_not_drive: false });
    const sb2 = makeSupabase({}, { recalls: [{ campaign_id: "24V123" }], do_not_drive: true });
    const a = await buildAuditPacket({ supabase: sb1, vin: "X", tenantId: null, tenantName: null });
    const b = await buildAuditPacket({ supabase: sb2, vin: "X", tenantId: null, tenantName: null });
    expect(a.manifest.chain_root).not.toBe(b.manifest.chain_root);
  });

  it("changes the chain root when a single audit log row changes", async () => {
    const sb1 = makeSupabase({ audit_log: [{ id: "e1", action: "listing_published" }] });
    const sb2 = makeSupabase({ audit_log: [{ id: "e1", action: "listing_voided" }] });
    const a = await buildAuditPacket({ supabase: sb1, vin: "X", tenantId: null, tenantName: null });
    const b = await buildAuditPacket({ supabase: sb2, vin: "X", tenantId: null, tenantName: null });
    expect(a.manifest.chain_root).not.toBe(b.manifest.chain_root);
  });
});

describe("buildAuditPacket — manifest shape", () => {
  it("lists all 9 sections in the stable canonical order", async () => {
    const sb = makeSupabase({});
    const p = await buildAuditPacket({ supabase: sb, vin: "X", tenantId: null, tenantName: null });
    expect(p.manifest.sections.map(s => s.name)).toEqual([
      "01-vehicle-file",
      "02-listings",
      "03-addendums",
      "04-signings",
      "05-prep-sign-offs",
      "06-deal-jackets",
      "07-recall-snapshot",
      "08-audit-log",
      "09-archive",
    ]);
  });

  it("attaches a 64-char hex SHA-256 to every section", async () => {
    const sb = makeSupabase({});
    const p = await buildAuditPacket({ supabase: sb, vin: "X", tenantId: null, tenantName: null });
    for (const s of p.manifest.sections) {
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("upper-cases and trims the VIN on the manifest", async () => {
    const sb = makeSupabase({});
    const p = await buildAuditPacket({ supabase: sb, vin: "  1hgcm82633a123456  ", tenantId: null, tenantName: null });
    expect(p.manifest.vin).toBe("1HGCM82633A123456");
  });

  it("carries tenant + generated_by on the manifest", async () => {
    const sb = makeSupabase({});
    const p = await buildAuditPacket({
      supabase: sb,
      vin: "X",
      tenantId: "t-123",
      tenantName: "Freeman Ford",
      generatedBy: "ken@example.com",
    });
    expect(p.manifest.tenant).toEqual({ id: "t-123", name: "Freeman Ford" });
    expect(p.manifest.generated_by).toBe("ken@example.com");
  });
});

describe("buildAuditPacket — summary stats", () => {
  it("counts signed vs total addendums correctly", async () => {
    const sb = makeSupabase({
      addendums: [
        { id: "a1", status: "signed" },
        { id: "a2", status: "draft" },
        { id: "a3", status: "signed" },
      ],
    });
    const p = await buildAuditPacket({ supabase: sb, vin: "X", tenantId: null, tenantName: null });
    expect(p.summary.addendum_count).toBe(3);
    expect(p.summary.signed_addendum_count).toBe(2);
  });

  it("counts customer + cobuyer signings (not employee signings)", async () => {
    const sb = makeSupabase({
      addendum_signings: [
        { id: "s1", signer_type: "customer" },
        { id: "s2", signer_type: "cobuyer" },
        { id: "s3", signer_type: "salesperson" },
        { id: "s4", signer_type: "finance_manager" },
      ],
    });
    const p = await buildAuditPacket({ supabase: sb, vin: "X", tenantId: null, tenantName: null });
    expect(p.summary.customer_signing_count).toBe(2);
  });

  it("flags do_not_drive when the recall snapshot does", async () => {
    const sb = makeSupabase({}, { recalls: [{ campaign_id: "24V001" }], do_not_drive: true });
    const p = await buildAuditPacket({ supabase: sb, vin: "X", tenantId: null, tenantName: null });
    expect(p.summary.do_not_drive).toBe(true);
    expect(p.summary.open_recall_count).toBe(1);
  });

  it("survives recall-edge-function errors without throwing", async () => {
    const sb: any = {
      from: () => ({
        select: () => sb.from(),
        eq: () => sb.from(),
        or: () => sb.from(),
        order: () => sb.from(),
        limit: () => Promise.resolve({ data: [] }),
        then: (onF: any) => Promise.resolve({ data: [] }).then(onF),
      }),
      functions: { invoke: async () => { throw new Error("upstream 503"); } },
    };
    const p = await buildAuditPacket({ supabase: sb, vin: "X", tenantId: null, tenantName: null });
    expect(p.summary.has_recall_snapshot).toBe(false);
    // Still produces a chain root — the error itself is part of
    // the section data and hashed.
    expect(p.manifest.chain_root).toMatch(/^[0-9a-f]{64}$/);
  });
});
