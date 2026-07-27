// Governed OEM emblem assets.
//
// Each asset is a deterministic vector generator (identical in the SVG
// preview and the PDF via drawSvgPath) plus full governance metadata. These
// are RECREATIONS drawn in-house at the owner's direction; they carry
// status "recreated_pending_authorization" until official artwork obtained
// through an OEM/dealer brand program replaces them. Nothing here is
// scraped, hotlinked, or rasterized.

export interface EmblemPath {
  d: string;
  fill: string | null;
  stroke?: string;
  strokeWidth?: number;
}

export interface EmblemRender {
  paths: EmblemPath[];
  width: number;
  height: number;
}

export interface LogoAssetRecord {
  assetId: string;
  oemId: string;
  market: "US";
  version: string;
  status: "authorized" | "recreated_pending_authorization";
  source: string;
  obtained: string;
  /** Clear space around the mark, as a fraction of its height. */
  clearSpaceRatio: number;
  /** Minimum printed height in points. */
  minHeightPt: number;
  usageNotes: string;
  /** Generate the mark scaled to a target height, in y-down coordinates. */
  render: (targetH: number) => EmblemRender;
}

const n = (v: number): string => String(Math.round(v * 100) / 100);

// Chevrolet bowtie: elongated cross silhouette, gold fill, bronze outline.
function bowtie(targetH: number): EmblemRender {
  const h = targetH;
  const w = targetH * 2.95;
  const armH = h * 0.56;
  const armY = (h - armH) / 2;
  const coreW = w * 0.30;
  const coreX = (w - coreW) / 2;
  const d =
    `M0 ${n(armY)} H${n(coreX)} V0 H${n(coreX + coreW)} V${n(armY)} H${n(w)} ` +
    `V${n(armY + armH)} H${n(coreX + coreW)} V${n(h)} H${n(coreX)} V${n(armY + armH)} H0 Z`;
  return {
    width: w,
    height: h,
    paths: [{ d, fill: "#c8a24b", stroke: "#7d6a30", strokeWidth: targetH * 0.045 }],
  };
}

// BMW roundel: black ring, quartered blue/white core (white upper-left).
function roundel(targetH: number): EmblemRender {
  const s = targetH;
  const c = s / 2;
  const rOuter = s / 2;
  const rIn = s * 0.36;
  const blue = "#3d7dab";
  const circle = (r: number): string =>
    `M${n(c + r)} ${n(c)} A${n(r)} ${n(r)} 0 1 1 ${n(c - r)} ${n(c)} A${n(r)} ${n(r)} 0 1 1 ${n(c + r)} ${n(c)} Z`;
  const wedge = (x1: number, y1: number, x2: number, y2: number): string =>
    `M${n(c)} ${n(c)} L${n(x1)} ${n(y1)} A${n(rIn)} ${n(rIn)} 0 0 0 ${n(x2)} ${n(y2)} Z`;
  return {
    width: s,
    height: s,
    paths: [
      { d: circle(rOuter), fill: "#181a1e" },
      { d: wedge(c, c - rIn, c - rIn, c), fill: "#ffffff" },
      { d: wedge(c + rIn, c, c, c - rIn), fill: blue },
      { d: wedge(c, c + rIn, c + rIn, c), fill: "#ffffff" },
      { d: wedge(c - rIn, c, c, c + rIn), fill: blue },
      { d: circle(rIn), fill: null, stroke: "#181a1e", strokeWidth: s * 0.02 },
    ],
  };
}

// Lexus mark: elliptical ring with the stylized slanted L.
function lexusMark(targetH: number): EmblemRender {
  const h = targetH;
  const w = targetH * 1.24;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.47;
  const ry = h * 0.44;
  const ink = "#1a1a1a";
  const ring =
    `M${n(cx + rx)} ${n(cy)} A${n(rx)} ${n(ry)} 0 1 1 ${n(cx - rx)} ${n(cy)} ` +
    `A${n(rx)} ${n(ry)} 0 1 1 ${n(cx + rx)} ${n(cy)} Z`;
  const l =
    `M${n(cx - rx * 0.34)} ${n(cy - ry * 0.6)} ` +
    `L${n(cx - rx * 0.42)} ${n(cy + ry * 0.3)} ` +
    `Q${n(cx - rx * 0.44)} ${n(cy + ry * 0.58)} ${n(cx - rx * 0.12)} ${n(cy + ry * 0.58)} ` +
    `L${n(cx + rx * 0.78)} ${n(cy + ry * 0.02)}`;
  return {
    width: w,
    height: h,
    paths: [
      { d: ring, fill: null, stroke: ink, strokeWidth: h * 0.075 },
      { d: l, fill: null, stroke: ink, strokeWidth: h * 0.085 },
    ],
  };
}

const RECREATED_NOTE =
  "In-house vector recreation authorized by the platform owner for dealer vehicle records; replace with official brand-program artwork when supplied.";

export const LOGO_ASSETS: Record<string, LogoAssetRecord> = {
  CHEVROLET: {
    assetId: "chevrolet-bowtie-recreated-v1",
    oemId: "CHEVROLET",
    market: "US",
    version: "1",
    status: "recreated_pending_authorization",
    source: "in-house vector recreation",
    obtained: "2026-07-27",
    clearSpaceRatio: 0.4,
    minHeightPt: 10,
    usageNotes: RECREATED_NOTE,
    render: bowtie,
  },
  BMW: {
    assetId: "bmw-roundel-recreated-v1",
    oemId: "BMW",
    market: "US",
    version: "1",
    status: "recreated_pending_authorization",
    source: "in-house vector recreation",
    obtained: "2026-07-27",
    clearSpaceRatio: 0.35,
    minHeightPt: 12,
    usageNotes: RECREATED_NOTE,
    render: roundel,
  },
  LEXUS: {
    assetId: "lexus-mark-recreated-v1",
    oemId: "LEXUS",
    market: "US",
    version: "1",
    status: "recreated_pending_authorization",
    source: "in-house vector recreation",
    obtained: "2026-07-27",
    clearSpaceRatio: 0.4,
    minHeightPt: 12,
    usageNotes: RECREATED_NOTE,
    render: lexusMark,
  },
};

export function getLogoAsset(oemId: string): LogoAssetRecord | null {
  return LOGO_ASSETS[oemId.toUpperCase()] ?? null;
}
