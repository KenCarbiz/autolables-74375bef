// Sticky bottom CTA buttons — dealer-configurable set shown on the Vehicle
// Passport's sticky mobile bar. The admin panel writes a StickyBottomButtons
// config into dealer settings; the public passport resolves it (capped at 4,
// ordered, with one primary) via resolveStickyButtons().

export interface StickyButton {
  key: string;
  label: string;
  enabled: boolean;
  order: number;
}

export interface StickyBottomButtons {
  enabled: boolean;
  primary_key: string;
  buttons: StickyButton[];
}

// The full catalog a dealer can choose from. Keys are stable; labels are the
// safe defaults (a dealer may override the label per button).
export const STICKY_BUTTON_OPTIONS: { key: string; label: string }[] = [
  { key: "call", label: "Call" },
  { key: "text", label: "Text" },
  { key: "test_drive", label: "Test Drive" },
  { key: "todays_price", label: "Today's Price" },
  { key: "contact_dealer", label: "Contact Dealer" },
  { key: "trade_appraisal", label: "Trade Appraisal" },
  { key: "value_trade", label: "Value My Trade" },
  { key: "reserve", label: "Reserve This Vehicle" },
  { key: "pre_qualified", label: "Get Pre-Qualified" },
  { key: "apply_financing", label: "Apply for Financing" },
  { key: "check_availability", label: "Check Availability" },
  { key: "schedule_service", label: "Schedule Service" },
  { key: "payment_options", label: "View Payment Options" },
  { key: "calculate_payment", label: "Calculate Payment" },
  { key: "send_to_phone", label: "Send to Phone" },
  { key: "save_vehicle", label: "Save Vehicle" },
  { key: "share_vehicle", label: "Share Vehicle" },
  { key: "directions", label: "Directions" },
  { key: "chat", label: "Chat" },
  { key: "email_dealer", label: "Email Dealer" },
];

export const STICKY_LABELS: Record<string, string> = Object.fromEntries(
  STICKY_BUTTON_OPTIONS.map((o) => [o.key, o.label]),
);
export const STICKY_KEYS = new Set(STICKY_BUTTON_OPTIONS.map((o) => o.key));
export const MAX_STICKY_BUTTONS = 4;

export const DEFAULT_STICKY_BUTTONS: StickyBottomButtons = {
  enabled: true,
  primary_key: "todays_price",
  buttons: [
    { key: "call", label: "Call", enabled: true, order: 1 },
    { key: "text", label: "Text", enabled: true, order: 2 },
    { key: "test_drive", label: "Test Drive", enabled: true, order: 3 },
    { key: "todays_price", label: "Today's Price", enabled: true, order: 4 },
  ],
};

export interface ResolvedStickyButton { key: string; label: string; primary: boolean }

// Validation for the admin panel — returns an error string or null.
export function validateStickyButtons(cfg: StickyBottomButtons): string | null {
  const enabled = (cfg.buttons || []).filter((b) => b.enabled);
  if (cfg.enabled && enabled.length === 0) return "Enable at least one button, or turn the sticky bar off.";
  if (enabled.length > MAX_STICKY_BUTTONS) return `Choose at most ${MAX_STICKY_BUTTONS} buttons.`;
  if (enabled.some((b) => !STICKY_KEYS.has(b.key))) return "One or more buttons are not recognized.";
  if (cfg.enabled && enabled.length > 0 && !enabled.some((b) => b.key === cfg.primary_key)) {
    return "The primary button must be one of the enabled buttons.";
  }
  return null;
}

// Resolve the ordered, capped, enabled buttons for rendering on the passport.
export function resolveStickyButtons(cfg?: StickyBottomButtons | null): { items: ResolvedStickyButton[]; enabled: boolean } {
  const c = cfg && Array.isArray(cfg.buttons) && cfg.buttons.length ? cfg : DEFAULT_STICKY_BUTTONS;
  if (c.enabled === false) return { items: [], enabled: false };
  const items = (c.buttons || [])
    .filter((b) => b.enabled && STICKY_KEYS.has(b.key))
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .slice(0, MAX_STICKY_BUTTONS)
    .map((b) => ({ key: b.key, label: (b.label || STICKY_LABELS[b.key] || b.key), primary: b.key === c.primary_key }));
  if (items.length && !items.some((i) => i.primary)) items[items.length - 1].primary = true;
  return { items, enabled: items.length > 0 };
}
