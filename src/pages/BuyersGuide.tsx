import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { resolveBuyersGuideWarranty } from "@/lib/stateCompliance";
import { useVehiclePrefill, VehicleContextHeader } from "@/lib/vehiclePrefill";

type GuideType = "as-is" | "implied" | "warranty";

type VehicleInfo = {
  year: string;
  make: string;
  model: string;
  vin: string;
  stock: string;
  mileage: string;
  price: string;
};

const WARRANTY_SYSTEMS = ["Engine", "Transmission", "Drive System", "Brakes", "Electrical", "Air Conditioning", "Other"];

const DEFECT_COLUMNS = [
  [
    { heading: "Frame & Body", items: ["Frame-cracks, corrective welds, or rusted through", "Dog tracks-bent or twisted frame"] },
    { heading: "Engine", items: ["Oil leakage, excluding normal seepage", "Cracked block or head", "Belts missing or inoperable", "Knocks or misses related to camshaft lifters and push rods", "Abnormal exhaust discharge"] },
    { heading: "Transmission & Drive Shaft", items: ["Improper fluid level or leakage, excluding normal seepage", "Cracked or damaged case which is visible", "Abnormal noise or vibration caused by faulty transmission or drive shaft", "Improper shifting or functioning in any gear", "Manual clutch slips or chatters"] },
    { heading: "Differential", items: ["Improper fluid level or leakage, excluding normal seepage", "Cracked or damaged housing which is visible", "Abnormal noise or vibration caused by faulty differential"] },
    { heading: "Cooling System", items: ["Leakage including radiator", "Improperly functioning water pump"] },
    { heading: "Electrical System", items: ["Battery leakage", "Improperly functioning alternator, generator, battery, or starter"] },
    { heading: "Fuel System", items: ["Visible leakage"] },
  ],
  [
    { heading: "Inoperable Accessories", items: ["Gauges or warning devices", "Air conditioner", "Heater & Defroster"] },
    { heading: "Brake System", items: ["Failure warning light broken", "Pedal not firm under pressure (DOT spec.)", "Not enough pedal reserve (DOT spec.)", "Does not stop vehicle in straight line (DOT spec.)", "Hoses damaged", "Drum or rotor too thin (Mfgr. Specs)", "Lining or pad thickness less than 1/32 inch", "Power unit not operating or leaking", "Structural or mechanical parts damaged"] },
    { heading: "Air Bags", items: [] },
    { heading: "Steering System", items: ["Too much free play at steering wheel (DOT specs.)", "Free play in linkage more than 1/4 inch", "Steering gear binds or jams", "Front wheels aligned improperly (DOT specs.)", "Power unit belts cracked or slipping", "Power unit fluid level improper"] },
    { heading: "Suspension System", items: ["Ball joint seals damaged", "Structural parts bent or damaged", "Stabilizer bar disconnected", "Spring broken", "Shock absorber mounting loose", "Rubber bushings damaged or missing", "Radius rod damaged or missing", "Shock absorber leaking or functioning improperly"] },
    { heading: "Tires", items: ["Tread depth less than 2/32 inch", "Sizes mismatched", "Visible damage"] },
    { heading: "Wheels", items: ["Visible cracks, damage or repairs", "Mounting bolts loose or missing"] },
    { heading: "Exhaust System", items: ["Leakage", "Catalytic Converter"] },
  ],
];

const clean = (value: unknown) => `${value || ""}`.trim();
const dealerLine = (...parts: unknown[]) => parts.map(clean).filter(Boolean).join(", ");

