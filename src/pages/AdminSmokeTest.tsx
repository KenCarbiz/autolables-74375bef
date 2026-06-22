import { useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, FileCheck2, ShieldCheck, Wand2 } from "lucide-react";
import {
  DEFAULT_CT_MVP_INPUT,
  evaluateCtMvpRules,
  type CtMvpVehicleInput,
} from "@/lib/ctMvp/ruleEngine";

type FieldProps = {
  label: string;
  children: React.ReactNode;
};

const Field = ({ label, children }: FieldProps) => (
  <label className="space-y-1.5">
    <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
    {children}
  </label>
);

const inputClass = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
const selectClass = `${inputClass} appearance-none`;

const OutputCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
    <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
  </div>
);

const AdminSmokeTest = () => {
  const [input, setInput] = useState<CtMvpVehicleInput>(DEFAULT_CT_MVP_INPUT);
  const result = useMemo(() => evaluateCtMvpRules(input), [input]);

  const update = <K extends keyof CtMvpVehicleInput>(key: K, value: CtMvpVehicleInput[K]) => {
    setInput((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Connecticut MVP validation
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">Admin Smoke Test</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Enter one vehicle and verify the complete document decision chain: sticker, addendum, FTC Buyers Guide, K208,
            passport, trust source, and dealer program.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInput(DEFAULT_CT_MVP_INPUT)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted"
        >
          <Wand2 className="h-4 w-4" /> Reset sample
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.25fr]">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Vehicle Inputs</h2>
              <p className="text-xs text-muted-foreground">Required fields for the Connecticut rule engine.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="VIN">
              <input className={inputClass} value={input.vin} onChange={(e) => update("vin", e.target.value)} />
            </Field>
            <Field label="Stock Number">
              <input className={inputClass} value={input.stock} onChange={(e) => update("stock", e.target.value)} />
            </Field>
            <Field label="Year">
              <input className={inputClass} value={input.year} onChange={(e) => update("year", e.target.value)} />
            </Field>
            <Field label="Make">
              <input className={inputClass} value={input.make} onChange={(e) => update("make", e.target.value)} />
            </Field>
            <Field label="Model">
              <input className={inputClass} value={input.model} onChange={(e) => update("model", e.target.value)} />
            </Field>
            <Field label="Mileage">
              <input className={inputClass} value={input.mileage} onChange={(e) => update("mileage", e.target.value)} />
            </Field>
            <Field label="State">
              <input className={inputClass} value={input.state} onChange={(e) => update("state", e.target.value)} />
            </Field>
            <Field label="New / Used">
              <select className={selectClass} value={input.condition} onChange={(e) => update("condition", e.target.value as CtMvpVehicleInput["condition"])}>
                <option value="used">Used</option>
                <option value="new">New</option>
              </select>
            </Field>
            <Field label="CPO Status">
              <select className={selectClass} value={input.cpoStatus} onChange={(e) => update("cpoStatus", e.target.value as CtMvpVehicleInput["cpoStatus"])}>
                <option value="none">None</option>
                <option value="dealer">Dealer CPO</option>
                <option value="oem">OEM CPO</option>
              </select>
            </Field>
            <Field label="Passport">
              <select className={selectClass} value={input.passportEnabled ? "on" : "off"} onChange={(e) => update("passportEnabled", e.target.value === "on") }>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div>
                <h2 className="text-base font-semibold text-foreground">Rule Outputs</h2>
                <p className="text-xs text-muted-foreground">What AutoLabels would generate for this vehicle.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <OutputCard label="Selected Window Sticker" value={result.selectedWindowSticker} />
              <OutputCard label="Selected Addendum" value={result.selectedAddendum} />
              <OutputCard label="FTC Buyers Guide" value={result.ftcBuyersGuide === "required" ? "Required" : "Not required"} />
              <OutputCard label="K208" value={result.k208 === "required" ? "Required" : "Not required"} />
              <OutputCard label="Passport Status" value={result.passportStatus === "enabled" ? "Enabled" : "Disabled"} />
              <OutputCard label="Trust Source" value={result.trustSource} />
              <OutputCard label="Dealer Program" value={result.dealerProgram} />
              <OutputCard label="Theme" value={result.theme} />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="text-base font-semibold text-foreground">Validation Checklist</h2>
            <p className="mt-1 text-xs text-muted-foreground">This is the master smoke test before automating production workflows.</p>
            <div className="mt-4 space-y-2">
              {result.checklist.map((item) => (
                <div key={item.label} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                  {item.status === "pass" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminSmokeTest;
