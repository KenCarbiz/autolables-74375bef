import type { SigningDocument } from "@/lib/stickerStudio/useSigningDocuments";
import { FileText, ExternalLink } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  window: "Window Sticker", addendum: "Addendum", passport: "Vehicle Passport",
  buyers_guide: "Buyer's Guide", cpo: "CPO Sheet",
};
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

// Read-only document cards the customer can open before signing. Used in both
// the full signing flow and the guided review.
export default function SigningDocumentsCards({ documents }: { documents: SigningDocument[] }) {
  if (documents.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-foreground">Documents for this vehicle</p>
      <div className="grid grid-cols-1 gap-2">
        {documents.map((d) => {
          const url = d.online_url || d.pdf_url || d.png_url || "";
          return (
            <div key={d.id} className="rounded-lg border border-border bg-card p-2.5 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0"><FileText className="w-4 h-4" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{TYPE_LABEL[d.document_type] || d.document_type}</p>
                <p className="text-[11px] text-muted-foreground">v{d.version}{d.published_at ? ` · published ${fmt(d.published_at)}` : d.approved_at ? ` · approved ${fmt(d.approved_at)}` : ""}</p>
              </div>
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer" className="h-8 px-2.5 rounded-md border border-border text-[11px] font-semibold text-blue-600 inline-flex items-center gap-1 flex-shrink-0">
                  <ExternalLink className="w-3.5 h-3.5" /> Open
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
