import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import type { DraftErrors } from "@/lib/admin/useEditorDraft";
import type { AdminIconName, StatusState } from "@/components/admin/v3/editor";
import { normalizeContactRouting } from "@/lib/passportRouting";
import { DEFAULT_STICKY_BUTTONS, MAX_STICKY_BUTTONS, STICKY_BUTTON_OPTIONS, STICKY_KEYS, STICKY_LABELS, type StickyBottomButtons, type StickyButton } from "@/lib/stickyButtons";

export type CtaDraft = {
  sticky_bottom_buttons: StickyBottomButtons;
  mobile_slideout_cta_variant: string;
};

export const CTA_LABELS: Record<string, string> = {
  sticky_bottom_buttons: "Sticky bottom buttons",
  mobile_slideout_cta_variant: "Mobile slide-out style",
};

export const SLIDEOUT_VARIANTS: ReadonlyArray<{ id: string; label: string; detail: string }> = [
  { id: "dealer_availability", label: "Dealer availability (default)", detail: "A status badge, one hold button and the three trust lines." },
  { id: "context_aware", label: "Context aware", detail: "The badge and button wording follow the panel the shopper is reading." },
  { id: "two_button", label: "Two button", detail: "A talk-to-a-specialist link above one hold button." },
  { id: "progressive", label: "Progressive", detail: "A short list of what the shopper is looking at, then one hold button." },
];

const clone = (c: StickyBottomButtons): StickyBottomButtons => JSON.parse(JSON.stringify(c)) as StickyBottomButtons;

export const normalizeSticky = (raw: unknown): StickyBottomButtons => {
  const s = raw as Partial<StickyBottomButtons> | null | undefined;
  if (!s || !Array.isArray(s.buttons) || s.buttons.length === 0) return clone(DEFAULT_STICKY_BUTTONS);
  return clone({ enabled: s.enabled !== false, primary_key: s.primary_key ?? "", buttons: s.buttons as StickyButton[] });
};

export const readCtas = (s: DealerSettings): CtaDraft => ({
  sticky_bottom_buttons: normalizeSticky(s.sticky_bottom_buttons),
  mobile_slideout_cta_variant: s.mobile_slideout_cta_variant || "dealer_availability",
});

export const selectedOf = (cfg: StickyBottomButtons): StickyButton[] => cfg.buttons.filter((b) => !!b.enabled).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
const hiddenOf = (cfg: StickyBottomButtons): StickyButton[] => cfg.buttons.filter((b) => !b.enabled);

/** Replaces the selected list, renumbers it, keeps switched-off stored entries, and keeps exactly one primary. */
export const withSelected = (cfg: StickyBottomButtons, selected: StickyButton[], primary?: string): StickyBottomButtons => {
  const buttons = [...selected.map((b, i) => ({ ...b, enabled: true, order: i + 1 })), ...hiddenOf(cfg).map((b, i) => ({ ...b, order: selected.length + i + 1 }))];
  const want = primary ?? cfg.primary_key;
  const primary_key = selected.some((b) => b.key === want) ? want : (selected[0]?.key ?? "");
  return { ...cfg, buttons, primary_key };
};

export const UNSAFE_FIELDS = ["url", "href", "link", "destination", "target", "action", "onClick"] as const;
const UNSAFE_SCHEME = /^\s*(javascript|data|vbscript|file):/i;

/** Why a stored button carries something the Passport would never honor, or null when it is a plain supported action. */
export function unsafeDestination(b: StickyButton): string | null {
  const rec = b as unknown as Record<string, unknown>;
  for (const f of UNSAFE_FIELDS) {
    const v = rec[f];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "string" && UNSAFE_SCHEME.test(v)) return `This button carries a ${v.trim().split(":")[0].toLowerCase()}: address, which is never allowed.`;
    return "Buttons open fixed Passport actions. A stored web address or handler is not supported and is ignored.";
  }
  return null;
}

export const LABEL_MAX = 24;
export const LABEL_WARN = 12;

