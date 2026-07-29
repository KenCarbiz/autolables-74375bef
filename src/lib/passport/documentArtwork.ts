// One resolver for how a document is pictured on the customer Documents page.
//
// Every card used to show the same vehicle photograph, so six records looked
// identical and told the shopper nothing about what they were about to open.
// The photo now stays where it belongs — the Passport vehicle summary — and a
// document is pictured as a document.
//
// Resolution order (first hit wins):
//   1. a customer-safe first-page thumbnail of the real stored file
//   2. an approved source-provided cover (OEM / CARFAX integration)
//   3. an AutoLabels cover for that document type
//   4. a neutral file cover
//
// The vehicle photo is deliberately NOT in that chain at any position.

export type ArtworkKind =
  | "generated_first_page"
  | "official_cover"
  | "branded_fallback"
  | "generic_fallback";

export type Orientation = "portrait" | "landscape" | "square";

/** Icon name from lucide-react; the page maps it to a component. */
export type ArtworkIcon =
  | "FileSpreadsheet" | "History" | "PanelsTopLeft" | "BookOpen" | "ClipboardCheck"
  | "Wrench" | "FileCheck2" | "ShieldCheck" | "FileSignature" | "FileText";

export interface DocumentArtwork {
  artworkUrl: string | null;
  artworkKind: ArtworkKind;
  orientation: Orientation;
  label: string;
  accentColor: string;
  fallbackIcon: ArtworkIcon;
  accessibleLabel: string;
  safeForCustomerDisplay: boolean;
}

export interface ArtworkInput {
  /** Canonical document type. Free text is normalized below. */
  type?: string | null;
  title?: string | null;
  /** The stored file, if any. */
  url?: string | null;
  /** A pre-generated, customer-safe first-page thumbnail. */
  thumbnailUrl?: string | null;
  /** An approved cover from an integration (OEM brochure, CARFAX). */
  coverUrl?: string | null;
  /**
   * Only a derivative that was redacted BEFORE storage may be shown. Repair
   * orders and signed records carry customer names, addresses, payment and
   * signatures; a client-side mask over a raw thumbnail is not redaction.
   */
  customerSafeThumbnail?: boolean;
}

interface TypeStyle {
  label: string;
  accentColor: string;
  fallbackIcon: ArtworkIcon;
  orientation: Orientation;
  /** Never show a raw first page for these, even if one exists. */
  requiresSanitizedDerivative?: boolean;
}

const GENERIC: TypeStyle = {
  label: "DOCUMENT", accentColor: "#64748B", fallbackIcon: "FileText", orientation: "portrait",
};

// Landscape only where the real page is landscape — a window sticker. Every
// government form and service record is an upright 8.5x11 sheet and must never
// be stretched into a letterbox.
const TYPE_STYLES: Record<string, TypeStyle> = {
  window_sticker:   { label: "WINDOW STICKER", accentColor: "#2563EB", fallbackIcon: "FileSpreadsheet", orientation: "landscape" },
  factory_sticker:  { label: "WINDOW STICKER", accentColor: "#2563EB", fallbackIcon: "FileSpreadsheet", orientation: "landscape" },
  build_sheet:      { label: "BUILD RECORD", accentColor: "#2563EB", fallbackIcon: "FileSpreadsheet", orientation: "landscape" },
  vehicle_history:  { label: "VEHICLE HISTORY", accentColor: "#334155", fallbackIcon: "History", orientation: "portrait" },
  brochure:         { label: "OFFICIAL BROCHURE", accentColor: "#7C3AED", fallbackIcon: "PanelsTopLeft", orientation: "portrait" },
  owners_manual:    { label: "OWNER'S MANUAL", accentColor: "#334155", fallbackIcon: "BookOpen", orientation: "portrait" },
  k208:             { label: "K-208", accentColor: "#1D4E89", fallbackIcon: "ClipboardCheck", orientation: "portrait" },
  inspection:       { label: "INSPECTION", accentColor: "#16A36A", fallbackIcon: "ClipboardCheck", orientation: "portrait" },
  buyers_guide:     { label: "BUYER'S GUIDE", accentColor: "#0F9F9A", fallbackIcon: "FileCheck2", orientation: "portrait" },
  warranty:         { label: "WARRANTY", accentColor: "#0F9F9A", fallbackIcon: "ShieldCheck", orientation: "portrait" },
  service_record:   { label: "SERVICE RECORD", accentColor: "#E97916", fallbackIcon: "Wrench", orientation: "portrait", requiresSanitizedDerivative: true },
  signed_record:    { label: "SIGNED PRICE RECORD", accentColor: "#7C3AED", fallbackIcon: "FileSignature", orientation: "portrait", requiresSanitizedDerivative: true },
};

