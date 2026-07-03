// ──────────────────────────────────────────────────────────────────────
// Dealer Page artwork — hero image treatment (I01/I02) and the map
// preview panel (I36). The hero fallback is a drawn dealership exterior
// (glass showroom, entrance tower, canopy, car silhouettes) so a tenant
// without a storefront photo still gets a premium hero — never an empty
// dark box. Strokes stay light-on-navy so overlay content reads.
// ──────────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from "react";
import { DealerPageIcon } from "@/components/icons/DealerPageIcons";

const HERO_OVERLAY =
  "linear-gradient(90deg, rgba(5,18,38,0.92) 0%, rgba(5,18,38,0.78) 28%, rgba(5,18,38,0.42) 58%, rgba(5,18,38,0.16) 100%)";
const HERO_OVERLAY_BOTTOM =
  "linear-gradient(0deg, rgba(5,18,38,0.54) 0%, rgba(5,18,38,0) 100%)";

// Illustrated dealership facade: showroom glass wall, entrance tower with
// sign band, service wing, canopy, two showroom cars, flag, ground line.
const DealershipFacadeArt = () => (
  <svg viewBox="0 0 1200 480" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 w-full h-full" aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <defs>
      <linearGradient id="dlr-sky" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#0D1B2A" />
        <stop offset="55%" stopColor="#132A47" />
        <stop offset="100%" stopColor="#1B4470" />
      </linearGradient>
      <radialGradient id="dlr-glow" cx="0.72" cy="0.92" r="0.75">
        <stop offset="0%" stopColor="rgba(122,177,255,0.20)" />
        <stop offset="55%" stopColor="rgba(122,177,255,0.06)" />
        <stop offset="100%" stopColor="rgba(122,177,255,0)" />
      </radialGradient>
    </defs>
    <rect width="1200" height="480" fill="url(#dlr-sky)" />
    <rect width="1200" height="480" fill="url(#dlr-glow)" />

    {/* Distant skyline (left, sits under the darkest overlay) */}
    <g stroke="rgba(255,255,255,0.08)" strokeWidth="2">
      <path d="M60 442v-90h60v90M120 442v-130h52v130" />
      <path d="M72 372h36M72 396h36M132 336h28M132 362h28M132 388h28" />
    </g>

    {/* Canopy off the entrance (left of tower) */}
    <g stroke="rgba(255,255,255,0.24)" strokeWidth="2.5">
      <path d="M420 236H286a10 10 0 0 0-10 10v8h144" />
      <path d="M310 254v188M396 254v188" />
    </g>

    {/* Entrance tower with sign band and doors */}
    <g stroke="rgba(255,255,255,0.3)" strokeWidth="2.5">
      <path d="M420 442V150a10 10 0 0 1 10-10h130a10 10 0 0 1 10 10v292" />
      <rect x="446" y="176" width="118" height="30" rx="6" />
      <path d="M458 442v-84a6 6 0 0 1 6-6h82a6 6 0 0 1 6 6v84M505 352v90" />
    </g>
    <g stroke="rgba(255,255,255,0.14)" strokeWidth="2">
      <path d="M446 240h118M446 288h118" />
      <path d="M466 191h78" />
    </g>

    {/* Showroom block: fascia + glass wall with mullions */}
    <g stroke="rgba(255,255,255,0.28)" strokeWidth="2.5">
      <path d="M570 208h604" />
      <path d="M582 208v-26a8 8 0 0 1 8-8h552a8 8 0 0 1 8 8v26" />
      <path d="M598 208v234M1134 208v234" />
    </g>
    <g stroke="rgba(255,255,255,0.14)" strokeWidth="2">
      <path d="M666 214v228M734 214v228M802 214v228M870 214v228M938 214v228M1006 214v228M1074 214v228" />
      <path d="M598 322h536" />
    </g>

    {/* Showroom cars behind the glass */}
    <g stroke="rgba(255,255,255,0.26)" strokeWidth="2.5">
      <path d="M636 432v-18a9 9 0 0 1 9-9h22l19-22h58l21 22h24a9 9 0 0 1 9 9v18" />
      <path d="M636 432h32M708 432h58M806 432h-8" />
      <circle cx="688" cy="432" r="11" />
      <circle cx="786" cy="432" r="11" />
      <path d="M900 432v-18a9 9 0 0 1 9-9h22l19-22h58l21 22h24a9 9 0 0 1 9 9v18" />
      <path d="M900 432h32M972 432h58M1070 432h-8" />
      <circle cx="952" cy="432" r="11" />
      <circle cx="1050" cy="432" r="11" />
    </g>

    {/* Flag */}
    <g stroke="rgba(255,255,255,0.18)" strokeWidth="2.5">
      <path d="M232 442V236" />
      <path d="M232 240l40 10-40 10" />
    </g>

    {/* Ground line + forecourt marks */}
    <path d="M24 442h1152" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5" />
    <path d="M120 464h96M340 464h96M580 464h96M840 464h96" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
  </svg>
);

