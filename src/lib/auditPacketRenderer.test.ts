import { describe, it, expect } from "vitest";
import { renderPacketHtml } from "./auditPacketRenderer";
import type { AuditPacket } from "./auditPacket";

// ──────────────────────────────────────────────────────────────
// Audit-Defense Packet HTML renderer tests (Wave 14.4 → 14.1).
//
// Renderer is pure: it takes an AuditPacket and returns an HTML
// string. These tests pin the contract a regulator-facing file
// is supposed to honour:
//   - Chain root is quoted verbatim on the cover.
//   - Legal attestation paragraph names the statutes.
//   - Every section card is present and labelled.
//   - Self-contained: no external CSS / JS / image hrefs.
//   - User-supplied content is HTML-escaped (no XSS via a
//     malicious tenant name or VIN).
// ──────────────────────────────────────────────────────────────

const stubPacket = (over: Partial<AuditPacket> = {}): AuditPacket => ({
  manifest: {
    version: "audit-packet/v1-test",
    vin: "1HGCM82633A123456",
    tenant: { id: "t-1", name: "Freeman Ford" },
    generated_at: "2026-05-17T12:34:56.000Z",
    generated_by: "ken@example.com",
    user_agent: "Mozilla/5.0",
    sections: [
      { name: "01-vehicle-file",   count: 1, sha256: "a".repeat(64) },
      { name: "02-listings",       count: 1, sha256: "b".repeat(64) },
      { name: "03-addendums",      count: 1, sha256: "c".repeat(64) },
      { name: "04-signings",       count: 1, sha256: "d".repeat(64) },
      { name: "05-prep-sign-offs", count: 1, sha256: "e".repeat(64) },
      { name: "06-deal-jackets",   count: 0, sha256: "f".repeat(64) },
      { name: "07-recall-snapshot", count: 1, sha256: "0".repeat(64) },
      { name: "08-audit-log",      count: 5, sha256: "1".repeat(64) },
      { name: "09-archive",        count: 0, sha256: "2".repeat(64) },
    ],
    chain_root: "deadbeef".repeat(8),
    ...over.manifest,
  },
  sections: over.sections ?? [],
  summary: {
    has_listing: true,
    addendum_count: 1,
    signed_addendum_count: 1,
    customer_signing_count: 1,
    prep_signoff_count: 1,
    signed_prep_count: 1,
    deal_token_count: 0,
    signed_deal_count: 0,
    audit_event_count: 5,
    archived_document_count: 0,
    has_vehicle_file: true,
    has_recall_snapshot: true,
    open_recall_count: 0,
    do_not_drive: false,
    ...over.summary,
  },
});

describe("renderPacketHtml — compliance contract", () => {
  it("quotes the chain root verbatim on the cover", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).toContain("deadbeef".repeat(8));
  });

  it("names the federal E-SIGN Act in the attestation", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).toMatch(/15 U\.S\.C\. §7001/);
    expect(html).toMatch(/E-SIGN/);
  });

  it("names the FTC Used Car Rule in the attestation", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).toMatch(/16 CFR Part 455/);
  });

  it("names California SB 766 with its effective date", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).toMatch(/SB 766/);
    expect(html).toMatch(/October 1, 2026/);
  });

  it("renders one card per section with the correct human label", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).toContain("Vehicle file");
    expect(html).toContain("Vehicle listings");
    expect(html).toContain("Addendums");
    // The signings section is the E-SIGN provenance — must be
    // labelled as such for a regulator skimming the file.
    expect(html).toContain("Customer &amp; employee signings (E-SIGN)");
    expect(html).toContain("Prep &amp; install sign-offs");
    expect(html).toContain("NHTSA recall snapshot (live)");
    expect(html).toContain("Audit log events");
  });

  it("renders every section's SHA-256 in the manifest table", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).toContain("a".repeat(64));
    expect(html).toContain("b".repeat(64));
    expect(html).toContain("c".repeat(64));
    expect(html).toContain("d".repeat(64));
  });

  it("shows DO NOT DRIVE only when the recall snapshot flags it", () => {
    const without = renderPacketHtml(stubPacket());
    expect(without).not.toContain("DO NOT DRIVE");

    const withDND = renderPacketHtml(
      stubPacket({ summary: { ...stubPacket().summary, do_not_drive: true } }),
    );
    expect(withDND).toContain("DO NOT DRIVE");
  });
});

describe("renderPacketHtml — self-containment", () => {
  it("starts with the HTML5 doctype", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("inlines its stylesheet (no <link rel=stylesheet> tags)", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).not.toMatch(/<link\s+[^>]*rel=["']stylesheet["']/i);
    expect(html).toMatch(/<style>/);
  });

  it("contains no <script> tags — the file is data, not code", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).not.toMatch(/<script\b/i);
  });

  it("contains no remote <img src=http...> references", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).not.toMatch(/<img[^>]+src=["']https?:/i);
  });
});

describe("renderPacketHtml — escaping", () => {
  it("HTML-escapes a malicious tenant name", () => {
    const html = renderPacketHtml(
      stubPacket({
        manifest: {
          ...stubPacket().manifest,
          tenant: { id: "t-1", name: "<script>alert('xss')</script>" },
        },
      }),
    );
    // The literal script tag must not appear; the escaped form
    // should. This is what blocks XSS via tenant naming.
    expect(html).not.toMatch(/<script>alert\('xss'\)<\/script>/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("HTML-escapes section data when rendering JSON cards", () => {
    const html = renderPacketHtml(
      stubPacket({
        sections: [
          { name: "03-addendums", count: 1, sha256: "c".repeat(64), data: [{ notes: "<img src=x onerror=alert(1)>" }] },
        ],
      }),
    );
    expect(html).not.toMatch(/<img src=x onerror/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("HTML-escapes the VIN if a malformed input slips through", () => {
    const html = renderPacketHtml(
      stubPacket({
        manifest: {
          ...stubPacket().manifest,
          vin: "<b>evil</b>",
        },
      }),
    );
    expect(html).not.toMatch(/<b>evil<\/b>/);
    expect(html).toContain("&lt;b&gt;evil&lt;/b&gt;");
  });
});

describe("renderPacketHtml — print layout", () => {
  it("includes an @media print stylesheet so save-as-PDF is uniform", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).toMatch(/@media print/);
  });

  it("hides the back-link in print mode", () => {
    const html = renderPacketHtml(stubPacket());
    expect(html).toMatch(/@media print[\s\S]*\.back-link\s*\{[^}]*display:\s*none/);
  });
});
