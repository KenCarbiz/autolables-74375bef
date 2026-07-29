// ──────────────────────────────────────────────────────────────────────
// The cover art for one document row on the customer Documents page.
//
// The owner's manual and the OEM brochure are external links. We hold the
// URL, not the file — some of those PDFs run to hundreds of megabytes, and
// nothing here fetches one. So the cover is DRAWN from data we already have
// (year, make, model, VIN, the vehicle photo) rather than rendered from the
// document. That is why it is a React tree and not an <img>: it costs one
// image request at most, works offline of the OEM's site entirely, and can
// never be a blank sheet waiting on a download that is not coming.
//
// Priority, in order:
//   1. a stored thumbnail of the real file, when one exists and loads
//   2. a drawn cover for the document type, built from the vehicle
//   3. a neutral typographic cover
// There is no fourth step where an icon sits alone on a white page.
//
// TRADEMARKS: no OEM mark is ever drawn here. The brand appears as its own
// letterspaced wordmark text, or as a real image only when the dealer has
// uploaded one under their franchise licence. Same rule as OemLogoRegistry.
// There is no authorized CARFAX asset in this repository, so the history
// cover is deliberately unbranded — the card's TITLE still names the
// provider, which is a statement of fact rather than a use of their mark.
// ──────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { getTheme } from "@/lib/factorySticker/oem/themes";
import { oemDisplayName, resolveOemBrand } from "@/components/brand/OemLogoRegistry";

export type DocumentCoverType =
  | "factory_sticker"
  | "carfax"
  | "vehicle_history"
  | "owners_manual"
  | "oem_brochure"
  | "buyers_guide"
  | "warranty"
  | "generic";

export interface DocumentCoverThumbnailProps {
  type: DocumentCoverType;
  year?: number | string;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  primaryVehiclePhotoUrl?: string | null;
  thumbnailUrl?: string | null;
  provider?: string | null;
  externalUrl?: string | null;
  /** A real pictorial mark, only ever a dealer-supplied licensed asset. */
  oemLogoUrl?: string | null;
  /**
   * What to print on a neutral cover -- "SERVICE RECORD", "INSPECTION".
   * Comes from the same type vocabulary the rest of the page uses, so this
   * component never has to keep a second list of document names.
   */
  neutralTitle?: string | null;
  className?: string;
}

/** 8.5 x 11 to two decimals — the ratio the mounting area is built around. */
export const DOCUMENT_COVER_ASPECT = 8.5 / 11;

const PAPER: React.CSSProperties = {
  border: "1px solid rgba(15,23,42,0.10)",
  boxShadow: "0 2px 6px rgba(15,23,42,0.12)",
  borderRadius: 3,
};

const clean = (s?: string | null) => String(s ?? "").trim();

/** "3PCAJ5JR1SF103167" reads as noise at 9px; group it so it scans. */
export function formatVin(vin?: string | null): string {
  const v = clean(vin).toUpperCase();
  if (v.length !== 17) return v;
  return `${v.slice(0, 3)} ${v.slice(3, 9)} ${v.slice(9)}`;
}

/**
 * The brand wordmark and the two colours a drawn cover is built from.
 * Falls back to the neutral AutoLabels theme for a make outside the OEM
 * registry, so a Rivian or a Polestar still gets a real cover.
 */
export function coverBrand(make?: string): { name: string; dark: string; accent: string } {
  const key = resolveOemBrand(make);
  const theme = getTheme(key ? key.toUpperCase().replace(/-/g, "_") : "AUTOLABELS_FALLBACK");
  const name = key ? oemDisplayName(key) : clean(make).toUpperCase();
  return {
    name: name || "MANUFACTURER",
    // Manual covers are dark by convention; a light OEM header colour would
    // put light text on light paper, so anything pale drops to charcoal.
    dark: isDark(theme.colors.headerBackground) ? theme.colors.headerBackground : "#1E252E",
    accent: theme.colors.accent || "#2563EB",
  };
}

/** Rough perceived luminance; good enough to reject a pale header colour. */
function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
}

/** The screen-reader name for a cover. Decorative parts stay aria-hidden. */
export function coverLabel(p: Pick<DocumentCoverThumbnailProps, "type" | "year" | "make" | "model" | "vin" | "provider">): string {
  const ymm = [p.year, p.make, p.model].map((x) => clean(String(x ?? ""))).filter(Boolean).join(" ");
  switch (p.type) {
    case "owners_manual": return `${ymm} owner's manual cover`.trim();
    case "oem_brochure": return `${ymm} official brochure cover`.trim();
    case "carfax":
    case "vehicle_history": {
      const prov = clean(p.provider).toLowerCase();
      const who = prov === "autocheck" ? "AutoCheck " : prov === "carfax" ? "CARFAX " : "";
      const vin = clean(p.vin);
      return vin
        ? `${who}vehicle history report for VIN ${vin}`
        : `${who}vehicle history report${ymm ? ` for ${ymm}` : ""}`;
    }
    case "factory_sticker": return `${ymm} factory window sticker cover`.trim();
    case "buyers_guide": return `${ymm} buyers guide cover`.trim();
    case "warranty": return `${ymm} warranty document cover`.trim();
    default: return ymm ? `${ymm} document cover` : "Document cover";
  }
}

