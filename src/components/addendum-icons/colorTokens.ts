// Locked color tokens for the addendum/window-sticker icon library.
// Icons are single SVGs drawn with currentColor; these tokens are the only
// approved fills. Blue/green/purple/orange are the operating palette; gray
// covers disabled/unavailable states, navy covers header/footer/brand rows.
export const ADDENDUM_ICON_COLORS = {
  blue: "#1E5AA8",
  green: "#16A34A",
  purple: "#6D28D9",
  orange: "#F59E0B",
  gray: "#64748B",
  navy: "#0D1B2A",
} as const;

export type AddendumIconColor = keyof typeof ADDENDUM_ICON_COLORS;

export const ADDENDUM_ICON_COLOR_ORDER: AddendumIconColor[] = [
  "blue", "green", "purple", "orange", "gray", "navy",
];
