import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { Printer } from "lucide-react";
import type { GetReadyRecord } from "@/hooks/useGetReady";

// Standard recon line items and who owns them, so the printed slip is a
// real work order routed to the right department.
const STANDARD_ITEMS: { label: string; dept: string }[] = [
  { label: "Reconditioning / mechanical", dept: "Service Dept." },
  { label: "Emissions / safety inspection", dept: "Lot Attendant" },
  { label: "Detail / clean-up", dept: "Detail" },
];

// Printable Get-Ready / Recon slip, modeled on the standard dealership
// reconditioning sheet: a vehicle header grid, a recon stage strip, an
// itemized work/accessory table (vendor, date, initials), notes, and
// manager sign-offs. It also carries the installer QR (encodes
// /install/:install_token) so the detail shop scans, verifies what they
// installed, and attaches a photo — creating the install_proof that later
// defaults the addendum line to Pre-Installed.

// The conventional recon path a used car moves through on the lot.
const STAGES = ["Intake", "Inspection", "Mechanical", "Body", "Parts", "Detail", "Photos", "Frontline"];

// Map our stored status onto the visible stage strip.
const STATUS_STAGE: Record<string, number> = {
  pending: 0,
  in_progress: 2,
  inspection: 1,
  detail: 5,
  photo: 6,
  ready: 7,
  inventory: 7,
};

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" }) : "";

