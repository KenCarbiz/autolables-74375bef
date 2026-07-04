// Marketing icon system — the locked SVG set in /public (blue gradient tile,
// white glyph, transparent canvas). Rendered bare: the tile is baked into the
// SVG, so no wrapper box or background is ever added. Size comes through
// className (default 48px) so h-10/h-14 variants can't collide with a
// baked-in h-12 in the Tailwind cascade.
const LandingIcon = ({
  src,
  alt,
  className = "h-12 w-12",
}: {
  src: string;
  alt: string;
  className?: string;
}) => (
  <img
    src={src}
    alt={alt}
    className={`object-contain shrink-0 ${className}`}
    loading="lazy"
    draggable={false}
  />
);

export default LandingIcon;
