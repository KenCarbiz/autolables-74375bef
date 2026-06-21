import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Customer-visible generated documents for a signing token (approved / printed
// / published only), via the public get_signing_documents RPC. Read-only; the
// signer reviews these before signing and a reference to them is frozen into
// the canonical signed payload. Resilient: empty when the RPC isn't deployed.
export interface SigningDocument {
  id: string;
  document_type: "window" | "addendum" | "passport" | string;
  template_id: string;
  template_version: number | null;
  version: number;
  label_mode?: string | null;
  pdf_url?: string | null;
  png_url?: string | null;
  online_url?: string | null;
  created_at: string;
  approved_at?: string | null;
  published_at?: string | null;
}

export function useSigningDocuments(token?: string | null) {
  const [documents, setDocuments] = useState<SigningDocument[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      try {
        // deno-lint-ignore no-explicit-any
        const { data } = await (supabase as any).rpc("get_signing_documents", { _token: token });
        if (!cancelled) { setDocuments(Array.isArray(data) ? data : []); setLoaded(true); }
      } catch { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return { documents, loaded };
}

// Frozen references for the canonical signed payload — proves which exact
// generated documents the customer reviewed. Stable shape + order.
export function signingDocumentRefs(documents: SigningDocument[]) {
  return documents.map((d) => ({
    generated_document_id: d.id,
    document_type: d.document_type,
    template_id: d.template_id,
    template_version: d.template_version ?? null,
    document_version: d.version,
    pdf_url: d.pdf_url ?? null,
    online_url: d.online_url ?? null,
    generated_at: d.created_at,
    approved_at: d.approved_at ?? null,
    published_at: d.published_at ?? null,
  }));
}
