// ──────────────────────────────────────────────────────────────────────
// Reading the OEM brochure / owner's-manual link that ingest already found.
//
// Every intake path — marketcheck-sync, dms-webhook, autocurb-sync — runs
// autoPreload → ensureOemDocLinks, which harvests both documents and caches
// them in oem_brochure_links / oem_owners_manual_links keyed by make/model/year.
// That has always worked. What was missing is the read: the Vehicle File asked
// the operator to press "Find OEM brochure" even when ingest had filed the link
// hours earlier, because the card started empty and never looked.
//
// The pick below is deliberately identical to hasCachedOemLink in
// supabase/functions/_shared/intake-autoprovision.ts. If the two ever disagree,
// the page shows "not found" for a row the harvester is refusing to re-fetch
// precisely BECAUSE it is cached — a standoff where neither side is wrong on
// its own terms and the document simply never appears.
// ──────────────────────────────────────────────────────────────────────

import { supabase } from "@/integrations/supabase/client";
// The ONE derivation. supabase/functions/_shared/oemDocKey.ts exists precisely
// so the harvester, the passport and anything else asking "which row serves
// this vehicle" cannot drift apart, and it reproduces public-listing-view's
// split verbatim — second word is the make, everything after it is the model,
// trim included. A local copy here would have been the third one, and it
// disagreed: it accepted a ymm with no model year, which the harvester refuses
// outright because the passport would then read the make out of the model
// position.
import { oemDocKeyFromYmm, type OemDocKey } from "../../../supabase/functions/_shared/oemDocKey";

export { oemDocKeyFromYmm };
export type { OemDocKey };

export type OemDocKind = "brochure" | "owners_manual";

// `as const` so the values stay literal table names. Widened to `string` the
// typed Supabase client cannot resolve the row shape and silently degrades to
// an any-ish union of every table in the schema.
export const OEM_DOC_TABLE = {
  brochure: "oem_brochure_links",
  owners_manual: "oem_owners_manual_links",
} as const satisfies Record<OemDocKind, string>;

export interface OemDocLinkRow {
  url: string;
  year: number | null;
  title?: string | null;
  verified_at?: string | null;
}

/**
 * Choose the row that serves this vehicle, from newest first.
 *
 * Exact model year wins; then anything within two model years, because a
 * manufacturer routinely publishes one brochure across a generation; then a
 * year-less row, which is what the manual harvest's portal fallback stores.
 */
export function pickOemDocRow<T extends { year: number | null }>(rows: T[], year: number | null): T | null {
  if (!rows.length) return null;
  const exact = year != null ? rows.find((r) => r.year === year) : rows[0];
  return (
    exact
    || rows.find((r) => r.year != null && year != null && Math.abs(r.year - year) <= 2)
    || rows.find((r) => r.year == null)
    || null
  );
}

/**
 * The link ingest already harvested for this vehicle, or null.
 *
 * Returns null on any error rather than throwing: this only decides whether a
 * card shows a link or a search button, and a failed read must not take the
 * Documents tab down with it.
 */
export async function fetchHarvestedOemDocLink(
  kind: OemDocKind,
  ymm: string | null | undefined,
): Promise<OemDocLinkRow | null> {
  const key = oemDocKeyFromYmm(ymm);
  if (!key) return null;
  try {
    const { data, error } = await supabase
      .from(OEM_DOC_TABLE[kind])
      .select("url, year, title, verified_at")
      .ilike("make", key.make)
      .ilike("model", key.model)
      .order("year", { ascending: false, nullsFirst: false })
      .limit(6);
    if (error || !Array.isArray(data)) return null;
    const pick = pickOemDocRow(data, key.year);
    return pick && typeof pick.url === "string" && pick.url.trim() ? pick : null;
  } catch {
    return null;
  }
}

// ── The dealer's own stored copy ──────────────────────────────────────

/**
 * Does this dealership hold its own copy of this document for this vehicle?
 *
 * Only ever a yes/no for the UI. The URL is deliberately NOT resolved here:
 * the bucket is private and a signed URL has a lifetime, and storing one on a
 * row is exactly what made published cars serve dead links once it aged out.
 * The shopper's copy is signed per request by public-listing-view; this only
 * tells an operator that a copy exists.
 */
export async function hasStoredOemDocCopy(
  kind: OemDocKind,
  tenantId: string | null | undefined,
  ymm: string | null | undefined,
): Promise<boolean> {
  const key = oemDocKeyFromYmm(ymm);
  if (!key || !tenantId) return false;
  try {
    const { data, error } = await supabase
      .from("oem_hosted_documents")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("document_kind", kind === "brochure" ? "brochure" : "owners_manual")
      .ilike("brand", key.make)
      .ilike("model", key.model)
      .limit(1);
    if (error || !Array.isArray(data)) return false;
    return data.length > 0;
  } catch {
    return false;
  }
}

// ── Why this vehicle has, or has not, got a stored copy ───────────────

/**
 * The copy ledger's last word on this vehicle's document.
 *
 * oem_document_copy_attempts holds one row per (tenant, brand, model,
 * model-year, kind), written by oem-document-store on every terminal outcome —
 * including the ones that stored nothing. Reading it is what turns "no copy
 * here" from an unexplained blank into a stated reason with a retry behind it.
 *
 * Null on any error or miss: this only enriches a sentence in the Vehicle
 * File, and an unreadable ledger must not take the Documents tab down.
 */
export interface OemDocCopyStatus {
  outcome: string;
  attempts: number;
  detail: string | null;
  resolved: boolean;
  lastAttemptAt: string | null;
}

export async function fetchOemDocCopyStatus(
  kind: OemDocKind,
  tenantId: string | null | undefined,
  ymm: string | null | undefined,
): Promise<OemDocCopyStatus | null> {
  const key = oemDocKeyFromYmm(ymm);
  if (!key || !tenantId) return null;
  try {
    const { data, error } = await supabase
      .from("oem_document_copy_attempts")
      .select("outcome, attempts, detail, resolved_at, last_attempt_at")
      .eq("tenant_id", tenantId)
      .eq("document_kind", kind)
      .eq("brand_key", key.make.trim().toLowerCase())
      .eq("model_key", key.model.trim().toLowerCase())
      .eq("year_key", key.year ?? 0)
      .maybeSingle();
    if (error || !data) return null;
    return {
      outcome: String(data.outcome),
      attempts: Number(data.attempts) || 0,
      detail: data.detail ?? null,
      resolved: !!data.resolved_at,
      lastAttemptAt: data.last_attempt_at ?? null,
    };
  } catch {
    return null;
  }
}
