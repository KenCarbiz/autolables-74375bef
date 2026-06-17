import { useState, useRef } from "react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { useVinDecode } from "@/hooks/useVinDecode";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Printer, Download, ShieldCheck, CheckCircle2, Award } from "lucide-react";
import Logo from "@/components/brand/Logo";

const CpoSheet = () => {
  const { settings } = useDealerSettings();
  const { currentStore, tenant } = useTenant();
  const { decode, decoding } = useVinDecode();
  const cardRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);

  const [vehicle, setVehicle] = useState({
    vin: "", year: "", make: "", model: "", trim: "", stock: "", mileage: "",
    color: "", engine: "", transmission: "", drivetrain: "",
  });
  const [cpoProgram, setCpoProgram] = useState("");
  const [cpoWarranty, setCpoWarranty] = useState("Powertrain: 7 years / 100,000 miles from original in-service date");
  const [inspectionPoints, setInspectionPoints] = useState("150+");
  const [reconditioning, setReconditioning] = useState("");
  const [benefits, setBenefits] = useState<string[]>([
    "Multi-point inspection completed",
    "Manufacturer-backed warranty",
    "Vehicle history report included",
    "Roadside assistance",
    "Exchange/return privilege",
  ]);
  const [carfaxUrl, setCarfaxUrl] = useState("");

  const dealerName = currentStore?.name || settings.dealer_name || "Your Dealership";
  const dealerLogo = currentStore?.logo_url || settings.dealer_logo_url || tenant?.logo_url || "";

  const handleVinDecode = async () => {
    if (vehicle.vin.length !== 17) return;
    const result = await decode(vehicle.vin);
    if (result) {
      setVehicle(prev => ({ ...prev, year: result.year, make: result.make, model: result.model, trim: result.trim, engine: result.engineDescription, drivetrain: result.driveType }));
      setCpoProgram(`${result.make} Certified Pre-Owned`);
      toast.success(`${result.year} ${result.make} ${result.model}`);
    }
  };

  const handlePrint = () => window.print();
  const handlePdf = async () => {
    if (!cardRef.current) return;
    setGenerating(true);
    try {
      const { default: html2canvas } = await import("html2canvas-pro");
      const { default: jsPDF } = await import("jspdf");
      const canvas = await html2canvas(cardRef.current, { scale: 2, useCORS: true, onclone: (await import("@/lib/html2canvasInputs")).replaceInputsForCanvas } as any);
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const w = 8.5, h = (canvas.height / canvas.width) * w;
      const pdf = new jsPDF({ unit: "in", format: [w, h], orientation: "portrait" });
      pdf.addImage(imgData, "JPEG", 0, 0, w, h);
      pdf.save(`CPO-Sheet-${vehicle.vin || "draft"}.pdf`);
    } catch { toast.error("PDF failed"); } finally { setGenerating(false); }
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight font-display text-foreground">CPO Vehicle Information Sheet</h1>
          <p className="text-xs text-muted-foreground mt-1">Certified Pre-Owned information sheet with warranty, inspection, and reconditioning details.</p>
        </div>
        <div className="flex gap-2 no-print">
          <button onClick={handlePrint} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted"><Printer className="w-3.5 h-3.5" /> Print</button>
          <button onClick={handlePdf} disabled={generating} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> PDF</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-2 space-y-4 no-print">
          <CfgCard title="Vehicle">
            <div className="space-y-2">
              <div className="flex gap-2">
                <input value={vehicle.vin} onChange={e => setVehicle({ ...vehicle, vin: e.target.value.toUpperCase() })} placeholder="VIN" className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-sm font-mono outline-none" />
                <button onClick={handleVinDecode} disabled={decoding || vehicle.vin.length !== 17} className="h-9 px-3 rounded-md bg-primary text-white text-xs font-medium disabled:opacity-40">{decoding ? "..." : "Decode"}</button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {(["year","make","model","trim"] as const).map(k => (
                  <input key={k} value={vehicle[k]} onChange={e => setVehicle({ ...vehicle, [k]: e.target.value })} placeholder={k.charAt(0).toUpperCase()+k.slice(1)} className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input value={vehicle.stock} onChange={e => setVehicle({ ...vehicle, stock: e.target.value })} placeholder="Stock #" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.mileage} onChange={e => setVehicle({ ...vehicle, mileage: e.target.value })} placeholder="Mileage" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.color} onChange={e => setVehicle({ ...vehicle, color: e.target.value })} placeholder="Color" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              </div>
            </div>
          </CfgCard>
          <CfgCard title="CPO Program">
            <div className="space-y-2">
              <input value={cpoProgram} onChange={e => setCpoProgram(e.target.value)} placeholder="e.g. Honda Certified Pre-Owned" className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              <input value={cpoWarranty} onChange={e => setCpoWarranty(e.target.value)} placeholder="Warranty coverage" className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              <input value={inspectionPoints} onChange={e => setInspectionPoints(e.target.value)} placeholder="Inspection points (e.g. 150+)" className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              <textarea value={reconditioning} onChange={e => setReconditioning(e.target.value)} placeholder="Reconditioning performed..." rows={3} className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm outline-none resize-y" />
              <input value={carfaxUrl} onChange={e => setCarfaxUrl(e.target.value)} placeholder="Carfax report URL (optional)" className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
            </div>
          </CfgCard>
          <CfgCard title="Benefits (one per line)">
            <textarea value={benefits.join("\n")} onChange={e => setBenefits(e.target.value.split("\n"))} rows={5} className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm outline-none resize-y" />
          </CfgCard>
        </div>

        <div className="lg:col-span-3">
          <p className="text-[11px] font-semibold uppercase tracking-label text-muted-foreground mb-2 no-print">Preview</p>
          <div ref={cardRef} className="bg-white rounded-lg border-2 border-foreground overflow-hidden shadow-premium-lg mx-auto" style={{ maxWidth: "600px" }}>
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-700 to-emerald-900 text-white px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {dealerLogo && <div className="bg-white rounded p-1.5"><img src={dealerLogo} alt="" className="h-8 object-contain" /></div>}
                  <div>
                    <p className="text-base font-bold">{dealerName}</p>
                    <p className="text-[10px] text-white/70">{currentStore?.tagline || settings.dealer_tagline}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5">
                  <Award className="w-4 h-4" />
                  <span className="text-xs font-bold">CERTIFIED</span>
                </div>
              </div>
            </div>

            {/* CPO program banner */}
            <div className="px-5 py-3 bg-emerald-50 border-b-2 border-emerald-700 text-center">
              <p className="text-sm font-bold text-emerald-900">{cpoProgram || "Certified Pre-Owned"}</p>
              <p className="text-[10px] text-emerald-700 mt-0.5">{inspectionPoints}-Point Inspection Completed</p>
            </div>

            {/* Vehicle info */}
            <div className="px-5 py-3 border-b border-foreground">
              <p className="text-xl font-bold tracking-tight text-foreground">{vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}</p>
              <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                <span className="font-mono">{vehicle.vin || "VIN pending"}</span>
                {vehicle.stock && <span>Stock: {vehicle.stock}</span>}
                {vehicle.mileage && <span>{parseInt(vehicle.mileage).toLocaleString()} mi</span>}
                {vehicle.color && <span>{vehicle.color}</span>}
              </div>
            </div>

            {/* Warranty */}
            <div className="px-5 py-3 border-b border-foreground">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <p className="text-[10px] font-bold text-foreground uppercase tracking-wider">CPO Warranty Coverage</p>
              </div>
              <p className="text-xs text-foreground leading-relaxed">{cpoWarranty}</p>
            </div>

            {/* Benefits */}
            {benefits.filter(Boolean).length > 0 && (
              <div className="px-5 py-3 border-b border-foreground">
                <p className="text-[10px] font-bold text-foreground uppercase tracking-wider mb-2">Certified Benefits</p>
                <div className="space-y-1">
                  {benefits.filter(Boolean).map((b, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span>{b.trim()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reconditioning */}
            {reconditioning && (
              <div className="px-5 py-3 border-b border-foreground">
                <p className="text-[10px] font-bold text-foreground uppercase tracking-wider mb-1">Reconditioning Performed</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{reconditioning}</p>
              </div>
            )}

            {/* QR / Carfax */}
            <div className="px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-[8px] font-bold text-foreground">Scan for full vehicle details</p>
                {carfaxUrl && <p className="text-[7px] text-blue-600 mt-0.5">Vehicle History Report available</p>}
              </div>
              {vehicle.vin && <QRCodeSVG value={carfaxUrl || `${window.location.origin}/vehicle/${vehicle.vin}`} size={50} />}
            </div>

            <div className="text-center py-1.5 bg-emerald-800 text-white text-[8px] font-semibold">
              {dealerName} · Certified Pre-Owned
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const CfgCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-card rounded-xl border border-border shadow-premium p-4">
    <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
    {children}
  </div>
);

export default CpoSheet;
