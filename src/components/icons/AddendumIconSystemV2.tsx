// ──────────────────────────────────────────────────────────────────────
// AutoLabels V2 icon tile system — the approved addendum icon direction.
//
// Geometry and color come verbatim from the V2 Production Asset Pack
// (05_SPECS/design_tokens.json + manifest.json, and the tile SVGs themselves):
//
//   tile 40x40 · radius 10 · artwork 32x32 centred with 4px padding · no shadow
//   stroke 1.55 in a 20x20 design space, scaled 1.6 into the tile
//
// Every tile below renders that exact geometry through a `viewBox="0 0 40 40"`,
// so changing the rendered size never changes the proportions — only the scale.
//
// The artwork is inlined rather than referenced from public/. These render
// inside a document that is rasterised to PNG and PDF, and an <img> pointing at
// an external SVG is the one thing that reliably comes back blank from
// html2canvas. A printed addendum with holes where the icons belong is worse
// than plainer icons.
//
// The pack's three tile tones are SEMANTIC, not brand:
//   info      blue   — vehicle data (stock, VIN, date, MSRP)
//   included  green  — installed equipment, on the vehicle, in the total
//   upgrade   purple — available, NOT installed, NOT in the total
// A dealer's accent colour must not repaint them: green/purple carry the
// included-vs-not distinction that the whole sheet's pricing rests on.
// ──────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { AutoLabelsAddendumIcon, type AddendumIconKey } from "./AutoLabelsAddendumIcons";

export type AddendumTileTone = "info" | "included" | "upgrade";

/** Pack semantic colours (05_SPECS/design_tokens.json). */
export const V2_TONE: Record<AddendumTileTone, { fg: string; bg: string }> = {
  info: { fg: "#0D1B2A", bg: "#EEF4FF" },
  included: { fg: "#16A34A", bg: "#EAF7EF" },
  upgrade: { fg: "#7C3AED", bg: "#F3ECFF" },
};

/** The pack's Vehicle Passport blue. Also the templates' default accent, so a
 *  dealer who has not themed the sheet sees exactly the pack's artwork. */
export const V2_PASSPORT_BLUE = "#2563EB";

// ── Artwork ───────────────────────────────────────────────────────────
//
// One 20x20 design space for every icon — the pack's tile files and its
// standalone files are the same paths, the tile version merely scaled into the
// 40x40 square. Keyed by the EXISTING AddendumIconKey values so a dealer's
// stored iconKey keeps resolving and no data migration is needed.

