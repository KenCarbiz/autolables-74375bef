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
      className={`shrink-0 overflow-hidden rounded-xl border border-[#E6E8EC] bg-white grid place-items-center ${
        mobile ? "w-full h-28" : "w-[136px] h-[104px]"
      }`}
    >
      {sticker.thumbnailUrl ? (
        <img
          src={sticker.thumbnailUrl}
          alt={`Window sticker for this ${vehicleLabel}`}
          className="w-full h-full object-cover object-top"
          loading="lazy"
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
