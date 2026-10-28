import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PRICE_BUCKETS } from "@/types/product";
import type { Product, ProductUpgrade } from "@/hooks/useProducts";
import { ProductIcon, PRODUCT_ICON_KEYS } from "@/components/addendum/productIcons";
import { AdminButton, StatusChip } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/admin/pricing/feePolicy";
import { AdminInput, AdminSelect, Field, inputClass } from "./ui";

// The product editor, moved from the legacy Administration page. Both
// disposition texts are stored; the Type marks the default and which benefit
// the compliance check requires. The customer view beside the form mirrors
// the addendum line so the dealer sees what is still missing while editing.

export type EditingProduct = Partial<Product & { icon_type?: string }>;

export const EMPTY_PRODUCT: EditingProduct = {
  name: "",
  subtitle: "",
  warranty: "",
  badge_type: "installed",
  price: 0,
  price_label: "Included in Selling Price",
  disclosure: "",
  sort_order: 0,
  is_active: true,
  benefit_justification: "",
  benefit_justification_optional: "",
  disclosure_optional: "",
  price_in_advertised: true,
  available_preinstalled: true,
  upgrade: null,
  contract_url: null,
  contract_doc_type: "contract",
  price_tiers: null,
  icon_type: "",
};

export const EMPTY_UPGRADE: ProductUpgrade = {
  name: "",
  price: 0,
  disclosure: "",
  benefit_justification: "",
  disclosure_optional: "",
  benefit_justification_optional: "",
  available_preinstalled: true,
};

const textareaClass = cn(inputClass, "h-auto min-h-[64px] py-2 resize-y");

