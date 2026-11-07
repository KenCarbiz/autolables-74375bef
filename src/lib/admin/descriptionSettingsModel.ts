import { CHANNEL_META, CHANNEL_CARDS, type ChannelMeta } from "@/lib/description/model";
import {
  DEFAULT_CHANNEL_POLICIES,
  checkChannelPolicy,
  provenanceFor,
  resolveChannelPolicy,
  type ChannelPolicy,
  type ChannelProvenance,
  type PolicyFinding,
} from "../../../supabase/functions/_shared/description-channel-policy";
import { countText, fitNarrativeExact, splitSentences, wireText, type TextCounts } from "../../../supabase/functions/_shared/description-exact-fit";
import { REVIEW_MODES, resolveReviewMode } from "../../../supabase/functions/_shared/description-review-mode";
import { TONE_PROFILES } from "../../../supabase/functions/_shared/description-tone";

// Models for Publishing > Destinations and the Description settings sections. Every rule that decides a number or an
// outcome is imported from the shared server modules, so the screen reports what the server enforces: the channel
// policy registry, the exact-fit counter that builds the vAuto export, and the review-mode resolver.

export type AutomationMode = (typeof REVIEW_MODES)[number];

export const AUTOMATION_MODES: ReadonlyArray<{ key: AutomationMode; label: string; help: string }> = [
  { key: "AUTO_PUBLISH_CLEAN", label: "Full automation", help: "Publish automatically whenever every check passes." },
  { key: "EXCEPTION_REVIEW", label: "Exception review", help: "Publish clean vehicles. Hold anything with a warning about the facts." },
  { key: "REQUIRE_APPROVAL_ALL", label: "Approval required", help: "Generate and check, then a manager approves every vehicle." },
  { key: "DRAFT_ONLY", label: "Draft only", help: "Generate and check. Nothing is published automatically." },
];

export const modeLabel = (mode: string): string => AUTOMATION_MODES.find((m) => m.key === mode)?.label ?? mode;

export const AUTOMATION_TYPES = [
  { key: "new", label: "New" },
  { key: "used", label: "Used" },
  { key: "cpo", label: "CPO" },
  { key: "demo", label: "Demo / loaner" },
] as const;

export const TONE_OPTIONS = Object.values(TONE_PROFILES).map((t) => ({ key: t.key as string, label: t.label }));

export interface DescriptionDraft extends Record<string, unknown> {
  review_mode: string;
  review_mode_by_class: Record<string, string>;
  enabled_channels: string[];
  internal_publication_enabled: boolean;
  brand_voice: string;
  default_tone: string;
  dealer_name_format: string;
  primary_city: string;
  state: string;
  cta_template: string;
  required_legal_text: string;
  prohibited_phrases: string[];
  min_length: number;
  max_length: number;
  class_rules: Record<string, unknown>;
  warranty_language_allowed: boolean;
  cpo_language_allowed: boolean;
  accessory_language_allowed: boolean;
  market_context_allowed: boolean;
  price_in_description: boolean;
  quality_threshold: number;
}

export type DescriptionRow = Record<string, unknown>;

export const DEFAULT_DESCRIPTION_DRAFT: DescriptionDraft = {
  review_mode: "EXCEPTION_REVIEW",
  review_mode_by_class: {},
  enabled_channels: CHANNEL_META.map((c) => c.key),
  internal_publication_enabled: true,
  brand_voice: "",
  default_tone: "professional",
  dealer_name_format: "",
  primary_city: "",
  state: "",
  cta_template: "",
  required_legal_text: "",
  prohibited_phrases: [],
  min_length: 400,
  max_length: 2400,
  class_rules: {},
  warranty_language_allowed: false,
  cpo_language_allowed: false,
  accessory_language_allowed: false,
  market_context_allowed: false,
  price_in_description: false,
  quality_threshold: 70,
};

