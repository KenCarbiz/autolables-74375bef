// ──────────────────────────────────────────────────────────────────────
// Official government form registry — the LOCKED MASTERS.
//
// The FTC Buyers Guide (16 CFR 455) and Connecticut K-208 are official
// compliance forms. We never redraw them; we treat the approved PDF as an
// immutable master and populate approved coordinates deterministically
// (see supabase/functions/generate-vehicle-forms). This registry pins each
// master's SHA-256 + byte size so any change to the government artwork fails
// the build (officialTemplates.test.ts) and must be a deliberate re-approval.
//
// Templates live in /public/forms and are fetched by the fill engine at
// generation time. The coordinate maps that place values onto each master
// live alongside the fill code in the edge function.
// ──────────────────────────────────────────────────────────────────────

export interface OfficialTemplate {
  /** Path under /public — the served URL the fill engine fetches. */
  file: string;
  /** Human name for dealer-facing UI / audit records. */
  name: string;
  /** Government form identifier. */
  formId: string;
  /** Locked-master SHA-256 (hex) of the exact approved PDF bytes. */
  sha256: string;
  /** Locked-master byte size. */
  bytes: number;
  /** Page count of the master (before variant page selection). */
  pages: number;
  /** How the master is filled: a fillable AcroForm, or a flat coordinate overlay. */
  fill: "acroform" | "overlay";
  /** Template version — bump only on a deliberate, re-approved master change. */
  templateVersion: string;
}

export const OFFICIAL_TEMPLATES: Record<string, OfficialTemplate> = {
  ftc_buyers_guide_en: {
    file: "forms/ftc-buyers-guide-en.pdf",
    name: "FTC Buyers Guide (English)",
    formId: "16 CFR 455 App. A",
    sha256: "532e7887b9e5180800952ad53cc75ac43c7d84e42b2fc318ef33ae2760dd9769",
    bytes: 222630,
    pages: 3,
    fill: "acroform",
    templateVersion: "2026.07.1",
  },
  ftc_buyers_guide_es: {
    file: "forms/ftc-buyers-guide-es.pdf",
    name: "FTC Buyers Guide (Spanish)",
    formId: "16 CFR 455 App. B",
    sha256: "04c56ea52392601b9fb594ae838b95e1b3ec2513db9967a5a7d5101ccd0d3aaa",
    bytes: 123103,
    pages: 3,
    fill: "overlay",
    templateVersion: "2026.07.1",
  },
  k208: {
    file: "forms/k208-inspection.pdf",
    name: "Connecticut K-208 Safety Inspection",
    formId: "CT DMV K-208",
    sha256: "95477857966141315778fc97714fe9020dc2af6adf1b8b2465268ab93274429c",
    bytes: 1329290,
    pages: 1,
    fill: "acroform",
    templateVersion: "2026.07.1",
  },
};