// Hero image frame (I01/I02): storefront photo when the tenant has one,
// the facade artwork otherwise, dark left-weighted overlay, content on
// the image. Image priority chain today: dealerTrust.storefrontUrl (the
// only image field derivePassport exposes); future fields such as
// tenant.heroImageUrl / packet hero photos slot in ahead of it here.
export function DealerHeroImage({
  src, alt, overlay = true, className, children,
}: { src?: string | null; alt: string; overlay?: boolean; className?: string; children?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  return (
    <section className={`relative rounded-[22px] overflow-hidden flex ${className ?? ""}`}>
      <DealershipFacadeArt />
      {src && !broken && <img src={src} alt={alt} onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: "center 42%" }} />}
      {overlay && (
        <>
          <div className="absolute inset-0 z-[1]" style={{ background: HERO_OVERLAY }} />
          <div className="absolute inset-x-0 bottom-0 z-[1] h-[38%]" style={{ background: HERO_OVERLAY_BOTTOM }} />
        </>
      )}
      {children}
    </section>
  );
}

// Map preview panel (I36): light street grid, curved roads, dealer pin
// and label. Renders as a link when href is given.
export function DealerMapPreview({
  name, address, href, className,
}: { name: string; address?: string | null; href?: string; className?: string }) {
  const body = (
    <>
      <div
        className="absolute inset-0 opacity-45"
        style={{ backgroundImage: "linear-gradient(#D8E2EF 1px, transparent 1px), linear-gradient(90deg, #D8E2EF 1px, transparent 1px)", backgroundSize: "34px 34px" }}
      />
      <svg viewBox="0 0 400 240" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true" fill="none">
        <path d="M-10 178C90 150 150 196 236 168s130-64 178-92" stroke="#C7D6E8" strokeWidth="13" strokeLinecap="round" />
        <path d="M-10 178C90 150 150 196 236 168s130-64 178-92" stroke="#FFFFFF" strokeWidth="2.5" strokeDasharray="10 9" />
        <path d="M118 250V132c0-26 22-40 48-46l96-22" stroke="#D3DFEE" strokeWidth="10" strokeLinecap="round" />
        <path d="M330 250c-6-52-30-76-72-92" stroke="#DCE6F2" strokeWidth="8" strokeLinecap="round" />
        <circle cx="200" cy="96" r="24" fill="#2563EB" opacity="0.12" />
      </svg>
      <div className="relative flex flex-col items-center justify-center h-full py-6">
        <span className="w-11 h-11 rounded-full bg-[#2563EB] flex items-center justify-center shadow-lg">
          <DealerPageIcon iconKey="address-location" size={20} color="#FFFFFF" />
        </span>
        <span className="text-[13px] font-extrabold mt-2 text-[#0F172A] text-center px-4">{name}</span>
        {address && <span className="text-[11.5px] text-[#64748B] font-medium text-center px-4">{address}</span>}
        {href && <span className="text-[11px] font-semibold text-[#2563EB] mt-0.5">Open in Maps</span>}
      </div>
    </>
  );
  const base = `relative block overflow-hidden bg-gradient-to-br from-[#F2F6FB] via-[#EAF1F9] to-[#F2F6FB] ${className ?? ""}`;
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={`${base} hover:opacity-95 transition-opacity`}>{body}</a>
    : <div className={base}>{body}</div>;
}