const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const strArr = (v: unknown, d: string[]) => (Array.isArray(v) ? v.map(String) : d);
const rec = <T,>(v: unknown): Record<string, T> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, T>) : {});

/** The editable values out of a description_settings row, or the same defaults the server writes when no row exists. */
export function readDescriptionDraft(row: DescriptionRow | null | undefined): DescriptionDraft {
  const d = DEFAULT_DESCRIPTION_DRAFT;
  if (!row) return { ...d, review_mode_by_class: {}, enabled_channels: [...d.enabled_channels], prohibited_phrases: [], class_rules: {} };
  const byClass: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec<unknown>(row.review_mode_by_class))) if (typeof v === "string" && v) byClass[k] = v;
  return {
    review_mode: str(row.review_mode, d.review_mode) || d.review_mode,
    review_mode_by_class: byClass,
    enabled_channels: strArr(row.enabled_channels, d.enabled_channels),
    internal_publication_enabled: bool(row.internal_publication_enabled, d.internal_publication_enabled),
    brand_voice: str(row.brand_voice, ""),
    default_tone: str(row.default_tone, d.default_tone) || d.default_tone,
    dealer_name_format: str(row.dealer_name_format, ""),
    primary_city: str(row.primary_city, ""),
    state: str(row.state, ""),
    cta_template: str(row.cta_template, ""),
    required_legal_text: str(row.required_legal_text, ""),
    prohibited_phrases: strArr(row.prohibited_phrases, []),
    min_length: num(row.min_length, d.min_length),
    max_length: num(row.max_length, d.max_length),
    class_rules: rec<unknown>(row.class_rules),
    warranty_language_allowed: bool(row.warranty_language_allowed, false),
    cpo_language_allowed: bool(row.cpo_language_allowed, false),
    accessory_language_allowed: bool(row.accessory_language_allowed, false),
    market_context_allowed: bool(row.market_context_allowed, false),
    price_in_description: bool(row.price_in_description, false),
    quality_threshold: num(row.quality_threshold, d.quality_threshold),
  };
}

const blankToNull = (s: string) => (s.trim() === "" ? null : s);

/** save_description_settings overwrites the whole row, so the payload is the draft in full. Nothing outside the draft is sent. */
export function descriptionPayload(draft: DescriptionDraft): Record<string, unknown> {
  const byClass = Object.fromEntries(Object.entries(draft.review_mode_by_class).filter(([, v]) => !!v));
  return {
    ...draft,
    review_mode_by_class: byClass,
    brand_voice: blankToNull(draft.brand_voice),
    dealer_name_format: blankToNull(draft.dealer_name_format),
    primary_city: blankToNull(draft.primary_city),
    state: blankToNull(draft.state),
    cta_template: blankToNull(draft.cta_template),
    required_legal_text: blankToNull(draft.required_legal_text),
    prohibited_phrases: draft.prohibited_phrases.map((p) => p.trim()).filter(Boolean),
  };
}

export const DESCRIPTION_LABELS: Record<string, string> = {
  review_mode: "Default automation mode",
  review_mode_by_class: "Automation by vehicle type",
  enabled_channels: "Generate content for",
  internal_publication_enabled: "Internal Passport publication",
  brand_voice: "Brand voice",
  default_tone: "Default tone",
  dealer_name_format: "Dealership name in copy",
  primary_city: "City in copy",
  state: "State in copy",
  cta_template: "Call to action",
  required_legal_text: "Required wording",
  prohibited_phrases: "Prohibited phrases",
  min_length: "Master minimum length",
  max_length: "Master maximum length",
  class_rules: "Class rules",
  warranty_language_allowed: "Allow warranty language",
  cpo_language_allowed: "Allow CPO language",
  accessory_language_allowed: "Allow accessory language",
  market_context_allowed: "Allow market context wording",
  price_in_description: "Allow price in description",
  quality_threshold: "Quality review threshold",
};

