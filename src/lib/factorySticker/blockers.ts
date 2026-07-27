// Dealer-facing blockers.
//
// The pipeline records why it stopped as a terse code —
// "msrp_reconciliation: computed 53195 differs from stated 52700". That is
// the right thing to store and the wrong thing to show someone who has to
// fix it. This module turns the stored state into an actionable list: what
// field is affected, what the two values are, where each came from,
// whether a person is allowed to correct it, which permission that needs,
// and what the recommended resolution actually is.
//
// It invents nothing. Every field here is read from the record; when the
// pipeline did not record a detail, the blocker says so rather than
// guessing.

import type { WindowStickerPermission } from "../permissions/windowStickerPermissions.ts";

export type BlockerSeverity = "blocking" | "warning";

export interface StickerBlocker {
  code: string;
  title: string;
  severity: BlockerSeverity;
  /** The data point at fault, when the pipeline identified one. */
  affectedField: string | null;
  currentValue: string | null;
  /** The value that disagrees, or the note that a value is absent. */
  conflictingValue: string | null;
  source: string | null;
  retrievedAt: string | null;
  correctionPermitted: boolean;
  requiredPermission: WindowStickerPermission | null;
  recommendedResolution: string;
}

export interface BlockerInput {
  generationStatus?: string | null;
  reviewRequired?: boolean | null;
  reviewReason?: string | null;
  lastError?: string | null;
  reconciliationStatus?: string | null;
  reconciliationDifference?: number | null;
  sourceProvider?: string | null;
  sourceRetrievedAt?: string | null;
  /** factory_sticker_records.qa_metadata */
  qaMetadata?: Record<string, unknown> | null;
  /** True when the vehicle has no stored provider build sheet. */
  missingSourceData?: boolean;
}

const money = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

type QaShape = {
  completeness?: {
    code?: string;
    missing?: Array<{ label?: string; category?: string }>;
    miscounted?: Array<{ label?: string; actualCount?: number }>;
  };
  geometry?: { code?: string; reasons?: string[] };
  selection?: { status?: string; reasons?: string[]; confidence?: number };
  eligibility?: { status?: string; reasons?: string[]; blocker_code?: string };
  checks?: Record<string, boolean>;
};

