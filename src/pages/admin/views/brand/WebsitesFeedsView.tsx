import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminButton, AdminCard, InlineNote } from "@/components/admin/v2/primitives";
import { WEBSITES_KEYS, validateWebsites } from "./brandModel";
import { useBrandForm } from "./useBrandForm";
import { BrandSaveBar } from "./BrandSaveBar";
import { TextField, ToggleRow, controlClass } from "./fields";

// The dealer's own web presence as the crawler and price verification see it.
// Unpictured in the reference set; rehomed here from the legacy Branding tab.

interface PriceTestResult {
  error?: string;
  price?: number | null;
  matched_label?: string | null;
  source?: string | null;
  reason?: string | null;
  rendered?: boolean;
  msrp?: number | null;
  candidates?: { value: number; label: string; source: string }[];
}

export default function WebsitesFeedsView() {
  const form = useBrandForm(WEBSITES_KEYS, validateWebsites);
  const { draft, set, source } = form;
  const [testUrl, setTestUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<PriceTestResult | null>(null);
  const errorFor = (label: string) => form.errors.find((e) => e.startsWith(label)) ?? null;

  // A manual diagnostic: one explicit click, one render of one page, against
  // the saved label configuration. Never runs on mount.
  const runTest = async () => {
    if (!testUrl.trim() || !source.tenantId) return;
    setTesting(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("crawl-advertised-prices", { body: { tenant_id: source.tenantId, test_url: testUrl.trim() } });
      if (error) setResult({ error: error.message });
      else setResult((data?.test as PriceTestResult) || (data as PriceTestResult) || { error: "No result" });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };
  const testBlocked = source.isFixture ? "Not available in the design fixture." : form.dirty ? "Save your label settings before testing." : !source.tenantId ? "No dealership context." : null;

  return (
    <div className="space-y-4">
      <AdminCard title="Inventory feed and website" description="Your DMS is the source of truth for inventory and pricing. The inventory pages let AutoLabels verify advertised prices against the sticker.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TextField label="DMS provider" value={draft.dms_provider} onChange={(v) => set("dms_provider", v)} placeholder="CDK, Reynolds, Dealertrack, Tekion" />
          <TextField label="New inventory page" value={draft.new_inventory_url} onChange={(v) => set("new_inventory_url", v)} placeholder="https://yourdealer.example/inventory/new" error={errorFor("New inventory")} inputMode="url" />
          <TextField label="Used inventory page" value={draft.used_inventory_url} onChange={(v) => set("used_inventory_url", v)} placeholder="https://yourdealer.example/inventory/used" error={errorFor("Used inventory")} inputMode="url" />
        </div>
      </AdminCard>

      <AdminCard title="Marketplace listings" description="Verified against the sticker as well, so a shopper sees the same price everywhere.">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <TextField label="AutoTrader" value={draft.autotrader_url} onChange={(v) => set("autotrader_url", v)} error={errorFor("AutoTrader")} inputMode="url" />
          <TextField label="Cars.com" value={draft.cars_com_url} onChange={(v) => set("cars_com_url", v)} error={errorFor("Cars.com")} inputMode="url" />
          <TextField label="CarGurus" value={draft.cargurus_url} onChange={(v) => set("cargurus_url", v)} error={errorFor("CarGurus")} inputMode="url" />
          <TextField label="Capital One" value={draft.capital_one_url} onChange={(v) => set("capital_one_url", v)} error={errorFor("Capital One")} inputMode="url" />
          <TextField label="CARFAX" value={draft.carfax_url} onChange={(v) => set("carfax_url", v)} error={errorFor("CARFAX")} inputMode="url" />
        </div>
      </AdminCard>

      <AdminCard title="Advertised price extraction" description="The label your website uses for the advertised selling price. The crawler looks for these labels next to a dollar amount, in order.">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
          <TextField label="VDP price labels, priority order" value={draft.vdp_price_labels} onChange={(v) => set("vdp_price_labels", v)} placeholder="Internet Price, Selling Price" hint="Comma-separated. Case-insensitive substring match; the first label with an adjacent dollar amount wins." />
          <div className="md:pt-6">
            <ToggleRow label="Strip finance and lease URL parameters" hint="Removes ?type=finance and ?type=lease before reading so the page shows the standard price." checked={draft.vdp_strip_finance_params !== false} onChange={(v) => set("vdp_strip_finance_params", v)} />
          </div>
        </div>
        <div className="mt-4 border-t border-dashed border-adm-border pt-4">
          <p className="text-[13px] leading-[18px] font-semibold text-adm-ink">Test a vehicle page</p>
          <p className="text-[12px] leading-[18px] text-adm-muted">Reads one page once, with the saved labels, and reports which label matched. Nothing is stored.</p>
          <div className="mt-2 flex flex-col sm:flex-row gap-2">
            <input aria-label="Test URL" value={testUrl} onChange={(e) => setTestUrl(e.target.value)} placeholder="https://yourdealer.example/used/2025-make-model/VIN/" className={controlClass} inputMode="url" />
            <AdminButton variant="primary" onClick={() => void runTest()} disabled={testing || !testUrl.trim() || !!testBlocked} className="sm:w-auto">
              {testing ? "Testing…" : "Test"}
            </AdminButton>
          </div>
          {testBlocked && <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">{testBlocked}</p>}
          {result && (
            <div className="mt-3 rounded-md border border-adm-border bg-adm-workspace p-3 text-[12px] leading-[18px]">
              {result.error ? (
                <p className="font-semibold text-adm-danger">Error: {result.error}</p>
              ) : (
                <>
                  <p className="font-semibold text-adm-ink">
                    {result.price != null ? `Price read: $${Number(result.price).toLocaleString()}` : "No price extracted"}
                    {result.matched_label && <span className="font-normal text-adm-muted"> matched {result.matched_label}</span>}
                    {result.source && <span className="font-normal text-adm-muted"> from {result.source}</span>}
                    {result.rendered && <span className="font-normal text-adm-muted"> (rendered)</span>}
                    {result.reason && <span className="font-normal text-adm-muted"> reason {result.reason}</span>}
                  </p>
                  {result.msrp != null && <p className="text-adm-muted">MSRP read: ${Number(result.msrp).toLocaleString()}</p>}
                  {Array.isArray(result.candidates) && result.candidates.length > 0 && (
                    <ul className="mt-2 max-h-40 overflow-auto space-y-0.5 font-mono">
                      {result.candidates.slice(0, 20).map((c, i) => (
                        <li key={i}>${Number(c.value).toLocaleString()} <span className="text-adm-muted">{c.label} [{c.source}]</span></li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </AdminCard>

      <AdminCard title="Vehicle condition terms" description="Your own labels for condition. Each maps to new, used or CPO for storage and compliance.">
        <TextField label="Condition terms" value={draft.vehicle_conditions} onChange={(v) => set("vehicle_conditions", v)} placeholder="New, Demo, Used, CPO" hint="Comma-separated." />
      </AdminCard>

      <InlineNote tone="info">Lead routing recipients and the dealership's public contact details are on Customer Experience and Hours & Contact.</InlineNote>

      <BrandSaveBar form={form} />
    </div>
  );
}
