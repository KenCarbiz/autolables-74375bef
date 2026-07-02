import { ADDENDUM_ICON_DEFS, type AddendumIconComponent, type AddendumIconDef } from "./iconMetadata";
import { PlaceholderGlyph } from "./customIcons";
import type { AddendumIconCategory } from "./iconTypes";

// Lookup layer over the manifest. Templates call icons strictly by ID, so
// swapping placeholder artwork for final SVGs never touches template code.

const REGISTRY = new Map<string, AddendumIconDef>(ADDENDUM_ICON_DEFS.map((def) => [def.iconId, def]));

export const getAddendumIconDef = (iconId: string): AddendumIconDef | null =>
  REGISTRY.get(iconId.toUpperCase()) ?? null;

// Unknown IDs render the dashed placeholder rather than crashing a printed
// sticker or a shopper page; the preview page makes the gap visible.
export const getAddendumIconComponent = (iconId: string): AddendumIconComponent =>
  getAddendumIconDef(iconId)?.icon ?? PlaceholderGlyph;

export const ADDENDUM_ICON_IDS: string[] = ADDENDUM_ICON_DEFS.map((def) => def.iconId);

export const addendumIconsByCategory = (category: AddendumIconCategory): AddendumIconDef[] =>
  ADDENDUM_ICON_DEFS.filter((def) => def.category === category);

export const searchAddendumIcons = (query: string): AddendumIconDef[] => {
  const q = query.trim().toLowerCase();
  if (!q) return ADDENDUM_ICON_DEFS;
  return ADDENDUM_ICON_DEFS.filter((def) =>
    def.iconId.toLowerCase().includes(q) ||
    def.name.toLowerCase().includes(q) ||
    def.tags.some((t) => t.toLowerCase().includes(q)),
  );
};
