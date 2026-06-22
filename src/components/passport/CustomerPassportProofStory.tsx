import { BadgeCheck, Camera, CheckCircle2, FileText, ShieldCheck, Sparkles, Wrench } from "lucide-react";

type PassportDocument = {
  type?: string | null;
  title?: string | null;
  status?: string | null;
};

type CustomerProofVehicle = {
  vin?: string | null;
  stock?: string | null;
  warrantyLabel?: string | null;
  reconSummary?: string | null;
  historySummary?: string | null;
  customerVisibleNotes?: string | null;
  reconditioningWorkPerformed?: string | null;
  dealerInvestmentItems?: Array<{ label?: string | null; amount?: string | number | null; detail?: string | null; showOnPassport?: boolean }>;
  healthItems?: Array<{ label?: string | null; value?: string | null; detail?: string | null; showOnPassport?: boolean }>;
  proofPhotos?: Array<{ photoUrl?: string | null; caption?: string | null; category?: string | null; showOnPassport?: boolean }>;
  documents?: PassportDocument[];
  dealer?: { name?: string | null } | null;
};

const hasText = (value?: string | null) => !!value && value.trim().length > 0;

const hasDoc = (vehicle: CustomerProofVehicle, terms: string[]) =>
  (vehicle.documents || []).some((doc) => terms.some((term) => `${doc.type || ""} ${doc.title || ""}`.toLowerCase().includes(term)));

const approvedInvestmentItems = (vehicle: CustomerProofVehicle) =>
  (vehicle.dealerInvestmentItems || []).filter((item) => item.showOnPassport !== false && hasText(item.label || item.detail || ""));

const approvedHealthItems = (vehicle: CustomerProofVehicle) =>
  (vehicle.healthItems || []).filter((item) => item.showOnPassport !== false && hasText(item.label || item.value || item.detail || ""));

const approvedPhotos = (vehicle: CustomerProofVehicle) =>
  (vehicle.proofPhotos || []).filter((photo) => photo.showOnPassport !== false && hasText(photo.photoUrl));

export const hasCustomerProofStory = (vehicle: CustomerProofVehicle) =>
  hasText(vehicle.reconSummary) ||
  hasText(vehicle.customerVisibleNotes) ||
  hasText(vehicle.reconditioningWorkPerformed) ||
  approvedInvestmentItems(vehicle).length > 0 ||
  approvedHealthItems(vehicle).length > 0 ||
  approvedPhotos(vehicle).length > 0 ||
  hasDoc(vehicle, ["inspection", "service", "recon", "buyer", "warranty"]);

export function CustomerPassportProofStory({ vehicle }: { vehicle: CustomerProofVehicle }) {
  const investments = approvedInvestmentItems(vehicle);
  const health = approvedHealthItems(vehicle);
  const photos = approvedPhotos(vehicle);

  const proofSteps = [
    {
      title: "Vehicle verified",
      text: vehicle.vin ? `VIN ${vehicle.vin}` : "Vehicle identity and paperwork are organized in this Passport.",
      icon: BadgeCheck,
      show: !!vehicle.vin || !!vehicle.stock,
    },
    {
      title: "Inspection reviewed",
      text: health.length ? `${health.length} condition items are available for review.` : "Inspection and service information can be attached by the dealer.",
      icon: ShieldCheck,
      show: health.length > 0 || hasDoc(vehicle, ["inspection", "service"]),
    },
    {
      title: "Reconditioning completed",
      text: vehicle.customerVisibleNotes || vehicle.reconditioningWorkPerformed || vehicle.reconSummary || "Approved reconditioning notes can appear here after manager review.",
      icon: Wrench,
      show: hasText(vehicle.customerVisibleNotes) || hasText(vehicle.reconditioningWorkPerformed) || hasText(vehicle.reconSummary) || investments.length > 0,
    },
    {
      title: "Proof ready",
      text: photos.length ? `${photos.length} approved proof photos are available.` : "Documents and approved proof are kept together for easy review.",
      icon: FileText,
      show: photos.length > 0 || hasDoc(vehicle, ["buyer", "warranty", "service", "recon"]),
    },
  ].filter((step) => step.show);

  if (!proofSteps.length) return null;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950 text-white shadow-2xl shadow-slate-950/20">
      <div className="relative p-5 sm:p-7">
        <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-44 w-44 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-100">
              <Sparkles className="h-3.5 w-3.5" /> Passport Proof Story
            </div>
            <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Proof that makes the vehicle easier to trust.</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              This section only shows approved, customer-safe information from the dealership. Internal service notes stay private unless they are reviewed and approved for the Passport.
            </p>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/10 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">Dealer transparency</div>
              <p className="mt-1 text-sm font-bold leading-relaxed text-white/85">
                {vehicle.dealer?.name ? `${vehicle.dealer.name} organized the important vehicle proof in one place.` : "The dealer organized the important vehicle proof in one place."}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {proofSteps.map(({ title, text, icon: Icon }, index) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-950">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-white/40">Step {index + 1}</div>
                    <h3 className="mt-1 font-black text-white">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-white/65">{text}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(health.length > 0 || investments.length > 0 || photos.length > 0) && (
        <div className="grid gap-px border-t border-white/10 bg-white/10 lg:grid-cols-3">
          <ProofSummaryCard
            icon={ShieldCheck}
            title="Health signals"
            value={health.length ? `${health.length} approved` : "Not published"}
            text={health.length ? "Condition information reviewed for customer presentation." : "Dealer has not published health details for this Passport."}
          />
          <ProofSummaryCard
            icon={Wrench}
            title="Reconditioning"
            value={investments.length ? `${investments.length} items` : "Not published"}
            text={investments.length ? "Approved completed-work items are available." : "Dealer has not published reconditioning items for this Passport."}
          />
          <ProofSummaryCard
            icon={Camera}
            title="Proof photos"
            value={photos.length ? `${photos.length} approved` : "Private"}
            text={photos.length ? "Dealer-approved evidence photos are available." : "Service photos are private unless approved by the dealer."}
          />
        </div>
      )}
    </section>
  );
}

function ProofSummaryCard({ icon: Icon, title, value, text }: { icon: typeof ShieldCheck; title: string; value: string; text: string }) {
  return (
    <div className="bg-slate-900 p-5 text-white">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-white/10 p-2 text-emerald-200"><Icon className="h-5 w-5" /></div>
        <div>
          <div className="text-[10px] font-black uppercase tracking-wider text-white/40">{title}</div>
          <div className="mt-1 text-xl font-black">{value}</div>
          <p className="mt-1 text-sm leading-relaxed text-white/60">{text}</p>
        </div>
      </div>
    </div>
  );
}

export function CustomerTrustDisclosure() {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-sm font-semibold leading-relaxed">
          Customer-facing service and reconditioning details are dealer-approved. Internal technician notes and private service photos are not shown unless the dealership chooses to publish them.
        </p>
      </div>
    </div>
  );
}