export function buildStickerBlockers(input: BlockerInput): StickerBlocker[] {
  const qa = (input.qaMetadata || {}) as QaShape;
  const out: StickerBlocker[] = [];
  const source = input.sourceProvider ?? null;
  const retrievedAt = input.sourceRetrievedAt ?? null;

  // ── No provider data at all. Nothing downstream can be fixed by hand.
  if (input.missingSourceData) {
    out.push({
      code: "MISSING_SOURCE_DATA",
      title: "No factory build data for this VIN",
      severity: "blocking",
      affectedField: "Factory build sheet",
      currentValue: "not retrieved",
      conflictingValue: null,
      source, retrievedAt,
      correctionPermitted: false,
      requiredPermission: "window_sticker.refresh_neovin",
      recommendedResolution:
        "Retrieve the vehicle's equipment breakout from the provider. This decodes the VIN and may incur a provider charge.",
    });
  }

  // ── Eligibility: the document should not exist for this vehicle yet.
  const elig = qa.eligibility;
  if (elig?.status && elig.status !== "eligible_new" && elig.status !== "eligible_used_reproduction") {
    const condition = elig.status === "ineligible_condition_conflict";
    out.push({
      code: elig.blocker_code || elig.status.toUpperCase(),
      title: condition ? "Vehicle condition is unresolved" : "This vehicle is not eligible for an OEM sticker",
      severity: "blocking",
      affectedField: condition ? "Condition (new / used / CPO)" : "Eligibility",
      currentValue: elig.status,
      conflictingValue: (elig.reasons ?? []).join("; ") || null,
      source: "vehicle record", retrievedAt: null,
      correctionPermitted: condition,
      requiredPermission: condition ? "window_sticker.edit_permitted_fields" : null,
      recommendedResolution: condition
        ? "Set the vehicle's condition on the Vehicle File so the correct documents apply, then regenerate."
        : "Turn manufacturer-style records back on for this inventory type in Admin, or leave this vehicle without an OEM reproduction.",
    });
  }

  // ── Template selection.
  const sel = qa.selection;
  if (sel?.status && sel.status !== "selected") {
    const conflict = sel.status === "conflict";
    out.push({
      code: conflict ? "OEM_TEMPLATE_CONFLICT" : `OEM_TEMPLATE_${String(sel.status).toUpperCase()}`,
      title: conflict
        ? "Trusted sources disagree on the manufacturer"
        : sel.status === "unsupported"
          ? "No OEM template for this manufacturer"
          : "Manufacturer needs confirmation",
      severity: "blocking",
      affectedField: "Make",
      currentValue: typeof sel.confidence === "number" ? `confidence ${Math.round(sel.confidence * 100)}%` : null,
      conflictingValue: (sel.reasons ?? []).join("; ") || null,
      source: "vehicle record", retrievedAt: null,
      // The canonical make governs: an operator may pick the vehicle's own
      // brand template or the neutral one, never another manufacturer's.
      correctionPermitted: true,
      requiredPermission: "window_sticker.edit_permitted_fields",
      recommendedResolution: conflict
        ? "Correct the vehicle's make on the Vehicle File so the sources agree, then regenerate."
        : "Confirm the manufacturer on the Vehicle File, or choose a compatible template below and regenerate.",
    });
  }

  // ── MSRP reconciliation.
  if (input.reconciliationStatus === "REVIEW_REQUIRED" || input.reconciliationStatus === "MINOR_VARIANCE") {
    const diff = input.reconciliationDifference;
    out.push({
      code: "OEM_PRICING_MISMATCH",
      title: "Manufacturer pricing does not reconcile",
      severity: input.reconciliationStatus === "REVIEW_REQUIRED" ? "blocking" : "warning",
      affectedField: "Total MSRP",
      currentValue: diff != null ? `off by ${money(diff)}` : null,
      conflictingValue: input.reviewReason ?? null,
      source, retrievedAt,
      correctionPermitted: true,
      requiredPermission: "window_sticker.override_source_data",
      recommendedResolution:
        "Base MSRP, options and destination must add to the stated total. Correct whichever figure is wrong at its source, then regenerate. The discrepancy is never printed on the customer document.",
    });
  }

  // ── Rendered-content completeness.
  const comp = qa.completeness;
  if (comp?.missing?.length) {
    out.push({
      code: comp.code || "LAYOUT_OVERFLOW",
      title: "The rendered document is missing required content",
      severity: "blocking",
      affectedField: comp.missing.map((m) => m.label).filter(Boolean).slice(0, 5).join(", ") || "document content",
      currentValue: `${comp.missing.length} item${comp.missing.length === 1 ? "" : "s"} not printed`,
      conflictingValue: null,
      source: "renderer", retrievedAt: null,
      correctionPermitted: false,
      requiredPermission: "window_sticker.regenerate",
      recommendedResolution:
        "The page could not hold everything the vehicle requires. Regenerate to re-solve the layout; if it recurs, shorten over-long equipment descriptions at the source.",
    });
  }
  if (comp?.miscounted?.length) {
    out.push({
      code: "PDF_VALIDATION_FAILED",
      title: "A package appears more than once",
      severity: "blocking",
      affectedField: comp.miscounted.map((m) => m.label).filter(Boolean).join(", ") || "package",
      currentValue: comp.miscounted.map((m) => `${m.actualCount}×`).join(", "),
      conflictingValue: "expected exactly once",
      source: "renderer", retrievedAt: null,
      correctionPermitted: true,
      requiredPermission: "window_sticker.edit_permitted_fields",
      recommendedResolution:
        "The same package is listed twice in the source data, which would double-price it. Remove the duplicate, then regenerate.",
    });
  }

  // ── Page geometry.
  if (qa.geometry?.code && qa.geometry.code !== "OK") {
    out.push({
      code: qa.geometry.code,
      title: qa.geometry.code === "LAYOUT_OVERFLOW" ? "Too many pages" : "Page does not match the template",
      severity: "blocking",
      affectedField: "Page geometry",
      currentValue: (qa.geometry.reasons ?? []).join("; ") || null,
      conflictingValue: null,
      source: "renderer", retrievedAt: null,
      correctionPermitted: false,
      requiredPermission: "window_sticker.regenerate",
      recommendedResolution: "Regenerate. If it recurs, the template's registered page format and the renderer disagree — report it.",
    });
  }

  // ── Identity QA.
  const checks = qa.checks || {};
  for (const [key, label, resolution] of [
    ["barcode_is_vin", "VIN barcode does not match the vehicle", "The barcode payload must equal the VIN exactly. Regenerate; if it recurs the VIN on the record is inconsistent."],
    ["qr_is_canonical_passport", "Passport QR does not point at this vehicle", "The QR must resolve to this vehicle's public passport URL. Confirm the vehicle has a published passport slug, then regenerate."],
    ["vin_drawn", "VIN is not printed on the document", "Regenerate. The VIN must appear on the face of the sticker."],
  ] as const) {
    if (checks[key] === false) {
      out.push({
        code: `QA_${key.toUpperCase()}`,
        title: label,
        severity: "blocking",
        affectedField: key === "qr_is_canonical_passport" ? "Passport URL" : "VIN",
        currentValue: "failed",
        conflictingValue: null,
        source: "renderer", retrievedAt: null,
        correctionPermitted: false,
        requiredPermission: "window_sticker.regenerate",
        recommendedResolution: resolution,
      });
    }
  }

  // ── Anything the pipeline flagged that this module has no specific
  // reading for. Surfaced verbatim rather than swallowed.
  if (!out.length && input.reviewRequired && input.reviewReason) {
    out.push({
      code: "REVIEW_REQUIRED",
      title: "This record needs review before publishing",
      severity: "blocking",
      affectedField: null,
      currentValue: input.reviewReason,
      conflictingValue: null,
      source: source ?? "pipeline", retrievedAt,
      correctionPermitted: false,
      requiredPermission: "window_sticker.approve",
      recommendedResolution: "Review the record and approve it, or regenerate if the underlying data changed.",
    });
  }

  return out;
}

export const hasBlockingIssue = (blockers: StickerBlocker[]): boolean =>
  blockers.some((b) => b.severity === "blocking");
