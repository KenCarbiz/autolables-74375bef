// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/ymm.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Year / make / model parsing for the free-text `ymm` field.
//
// vehicle_listings has no make or model column — only a single "2025
// INFINITI QX50 LUXE" string from the inventory feed. Splitting it on
// whitespace and taking token 1 as the make works for one-word brands and
// silently corrupts every multi-word one: "2024 Land Rover Range Rover"
// becomes make "Land", which then fails brand resolution and drops the
// vehicle onto the neutral template.
//
// So the make is matched against the known multi-word brands first,
// longest first, before falling back to a single token.

const MULTI_WORD_MAKES = [
  "land rover",
  "range rover",
  "alfa romeo",
  "aston martin",
  "rolls royce",
  "rolls-royce",
  "mercedes benz",
  "mercedes-benz",
  "am general",
  "general motors",
  "great wall",
];

// Consumer sub-brands the feed sometimes puts where the make belongs. The
// manufacturer is what selects a template.
const SUB_BRAND_TO_MAKE: Record<string, string> = {
  "range rover": "Land Rover",
};

export interface ParsedYmm {
  year: string;
  make: string;
  model: string;
}

export function parseYmm(raw: string | null | undefined): ParsedYmm {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return { year: "", make: "", model: "" };

  const tokens = text.split(" ");
  let year = "";
  let rest = tokens;
  if (/^(19|20)\d{2}$/.test(tokens[0])) {
    year = tokens[0];
    rest = tokens.slice(1);
  }
  if (!rest.length) return { year, make: "", model: "" };

  const lowerRest = rest.join(" ").toLowerCase();
  const multi = MULTI_WORD_MAKES
    .filter((m) => lowerRest === m || lowerRest.startsWith(`${m} `))
    .sort((a, b) => b.length - a.length)[0];

  if (multi) {
    const wordCount = multi.split(" ").length;
    const canonical = SUB_BRAND_TO_MAKE[multi] ?? rest.slice(0, wordCount).join(" ");
    return { year, make: canonical, model: rest.slice(wordCount).join(" ") };
  }

  return { year, make: rest[0], model: rest.slice(1).join(" ") };
}
