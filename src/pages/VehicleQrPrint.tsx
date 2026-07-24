import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Loader2, Printer } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// /print/vehicle-qr/:vin — the service QR print sheet.
//
// One page, two cut-out labels for a vehicle: a back-windshield cling and a
// key-fob tag, both encoding the permanent Get-Ready / service URL
// (/ready/:token). The technician scans either to open the vehicle's service
// workspace. Possession of the code is a locator only — the workspace still
// authenticates + authorizes on the other side.
// ──────────────────────────────────────────────────────────────

export default function VehicleQrPrint() {
  const { vin = "" } = useParams();
  const { tenant } = useTenant();
  const [token, setToken] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ ymm: string; stock: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!tenant?.id || !vin) { setLoading(false); return; }
      const v = vin.toUpperCase();
      // Mint-or-reuse the permanent per-vehicle Get-Ready token.
      const [{ data: tok }, { data: listing }] = await Promise.all([
        (supabase as any).rpc("issue_vehicle_ready_token", { p_tenant_id: tenant.id, p_vin: v }),
        (supabase as any).from("vehicle_listings").select("ymm, mc_attributes").eq("tenant_id", tenant.id).eq("vin", v).maybeSingle(),
      ]);
      if (off) return;
      setToken(typeof tok === "string" ? tok : (tok?.token ?? null));
      setMeta({ ymm: listing?.ymm || "Vehicle", stock: (listing?.mc_attributes?.stock_no as string) || "" });
      setLoading(false);
    })();
    return () => { off = true; };
  }, [tenant?.id, vin]);

  const readyUrl = useMemo(() => token ? `${window.location.origin}/ready/${token}` : "", [token]);
  // Same permanent token, deep-linked straight to the K-208 station so the
  // service department scans and lands on the safety inspection.
  const k208Url = useMemo(() => readyUrl ? `${readyUrl}?station=service` : "", [readyUrl]);
  const tail = vin.toUpperCase().slice(-8);

  if (loading) return <div className="min-h-screen grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!token) return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <p className="text-sm text-muted-foreground">No service QR available for {vin.toUpperCase()} yet. Open the vehicle and start Get-Ready first.</p>
    </div>
  );

  return (
    <div className="bg-muted/30 min-h-screen py-6 print:bg-white print:py-0">
      <style>{`@media print { .no-print { display:none !important } @page { size: letter; margin: 0.5in } }`}</style>
      <div className="no-print max-w-[800px] mx-auto mb-4 flex justify-end">
        <button onClick={() => window.print()} className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Printer className="w-4 h-4" /> Print QR sheet</button>
      </div>

      <div className="max-w-[800px] mx-auto bg-white p-8 shadow-premium print:shadow-none space-y-8 text-[#0F172A]">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">AutoLabels · Service Codes</p>
          <p className="text-lg font-black">{meta?.ymm}</p>
          <p className="text-xs text-slate-500">VIN {vin.toUpperCase()}{meta?.stock ? ` · Stock ${meta.stock}` : ""}</p>
        </div>

        {/* Windshield cling */}
        <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 flex items-center gap-6">
          <div className="shrink-0 border border-slate-200 rounded-xl p-3 bg-white">
            <QRCodeSVG value={readyUrl} size={200} level="M" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-blue-700">Back windshield</p>
            <p className="text-2xl font-black leading-tight mt-1">Scan for Get-Ready</p>
            <p className="text-sm text-slate-600 mt-1">Service &amp; detail scan to open this vehicle's work order, complete the inspection / installs, and sign off.</p>
            <p className="text-xs text-slate-400 mt-3 font-mono break-all">{readyUrl}</p>
          </div>
        </div>

        {/* Service · CT K-208 — deep-links straight to the safety inspection */}
        <div className="border-2 border-dashed border-blue-300 rounded-2xl p-6 flex items-center gap-6">
          <div className="shrink-0 border border-slate-200 rounded-xl p-3 bg-white">
            <QRCodeSVG value={k208Url} size={200} level="M" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-blue-700">Service department</p>
            <p className="text-2xl font-black leading-tight mt-1">Scan for the CT K-208</p>
            <p className="text-sm text-slate-600 mt-1">Opens the safety inspection directly — mark each item Pass or Fail, then sign. No login required.</p>
            <p className="text-xs text-slate-400 mt-3 font-mono break-all">{k208Url}</p>
          </div>
        </div>

        {/* Key-fob tag */}
        <div className="border-2 border-dashed border-slate-300 rounded-2xl p-4 flex items-center gap-4 max-w-sm">
          <div className="shrink-0 border border-slate-200 rounded-lg p-2 bg-white">
            <QRCodeSVG value={readyUrl} size={96} level="M" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Key fob tag</p>
            <p className="text-lg font-black leading-tight">{meta?.stock || tail}</p>
            <p className="text-[11px] text-slate-500 font-mono">…{tail}</p>
            <p className="text-[10px] text-slate-400 mt-1">Scan to open service workspace</p>
          </div>
        </div>

        <p className="no-print text-center text-[11px] text-slate-400">Cut along the dashed lines. The windshield cling goes on the inside of the back glass; the tag clips to the key fob.</p>
      </div>
    </div>
  );
}