export function describeDescriptionValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (key === "review_mode") return modeLabel(String(value));
  if (key === "review_mode_by_class") {
    const e = Object.entries(value as Record<string, string>).filter(([, v]) => !!v);
    return e.length ? e.map(([k, v]) => `${AUTOMATION_TYPES.find((t) => t.key === k)?.label ?? k}: ${modeLabel(v)}`).join("; ") : "All types use the default";
  }
  if (key === "enabled_channels") {
    const names = (value as string[]).map((k) => CHANNEL_META.find((c) => c.key === k)?.label ?? k);
    return names.length ? names.join(", ") : "No destinations";
  }
  if (key === "prohibited_phrases") return (value as string[]).length ? (value as string[]).join(", ") : "None";
  if (value === "" || value === null || value === undefined) return "Not set";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
}

export const phraseKey = (p: string) => p.trim().toLowerCase();

/** The server matches a prohibited phrase as a case-insensitive substring of the copy. */
export function phraseMatches(text: string, phrase: string): number[] {
  const out: number[] = [];
  const needle = phrase.trim().toLowerCase();
  if (!needle) return out;
  const hay = text.toLowerCase();
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

const collapse = (t: string) => t.replace(/\s+/g, " ").trim();

export function validateDescription(d: DescriptionDraft): Partial<Record<keyof DescriptionDraft & string, string>> {
  const e: Partial<Record<string, string>> = {};
  if (!Number.isInteger(d.min_length) || d.min_length < 0) e.min_length = "Enter a whole number of characters, zero or more.";
  if (!Number.isInteger(d.max_length) || d.max_length < 1) e.max_length = "Enter a whole number of characters, one or more.";
  else if (Number.isInteger(d.min_length) && d.max_length < d.min_length) e.max_length = "The maximum cannot be below the minimum.";
  if (!Number.isInteger(d.quality_threshold) || d.quality_threshold < 0 || d.quality_threshold > 100) e.quality_threshold = "Enter a whole number from 0 to 100.";
  if (!(REVIEW_MODES as readonly string[]).includes(d.review_mode)) e.review_mode = "Choose one of the four automation modes.";
  for (const [k, v] of Object.entries(d.review_mode_by_class)) {
    if (v && !(REVIEW_MODES as readonly string[]).includes(v)) e.review_mode_by_class = `${k} uses a mode that does not exist.`;
  }
  if (!TONE_OPTIONS.some((t) => t.key === d.default_tone)) e.default_tone = "Choose one of the listed tones.";
  const seen = new Set<string>();
  for (const p of d.prohibited_phrases) {
    const k = phraseKey(p);
    if (!k) e.prohibited_phrases = "A blank phrase would match every description.";
    else if (seen.has(k)) e.prohibited_phrases = `"${p}" is listed twice.`;
    seen.add(k);
  }
  const legal = collapse(d.required_legal_text).toLowerCase();
  const cta = d.cta_template.toLowerCase();
  for (const p of d.prohibited_phrases) {
    const k = phraseKey(p);
    if (!k) continue;
    if (legal.includes(k)) e.required_legal_text = `The required wording contains the prohibited phrase "${p}", so every description would be blocked.`;
    if (cta.includes(k)) e.cta_template = `The call to action contains the prohibited phrase "${p}".`;
  }
  return e;
}

// ── Destinations ────────────────────────────────────────────────────────────

export type DeliveryKind = "internal" | "manual_export" | "connector_needed";

export interface DestinationRow {
  key: string;
  label: string;
  kind: "owned_surface" | "marketplace" | "owned_site" | "output_optimization" | "inventory_workflow";
  kindLabel: string;
  deliveryMode: ChannelMeta["deliveryMode"];
  delivery: DeliveryKind;
  generates: boolean;
  automaticDelivery: { available: boolean; on: boolean; reason: string };
  characterLimit: number;
}

const KIND: Record<string, { kind: DestinationRow["kind"]; label: string }> = {
  vehicle_passport: { kind: "owned_surface", label: "Internal Vehicle Passport" },
  dealer_website: { kind: "owned_site", label: "Dealer website export" },
  autotrader: { kind: "marketplace", label: "Marketplace export" },
  cars_com: { kind: "marketplace", label: "Marketplace connector" },
  cargurus: { kind: "marketplace", label: "Marketplace export" },
  facebook: { kind: "marketplace", label: "Marketplace export" },
  google_seo: { kind: "output_optimization", label: "SEO output optimization" },
  vauto: { kind: "inventory_workflow", label: "vAuto export" },
};

const ORDER = ["vehicle_passport", "dealer_website", "google_seo", "vauto", "autotrader", "cars_com", "cargurus", "facebook"];

export function destinationRows(draft: Pick<DescriptionDraft, "enabled_channels" | "internal_publication_enabled">): DestinationRow[] {
  return ORDER.map((key) => CHANNEL_META.find((c) => c.key === key)).filter((c): c is ChannelMeta => !!c).map((c) => {
    const k = KIND[c.key] ?? { kind: "marketplace" as const, label: "Export" };
    const internal = c.deliveryMode === "internal_projection";
    const connectorReady = c.deliveryMode === "connector" && c.connectorStatus === "available";
    const delivery: DeliveryKind = internal ? "internal" : c.deliveryMode === "connector" ? "connector_needed" : "manual_export";
    const available = internal || connectorReady;
    return {
      key: c.key,
      label: c.label,
      kind: k.kind,
      kindLabel: k.label,
      deliveryMode: c.deliveryMode,
      delivery,
      generates: draft.enabled_channels.includes(c.key),
      automaticDelivery: {
        available,
        on: internal ? draft.internal_publication_enabled : false,
        reason: internal
          ? "Writes the description to the shopper Passport."
          : c.deliveryMode === "connector"
            ? "No connector is configured, so nothing can be delivered automatically."
            : "Export only. AutoLabels produces the text and never sends it.",
      },
      characterLimit: c.characterLimit,
    };
  });
}

export const CHANNEL_CARD_HELPER = Object.fromEntries(CHANNEL_CARDS.map((c) => [c.key, c.helper]));

export interface AutomationRow {
  type: (typeof AUTOMATION_TYPES)[number]["key"];
  label: string;
  effective: string;
  source: "custom" | "inherited" | "fallback";
  custom: string | null;
}

/** Per-type effective mode, resolved by the same function the server uses to decide whether a description may publish. */
export function automationRows(d: Pick<DescriptionDraft, "review_mode" | "review_mode_by_class">): AutomationRow[] {
  return AUTOMATION_TYPES.map((t) => {
    const r = resolveReviewMode(d, t.key);
    return { type: t.key, label: t.label, effective: r.mode, source: r.source === "class" ? "custom" : r.source === "default" ? "inherited" : "fallback", custom: d.review_mode_by_class[t.key] || null };
  });
}

// ── Delivery history (description_deliveries) ───────────────────────────────

export interface DeliveryRecord {
  id: string;
  destination: string;
  status: string;
  delivery_mode: string;
  attempt_count: number | null;
  published_at: string | null;
  failed_at: string | null;
  created_at: string;
  response_metadata?: Record<string, unknown> | null;
}

export interface DeliverySummary {
  destination: string;
  lastAttempt: string | null;
  lastSuccess: string | null;
  lastError: { at: string | null; message: string } | null;
  total: number;
}

const errorText = (r: DeliveryRecord): string => {
  const m = r.response_metadata ?? {};
  const v = (m as Record<string, unknown>).error ?? (m as Record<string, unknown>).message ?? (m as Record<string, unknown>).reason;
  return typeof v === "string" && v ? v : "The delivery failed. No reason was recorded.";
};

export function summarizeDeliveries(rows: DeliveryRecord[]): Record<string, DeliverySummary> {
  const out: Record<string, DeliverySummary> = {};
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const r of sorted) {
    const s = (out[r.destination] ??= { destination: r.destination, lastAttempt: null, lastSuccess: null, lastError: null, total: 0 });
    s.total += 1;
    s.lastAttempt ??= r.created_at;
    if (r.status === "delivered" && !s.lastSuccess) s.lastSuccess = r.published_at ?? r.created_at;
    if (r.status === "failed" && !s.lastError) s.lastError = { at: r.failed_at ?? r.created_at, message: errorText(r) };
  }
  return out;
}

