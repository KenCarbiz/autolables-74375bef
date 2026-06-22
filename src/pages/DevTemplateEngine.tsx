import { useMemo, useState } from "react";
import { resolveDealerStickerDecision } from "@/components/saturday/TemplateRuleEngine";
import { decideFTCBuyersGuide } from "@/components/saturday/FTCDecisionEngine";
import FTCBuyersGuide from "@/components/saturday/FTCBuyersGuide";
import { createConnecticutK208Record, canServiceSignK208, canCustomerSignK208 } from "@/components/saturday/ConnecticutK208Workflow";
import { buildConnecticutK208AutofillPayload } from "@/components/saturday/ConnecticutK208FormSchema";
import { CONNECTICUT_FIRST_ROLLOUT_SCOPE } from "@/components/saturday/ConnecticutRolloutScope";

type SmokeVehicle = {
  year: number;
  make: string;
  model: string;
  trim: string;
  vin: string;
  stock: string;
  mileage: number;
  condition: "used" | "new";
  cpo: boolean;
  saleState: "CT";
  fuelType?: string;
  isCommercial?: boolean;
  isDemo?: boolean;
  isServiceLoaner?: boolean;
};

const dealer = {
  name: "Connecticut Demo Auto Group",
  address: "150 Weston Road",
  city: "Hartford",
  state: "CT",
  zip: "06120",
  contactNameOrPosition: "Sales Manager",
  contactPhone: "860-555-0100",
  website: "autolabels.demo",
  phone: "860-555-0100",
  labelSettings: {
    passportMode: "enabled" as const,
    marketTransparencyMode: "passport_only" as const,
    addendumPricingMode: "used_market_value_plus_addendum" as const,
  },
};

const scenarios: Record<string, SmokeVehicle> = {
  newerWarranty: {
    year: new Date().getFullYear() - 3,
    make: "INFINITI",
    model: "QX60",
    trim: "Luxe AWD",
    vin: "5N1DL1FS9PC000001",
    stock: "U1001",
    mileage: 42812,
    condition: "used",
    cpo: true,
    saleState: "CT",
    fuelType: "Gasoline",
  },
  olderAsIs: {
    year: new Date().getFullYear() - 9,
    make: "Hyundai",
    model: "Elantra",
    trim: "SE",
    vin: "KMHDH4AE0GU000002",
    stock: "U1002",
    mileage: 128450,
    condition: "used",
    cpo: false,
    saleState: "CT",
    fuelType: "Gasoline",
  },
  commercial: {
    year: new Date().getFullYear() - 6,
    make: "Ford",
    model: "Transit",
    trim: "250 Cargo Van",
    vin: "1FTYR2CM0KKB00003",
    stock: "C1003",
    mileage: 96200,
    condition: "used",
    cpo: false,
    saleState: "CT",
    fuelType: "Gasoline",
    isCommercial: true,
  },
};

