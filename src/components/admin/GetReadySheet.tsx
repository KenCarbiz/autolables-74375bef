import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { Printer } from "lucide-react";
import type { GetReadyRecord } from "@/hooks/useGetReady";

// Printable Get-Ready / Installer sheet. The dealer prints this and hands
// it to the detail shop. It carries the installer QR (encodes
// /install/:install_token, resolved from the vehicle's install_token), the
// equipment checklist, and step-by-step instructions. The installer scans,
// verifies what they installed, and attaches a photo — creating the
// install_proof that later defaults the addendum line to Pre-Installed.

export const GetReadySheet = ({
  open,
  onClose,
  record,
  dealerName,
}: {
  open: boolean;
  onClose: () => void;
  record: GetReadyRecord;
  dealerName?: string;
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const { data } = await (supabase as any)
        .from("vehicle_listings")
        .select("install_token")
        .eq("vin", record.vin)
        .limit(1)
        .maybeSingle();
      setToken(data?.install_token || null);
      setLoading(false);
    })();
  }, [open, record.vin]);

  if (!open) return null;

  const installUrl = token ? `${window.location.origin}/install/${token}` : "";
  const accessories = record.accessoriesToInstall || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print" onClick={onClose}>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #gr-sheet, #gr-sheet * { visibility: visible !important; }
        #gr-sheet { position: fixed; inset: 0; margin: 0; box-shadow: none; border: 0; }
        .gr-noprint { display: none !important; }
      }`}</style>
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div id="gr-sheet" className="p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Get-Ready · Installer Sheet</p>
              <h1 className="text-2xl font-black text-slate-950 leading-tight">{record.ymm || "Vehicle"}</h1>
              <p className="text-xs font-mono text-slate-500 mt-0.5">
                VIN {record.vin}{record.stockNumber ? ` · Stock ${record.stockNumber}` : ""}
              </p>
              {dealerName && <p className="text-xs text-slate-500 mt-0.5">{dealerName}</p>}
            </div>
            <div className="text-center flex-shrink-0">
              {loading ? (
                <div className="w-[120px] h-[120px] rounded-lg bg-slate-100 animate-pulse" />
              ) : installUrl ? (
                <>
                  <div className="rounded-lg border border-slate-200 p-2 bg-white">
                    <QRCodeSVG value={installUrl} size={116} />
                  </div>
                  <p className="text-[9px] uppercase tracking-wider text-slate-500 mt-1">Installer: scan to verify</p>
                </>
              ) : (
                <p className="text-[10px] text-slate-500 w-[120px]">
                  Add this vehicle to inventory to generate the installer QR.
                </p>
              )}
            </div>
          </div>

          <div className="mt-6">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Equipment to install</p>
            {accessories.length === 0 ? (
              <p className="text-sm text-slate-500">No accessories on this vehicle's get-ready plan.</p>
            ) : (
              <ul className="space-y-2">
                {accessories.map((a) => (
                  <li key={a.productId} className="flex items-center gap-3 border border-slate-200 rounded-lg px-3 py-2.5">
                    <span className={`w-5 h-5 rounded border-2 flex items-center justify-center ${a.installed ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300"}`}>
                      {a.installed && <span className="text-xs font-bold">✓</span>}
                    </span>
                    <span className="text-sm font-semibold text-slate-800">{a.productName}</span>
                    {a.installed && <span className="ml-auto text-[10px] font-semibold text-emerald-600">Installed</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 rounded-lg bg-slate-50 border border-slate-200 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">For the installer</p>
            <ol className="text-[12px] text-slate-700 list-decimal pl-4 space-y-0.5">
              <li>Scan the QR code above with your phone.</li>
              <li>Enter your name and company.</li>
              <li>Confirm what you installed and when.</li>
              <li>Take a photo of the equipment on the vehicle and submit.</li>
            </ol>
          </div>
        </div>

        <div className="gr-noprint flex items-center justify-end gap-2 px-8 pb-6">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Close
          </button>
          <button onClick={() => window.print()} className="h-10 px-4 rounded-lg bg-slate-950 text-white text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-slate-900">
            <Printer className="w-4 h-4" /> Print sheet
          </button>
        </div>
      </div>
    </div>
  );
};

export default GetReadySheet;
