// ──────────────────────────────────────────────────────────────────────
// Opening a filed document from the DEALER side.
//
// generated_documents.pdf_url holds a SEVEN-DAY signed storage URL. It is a
// credential, not an address, and the shopper side learned that the hard way:
// usePublishedWindowSticker already re-mints through public-document-asset
// rather than trusting the column. The admin surfaces never got the same
// treatment, so a sticker generated on Monday opened fine and the same button
// answered
//
//   {"statusCode":"400","error":"InvalidJWT","message":"\"exp\" claim ..."}
//
// a week later — with the record still reading PUBLISHED, so it looked like the
// document had to be regenerated when the file was sitting in storage the whole
// time.
//
// The orchestrator's document_assets action already resolves the durable
// (bucket, path) from document_assets and signs it fresh. This module is the
// one place that decides when to spend that round trip. It sits at the top of
// lib/ rather than under factorySticker/ or documents/: both of those are
// mirrored into the edge bundle by sync:edge-sticker, and this is a
// browser-side access decision the renderer has no use for.
// ──────────────────────────────────────────────────────────────────────

import { isSignedUrlUsable } from "./factorySticker/assets";

/** What the caller needs from `useWindowSticker().documentAssets`. */
export interface FiledDocumentAssets {
  pdf_url: string | null;
  preview_url: string | null;
}

export type FiledAssetFetcher = (documentId: string) => Promise<FiledDocumentAssets>;

/**
 * A URL for a filed document that is valid right now.
 *
 * The stored URL is used only while it is provably still valid; anything
 * else — expired, unreadable, absent — is re-signed. Returns null rather than
 * a dead link so callers can hide the button instead of handing the user a
 * JSON error page.
 */
export async function freshFiledDocumentUrl(
  fetchAssets: FiledAssetFetcher,
  documentId: string | null | undefined,
  cached: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<string | null> {
  if (isSignedUrlUsable(cached, nowMs)) return cached ?? null;
  if (!documentId) return null;
  try {
    const assets = await fetchAssets(documentId);
    return assets?.pdf_url || null;
  } catch {
    return null;
  }
}

/**
 * Both asset URLs for a filed document, minted together.
 *
 * The card shows the thumbnail and links it to the PDF, and those must come
 * from the same fetch: two calls would sign the same document twice and could
 * disagree about whether it is reachable at all.
 */
export async function freshFiledDocumentAssets(
  fetchAssets: FiledAssetFetcher,
  documentId: string | null | undefined,
  cachedPdf: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<FiledDocumentAssets> {
  if (!documentId) return { pdf_url: null, preview_url: null };
  try {
    const assets = await fetchAssets(documentId);
    return {
      // Falling back to a still-valid cached URL keeps the button working when
      // the orchestrator is briefly unreachable.
      pdf_url: assets?.pdf_url || (isSignedUrlUsable(cachedPdf, nowMs) ? cachedPdf ?? null : null),
      preview_url: assets?.preview_url || null,
    };
  } catch {
    return {
      pdf_url: isSignedUrlUsable(cachedPdf, nowMs) ? cachedPdf ?? null : null,
      preview_url: null,
    };
  }
}
