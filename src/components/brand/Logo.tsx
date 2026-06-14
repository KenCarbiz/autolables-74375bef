import { useId } from "react";

interface LogoProps {
  variant?: "mark" | "full" | "stacked" | "wordmark";
  inverted?: boolean;
  size?: number;
  className?: string;
  /** Render the "CLEAR. COMPLIANT. CONSISTENT." tagline under the
   *  wordmark (full + stacked variants only). */
  tagline?: boolean;
}

// ──────────────────────────────────────────────────────────────
// AutoLabels.io logo — code-rendered set (Wave 33).
//
// Autocurb-style two-tone wordmark: "Auto" in Label Navy and
// "Labels" in the Autocurb brand blue (the same blue Autocurb uses
// for "curb"). Rendered in code so the two-tone, the mark, and the
// inverted treatment stay pixel-crisp at any size with no external
// asset dependency.
//
//   variant="mark"      square monogram tile only
//   variant="wordmark"  two-tone text only
//   variant="full"      mark + wordmark, horizontal
//   variant="stacked"   mark above centered wordmark
// ──────────────────────────────────────────────────────────────

const NAVY = "#0B2041"; // Label Navy — the "Auto"
const CURB = "#2563EB"; // Autocurb blue — the "Labels" (matches "curb")
const CYAN = "#3BB4FF"; // bright accent — "Labels" on dark backgrounds

const Mark = ({ size, gradId }: { size: number; gradId: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    <defs>
      <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={CURB} />
        <stop offset="100%" stopColor={NAVY} />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="14" fill={`url(#${gradId})`} />
    <path
      d="M 18 48 L 32 16 L 46 48"
      stroke="white"
      strokeWidth="4.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <line x1="24" y1="38" x2="40" y2="38" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
    <circle cx="32" cy="16" r="3.5" fill="white" />
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
  const fontSize = Math.round(size * 0.62);
  // "auto" lowercase in Autocurb blue; "(LABELS)" caps in Label Navy.
  const autoColor = inverted ? CYAN : CURB;
  const labelsColor = inverted ? "#FFFFFF" : NAVY;
  return (
    <span
      className="inline-flex flex-col justify-center leading-none"
      style={{ alignItems: align === "center" ? "center" : "flex-start" }}
    >
      <span
        className="font-display font-extrabold"
        style={{ fontSize, letterSpacing: "-0.02em", lineHeight: 1 }}
      >
        <span style={{ color: autoColor }}>auto</span>
        <span style={{ color: labelsColor }}>(LABELS)</span>
      </span>
      {tagline && (
        <span
          className="font-semibold uppercase"
          style={{
            fontSize: Math.max(7, Math.round(fontSize * 0.26)),
            letterSpacing: "0.22em",
            color: inverted ? "#94A3B8" : "#64748B",
            marginTop: Math.round(fontSize * 0.22),
          }}
        >
          Clear. Compliant. Consistent.
        </span>
      )}
    </span>
  );
};

const Logo = ({
  variant = "mark",
  inverted = false,
  size = 32,
  className,
  tagline = false,
}: LogoProps) => {
  const gradId = useId();

  if (variant === "mark") {
    return (
      <span className={className} aria-label="AutoLabels.io" role="img">
        <Mark size={size} gradId={gradId} />
      </span>
    );
  }

  if (variant === "wordmark") {
    return (
      <span className={className} aria-label="AutoLabels.io" role="img">
        <Wordmark size={size} inverted={inverted} tagline={tagline} align="left" />
      </span>
    );
  }

  if (variant === "stacked") {
    return (
      <span
        className={`inline-flex flex-col items-center ${className ?? ""}`}
        aria-label="AutoLabels.io"
        role="img"
        style={{ gap: Math.round(size * 0.28) }}
      >
        <Mark size={size} gradId={gradId} />
        <Wordmark size={size} inverted={inverted} tagline={tagline} align="center" />
      </span>
    );
  }

  // full — horizontal lockup
  return (
    <span
      className={`inline-flex items-center ${className ?? ""}`}
      aria-label="AutoLabels.io"
      role="img"
      style={{ gap: Math.round(size * 0.3) }}
    >
      <Mark size={size} gradId={gradId} />
      <Wordmark size={size} inverted={inverted} tagline={tagline} align="left" />
    </span>
  );
};

export default Logo;