const V2_ART: Partial<Record<AddendumIconKey, ReactNode>> = {
  // Vehicle data
  "stock-number": (<><path d="M16.5 10.7 10.7 16.5 3.5 9.3V3.5h5.8l7.2 7.2Z" /><circle cx="7" cy="7" r=".9" /></>),
  vin: (<><rect x="2.8" y="4.2" width="14.4" height="11.6" rx="2" /><path d="M5.3 7v6M7.8 7v6M10 7v6M12.8 7v6M15 7v6" /></>),
  date: (<><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M6.5 2.8v3.3M13.5 2.8v3.3M3 8h14" /><path d="M6.2 11h2M11.8 11h2M6.2 14h2M11.8 14h2" /></>),
  "price-msrp": (<><path d="M16.5 10.7 10.7 16.5 3.5 9.3V3.5h5.8l7.2 7.2Z" /><circle cx="7" cy="7" r=".9" /><path d="M11.5 8.1h1.6c.8 0 1.4.6 1.4 1.3s-.6 1.3-1.4 1.3h-1.6c-.8 0-1.4.6-1.4 1.3s.6 1.3 1.4 1.3H13M12.4 7v7.3" /></>),

  // Installed equipment
  "protection-products": (<><path d="M10 2.2 16 4.8v4.4c0 3.7-2.3 6.4-6 8.5-3.7-2.1-6-4.8-6-8.5V4.8L10 2.2Z" /><path d="M10 6v6M7 9h6" /></>),
  "ceramic-coating": (<><path d="M7.2 2.7c0 2.4-1.6 4-4 4 2.4 0 4 1.6 4 4 0-2.4 1.6-4 4-4-2.4 0-4-1.6-4-4Z" /><path d="M14.3 7.8c0 1.8-1.2 3-3 3 1.8 0 3 1.2 3 3 0-1.8 1.2-3 3-3-1.8 0-3-1.2-3-3Z" /></>),
  "paint-protection-film": (<><path d="M10 2.2 16 4.8v4.4c0 3.7-2.3 6.4-6 8.5-3.7-2.1-6-4.8-6-8.5V4.8L10 2.2Z" /><path d="M6.8 8.1h6.4M6.8 11.9h6.4" /></>),
  "generic-product": (<><path d="M16.5 10.7 10.7 16.5 3.5 9.3V3.5h5.8l7.2 7.2Z" /><circle cx="7" cy="7" r=".9" /><path d="M10.8 8.2h3.2M10.8 10.5h3.2M10.8 12.8h2.2" /></>),

  // Available upgrades
  "remote-start": (<><path d="M10 2.2 16 4.8v4.4c0 3.7-2.3 6.4-6 8.5-3.7-2.1-6-4.8-6-8.5V4.8L10 2.2Z" /><path d="m10 6.3.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1L7 8.5l2.1-.3.9-1.9Z" /></>),
  "protection-plan": (<><path d="M10 2.2 16 4.8v4.4c0 3.7-2.3 6.4-6 8.5-3.7-2.1-6-4.8-6-8.5V4.8L10 2.2Z" /><path d="m10 6.3.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1L7 8.5l2.1-.3.9-1.9Z" /></>),

  // Passport / checklist / brand
  "vehicle-passport": (<><path d="M10 2.2 16 4.8v4.4c0 3.7-2.3 6.4-6 8.5-3.7-2.1-6-4.8-6-8.5V4.8L10 2.2Z" /><path d="m7.2 9.7 1.8 1.8 3.8-4" /></>),
  documents: (<><path d="M5 2.5h6.7l3.3 3.3v11.7H5V2.5Z" /><path d="M11.7 2.5v3.8H15M7.6 9.2h4.8M7.6 12.1h4.8" /></>),
  benefits: (<><circle cx="10" cy="7" r="4.2" /><path d="m7.4 10.2-1.3 6.1 3.9-2.1 3.9 2.1-1.3-6.1" /><path d="m8.2 7 1.2 1.2 2.4-2.4" /></>),

  // Bottom value propositions (no tile)
  "quality-products": (<><path d="M10 2.2 16 4.8v4.4c0 3.7-2.3 6.4-6 8.5-3.7-2.1-6-4.8-6-8.5V4.8L10 2.2Z" /><path d="m7.2 9.7 1.8 1.8 3.8-4" /></>),
  "expert-installation": (<><circle cx="10" cy="7" r="4.2" /><path d="m7.4 10.2-1.3 6.1 3.9-2.1 3.9 2.1-1.3-6.1" /><path d="m8.2 7 1.2 1.2 2.4-2.4" /></>),
  "added-value": (<><path d="M3 10h3v6H3z" /><path d="M6 15.2h7.2c1.2 0 2.2-.7 2.6-1.8l1.2-3.6a1.8 1.8 0 0 0-1.7-2.4h-4l.7-3a1.9 1.9 0 0 0-3.5-1.3L6 8.3v6.9Z" /></>),
  "peace-of-mind": (<><path d="M10 2.2 16 4.8v4.4c0 3.7-2.3 6.4-6 8.5-3.7-2.1-6-4.8-6-8.5V4.8L10 2.2Z" /><path d="M7.2 9.5c1.3 0 1.8 1.3 2.8 2.1 1-.8 1.5-2.1 2.8-2.1" /></>),

  // Footer / platform (no tile)
  "ai-powered": (<><rect x="5" y="5" width="10" height="10" rx="2" /><path d="M7.5 2.5v2.5M12.5 2.5v2.5M7.5 15v2.5M12.5 15v2.5M2.5 7.5H5M2.5 12.5H5M15 7.5h2.5M15 12.5h2.5" /></>),
  "ftc-aligned": (<><circle cx="10" cy="10" r="7.2" /><path d="m6.7 10 2.1 2.1 4.5-4.6" /></>),
  "ftc-compliant": (<><circle cx="10" cy="10" r="7.2" /><path d="m6.7 10 2.1 2.1 4.5-4.6" /></>),
  "real-time-updates": (<><path d="M15.7 6.1V10h-3.9M4.3 13.9V10h3.9" /><path d="M5.9 6.2A6 6 0 0 1 15.7 6l.8.8M14.1 13.8A6 6 0 0 1 4.3 14l-.8-.8" /></>),
  "print-ready": (<><path d="M6 7V2.8h8V7" /><rect x="5.2" y="12.3" width="9.6" height="4.9" rx="1" /><path d="M5.2 14H3.8A1.8 1.8 0 0 1 2 12.2V8.8A1.8 1.8 0 0 1 3.8 7h12.4A1.8 1.8 0 0 1 18 8.8v3.4a1.8 1.8 0 0 1-1.8 1.8h-1.4" /></>),
};

/** The pack's blue check, used uniformly down the Passport scan checklist. */
const CHECK_CIRCLE: ReactNode = (<><circle cx="10" cy="10" r="7.2" /><path d="m6.7 10 2.1 2.1 4.5-4.6" /></>);

export const hasV2Art = (iconKey: AddendumIconKey): boolean => !!V2_ART[iconKey];

// ── Bare icon ─────────────────────────────────────────────────────────

/**
 * An uncontained V2 icon — value propositions, footer badges, checklist.
 *
 * Keys the pack does not cover (the long tail of dealer product icons: tow
 * hitch, running boards, wheel locks…) fall through to the existing library
 * rather than rendering nothing. A missing icon is a broken row.
 */
export const AddendumIconV2 = ({
  iconKey,
  size = 20,
  color,
}: {
  iconKey: AddendumIconKey;
  size?: number;
  color?: string;
}) => {
  const art = V2_ART[iconKey];
  if (!art) return <AutoLabelsAddendumIcon iconKey={iconKey} size={size} color={color} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke={color || "currentColor"}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      {art}
    </svg>
  );
};

