// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/assets.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Document asset access rules.
//
// A signed storage URL is a temporary credential, not an address. The
// address is (bucket, path); the credential is minted per request. This
// module holds the decision logic both sides share: which asset row a
// request may reach, and whether a cached URL is still usable.
//
// Everything here is pure so the rules are unit-testable without a
// database — the edge function and the client both call into it.

export type DocumentAssetType = "pdf" | "thumbnail" | "preview";

/** Statuses a shopper may reach. Anything else is dealer-only. */
export const PUBLICLY_VISIBLE_STATUSES = ["published"] as const;

export interface DocumentAssetRow {
  documentId: string;
  documentVersion: number;
  documentStatus: string;
  assetType: DocumentAssetType;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  checksum?: string | null;
}

export interface AssetResolution {
  ok: boolean;
  row: DocumentAssetRow | null;
  reason: string | null;
}

/**
 * Pick the asset a public request may be served.
 *
 * Published only, highest version only. A draft, a pending-approval
 * version and a superseded version are all invisible to the public route
 * no matter how the request is shaped — there is no identifier a caller
 * can supply to reach one.
 */
export function resolvePublicAsset(
  rows: DocumentAssetRow[],
  assetType: DocumentAssetType,
): AssetResolution {
  const candidates = rows
    .filter((r) => r.assetType === assetType)
    .filter((r) => (PUBLICLY_VISIBLE_STATUSES as readonly string[]).includes(r.documentStatus))
    .filter((r) => !!r.storageBucket && !!r.storagePath)
    .sort((a, b) => b.documentVersion - a.documentVersion);
  if (!candidates.length) {
    const anyType = rows.some((r) => r.assetType === assetType);
    return {
      ok: false,
      row: null,
      reason: anyType
        ? "no published version of this document"
        : `no ${assetType} asset filed for this document`,
    };
  }
  return { ok: true, row: candidates[0], reason: null };
}

/**
 * Pick the asset an authorized dealer request may be served: any version
 * of a document belonging to the caller's tenant, including drafts.
 */
export function resolveDealerAsset(
  rows: DocumentAssetRow[],
  assetType: DocumentAssetType,
  documentId?: string | null,
): AssetResolution {
  const candidates = rows
    .filter((r) => r.assetType === assetType)
    .filter((r) => (documentId ? r.documentId === documentId : true))
    .filter((r) => !!r.storageBucket && !!r.storagePath)
    .sort((a, b) => b.documentVersion - a.documentVersion);
  if (!candidates.length) {
    return { ok: false, row: null, reason: `no ${assetType} asset available` };
  }
  return { ok: true, row: candidates[0], reason: null };
}

// Signed URLs are minted with this lifetime. Short on purpose: the URL is
// a credential for one viewing, and a fresh one costs a single request.
export const SIGNED_URL_TTL_SECONDS = 60 * 15;

// Refresh a little before expiry so a slow page never renders a dead link.
const REFRESH_MARGIN_SECONDS = 60;

/**
 * Whether a cached signed URL may still be used.
 *
 * A URL with no readable expiry is treated as expired rather than
 * trusted: the failure mode of re-signing is one extra request, and the
 * failure mode of trusting it is a broken customer-facing document.
 */
export function isSignedUrlUsable(url: string | null | undefined, nowMs: number): boolean {
  if (!url) return false;
  const expiry = signedUrlExpiryMs(url);
  if (expiry === null) return false;
  return expiry - REFRESH_MARGIN_SECONDS * 1000 > nowMs;
}

/** Expiry of a Supabase signed URL in epoch ms, or null when unreadable. */
export function signedUrlExpiryMs(url: string): number | null {
  const token = extractQueryParam(url, "token");
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  const exp = payload && typeof payload.exp === "number" ? payload.exp : null;
  return exp === null ? null : exp * 1000;
}

function extractQueryParam(url: string, key: string): string | null {
  const q = url.indexOf("?");
  if (q < 0) return null;
  for (const part of url.slice(q + 1).split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (decodeURIComponent(part.slice(0, eq)) === key) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = typeof atob === "function"
      ? atob(padded)
      // deno-lint-ignore no-explicit-any
      : (globalThis as any).Buffer?.from(padded, "base64").toString("binary");
    if (!json) return null;
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
