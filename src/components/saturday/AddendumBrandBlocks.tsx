// ──────────────────────────────────────────────────────────────────────
// Header identity + footer attribution, shared by every addendum template.
//
// The addendum is the DEALER's document, so the top-left masthead is the
// dealer's own logo and the block beside it is the dealership name. Both come
// from Admin > Branding rather than from the location chain: a rooftop row can
// carry a group trading name and a placeholder logo, and the addendum is the
// dealership's letterhead, not a per-rooftop document. AutoLabels attribution
// lives in the footer lockup and nowhere else — the platform is the printer,
// not the seller.
//
// These live in one module because the five addendum templates already
// drifted apart once. A header change made in five places gets made in four.
// ──────────────────────────────────────────────────────────────────────

import { useState } from "react";
import type { SaturdayDealer } from "./types";
import { AutoLabelsWordmarkArt } from "@/components/brand/AutoLabelsWordmarkArt";

/**
 * The navy "Powered by auto(LABELS)" footer lockup. No glyph beside it.
 *
 * The wordmark is the official outlined artwork, not text set in Inter: this
 * block prints, and a customer document must not render a different logo
 * depending on which fonts the rendering machine happens to have.
 */
export const AddendumPoweredBy = () => (
  <span className="min-w-0">
    <span className="block text-[5.4px] font-bold uppercase tracking-[0.18em] text-white/70">Powered by</span>
    <AutoLabelsWordmarkArt height={11} reverse className="mt-[1.5px]" />
  </span>
);

/**
 * Top-left masthead. Renders the dealer's saved logo; when there is none (or
 * the dealer switched it off, or it fails to load) it falls back to the
 * dealership name set as a wordmark, never to AutoLabels branding.
 */
export const AddendumDealerMasthead = ({
  dealer,
  navy,
  muted,
}: {
  dealer: SaturdayDealer;
  navy: string;
  muted: string;
}) => {
  const [failed, setFailed] = useState(false);
  const logoUrl = addendumLogoUrl(dealer);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={addendumDealerName(dealer)}
        crossOrigin="anonymous"
        onError={() => setFailed(true)}
        className="h-[0.44in] w-auto max-w-[1.9in] object-contain object-left"
      />
    );
  }

  return (
    <span className="min-w-0">
      <span className="block text-[14px] font-black uppercase leading-none tracking-[-0.01em]" style={{ color: navy }}>
        {addendumDealerName(dealer)}
      </span>
      {dealer.slogan && (
        <span className="block mt-[3px] text-[6px] font-bold uppercase tracking-[0.16em]" style={{ color: muted }}>
          {dealer.slogan}
        </span>
      )}
    </span>
  );
};

/** The logo the masthead prints: the one saved on Admin > Branding, falling
 *  back to whatever the location chain resolved. Empty when the dealer turned
 *  the logo off for this template. */
export const addendumLogoUrl = (dealer: SaturdayDealer): string =>
  dealer.logoEnabled === false ? "" : (dealer.tenantLogoUrl || dealer.logoUrl || "");

/** The dealership name the addendum prints, top right. */
export const addendumDealerName = (dealer: SaturdayDealer): string =>
  dealer.tenantName || dealer.name;

/** True when the masthead will render the dealer logo rather than the name. */
export const mastheadShowsLogo = (dealer: SaturdayDealer): boolean => !!addendumLogoUrl(dealer);
