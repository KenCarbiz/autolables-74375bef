// One immutable evidence record per price component
// read from a dealer page, for the append-only table proposed in
// supabase/proposed/20261101000000_price_component_evidence.sql. Each record
// carries hashes of the page and of the vehicle's widget, so a later reader can
// prove which bytes a figure came from; the record's own hash is its identity,
// so the same reading is never stored twice and a changed one never replaces
// an old one.

import type { PriceStackResult } from "./priceStack.ts";

export const EXTRACTOR_VERSION = "price-stack/2026-10-29";

export interface EvidenceContext {
  tenantId: string;
  vin: string;
  sourceUrl: string;
  capturedAt: string;
  screenshotSha256: string | null;
}

export interface ComponentEvidenceRecord {
  tenant_id: string;
  vin: string;
  captured_at: string;
  source_url: string;
  extractor_version: string;
  page_sha256: string;
  widget_sha256: string | null;
  screenshot_sha256: string | null;
  stack_status: string;
  component_role: string;
  label: string | null;
  amount: number | null;
  printed_sign: number | null;
  line_index: number | null;
  details: Record<string, unknown>;
  record_sha256: string;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Key order never changes a hash.
export const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
};

export async function buildEvidenceRecords(html: string, r: PriceStackResult, ctx: EvidenceContext): Promise<ComponentEvidenceRecord[]> {
  const pageSha = await sha256(html);
  const widgetSha = r.widgetRange ? await sha256(html.slice(r.widgetRange[0], r.widgetRange[1])) : null;
  const common = {
    tenant_id: ctx.tenantId, vin: ctx.vin.toUpperCase(), captured_at: ctx.capturedAt, source_url: ctx.sourceUrl,
    extractor_version: EXTRACTOR_VERSION, page_sha256: pageSha, widget_sha256: widgetSha,
    screenshot_sha256: ctx.screenshotSha256, stack_status: r.status,
  };
  const drafts: Omit<ComponentEvidenceRecord, "record_sha256">[] = [];
  for (const l of r.lines) {
    const inc = l.role === "incentive" ? r.incentives.find((x) => x.name === l.label && x.amount === l.amount) : undefined;
    drafts.push({
      ...common, component_role: l.role, label: l.label, amount: l.amount, printed_sign: l.printedSign, line_index: l.index,
      details: inc
        ? { marker: l.marker, eligibility: inc.eligibility, restrictions: inc.restrictions, combinability: inc.combinability,
            effective_date: inc.effectiveDate, expiration_date: inc.expirationDate, expired: inc.expired, evidence: inc.evidence }
        : { marker: l.marker },
    });
  }
  for (const d of r.disclaimers) {
    drafts.push({ ...common, component_role: `disclaimer_${d.scope}`, label: d.says, amount: null, printed_sign: null, line_index: null, details: { text: d.text } });
  }
  drafts.push({
    ...common, component_role: "stack_summary", label: null, amount: r.advertisedTotal?.amount ?? null, printed_sign: null, line_index: null,
    details: { flags: r.flags, proof: r.proof, reason: r.reason, generally_available_total: r.generallyAvailableTotal, market_comparison_basis: r.marketComparisonBasis },
  });
  return Promise.all(drafts.map(async (d) => ({ ...d, record_sha256: await sha256(canonical(d)) })));
}