/** A darkened, desaturated band of the vehicle photo. Decorative only. */
const PhotoBand = ({ url, onFail, className, style }: {
  url: string; onFail: () => void; className?: string; style?: React.CSSProperties;
}) => (
  <img
    src={url} alt="" aria-hidden loading="lazy" onError={onFail}
    className={`absolute object-cover ${className ?? ""}`}
    style={style}
  />
);

/** Stands in for the photo when there is none, or it failed. Never an icon. */
const CarSilhouette = ({ color }: { color: string }) => (
  <svg viewBox="0 0 120 44" className="w-[74%] h-auto" aria-hidden fill="none">
    <path
      d="M8 34c0-3 1-6 3-7l10-4 9-9c2-2 5-3 8-3h26c4 0 8 2 11 5l7 7 12 3c5 1 8 4 8 8v4c0 2-1 3-3 3H11c-2 0-3-1-3-3v-4z"
      fill={color} opacity="0.5"
    />
    <circle cx="33" cy="38" r="6" fill={color} opacity="0.75" />
    <circle cx="90" cy="38" r="6" fill={color} opacity="0.75" />
  </svg>
);

export function DocumentCoverThumbnail({
  type, year, make, model, trim, vin,
  primaryVehiclePhotoUrl, thumbnailUrl, provider, oemLogoUrl, neutralTitle, className,
}: DocumentCoverThumbnailProps) {
  // Two independent one-way latches. Once an asset has failed we never point
  // at it again, so a broken URL cannot drive a render/onError loop.
  const [thumbFailed, setThumbFailed] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  // A new document in the same slot deserves a fresh attempt.
  useEffect(() => { setThumbFailed(false); }, [thumbnailUrl]);
  useEffect(() => { setPhotoFailed(false); }, [primaryVehiclePhotoUrl]);
  useEffect(() => { setLogoFailed(false); }, [oemLogoUrl]);

  const brand = coverBrand(make);
  const label = coverLabel({ type, year, make, model, vin, provider });
  const yr = clean(String(year ?? ""));
  const md = clean(model);
  const mk = clean(make);
  const photo = !photoFailed ? clean(primaryVehiclePhotoUrl) : "";
  const logo = !logoFailed ? clean(oemLogoUrl) : "";

  // A definite WIDTH, with the height derived from it. The cover's content is
  // absolutely positioned, so it has no intrinsic size of its own: left to
  // stretch inside a flex well it collapsed to the width of its own border.
  const frame = `relative overflow-hidden bg-white shrink-0 w-[92px] sm:w-[124px] ${className ?? ""}`;
  const frameStyle = { ...PAPER, aspectRatio: "8.5 / 11" } as React.CSSProperties;

  // 1. The real document's own first page, when we have one that loads.
  const storedThumb = !thumbFailed ? clean(thumbnailUrl) : "";
  if (storedThumb) {
    return (
      <div className={frame} style={frameStyle} role="img" aria-label={label}>
        <img
          src={storedThumb} alt="" aria-hidden loading="lazy"
          onError={() => setThumbFailed(true)}
          className="absolute inset-0 w-full h-full object-contain bg-white"
        />
      </div>
    );
  }

  // The brand line: a licensed image when the dealer supplied one, otherwise
  // the wordmark as text. Never a drawn emblem.
  const Wordmark = ({ color, size }: { color: string; size: number }) =>
    logo ? (
      <img
        src={logo} alt="" aria-hidden onError={() => setLogoFailed(true)}
        style={{ height: size * 1.6 }} className="object-contain"
      />
    ) : (
      <span
        className="font-black uppercase leading-none"
        style={{ color, fontSize: size, letterSpacing: "0.16em" }}
      >
        {brand.name}
      </span>
    );

  // 2. A drawn cover for the type.
  if (type === "owners_manual") {
    return (
      <div className={frame} style={{ ...frameStyle, background: brand.dark }} role="img" aria-label={label}>
        <div className="absolute inset-0 flex flex-col items-center text-center px-[8%] pt-[11%] pb-[8%]">
          <Wordmark color="#FFFFFF" size={9} />
          <div className="relative w-full flex-1 my-[7%] flex items-center justify-center">
            {photo ? (
              <PhotoBand
                url={photo} onFail={() => setPhotoFailed(true)}
                className="inset-0 w-full h-full"
                style={{ filter: "grayscale(1) brightness(0.62) contrast(1.05)", opacity: 0.85 }}
              />
            ) : (
              <CarSilhouette color="#FFFFFF" />
            )}
          </div>
          <span className="text-white/90 font-semibold leading-tight" style={{ fontSize: 8 }}>
            {[yr, md].filter(Boolean).join(" ") || mk}
          </span>
          <span
            className="text-white font-black uppercase leading-tight mt-[3px]"
            style={{ fontSize: 8.5, letterSpacing: "0.1em" }}
          >
            Owner's Manual
          </span>
          <span className="mt-auto pt-[6%] text-white/55 uppercase" style={{ fontSize: 5.5, letterSpacing: "0.14em" }}>
            {brand.name} · Manufacturer
          </span>
        </div>
      </div>
    );
  }

  if (type === "oem_brochure") {
    return (
      <div className={frame} style={{ ...frameStyle, background: brand.dark }} role="img" aria-label={label}>
        {photo ? (
          <PhotoBand
            url={photo} onFail={() => setPhotoFailed(true)}
            className="inset-0 w-full h-full"
            style={{ objectPosition: "center" }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center"><CarSilhouette color="#FFFFFF" /></div>
        )}
        {/* Readable gradient over the photograph. */}
        <div
          className="absolute inset-0"
          aria-hidden
          style={{ background: "linear-gradient(to bottom, rgba(8,12,20,0.62) 0%, rgba(8,12,20,0.12) 38%, rgba(8,12,20,0.86) 100%)" }}
        />
        <div className="absolute inset-0 flex flex-col px-[9%] pt-[9%] pb-[9%]">
          <Wordmark color="#FFFFFF" size={8.5} />
          <div className="mt-auto text-left">
            <span className="block text-white font-black leading-tight" style={{ fontSize: 9 }}>
              {[yr, mk, md].filter(Boolean).join(" ")}
            </span>
            <span
              className="block text-white/75 uppercase font-bold mt-[3px]"
              style={{ fontSize: 5.5, letterSpacing: "0.14em" }}
            >
              Official Vehicle Brochure
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (type === "carfax" || type === "vehicle_history") {
    // Unbranded by design — see the trademark note at the top of this file.
    const navy = "#12355B";
    return (
      <div className={frame} style={frameStyle} role="img" aria-label={label}>
        <div className="absolute inset-x-0 top-0" style={{ height: "5%", background: navy }} aria-hidden />
        <div className="absolute inset-0 flex flex-col items-center text-center px-[9%] pt-[13%] pb-[8%]">
          <span
            className="font-black uppercase leading-tight"
            style={{ color: navy, fontSize: 7.5, letterSpacing: "0.1em" }}
          >
            Vehicle History<br />Report
          </span>
          <div className="w-[36%] my-[6%]" style={{ borderTop: `1.5px solid ${navy}`, opacity: 0.35 }} aria-hidden />
          <div className="relative w-full h-[26%] flex items-center justify-center overflow-hidden">
            {photo ? (
              <PhotoBand
                url={photo} onFail={() => setPhotoFailed(true)}
                className="inset-0 w-full h-full"
                style={{ filter: "grayscale(1) contrast(1.04)", opacity: 0.9 }}
              />
            ) : (
              <CarSilhouette color={navy} />
            )}
          </div>
          <span className="font-bold leading-tight mt-[6%]" style={{ color: "#0F172A", fontSize: 7 }}>
            {[yr, mk, md].filter(Boolean).join(" ")}
          </span>
          {formatVin(vin) && (
            <span className="mt-auto pt-[5%] tabular-nums" style={{ color: "#64748B", fontSize: 5, letterSpacing: "0.06em" }}>
              VIN {formatVin(vin)}
            </span>
          )}
        </div>
      </div>
    );
  }

  // 3. Neutral typographic cover — a real cover, not an icon on a blank page.
  const NEUTRAL_TITLE: Record<string, string> = {
    factory_sticker: "Window Sticker",
    buyers_guide: "Buyers Guide",
    warranty: "Warranty",
    generic: "Document",
  };
  const heading = clean(neutralTitle) || NEUTRAL_TITLE[type] || "Document";
  return (
    <div className={frame} style={frameStyle} role="img" aria-label={label}>
      <div className="absolute inset-x-0 top-0" style={{ height: "3.5%", background: "#94A3B8" }} aria-hidden />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-[10%] gap-[6%]">
        <span
          className="font-black uppercase leading-tight"
          style={{ color: "#0F172A", fontSize: 8, letterSpacing: "0.09em" }}
        >
          {heading}
        </span>
        <div className="w-[34%]" style={{ borderTop: "1.5px solid rgba(15,23,42,0.18)" }} aria-hidden />
        <span className="font-semibold leading-tight" style={{ color: "#475569", fontSize: 6.5 }}>
          {[yr, mk, md].filter(Boolean).join(" ") || trim || ""}
        </span>
      </div>
    </div>
  );
}

export default DocumentCoverThumbnail;
