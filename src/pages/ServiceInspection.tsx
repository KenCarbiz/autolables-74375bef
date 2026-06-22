import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BadgeCheck, BatteryCharging, Camera, Car, CheckCircle2, ClipboardCheck, Gauge, Save, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";

type InvestmentItem = {
  label: string;
  amount: string;
  detail: string;
  showOnPassport: boolean;
};

const defaultInvestmentItems: InvestmentItem[] = [
  { label: "Safety inspection", amount: "", detail: "Multi-point used vehicle inspection", showOnPassport: false },
  { label: "Oil service", amount: "", detail: "Fresh service before retail delivery", showOnPassport: false },
  { label: "Alignment check", amount: "", detail: "Ride and tire-wear confidence", showOnPassport: false },
];

const statusOptions = ["Not checked", "Good", "Needs attention", "Completed", "N/A"];

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);

const inputClass = "h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
const textareaClass = "min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
const selectClass = inputClass;

export default function ServiceInspection() {
  const { qrToken } = useParams();
  const [saving, setSaving] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    vin: "",
    stock: "",
    mileage: "",
    technicianName: "",
    advisorName: "",
    tiresFrontLeft: "",
    tiresFrontRight: "",
    tiresRearLeft: "",
    tiresRearRight: "",
    frontBrakes: "",
    rearBrakes: "",
    batteryStatus: "Not checked",
    fluidsStatus: "Not checked",
    alignmentStatus: "Not checked",
    warningLightsStatus: "Not checked",
    roadTestStatus: "Not checked",
    reconSummary: "",
    technicianNotes: "",
    customerVisibleNotes: "",
    showOnPassport: false,
  });
  const [investmentItems, setInvestmentItems] = useState<InvestmentItem[]>(defaultInvestmentItems);

  const healthComplete = useMemo(() => {
    const items = [form.batteryStatus, form.fluidsStatus, form.alignmentStatus, form.warningLightsStatus, form.roadTestStatus];
    return items.filter((item) => item && item !== "Not checked").length;
  }, [form]);

  const investmentTotal = useMemo(() => investmentItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0), [investmentItems]);

  const update = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  const updateInvestment = (index: number, key: keyof InvestmentItem, value: string | boolean) => {
    setInvestmentItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  };

  const addInvestmentItem = () => {
    setInvestmentItems((items) => [...items, { label: "", amount: "", detail: "", showOnPassport: false }]);
  };

  const save = async () => {
    if (!form.vin.trim() && !form.stock.trim() && !qrToken) {
      toast.error("Enter a VIN or stock number before saving.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        vin: form.vin.trim() || null,
        stock: form.stock.trim() || null,
        qr_token: qrToken || null,
        inspection_status: "submitted",
        manager_approval_status: form.showOnPassport ? "pending" : "hidden",
        technician_name: form.technicianName.trim() || null,
        advisor_name: form.advisorName.trim() || null,
        mileage: form.mileage ? Number(form.mileage) : null,
        tires_front_left: form.tiresFrontLeft.trim() || null,
        tires_front_right: form.tiresFrontRight.trim() || null,
        tires_rear_left: form.tiresRearLeft.trim() || null,
        tires_rear_right: form.tiresRearRight.trim() || null,
        front_brakes: form.frontBrakes.trim() || null,
        rear_brakes: form.rearBrakes.trim() || null,
        battery_status: form.batteryStatus,
        fluids_status: form.fluidsStatus,
        alignment_status: form.alignmentStatus,
        warning_lights_status: form.warningLightsStatus,
        road_test_status: form.roadTestStatus,
        recon_summary: form.reconSummary.trim() || null,
        technician_notes: form.technicianNotes.trim() || null,
        customer_visible_notes: form.customerVisibleNotes.trim() || null,
        show_on_passport: form.showOnPassport,
      };

      const { data, error } = await (supabase as any)
        .from("used_vehicle_inspections")
        .insert(payload)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      const inspectionId = data?.id as string;
      setSubmittedId(inspectionId);

      const rows = investmentItems
        .filter((item) => item.label.trim() || item.amount.trim() || item.detail.trim())
        .map((item) => ({
          inspection_id: inspectionId,
          vin: form.vin.trim() || null,
          stock: form.stock.trim() || null,
          label: item.label.trim() || "Investment item",
          amount: item.amount ? Number(item.amount) : null,
          detail: item.detail.trim() || null,
          show_on_passport: item.showOnPassport,
        }));

      if (rows.length) {
        const { error: itemError } = await (supabase as any).from("used_vehicle_investment_items").insert(rows);
        if (itemError) throw itemError;
      }

      toast.success("Inspection saved for manager review");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not save inspection");
    } finally {
      setSaving(false);
    }
  };

  if (submittedId) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-6 text-white">
        <div className="mx-auto max-w-xl rounded-[2rem] border border-white/10 bg-white/10 p-6 text-center shadow-2xl backdrop-blur">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400 text-slate-950"><CheckCircle2 className="h-9 w-9" /></div>
          <h1 className="mt-5 text-3xl font-black">Inspection submitted</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/70">This used-car inspection is saved and ready for manager approval before anything appears on the customer Passport.</p>
          <div className="mt-5 rounded-2xl bg-slate-950/50 p-4 text-left text-xs text-white/70">
            <p><span className="font-black text-white">Inspection ID:</span> {submittedId}</p>
            <p><span className="font-black text-white">QR:</span> {qrToken || "Manual entry"}</p>
          </div>
          <button onClick={() => setSubmittedId(null)} className="mt-5 h-11 rounded-xl bg-white px-5 text-sm font-black text-slate-950">Start another inspection</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-blue-700"><ClipboardCheck className="h-3.5 w-3.5" /> Service QR Intake</div>
            <h1 className="mt-1 text-xl font-black tracking-tight">Used Vehicle Inspection</h1>
          </div>
          <button disabled={saving} onClick={save} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 disabled:opacity-60"><Save className="h-4 w-4" /> {saving ? "Saving" : "Save"}</button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5 pb-28">
        <section className="rounded-[2rem] bg-slate-950 p-5 text-white shadow-xl">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-white p-3 text-slate-950"><Car className="h-6 w-6" /></div>
            <div>
              <h2 className="text-2xl font-black">Scan once. Use everywhere.</h2>
              <p className="mt-1 text-sm leading-relaxed text-white/70">Enter service and recon proof here. After manager approval, the same data can power the Passport, Vehicle Health Report, Dealer Investment Report, and story timeline.</p>
              <p className="mt-3 text-xs font-semibold text-white/50">QR token: {qrToken || "Manual inspection"}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">Vehicle</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="VIN"><input className={inputClass} value={form.vin} onChange={(e) => update("vin", e.target.value)} placeholder="VIN" /></Field>
            <Field label="Stock"><input className={inputClass} value={form.stock} onChange={(e) => update("stock", e.target.value)} placeholder="Stock #" /></Field>
            <Field label="Mileage"><input className={inputClass} value={form.mileage} onChange={(e) => update("mileage", e.target.value)} inputMode="numeric" placeholder="Mileage" /></Field>
            <Field label="Technician"><input className={inputClass} value={form.technicianName} onChange={(e) => update("technicianName", e.target.value)} placeholder="Technician name" /></Field>
            <Field label="Advisor"><input className={inputClass} value={form.advisorName} onChange={(e) => update("advisorName", e.target.value)} placeholder="Advisor name" /></Field>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="text-lg font-black">Vehicle Health</h2><p className="text-sm text-slate-500">{healthComplete}/5 major checks completed</p></div>
            <Gauge className="h-6 w-6 text-blue-600" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Front left tire"><input className={inputClass} value={form.tiresFrontLeft} onChange={(e) => update("tiresFrontLeft", e.target.value)} placeholder="Example: 8/32" /></Field>
            <Field label="Front right tire"><input className={inputClass} value={form.tiresFrontRight} onChange={(e) => update("tiresFrontRight", e.target.value)} placeholder="Example: 8/32" /></Field>
            <Field label="Rear left tire"><input className={inputClass} value={form.tiresRearLeft} onChange={(e) => update("tiresRearLeft", e.target.value)} placeholder="Example: 7/32" /></Field>
            <Field label="Rear right tire"><input className={inputClass} value={form.tiresRearRight} onChange={(e) => update("tiresRearRight", e.target.value)} placeholder="Example: 7/32" /></Field>
            <Field label="Front brakes"><input className={inputClass} value={form.frontBrakes} onChange={(e) => update("frontBrakes", e.target.value)} placeholder="Example: 80%" /></Field>
            <Field label="Rear brakes"><input className={inputClass} value={form.rearBrakes} onChange={(e) => update("rearBrakes", e.target.value)} placeholder="Example: 70%" /></Field>
            <Field label="Battery"><select className={selectClass} value={form.batteryStatus} onChange={(e) => update("batteryStatus", e.target.value)}>{statusOptions.map((option) => <option key={option}>{option}</option>)}</select></Field>
            <Field label="Fluids"><select className={selectClass} value={form.fluidsStatus} onChange={(e) => update("fluidsStatus", e.target.value)}>{statusOptions.map((option) => <option key={option}>{option}</option>)}</select></Field>
            <Field label="Alignment"><select className={selectClass} value={form.alignmentStatus} onChange={(e) => update("alignmentStatus", e.target.value)}>{statusOptions.map((option) => <option key={option}>{option}</option>)}</select></Field>
            <Field label="Warning lights"><select className={selectClass} value={form.warningLightsStatus} onChange={(e) => update("warningLightsStatus", e.target.value)}>{statusOptions.map((option) => <option key={option}>{option}</option>)}</select></Field>
            <Field label="Road test"><select className={selectClass} value={form.roadTestStatus} onChange={(e) => update("roadTestStatus", e.target.value)}>{statusOptions.map((option) => <option key={option}>{option}</option>)}</select></Field>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="text-lg font-black">Dealer Investment</h2><p className="text-sm text-slate-500">Visible only after approval if selected.</p></div>
            <Wrench className="h-6 w-6 text-emerald-600" />
          </div>
          <div className="mt-4 space-y-3">
            {investmentItems.map((item, index) => (
              <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                  <input className={inputClass} value={item.label} onChange={(e) => updateInvestment(index, "label", e.target.value)} placeholder="Item, e.g. Front brakes" />
                  <input className={inputClass} value={item.amount} onChange={(e) => updateInvestment(index, "amount", e.target.value)} inputMode="decimal" placeholder="$" />
                </div>
                <input className={`${inputClass} mt-2`} value={item.detail} onChange={(e) => updateInvestment(index, "detail", e.target.value)} placeholder="Detail shown to manager/customer" />
                <label className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={item.showOnPassport} onChange={(e) => updateInvestment(index, "showOnPassport", e.target.checked)} /> Candidate for Passport after approval</label>
              </div>
            ))}
            <button onClick={addInvestmentItem} className="h-10 rounded-xl border border-dashed border-slate-300 px-4 text-sm font-black text-slate-700">Add investment item</button>
            <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-900"><span className="text-xs font-black uppercase tracking-wider">Entered total</span><p className="text-2xl font-black">${investmentTotal.toLocaleString()}</p></div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">Notes & Evidence</h2>
          <div className="mt-4 space-y-3">
            <Field label="Recon summary"><textarea className={textareaClass} value={form.reconSummary} onChange={(e) => update("reconSummary", e.target.value)} placeholder="Short recon summary for internal review" /></Field>
            <Field label="Technician notes"><textarea className={textareaClass} value={form.technicianNotes} onChange={(e) => update("technicianNotes", e.target.value)} placeholder="Internal notes" /></Field>
            <Field label="Customer-visible notes"><textarea className={textareaClass} value={form.customerVisibleNotes} onChange={(e) => update("customerVisibleNotes", e.target.value)} placeholder="Plain-language notes after manager approval" /></Field>
            <button type="button" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm font-black text-slate-700"><Camera className="h-4 w-4" /> Photo upload placeholder</button>
          </div>
        </section>

        <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-6 w-6" />
            <div>
              <h2 className="text-lg font-black">Manager approval required</h2>
              <p className="mt-1 text-sm leading-relaxed">Checking this marks the inspection as a Passport candidate, but it still saves as pending manager approval before customers see it.</p>
              <label className="mt-4 flex items-center gap-2 text-sm font-black"><input type="checkbox" checked={form.showOnPassport} onChange={(e) => update("showOnPassport", e.target.checked)} /> Candidate for customer Passport</label>
            </div>
          </div>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3 shadow-2xl sm:hidden">
        <button disabled={saving} onClick={save} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-black text-white disabled:opacity-60"><Save className="h-4 w-4" /> {saving ? "Saving inspection" : "Save inspection"}</button>
      </div>
    </div>
  );
}