// ── Output profiles ─────────────────────────────────────────────────────────

export interface ProfileOverride extends Record<string, unknown> {
  recommendedMin?: number;
  recommendedMax?: number;
  characterLimit?: number;
}

export interface OutputProfile {
  key: string;
  label: string;
  policy: ChannelPolicy;
  provenance: ChannelProvenance | undefined;
  overridden: boolean;
  target: number | null;
}

export function outputProfile(key: string, override?: ProfileOverride | null): OutputProfile | null {
  const policy = resolveChannelPolicy(key, override ?? null);
  if (!policy) return null;
  return { key, label: policy.label, policy, provenance: provenanceFor(key), overridden: !!override && Object.keys(override).length > 0, target: policy.exactTotal ?? null };
}

export const OUTPUT_PROFILE_KEYS = ORDER;

export function validateProfileEdit(key: string, edit: { recommendedMin: number; recommendedMax: number; characterLimit: number }): Partial<Record<keyof typeof edit, string>> {
  const base = DEFAULT_CHANNEL_POLICIES.find((p) => p.key === key);
  const e: Partial<Record<keyof typeof edit, string>> = {};
  for (const k of ["recommendedMin", "recommendedMax", "characterLimit"] as const) {
    if (!Number.isInteger(edit[k]) || edit[k] < 0) e[k] = "Enter a whole number of characters.";
  }
  if (!e.recommendedMax && !e.recommendedMin && edit.recommendedMax < edit.recommendedMin) e.recommendedMax = "The maximum cannot be below the minimum.";
  if (!e.characterLimit && base && edit.characterLimit > base.characterLimit) e.characterLimit = `The limit can be tightened but not raised past ${base.characterLimit.toLocaleString("en-US")}.`;
  if (!e.characterLimit && !e.recommendedMax && edit.recommendedMax > edit.characterLimit) e.recommendedMax = "The readable maximum cannot exceed the hard limit.";
  return e;
}

