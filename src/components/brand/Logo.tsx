interface LogoProps {
  variant?: "mark" | "full" | "stacked" | "wordmark";
  inverted?: boolean;
  size?: number;
  className?: string;
  /** Render the "Clear. Compliant. Consistent." tagline under the
   *  wordmark (full + stacked variants only). */
  tagline?: boolean;
}

// ──────────────────────────────────────────────────────────────
// AutoLabels.io logo (Wave 34).
//
// Site-wide logo is the two-word wordmark: "auto" in Autocurb blue,
// "(LABELS)" in Label Navy — Inter, the Autocurb typeface. No mark
// sits beside the word. The square "a" tile (white lowercase "a" on
// the blue gradient) is reserved for the favicon / square contexts
// and is what variant="mark" renders.
// ──────────────────────────────────────────────────────────────

const NAVY = "#0B2041"; // Label Navy — "(LABELS)"
const CURB = "#2563EB"; // Autocurb blue — "auto"
const CYAN = "#3BB4FF"; // bright accent — "auto" on dark backgrounds
const INTER = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

// Square "a" tile — favicon / app icon. White lowercase "a" on a
// solid Autocurb-blue (#2563EB) rounded square.
const GEO = "'Outfit', 'Inter', system-ui, -apple-system, sans-serif";
const Mark = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    <rect width="64" height="64" rx="13" fill={CURB} />
    <text
      x="32"
      y="35"
      fill="#FFFFFF"
      fontFamily={GEO}
      fontWeight={700}
      fontSize="46"
      textAnchor="middle"
      dominantBaseline="central"
    >
      a
    </text>
  </svg>
);

const Wordmark = ({
  size,
  inverted,
  tagline,
  align,
}: {
  size: number;
  inverted?: boolean;
  tagline?: boolean;
  align: "left" | "center";
}) => {
  const fontSize = Math.round(size * 0.78);
  const autoColor = inverted ? CYAN : CURB;
  const labelsColor = inverted ? "#FFFFFF" : NAVY;
  return (
    <span
      className="inline-flex flex-col justify-center leading-none"
      style={{ alignItems: align === "center" ? "center" : "flex-start" }}
    >
      <span style={{ fontFamily: INTER, fontWeight: 800, fontSize, letterSpacing: "-0.02em", lineHeight: 1 }}>
        <span style={{ color: autoColor }}>auto</span>
        <span style={{ color: labelsColor }}>(LABELS)</span>
      </span>
      {tagline && (
        <span
          style={{
            fontFamily: INTER,
            fontWeight: 700,
            fontSize: Math.max(7, Math.round(fontSize * 0.24)),
            letterSpacing: "0.2em",
            color: inverted ? "#94A3B8" : "#64748B",
            marginTop: Math.round(fontSize * 0.22),
            textTransform: "uppercase",
          }}
        >
          Clear. Compliant. Consistent.
        </span>
      )}
    </span>
  );
};

const Logo = ({
  variant = "full",
  inverted = false,
  size = 34,
  className,
  tagline = false,
}: LogoProps) => {
  if (variant === "mark") {
    return (
      <span className={className} aria-label="AutoLabels.io" role="img">
        <Mark size={size} />
      </span>
    );
  }

  // full / wordmark / stacked all render the wordmark site-wide.
  return (
    <span className={className} aria-label="AutoLabels.io" role="img">
      <Wordmark size={size} inverted={inverted} tagline={tagline} align={variant === "stacked" ? "center" : "left"} />
    </span>
  );
};

export default Logo;