const vehicleTitle = (vehicle: SmokeVehicle) => [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");

export default function DevTemplateEngine() {
  const [scenarioKey, setScenarioKey] = useState("newerWarranty");
  const [serviceComplete, setServiceComplete] = useState(false);
  const [buyerName, setBuyerName] = useState("Demo Customer");
  const vehicle = scenarios[scenarioKey];

  const result = useMemo(() => {
    const vehicleForRules = {
      ...vehicle,
      title: vehicleTitle(vehicle),
      imagePreference: "factory_clean_first" as const,
      apiFallbackImageUrl: "",
      tags: [vehicle.cpo ? "cpo" : "", vehicle.isCommercial ? "commercial" : ""].filter(Boolean),
    };

    const windowDecision = resolveDealerStickerDecision({ dealer, vehicle: vehicleForRules, templateKind: "used_window_sticker" });
    const addendumDecision = resolveDealerStickerDecision({ dealer, vehicle: vehicleForRules, templateKind: "used_addendum" });
    const ftcDecision = decideFTCBuyersGuide({
      vehicle: {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        vin: vehicle.vin,
        stock: vehicle.stock,
        mileage: vehicle.mileage,
        saleState: vehicle.saleState,
      },
      dealer,
      buyerName,
    });

    const k208Record = createConnecticutK208Record({
      dealerId: "ct-demo-store",
      vehicleId: vehicle.stock,
      vin: vehicle.vin,
      stock: vehicle.stock,
      modelYear: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      mileage: vehicle.mileage,
      warrantyDisposition: ftcDecision.warrantyCompliance.disposition === "state_required_warranty" ? "state_required_warranty" : "as_is_no_dealer_warranty",
      warrantyTermLabel: ftcDecision.warrantyCompliance.warrantyTermLabel,
    });

    const completedK208 = serviceComplete ? {
      ...k208Record,
      checklist: k208Record.checklist.map((item) => ({ ...item, status: "checked" as const, completedBy: "Service Manager", completedByRole: "service_manager" as const, completedAt: new Date().toISOString() })),
      serviceSignature: { ...k208Record.serviceSignature, signerName: "Service Manager", status: "signed" as const, signedAt: new Date().toISOString() },
    } : k208Record;

    const k208Payload = buildConnecticutK208AutofillPayload({
      record: completedK208,
      dealer: {
        dealerName: dealer.name,
        phoneNumber: dealer.phone,
        address: dealer.address,
        townCity: dealer.city,
        state: dealer.state,
        zipCode: dealer.zip,
        principal: "Dealer Principal",
        dealerLicenseNumber: "CT-DEMO-0000",
      },
      buyer: { buyerNamePrint: buyerName },
      bodyStyle: vehicle.isCommercial ? "Van" : "SUV/Sedan",
    });

    return { windowDecision, addendumDecision, ftcDecision, k208Record: completedK208, k208Payload };
  }, [vehicle, serviceComplete, buyerName]);

  const checklist = [
    { label: "Used window sticker selected", ok: Boolean(result.windowDecision.template?.id), detail: result.windowDecision.template?.name },
    { label: "Used addendum selected", ok: Boolean(result.addendumDecision.template?.id), detail: result.addendumDecision.template?.name },
    { label: "FTC decision generated", ok: result.ftcDecision.required, detail: result.ftcDecision.decisionCode },
    { label: "K-208 created", ok: Boolean(result.k208Record.id), detail: result.k208Payload.inspectionResult.code },
    { label: "Service can sign K-208", ok: canServiceSignK208(result.k208Record), detail: serviceComplete ? "Ready" : "Checklist incomplete" },
    { label: "Customer can sign K-208", ok: canCustomerSignK208(result.k208Record), detail: serviceComplete ? "Ready after service signoff" : "Blocked until service signs" },
  ];

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-6 text-slate-100">
      <section className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Connecticut MVP Smoke Test</p>
          <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-[-0.04em]">Template Engine Command Center</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">Runs the Connecticut launch chain: used window sticker, used addendum, FTC Buyers Guide, K-208, warranty decision, and launch scope.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Scenario" value={scenarioKey} onChange={setScenarioKey} options={Object.keys(scenarios)} />
              <label className="space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">Buyer<input className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} /></label>
              <button onClick={() => setServiceComplete((v) => !v)} className={`mt-5 rounded-xl px-4 py-2 text-xs font-black uppercase ${serviceComplete ? "bg-emerald-400 text-slate-950" : "bg-white/10 text-white"}`}>{serviceComplete ? "Service Complete" : "Complete Service"}</button>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {checklist.map((item) => <StatusCard key={item.label} {...item} />)}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Panel title="Vehicle + Decisions">
            <div className="rounded-2xl bg-slate-900 p-4">
              <div className="text-2xl font-black text-white">{vehicleTitle(vehicle)}</div>
              <div className="mt-1 text-sm text-slate-400">VIN {vehicle.vin} • Stock {vehicle.stock} • {vehicle.mileage.toLocaleString()} miles • {vehicle.saleState}</div>
            </div>
            <DecisionRow label="Window Sticker" value={result.windowDecision.template.name} detail={result.windowDecision.reasons.join(" • ")} />
            <DecisionRow label="Used Addendum" value={result.addendumDecision.template.name} detail={result.addendumDecision.reasons.join(" • ")} />
            <DecisionRow label="FTC Buyers Guide" value={result.ftcDecision.decisionCode} detail={result.ftcDecision.reasons.join(" • ")} />
            <DecisionRow label="K-208 Result" value={`${result.k208Payload.inspectionResult.code} - ${result.k208Payload.inspectionResult.label}`} detail={result.k208Payload.inspectionResult.description} />
          </Panel>

          <Panel title="Connecticut Launch Scope">
            <div className="space-y-2">
              {CONNECTICUT_FIRST_ROLLOUT_SCOPE.filter((item) => item.requiredForLaunch).map((item) => <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><div className="flex items-center justify-between gap-3"><div className="font-black text-white">{item.title}</div><span className="rounded-full bg-cyan-400 px-2 py-1 text-[10px] font-black uppercase text-slate-950">{item.status}</span></div><p className="mt-1 text-xs text-slate-400">{item.description}</p></div>)}
            </div>
          </Panel>
        </section>

        <section className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
          <Panel title="K-208 Autofill Preview">
            <pre className="max-h-[520px] overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-300">{JSON.stringify(result.k208Payload, null, 2)}</pre>
          </Panel>

          <Panel title="FTC Buyers Guide Render Preview">
            <div className="max-h-[720px] overflow-auto rounded-2xl bg-slate-200 p-3">
              <div className="origin-top-left scale-[0.48]">
                <FTCBuyersGuide data={result.ftcDecision.data} />
              </div>
            </div>
          </Panel>
        </section>

        {result.ftcDecision.blockingWarnings.length ? (
          <section className="rounded-3xl border border-amber-400/30 bg-amber-950/30 p-5 text-amber-100">
            <h2 className="font-black uppercase tracking-wide">Warnings Before Production</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {result.ftcDecision.blockingWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl"><h2 className="text-lg font-black tracking-[-0.02em] text-white">{title}</h2><div className="mt-4 space-y-4">{children}</div></section>;
}

function StatusCard({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return <div className={`rounded-3xl border p-4 shadow-xl ${ok ? "border-emerald-400/40 bg-emerald-950/20" : "border-amber-400/40 bg-amber-950/20"}`}><div className="text-xs font-black uppercase tracking-wide text-slate-400">{ok ? "Pass" : "Pending"}</div><div className="mt-1 font-black text-white">{label}</div><div className="mt-1 text-xs text-slate-300">{detail}</div></div>;
}

function DecisionRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-cyan-300">{label}</div><div className="mt-1 font-black text-white">{value}</div>{detail ? <p className="mt-1 text-xs text-slate-400">{detail}</p> : null}</div>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">{label}<select className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}
