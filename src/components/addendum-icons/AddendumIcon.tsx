import * as React from "react";
import { ADDENDUM_ICON_COLORS, type AddendumIconColor } from "./colorTokens";
import { getAddendumIconComponent, getAddendumIconDef } from "./iconRegistry";

// The one component addendum / window-sticker / passport templates use to
// render library icons. One SVG per icon drawn with currentColor; color is
// applied here from the locked tokens, so the same artwork renders in any
// approved color with no duplicate files.
//
//   <AddendumIcon iconId="A001" color="green" size={24} />

export interface AddendumIconProps {
  iconId: string;
  color?: AddendumIconColor;
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

const AddendumIcon = ({ iconId, color, size = 24, strokeWidth = 2, className, title }: AddendumIconProps) => {
  const def = getAddendumIconDef(iconId);
  const Icon = getAddendumIconComponent(iconId);
  const resolved: AddendumIconColor = color ?? def?.defaultColor ?? "navy";
  return (
    <span
      className={className}
      style={{ color: ADDENDUM_ICON_COLORS[resolved], display: "inline-flex", lineHeight: 0 }}
      role={title ? "img" : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
    >
      <Icon size={size} strokeWidth={strokeWidth} />
    </span>
  );
};

export default AddendumIcon;
