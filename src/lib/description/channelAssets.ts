// ─────────────────────────────────────────────────────────────────────
// Provider asset manifest for the channel cards.
//
// Every card renders through this manifest so the seven logos share one
// viewport and one normalization rule instead of each card hand-tuning its
// own image. Optical scale exists because a compact square glyph and a wide
// wordmark that occupy the same box do NOT read as the same visual weight.
//
// `authorization` is the important field. A provider logo is a trademark:
// AutoLabels may only ship an asset the owner has actually obtained and is
// licensed to use. Anything else — a wordmark typed in a similar font, a
// traced approximation, a hotlinked image — is not a logo, and a card whose
// asset is unauthorized renders an explicit incomplete state rather than
// pretending. That state is a build blocker, not a design.
// ─────────────────────────────────────────────────────────────────────

export type AssetAuthorization =
  /** Owner-supplied or licensed brand asset. Safe to render. */
  | "authorized"
  /** AutoLabels' own product icon (not a third-party mark). Safe to render. */
  | "autolabels_owned"
  /** No asset obtained yet. Card renders the honest incomplete state. */
  | "missing"
  /** A file exists but is a hand-made approximation of a trademark. */
  | "unauthorized_approximation";

export interface ChannelAsset {
  channel: string;
  /** Public path of the asset. Null while unobtained. */
  src: string | null;
  /** Intrinsic pixel dimensions, used to reserve space and check ratio. */
  intrinsicWidth: number | null;
  intrinsicHeight: number | null;
  /**
   * Optical correction, applied as a scale inside the shared viewport. 1 means
   * the asset already reads at the right weight. A compact square glyph
   * (Facebook, Google) needs to be smaller than its bounding box suggests;
   * a long thin wordmark needs to run closer to the full width.
   */
  opticalScale: number;
  alt: string;
  authorization: AssetAuthorization;
  /** Why the asset is not renderable, surfaced to the developer and to ops. */
  note?: string;
}

/** One viewport for every card, per the Phase 5 normalization target. */
export const LOGO_VIEWPORT = { width: 92, height: 40 } as const;

// NOTE FOR THE OWNER — six of these seven are third-party trademarks and
// cannot be produced by AutoLabels. They need to come from each provider's
// brand-resource page or from the dealer's existing partner agreement. Drop
// the licensed file into public/marketplace-logos/ and flip `authorization`
// to "authorized"; nothing else has to change.
export const CHANNEL_ASSETS: ChannelAsset[] = [
  {
    channel: "autotrader",
    // A file exists at this path but it is an Arial wordmark drawn by hand to
    // resemble the AutoTrader mark. That is a trademark approximation, not the
    // logo, so it is deliberately NOT rendered.
    src: null, intrinsicWidth: null, intrinsicHeight: null, opticalScale: 1,
    alt: "AutoTrader", authorization: "unauthorized_approximation",
    note: "public/marketplace-logos/autotrader.svg is a hand-drawn text approximation. Replace with the licensed AutoTrader brand asset.",
  },
  {
    channel: "cars_com",
    src: null, intrinsicWidth: null, intrinsicHeight: null, opticalScale: 1,
    alt: "Cars.com", authorization: "unauthorized_approximation",
    note: "public/marketplace-logos/cars-com.svg is a hand-drawn text approximation. Replace with the licensed Cars.com brand asset.",
  },
  {
    channel: "cargurus",
    src: null, intrinsicWidth: null, intrinsicHeight: null, opticalScale: 1,
    alt: "CarGurus", authorization: "missing",
    note: "No CarGurus brand asset has been supplied.",
  },
  {
    channel: "facebook",
    src: null, intrinsicWidth: null, intrinsicHeight: null, opticalScale: 0.62,
    alt: "Facebook Marketplace", authorization: "missing",
    note: "No Meta/Facebook brand asset has been supplied. Meta brand assets carry specific usage terms.",
  },
  {
    channel: "dealer_website",
    // Not a third-party mark — this is AutoLabels' own product icon for the
    // dealer's own website, so we are free to draw it.
    src: null, intrinsicWidth: null, intrinsicHeight: null, opticalScale: 0.62,
    alt: "Dealer Website", authorization: "autolabels_owned",
  },
  {
    channel: "google_seo",
    src: null, intrinsicWidth: null, intrinsicHeight: null, opticalScale: 0.6,
    alt: "Google Search", authorization: "missing",
    note: "No Google brand asset has been supplied. Google brand permissions are required before shipping the mark.",
  },
  {
    channel: "vauto",
    src: null, intrinsicWidth: null, intrinsicHeight: null, opticalScale: 1,
    alt: "vAuto", authorization: "missing",
    note: "No vAuto (Cox Automotive) brand asset has been supplied.",
  },
];

export const assetFor = (channel: string): ChannelAsset | undefined =>
  CHANNEL_ASSETS.find((a) => a.channel === channel);

export const isRenderable = (a: ChannelAsset | undefined): boolean =>
  !!a && !!a.src && (a.authorization === "authorized" || a.authorization === "autolabels_owned");

/** Assets an operator still has to obtain. Surfaced in the Studio, not hidden. */
export const missingAssets = (): ChannelAsset[] =>
  CHANNEL_ASSETS.filter((a) => !isRenderable(a) && a.authorization !== "autolabels_owned");

/**
 * The display box for an asset inside the shared viewport. Ratio is always
 * preserved: the asset is contained, never stretched and never cropped.
 */
export function logoBox(a: ChannelAsset): { width: number; height: number } {
  const { width: vw, height: vh } = LOGO_VIEWPORT;
  if (!a.intrinsicWidth || !a.intrinsicHeight) {
    return { width: Math.round(vw * a.opticalScale), height: Math.round(vh * a.opticalScale) };
  }
  const ratio = a.intrinsicWidth / a.intrinsicHeight;
  // Fit inside the viewport on whichever axis binds first, then apply the
  // optical correction to the result.
  const byWidth = { width: vw, height: vw / ratio };
  const box = byWidth.height <= vh ? byWidth : { width: vh * ratio, height: vh };
  return {
    width: Math.round(box.width * a.opticalScale),
    height: Math.round(box.height * a.opticalScale),
  };
}
