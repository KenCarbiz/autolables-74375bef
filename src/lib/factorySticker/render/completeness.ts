// Rendered-content completeness.
//
// The layout engine solves for fit. Anything that solves for fit can, in
// principle, lose content — a truncated option name, a package member
// that did not survive a retry, a regulatory line squeezed out by a
// fuller panel. None of that is acceptable on a document that states what
// a buyer is being charged for.
//
// So fit is not trusted. This module builds a manifest of everything the
// document is REQUIRED to print, compares it against what the renderer
// actually drew, and reports what is missing. The orchestrator treats a
// non-empty result as a blocker: the document does not publish.

import type { FactoryStickerRenderData } from "./contract.ts";
import type { LayoutModel } from "./layout.ts";

export type ManifestCategory =
  | "identity"
  | "pricing"
  | "option"
  | "package_member"
  | "regulatory"
  | "disclosure";

export interface ManifestItem {
  category: ManifestCategory;
  /** Human label for the dealer-facing blocker list. */
  label: string;
  /** Exact text that must appear somewhere in the rendered document. */
  expected: string;
}

export interface CompletenessReport {
  pass: boolean;
  code: "OK" | "LAYOUT_OVERFLOW" | "PDF_VALIDATION_FAILED";
  missing: ManifestItem[];
  /** Items that must appear exactly once and did not. */
  miscounted: Array<{ label: string; expected: string; expectedCount: number; actualCount: number }>;
  checked: number;
}

const money = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Everything this document must print. Derived from the same immutable
 * render data the PDF is realized from, so the manifest can never drift
 * from what was supposed to be on the page.
 */
export function buildContentManifest(data: FactoryStickerRenderData): ManifestItem[] {
  const items: ManifestItem[] = [];
  const push = (category: ManifestCategory, label: string, expected: string | null | undefined) => {
    const value = clean(String(expected ?? ""));
    if (value) items.push({ category, label, expected: value });
  };

  push("identity", "VIN", data.vin);
  push("identity", "Model year", data.identity.year);
  push("identity", "Make", data.identity.make.toUpperCase());
  push("identity", "Model", data.identity.model.toUpperCase());

  if (data.pricing.baseMsrp !== null) {
    push("pricing", "Base MSRP", `$${money(data.pricing.baseMsrp)}`);
  }
  if (data.pricing.totalMsrp !== null) {
    push("pricing", "Total MSRP", `$${money(data.pricing.totalMsrp)}`);
  }

  for (const opt of data.options) {
    push("option", `Option ${opt.code ?? opt.name}`, opt.name);
    if (opt.code) push("option", `Option code ${opt.code}`, opt.code);
    // Every member of a priced package prints. A package the buyer pays
    // for cannot hide half its contents.
    for (const member of opt.contents ?? []) {
      push("package_member", `${opt.name} — ${member}`, member);
    }
  }
  for (const pkg of data.packages) {
    push("option", `Package ${pkg.code ?? pkg.name}`, pkg.name);
    for (const member of pkg.contents ?? []) {
      push("package_member", `${pkg.name} — ${member}`, member);
    }
  }

  for (const row of data.partsContent ?? []) {
    push("regulatory", `Parts content — ${row.label}`, row.value.toUpperCase());
  }
  if (data.disclaimers?.length) {
    push("disclosure", "Reproduction disclosure", data.disclaimers[0]);
  }

  return items;
}

/**
 * Items that must appear EXACTLY once. A package priced twice is a
 * pricing defect, not a layout one, and is caught here rather than by a
 * reader noticing the total does not add up.
 */
export function buildSingletonExpectations(
  data: FactoryStickerRenderData,
): Array<{ label: string; expected: string; expectedCount: number }> {
  const out: Array<{ label: string; expected: string; expectedCount: number }> = [];
  const priced = data.options.filter((o) => (o.contents?.length ?? 0) > 0 && o.msrp !== null && o.msrp > 0);
  for (const pkg of priced) {
    // The package's own price line, and the same amount wherever else the
    // document legitimately repeats it (rollups, destination). Counting
    // occurrences of the bare amount would be ambiguous, so the check is
    // scoped to the package NAME, which must appear once.
    out.push({ label: `Package ${pkg.name} listed once`, expected: clean(pkg.name), expectedCount: 1 });
  }
  return out;
}

/**
 * Compare the manifest against what the renderer drew, across every page
 * including a continuation page — content moved to page 2 is present, not
 * missing.
 */
export function checkRenderedCompleteness(
  data: FactoryStickerRenderData,
  model: LayoutModel,
): CompletenessReport {
  const drawn = model.drawnStrings.map(clean);
  const haystack = drawn.join(" ");
  const manifest = buildContentManifest(data);

  const missing = manifest.filter((item) => {
    if (drawn.includes(item.expected)) return false;
    // Some values are drawn as part of a composed line (a leader row, a
    // spec cell), so a substring hit is a legitimate presence.
    return !haystack.includes(item.expected);
  });

  const miscounted: CompletenessReport["miscounted"] = [];
  for (const expectation of buildSingletonExpectations(data)) {
    const actualCount = drawn.filter((s) => s === expectation.expected).length;
    if (actualCount !== expectation.expectedCount) {
      miscounted.push({ ...expectation, actualCount });
    }
  }

  const pass = missing.length === 0 && miscounted.length === 0;
  return {
    pass,
    // Missing content is a fit failure; a duplicated package is a
    // document-integrity failure. They get different codes so the dealer
    // sees which one they are looking at.
    code: pass ? "OK" : missing.length ? "LAYOUT_OVERFLOW" : "PDF_VALIDATION_FAILED",
    missing,
    miscounted,
    checked: manifest.length,
  };
}
