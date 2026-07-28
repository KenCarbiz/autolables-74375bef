import { ChevronRight, FileText, ShieldCheck } from "lucide-react";
import { CARD, BLUE } from "@/lib/passportTokens";
import type { PublishedWindowSticker } from "@/hooks/usePublishedWindowSticker";

// Window Sticker entry point on the main Vehicle Passport page.
//
// Shown only when an approved version is actually published — a draft, a
// record awaiting review, or a vehicle whose brand has no template shows
// nothing at all rather than a broken card. The thumbnail is the first
// page of this VIN's own approved document.

interface Props {
  sticker: PublishedWindowSticker;
  vehicleLabel: string;
  /** Opens the passport Documents page. */
  onAllDocuments: () => void;
  variant?: "desktop" | "mobile";
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

export default function PassportWindowStickerCard({
  sticker, vehicleLabel, onAllDocuments, variant = "desktop",
}: Props) {
  const published = fmtDate(sticker.publishedAt);
  const mobile = variant === "mobile";

  const Thumb = (
    <div
      // The well keeps a subtle radius to match the design system; the sheet
      // inside it does not. `overflow-hidden` + `rounded-xl` on the container
      // was rounding the paper's own corners.
      className={`shrink-0 rounded-[4px] border border-[#E6E8EC] bg-[#F8FAFC] grid place-items-center p-[7px] ${
        mobile ? "w-full h-32" : "w-[168px] h-[124px]"
      }`}
    >
      {sticker.thumbnailUrl ? (
        <img
          src={sticker.thumbnailUrl}
          alt={`Window sticker for this ${vehicleLabel}`}
          // contain, not cover: the sticker is an 11x8.5 landscape page and
          // must show all four corners. object-cover object-top was cropping
          // it into a portrait tile, which is why it read as warped.
          className="max-w-full max-h-full object-cover object-top bg-white rounded-none"
          style={{ aspectRatio: "11 / 8.5", border: "1px solid rgba(15,23,42,0.10)", boxShadow: "0 1px 4px rgba(15,23,42,0.12)" }}
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <FileText className="w-7 h-7 text-[#94A3B8]" aria-hidden />
      )}
    </div>
  );

  return (
    <section className={`${CARD} p-4 sm:p-5`} aria-labelledby="passport-window-sticker">
      <div className={mobile ? "space-y-3" : "flex items-start gap-4"}>
        {Thumb}
        <div className="min-w-0 flex-1">
          <h3 id="passport-window-sticker" className="text-[15px] font-bold text-[#0F172A]">
            Original Equipment &amp; MSRP Window Sticker
          </h3>
          <p className="text-[13px] text-[#475569] mt-0.5">
            VIN-specific manufacturer equipment, options, pricing, fuel-economy, warranty and assembly information.
          </p>
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2 text-[12px] text-[#475569]">
            <span className="inline-flex items-center gap-1 font-semibold text-[#15803D]">
              <ShieldCheck className="w-3.5 h-3.5" /> Verified vehicle data
            </span>
            <span aria-hidden>·</span>
            <span>PDF</span>
            {published && (<><span aria-hidden>·</span><span>Updated {published}</span></>)}
          </div>

          <div className={`flex items-center gap-2 mt-3 ${mobile ? "flex-col items-stretch" : "flex-wrap"}`}>
            {sticker.pdfUrl && (
              <a
                href={sticker.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-xl text-[13px] font-bold text-white"
                style={{ backgroundColor: BLUE }}
              >
                View Window Sticker
              </a>
            )}
            <button
              type="button"
              onClick={onAllDocuments}
              className="inline-flex items-center justify-center gap-1 min-h-[44px] px-4 rounded-xl border border-[#E6E8EC] text-[13px] font-bold text-[#0F172A] hover:border-[#2563EB] transition-colors"
            >
              All Documents <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
