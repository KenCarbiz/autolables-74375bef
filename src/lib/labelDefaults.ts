// ──────────────────────────────────────────────────────────────────────
// Dealer label template defaults — the tenant-level "which template is in
// effect" model. Four slots (window/addendum × used/new), each pointing at
// either a Sticker Studio template ("studio:<template-id>") or one of the
// dedicated builders ("builder:<key>"). Stored in dealer settings
// (label_defaults) so it follows the tenant, not the browser; the legacy
// one-star-per-type prefs (dealer_sticker_template_prefs) are honored as a
// read-only fallback until a slot is explicitly set.
// ──────────────────────────────────────────────────────────────────────

export type LabelSlot = "window_used" | "window_new" | "addendum_used" | "addendum_new";
export type LabelDefaults = Partial<Record<LabelSlot, string>>;
export type LabelCondition = "used" | "new";
export type LabelKind = "window" | "addendum";

export interface LabelRef {
  kind: "studio" | "builder";
  key: string;
}

export const parseLabelRef = (ref: string | null | undefined): LabelRef | null => {
  if (!ref) return null;
  const m = /^(studio|builder):(.+)$/.exec(ref);
  return m ? { kind: m[1] as LabelRef["kind"], key: m[2] } : null;
};

export const formatLabelRef = (r: LabelRef): string => `${r.kind}:${r.key}`;

// The dedicated builders that can serve as a slot target.
export const LABEL_BUILDERS: Record<string, { key: string; label: string; path: string; kind: LabelKind; conditions: LabelCondition[] }> = {
  "used-car-sticker": { key: "used-car-sticker", label: "Used Car Window Sticker (classic builder)", path: "/used-car-sticker", kind: "window", conditions: ["used"] },
  "new-car-sticker": { key: "new-car-sticker", label: "New Car Monroney + Addendum (classic builder)", path: "/new-car-sticker", kind: "window", conditions: ["new"] },
  "deal-addendum": { key: "deal-addendum", label: "Deal Addendum builder (products + disclosures)", path: "/addendum", kind: "addendum", conditions: ["used", "new"] },
};

export const LABEL_SLOTS: { slot: LabelSlot; kind: LabelKind; condition: LabelCondition; title: string; sub: string }[] = [
  { slot: "window_used", kind: "window", condition: "used", title: "Used window sticker", sub: "Full-size sticker generated for pre-owned vehicles" },
  { slot: "window_new", kind: "window", condition: "new", title: "New window sticker", sub: "Monroney-style sticker generated for new vehicles" },
  { slot: "addendum_used", kind: "addendum", condition: "used", title: "Used addendum", sub: "Supplemental addendum strip for pre-owned vehicles" },
  { slot: "addendum_new", kind: "addendum", condition: "new", title: "New addendum", sub: "Supplemental addendum strip for new vehicles" },
];

export const slotFor = (kind: LabelKind, condition: LabelCondition): LabelSlot =>
  `${kind}_${condition}` as LabelSlot;

// CPO and unknown conditions use the used-vehicle slot.
export const conditionOf = (raw: string | null | undefined): LabelCondition =>
  String(raw || "").toLowerCase() === "new" ? "new" : "used";

// Platform defaults when the dealer hasn't picked anything: the classic
// builders for window stickers; no implied default for addendum strips.
const PLATFORM_DEFAULTS: LabelDefaults = {
  window_used: "builder:used-car-sticker",
  window_new: "builder:new-car-sticker",
};

// Resolve the in-effect ref for a slot: explicit dealer setting → legacy
// starred pref (one per kind, applied to both conditions) → platform default.
export const resolveLabelDefault = (
  defaults: LabelDefaults | null | undefined,
  slot: LabelSlot,
  legacyByKind?: Record<string, string>,
): string | null => {
  const explicit = defaults?.[slot];
  if (explicit) return explicit;
  const kind = slot.startsWith("window") ? "window" : "addendum";
  const legacy = legacyByKind?.[kind];
  if (legacy) return `studio:${legacy}`;
  return PLATFORM_DEFAULTS[slot] ?? null;
};

// Route for a ref, carrying the vehicle so the destination prefills.
export const labelRefPath = (ref: string, vehicleId?: string | null): string | null => {
  const r = parseLabelRef(ref);
  if (!r) return null;
  const q = vehicleId ? `?vehicleId=${vehicleId}` : "";
  if (r.kind === "builder") {
    const b = LABEL_BUILDERS[r.key];
    return b ? `${b.path}${q}` : null;
  }
  return `/sticker-studio/${r.key}${q}`;
};
