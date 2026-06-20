import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FileText, ExternalLink, Download } from "lucide-react";

// Customer-facing document section on the Vehicle Passport (/v/:slug). Reads
// ONLY published documents via the get_published_documents_public RPC (anon
// can't touch generated_documents directly). Renders clean cards the shopper
// can open / download. Drafts and internal states never appear here.

interface PublicDoc {
  id: string;
  document_type: "window" | "addendum" | "passport" | string;
  version: number;
  label_mode?: string | null;
  pdf_url?: string | null;
  png_url?: string | null;
  online_url?: string | null;
  published_at?: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  window: "Window Sticker",
  addendum: "Addendum",
  passport: "Vehicle Passport",
  buyers_guide: "Buyer's Guide",
  cpo: "CPO Sheet",
};

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

export default function PassportDocuments({ slug, heading = "Vehicle documents" }: { slug: string; heading?: string }) {
  const [docs, setDocs] = useState<PublicDoc[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        // deno-lint-ignore no-explicit-any
        const { data } = await (supabase as any).rpc("get_published_documents_public", { _slug: slug });
        if (!cancelled) { setDocs(Array.isArray(data) ? data : []); setLoaded(true); }
      } catch { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Nothing published (or RPC not deployed): render nothing so the passport
  // stays clean.
  if (!loaded || docs.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-premium">
      <h2 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5 mb-3"><FileText className="w-4 h-4 text-primary" /> {heading}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {docs.map((d) => {
          const open = d.online_url || d.pdf_url || d.png_url || "";
          const dl = d.pdf_url || d.png_url || "";
          return (
            <div key={d.id} className="rounded-xl border border-border bg-background p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{TYPE_LABEL[d.document_type] || d.document_type}</p>
                <p className="text-[11px] text-muted-foreground">{d.published_at ? `Published ${fmt(d.published_at)}` : "Published"} · v{d.version}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {open && <a href={open} target="_blank" rel="noopener noreferrer" title="Open" className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"><ExternalLink className="w-4 h-4" /></a>}
                {dl && <a href={dl} download target="_blank" rel="noopener noreferrer" title="Download" className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"><Download className="w-4 h-4" /></a>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
