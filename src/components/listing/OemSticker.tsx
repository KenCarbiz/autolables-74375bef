import { FileText, ExternalLink } from "lucide-react";
import type { VehicleListing } from "@/hooks/useVehicleListing";

// OEM Monroney window sticker module for the customer packet. Renders the
// rendered sticker inline (image) or as an open-in-new-tab link (PDF).
export default function OemSticker({ listing }: { listing: VehicleListing }) {
  const url = listing.oem_sticker_url;
  if (!url) return null;
  const isPdf = /\.pdf($|\?)/i.test(url);

  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
            <FileText className="w-4 h-4" />
          </span>
          <h2 className="text-sm font-semibold text-foreground">OEM window sticker</h2>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1">
          <ExternalLink className="w-3.5 h-3.5" /> Open full sticker
        </a>
      </div>

      {isPdf ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-border bg-muted/40 p-6 text-center hover:bg-muted/60 transition-colors">
          <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">View the original factory Monroney label</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Opens the OEM window sticker (PDF)</p>
        </a>
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-border overflow-hidden">
          <img src={url} alt="OEM window sticker" className="w-full h-auto" loading="lazy" />
        </a>
      )}
      <p className="text-[10px] text-muted-foreground mt-2">Original manufacturer's suggested retail price label. Separate from the dealer addendum.</p>
    </section>
  );
}
