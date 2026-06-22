import { useMemo, useState } from "react";
import { resolveDealerStickerDecision } from "@/components/saturday/TemplateRuleEngine";
import { decideFTCBuyersGuide } from "@/components/saturday/FTCDecisionEngine";
import FTCBuyersGuide from "@/components/saturday/FTCBuyersGuide";
import { resolveUsedVehicleWarrantyCompliance } from "@/components/saturday/UsedVehicleWarrantyCompliance";
import { createConnecticutK208Record } from "@/components/saturday/ConnecticutK208Workflow";
import { buildConnecticutK208AutofillPayload } from "@/components/saturday/ConnecticutK208FormSchema";
import { CONNECTICUT_FIRST_ROLLOUT_SCOPE } from "@/components/saturday/ConnecticutRolloutScope";
import type { DealerProfileInput, VehicleInventoryInput } from "@/components/saturday/wiring";

const DEFAULT_DEALER: DealerProfileInput = {
  name: "Harte Infiniti of Hartford",
  address: "150 Weston Road, Hartford, CT 06120",
  phone: "860-000-0000",
  website: "harteinfiniti.com",
  slogan: "Connecticut-first AutoLabels smoke test",
  labelSettings: {
    priceLabel: "Advertised Price",
    passportMode: "enabled",
    marketTransparencyMode: "passport_only",
    addendumPricingMode: "used_market_value_plus_addendum",
  },
};

