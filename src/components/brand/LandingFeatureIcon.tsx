// ──────────────────────────────────────────────────────────────────────
// LandingFeatureIcon — the single icon system for the public landing page.
// Renders the finished high-quality PNG icon pack (public/NN_name.png). Each
// PNG already includes its own softly-rounded pale-blue tile, so this component
// renders the image directly with NO extra tile / border / background / shadow
// — a transparent sizing wrapper only.
//
// Sizes are explicit (never inherited) so an icon never shrinks when its
// adjoining label wraps:
//   hero      → 56×56 desktop · 50×50 mobile
//   card      → 75×75 desktop · 70×70 mobile  (+45% over the 52/48 base)
//   workflow  → 75×75 desktop · 70×70 mobile  (+45% over the 52/48 base)
//
// To swap art, change only the SRC path — the feature wiring lives in the
// landingIcons map in Landing.tsx.
// ──────────────────────────────────────────────────────────────────────

export type LandingGlyphName =
  | "qrPassport" | "routedLead" | "digitalSignature" | "priceReconciliation"
  | "ftcAddendum" | "tamperEvident" | "sellAddons" | "ownYourPrice"
  | "signedProof" | "auditDefense" | "decode" | "stick" | "sign" | "close"
  | "vehicleArrives" | "getReadyQueue" | "installProof" | "foremanSignoff"
  | "rightStickerOut";

type Variant = "hero" | "card" | "workflow";

// Finished no-pink PNG pack, served from /public. Filenames preserved exactly.
const SRC: Record<LandingGlyphName, string> = {
  qrPassport:          "/01_qr_vehicle_passport.png",
  routedLead:          "/02_routed_lead.png",
  digitalSignature:    "/03_digital_signature.png",
  priceReconciliation: "/04_price_reconciliation.png",
  ftcAddendum:         "/05_ftc_addendum.png",
  tamperEvident:       "/06_tamper_evident_record.png",
  sellAddons:          "/07_add_on_election.png",
  ownYourPrice:        "/08_price_integrity.png",
  signedProof:         "/09_signed_proof.png",
  auditDefense:        "/10_audit_defense_file.png",
  decode:              "/11_vin_decode.png",
  stick:               "/12_apply_sticker.png",
  sign:                "/13_sign.png",
  close:               "/14_close.png",
  vehicleArrives:      "/15_vehicle_arrival.png",
  getReadyQueue:       "/16_get_ready_queue.png",
  installProof:        "/17_installer_proof.png",
  foremanSignoff:      "/18_foreman_approval.png",
  rightStickerOut:     "/19_publish_sticker.png",
};

// Explicit rendered box per variant. Mobile floor first, desktop at lg.
const SIZE: Record<Variant, string> = {
  hero: "h-[50px] w-[50px] min-h-[50px] min-w-[50px] lg:h-[56px] lg:w-[56px] lg:min-h-[56px] lg:min-w-[56px]",
  card: "h-[70px] w-[70px] min-h-[70px] min-w-[70px] lg:h-[75px] lg:w-[75px] lg:min-h-[75px] lg:min-w-[75px]",
  workflow: "h-[70px] w-[70px] min-h-[70px] min-w-[70px] lg:h-[75px] lg:w-[75px] lg:min-h-[75px] lg:min-w-[75px]",
};

interface Props {
  name: LandingGlyphName;
  variant?: Variant;
  className?: string;
}

export function LandingFeatureIcon({ name, variant = "card", className = "" }: Props) {
  return (
    <img
      src={SRC[name]}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      loading={variant === "hero" ? "eager" : "lazy"}
      className={`block shrink-0 object-contain ${SIZE[variant]} ${className}`}
    />
  );
}

export default LandingFeatureIcon;
