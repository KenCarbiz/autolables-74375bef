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

export interface EmblemText {
  str: string;
  x: number;
  y: number;
  size: number;
  color: string;
  charSpacing?: number;
}

export interface EmblemRender {
  paths: EmblemPath[];
  texts?: EmblemText[];
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

// Lexus mark: wide thin-ring oval; the L's stem slants and its long sweep
// follows the oval's interior up toward the right rim.
function lexusMark(targetH: number): EmblemRender {
  const h = targetH;
  const w = targetH * 1.35;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.47;
  const ry = h * 0.43;
  const ink = "#1a1a1a";
  const ring =
    `M${n(cx + rx)} ${n(cy)} A${n(rx)} ${n(ry)} 0 1 1 ${n(cx - rx)} ${n(cy)} ` +
    `A${n(rx)} ${n(ry)} 0 1 1 ${n(cx + rx)} ${n(cy)} Z`;
  const l =
    `M${n(cx + rx * 0.04)} ${n(cy - ry * 0.82)} ` +
    `L${n(cx - rx * 0.34)} ${n(cy + ry * 0.3)} ` +
    `Q${n(cx - rx * 0.44)} ${n(cy + ry * 0.62)} ${n(cx - rx * 0.06)} ${n(cy + ry * 0.6)} ` +
    `Q${n(cx + rx * 0.5)} ${n(cy + ry * 0.42)} ${n(cx + rx * 0.88)} ${n(cy - ry * 0.12)}`;
  return {
    width: w,
    height: h,
    paths: [
      { d: ring, fill: null, stroke: ink, strokeWidth: h * 0.062 },
      { d: l, fill: null, stroke: ink, strokeWidth: h * 0.08 },
    ],
  };
}

// Ford oval: blue field, white inner keyline, Ford lettering.
function fordOval(targetH: number): EmblemRender {
  const h = targetH;
  const w = targetH * 2.55;
  const cx = w / 2;
  const cy = h / 2;
  const ell = (rx: number, ry: number): string =>
    `M${n(cx + rx)} ${n(cy)} A${n(rx)} ${n(ry)} 0 1 1 ${n(cx - rx)} ${n(cy)} ` +
    `A${n(rx)} ${n(ry)} 0 1 1 ${n(cx + rx)} ${n(cy)} Z`;
  return {
    width: w,
    height: h,
    paths: [
      { d: ell(w * 0.5, h * 0.5), fill: "#003478" },
      { d: ell(w * 0.44, h * 0.4), fill: null, stroke: "#ffffff", strokeWidth: h * 0.045 },
    ],
    texts: [{ str: "Ford", x: cx, y: cy + h * 0.17, size: h * 0.5, color: "#ffffff", charSpacing: h * 0.02 }],
  };
}

// Nissan mark (2020 idiom): open ring arcs with the name across the center.
function nissanMark(targetH: number): EmblemRender {
  const s2 = targetH;
  const c = s2 / 2;
  const r = s2 * 0.46;
  const sw = s2 * 0.07;
  const arc = (x1: number, y1: number, x2: number, y2: number): string =>
    `M${n(x1)} ${n(y1)} A${n(r)} ${n(r)} 0 0 1 ${n(x2)} ${n(y2)}`;
  const dy = r * 0.42;
  const dx = Math.sqrt(Math.max(r * r - dy * dy, 0));
  return {
    width: s2,
    height: s2,
    paths: [
      { d: arc(c - dx, c - dy, c + dx, c - dy), fill: null, stroke: "#1a1a1e", strokeWidth: sw },
      { d: arc(c + dx, c + dy, c - dx, c + dy), fill: null, stroke: "#1a1a1e", strokeWidth: sw },
    ],
    texts: [{ str: "NISSAN", x: c, y: c + s2 * 0.085, size: s2 * 0.24, color: "#1a1a1e", charSpacing: s2 * 0.012 }],
  };
}

// INFINITI mark: oval open at the base with the road converging to a point.
function infinitiMark(targetH: number): EmblemRender {
  const h = targetH;
  const w = targetH * 1.7;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.47;
  const ry = h * 0.46;
  const sw = h * 0.07;
  const ink = "#1a1a1e";
  // Ring drawn as one arc that leaves the bottom-center open.
  const gap = rx * 0.52;
  const yAtGap = cy + ry * Math.sqrt(Math.max(1 - (gap / rx) ** 2, 0));
  const ring =
    `M${n(cx - gap)} ${n(yAtGap)} A${n(rx)} ${n(ry)} 0 1 1 ${n(cx + gap)} ${n(yAtGap)}`;
  const road =
    `M${n(cx - gap)} ${n(yAtGap)} L${n(cx)} ${n(cy - ry * 0.05)} L${n(cx + gap)} ${n(yAtGap)}`;
  return {
    width: w,
    height: h,
    paths: [
      { d: ring, fill: null, stroke: ink, strokeWidth: sw },
      { d: road, fill: null, stroke: ink, strokeWidth: sw },
    ],
  };
}

// Hyundai mark: slanted italic H inside an oval ring.
function hyundaiMark(targetH: number): EmblemRender {
  const h = targetH;
  const w = targetH * 1.6;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.47;
  const ry = h * 0.44;
  const ink = "#1c2a4a";
  const ring =
    `M${n(cx + rx)} ${n(cy)} A${n(rx)} ${n(ry)} 0 1 1 ${n(cx - rx)} ${n(cy)} ` +
    `A${n(rx)} ${n(ry)} 0 1 1 ${n(cx + rx)} ${n(cy)} Z`;
  const slant = rx * 0.22;
  const x1 = cx - rx * 0.34;
  const x2 = cx + rx * 0.34;
  const yT = cy - ry * 0.5;
  const yB = cy + ry * 0.5;
  const sw = h * 0.1;
  return {
    width: w,
    height: h,
    paths: [
      { d: ring, fill: null, stroke: ink, strokeWidth: h * 0.065 },
      { d: `M${n(x1 + slant)} ${n(yT)} L${n(x1 - slant * 0.4)} ${n(yB)}`, fill: null, stroke: ink, strokeWidth: sw },
      { d: `M${n(x2 + slant)} ${n(yT)} L${n(x2 - slant * 0.4)} ${n(yB)}`, fill: null, stroke: ink, strokeWidth: sw },
      { d: `M${n(x1 - slant * 0.1 + slant * 0.5)} ${n(cy)} L${n(x2 + slant * 0.5)} ${n(cy)}`, fill: null, stroke: ink, strokeWidth: sw * 0.85 },
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

LOGO_ASSETS.FORD = {
  assetId: "ford-oval-recreated-v1", oemId: "FORD", market: "US", version: "1",
  status: "recreated_pending_authorization", source: "in-house vector recreation",
  obtained: "2026-07-27", clearSpaceRatio: 0.35, minHeightPt: 11,
  usageNotes: RECREATED_NOTE, render: fordOval,
};
LOGO_ASSETS.NISSAN = {
  assetId: "nissan-mark-recreated-v1", oemId: "NISSAN", market: "US", version: "1",
  status: "recreated_pending_authorization", source: "in-house vector recreation",
  obtained: "2026-07-27", clearSpaceRatio: 0.35, minHeightPt: 12,
  usageNotes: RECREATED_NOTE, render: nissanMark,
};
LOGO_ASSETS.INFINITI = {
  assetId: "infiniti-mark-recreated-v1", oemId: "INFINITI", market: "US", version: "1",
  status: "recreated_pending_authorization", source: "in-house vector recreation",
  obtained: "2026-07-27", clearSpaceRatio: 0.35, minHeightPt: 12,
  usageNotes: RECREATED_NOTE, render: infinitiMark,
};
LOGO_ASSETS.HYUNDAI = {
  assetId: "hyundai-mark-recreated-v1", oemId: "HYUNDAI", market: "US", version: "1",
  status: "recreated_pending_authorization", source: "in-house vector recreation",
  obtained: "2026-07-27", clearSpaceRatio: 0.35, minHeightPt: 12,
  usageNotes: RECREATED_NOTE, render: hyundaiMark,
};

export function getLogoAsset(oemId: string): LogoAssetRecord | null {
  return LOGO_ASSETS[oemId.toUpperCase()] ?? null;
}