const Blank = ({ w = "w-20" }: { w?: string }) => <span className={`inline-block ${w} border-b border-slate-400`}>&nbsp;</span>;

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
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const logo = settings.dealer_logo_url || tenant?.logo_url || "";
  const address = [settings.dealer_address, settings.dealer_city, settings.dealer_state, settings.dealer_zip].filter(Boolean).join(", ");
  const phone = settings.dealer_phone || "";

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      // Prefer a get-or-create RPC so a vehicle not yet in inventory still
      // gets an install token (and never a blank QR). Fall back to the
      // tenant-scoped lookup until that RPC is deployed.
      try {
        const { data: tok, error } = await (supabase as any).rpc("get_or_create_install_token", {
          _store_id: record.storeId,
          _vin: record.vin,
          _ymm: record.ymm || null,
        });
        if (!error && tok) { setToken(tok as string); setLoading(false); return; }
      } catch { /* fall through to direct lookup */ }

      let q = (supabase as any)
        .from("vehicle_listings")
        .select("install_token")
        .eq("vin", record.vin);
      if (tenant?.id) q = q.eq("tenant_id", tenant.id);
      const { data } = await q.limit(1).maybeSingle();
      setToken(data?.install_token || null);
      setLoading(false);
    })();
  }, [open, record.vin, record.storeId, record.ymm, tenant?.id]);

  if (!open) return null;

  const installUrl = token ? `${window.location.origin}/install/${token}` : "";
  const accessories = record.accessoriesToInstall || [];
  const reachedStage = STATUS_STAGE[record.status] ?? 0;
  const blankRows = Math.max(0, 4 - accessories.length);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print" onClick={onClose}>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #gr-sheet, #gr-sheet * { visibility: visible !important; }
        #gr-sheet { position: fixed; inset: 0; margin: 0; box-shadow: none; border: 0; }
        .gr-noprint { display: none !important; }
      }`}</style>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div id="gr-sheet" className="p-7 text-slate-900">
          {/* Header */}
          <div className="flex items-start justify-between gap-5 border-b-2 border-slate-900 pb-3">
            <div className="min-w-0 flex items-start gap-3">
              {logo && <img src={logo} alt={dealerName || settings.dealer_name} className="h-11 w-auto object-contain shrink-0" />}
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Get-Ready · Reconditioning Slip</p>
                <h1 className="text-xl font-black leading-tight">{dealerName || settings.dealer_name || "Dealership"}</h1>
                {(address || phone) && <p className="text-[10px] text-slate-500">{[address, phone].filter(Boolean).join(" · ")}</p>}
                <p className="text-[13px] font-semibold mt-0.5">{record.ymm || "Vehicle"}</p>
              </div>
            </div>
            <div className="text-center flex-shrink-0">
              {loading ? (
                <div className="w-[110px] h-[110px] rounded bg-slate-100 animate-pulse" />
              ) : installUrl ? (
                <>
                  <div className="border border-slate-300 p-1.5 inline-block bg-white">
                    <QRCodeSVG value={installUrl} size={100} />
                  </div>
                  <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500 mt-0.5">Installer: scan to verify</p>
                </>
              ) : (
                <p className="text-[10px] text-slate-500 w-[110px]">Add vehicle to inventory to generate the installer QR.</p>
              )}
            </div>
          </div>

          {/* Vehicle header grid */}
          <div className="grid grid-cols-4 gap-x-4 gap-y-2 mt-3 text-[11px]">
            <Cell label="Stock #" value={record.stockNumber || ""} fill />
            <Cell label="VIN" value={record.vin} mono span={2} />
            <Cell label="RO #" value="" fill />
            <Cell label="Color" value="" fill />
            <Cell label="Mileage" value="" fill />
            <Cell label="Date In" value={fmtDate(record.acquiredDate)} fill />
            <Cell label="Frontline target" value={fmtDate(record.getReadyCompleteDate)} fill />
          </div>

          {/* Recon stage strip */}
          <div className="mt-4">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-1">Recon stage</p>
            <div className="flex items-stretch gap-1">
              {STAGES.map((s, i) => (
                <div
                  key={s}
                  className={`flex-1 text-center text-[9px] font-bold uppercase tracking-wide py-1.5 rounded border ${
                    i < reachedStage
                      ? "bg-slate-100 border-slate-300 text-slate-500"
                      : i === reachedStage
                        ? "bg-slate-900 border-slate-900 text-white"
                        : "bg-white border-slate-200 text-slate-400"
                  }`}
                >
                  {s}
                </div>
              ))}
            </div>
          </div>

          {/* Work / accessories table */}
          <div className="mt-4">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-1">Equipment &amp; recon items</p>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-slate-100 text-left text-[9px] uppercase tracking-wider text-slate-600">
                  <th className="border border-slate-300 px-2 py-1 w-6">✓</th>
                  <th className="border border-slate-300 px-2 py-1">Item</th>
                  <th className="border border-slate-300 px-2 py-1 w-28">Department</th>
                  <th className="border border-slate-300 px-2 py-1 w-24">Vendor / Tech</th>
                  <th className="border border-slate-300 px-2 py-1 w-14">Date</th>
                  <th className="border border-slate-300 px-2 py-1 w-12">Init.</th>
                </tr>
              </thead>
              <tbody>
                {STANDARD_ITEMS.map((s) => (
                  <tr key={s.label}>
                    <td className="border border-slate-300 px-2 py-1.5 text-center"><span className="inline-block w-3.5 h-3.5 border border-slate-500" /></td>
                    <td className="border border-slate-300 px-2 py-1.5 font-semibold">{s.label}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-slate-600">{s.dept}</td>
                    <td className="border border-slate-300 px-2 py-1.5"></td>
                    <td className="border border-slate-300 px-2 py-1.5"></td>
                    <td className="border border-slate-300 px-2 py-1.5"></td>
                  </tr>
                ))}
                {accessories.map((a) => (
                  <tr key={a.productId}>
                    <td className="border border-slate-300 px-2 py-1.5 text-center">
                      <span className={`inline-block w-3.5 h-3.5 border border-slate-500 ${a.installed ? "bg-slate-900" : ""}`} />
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 font-semibold">{a.productName}</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-slate-600">Detail / Vendor</td>
                    <td className="border border-slate-300 px-2 py-1.5">{a.installedBy || ""}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{fmtDate(a.installedDate)}</td>
                    <td className="border border-slate-300 px-2 py-1.5"></td>
                  </tr>
                ))}
                {Array.from({ length: blankRows }).map((_, i) => (
                  <tr key={`b${i}`}>
                    <td className="border border-slate-300 px-2 py-1.5 text-center">
                      <span className="inline-block w-3.5 h-3.5 border border-slate-400" />
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5">&nbsp;</td>
                    <td className="border border-slate-300 px-2 py-1.5"></td>
                    <td className="border border-slate-300 px-2 py-1.5"></td>
                    <td className="border border-slate-300 px-2 py-1.5"></td>
                    <td className="border border-slate-300 px-2 py-1.5"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes */}
          <div className="mt-4">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-1">Recon notes</p>
            <div className="border border-slate-300 rounded h-16" />
          </div>

          {/* Installer instructions */}
          <div className="mt-3 rounded bg-slate-50 border border-slate-200 p-3">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-600 mb-0.5">For the installer</p>
            <p className="text-[10px] text-slate-700 leading-snug">
              Scan the QR above, enter your name and company, confirm what you installed and when, then take a photo of the
              equipment on the vehicle and submit. This creates the time-stamped proof of installation.
            </p>
          </div>

          {/* Sign-offs */}
          <div className="mt-5 grid grid-cols-2 gap-6 text-[10px]">
            <div>
              <div className="border-b border-slate-500 h-5" />
              <p className="mt-1 uppercase tracking-wider text-slate-500">Recon / Service Manager · Date</p>
            </div>
            <div>
              <div className="border-b border-slate-500 h-5" />
              <p className="mt-1 uppercase tracking-wider text-slate-500">Used Car Manager · Date</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="gr-noprint flex items-center justify-end gap-2 px-7 pb-6">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Close
          </button>
          <button onClick={() => window.print()} className="h-10 px-4 rounded-lg bg-slate-950 text-white text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-slate-900">
            <Printer className="w-4 h-4" /> Print slip
          </button>
        </div>
      </div>
    </div>
  );
};

const Cell = ({
  label, value, mono, fill, span,
}: { label: string; value: string; mono?: boolean; fill?: boolean; span?: number }) => (
  <div className={span === 2 ? "col-span-2" : ""}>
    <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    {value ? (
      <p className={`text-[12px] font-semibold ${mono ? "font-mono" : ""} ${fill ? "border-b border-slate-300" : ""}`}>{value}</p>
    ) : (
      <p className="border-b border-slate-400 h-[15px]">&nbsp;</p>
    )}
  </div>
);

export default GetReadySheet;