export function ProductEditorModal({
  editing,
  onChange,
  onSave,
  onCancel,
  saving,
  uploadingDoc,
  onUploadDoc,
  showIcons,
}: {
  editing: EditingProduct;
  onChange: (next: EditingProduct) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  uploadingDoc: boolean;
  onUploadDoc: (file: File) => void;
  showIcons: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const set = (patch: EditingProduct) => onChange({ ...editing, ...patch });
  const installed = (editing.badge_type || "installed") === "installed";
  const upgrade = editing.upgrade ?? EMPTY_UPGRADE;
  const setUpgrade = (patch: Partial<ProductUpgrade>) => set({ upgrade: { ...upgrade, ...patch } });

  const openDocument = async () => {
    const url = editing.contract_url || "";
    if (/^https?:\/\//i.test(url)) { window.open(url, "_blank", "noopener,noreferrer"); return; }
    const { data, error } = await supabase.storage.from("product-docs").createSignedUrl(url, 3600);
    if (error || !data?.signedUrl) { toast.error(`Could not open document: ${error?.message || "unknown error"}`); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A33]/55 p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="product-editor-title" tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} className="w-full max-w-5xl max-h-[92vh] flex overflow-hidden rounded-[12px] border border-adm-border bg-adm-surface shadow-2xl outline-none">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            <h2 id="product-editor-title" className="text-[18px] leading-[26px] font-semibold text-adm-ink">{editing.id ? "Edit product" : "Add product"}</h2>
            <Field label="Product name" htmlFor="product-name"><AdminInput id="product-name" value={editing.name || ""} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Subtitle"><AdminInput value={editing.subtitle || ""} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
            <Field label="Warranty"><AdminInput value={editing.warranty || ""} onChange={(e) => set({ warranty: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price ($)"><AdminInput type="number" step="0.01" value={editing.price || 0} onChange={(e) => set({ price: parseFloat(e.target.value) || 0 })} /></Field>
              <Field label="Sort order"><AdminInput type="number" value={editing.sort_order || 0} onChange={(e) => set({ sort_order: parseInt(e.target.value) || 0 })} /></Field>
            </div>
            <div className="rounded-[10px] border border-adm-border p-3 space-y-2">
              <p className="text-[13px] font-semibold text-adm-ink">Vehicle-category pricing <span className="font-normal text-adm-muted">(optional)</span></p>
              <p className="text-[12px] leading-[18px] text-adm-muted">Set a price per vehicle size. Blank uses the base price. The addendum picks the bucket from the vehicle body class.</p>
              <div className="grid grid-cols-2 gap-2">
                {PRICE_BUCKETS.map((b) => (
                  <Field key={b.id} label={b.label}>
                    <AdminInput
                      type="number"
                      step="0.01"
                      value={editing.price_tiers?.[b.id] ?? ""}
                      placeholder={`Base ${fmtMoney(Number(editing.price) || 0)}`}
                      onChange={(e) => {
                        const next = { ...(editing.price_tiers || {}) };
                        const v = parseFloat(e.target.value);
                        if (!e.target.value || isNaN(v) || v <= 0) delete next[b.id];
                        else next[b.id] = v;
                        set({ price_tiers: Object.keys(next).length ? next : null });
                      }}
                    />
                  </Field>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <AdminSelect value={editing.badge_type || "installed"} onChange={(e) => set({ badge_type: e.target.value, price_label: e.target.value === "installed" ? "Included in Selling Price" : "If Accepted" })}>
                  <option value="installed">Pre-installed</option>
                  <option value="optional">Optional</option>
                </AdminSelect>
              </Field>
              {showIcons && (
                <Field label="Icon">
                  <div className="flex items-center gap-2">
                    {editing.icon_type && <span className="shrink-0 text-adm-muted"><ProductIcon type={editing.icon_type} className="w-5 h-5" /></span>}
                    <AdminSelect value={editing.icon_type || ""} onChange={(e) => set({ icon_type: e.target.value })}>
                      <option value="">No icon</option>
                      {PRODUCT_ICON_KEYS.map((key) => (
                        <option key={key} value={key}>{key.replace(/_/g, " ")}</option>
                      ))}
                    </AdminSelect>
                  </div>
                </Field>
              )}
            </div>
            <Field label="Price label"><AdminInput value={editing.price_label || ""} onChange={(e) => set({ price_label: e.target.value })} /></Field>

            <div className="space-y-3">
              <p className="text-[12px] leading-[18px] font-semibold text-adm-muted">Descriptions by how it is sold</p>
              <label className="flex items-start gap-2 cursor-pointer rounded-[10px] border border-adm-border p-2.5">
                <input type="checkbox" className="mt-0.5 accent-adm-primary" checked={!(editing.available_preinstalled ?? true)} onChange={(e) => set({ available_preinstalled: !e.target.checked, ...(e.target.checked ? { badge_type: "optional", price_label: "If Accepted" } : {}) })} />
                <span>
                  <span className="block text-[13px] font-semibold text-adm-ink">Not available for pre-install</span>
                  <span className="block text-[12px] leading-[18px] text-adm-muted">Sold only as a customer choice, never pre-installed. The pre-installed description is hidden and the addendum keeps this line optional.</span>
                </span>
              </label>

              {(editing.available_preinstalled ?? true) && (
                <div className={cn("rounded-[10px] border p-3 space-y-2.5", installed ? "border-adm-primary/50 bg-adm-selected" : "border-adm-border")}>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-adm-ink">Pre-installed <span className="font-normal text-adm-muted">already on the car, in the price</span></span>
                    {installed && <StatusChip tone="info">Default</StatusChip>}
                  </div>
                  <Field label="Disclosure"><textarea value={editing.disclosure || ""} onChange={(e) => set({ disclosure: e.target.value })} className={textareaClass} rows={2} placeholder="Pre-installed, non-removable; cost included in the selling price." /></Field>
                  <Field label={<span className="inline-flex items-center gap-1.5">Benefit justification {installed && <StatusChip tone="warning">Required</StatusChip>}</span>}>
                    <textarea value={editing.benefit_justification || ""} onChange={(e) => set({ benefit_justification: e.target.value })} className={textareaClass} rows={2} placeholder="This vehicle was treated before sale with... (why it benefits the buyer)" />
                  </Field>
                  <label className="flex items-start gap-2 cursor-pointer pt-0.5">
                    <input type="checkbox" className="mt-0.5 accent-adm-primary" checked={editing.price_in_advertised ?? true} onChange={(e) => set({ price_in_advertised: e.target.checked })} />
                    <span>
                      <span className="block text-[13px] font-semibold text-adm-ink">Price is included in the advertised price</span>
                      <span className="block text-[12px] leading-[18px] text-adm-muted">On: itemized for transparency, never charged again. Off: a dealer-installed upcharge above the advertised price that the customer confirms.</span>
                    </span>
                  </label>
                </div>
              )}

              <div className={cn("rounded-[10px] border p-3 space-y-2.5", !installed ? "border-adm-primary/50 bg-adm-selected" : "border-adm-border")}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-adm-ink">Optional <span className="font-normal text-adm-muted">customer adds at time of sale</span></span>
                  {!installed && <StatusChip tone="info">Default</StatusChip>}
                </div>
                <Field label="Disclosure"><textarea value={editing.disclosure_optional || ""} onChange={(e) => set({ disclosure_optional: e.target.value })} className={textareaClass} rows={2} placeholder="Optional: not required to buy or finance, does not affect your rate; itemized as an add-on." /></Field>
                <Field label={<span className="inline-flex items-center gap-1.5">Benefit justification {!installed && <StatusChip tone="warning">Required</StatusChip>}</span>}>
                  <textarea value={editing.benefit_justification_optional || ""} onChange={(e) => set({ benefit_justification_optional: e.target.value })} className={textareaClass} rows={2} placeholder="At the time of sale you chose to add... (why it benefits the buyer)" />
                </Field>
              </div>

              <p className="text-[12px] leading-[18px] text-adm-muted">Both sets are stored. The addendum shows the set matching how the line is sold on each deal; optional falls back to the pre-installed text when blank. The required benefit answers FTC Section 5 and CA SB 766 Section 11713.21.</p>

              <label className="flex items-start gap-2 cursor-pointer rounded-[10px] border border-adm-border p-2.5">
                <input type="checkbox" className="mt-0.5 accent-adm-primary" checked={!!editing.upgrade} onChange={(e) => set({ upgrade: e.target.checked ? (editing.upgrade ?? EMPTY_UPGRADE) : null })} />
                <span>
                  <span className="block text-[13px] font-semibold text-adm-ink">This product has an upgrade tier</span>
                  <span className="block text-[12px] leading-[18px] text-adm-muted">A higher level that includes the base product. On the addendum the dealer can apply it to a line, which swaps to this package price, disclosure and benefit.</span>
                </span>
              </label>

              {editing.upgrade && (
                <div className="rounded-[10px] border border-adm-warning/40 bg-adm-warning-bg/40 p-3 space-y-2.5">
                  <span className="text-[13px] font-semibold text-adm-ink">Upgrade tier</span>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Upgrade name"><AdminInput value={upgrade.name} onChange={(e) => setUpgrade({ name: e.target.value })} placeholder="Platinum Protection" /></Field>
                    <Field label="Package price ($)"><AdminInput type="number" step="0.01" value={upgrade.price} onChange={(e) => setUpgrade({ price: parseFloat(e.target.value) || 0 })} /></Field>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer rounded-[10px] border border-adm-border bg-adm-surface p-2.5">
                    <input type="checkbox" className="mt-0.5 accent-adm-primary" checked={!(upgrade.available_preinstalled ?? true)} onChange={(e) => setUpgrade({ available_preinstalled: !e.target.checked })} />
                    <span>
                      <span className="block text-[13px] font-semibold text-adm-ink">Not available for pre-install</span>
                      <span className="block text-[12px] leading-[18px] text-adm-muted">This upgrade is installed after delivery only. Applying it keeps the line optional even when the base product is pre-installed.</span>
                    </span>
                  </label>
                  {(editing.available_preinstalled ?? true) && (upgrade.available_preinstalled ?? true) && (
                    <div className="rounded-[10px] border border-adm-border bg-adm-surface p-3 space-y-2.5">
                      <span className="text-[13px] font-semibold text-adm-ink">Pre-installed <span className="font-normal text-adm-muted">(upgrade)</span></span>
                      <Field label="Disclosure"><textarea value={upgrade.disclosure} onChange={(e) => setUpgrade({ disclosure: e.target.value })} className={textareaClass} rows={2} /></Field>
                      <Field label="Benefit justification"><textarea value={upgrade.benefit_justification} onChange={(e) => setUpgrade({ benefit_justification: e.target.value })} className={textareaClass} rows={2} /></Field>
                    </div>
                  )}
                  <div className="rounded-[10px] border border-adm-border bg-adm-surface p-3 space-y-2.5">
                    <span className="text-[13px] font-semibold text-adm-ink">Optional <span className="font-normal text-adm-muted">(upgrade)</span></span>
                    <Field label="Disclosure"><textarea value={upgrade.disclosure_optional} onChange={(e) => setUpgrade({ disclosure_optional: e.target.value })} className={textareaClass} rows={2} /></Field>
                    <Field label="Benefit justification"><textarea value={upgrade.benefit_justification_optional} onChange={(e) => setUpgrade({ benefit_justification_optional: e.target.value })} className={textareaClass} rows={2} /></Field>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-[10px] border border-adm-warning/40 bg-adm-warning-bg/40 p-3 space-y-2">
              <span className="text-[13px] font-semibold text-adm-ink inline-flex items-center gap-1.5">Product document <StatusChip tone="warning">Required</StatusChip></span>
              <p className="text-[12px] leading-[18px] text-adm-muted">Attach the product contract, or the warranty card when there is no contract. It substantiates the benefit claims and rides with the signed packet.</p>
              <div className="flex items-center gap-4">
                <label className="text-[13px] font-semibold text-adm-ink inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="contract_doc_type" className="accent-adm-primary" checked={(editing.contract_doc_type || "contract") === "contract"} onChange={() => set({ contract_doc_type: "contract" })} /> Contract
                </label>
                <label className="text-[13px] font-semibold text-adm-ink inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="contract_doc_type" className="accent-adm-primary" checked={editing.contract_doc_type === "warranty"} onChange={() => set({ contract_doc_type: "warranty" })} /> Warranty card
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input type="file" accept="application/pdf,image/*" disabled={uploadingDoc} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadDoc(f); }} className="text-[12px]" aria-label="Product document" />
                {uploadingDoc && <span className="text-[12px] text-adm-muted">Uploading…</span>}
              </div>
              {editing.contract_url ? (
                <button type="button" onClick={openDocument} className="text-[13px] font-semibold text-adm-primary hover:underline text-left">
                  View attached {editing.contract_doc_type === "warranty" ? "warranty card" : "contract"}
                </button>
              ) : (
                <p className="text-[12px] font-semibold text-adm-danger">No document attached.</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-[13px] text-adm-ink">
              <input type="checkbox" className="accent-adm-primary" checked={editing.is_active ?? true} onChange={(e) => set({ is_active: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="flex gap-2 p-4 border-t border-adm-border bg-adm-workspace">
            <AdminButton className="flex-1" onClick={onCancel} disabled={saving}>Cancel</AdminButton>
            <AdminButton className="flex-1" variant="primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : editing.id ? "Save product" : "Add product"}</AdminButton>
          </div>
        </div>
        <ProductEditPreview editing={editing} />
      </div>
    </div>
  );
}

export const ProductEditPreview = ({ editing }: { editing: EditingProduct }) => {
  const installed = (editing.badge_type || "installed") === "installed";
  const disclosure = installed ? editing.disclosure || "" : editing.disclosure_optional || editing.disclosure || "";
  const benefit = installed ? editing.benefit_justification || "" : editing.benefit_justification_optional || editing.benefit_justification || "";
  const price = Number(editing.price) || 0;
  const inAdvertised = editing.price_in_advertised ?? true;

  const checks = [
    { label: "Pricing set", ok: price > 0 },
    { label: "Disclosure present", ok: !!(editing.disclosure || editing.disclosure_optional || "").trim() },
    { label: "Benefit justification present", ok: !!(editing.benefit_justification || editing.benefit_justification_optional || "").trim() },
    { label: "Contract or warranty attached", ok: !!editing.contract_url },
  ];
  const done = checks.filter((c) => c.ok).length;
  const score = Math.round((done / checks.length) * 100);
  const tone = score === 100 ? "success" : score >= 50 ? "warning" : "danger";

  return (
    <aside className="hidden lg:flex w-80 flex-shrink-0 flex-col border-l border-adm-border bg-adm-workspace overflow-y-auto" aria-label="Customer view">
      <div className="p-5 space-y-4">
        <div>
          <p className="text-[12px] leading-[18px] font-semibold text-adm-muted">Customer view</p>
          <p className="text-[12px] leading-[18px] text-adm-muted">How this item appears on the addendum.</p>
        </div>
        <div className="rounded-[10px] border border-adm-border bg-adm-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <StatusChip tone={installed ? "info" : "warning"}>{installed ? "Pre-installed" : "Optional"}</StatusChip>
            <span className="text-[14px] font-bold tabular-nums text-adm-ink">{fmtMoney(price)}</span>
          </div>
          <p className="mt-2 text-[14px] font-semibold text-adm-ink">{editing.name || "Product name"}</p>
          {editing.subtitle && <p className="text-[12px] text-adm-muted mt-0.5">{editing.subtitle}</p>}
          {editing.warranty && <p className="text-[12px] text-adm-muted mt-2">Warranty: {editing.warranty}</p>}
          <p className="text-[12px] text-adm-muted mt-2">{inAdvertised ? "Itemized; included in the advertised price." : "Dealer-installed upcharge above the advertised price."}</p>
          {disclosure ? <p className="text-[12px] text-adm-ink mt-3 whitespace-pre-wrap leading-snug">{disclosure}</p> : <p className="text-[12px] italic text-adm-muted mt-3">Disclosure will appear here.</p>}
          {benefit && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-adm-muted">Why this benefits you</p>
              <p className="text-[12px] text-adm-ink mt-1 whitespace-pre-wrap leading-snug">{benefit}</p>
            </div>
          )}
        </div>
        <div className={cn("rounded-[10px] border-2 p-4", tone === "success" ? "border-adm-success bg-adm-success-bg" : tone === "warning" ? "border-adm-warning/60 bg-adm-warning-bg" : "border-adm-danger/40 bg-adm-danger-bg")}>
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-adm-ink">{score === 100 ? "Readiness complete" : "Readiness"}</p>
            <span className={cn("text-[22px] font-bold tabular-nums", tone === "success" ? "text-adm-success" : tone === "warning" ? "text-adm-warning" : "text-adm-danger")}>{score}%</span>
          </div>
          <ul className="mt-3 space-y-2">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[12px]">
                {c.ok ? <CheckCircle2 className="w-4 h-4 text-adm-success flex-shrink-0" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 text-adm-warning flex-shrink-0" aria-hidden="true" />}
                <span className={c.ok ? "text-adm-ink" : "text-adm-muted"}>{c.label}</span>
              </li>
            ))}
          </ul>
          {score < 100 && <p className="text-[12px] text-adm-muted mt-3">Complete every item before this product is sale-ready.</p>}
        </div>
      </div>
    </aside>
  );
};