const toVehicleTitle = (vehicle: VehicleInventoryInput) => [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");

export default function DevConnecticutSmokeTest() {
  const [vehicle, setVehicle] = useState<VehicleInventoryInput & Record<string, any>>({
    condition: "used",
    year: new Date().getFullYear() - 3,
    make: "INFINITI",
    model: "QX60",
    trim: "LUXE AWD",
    vin: "SAMPLEVIN123456789",
    stock: "CT1001",
    mileage: 42150,
    cpo: true,
    pricing: { advertisedPrice: 32995, marketValue: 34500 },
    specs: { bodyStyle: "SUV", fuelType: "Gasoline" },
    features: ["AWD", "Leather", "Navigation", "Heated Seats"],
  });

  const [buyerName, setBuyerName] = useState("Test Buyer");
  const [saleState, setSaleState] = useState("CT");

  const result = useMemo(() => {
    const dealer = DEFAULT_DEALER;
    const fullVehicle = { ...vehicle, title: toVehicleTitle(vehicle) } as VehicleInventoryInput & Record<string, any>;
    const isUsed = fullVehicle.condition !== "new";

    const usedWindow = isUsed ? resolveDealerStickerDecision({ dealer, vehicle: fullVehicle, templateKind: "used_window_sticker" }) : undefined;
    const usedAddendum = isUsed ? resolveDealerStickerDecision({ dealer, vehicle: fullVehicle, templateKind: "used_addendum" }) : undefined;

    const warrantyCompliance = isUsed
      ? resolveUsedVehicleWarrantyCompliance({
          saleState,
          modelYear: Number(fullVehicle.year),
          mileage: Number(fullVehicle.mileage),
          dealerOffersWrittenWarranty: Boolean(fullVehicle.cpo),
          dealerWarrantyType: "limited",
          manufacturerWarrantyStillApplies: Boolean(fullVehicle.manufacturerWarrantyStillApplies),
        })
      : undefined;

    const ftc = isUsed
      ? decideFTCBuyersGuide({
          vehicle: {
            saleState,
            year: fullVehicle.year || "",
            make: fullVehicle.make || "",
            model: fullVehicle.model || "",
            vin: fullVehicle.vin || "",
            stock: fullVehicle.stock,
            mileage: fullVehicle.mileage,
            manufacturerWarrantyStillApplies: Boolean(fullVehicle.manufacturerWarrantyStillApplies),
          },
          dealer: {
            name: dealer.name,
            address: dealer.address || "",
            state: "CT",
            contactNameOrPosition: "Sales Manager",
            contactPhone: dealer.phone,
          },
          dealerWarranty: {
            dealerOffersWrittenWarranty: Boolean(fullVehicle.cpo),
            fullWarranty: warrantyCompliance?.disposition === "state_required_warranty",
            warrantyTermLabel: warrantyCompliance?.warrantyTermLabel,
            partsCoveragePercent: warrantyCompliance?.partsAndLaborCoveragePercent,
            laborCoveragePercent: warrantyCompliance?.partsAndLaborCoveragePercent,
          },
          buyerName,
        })
      : undefined;

    const k208Record = isUsed && saleState === "CT"
      ? createConnecticutK208Record({
          dealerId: "demo-dealer-ct",
          vehicleId: String(fullVehicle.vin || fullVehicle.stock || "vehicle"),
          vin: String(fullVehicle.vin || ""),
          stock: fullVehicle.stock,
          modelYear: Number(fullVehicle.year),
          make: String(fullVehicle.make || ""),
          model: String(fullVehicle.model || ""),
          mileage: Number(fullVehicle.mileage),
          warrantyDisposition: warrantyCompliance?.disposition === "state_required_warranty" ? "state_required_warranty" : "as_is_no_dealer_warranty",
          warrantyTermLabel: warrantyCompliance?.warrantyTermLabel,
        })
      : undefined;

    const k208Payload = k208Record
      ? buildConnecticutK208AutofillPayload({
          record: k208Record,
          bodyStyle: String(fullVehicle.specs?.bodyStyle || ""),
          dealer: {
            dealerName: dealer.name,
            phoneNumber: dealer.phone || "",
            address: "150 Weston Road",
            townCity: "Hartford",
            state: "CT",
            zipCode: "06120",
            principal: "",
            dealerLicenseNumber: "",
          },
          buyer: { buyerNamePrint: buyerName },
        })
      : undefined;

    const blockers = [
      ...(ftc?.blockingWarnings || []),
      !usedWindow?.template ? "Missing used window sticker decision." : undefined,
      !usedAddendum?.template ? "Missing used addendum decision." : undefined,
      isUsed && !ftc ? "Missing FTC Buyers Guide decision." : undefined,
      isUsed && saleState === "CT" && !k208Payload ? "Missing CT K-208 payload." : undefined,
    ].filter(Boolean) as string[];

    return { dealer, fullVehicle, usedWindow, usedAddendum, warrantyCompliance, ftc, k208Record, k208Payload, blockers };
  }, [vehicle, saleState, buyerName]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-6 text-slate-100">
      <section className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Connecticut MVP</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Launch Smoke Test</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">One route to verify the first rollout: new addendum, used window sticker, FTC Buyers Guide, used addendum, and Connecticut K-208.</p>
          <div className="mt-4 grid gap-2 md:grid-cols-5">
            {CONNECTICUT_FIRST_ROLLOUT_SCOPE.filter((item) => item.requiredForLaunch).map((item) => <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{item.status}</div><div className="mt-1 text-xs font-black text-white">{item.title}</div></div>)}
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
            <h2 className="text-xl font-black">Vehicle Input</h2>
            <div className="mt-4 space-y-3">
              <Input label="Sale State" value={saleState} onChange={setSaleState} />
              <Select label="Condition" value={vehicle.condition || "used"} onChange={(value) => setVehicle((current) => ({ ...current, condition: value as "new" | "used" }))} options={["used", "new"]} />
              <Input label="Year" value={String(vehicle.year || "")} onChange={(value) => setVehicle((current) => ({ ...current, year: value }))} />
              <Input label="Make" value={String(vehicle.make || "")} onChange={(value) => setVehicle((current) => ({ ...current, make: value }))} />
              <Input label="Model" value={String(vehicle.model || "")} onChange={(value) => setVehicle((current) => ({ ...current, model: value }))} />
              <Input label="Trim" value={String(vehicle.trim || "")} onChange={(value) => setVehicle((current) => ({ ...current, trim: value }))} />
              <Input label="Mileage" value={String(vehicle.mileage || "")} onChange={(value) => setVehicle((current) => ({ ...current, mileage: value }))} />
              <Input label="VIN" value={String(vehicle.vin || "")} onChange={(value) => setVehicle((current) => ({ ...current, vin: value }))} />
              <Input label="Stock" value={String(vehicle.stock || "")} onChange={(value) => setVehicle((current) => ({ ...current, stock: value }))} />
              <Input label="Buyer Name" value={buyerName} onChange={setBuyerName} />
              <button onClick={() => setVehicle((current) => ({ ...current, cpo: !current.cpo }))} className={`w-full rounded-xl px-4 py-2 text-xs font-black uppercase ${vehicle.cpo ? "bg-emerald-400 text-slate-950" : "bg-white/10 text-white"}`}>CPO: {vehicle.cpo ? "Yes" : "No"}</button>
            </div>
          </aside>

          <section className="space-y-6">
            <div className={`rounded-3xl border p-5 shadow-2xl ${result.blockers.length ? "border-amber-400/40 bg-amber-950/20" : "border-emerald-400/40 bg-emerald-950/20"}`}>
              <h2 className="text-xl font-black">Smoke Result: {result.blockers.length ? "Needs Review" : "Pass"}</h2>
              <div className="mt-3 space-y-1 text-sm text-slate-300">
                {result.blockers.length ? result.blockers.map((blocker) => <div key={blocker}>• {blocker}</div>) : <div>Core Connecticut package decisions generated.</div>}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <DecisionCard title="Used Window Sticker" value={result.usedWindow?.template.name || "Not applicable"} detail={result.usedWindow?.reasons.join(" • ")} />
              <DecisionCard title="Used Addendum" value={result.usedAddendum?.template.name || "Not applicable"} detail={result.usedAddendum?.reasons.join(" • ")} />
              <DecisionCard title="FTC Buyers Guide" value={result.ftc?.decisionCode || "Not applicable"} detail={result.ftc?.reasons.join(" • ")} />
              <DecisionCard title="Connecticut K-208" value={result.k208Payload ? result.k208Payload.inspectionResult.label : "Not applicable"} detail={result.k208Payload ? `${result.k208Payload.formVersion} • ${result.k208Payload.vehicle.year} ${result.k208Payload.vehicle.make} ${result.k208Payload.vehicle.model}` : undefined} />
            </div>

            {result.ftc ? (
              <section className="overflow-auto rounded-3xl border border-white/10 bg-white p-4 shadow-2xl">
                <FTCBuyersGuide data={result.ftc.data} />
              </section>
            ) : null}

            <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
              <h2 className="text-xl font-black">Decision JSON</h2>
              <pre className="mt-4 max-h-[520px] overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-300">{JSON.stringify({ vehicle: result.fullVehicle, usedWindow: result.usedWindow, usedAddendum: result.usedAddendum, ftc: result.ftc, k208: result.k208Payload }, null, 2)}</pre>
            </section>
          </section>
        </section>
      </section>
    </main>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">{label}<input className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="block space-y-1 text-xs font-bold uppercase tracking-wide text-slate-400">{label}<select className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function DecisionCard({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return <article className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-xl"><div className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">{title}</div><div className="mt-2 text-lg font-black text-white">{value}</div>{detail ? <p className="mt-2 text-xs leading-relaxed text-slate-400">{detail}</p> : null}</article>;
}
