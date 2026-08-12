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

export type OemDocKind = "brochure" | "owners_manual";

export const OEM_DOC_TABLE: Record<OemDocKind, string> = {
  brochure: "oem_brochure_links",
  owners_manual: "oem_owners_manual_links",
};

export interface OemDocKey {
  make: string;
  model: string;
  year: number | null;
}

export interface OemDocLinkRow {
  url: string;
  year: number | null;
  title?: string | null;
  verified_at?: string | null;
}

/**
 * Split a stored "2027 INFINITI QX60 LUXE" into its harvest key.
 *
 * Returns null when either half is missing: a lookup with no make or no model
 * would match the first row of some other vehicle's model line.
 */
export function oemDocKeyFromYmm(ymm: string | null | undefined): OemDocKey | null {
  const parts = String(ymm || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const yearRaw = Number.parseInt(parts[0] || "", 10);
  const hasYear = Number.isFinite(yearRaw) && yearRaw > 1900;
  const rest = hasYear ? parts.slice(1) : parts;
  const make = rest[0] || "";
  const model = rest.slice(1).join(" ");
  if (!make || !model) return null;
  return { make, model, year: hasYear ? yearRaw : null };
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
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          ilike: (c: string, v: string) => {
            ilike: (c: string, v: string) => {
              order: (c: string, o: Record<string, unknown>) => {
                limit: (n: number) => Promise<{ data: OemDocLinkRow[] | null; error: unknown }>;
              };
            };
          };
        };
      };
    })
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
