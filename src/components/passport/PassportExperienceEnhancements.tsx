import { BadgeCheck, Camera, DollarSign, ShieldCheck, Sparkles, Wrench } from "lucide-react";

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
