import { Award, BadgeCheck, CheckCircle2, FileCheck2, ShieldCheck, Sparkles, Wrench } from "lucide-react";

type CertificateVehicle = {
  vin?: string | null;
  stock?: string | null;
  warrantyLabel?: string | null;
  reconSummary?: string | null;
  customerVisibleNotes?: string | null;
  reconditioningWorkPerformed?: string | null;
  dealerInvestmentItems?: Array<{ label?: string | null; detail?: string | null; showOnPassport?: boolean }>;
  healthItems?: Array<{ label?: string | null; value?: string | null; detail?: string | null; showOnPassport?: boolean }>;
  dealer?: { name?: string | null } | null;
};

const visibleText = (value?: string | null) => !!value && value.trim().length > 0;

const visibleInvestmentItems = (vehicle: CertificateVehicle) =>
  (vehicle.dealerInvestmentItems || []).filter((item) => item.showOnPassport !== false && (visibleText(item.label) || visibleText(item.detail)));

const visibleHealthItems = (vehicle: CertificateVehicle) =>
  (vehicle.healthItems || []).filter((item) => item.showOnPassport !== false && (visibleText(item.label) || visibleText(item.value) || visibleText(item.detail)));

export const hasCustomerReconditioningCertificate = (vehicle: CertificateVehicle) =>
  visibleText(vehicle.reconSummary) ||
  visibleText(vehicle.customerVisibleNotes) ||
  visibleText(vehicle.reconditioningWorkPerformed) ||
  visibleInvestmentItems(vehicle).length > 0 ||
  visibleHealthItems(vehicle).length > 0;

export function CustomerReconditioningCertificate({ vehicle }: { vehicle: CertificateVehicle }) {
  const investmentItems = visibleInvestmentItems(vehicle);
  const healthItems = visibleHealthItems(vehicle);
  const completedWorkText = vehicle.customerVisibleNotes || vehicle.reconditioningWorkPerformed || vehicle.reconSummary || "Approved reconditioning details are available from the selling dealer.";

  if (!hasCustomerReconditioningCertificate(vehicle)) return null;

  const checks = [
    { label: "Vehicle identity reviewed", value: vehicle.vin ? `VIN ${vehicle.vin}` : vehicle.stock ? `Stock ${vehicle.stock}` : "Vehicle verified", icon: BadgeCheck },
    { label: "Inspection information reviewed", value: healthItems.length ? `${healthItems.length} health items approved` : "Inspection details available", icon: FileCheck2 },
    { label: "Reconditioning reviewed", value: investmentItems.length ? `${investmentItems.length} completed-work items` : "Completed-work summary available", icon: Wrench },
    { label: "Manager approval required", value: "Customer-safe proof only", icon: ShieldCheck },
  ];

  return (
    <section className="overflow-hidden rounded-[2rem] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-blue-50 text-slate-950 shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="relative bg-slate-950 p-6 text-white">
          <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-amber-300/25 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-44 w-44 rounded-full bg-blue-400/15 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-100">
              <Award className="h-3.5 w-3.5" /> Reconditioning Certificate
            </div>
            <h2 className="mt-4 text-3xl font-black tracking-tight">Prepared, reviewed, and organized for confidence.</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              This certificate summarizes approved service, inspection, and reconditioning proof in plain language for the customer.
            </p>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">Dealer</div>
              <div className="mt-1 text-xl font-black">{vehicle.dealer?.name || "Selling dealer"}</div>
              <p className="mt-1 text-xs leading-relaxed text-white/60">Internal notes stay private unless reviewed and approved for customer display.</p>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Customer-safe summary</div>
                <p className="mt-1 text-lg font-black leading-snug text-slate-950">{completedWorkText}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {checks.map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
                    <p className="mt-1 text-sm font-black leading-snug text-slate-950">{value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-sm font-semibold leading-relaxed">
                Customer-facing reconditioning details are displayed only when the dealership chooses to publish them and the content is approved for customer view.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
