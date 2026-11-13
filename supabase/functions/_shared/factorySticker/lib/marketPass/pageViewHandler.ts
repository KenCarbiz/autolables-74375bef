// GENERATED — do not edit.
// Mirror of src/lib/marketPass/pageViewHandler.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── marketpass-assessment ?view=page decision, without Deno ─────────────────
//
// The edge function gathers the inputs (the raw listing row for the tenant
// binding and the MarketPass contract, the public row public-listing-view
// ships to the customer Passport, the dealer settings, the published window
// sticker). Everything decided after that is this pure function.
//
//   no listing, or a draft                     -> 404 not_found
//   ?tenant_id= given and not the listing's    -> 404 not_found
//   otherwise                                  -> { ok, page, marketpass }
//
// `marketpass` is the public MarketPass contract only while the tenant's
// marketpass_v2 flag is on, exactly as the default view behaves; the page
// itself does not depend on that flag.

import { decideMarketPassResponse, type MarketPassCaller } from "../intelligence/marketPass/handler.ts";
import type { MarketPassRow } from "../intelligence/marketPass/rowEvidence.ts";
import { buildMarketPassPageView, type PageViewWindowSticker } from "./pageView.ts";

export interface PageViewRequest {
  /** The listing row as get_vehicle_listing_by_slug returns it. */
  row: MarketPassRow | null;
  /** The row public-listing-view ships to the Passport; the raw row stands in when absent. */
  publicRow?: Record<string, unknown> | null;
  settings: unknown;
  caller: MarketPassCaller;
  nowMs: number;
  expectedTenantId?: string | null;
  windowSticker?: PageViewWindowSticker | null;
}

export interface PageViewResponse {
  status: number;
  body: unknown;
}

export function decidePageViewResponse(req: PageViewRequest): PageViewResponse {
  const { row } = req;
  if (!row || !row.vin) return { status: 404, body: { error: "not_found" } };
  if (req.expectedTenantId != null && req.expectedTenantId !== "" && row.tenant_id !== req.expectedTenantId) {
    return { status: 404, body: { error: "not_found" } };
  }
  if (row.status === "draft") return { status: 404, body: { error: "not_found" } };
  if (req.publicRow && req.publicRow.tenant_id != null && req.publicRow.tenant_id !== row.tenant_id) {
    return { status: 404, body: { error: "not_found" } };
  }

  const page = buildMarketPassPageView(req.publicRow ?? row, { nowMs: req.nowMs, windowSticker: req.windowSticker ?? null });

  // The flag is read in one place (decideMarketPassResponse); a 404 there
  // (flag off, or a listing that is not published) simply means no contract.
  const decision = decideMarketPassResponse({
    row, settings: req.settings, caller: req.caller, audience: "public", nowMs: req.nowMs, expectedTenantId: req.expectedTenantId,
  });
  const marketpass: unknown = decision.status === 200 ? decision.body : null;
  return { status: 200, body: { ok: true, page, marketpass } };
}

export interface PublishedDocumentRow {
  document_type?: string;
  version?: number;
  published_at?: string | null;
}

/**
 * The window sticker the Passport shows: the highest published factory_sticker
 * version, addressed through public-document-asset's stable redirect so the
 * signed storage URL is minted per visit and never stored. No filed PDF means
 * no card, as on the page.
 */
export function pickWindowSticker(
  rows: PublishedDocumentRow[],
  opts: { functionsBase: string; slug: string; hasPdf: boolean; hasThumbnail: boolean },
): PageViewWindowSticker | null {
  const doc = rows
    .filter((r) => r.document_type === "factory_sticker")
    .sort((a, b) => (b.version || 0) - (a.version || 0))[0];
  if (!doc || !opts.hasPdf) return null;
  const addr = (asset: "pdf" | "thumbnail") =>
    `${opts.functionsBase}/public-document-asset?slug=${encodeURIComponent(opts.slug)}&document_type=factory_sticker&asset_type=${asset}&redirect=1`;
  return { pdfUrl: addr("pdf"), thumbnailUrl: opts.hasThumbnail ? addr("thumbnail") : null, publishedAt: doc.published_at ?? null };
}
