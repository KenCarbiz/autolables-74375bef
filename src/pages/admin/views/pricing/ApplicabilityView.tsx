import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { useTenant } from "@/contexts/TenantContext";
import { useProductRules, type ProductRule } from "@/hooks/useProductRules";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { AdminButton, AdminCard, AdminLinkButton, EmptyState, StatusChip } from "@/components/admin/v2/primitives";
import { tenantIdOf, useAdminProducts, type AdminProduct } from "./pricingData";
import { AdminInput, AdminSelect, Field } from "./ui";

// Applicability: which vehicles each product applies to. Products without a
// rule apply everywhere; a product with rules appears only when a vehicle
// matches at least one. The per-product child page edits the common
// condition, mileage and model-year limits; this editor holds the full rule.

export interface ApplicabilityFixture {
  products: AdminProduct[];
  rules: ProductRule[];
}

type RuleDraft = Partial<ProductRule> & { _new?: boolean };

const EMPTY_RULE: Omit<ProductRule, "id"> = {
  product_id: "",
  year_min: "",
  year_max: "",
  makes: [],
  models: [],
  trims: [],
  body_styles: [],
  condition: "all",
  mileage_max: 0,
};

const describeRule = (r: ProductRule): string[] => {
  const parts: string[] = [];
  if (r.year_min || r.year_max) parts.push(`${r.year_min || "Any"} to ${r.year_max || "Any"}`);
  if (r.makes.length) parts.push(r.makes.join(", "));
  if (r.models.length) parts.push(r.models.join(", "));
  if (r.trims.length) parts.push(`Trims: ${r.trims.join(", ")}`);
  if (r.body_styles.length) parts.push(`Body: ${r.body_styles.join(", ")}`);
  if (r.condition !== "all") parts.push(r.condition === "new" ? "New only" : "Used only");
  if (r.mileage_max > 0) parts.push(`Up to ${r.mileage_max.toLocaleString()} mi`);
  return parts.length ? parts : ["Every vehicle"];
};

const list = (v: string): string[] => v.split(",").map((s) => s.trim()).filter(Boolean);

function RuleEditorModal({ draft, products, onChange, onSave, onCancel }: { draft: RuleDraft; products: AdminProduct[]; onChange: (d: RuleDraft) => void; onSave: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const set = (patch: RuleDraft) => onChange({ ...draft, ...patch });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A33]/55 p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="rule-editor-title" tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[12px] border border-adm-border bg-adm-surface p-6 space-y-3 shadow-2xl outline-none">
        <h2 id="rule-editor-title" className="text-[18px] leading-[26px] font-semibold text-adm-ink">{draft._new ? "Add rule" : "Edit rule"}</h2>
        <Field label="Product" htmlFor="rule-product">
          <AdminSelect id="rule-product" value={draft.product_id || ""} onChange={(e) => set({ product_id: e.target.value })}>
            <option value="">Select product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.badge_type})</option>
            ))}
          </AdminSelect>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year from" htmlFor="rule-year-min"><AdminInput id="rule-year-min" value={draft.year_min || ""} onChange={(e) => set({ year_min: e.target.value })} placeholder="2020" /></Field>
          <Field label="Year to" htmlFor="rule-year-max"><AdminInput id="rule-year-max" value={draft.year_max || ""} onChange={(e) => set({ year_max: e.target.value })} placeholder="2026" /></Field>
        </div>
        <Field label="Makes (comma-separated, blank for all)" htmlFor="rule-makes"><AdminInput id="rule-makes" value={draft.makes?.join(", ") || ""} onChange={(e) => set({ makes: list(e.target.value) })} /></Field>
        <Field label="Models (comma-separated, blank for all)" htmlFor="rule-models"><AdminInput id="rule-models" value={draft.models?.join(", ") || ""} onChange={(e) => set({ models: list(e.target.value) })} /></Field>
        <Field label="Trims (comma-separated, blank for all)" htmlFor="rule-trims"><AdminInput id="rule-trims" value={draft.trims?.join(", ") || ""} onChange={(e) => set({ trims: list(e.target.value) })} /></Field>
        <Field label="Body styles (comma-separated, blank for all)" htmlFor="rule-body-styles"><AdminInput id="rule-body-styles" value={draft.body_styles?.join(", ") || ""} onChange={(e) => set({ body_styles: list(e.target.value) })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Condition" htmlFor="rule-condition">
            <AdminSelect id="rule-condition" value={draft.condition || "all"} onChange={(e) => set({ condition: e.target.value as ProductRule["condition"] })}>
              <option value="all">All</option>
              <option value="new">New only</option>
              <option value="used">Used only</option>
            </AdminSelect>
          </Field>
          <Field label="Maximum mileage (0 for no limit)" htmlFor="rule-mileage-max"><AdminInput id="rule-mileage-max" type="number" min={0} value={draft.mileage_max || 0} onChange={(e) => set({ mileage_max: parseInt(e.target.value) || 0 })} /></Field>
        </div>
        <div className="flex gap-2 pt-2">
          <AdminButton className="flex-1" onClick={onCancel}>Cancel</AdminButton>
          <AdminButton className="flex-1" variant="primary" onClick={onSave}>Save rule</AdminButton>
        </div>
      </div>
    </div>
  );
}

