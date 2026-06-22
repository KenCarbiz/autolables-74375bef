import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVehicleEvidence, type EvidenceCategory } from "@/lib/stickerStudio/useVehicleEvidence";
import { logStickerAudit } from "@/lib/stickerStudio/api";
import FeatureGate from "@/components/entitlements/FeatureGate";
import VehicleCtMvpStatusCard from "@/components/vehicle/VehicleCtMvpStatusCard";
import { FileText, PenLine, QrCode, Car, ShieldAlert, Activity, Download, ChevronDown, RefreshCw, ScrollText } from "lucide-react";

const CATS: { id: EvidenceCategory | "all"; label: string; icon: typeof Activity }[] = [
  { id: "all", label: "All", icon: Activity },
  { id: "document", label: "Documents", icon: FileText },
  { id: "signing", label: "Signing", icon: PenLine },
  { id: "qr", label: "QR", icon: QrCode },
  { id: "compliance", label: "Compliance", icon: ShieldAlert },
  { id: "vehicle", label: "Vehicle", icon: Car },
];

const dot: Record<EvidenceCategory, string> = {
  document: "bg-blue-500", signing: "bg-violet-500", qr: "bg-emerald-500",
  vehicle: "bg-slate-400", compliance: "bg-rose-500", other: "bg-slate-300",
};

const fmt = (d: string) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function VehicleEvidenceTimeline({ vehicleId, vin, tenantId, vehicleTitle }: { vehicleId: string; vin?: string | null; tenantId?: string | null; vehicleTitle?: string }) {
  const navigate = useNavigate();
  const { events, loading, reload } = useVehicleEvidence(vehicleId, vin, tenantId);
  const [cat, setCat] = useState<EvidenceCategory | "all">("all");
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => events.filter((e) => cat === "all" || e.category === cat), [events, cat]);

  const launchUsedVehicleDocs = () => {
    const query = new URLSearchParams();
    query.set("vehicleId", vehicleId);
    if (vin) query.set("vin", vin);
    navigate(`/used-vehicle-documents?${query.toString()}`);
  };

  const exportPacket = () => {
    const packet = {
      exported_at: new Date().toISOString(),
      vehicle: { id: vehicleId, vin, title: vehicleTitle },
      event_count: events.length,
      timeline: events.map((e) => ({ at: e.at, category: e.category, title: e.title, detail: e.detail, content_hash: e.contentHash, data: e.raw })),
    };
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `evidence-${vin || vehicleId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    logStickerAudit("evidence_exported", { tenantId, entityType: "vehicle", entityId: vehicleId, details: { event_count: events.length, vin } });
  };

  return (
    <div className="space-y-4">
      <VehicleCtMvpStatusCard tenantId={tenantId} vehicleId={vehicleId} vin={vin} />

      <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black text-blue-950">Used vehicle compliance docs</p>
            <p className="mt-1 text-xs text-blue-800">Generate and save FTC Buyers Guide + Connecticut K208 evidence for this vehicle.</p>
          </div>
          <button
            type="button"
            onClick={launchUsedVehicleDocs}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
          >
            <ScrollText className="h-4 w-4" /> Generate FTC / K208
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 flex-wrap">
            {CATS.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded-md text-xs font-semibold ${cat === c.id ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
                <c.icon className="w-3.5 h-3.5" /> {c.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={reload} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Refresh</button>
            <FeatureGate feature="evidence_packet_export" variant="inline">
              <button onClick={exportPacket} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted"><Download className="w-3.5 h-3.5" /> Export evidence packet</button>
            </FeatureGate>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading history…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No events recorded for this filter yet.</p>
        ) : (
          <ol className="relative border-l border-border ml-2">
            {filtered.map((e) => (
              <li key={e.id} className="ml-4 pb-3">
                <span className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${dot[e.category]}`} />
                <button onClick={() => setOpen(open === e.id ? null : e.id)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{e.title}</p>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0 inline-flex items-center gap-1">{fmt(e.at)} {e.raw && <ChevronDown className={`w-3 h-3 transition-transform ${open === e.id ? "rotate-180" : ""}`} />}</span>
                  </div>
                  {e.detail && <p className="text-[11px] text-muted-foreground">{e.detail}</p>}
                  {e.contentHash && <p className="text-[10px] font-mono text-muted-foreground truncate">hash {e.contentHash.slice(0, 24)}…</p>}
                </button>
                {open === e.id && e.raw && (
                  <pre className="mt-1.5 text-[10px] bg-muted/50 border border-border rounded-lg p-2 overflow-x-auto max-h-48">{JSON.stringify(e.raw, null, 2)}</pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
