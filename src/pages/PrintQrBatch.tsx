import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Loader2, Printer } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// /print/qr-batch — batch service-QR spool.
//
// One print job with the windshield cling + key-fob QR for a whole batch of
// vehicles (the nightly arrivals, or a `?vins=` list). The operator prints
// once and applies the stack. Each code encodes the vehicle's permanent
// /ready/:token service URL (minted-or-reused per vehicle).
// ──────────────────────────────────────────────────────────────

interface Item { vin: string; ymm: string; stock: string; token: string | null }
const CAP = 60;

export default function PrintQrBatch() {
  const [params] = useSearchParams();
  const { tenant } = useTenant();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const vinsParam = useMemo(
    () => (params.get("vins") || "").split(",").map((v) => v.trim().toUpperCase()).filter(Boolean),
    [params],
  );
  // "ready" = the Get-Ready hub; "k208" deep-links each code straight to the CT
  // K-208 safety inspection. Seedable via ?mode=k208, then toggled on-screen.
  const [mode, setMode] = useState<"ready" | "k208">(params.get("mode") === "k208" ? "k208" : "ready");

  useEffect(() => {
    let off = false;
    (async () => {
      if (!tenant?.id) { setLoading(false); return; }
      // The batch: an explicit ?vins= list, else the most recent used/CPO cars.
      let q = (supabase as any).from("vehicle_listings")
        .select("vin, ymm, condition, mc_attributes")
        .eq("tenant_id", tenant.id);
      q = vinsParam.length
        ? q.in("vin", vinsParam.slice(0, CAP))
        : q.in("condition", ["used", "cpo", "certified"]).order("created_at", { ascending: false }).limit(CAP);
      const { data } = await q;
      const vehicles = ((data as any[]) || []).map((v) => ({
        vin: (v.vin || "").toUpperCase(), ymm: v.ymm || "Vehicle",
        stock: (v.mc_attributes?.stock_no as string) || "",
      }));
      // Mint-or-reuse each vehicle's permanent Get-Ready token, in parallel.
      const withTokens = await Promise.all(vehicles.map(async (v) => {
        try {
          const { data: tok } = await (supabase as any).rpc("issue_vehicle_ready_token", { p_tenant_id: tenant.id, p_vin: v.vin });
          return { ...v, token: typeof tok === "string" ? tok : (tok?.token ?? null) };
        } catch { return { ...v, token: null }; }
      }));
      if (!off) { setItems(withTokens.filter((v) => v.token)); setLoading(false); }
    })();
    return () => { off = true; };
  }, [tenant?.id, vinsParam]);

  if (loading) return <div className="min-h-screen grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="bg-muted/30 min-h-screen py-6 print:bg-white print:py-0">
      <style>{`@media print { .no-print { display:none !important } @page { size: letter; margin: 0.4in } .qr-card { break-inside: avoid } }`}</style>
      <div className="no-print max-w-[820px] mx-auto mb-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">{items.length} vehicle{items.length === 1 ? "" : "s"} · {mode === "k208" ? "direct CT K-208 codes" : "Get-Ready codes"}</p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm font-semibold">
            <button onClick={() => setMode("ready")} className={`h-10 px-3 ${mode === "ready" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>Get-Ready</button>
            <button onClick={() => setMode("k208")} className={`h-10 px-3 ${mode === "k208" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>Service · K-208</button>
          </div>
          <button onClick={() => window.print()} className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Printer className="w-4 h-4" /> Print batch</button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">No vehicles with a service QR to print.</p>
      ) : (
        <div className="max-w-[820px] mx-auto bg-white p-6 shadow-premium print:shadow-none grid grid-cols-2 gap-4 text-[#0F172A]">
          {items.map((v) => {
            const base = `${window.location.origin}/ready/${v.token}`;
            const url = mode === "k208" ? `${base}?station=service` : base;
            return (
              <div key={v.vin} className="qr-card border border-slate-200 rounded-xl p-3 flex gap-3 items-center">
                <div className="shrink-0 border border-slate-100 rounded-lg p-1.5 bg-white"><QRCodeSVG value={url} size={96} level="M" /></div>
                <div className="min-w-0">
                  <p className="text-[13px] font-black leading-tight truncate">{v.ymm}</p>
                  <p className="text-[10px] text-slate-500 font-mono">{v.stock ? `Stock ${v.stock} · ` : ""}…{v.vin.slice(-8)}</p>
                  <p className="text-[9px] text-blue-700 font-bold uppercase tracking-wide mt-1">{mode === "k208" ? "Scan for CT K-208" : "Scan for Get-Ready"}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