const BuyersGuide = () => {
  const navigate = useNavigate();
  const { settings } = useDealerSettings();
  const ds = settings as unknown as Record<string, string | undefined>;
  const { currentStore } = useTenant();
  const { user } = useAuth();
  const { log } = useAudit();
  const prefill = useVehiclePrefill();
  const printRef = useRef<HTMLDivElement>(null);

  const [vehicle, setVehicle] = useState<VehicleInfo>({ year: "", make: "", model: "", vin: "", stock: "", mileage: "", price: "" });
  const [guideType, setGuideType] = useState<GuideType>("as-is");
  const [laborPct, setLaborPct] = useState("100");
  const [partsPct, setPartsPct] = useState("100");
  const [systemsCovered, setSystemsCovered] = useState("");
  const [duration, setDuration] = useState("");
  const [serviceContractAvailable, setServiceContractAvailable] = useState(true);
  const [manufacturerWarrantyStillApplies, setManufacturerWarrantyStillApplies] = useState(false);
  const [manufacturerUsedWarrantyApplies, setManufacturerUsedWarrantyApplies] = useState(false);
  const [otherUsedWarrantyApplies, setOtherUsedWarrantyApplies] = useState(false);
  const [customerName, setCustomerName] = useState("");

  useEffect(() => {
    const v = prefill.vehicle;
    if (!v) return;
    setVehicle((prev) => ({
      ...prev,
      year: v.year || prev.year,
      make: v.make || prev.make,
      model: v.model || prev.model,
      vin: v.vin || prev.vin,
      stock: v.stock || prev.stock,
      mileage: v.mileage || prev.mileage,
      price: v.price || prev.price,
    }));
  }, [prefill.vehicle]);

  const operatingState = ds.dealer_state || ds.doc_fee_state || "";
  const bgResolution = useMemo(
    () => resolveBuyersGuideWarranty(operatingState, {
      ageYears: vehicle.year ? new Date().getFullYear() - Number(vehicle.year) : undefined,
      mileage: vehicle.mileage ? Number(vehicle.mileage.replace(/[^0-9]/g, "")) : undefined,
      price: vehicle.price ? Number(vehicle.price.replace(/[^0-9.]/g, "")) : undefined,
    }),
    [operatingState, vehicle.year, vehicle.mileage, vehicle.price],
  );

  useEffect(() => {
    setGuideType(bgResolution.box);
    if (bgResolution.box === "warranty" && bgResolution.minDurationDays > 0) {
      setDuration(`${bgResolution.minDurationDays} Days / ${bgResolution.minMiles.toLocaleString()} Miles`);
      setLaborPct(`${bgResolution.minPct}`);
      setPartsPct(`${bgResolution.minPct}`);
    }
  }, [bgResolution]);

  const dealerName = ds.dealer_name || currentStore?.name || "";
  const dealerAddress = dealerLine(ds.dealer_address, ds.dealer_city, ds.dealer_state, ds.dealer_zip);
  const dealerPhone = ds.dealer_phone || ds.service_phone || "";
  const dealerEmail = ds.service_email || ds.dealer_email || "";
  const complaintContact = ds.service_manager_name || ds.service_contact_name || "Service Manager";

  const handlePrint = () => window.print();

  const handleSave = () => {
    const record = {
      id: crypto.randomUUID(),
      store_id: currentStore?.id || "",
      vehicle_vin: vehicle.vin,
      vehicle_ymm: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
      guide_type: guideType,
      warranty_duration: duration,
      labor_percentage: laborPct,
      parts_percentage: partsPct,
      systems_covered: systemsCovered,
      customer_name: customerName,
      created_by: user?.id || "",
      created_at: new Date().toISOString(),
    };
    const saved = JSON.parse(localStorage.getItem("buyers_guides") || "[]");
    saved.push(record);
    localStorage.setItem("buyers_guides", JSON.stringify(saved));
    log({ store_id: currentStore?.id || "", user_id: user?.id || "", action: "buyers_guide_created", entity_type: "buyers_guide", entity_id: record.id, details: { vin: vehicle.vin, type: guideType, official_ftc_copy: true } });
    toast.success("Official FTC Buyers Guide saved");
  };

  const handleDownloadPdf = async () => {
    const card = printRef.current;
    if (!card) return;
    try {
      const { default: html2canvas } = await import("html2canvas-pro");
      const { default: jsPDF } = await import("jspdf");
      const { archivePdf, persistArchivedPdf } = await import("@/lib/pdfArchive");
      const pages = Array.from(card.querySelectorAll(".buyers-guide-page")) as HTMLElement[];
      const pdf = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
      for (let i = 0; i < pages.length; i += 1) {
        const canvas = await html2canvas(pages[i], { scale: 2, useCORS: true, onclone: (await import("@/lib/html2canvasInputs")).replaceInputsForCanvas } as any);
        const imgData = canvas.toDataURL("image/jpeg", 0.95);
        if (i > 0) pdf.addPage("letter", "portrait");
        pdf.addImage(imgData, "JPEG", 0, 0, 8.5, 11);
      }
      await archivePdf(pdf, { vehicle, guideType, officialFtcCopy: true }, { tenantId: currentStore?.id || null, tenantName: currentStore?.name || null, vin: vehicle.vin || null });
      pdf.save(`Official-FTC-Buyers-Guide-${vehicle.vin || "draft"}.pdf`);
      persistArchivedPdf(pdf, { docType: "buyers_guide", entityId: vehicle.vin || `buyers-guide-${Date.now()}`, vin: vehicle.vin || null }).catch(() => undefined);
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error("Could not generate PDF");
    }
  };

  const Checkbox = ({ checked }: { checked: boolean }) => (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center border border-black text-[11px] font-black leading-none">{checked ? "X" : ""}</span>
  );

  return (
    <div className="min-h-screen bg-background px-2 py-4 md:px-4">
      {prefill.active && <div className="mx-auto mb-3 max-w-[8.5in]"><VehicleContextHeader state={prefill} /></div>}

      <div className="no-print mx-auto mb-3 flex max-w-[8.5in] flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <button onClick={() => navigate("/addendum")} className="rounded-xl bg-navy px-4 py-2 text-sm font-bold text-primary-foreground">Back</button>
        <div className="flex rounded-xl bg-muted p-1">
          {(["as-is", "implied", "warranty"] as GuideType[]).map((type) => (
            <button key={type} onClick={() => setGuideType(type)} className={`rounded-lg px-3 py-1.5 text-xs font-black ${guideType === type ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
              {type === "as-is" ? "As-Is / CT" : type === "implied" ? "Implied State" : "Dealer Warranty"}
            </button>
          ))}
        </div>
        <button onClick={handlePrint} className="rounded-xl bg-navy px-4 py-2 text-sm font-bold text-primary-foreground">Print</button>
        <button onClick={handleDownloadPdf} className="rounded-xl bg-navy px-4 py-2 text-sm font-bold text-primary-foreground">Download PDF</button>
        <button onClick={handleSave} className="rounded-xl bg-teal px-4 py-2 text-sm font-bold text-primary-foreground">Save Guide</button>
        {bgResolution.reason && <p className="w-full text-xs font-semibold text-amber-700">State-aware warranty helper: {bgResolution.reason}{bgResolution.citation ? ` (${bgResolution.citation})` : ""}. Confirm with counsel.</p>}
      </div>

      <div ref={printRef} className="mx-auto max-w-[8.5in] space-y-4 print:space-y-0">
        <section className="buyers-guide-page mx-auto min-h-[11in] w-[8.5in] bg-white p-[0.35in] text-black shadow-lg print:shadow-none">
          <div className="flex h-full min-h-[10.3in] flex-col border-2 border-black">
            <header className="border-b-2 border-black px-4 py-3 text-center">
              <h1 className="text-4xl font-black tracking-tight">BUYERS GUIDE</h1>
              <p className="mt-1 text-[12px] font-bold">IMPORTANT: Spoken promises are difficult to enforce. Ask the dealer to put all promises in writing. Keep this form.</p>
            </header>

            <div className="grid grid-cols-[1fr_1fr_0.6fr_1.35fr] border-b-2 border-black text-[11px] font-bold uppercase">
              <Field label="Vehicle Make" value={vehicle.make} onChange={(v) => setVehicle({ ...vehicle, make: v })} />
              <Field label="Model" value={vehicle.model} onChange={(v) => setVehicle({ ...vehicle, model: v })} />
              <Field label="Year" value={vehicle.year} onChange={(v) => setVehicle({ ...vehicle, year: v })} />
              <Field label="Vehicle Identification Number (VIN)" value={vehicle.vin} onChange={(v) => setVehicle({ ...vehicle, vin: v })} mono />
            </div>

            <main className="flex-1 px-5 py-4 text-[12px] leading-tight">
              <h2 className="mb-3 text-[15px] font-black uppercase">Warranties for this vehicle:</h2>

              {guideType !== "implied" && (
                <WarrantyOption checked={guideType === "as-is"} title="AS IS - NO DEALER WARRANTY">
                  <p className="font-black uppercase">The dealer does not provide a warranty for any repairs after sale.</p>
                </WarrantyOption>
              )}

              {guideType === "implied" && (
                <WarrantyOption checked title="IMPLIED WARRANTIES ONLY">
                  <p>The dealer doesn&apos;t make any promises to fix things that need repair when you buy the vehicle or afterward. But implied warranties under your state&apos;s laws may give you some rights to have the dealer take care of serious problems that were not apparent when you bought the vehicle.</p>
                </WarrantyOption>
              )}

              <div className="mt-3">
                <div className="flex items-start gap-2">
                  <Checkbox checked={guideType === "warranty"} />
                  <div className="flex-1">
                    <h3 className="text-[14px] font-black uppercase">Dealer Warranty</h3>
                    <div className="mt-2 flex items-center gap-5">
                      <label className="flex items-center gap-2"><Checkbox checked={false} /> <span className="font-bold">FULL WARRANTY.</span></label>
                      <label className="flex items-center gap-2"><Checkbox checked={guideType === "warranty"} /> <span className="font-bold">LIMITED WARRANTY.</span></label>
                    </div>
                    <p className="mt-2">The dealer will pay <InlineInput value={laborPct} onChange={setLaborPct} width="3rem" />% of the labor and <InlineInput value={partsPct} onChange={setPartsPct} width="3rem" />% of the parts for the covered systems that fail during the warranty period. Ask the dealer for a copy of the warranty, and for any documents that explain warranty coverage, exclusions, and the dealer&apos;s repair obligations. Implied warranties under your state&apos;s laws may give you additional rights.</p>
                    <div className="mt-3 grid grid-cols-2 gap-4">
                      <TextArea label="SYSTEMS COVERED:" value={systemsCovered} onChange={setSystemsCovered} placeholder={WARRANTY_SYSTEMS.join(", ")} />
                      <TextArea label="DURATION:" value={duration} onChange={setDuration} placeholder="Example: 60 Days / 3,000 Miles" />
                    </div>
                  </div>
                </div>
              </div>

              <h2 className="mb-2 mt-4 text-[15px] font-black uppercase">Non-Dealer Warranties for this Vehicle:</h2>
              <div className="space-y-1.5">
                <CheckLine checked={manufacturerWarrantyStillApplies} onClick={() => setManufacturerWarrantyStillApplies(!manufacturerWarrantyStillApplies)} text="MANUFACTURER'S WARRANTY STILL APPLIES. The manufacturer's original warranty has not expired on some components of the vehicle." />
                <CheckLine checked={manufacturerUsedWarrantyApplies} onClick={() => setManufacturerUsedWarrantyApplies(!manufacturerUsedWarrantyApplies)} text="MANUFACTURER'S USED VEHICLE WARRANTY APPLIES." />
                <CheckLine checked={otherUsedWarrantyApplies} onClick={() => setOtherUsedWarrantyApplies(!otherUsedWarrantyApplies)} text="OTHER USED VEHICLE WARRANTY APPLIES." />
              </div>
              <p className="mt-2">Ask the dealer for a copy of the warranty document and an explanation of warranty coverage, exclusions, and repair obligations.</p>

              <div className="mt-4">
                <CheckLine checked={serviceContractAvailable} onClick={() => setServiceContractAvailable(!serviceContractAvailable)} text="SERVICE CONTRACT. A service contract on this vehicle is available for an extra charge. Ask for details about coverage, deductible, price, and exclusions. If you buy a service contract within 90 days of your purchase of this vehicle, implied warranties under your state&apos;s laws may give you additional rights." />
              </div>

              <p className="mt-5 text-[13px] font-black uppercase">Ask the dealer if your mechanic can inspect the vehicle on or off the lot.</p>
              <p className="mt-4 text-[13px] font-black uppercase">Obtain a vehicle history report and check for open safety recalls.</p>
              <p className="mt-1">For information on how to obtain a vehicle history report, visit ftc.gov/usedcars. To check for open safety recalls, visit safercar.gov. You will need the vehicle identification number (VIN) shown above to make the best use of the resources on these sites.</p>
              <p className="mt-5 text-[13px] font-black uppercase">See other side for important additional information, including a list of major defects that may occur in used motor vehicles.</p>
              <p className="mt-4 text-[12px]">Si el concesionario gestiona la venta en español, pídale una copia de la Guía del Comprador en español.</p>
            </main>
          </div>
        </section>

        <section className="buyers-guide-page mx-auto min-h-[11in] w-[8.5in] bg-white p-[0.35in] text-black shadow-lg print:break-before-page print:shadow-none">
          <div className="flex h-full min-h-[10.3in] flex-col border-2 border-black p-4">
            <p className="mb-3 text-[13px] font-bold">Here is a list of some major defects that may occur in used vehicles.</p>
            <div className="grid flex-1 grid-cols-2 gap-x-6 text-[10px] leading-tight">
              {DEFECT_COLUMNS.map((column, index) => (
                <div key={index} className="space-y-2">
                  {column.map((group) => (
                    <div key={group.heading}>
                      <h3 className="font-black">{group.heading}</h3>
                      {group.items.map((item) => <p key={item}>{item}</p>)}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="mt-4 border-t-2 border-black pt-3 text-[11px]">
              <div className="grid grid-cols-[1fr_1.2fr] gap-3">
                <FooterLine label="DEALER NAME" value={dealerName} />
                <FooterLine label="ADDRESS" value={dealerAddress} />
                <FooterLine label="TELEPHONE" value={dealerPhone} />
                <FooterLine label="EMAIL" value={dealerEmail} />
              </div>
              <div className="mt-3 grid grid-cols-[1fr_1fr] gap-3">
                <FooterLine label="FOR COMPLAINTS AFTER SALE, CONTACT" value={complaintContact} />
                <FooterLine label="CUSTOMER ACKNOWLEDGEMENT / SIGNATURE" value={customerName} onChange={setCustomerName} />
              </div>
              <p className="mt-3 text-[11px] font-bold">IMPORTANT: The information on this form is part of any contract to buy this vehicle. Removing this label before consumer purchase (except for purpose of test-driving) violates federal law (16 C.F.R. 455).</p>
            </div>
          </div>
        </section>
      </div>

      <style>{`@media print { .no-print { display: none !important; } body { background: white; } .buyers-guide-page { box-shadow: none !important; margin: 0 !important; page-break-after: always; } @page { size: letter; margin: 0; } }`}</style>
    </div>
  );
};

function Field({ label, value, onChange, mono = false }: { label: string; value: string; onChange: (value: string) => void; mono?: boolean }) {
  return (
    <label className="border-r-2 border-black px-2 py-2 last:border-r-0">
      <span className="block text-[9px] font-black uppercase">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 w-full border-0 bg-transparent p-0 text-[13px] font-bold outline-none ${mono ? "font-mono" : ""}`} />
    </label>
  );
}

function InlineInput({ value, onChange, width }: { value: string; onChange: (value: string) => void; width: string }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} style={{ width }} className="mx-1 border-b border-black bg-transparent text-center font-bold outline-none" />;
}

function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label>
      <span className="block text-[11px] font-black uppercase">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 min-h-[3.2rem] w-full resize-none border border-black bg-transparent p-1 text-[11px] outline-none" />
    </label>
  );
}

function WarrantyOption({ checked, title, children }: { checked: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center border border-black text-[11px] font-black leading-none">{checked ? "X" : ""}</span>
      <div>
        <h3 className="text-[14px] font-black uppercase">{title}</h3>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

function CheckLine({ checked, text, onClick }: { checked: boolean; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-2 text-left">
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center border border-black text-[11px] font-black leading-none">{checked ? "X" : ""}</span>
      <span dangerouslySetInnerHTML={{ __html: text }} />
    </button>
  );
}

function FooterLine({ label, value, onChange }: { label: string; value: string; onChange?: (value: string) => void }) {
  return (
    <label>
      <span className="block text-[9px] font-black uppercase">{label}</span>
      {onChange ? (
        <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full border-b border-black bg-transparent text-[12px] font-bold outline-none" />
      ) : (
        <div className="mt-1 min-h-[1.25rem] border-b border-black text-[12px] font-bold">{value}</div>
      )}
    </label>
  );
}

export default BuyersGuide;
