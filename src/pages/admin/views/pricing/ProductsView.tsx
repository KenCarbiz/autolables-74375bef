import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useProductLibrary } from "@/hooks/useProductLibrary";
import type { ProductLibraryEntry } from "@/types/product";
import { ProductIcon } from "@/components/addendum/productIcons";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { fmtMoney } from "@/lib/admin/pricing/feePolicy";
import { AdminButton, AdminCard, AdminLinkButton, EmptyState, StatusChip } from "@/components/admin/v2/primitives";
import { ADMIN_PRODUCTS_KEY, tenantIdOf, useAdminProducts, type AdminProduct } from "./pricingData";
import { EMPTY_PRODUCT, ProductEditorModal, type EditingProduct } from "./ProductEditorModal";

// Products: the dealer's live catalog plus the template library. Writes go to
// the products table exactly as before (the single existing writer); every
// write refreshes the shared products query the addendum builders read.

export interface ProductsFixture {
  products: AdminProduct[];
  library: ProductLibraryEntry[];
}

const readIconMap = (key: string): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
};

export default function ProductsView() {
  const fixture = useViewFixture<ProductsFixture>("products");
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { user } = useAuth();
  const audit = useAudit();
  const { tenant, currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenantIdOf(tenant);
  const productsQuery = useAdminProducts(!fixture);
  const products = useMemo(() => fixture?.products ?? productsQuery.data ?? [], [fixture, productsQuery.data]);
  const { library } = useProductLibrary(currentStore?.id || "");
  const libraryEntries = fixture?.library ?? library;

  const [showLibrary, setShowLibrary] = useState(false);
  const [editing, setEditing] = useState<EditingProduct | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const productIconKey = `product_icons:${tenant?.id || "none"}`;
  const iconMap = useMemo(() => readIconMap(productIconKey), [productIconKey, products]);

  useEffect(() => {
    const id = params.get("product");
    if (!id || editing || products.length === 0) return;
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setEditing({ ...p, icon_type: iconMap[p.id] || "" });
    const next = new URLSearchParams(params);
    next.delete("product");
    next.delete("focus");
    setParams(next, { replace: true });
  }, [params, products, editing, iconMap, setParams]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ADMIN_PRODUCTS_KEY });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const logProduct = (action: "product_added" | "product_updated" | "product_deleted" | "product_sale_mode_changed", id: string, details: Record<string, unknown>) => {
    audit.log({ store_id: tenantId ?? "", user_id: user?.id ?? "", action, entity_type: "product", entity_id: id, details });
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name) { toast.error("Enter a product name."); return; }
    if (!editing.contract_url) toast.warning("Saved without a product document. Attach the contract or warranty card when you can; it substantiates the benefit claims.");
    const payload = {
      name: editing.name,
      subtitle: editing.subtitle || null,
      warranty: editing.warranty || null,
      badge_type: editing.badge_type || "installed",
      price: Number(editing.price) || 0,
      price_label: editing.price_label || "Included in Selling Price",
      disclosure: editing.disclosure || null,
      sort_order: Number(editing.sort_order) || 0,
      is_active: editing.is_active ?? true,
      benefit_justification: editing.benefit_justification || "",
      benefit_justification_optional: editing.benefit_justification_optional || null,
      disclosure_optional: editing.disclosure_optional || null,
      price_in_advertised: editing.price_in_advertised ?? true,
      available_preinstalled: editing.available_preinstalled ?? true,
      upgrade: (editing.upgrade && editing.upgrade.name?.trim() ? editing.upgrade : null) as unknown as Json,
      contract_url: editing.contract_url || null,
      contract_doc_type: editing.contract_doc_type || null,
      price_tiers: (editing.price_tiers && Object.keys(editing.price_tiers).length ? editing.price_tiers : null) as unknown as Json,
    };
    setSaving(true);
    try {
      if (editing.id) {
        const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
        if (error) throw new Error(error.message);
        logProduct("product_updated", editing.id, { name: payload.name, badge_type: payload.badge_type, price: payload.price });
        toast.success("Product updated");
      } else {
        const { error } = await supabase.from("products").insert({ ...payload, tenant_id: tenant?.id ?? null } as typeof payload);
        if (error) throw new Error(error.message);
        logProduct("product_added", "pending", { name: payload.name, badge_type: payload.badge_type, price: payload.price });
        toast.success("Product added");
      }
      if (editing.icon_type) {
        const map = readIconMap(productIconKey);
        map[editing.id || "pending"] = editing.icon_type;
        localStorage.setItem(productIconKey, JSON.stringify(map));
      }
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The product could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: AdminProduct) => {
    if (!window.confirm(`Delete ${p.name}?`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    logProduct("product_deleted", p.id, { name: p.name });
    toast.success("Product deleted");
    refresh();
  };

  const toggleType = async (p: AdminProduct) => {
    const next = p.badge_type === "installed" ? "optional" : "installed";
    const priceLabel = next === "installed" ? "Included in Selling Price" : "If Accepted";
    const { error } = await supabase.from("products").update({ badge_type: next, price_label: priceLabel }).eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    logProduct("product_sale_mode_changed", p.id, { from: p.badge_type, to: next });
    toast.success(`${p.name} marked as ${next}`);
    refresh();
  };

  const uploadDoc = async (file: File) => {
    const scope = tenant?.id || currentStore?.id;
    if (!scope) { toast.error("No dealership context found. Reload the page and try again."); return; }
    setUploadingDoc(true);
    try {
      const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const path = `${scope}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${clean}`;
      const { error } = await supabase.storage.from("product-docs").upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
      if (error) {
        const msg = (error.message || "unknown error").toLowerCase();
        if (msg.includes("not found") && msg.includes("bucket")) toast.error("Document storage is not set up yet. Contact AutoLabels support.");
        else if (msg.includes("row-level security") || msg.includes("policy") || msg.includes("permission") || msg.includes("denied")) toast.error("That file could not be saved. Contact AutoLabels support.");
        else if (msg.includes("mime") || msg.includes("content type") || msg.includes("not supported")) toast.error("That file type is not supported. Upload a PDF or image.");
        else toast.error("Upload failed. Please try again.");
        return;
      }
      setEditing((prev) => (prev ? { ...prev, contract_url: path } : prev));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploadingDoc(false);
    }
  };

  const activeNames = new Set(products.map((p) => (p.name || "").trim().toLowerCase()));
  const libraryToShow = libraryEntries.filter((e) => !activeNames.has((e.name || "").trim().toLowerCase()));
  const loading = !fixture && productsQuery.isLoading;
  const failed = !fixture && productsQuery.isError;

  return (
    <div className="space-y-4">
      <AdminCard
        title={<>Active products <span className="font-normal text-adm-muted">({failed ? "Unknown" : products.length})</span></>}
        description="Your active products power every addendum."
        action={<AdminButton variant="primary" size="sm" onClick={() => setEditing({ ...EMPTY_PRODUCT, sort_order: products.length + 1 })}>Add product</AdminButton>}
        flush
      >
        {loading ? (
          <p className="px-6 pb-6 text-[13px] text-adm-muted">Loading products…</p>
        ) : failed ? (
          <p role="status" className="px-6 pb-6 text-[13px] text-adm-muted">Products could not be read for this rooftop.</p>
        ) : products.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState compact title="No products yet" detail="Add a product or copy one from the template library below." />
          </div>
        ) : (
          <ul className="divide-y divide-adm-border">
            {products.map((p) => {
              const installed = p.badge_type === "installed";
              const icon = iconMap[p.id];
              return (
                <li key={p.id} className="flex items-center gap-3 px-6 py-3">
                  <button type="button" onClick={() => toggleType(p)} className="flex-shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-adm-primary" aria-label={`Switch ${p.name} to ${installed ? "optional" : "installed"}`} title={`Switch to ${installed ? "optional" : "installed"}`}>
                    <StatusChip tone={installed ? "info" : "warning"}>{installed ? "Installed" : "Optional"}</StatusChip>
                  </button>
                  {icon && settings.feature_product_icons && <span className="flex-shrink-0 text-adm-muted"><ProductIcon type={icon} className="w-5 h-5" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[14px] font-semibold text-adm-ink truncate">
                      {p.name}
                      {!p.is_active && <StatusChip tone="danger">Inactive</StatusChip>}
                    </p>
                    {p.subtitle && <p className="text-[12px] leading-[18px] text-adm-muted truncate">{p.subtitle}</p>}
                  </div>
                  <span className="text-[14px] font-semibold text-adm-ink tabular-nums">{fmtMoney(p.price)}</span>
                  {settings.feature_product_rules && <AdminLinkButton size="sm" to={ADMIN_CHILD_ROUTES.productApplicability(p.id)}>Applicability</AdminLinkButton>}
                  <AdminButton size="sm" onClick={() => setEditing({ ...p, icon_type: iconMap[p.id] || "" })}>Edit</AdminButton>
                  <AdminButton size="sm" variant="danger" onClick={() => remove(p)}>Delete</AdminButton>
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>

      <AdminCard
        title="Template library"
        description="Copy a template into your active products, then adjust pricing and documents."
        action={<AdminButton size="sm" onClick={() => setShowLibrary((v) => !v)} aria-expanded={showLibrary}>{showLibrary ? "Hide templates" : "Show templates"}</AdminButton>}
      >
        {showLibrary ? (
          libraryToShow.length === 0 ? (
            <p className="text-[13px] text-adm-muted">No templates left to import. Your active products are listed above.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {libraryToShow.map((entry) => {
                const defaultTier = entry.priceTiers.find((t) => t.vehicleCategory === "default");
                const basePrice = defaultTier ? defaultTier.price : entry.defaultPrice;
                return (
                  <div key={entry.id} className="rounded-[10px] border border-adm-border bg-adm-surface p-3 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[14px] font-semibold text-adm-ink truncate">{entry.name}</p>
                        <StatusChip tone="neutral">{entry.category}</StatusChip>
                      </div>
                      {entry.subtitle && <p className="text-[12px] leading-[18px] text-adm-muted mt-1 line-clamp-2">{entry.subtitle}</p>}
                      <p className="text-[14px] font-semibold text-adm-ink tabular-nums mt-2">{fmtMoney(basePrice)}</p>
                    </div>
                    <AdminButton
                      size="sm"
                      variant="primary"
                      className="mt-3 w-full"
                      onClick={() =>
                        setEditing({
                          ...EMPTY_PRODUCT,
                          name: entry.name,
                          subtitle: entry.subtitle,
                          warranty: entry.warrantyDetails || entry.warranty || "",
                          price: basePrice,
                          badge_type: entry.badge_type,
                          price_label: entry.price_label,
                          disclosure: entry.disclosure,
                          icon_type: entry.iconType || "",
                          sort_order: products.length + 1,
                          is_active: true,
                        })
                      }
                    >
                      Add to dealership
                    </AdminButton>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <p className="text-[13px] text-adm-muted">{libraryToShow.length} {libraryToShow.length === 1 ? "template" : "templates"} available.</p>
        )}
      </AdminCard>

      {editing && (
        <ProductEditorModal editing={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} saving={saving} uploadingDoc={uploadingDoc} onUploadDoc={uploadDoc} showIcons={!!settings.feature_product_icons} />
      )}
    </div>
  );
}
