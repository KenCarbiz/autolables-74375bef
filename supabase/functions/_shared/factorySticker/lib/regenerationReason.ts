// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/regenerationReason.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Small browser prompt to collect a regeneration reason before invoking
// factory-sticker-orchestrate with action=regenerate. The edge function
// requires reason_code (and reason_notes when "other").

export const REGENERATION_REASONS = [
  "vehicle_information_corrected",
  "additional_source_data_available",
  "options_or_packages_corrected",
  "msrp_corrected",
  "wrong_template_selected",
  "pdf_or_layout_problem",
  "qr_or_passport_link_changed",
  "other",
] as const;

export type RegenerationReasonCode = (typeof REGENERATION_REASONS)[number];

export type RegenerationReason = {
  reason_code: RegenerationReasonCode;
  reason_notes: string | null;
};

const LABELS: Record<RegenerationReasonCode, string> = {
  vehicle_information_corrected: "Vehicle information corrected",
  additional_source_data_available: "Additional source data available",
  options_or_packages_corrected: "Options or packages corrected",
  msrp_corrected: "MSRP corrected",
  wrong_template_selected: "Wrong template selected",
  pdf_or_layout_problem: "PDF or layout problem",
  qr_or_passport_link_changed: "QR or passport link changed",
  other: "Other",
};

export function promptRegenerationReason(): RegenerationReason | null {
  if (typeof window === "undefined") return null;
  const menu = REGENERATION_REASONS.map((code, i) => `${i + 1}. ${LABELS[code]}`).join("\n");
  const raw = window.prompt(
    `Why are you regenerating this factory sticker?\n\n${menu}\n\nEnter a number 1-${REGENERATION_REASONS.length}:`,
    "1",
  );
  if (raw === null) return null;
  const idx = Number.parseInt(raw.trim(), 10) - 1;
  if (!Number.isFinite(idx) || idx < 0 || idx >= REGENERATION_REASONS.length) return null;
  const code = REGENERATION_REASONS[idx];
  let notes: string | null = null;
  if (code === "other") {
    notes = (window.prompt("Please describe the reason (required):", "") || "").trim() || null;
    if (!notes) return null;
  }
  return { reason_code: code, reason_notes: notes };
}
