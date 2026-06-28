// ──────────────────────────────────────────────────────────────
// Wave 4.5: PDF/A-3 archival enrichment
//
// Given a jsPDF instance and a canonical payload, stamp the PDF
// with archival-grade metadata so a regulator or investor can
// independently verify the artifact months or years later:
//
//   * SHA-256 content hash computed over the canonical JSON payload.
//   * Deterministic file identifier (PDF /ID array) derived from the
//     hash so two byte-identical archives always match.
//   * PDF info dictionary populated with title / subject / author /
//     keywords including the hash prefix.
//   * XMP metadata stream claiming PDF/A-3B conformance and carrying
//     our custom namespace (xmlns:al="https://autolabels.io/ns/archival/1")
//     with content_hash, tenant_id, vin, signed_at, consent_hash.
//   * Visible archival footer drawn at the bottom of the last page:
//     "Archival hash: <prefix>… · AutoLabels.io · <timestamp>".
//
// The canonical payload is stringified with stable key order (sorted)
// so two clients producing the same logical addendum get identical
// byte output and identical hashes. Third parties reproducing the
// hash can diff against this implementation.
//
// Note: jsPDF 2.x does not support true PDF/A-3 embedded file
// attachments without post-processing. The XMP metadata still
// identifies the PDF as PDF/A-3 intent, which is the archival
// signal most downstream tools inspect. Future work: swap to
// pdf-lib on the archive path for full embedded-file attachment.
// ──────────────────────────────────────────────────────────────

import type jsPDF from "jspdf";

export interface ArchivalFields {
  tenantId?: string | null;
  tenantName?: string | null;
  vin?: string | null;
  ymm?: string | null;
  addendumId?: string | null;
  signedAt?: string | null;
  consentHash?: string | null;
  customerIp?: string | null;
}

export interface ArchivalResult {
  hash: string;          // SHA-256 hex of canonical payload
  hashPrefix: string;    // first 10 chars for display
  canonicalJson: string; // the exact bytes that were hashed
  timestamp: string;     // ISO UTC when archivePdf ran
}

// Sort object keys recursively so JSON.stringify is deterministic.
const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  Object.keys(obj)
    .sort()
    .forEach((k) => {
      sorted[k] = canonicalize(obj[k]);
    });
  return sorted;
};

