import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isSignedUrlUsable } from "@/lib/factorySticker/assets";

// The customer-facing view of a vehicle's window sticker.
//
// Reads only what get_published_documents_public returns, so a draft, a
// review-required record or an unpublished version can never surface to a
// shopper.
//
// Asset URLs are NOT taken from the document row. Those are signed
// storage URLs that expire, which is exactly why published vehicles used
// to end up with a broken PDF and a dead thumbnail after a week. The row
// is used to learn that a published version exists; the actual URLs are
// minted fresh by public-document-asset on every load, and the stored one
// is used only while it is provably still valid.

export interface PublishedWindowSticker {
  id: string;
  version: number;
  pdfUrl: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
}

interface Row {
  id: string;
  document_type?: string;
  version?: number;
  pdf_url?: string | null;
  png_url?: string | null;
  online_url?: string | null;
  published_at?: string | null;
}

async function freshAssetUrl(
  slug: string,
  assetType: "pdf" | "thumbnail",
  cached: string | null,
): Promise<string | null> {
  // A cached URL with real time left on it is still a valid credential;
  // anything else — expired, unreadable, absent — is re-minted.
  if (isSignedUrlUsable(cached, Date.now())) return cached;
  try {
    const { data, error } = await supabase.functions.invoke("public-document-asset", {
      body: { slug, document_type: "factory_sticker", asset_type: assetType },
    });
    const payload = (data || {}) as { success?: boolean; url?: string };
    if (error || payload.success !== true || !payload.url) return null;
    return payload.url;
  } catch {
    return null;
  }
}

export function usePublishedWindowSticker(slug: string | null | undefined, enabled = true) {
  const [sticker, setSticker] = useState<PublishedWindowSticker | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = (slug || "").trim();
    if (!s || !enabled) { setSticker(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // deno-lint-ignore no-explicit-any
        let res = await (supabase as any).rpc("get_published_documents_public", { p_slug: s });
        // deno-lint-ignore no-explicit-any
        if (res.error) res = await (supabase as any).rpc("get_published_documents_public", { _slug: s });
        const rows = (Array.isArray(res.data) ? res.data : []) as Row[];
        const doc = rows
          .filter((r) => r.document_type === "factory_sticker")
          .sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
        if (cancelled) return;
        if (!doc) { setSticker(null); return; }

        const [pdfUrl, thumbnailUrl] = await Promise.all([
          freshAssetUrl(s, "pdf", doc.pdf_url || doc.online_url || null),
          freshAssetUrl(s, "thumbnail", doc.png_url || null),
        ]);
        if (cancelled) return;
        // A published document with no reachable file is not shown at all
        // rather than shown as a dead link.
        setSticker(pdfUrl
          ? {
            id: doc.id,
            version: doc.version || 1,
            pdfUrl,
            // The thumbnail is the first page of this vehicle's own
            // approved document, never a stock graphic.
            thumbnailUrl,
            publishedAt: doc.published_at || null,
          }
          : null);
      } catch {
        if (!cancelled) setSticker(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, enabled]);

  return { sticker, loading };
}