// ── Sample output and counts ────────────────────────────────────────────────

export interface SampleResult {
  ok: boolean;
  text: string | null;
  counts: TextCounts | null;
  findings: PolicyFinding[];
  blocker: { code: string; message: string } | null;
  parts: { narrative: number; cta: number; disclosure: number } | null;
  dropped: number;
}

const cp = (t: string) => [...t].length;

/**
 * Builds the draft output for one destination from a narrative and the draft CTA and required wording. vAuto goes
 * through the same exact-fit function the export uses, so its count is the delivered count. Other destinations are
 * joined with blank lines and checked by the same channel policy check.
 */
export function buildSample(profile: OutputProfile, narrative: string, draft: Pick<DescriptionDraft, "cta_template" | "required_legal_text" | "prohibited_phrases">): SampleResult {
  const p = profile.policy;
  const cta = draft.cta_template.trim();
  const legal = draft.required_legal_text.trim();
  const merged: ChannelPolicy = { ...p, prohibitedPhrases: [...new Set([...p.prohibitedPhrases, ...draft.prohibited_phrases.filter((x) => x.trim())])] };
  if (p.exactTotal) {
    const fit = fitNarrativeExact({
      narrative,
      cta: cta || null,
      disclosure: { text: legal, version: "draft", approved: true },
      profile: { exactTotal: p.exactTotal, localMax: p.characterLimit, singleLine: p.singleLine, asciiOnly: p.asciiOnly, prohibitedPhrases: merged.prohibitedPhrases },
    });
    if (!fit.ok || !fit.text) {
      return { ok: false, text: null, counts: null, findings: [], blocker: { code: fit.code ?? "EXACT_FIT_FAILED", message: fit.message ?? "The output could not be fitted." }, parts: null, dropped: 0 };
    }
    const findings = checkChannelPolicy(fit.text, merged);
    return { ok: !findings.some((f) => f.severity === "blocking"), text: fit.text, counts: countText(fit.text), findings, blocker: null, parts: { narrative: cp(fit.text) - cp(cta) - cp(legal) - (cta ? 1 : 0) - (legal ? 1 : 0), cta: cp(cta), disclosure: cp(legal) }, dropped: Number(fit.meta.sentencesDropped ?? 0) };
  }
  try {
    const room = Math.max(0, p.recommendedMax - cp(cta) - cp(legal) - 4);
    const kept: string[] = [];
    let used = 0;
    for (const sentence of splitSentences(narrative)) {
      if (used + cp(sentence) + 1 > room) break;
      kept.push(sentence);
      used += cp(sentence) + 1;
    }
    const body = kept.join(" ");
    const joined = [body, cta, legal].filter(Boolean).join("\n\n");
    const text = wireText(joined, { singleLine: p.singleLine, asciiOnly: p.asciiOnly });
    const findings = checkChannelPolicy(text, merged);
    return { ok: !findings.some((f) => f.severity === "blocking"), text, counts: countText(text), findings, blocker: null, parts: { narrative: cp(body), cta: cp(cta), disclosure: cp(legal) }, dropped: 0 };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { ok: false, text: null, counts: null, findings: [], blocker: { code: e.code ?? "INVALID_TEXT", message: e.message ?? "The text cannot be counted." }, parts: null, dropped: 0 };
  }
}

