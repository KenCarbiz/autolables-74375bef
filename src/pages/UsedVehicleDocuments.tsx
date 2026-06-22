import { useMemo, useState } from "react";
import { ArrowLeft, FileText, Printer, ShieldCheck, Languages, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ConnecticutK208Document,
  DEFAULT_USED_VEHICLE_DOCUMENT_DATA,
  FtcBuyersGuideDocument,
  WARRANTY_SYSTEMS,
  suggestedCtWarranty,
  type UsedVehicleDocumentData,
  type WarrantyMode,
} from "@/lib/ctMvp/usedVehicleDocuments";
import { buildPersistenceContext, recordFtcGenerated, recordK208Generated } from "@/lib/ctMvp/productionHooks";

const warrantyOptions: Array<{ value: WarrantyMode; label: string; helper: string }> = [
  { value: "as_is", label: "As Is — No Dealer Warranty", helper: "FTC Buyers Guide as-is box checked" },
  { value: "implied", label: "Implied Warranties Only", helper: "Use when implied warranties apply" },
  { value: "dealer_warranty", label: "Dealer Warranty", helper: "Shows duration, mileage, percentage, and systems covered" },
];

const fieldClass = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/30";
const labelClass = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

const UsedVehicleDocuments = () => {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const { user } = useAuth();
  const [data, setData] = useState<UsedVehicleDocumentData>(DEFAULT_USED_VEHICLE_DOCUMENT_DATA);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<"ftc" | "k208">("ftc");

  const suggested = useMemo(() => suggestedCtWarranty(data.salePrice), [data.salePrice]);

  const update = <K extends keyof UsedVehicleDocumentData>(key: K, value: UsedVehicleDocumentData[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const applySuggestedWarranty = () => {
    setData((prev) => ({ ...prev, warrantyDuration: suggested.duration, warrantyMiles: suggested.miles, warrantyMode: suggested.duration === "No statutory minimum" ? prev.warrantyMode : "dealer_warranty" }));
    toast.success("Suggested Connecticut warranty tier applied");
  };

  const toggleSystem = (system: string) => {
    setData((prev) => ({
      ...prev,
      systemsCovered: prev.systemsCovered.includes(system)
        ? prev.systemsCovered.filter((s) => s !== system)
        : [...prev.systemsCovered, system],
    }));
  };

  const printCurrent = () => {
    const key = `used-documents-print-${crypto.randomUUID()}`;
    localStorage.setItem(key, JSON.stringify({ data, preview }));
    const win = window.open(`/print/used-vehicle-documents?h=${key}`, "_blank", "noopener");
    if (!win) toast.error("Allow pop-ups to open the print view");
  };

  const saveEvidence = async () => {
    if (!tenant?.id || tenant.id === "house") {
      toast.error("Select a dealership workspace before saving evidence");
      return;
    }
    setSaving(true);
    try {
      const context = buildPersistenceContext({
        tenantId: tenant.id,
        vin: data.vin,
        stock: data.stock,
      });
      const payload = {
        dealer: data.dealerName,
        vin: data.vin,
        stock: data.stock,
        warrantyMode: data.warrantyMode,
        warrantyDuration: data.warrantyDuration,
        warrantyMiles: data.warrantyMiles,
        warrantyPercent: data.warrantyPercent,
        systemsCovered: data.systemsCovered,
        language: data.language,
        savedBy: user?.id || null,
      };

      await recordFtcGenerated(context, {
        documentId: `ftc-${data.vin || data.stock || Date.now()}`,
        warrantyMode: data.warrantyMode,
        language: data.language,
        systemsCovered: data.systemsCovered,
        metadata: payload,
      });
      await recordK208Generated(context, {
        documentId: `k208-${data.vin || data.stock || Date.now()}`,
        warrantyMode: data.warrantyMode,
        warrantyDuration: data.warrantyDuration,
        warrantyMiles: data.warrantyMiles,
        warrantyPercent: data.warrantyPercent,
        metadata: payload,
      });

      try {
        await (supabase as any).from("audit_log").insert({
          action: "used_vehicle_documents_saved",
          entity_type: "vehicle",
          entity_id: data.vin || data.stock || "unknown",
          store_id: tenant.id,
          user_id: user?.id || null,
          details: payload,
        });
      } catch { /* audit fallback best effort */ }

      toast.success("FTC Buyers Guide and K208 lifecycle evidence saved");
    } catch (err) {
      console.error(err);
      toast.error("Could not save document evidence");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <button onClick={() => navigate(-1)} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Used Vehicle Compliance
          </div>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-foreground">FTC Buyers Guide + Connecticut K208</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Build both used-vehicle documents from one workflow, preview print-ready forms, and save lifecycle evidence for CT MVP certification.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPreview(preview === "ftc" ? "k208" : "ftc")} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold hover:bg-muted">
            <FileText className="h-4 w-4" /> Preview {preview === "ftc" ? "K208" : "FTC"}
          </button>
          <button onClick={printCurrent} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-bold hover:bg-muted">
            <Printer className="h-4 w-4" /> Print Preview
          </button>
          <button onClick={saveEvidence} disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save Evidence"}
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div>
            <h2 className="text-sm font-black text-foreground">Vehicle + Dealer Info</h2>
            <p className="mt-1 text-xs text-muted-foreground">These values populate both documents.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1"><span className={labelClass}>Dealer Name</span><input className={fieldClass} value={data.dealerName} onChange={(e) => update("dealerName", e.target.value)} /></label>
            <label className="space-y-1"><span className={labelClass}>Dealer Phone</span><input className={fieldClass} value={data.dealerPhone} onChange={(e) => update("dealerPhone", e.target.value)} /></label>
            <label className="space-y-1 sm:col-span-2"><span className={labelClass}>Dealer Address</span><input className={fieldClass} value={data.dealerAddress} onChange={(e) => update("dealerAddress", e.target.value)} /></label>
            <label className="space-y-1"><span className={labelClass}>Buyer Name</span><input className={fieldClass} value={data.buyerName} onChange={(e) => update("buyerName", e.target.value)} /></label>
            <label className="space-y-1"><span className={labelClass}>Stock</span><input className={fieldClass} value={data.stock} onChange={(e) => update("stock", e.target.value)} /></label>
            <label className="space-y-1"><span className={labelClass}>Year</span><input className={fieldClass} value={data.year} onChange={(e) => update("year", e.target.value)} /></label>
            <label className="space-y-1"><span className={labelClass}>Make</span><input className={fieldClass} value={data.make} onChange={(e) => update("make", e.target.value)} /></label>
            <label className="space-y-1"><span className={labelClass}>Model</span><input className={fieldClass} value={data.model} onChange={(e) => update("model", e.target.value)} /></label>
            <label className="space-y-1"><span className={labelClass}>Mileage</span><input className={fieldClass} value={data.mileage} onChange={(e) => update("mileage", e.target.value)} /></label>
            <label className="space-y-1 sm:col-span-2"><span className={labelClass}>VIN</span><input className={`${fieldClass} font-mono`} value={data.vin} onChange={(e) => update("vin", e.target.value.toUpperCase())} /></label>
            <label className="space-y-1"><span className={labelClass}>Sale Price</span><input className={fieldClass} value={data.salePrice} onChange={(e) => update("salePrice", e.target.value)} /></label>
            <label className="space-y-1"><span className={labelClass}>Language</span><select className={fieldClass} value={data.language} onChange={(e) => update("language", e.target.value as UsedVehicleDocumentData["language"])}><option value="en">English</option><option value="es">Spanish</option></select></label>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-black uppercase tracking-wider text-amber-800">Connecticut suggested tier</p>
            <p className="mt-1 text-sm font-bold text-amber-950">{suggested.label}: {suggested.duration} / {suggested.miles}</p>
            <button onClick={applySuggestedWarranty} className="mt-2 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-amber-900 shadow-sm hover:bg-amber-100">Apply suggested tier</button>
          </div>

          <div className="space-y-2">
            <p className={labelClass}>Warranty Type</p>
            {warrantyOptions.map((option) => (
              <button key={option.value} onClick={() => update("warrantyMode", option.value)} className={`w-full rounded-xl border p-3 text-left transition ${data.warrantyMode === option.value ? "border-blue-500 bg-blue-50" : "border-border bg-background hover:bg-muted"}`}>
                <p className="text-sm font-bold text-foreground">{option.label}</p>
                <p className="text-xs text-muted-foreground">{option.helper}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1"><span className={labelClass}>Duration</span><input className={fieldClass} value={data.warrantyDuration} onChange={(e) => update("warrantyDuration", e.target.value)} /></label>
            <label className="space-y-1"><span className={labelClass}>Miles</span><input className={fieldClass} value={data.warrantyMiles} onChange={(e) => update("warrantyMiles", e.target.value)} /></label>
            <label className="space-y-1"><span className={labelClass}>Dealer Pays</span><input className={fieldClass} value={data.warrantyPercent} onChange={(e) => update("warrantyPercent", e.target.value)} /></label>
          </div>

          <div className="space-y-2">
            <p className={labelClass}>Systems Covered</p>
            <div className="grid grid-cols-2 gap-2">
              {WARRANTY_SYSTEMS.map((system) => (
                <button key={system} onClick={() => toggleSystem(system)} className={`rounded-lg border px-3 py-2 text-left text-xs font-bold ${data.systemsCovered.includes(system) ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-border bg-background text-muted-foreground"}`}>
                  {system}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className={labelClass}>Additional Warranty Flags</p>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={data.serviceContractAvailable} onChange={(e) => update("serviceContractAvailable", e.target.checked)} /> Service contract available</label>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={data.manufacturerWarrantyApplies} onChange={(e) => update("manufacturerWarrantyApplies", e.target.checked)} /> Manufacturer warranty applies</label>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={data.manufacturerUsedVehicleWarrantyApplies} onChange={(e) => update("manufacturerUsedVehicleWarrantyApplies", e.target.checked)} /> Manufacturer used warranty applies</label>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={data.otherUsedVehicleWarrantyApplies} onChange={(e) => update("otherUsedVehicleWarrantyApplies", e.target.checked)} /> Other used-vehicle warranty applies</label>
          </div>

          <label className="space-y-1 block">
            <span className={labelClass}>K208 Notes</span>
            <textarea className="min-h-[90px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/30" value={data.k208Notes} onChange={(e) => update("k208Notes", e.target.value)} />
          </label>
        </section>

        <section className="rounded-2xl border border-border bg-slate-100 p-4 shadow-sm overflow-auto">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-black text-foreground">Live Preview</p>
              <p className="text-xs text-muted-foreground">{preview === "ftc" ? "FTC Buyers Guide" : "Connecticut K208 Warranty Worksheet"}</p>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              <button onClick={() => setPreview("ftc")} className={`h-8 rounded-md px-3 text-xs font-bold ${preview === "ftc" ? "bg-blue-600 text-white" : "text-muted-foreground"}`}><Languages className="mr-1 inline h-3.5 w-3.5" /> FTC</button>
              <button onClick={() => setPreview("k208")} className={`h-8 rounded-md px-3 text-xs font-bold ${preview === "k208" ? "bg-blue-600 text-white" : "text-muted-foreground"}`}>K208</button>
            </div>
          </div>
          <div className="min-w-max py-3">
            {preview === "ftc" ? <FtcBuyersGuideDocument data={data} /> : <ConnecticutK208Document data={data} />}
          </div>
        </section>
      </div>
    </div>
  );
};

export default UsedVehicleDocuments;