export default function ApplicabilityView() {
  const fixture = useViewFixture<ApplicabilityFixture>("applicability");
  const { user } = useAuth();
  const audit = useAudit();
  const { tenant } = useTenant();
  const tenantId = tenantIdOf(tenant);
  const productsQuery = useAdminProducts(!fixture);
  const { rules: liveRules, loading: rulesLoading, addRule, updateRule, deleteRule } = useProductRules();
  const products = useMemo(() => fixture?.products ?? productsQuery.data ?? [], [fixture, productsQuery.data]);
  const rules = fixture?.rules ?? liveRules;
  const [draft, setDraft] = useState<RuleDraft | null>(null);

  const byProduct = useMemo(() => {
    const map = new Map<string, ProductRule[]>();
    for (const r of rules) map.set(r.product_id, [...(map.get(r.product_id) ?? []), r]);
    return map;
  }, [rules]);

  const logRule = (action: "rule_added" | "rule_updated" | "rule_deleted", id: string, details: Record<string, unknown>) => {
    audit.log({ store_id: tenantId ?? "", user_id: user?.id ?? "", action, entity_type: "product_rule", entity_id: id, details });
  };

  const saveRule = async () => {
    if (!draft?.product_id) { toast.error("Select a product."); return; }
    const { _new, id, ...rest } = draft;
    const payload: Omit<ProductRule, "id"> = { ...EMPTY_RULE, ...rest, product_id: draft.product_id };
    try {
      if (_new || !id) {
        const created = await addRule(payload);
        logRule("rule_added", created.id, { product_id: payload.product_id, condition: payload.condition, mileage_max: payload.mileage_max });
        toast.success("Rule added");
      } else {
        await updateRule(id, payload);
        logRule("rule_updated", id, { product_id: payload.product_id, condition: payload.condition, mileage_max: payload.mileage_max });
        toast.success("Rule updated");
      }
      setDraft(null);
    } catch (e) {
      // The draft stays open so nothing typed is lost.
      toast.error(e instanceof Error ? e.message : "The rule could not be saved.");
    }
  };

  const removeRule = async (r: ProductRule) => {
    if (!window.confirm("Delete this rule?")) return;
    try {
      await deleteRule(r.id);
      logRule("rule_deleted", r.id, { product_id: r.product_id });
      toast.success("Rule deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The rule could not be deleted.");
    }
  };

  const loading = !fixture && (productsQuery.isLoading || rulesLoading);
  const failed = !fixture && productsQuery.isError;

  return (
    <div className="space-y-4">
      <AdminCard
        title="Rules-based product assignment"
        description="Products without rules always appear. Products with rules appear only when a vehicle matches at least one rule."
        action={<AdminButton variant="primary" size="sm" onClick={() => setDraft({ ...EMPTY_RULE, _new: true })} disabled={products.length === 0}>Add rule</AdminButton>}
        flush
      >
        {loading ? (
          <p className="px-6 pb-6 text-[13px] text-adm-muted">Loading rules…</p>
        ) : failed ? (
          <p role="status" className="px-6 pb-6 text-[13px] text-adm-muted">Products could not be read, so applicability is Unknown.</p>
        ) : products.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState compact title="No products to assign" detail="Add products first; applicability rules attach to a product." />
          </div>
        ) : (
          <ul className="divide-y divide-adm-border">
            {products.map((p) => {
              const productRules = byProduct.get(p.id) ?? [];
              return (
                <li key={p.id} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[14px] font-semibold text-adm-ink">
                        {p.name}
                        <StatusChip tone={p.badge_type === "installed" ? "info" : "warning"}>{p.badge_type === "installed" ? "Installed" : "Optional"}</StatusChip>
                      </p>
                      <p className="text-[12px] leading-[18px] text-adm-muted">{productRules.length === 0 ? "Applies to every vehicle." : `${productRules.length} ${productRules.length === 1 ? "rule" : "rules"}`}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <AdminLinkButton size="sm" to={ADMIN_CHILD_ROUTES.productApplicability(p.id)}>Open applicability</AdminLinkButton>
                      <AdminButton size="sm" onClick={() => setDraft({ ...EMPTY_RULE, product_id: p.id, _new: true })}>Add rule</AdminButton>
                    </div>
                  </div>
                  {productRules.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {productRules.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-adm-border px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {describeRule(r).map((part) => (
                              <StatusChip key={part} tone="neutral">{part}</StatusChip>
                            ))}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <AdminButton size="sm" onClick={() => setDraft({ ...r })}>Edit</AdminButton>
                            <AdminButton size="sm" variant="danger" onClick={() => removeRule(r)}>Delete</AdminButton>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>

      {draft && <RuleEditorModal draft={draft} products={products} onChange={setDraft} onSave={saveRule} onCancel={() => setDraft(null)} />}
    </div>
  );
}