export const FINDING_FIX: Record<string, string> = {
  CHANNEL_PROHIBITED_PHRASE: "Remove the phrase from the call to action or required wording, or take it off the prohibited list.",
  CHANNEL_DISCLOSURE_MISSING: "Add the required wording in Brand voice.",
  EXACT_LENGTH_MISMATCH: "The exact-fit step could not land on the target. Request more approved sentences or hold the vehicle for review.",
  NON_ASCII_REVIEW: "Replace the non-ASCII characters in the call to action or required wording.",
  CHANNEL_LENGTH_EXCEEDED: "Shorten the call to action or required wording, or tighten the output profile.",
  CHANNEL_PRICE_NOT_ALLOWED: "This destination shows its own price. Turn off price in description or remove it from the copy.",
  CTA_MISSING: "Add a call to action in Brand voice.",
  LENGTH_BELOW_MINIMUM: "The copy is shorter than the readable minimum. Do not pad it; add real vehicle detail.",
};

export const CLAIMS = [
  { key: "cpo_language_allowed", label: "CPO language", help: "May describe the vehicle as certified.", needs: "An approved CPO program record for that vehicle.", off: "Copy never uses certified or CPO wording." },
  { key: "warranty_language_allowed", label: "Warranty language", help: "May mention remaining factory coverage.", needs: "Verified remaining coverage on the vehicle.", off: "Copy never mentions warranty coverage." },
  { key: "accessory_language_allowed", label: "Accessory language", help: "May name dealer-installed accessories.", needs: "Installation proof for each accessory.", off: "Copy names only factory equipment." },
  { key: "price_in_description", label: "Price in description", help: "May state the governed advertised price.", needs: "A governed price for the vehicle. Marketplaces that show their own price still refuse it.", off: "No price appears in the copy." },
  { key: "market_context_allowed", label: "Market context wording", help: "May let market analysis shape emphasis.", needs: "Market data. It is never stated as a verified fact about the vehicle.", off: "Market analysis does not influence the copy." },
] as const;