/** The Passport checklist mark. One icon for every row by design — the list
 *  says which sections the packet contains, not what each one is. */
export const AddendumCheckV2 = ({ size = 11, color = V2_PASSPORT_BLUE }: { size?: number; color?: string }) => (
  <svg
    width={size} height={size} viewBox="0 0 20 20" fill="none"
    stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" style={{ display: "block", flex: "none" }}
  >
    {CHECK_CIRCLE}
  </svg>
);

// ── Tile ──────────────────────────────────────────────────────────────

/**
 * A V2 icon tile at the pack's exact proportions.
 *
 * `size` scales the whole 40x40 artboard, so radius stays 25% of the tile and
 * the icon stays 80% of it at every size — the pack's "the foreground is
 * intentionally LARGE, do not shrink it" rule holds whether the tile renders at
 * 40px in the vehicle-data grid or at 22px in a dense equipment row.
 */
export const AddendumIconTileV2 = ({
  iconKey,
  tone,
  size = 40,
}: {
  iconKey: AddendumIconKey;
  tone: AddendumTileTone;
  size?: number;
}) => {
  const { fg, bg } = V2_TONE[tone];
  const art = V2_ART[iconKey];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      <rect width="40" height="40" rx="10" fill={bg} />
      {art ? (
        <g transform="translate(4 4) scale(1.6)" fill="none" stroke={fg} strokeWidth={1.55} strokeLinecap="round" strokeLinejoin="round">
          {art}
        </g>
      ) : (
        // Fallback art is drawn in the older 24x24 space. A nested <svg> with
        // its own viewport maps it onto the same 32x32 foreground the pack
        // specifies — a <g transform> cannot, because the fallback brings its
        // own <svg> element and an inner <svg> ignores a parent's scale().
        <svg x="4" y="4" width="32" height="32" viewBox="0 0 24 24" overflow="visible">
          <AutoLabelsAddendumIcon iconKey={iconKey} size={24} color={fg} />
        </svg>
      )}
    </svg>
  );
};