export function validateCtas(d: CtaDraft): DraftErrors<CtaDraft> {
  const e: DraftErrors<CtaDraft> = {};
  const cfg = d.sticky_bottom_buttons;
  const on = selectedOf(cfg);
  const fail = (m: string) => { e.sticky_bottom_buttons ??= m; };
  if (on.length > MAX_STICKY_BUTTONS) fail(`Choose at most ${MAX_STICKY_BUTTONS} buttons.`);
  if (cfg.enabled && on.length === 0) fail("Choose at least one button, or turn the sticky bar off.");
  if (on.some((b) => !STICKY_KEYS.has(b.key))) fail("One or more buttons are not supported actions.");
  if (cfg.enabled && on.length > 0 && !on.some((b) => b.key === cfg.primary_key)) fail("Pick exactly one primary button.");
  for (const b of on) {
    const bad = unsafeDestination(b);
    if (bad) fail(bad);
    if (!b.label.trim()) fail(`${STICKY_LABELS[b.key] ?? b.key} needs a label.`);
    else if (b.label.trim().length > LABEL_MAX) fail(`${b.label.trim().slice(0, 12)}... is longer than ${LABEL_MAX} characters.`);
  }
  if (!SLIDEOUT_VARIANTS.some((v) => v.id === d.mobile_slideout_cta_variant)) e.mobile_slideout_cta_variant = "Choose one of the four styles.";
  return e;
}

export const ctaToPatch = (changed: Partial<CtaDraft>): Partial<DealerSettings> => {
  const out: Partial<DealerSettings> = {};
  if (changed.sticky_bottom_buttons) out.sticky_bottom_buttons = changed.sticky_bottom_buttons;
  if (changed.mobile_slideout_cta_variant !== undefined) out.mobile_slideout_cta_variant = changed.mobile_slideout_cta_variant;
  return out;
};

export function describeCta(key: string, value: unknown): string {
  if (key === "mobile_slideout_cta_variant") return SLIDEOUT_VARIANTS.find((v) => v.id === value)?.label ?? String(value);
  const cfg = value as StickyBottomButtons;
  if (!cfg.enabled) return "Sticky bar off";
  const on = selectedOf(cfg);
  return on.length ? on.map((b) => `${b.label}${b.key === cfg.primary_key ? " (primary)" : ""}`).join(", ") : "No buttons";
}

type DestinationKind = "native_call" | "native_text" | "contact_form" | "request_form" | "payment_sheet" | "trade_sheet" | "share_sheet" | "save_action" | "directions_panel";

export interface DestinationOption { id: string; label: string; supported: boolean; reason?: string }

export interface ActionSpec {
  key: string;
  icon: AdminIconName;
  group: "Talk to the store" | "Visit" | "Price and payment" | "Share and save";
  kind: DestinationKind;
  destination: string;
  needs?: "phone" | "address" | "financing";
  caution?: string;
}

const A = (key: string, icon: AdminIconName, group: ActionSpec["group"], kind: DestinationKind, destination: string, extra: Partial<ActionSpec> = {}): ActionSpec => ({ key, icon, group, kind, destination, ...extra });

