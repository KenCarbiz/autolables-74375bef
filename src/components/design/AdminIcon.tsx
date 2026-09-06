import { ADMIN_ASSETS } from "@/lib/design/adminAssets";
import { ADMIN_ICON_PATHS } from "@/lib/design/adminIconPaths";
import { cn } from "@/lib/utils";

// Icons are rendered INLINE. currentColor does not inherit through <img>, so a
// file reference would quietly turn every icon the same colour and undo the
// reason the currentColor variant was chosen.
//
// Two rules from the asset package are enforced here rather than left to each
// caller, because both fail silently:
//
//   Accessibility. A decorative icon is hidden from assistive technology; an
//   icon that carries meaning must be given a name. There is no third option,
//   so the prop is required.
//
//   Semantic colour. Roughly a quarter of the set was drawn in a state colour.
//   That intent is honoured by default and can be overridden, but colour is
//   never the only carrier of meaning: pair Pass, Fail, Safety, Delivery
//   Blocked and Authorization with text, as the package instructions require.

const SEMANTIC_CLASS: Record<string, string> = {
  "#16A34A": "text-[hsl(142_71%_36%)]",
  "#D97706": "text-[hsl(32_95%_44%)]",
  "#DC2626": "text-[hsl(0_72%_51%)]",
  "#64748B": "text-muted-foreground",
};

type Labelled =
  /** Conveys meaning: screen readers announce this name. */
  | { label: string; decorative?: false }
  /** Purely ornamental, always beside text that carries the meaning. */
  | { decorative: true; label?: never };

export type AdminIconProps = Labelled & {
  id: keyof typeof ADMIN_ICON_PATHS | string;
  /** Package guidance: 18-20 in navigation and toolbars, 16-18 inline in tables. */
  size?: number;
  className?: string;
  /** Ignore the colour the icon was drawn in and inherit from the parent. */
  inherit?: boolean;
};

export function AdminIcon({
  id, size = 18, className, inherit = false, ...rest
}: AdminIconProps) {
  const geometry = ADMIN_ICON_PATHS[id];
  if (!geometry) {
    // A missing id is a typo, and a silently absent icon is worse than a gap.
    if (import.meta.env.DEV) console.warn(`AdminIcon: unknown asset id "${id}"`);
    return null;
  }
  const hint = ADMIN_ASSETS[id]?.semanticHint;
  const semantic = !inherit && hint ? SEMANTIC_CLASS[hint] : undefined;
  const decorative = "decorative" in rest && rest.decorative;

  return (
    <svg
      viewBox={geometry.viewBox}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", semantic, className)}
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : (rest as { label: string }).label}
      dangerouslySetInnerHTML={{ __html: geometry.body }}
    />
  );
}
