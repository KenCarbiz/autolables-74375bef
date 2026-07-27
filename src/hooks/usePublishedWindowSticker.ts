import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// The customer-facing view of a vehicle's window sticker. Reads only what
// get_published_documents_public returns, so a draft, a review-required
// record or an unpublished version can never surface to a shopper.

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
          .filter((r) => r.document_type === "factory_sticker" && (r.pdf_url || r.online_url))
          .sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
        if (cancelled) return;
        setSticker(doc
          ? {
            id: doc.id,
            version: doc.version || 1,
            pdfUrl: doc.pdf_url || doc.online_url || null,
            // The thumbnail is the first page of this vehicle's own
            // approved document, never a stock graphic.
            thumbnailUrl: doc.png_url || null,
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