export const ACTION_SPECS: ActionSpec[] = [
  A("call", "phone", "Talk to the store", "native_call", "Starts a phone call to the store number", { needs: "phone" }),
  A("text", "message", "Talk to the store", "native_text", "Opens the shopper's text app addressed to the store number", { needs: "phone" }),
  A("contact_dealer", "users", "Talk to the store", "contact_form", "Opens the Passport contact form, routed by Contact & Routing"),
  A("email_dealer", "mail", "Talk to the store", "contact_form", "Opens the same Passport contact form. It does not open an email app."),
  A("chat", "help", "Talk to the store", "contact_form", "Opens the Passport contact form", { caution: "No live chat is connected, so this opens the contact form. A label that says Chat can mislead shoppers." }),
  A("test_drive", "car", "Visit", "request_form", "Opens the Passport test drive request"),
  A("check_availability", "search", "Visit", "request_form", "Opens the Passport availability request"),
  A("reserve", "shield-check", "Visit", "request_form", "Opens the Passport hold request. It sends a request the store confirms."),
  A("directions", "pin", "Visit", "directions_panel", "Opens the Visit the dealer panel", { needs: "address" }),
  A("schedule_service", "wrench", "Visit", "contact_form", "Opens the Passport contact form", { caution: "There is no service scheduling flow, so this opens the contact form." }),
  A("todays_price", "dollar", "Price and payment", "payment_sheet", "Opens the Passport price and payment sheet"),
  A("payment_options", "list", "Price and payment", "payment_sheet", "Opens the Passport price and payment sheet"),
  A("calculate_payment", "calculator", "Price and payment", "payment_sheet", "Opens the payment sheet. The Passport hides it while the payment estimator is off."),
  A("trade_appraisal", "refresh", "Price and payment", "trade_sheet", "Opens the Passport trade value flow"),
  A("value_trade", "tag", "Price and payment", "trade_sheet", "Opens the Passport trade value flow"),
  A("pre_qualified", "check-circle", "Price and payment", "payment_sheet", "Opens the payment sheet. No credit application is collected.", { needs: "financing" }),
  A("apply_financing", "credit-card", "Price and payment", "payment_sheet", "Opens the payment sheet. No credit application is collected.", { needs: "financing" }),
  A("send_to_phone", "upload", "Share and save", "share_sheet", "Opens the share sheet"),
  A("share_vehicle", "link", "Share and save", "share_sheet", "Opens the share sheet"),
  A("save_vehicle", "star", "Share and save", "save_action", "Saves the vehicle on the shopper's device"),
];

export const GROUP_ORDER: ActionSpec["group"][] = ["Talk to the store", "Visit", "Price and payment", "Share and save"];

export const specOf = (key: string): ActionSpec | undefined => ACTION_SPECS.find((a) => a.key === key);

export const labelOf = (key: string): string => STICKY_LABELS[key] ?? key;

const UNSUPPORTED_DEST = "Buttons open fixed Passport actions. A web address is never stored, so unsafe schemes and off-account links cannot be saved.";

export function destinationOptions(spec: ActionSpec): DestinationOption[] {
  const main: Record<DestinationKind, string> = {
    native_call: "Phone call to the store number", native_text: "Text message to the store number", contact_form: "Passport contact form", request_form: "Passport request form",
    payment_sheet: "Passport price and payment sheet", trade_sheet: "Passport trade value flow", share_sheet: "Share sheet", save_action: "Save on this device", directions_panel: "Visit the dealer panel",
  };
  return [
    { id: spec.kind, label: main[spec.kind], supported: true },
    { id: "custom_url", label: "Custom web address", supported: false, reason: UNSUPPORTED_DEST },
    { id: "other_tenant", label: "Another account's page", supported: false, reason: "Actions only reach this account's own Passport and store contact." },
  ];
}

export interface Availability { state: StatusState; label: string; reason: string }

export interface CtaContext {
  phone: string;
  address: string;
}

const digits = (v: string) => v.replace(/\D/g, "").length;

export const ctaContextFrom = (s: DealerSettings): CtaContext => {
  const routing = normalizeContactRouting(s.passport_contact_routing);
  return {
    phone: (routing.dealershipDefaultContact.salesPhone || s.dealer_phone || "").trim(),
    address: (s.dealer_address || "").trim(),
  };
};

export function availabilityOf(spec: ActionSpec, ctx: CtaContext): Availability {
  if (spec.needs === "phone") {
    if (digits(ctx.phone) < 7) return { state: "setup_required", label: "Not configured", reason: "No store phone number is on file, so the Passport opens the contact form instead." };
    return { state: "enabled", label: "Enabled", reason: "Uses the store phone number." };
  }
  if (spec.needs === "address") {
    return ctx.address ? { state: "enabled", label: "Enabled", reason: "Uses the store address." } : { state: "setup_required", label: "Not configured", reason: "No store address is on file, so the panel has nothing to show." };
  }
  if (spec.needs === "financing") {
    return { state: "enabled", label: "Enabled", reason: "Opens the payment sheet. No credit application is collected." };
  }
  if (spec.caution) return { state: "stale", label: "Check label", reason: spec.caution };
  return { state: "enabled", label: "Enabled", reason: "Opens a Passport flow that is always available." };
}

export const libraryOptions = STICKY_BUTTON_OPTIONS;
