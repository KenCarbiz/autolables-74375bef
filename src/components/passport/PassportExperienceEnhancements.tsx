import { BadgeCheck, BatteryCharging, Camera, CircleDollarSign, DollarSign, Gauge, ShieldCheck, Sparkles, Wrench } from "lucide-react";

type PassportDocument = {
  type?: string | null;
  title?: string | null;
  status?: string | null;
};

type PassportEnhancementVehicle = {
  price?: string | number | null;
  mileage?: string | number | null;
  warrantyLabel?: string | null;
  reconSummary?: string | null;
  historySummary?: string | null;
  documents?: PassportDocument[];
  dealer?: { name?: string | null } | null;
  make?: string | null;
  model?: string | null;
};

const money = (value?: string | number | null) => {
  if (value === null || value === undefined || value === "") return "Included in Passport";
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return String(value);
};

const hasDoc = (vehicle: PassportEnhancementVehicle, terms: string[]) =>
  (vehicle.documents || []).some((doc) => terms.some((term) => `${doc.type || ""} ${doc.title || ""}`.toLowerCase().includes(term)));

export function PassportServiceInvestmentCard({ vehicle }: { vehicle: PassportEnhancementVehicle }) {
  const proofItems = [
    { label: "Inspection", value: "Completed", icon: BadgeCheck },
    { label: "Recon proof", value: vehicle.reconSummary || "Available when attached", icon: Wrench },
    { label: "Warranty review", value: vehicle.warrantyLabel || "Buyer Guide ready", icon: ShieldCheck },
  ];

  return (
    <section className="overflow-hidden rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-blue-50 text-slate-950 shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="relative bg-slate-950 p-6 text-white">
          <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-400/20 blur-2xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-200">
              <Wrench className="h-3.5 w-3.5" /> Dealer Proof
            </div>
            <h2 className="mt-4 text-3xl font-black tracking-tight">Service investment you can feel good about.</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              The Passport turns dealer prep, inspection, and disclosure work into confidence — not clutter.
            </p>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">Visible value</div>
              <div className="mt-1 text-2xl font-black">Before you visit</div>
              <p className="mt-1 text-xs text-white/60">Review what matters from your phone, at the store, or at home.</p>
            </div>
          </div>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          {proofItems.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon className="h-5 w-5" /></div>
              <div className="mt-3 text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
              <p className="mt-1 text-sm font-black leading-snug text-slate-950">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function DealerInvestmentReport({ vehicle }: { vehicle: PassportEnhancementVehicle }) {
  const investmentItems = [
    { label: "Safety inspection", amount: 199, detail: "Multi-point inspection and road test" },
    { label: "Oil service", amount: 129, detail: "Fresh service before sale" },
    { label: "Alignment check", amount: 149, detail: "Ride and tire-wear confidence" },
    { label: "Detail and prep", amount: 249, detail: "Retail-ready cleanup and presentation" },
  ];
  const total = investmentItems.reduce((sum, item) => sum + item.amount, 0);

  return (
    <section className="overflow-hidden rounded-[2rem] border border-blue-200 bg-white shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[1fr_0.85fr]">
        <div className="p-5 sm:p-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-700">
            <CircleDollarSign className="h-3.5 w-3.5" /> Dealer Investment
          </div>
          <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-950">What the dealer put into this vehicle.</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            When dealers invest in preparation, the Passport should make that value visible. These line items can later be powered by real RO, recon, and inspection data.
          </p>
          <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
            {investmentItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 bg-white p-4">
                <div>
                  <p className="text-sm font-black text-slate-950">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.detail}</p>
                </div>
                <p className="text-sm font-black text-slate-950">{money(item.amount)}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Sample values shown until dealer RO/recon data is connected. See dealer for complete details.</p>
        </div>
        <div className="relative flex items-center justify-center bg-slate-950 p-6 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,.35),transparent_40%)]" />
          <div className="relative text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white text-slate-950 shadow-2xl"><DollarSign className="h-9 w-9" /></div>
            <div className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/50">Example preparation value</div>
            <div className="mt-2 text-5xl font-black tracking-tight">{money(total)}</div>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-white/65">A customer-friendly way to show prep, inspection, and care before the shopper ever visits.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function VehicleHealthReport({ vehicle }: { vehicle: PassportEnhancementVehicle }) {
  const healthItems = [
    { label: "Tires", value: "Good", detail: "Tread depth review", icon: Gauge, tone: "emerald" },
    { label: "Brakes", value: "Checked", detail: "Stopping performance reviewed", icon: ShieldCheck, tone: "emerald" },
    { label: "Battery", value: "Tested", detail: "Battery condition checked", icon: BatteryCharging, tone: "emerald" },
    { label: "Fluids", value: "Serviced", detail: vehicle.reconSummary || "Fresh service status available", icon: Wrench, tone: "blue" },
  ];

  return (
    <section className="rounded-[2rem] border border-border bg-background p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700">
            <BadgeCheck className="h-3.5 w-3.5" /> Vehicle Health
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-foreground">A cleaner way to understand condition.</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Instead of vague “inspected” language, the Passport can show customer-friendly health signals from service and recon data.
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-emerald-800">
          <div className="text-[10px] font-black uppercase tracking-wider">Health Snapshot</div>
          <div className="text-sm font-black">Ready for review</div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {healthItems.map(({ label, value, detail, icon: Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tone === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}><Icon className="h-5 w-5" /></div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <h3 className="font-black text-foreground">{label}</h3>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">{value}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function WhyBuyThisVehicleCard({ vehicle }: { vehicle: PassportEnhancementVehicle }) {
  const reasons = [
    vehicle.mileage ? `${money(vehicle.mileage).replace("$", "")} miles shown in the Passport` : "Mileage and vehicle facts in one place",
    hasDoc(vehicle, ["buyer", "ftc"]) ? "Buyer Guide is available" : "Buyer Guide can be attached",
    hasDoc(vehicle, ["service", "recon"]) || vehicle.reconSummary ? "Service and recon story available" : "Recon proof can be added by the dealer",
    vehicle.warrantyLabel ? vehicle.warrantyLabel : "Warranty information ready for review",
  ];

  return (
    <section className="rounded-[2rem] border border-border bg-background p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-violet-700">
            <Sparkles className="h-3.5 w-3.5" /> Why this vehicle
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-foreground">A simple reason to keep looking.</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The Passport summarizes the confidence signals a shopper usually has to hunt for across listings, paperwork, and phone calls.
          </p>
        </div>
        <div className="rounded-2xl bg-slate-950 px-4 py-3 text-white">
          <div className="text-[10px] font-black uppercase tracking-wider text-white/50">Dealer</div>
          <div className="text-sm font-black">{vehicle.dealer?.name || "Trusted dealer"}</div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {reasons.map((reason, index) => (
          <div key={reason} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm font-black text-blue-700">{index + 1}</div>
            <p className="mt-3 text-sm font-bold leading-relaxed text-foreground">{reason}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PassportProofGallery({ vehicle }: { vehicle: PassportEnhancementVehicle }) {
  const cards = [
    { title: "Photos", text: "Exterior, interior, wheels, and feature photos can live inside the Passport.", icon: Camera },
    { title: "Documents", text: `${vehicle.documents?.length || 0} document cards are ready for this vehicle experience.`, icon: BadgeCheck },
    { title: "Trade path", text: "The shopper can move from Passport to trade value without starting over.", icon: DollarSign },
  ];

  return (
    <section className="grid gap-3 lg:grid-cols-3">
      {cards.map(({ title, text, icon: Icon }) => (
        <div key={title} className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><Icon className="h-5 w-5" /></div>
          <h3 className="mt-4 text-lg font-black text-foreground">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
        </div>
      ))}
    </section>
  );
}