const sha256Hex = async (input: string): Promise<string> => {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// Escape a value for safe insertion inside an XML attribute or text.
const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const buildXmp = (fields: ArchivalFields, hash: string, timestamp: string): string => {
  const safe = (v: string | null | undefined) => (v ? xmlEscape(v) : "");
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="AutoLabels PDF Archive 1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/"
        xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:al="https://autolabels.io/ns/archival/1">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <pdf:Producer>AutoLabels.io PDF Archive</pdf:Producer>
      <xmp:CreatorTool>AutoLabels.io</xmp:CreatorTool>
      <xmp:CreateDate>${timestamp}</xmp:CreateDate>
      <xmp:MetadataDate>${timestamp}</xmp:MetadataDate>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Dealer Addendum${fields.vin ? " — VIN " + safe(fields.vin) : ""}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${safe(fields.tenantName) || "AutoLabels Dealer"}</rdf:li></rdf:Seq></dc:creator>
      <al:contentHash>${hash}</al:contentHash>
      <al:tenantId>${safe(fields.tenantId)}</al:tenantId>
      <al:tenantName>${safe(fields.tenantName)}</al:tenantName>
      <al:vin>${safe(fields.vin)}</al:vin>
      <al:ymm>${safe(fields.ymm)}</al:ymm>
      <al:addendumId>${safe(fields.addendumId)}</al:addendumId>
      <al:signedAt>${safe(fields.signedAt)}</al:signedAt>
      <al:consentHash>${safe(fields.consentHash)}</al:consentHash>
      <al:customerIp>${safe(fields.customerIp)}</al:customerIp>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
};

// Convert a hex hash to a 32-character ID string (two blocks) for
// PDF /ID. jsPDF setFileId expects a string; we give it the same
// value twice-joined so both entries of the /ID array match.
const hashToFileId = (hash: string): string => hash.slice(0, 32).toUpperCase();

export type ArchivalDocType =
  | "addendum"
  | "deal"
  | "sticker"
  | "buyers_guide"
  | "prep_signoff"
  | "disclosure"
  | "k208";

/**
 * Ship a stamped PDF to the archive-pdf edge function so it lands
 * in signed_document_archive with an immutable SHA-256 receipt.
 * Best-effort: failures are logged and swallowed so a blip in the
 * archive path never blocks the dealer's PDF download.
 */
export const persistArchivedPdf = async (
  doc: jsPDF,
  params: {
    docType: ArchivalDocType;
    entityId: string;       // addendum id, listing id, buyers-guide draft, etc.
    vin?: string | null;
    retentionYears?: number;
  }
): Promise<{ ok: boolean; archiveId?: string; error?: string }> => {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    // jsPDF 2.x can return a Base64 data URI via output("datauristring")
    const dataUri = doc.output("datauristring") as string;
    const pdfBase64 = dataUri.replace(/^data:[^;]+;base64,/, "");

    const { data, error } = await supabase.functions.invoke("archive-pdf", {
      body: {
        doc_type: params.docType,
        entity_id: params.entityId,
        vin: params.vin ?? undefined,
        pdf_base64: pdfBase64,
        retention_years: params.retentionYears ?? 7,
      },
    });

    if (error || !data) {
      return { ok: false, error: error?.message || "archive-pdf invoke failed" };
    }
    const result = data as { archive_id?: string };
    return { ok: true, archiveId: result.archive_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
};

/**
 * Stamp a jsPDF instance with PDF/A-3 archival metadata and draw a
 * visible hash footer. Resolves with the computed hash + canonical
 * payload so the caller can persist them alongside the PDF.
 */
export const archivePdf = async (
  doc: jsPDF,
  payload: unknown,
  fields: ArchivalFields = {}
): Promise<ArchivalResult> => {
  const canonicalJson = JSON.stringify(canonicalize(payload));
  const hash = await sha256Hex(canonicalJson);
  const hashPrefix = hash.slice(0, 10);
  const timestamp = new Date().toISOString();

  // Info dictionary
  doc.setProperties({
    title: `Dealer Addendum${fields.vin ? ` - VIN ${fields.vin}` : ""}`,
    subject: `AutoLabels archival addendum${fields.ymm ? ` (${fields.ymm})` : ""}`,
    author: fields.tenantName || "AutoLabels.io",
    keywords: [
      "AutoLabels",
      "addendum",
      fields.vin ? `VIN:${fields.vin}` : "",
      `hash:${hashPrefix}`,
      "PDF/A-3",
    ]
      .filter(Boolean)
      .join(", "),
    creator: "AutoLabels.io",
  });

  // Deterministic /ID
  try {
    doc.setFileId(hashToFileId(hash));
  } catch {
    /* setFileId may throw on very old jsPDF; non-fatal */
  }

  // XMP metadata stream
  try {
    const xmp = buildXmp(fields, hash, timestamp);
    // jsPDF overload: addMetadata(metadata, rawXml). Pass true so the
    // block is written as-is without namespace wrapping.
    (doc as unknown as {
      addMetadata: (s: string, rawXml?: boolean) => jsPDF;
    }).addMetadata(xmp, true);
  } catch {
    /* metadata injection is best-effort */
  }

  // Visible archival footer on the last page
  try {
    const pageCount = doc.getNumberOfPages();
    doc.setPage(pageCount);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    const footer = `Archival SHA-256: ${hashPrefix}…  ·  AutoLabels.io PDF/A-3  ·  ${timestamp}`;
    doc.text(footer, pageWidth / 2, pageHeight - 0.15, {
      align: "center",
      baseline: "bottom",
    });
  } catch {
    /* footer stamp is best-effort */
  }

  return { hash, hashPrefix, canonicalJson, timestamp };
};