/** Map the many free-text type strings in the data onto one vocabulary. */
export function canonicalDocumentType(raw?: string | null, title?: string | null): string {
  // A value that is ALREADY canonical must map to itself. The patterns below
  // are written for prose ("service record"), so an underscored key coming
  // straight back out of the data ("service_record") missed every one of them
  // and landed on "other" — which quietly dropped that type's sanitization
  // requirement along with its styling.
  const exact = String(raw || "").trim().toLowerCase();
  if (exact && Object.prototype.hasOwnProperty.call(TYPE_STYLES, exact)) return exact;

  // Underscores, hyphens and curly apostrophes all collapse first, so the
  // patterns below only ever have to describe the prose form.
  const s = `${raw || ""} ${title || ""}`
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/k ?208/.test(s)) return "k208";
  if (/buyer'?s? guide|ftc/.test(s)) return "buyers_guide";
  if (/carfax|autocheck|vehicle history|history report/.test(s)) return "vehicle_history";
  if (/owner'?s? manual|^manual\b|\bmanual$/.test(s)) return "owners_manual";
  if (/brochure/.test(s)) return "brochure";
  if (/build (record|sheet)/.test(s)) return "build_sheet";
  if (/window|monroney|sticker/.test(s)) return "window_sticker";
  if (/repair|service record|repair order|\bro\b/.test(s)) return "service_record";
  if (/inspection|mpi|checklist/.test(s)) return "inspection";
  if (/warranty|vsc/.test(s)) return "warranty";
  if (/signed|price record|odometer|disclosure/.test(s)) return "signed_record";
  return "other";
}

const isImage = (url?: string | null) => !!url && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url);

/**
 * Canonical type -> the cover art to draw for it. This is the ONLY place the
 * two vocabularies meet; no component may compare document-type strings of
 * its own. `provider` splits the history report into a CARFAX-titled record
 * and a generic one — the drawn cover is unbranded either way, because the
 * repository holds no authorized CARFAX asset.
 */
export function documentCoverType(
  rawType?: string | null,
  title?: string | null,
  provider?: string | null,
): "factory_sticker" | "carfax" | "vehicle_history" | "owners_manual" | "oem_brochure" | "buyers_guide" | "warranty" | "generic" {
  const canonical = canonicalDocumentType(rawType, title);
  switch (canonical) {
    case "window_sticker":
    case "factory_sticker":
    case "build_sheet":
      return "factory_sticker";
    case "vehicle_history":
      return /carfax/i.test(`${provider ?? ""} ${rawType ?? ""} ${title ?? ""}`) ? "carfax" : "vehicle_history";
    case "owners_manual":
      return "owners_manual";
    case "brochure":
      return "oem_brochure";
    case "buyers_guide":
      return "buyers_guide";
    case "warranty":
      return "warranty";
    default:
      return "generic";
  }
}

export function resolveDocumentArtwork(input: ArtworkInput): DocumentArtwork {
  const type = canonicalDocumentType(input.type, input.title);
  const style = TYPE_STYLES[type] ?? GENERIC;
  const accessibleLabel = input.title?.trim() || style.label;

  const base = {
    orientation: style.orientation,
    label: style.label,
    accentColor: style.accentColor,
    fallbackIcon: style.fallbackIcon,
    accessibleLabel,
  };

  // 1. A real first page, but only when it is a derivative that was made safe
  //    before it was stored. For repair orders and signed records that is a
  //    hard requirement, not a preference.
  const thumbAllowed = !style.requiresSanitizedDerivative || input.customerSafeThumbnail === true;
  if (input.thumbnailUrl && thumbAllowed) {
    return { ...base, artworkUrl: input.thumbnailUrl, artworkKind: "generated_first_page", safeForCustomerDisplay: true };
  }

  // 2. An approved cover supplied by the integration. Held to the SAME
  //    sanitization rule as a thumbnail: a cover is page 1 of the real file,
  //    so for a repair order or a signed record it carries the customer's
  //    name, address, payment and signature just as a thumbnail would. The
  //    only covers that exist today are OEM brochures and owner's manuals,
  //    which carry none of that — but the moment covers are generated for
  //    dealer uploads, an ungated branch here is a PII leak onto a public
  //    page, so the gate goes in before the pipeline arrives, not after.
  if (input.coverUrl && thumbAllowed) {
    return { ...base, artworkUrl: input.coverUrl, artworkKind: "official_cover", safeForCustomerDisplay: true };
  }

  // A stored file that is itself an image can stand in for a first page — but
  // never for a type that demands a sanitized derivative.
  if (isImage(input.url) && thumbAllowed) {
    return { ...base, artworkUrl: input.url!, artworkKind: "generated_first_page", safeForCustomerDisplay: true };
  }

  // 3 / 4. Drawn cover. Never the vehicle photo.
  return {
    ...base,
    artworkUrl: null,
    artworkKind: type === "other" ? "generic_fallback" : "branded_fallback",
    safeForCustomerDisplay: true,
  };
}
