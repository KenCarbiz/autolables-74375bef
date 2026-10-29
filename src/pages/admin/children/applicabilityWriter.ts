import type { ProductRule } from "@/hooks/useProductRules";
import type { PriceTreatment } from "@/lib/admin/pricing/productApplicability";

// Every write the product applicability page makes goes through one adapter:
// the rule update or insert, the product's price treatment, and the audit
// entry. Under a design fixture the page gets the preview adapter, which
// refuses each of them before any client is called, so a fixture can never
// reach real data whatever the buttons do.

export const PREVIEW_ONLY = "Preview only — changes are not saved.";

export class PreviewOnlyError extends Error {
  constructor() {
    super(PREVIEW_ONLY);
    this.name = "PreviewOnlyError";
  }
}

type RulePatch = Pick<ProductRule, "condition" | "mileage_max" | "year_min" | "year_max">;

export interface ApplicabilityWriter {
  /** True for the design-fixture adapter; every method then rejects. */
  readonly preview: boolean;
  updateRule(id: string, patch: RulePatch): Promise<void>;
  addRule(rule: Omit<ProductRule, "id">): Promise<{ id: string }>;
  updateTreatment(productId: string, treatment: PriceTreatment, price: number): Promise<void>;
  audit(entry: Record<string, unknown>): void;
}

export interface LiveWriterDeps {
  updateRule: (id: string, patch: Partial<ProductRule>) => Promise<unknown>;
  addRule: (rule: Omit<ProductRule, "id">) => Promise<{ id: string } | null | undefined>;
  updateProduct: (productId: string, values: { badge_type: string; price_label: string; price: number }) => Promise<{ error: { message: string } | null }>;
  audit: (entry: Record<string, unknown>) => void;
}

export const previewWriter: ApplicabilityWriter = {
  preview: true,
  updateRule: async () => { throw new PreviewOnlyError(); },
  addRule: async () => { throw new PreviewOnlyError(); },
  updateTreatment: async () => { throw new PreviewOnlyError(); },
  audit: () => { throw new PreviewOnlyError(); },
};

export function liveWriter(deps: LiveWriterDeps): ApplicabilityWriter {
  return {
    preview: false,
    updateRule: async (id, patch) => { await deps.updateRule(id, patch); },
    addRule: async (rule) => {
      const created = await deps.addRule(rule);
      if (!created) throw new Error("The rule could not be created.");
      return created;
    },
    updateTreatment: async (productId, treatment, price) => {
      const { error } = await deps.updateProduct(productId, { badge_type: treatment, price_label: treatment === "installed" ? "Included in Selling Price" : "If Accepted", price });
      if (error) throw new Error(error.message);
    },
    audit: (entry) => deps.audit(entry),
  };
}

export const applicabilityWriter = (fixtureMode: boolean, deps: LiveWriterDeps): ApplicabilityWriter => (fixtureMode ? previewWriter : liveWriter(deps));
