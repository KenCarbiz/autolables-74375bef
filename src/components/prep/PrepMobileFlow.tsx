import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Droplet, ListChecks, Lock, ShieldCheck, Sparkles, UserCheck } from "lucide-react";
import VehicleFoundCard from "./VehicleFoundCard";
import PrepStatusSummary, { type PrepStatusRow } from "./PrepStatusSummary";
import WorkTypeSelector, { type WorkType } from "./WorkTypeSelector";
import TaskChecklist from "./TaskChecklist";
import PhotoUploadGrid from "./PhotoUploadGrid";
import SignatureBlock from "./SignatureBlock";
import StickyActionButton from "./StickyActionButton";
import TimelineEventCard from "./TimelineEventCard";
import ManagerReviewPanel, { type ManagerCheck } from "./ManagerReviewPanel";
import ConfirmationScreen from "./ConfirmationScreen";
import { workEventLabel, type WorkEvent, type WorkEventInput, type WorkEventTask } from "@/hooks/useWorkEvents";

export interface PrepVehicle {
  found: boolean;
  ymm: string;
  stockNumber: string;
  photoUrl: string;
  listingId: string | null;
}

export interface UploadOpts {
  tenantId?: string | null;
  storeId?: string;
  vin?: string;
}

interface PrepMobileFlowProps {
  vin: string;
  vehicle: PrepVehicle;
  events: WorkEvent[];
  correctionTargets: Set<string>;
  available: boolean;
  requiredProducts: { name: string }[];
  requireRo: boolean;
  detailPhotosRequired: boolean;
  servicePhotoTasks: string[];
  uploadOpts: UploadOpts;
  defaultName: string;
  managerView: boolean;
  initialStep?: PrepStep;
  onSubmitEvent: (input: WorkEventInput) => Promise<{ event: WorkEvent | null; error: string | null }>;
  onExit: () => void;
}

export type PrepStep =
  | "found"
  | "worktype"
  | "detailChoice"
  | "detailInitial"
  | "reclean"
  | "service"
  | "protection"
  | "vendor"
  | "manager"
  | "timeline"
  | "confirm";

const DETAIL_INITIAL_TASKS = [
  "Full detail",
  "Exterior wash",
  "Interior clean / vacuum",
  "Carpet / upholstery shampoo",
  "Engine bay",
  "Clay wax & polish",
  "Odor treatment",
  "Headlight restoration",
];

const RECLEAN_TASKS = [
  "Exterior re-wash",
  "Interior touch-up",
  "Vacuum",
  "Glass cleaned",
  "Tires dressed",
  "Fuel / charge checked",
];

const RECLEAN_REASONS = [
  "Before photos",
  "Before delivery",
  "After test drive",
  "Weather / lot cleanup",
  "Manager request",
  "Other",
];

const SERVICE_TASKS = [
  "Mud flaps installed",
  "Wheel locks installed",
  "Running boards installed",
  "Wipers replaced",
  "Battery replaced",
  "Safety inspection",
  "Recall checked",
  "Other",
];

const VENDOR_TASKS: Array<{ label: string; photoRequired: boolean }> = [
  { label: "Ceramic Protection", photoRequired: true },
  { label: "VIN Etch", photoRequired: true },
  { label: "Door Edge / Handle Cups", photoRequired: true },
  { label: "Dent repair", photoRequired: false },
  { label: "Wheel repair", photoRequired: false },
  { label: "Glass repair", photoRequired: false },
  { label: "Tint", photoRequired: false },
  { label: "Paint protection film", photoRequired: true },
  { label: "Interior repair", photoRequired: false },
  { label: "Other", photoRequired: false },
];

const makeTasks = (labels: string[], photoLabels: string[] = []): WorkEventTask[] =>
  labels.map((label) => ({
    label,
    done: false,
    photo_required: photoLabels.includes(label),
    photo_urls: [],
  }));

const ScreenHeader = ({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) => (
  <div className="flex items-start gap-1.5 mb-4">
    {onBack && (
      <button
        onClick={onBack}
        aria-label="Back"
        className="w-10 h-10 -ml-2.5 mt-0.5 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted shrink-0"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
    )}
    <div>
      <h1 className="text-xl font-bold text-foreground leading-tight">{title}</h1>
      {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  </div>
);

const UnavailableNotice = () => (
  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 font-medium">
    Work-event history is not available yet — the vehicle_work_events migration
    (20260705000000_prep_work_events.sql) has not been applied. Submissions are
    disabled until it is.
  </div>
);

const VinPill = ({ vin, ymm }: { vin: string; ymm: string }) => (
  <div className="mb-4 rounded-xl bg-muted/60 px-3 py-2 flex items-center justify-between gap-2">
    <span className="text-xs font-semibold text-foreground truncate">{ymm || "Vehicle"}</span>
    <span className="text-[11px] font-mono text-muted-foreground shrink-0">
      …<span className="font-bold text-foreground">{vin.slice(-6)}</span>
    </span>
  </div>
);

interface FormScreenProps {
  title: string;
  subtitle: string;
  ctaLabel: string;
  vin: string;
  ymm: string;
  initialTasks: WorkEventTask[];
  reasons?: string[];
  showRo?: boolean;
  roRequired?: boolean;
  showCompany?: boolean;
  nameLabel: string;
  showEventPhotos?: boolean;
  eventPhotosRequired?: boolean;
  uploadOpts: UploadOpts;
  defaultName: string;
  available: boolean;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (data: {
    tasks: WorkEventTask[];
    reason?: string;
    ro_number?: string;
    company_name?: string;
    notes: string;
    signer_name: string;
    signature_data: string;
    signature_type: "draw" | "type";
    photos: string[];
  }) => void;
}

const FormScreen = ({
  title,
  subtitle,
  ctaLabel,
  vin,
  ymm,
  initialTasks,
  reasons,
  showRo,
  roRequired,
  showCompany,
  nameLabel,
  showEventPhotos,
  eventPhotosRequired,
  uploadOpts,
  defaultName,
  available,
  submitting,
  onBack,
  onSubmit,
}: FormScreenProps) => {
  const [tasks, setTasks] = useState<WorkEventTask[]>(initialTasks);
  const [reason, setReason] = useState("");
  const [ro, setRo] = useState("");
  const [company, setCompany] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [name, setName] = useState(defaultName);
  const [sig, setSig] = useState<{ data: string; type: "draw" | "type" } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photosBusy, setPhotosBusy] = useState(false);

  const doneTasks = tasks.filter((t) => t.done);
  const missingPhotoTask = tasks.find((t) => t.done && t.photo_required && t.photo_urls.length === 0);

  const hint = !available
    ? "Submissions are disabled until the work-events migration is applied."
    : busy || photosBusy
      ? "Waiting for photo uploads to finish."
      : reasons && !reason
        ? "Select a reason."
        : doneTasks.length === 0
          ? "Check at least one completed task."
          : missingPhotoTask
            ? `${missingPhotoTask.label}: photo required before you can submit this item.`
            : eventPhotosRequired && photos.length === 0
              ? "Photo required before you can submit."
              : showRo && roRequired && !ro.trim()
                ? "RO number required."
                : showCompany && !company.trim()
                  ? "Enter the company name."
                  : !name.trim()
                    ? `Enter ${nameLabel.toLowerCase()}.`
                    : !sig?.data
                      ? "Signature required."
                      : !confirmed
                        ? "Check the confirmation box to submit."
                        : null;

  return (
    <>
      <ScreenHeader title={title} subtitle={subtitle} onBack={onBack} />
      <VinPill vin={vin} ymm={ymm} />
      <div className="space-y-4">
        {reasons && (
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Why is this vehicle being re-cleaned?</p>
            <div className="flex flex-wrap gap-2">
              {reasons.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`h-10 px-3.5 rounded-xl text-sm font-semibold border transition ${
                    reason === r
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "bg-card border-border text-foreground hover:border-blue-300"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}
        {showRo && (
          <div className="rounded-2xl bg-card border border-border shadow-premium p-4">
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              RO number {roRequired ? "*" : "(optional)"}
            </label>
            <input
              type="text"
              value={ro}
              onChange={(e) => setRo(e.target.value)}
              placeholder="Repair order number"
              className="w-full h-12 px-4 rounded-xl border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
        <TaskChecklist tasks={tasks} onChange={setTasks} uploadOpts={uploadOpts} onBusyChange={setBusy} />
        {showEventPhotos && (
          <div className="rounded-2xl bg-card border border-border shadow-premium p-4">
            <PhotoUploadGrid
              photos={photos}
              onChange={setPhotos}
              uploadOpts={uploadOpts}
              required={eventPhotosRequired}
              label={eventPhotosRequired ? "Photos *" : "Photos (optional)"}
              onBusyChange={setPhotosBusy}
            />
          </div>
        )}
        <div className="rounded-2xl bg-card border border-border shadow-premium p-4">
          <label className="block text-xs font-semibold text-foreground mb-1.5">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything worth noting"
            className="w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <SignatureBlock
          name={name}
          onName={setName}
          nameLabel={nameLabel}
          showCompany={showCompany}
          company={company}
          onCompany={setCompany}
          onSignature={(data, type) => setSig(data ? { data, type } : null)}
          confirmed={confirmed}
          onConfirmed={setConfirmed}
        />
      </div>
      <StickyActionButton
        label={ctaLabel}
        disabled={!!hint}
        loading={submitting}
        hint={hint || undefined}
        onClick={() =>
          onSubmit({
            tasks,
            reason: reason || undefined,
            ro_number: ro.trim() || undefined,
            company_name: company.trim() || undefined,
            notes,
            signer_name: name.trim(),
            signature_data: sig?.data || "",
            signature_type: sig?.type || "draw",
            photos,
          })
        }
      />
    </>
  );
};

const PrepMobileFlow = ({
  vin,
  vehicle,
  events,
  correctionTargets,
  available,
  requiredProducts,
  requireRo,
  detailPhotosRequired,
  servicePhotoTasks,
  uploadOpts,
  defaultName,
  managerView,
  initialStep,
  onSubmitEvent,
  onExit,
}: PrepMobileFlowProps) => {
  const [step, setStep] = useState<PrepStep>(initialStep || "found");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<WorkEvent | null>(null);

  const activeEvents = useMemo(
    () => events.filter((e) => e.event_type !== "correction" && !correctionTargets.has(e.id)),
    [events, correctionTargets]
  );

  const detailDone = activeEvents.some((e) => e.event_type === "initial_detail");
  const serviceDone = activeEvents.some((e) => e.event_type === "service_install");
  const approved = activeEvents.some((e) => e.event_type === "manager_review" && e.status === "approved");

  const productStatus = useMemo(
    () =>
      requiredProducts.map((p) => {
        const proof = activeEvents.some(
          (e) =>
            e.event_type === "protection_install" &&
            e.tasks.some((t) => t.label === p.name && t.done && t.photo_urls.length > 0)
        );
        return { name: p.name, done: proof };
      }),
    [requiredProducts, activeEvents]
  );
  const protectionDone =
    productStatus.length > 0
      ? productStatus.every((p) => p.done)
      : activeEvents.some((e) => e.event_type === "protection_install");

  const openCorrections = useMemo(
    () =>
      events.filter((c) => {
        if (c.event_type !== "correction") return false;
        const target = events.find((e) => e.id === c.correction_of);
        return !events.some(
          (e) =>
            e.event_type !== "correction" &&
            new Date(e.created_at) > new Date(c.created_at) &&
            (!target || e.event_type === target.event_type)
        );
      }),
    [events]
  );

  const legacyMissingPhotos = useMemo(
    () =>
      events.flatMap((e) =>
        e.tasks
          .filter((t) => t.done && t.photo_required && t.photo_urls.length === 0)
          .map((t) => `${t.label} photo missing`)
      ),
    [events]
  );

  const missing = useMemo(() => {
    const items: string[] = [];
    if (!detailDone) items.push("Initial Inventory Detail not completed");
    productStatus.forEach((p) => {
      if (!p.done) items.push(`${p.name} photo missing`);
    });
    legacyMissingPhotos.forEach((m) => { if (!items.includes(m)) items.push(m); });
    events
      .filter((e) => e.event_type !== "correction" && !e.signature_data)
      .forEach((e) => items.push(`${workEventLabel(e)}: signature missing`));
    if (requireRo && activeEvents.some((e) => e.event_type === "service_install" && !e.ro_number))
      items.push("RO number required on Service Install");
    openCorrections.forEach((c) => items.push(`Open correction: ${c.reason || c.notes || "see timeline"}`));
    return items;
  }, [detailDone, productStatus, legacyMissingPhotos, events, activeEvents, requireRo, openCorrections]);

  const managerChecks: ManagerCheck[] = [
    { label: "Detail complete", ok: detailDone },
    { label: "Service install complete", ok: serviceDone },
    { label: "Protection products complete", ok: protectionDone },
    { label: "Required photos uploaded", ok: legacyMissingPhotos.length === 0 && productStatus.every((p) => p.done) },
    { label: "Vendor signoffs complete", ok: events.filter((e) => e.event_type === "vendor_visit").every((e) => !!e.signature_data) },
    { label: "No open issues", ok: openCorrections.length === 0 },
  ];

  const statusRows: PrepStatusRow[] = [
    { label: "Detail", state: detailDone ? "complete" : "pending" },
    { label: "Service Install", state: serviceDone ? "complete" : "pending" },
    { label: "Protection Install", state: protectionDone ? "complete" : "pending" },
    {
      label: "Manager Review",
      state: approved ? "complete" : missing.length > 0 ? "locked" : "pending",
    },
  ];

  const submit = async (input: WorkEventInput) => {
    setSubmitting(true);
    setError(null);
    const { event, error: err } = await onSubmitEvent({ ...input, listing_id: vehicle.listingId });
    setSubmitting(false);
    if (err || !event) {
      setError(err || "Submit failed");
      return;
    }
    setLastEvent(event);
    setStep("confirm");
  };

  const back = (to: PrepStep) => () => { setError(null); setStep(to); };

  const body = () => {
    switch (step) {
      case "found":
        return (
          <>
            <ScreenHeader title="Vehicle Found" subtitle="Confirm this is the vehicle you are working on." />
            <div className="space-y-4">
              {!available && <UnavailableNotice />}
              <VehicleFoundCard photoUrl={vehicle.photoUrl} ymm={vehicle.ymm} vin={vin} stockNumber={vehicle.stockNumber} />
              {!vehicle.found && (
                <p className="text-xs text-muted-foreground px-1">
                  This VIN is not in inventory yet. You can still record work against it.
                </p>
              )}
              <PrepStatusSummary rows={statusRows} />
              {managerView && (
                <button
                  onClick={() => setStep("timeline")}
                  className="w-full min-h-[48px] rounded-2xl bg-card border border-border shadow-premium px-4 py-3 flex items-center gap-3 text-left hover:border-blue-300 transition"
                >
                  <ListChecks className="w-5 h-5 text-blue-600 shrink-0" />
                  <span className="flex-1 text-sm font-bold text-foreground">View Prep Timeline</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </div>
            <StickyActionButton label="Continue" onClick={() => setStep("worktype")} />
          </>
        );

      case "worktype":
        return (
          <>
            <ScreenHeader title="What are you doing on this vehicle?" onBack={back("found")} />
            <VinPill vin={vin} ymm={vehicle.ymm} />
            <WorkTypeSelector
              onSelect={(type: WorkType) => {
                if (type === "detail") setStep("detailChoice");
                else if (type === "service") setStep("service");
                else if (type === "protection") setStep("protection");
                else if (type === "vendor") setStep("vendor");
                else setStep("manager");
              }}
            />
          </>
        );

      case "detailChoice":
        return (
          <>
            <ScreenHeader title="What type of detail work?" onBack={back("worktype")} />
            <VinPill vin={vin} ymm={vehicle.ymm} />
            <div className="space-y-3">
              <button
                onClick={() => setStep("detailInitial")}
                className="w-full rounded-2xl bg-card border border-border shadow-premium p-4 flex items-center gap-4 text-left hover:border-blue-300 transition"
              >
                <span className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Droplet className="w-6 h-6" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-bold text-foreground">Initial Inventory Detail</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">Full detail when the vehicle first enters inventory</span>
                </span>
                <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
              </button>
              <button
                onClick={() => setStep("reclean")}
                className="w-full rounded-2xl bg-card border border-border shadow-premium p-4 flex items-center gap-4 text-left hover:border-blue-300 transition"
              >
                <span className="w-12 h-12 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                  <Sparkles className="w-6 h-6" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-bold text-foreground">Re-clean / Reclaim</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">Quick clean before photos, delivery, test drive, or manager request</span>
                </span>
                <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
              </button>
            </div>
          </>
        );

      case "detailInitial":
        return (
          <FormScreen
            title="Initial Inventory Detail"
            subtitle="Check off the work completed, then sign."
            ctaLabel="Sign & Submit"
            vin={vin}
            ymm={vehicle.ymm}
            initialTasks={makeTasks(DETAIL_INITIAL_TASKS)}
            nameLabel="Your name"
            showEventPhotos
            eventPhotosRequired={detailPhotosRequired}
            uploadOpts={uploadOpts}
            defaultName={defaultName}
            available={available}
            submitting={submitting}
            onBack={back("detailChoice")}
            onSubmit={(d) => submit({ event_type: "initial_detail", ...d })}
          />
        );

      case "reclean":
        return (
          <FormScreen
            title="Re-clean / Reclaim"
            subtitle="Fast touch-up record. Under a minute."
            ctaLabel="Sign & Submit"
            vin={vin}
            ymm={vehicle.ymm}
            initialTasks={makeTasks(RECLEAN_TASKS)}
            reasons={RECLEAN_REASONS}
            nameLabel="Your name"
            showEventPhotos
            uploadOpts={uploadOpts}
            defaultName={defaultName}
            available={available}
            submitting={submitting}
            onBack={back("detailChoice")}
            onSubmit={(d) => submit({ event_type: "reclean", ...d })}
          />
        );

      case "service":
        return (
          <FormScreen
            title="Service Install"
            subtitle="Record RO work and service-installed equipment."
            ctaLabel="Sign & Submit"
            vin={vin}
            ymm={vehicle.ymm}
            initialTasks={makeTasks(SERVICE_TASKS, servicePhotoTasks)}
            showRo
            roRequired={requireRo}
            nameLabel="Technician name"
            uploadOpts={uploadOpts}
            defaultName={defaultName}
            available={available}
            submitting={submitting}
            onBack={back("worktype")}
            onSubmit={(d) => submit({ event_type: "service_install", tech_name: d.signer_name, ...d })}
          />
        );

      case "protection":
        return (
          <ProtectionScreen
            vin={vin}
            ymm={vehicle.ymm}
            products={requiredProducts}
            uploadOpts={uploadOpts}
            defaultName={defaultName}
            available={available}
            submitting={submitting}
            onBack={back("worktype")}
            onSubmit={(d) => submit({ event_type: "protection_install", tech_name: d.signer_name, ...d })}
          />
        );

      case "vendor":
        return (
          <FormScreen
            title="Third-Party Vendor"
            subtitle={`Each visit is recorded separately — this will be visit #${events.filter((e) => e.event_type === "vendor_visit").length + 1}.`}
            ctaLabel="Submit Vendor Signoff"
            vin={vin}
            ymm={vehicle.ymm}
            initialTasks={VENDOR_TASKS.map((t) => ({ label: t.label, done: false, photo_required: t.photoRequired, photo_urls: [] }))}
            showCompany
            nameLabel="Technician name"
            uploadOpts={uploadOpts}
            defaultName=""
            available={available}
            submitting={submitting}
            onBack={back("worktype")}
            onSubmit={(d) => submit({ event_type: "vendor_visit", tech_name: d.signer_name, ...d })}
          />
        );

      case "manager":
        return (
          <ManagerScreen
            vin={vin}
            ymm={vehicle.ymm}
            checks={managerChecks}
            missing={missing}
            approved={approved}
            available={available}
            submitting={submitting}
            defaultName={defaultName}
            onBack={back("worktype")}
            onApprove={(d) => submit({ event_type: "manager_review", status: "approved", ...d })}
            onRequestCorrection={async (reason) => {
              await submit({
                event_type: "correction",
                reason,
                signer_name: defaultName || "Manager",
                signature_data: "",
                notes: reason,
              });
            }}
          />
        );

      case "timeline": {
        const completedCount = activeEvents.filter((e) => e.event_type !== "manager_review").length;
        const pendingCount = statusRows.filter((r) => r.state === "pending").length;
        return (
          <>
            <ScreenHeader title="Vehicle Prep Timeline" onBack={back("found")} />
            <div className="space-y-4">
              <VehicleFoundCard photoUrl={vehicle.photoUrl} ymm={vehicle.ymm} vin={vin} stockNumber={vehicle.stockNumber} />
              <div className="grid grid-cols-3 gap-2">
                <SummaryStat label="Completed" value={completedCount} cls="text-emerald-600" />
                <SummaryStat label="Pending" value={pendingCount} cls="text-amber-600" />
                <SummaryStat label="Issues" value={openCorrections.length} cls="text-red-600" />
              </div>
              <div className={`rounded-2xl border p-4 ${approved ? "bg-emerald-50 border-emerald-200" : missing.length > 0 ? "bg-muted/60 border-border" : "bg-card border-blue-200 shadow-premium"}`}>
                <div className="flex items-center gap-3">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${approved ? "bg-emerald-100 text-emerald-600" : missing.length > 0 ? "bg-muted text-muted-foreground" : "bg-blue-50 text-blue-600"}`}>
                    {approved ? <ShieldCheck className="w-5 h-5" /> : missing.length > 0 ? <Lock className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">Manager Final Review</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {approved
                        ? "Vehicle approved ready."
                        : missing.length > 0
                          ? `Locked — ${missing.length} item${missing.length !== 1 ? "s" : ""} outstanding.`
                          : "All work complete. Ready for final review."}
                    </p>
                  </div>
                  {!approved && (
                    <button
                      onClick={() => setStep("manager")}
                      className="h-9 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold shrink-0 hover:bg-blue-700"
                    >
                      Review
                    </button>
                  )}
                </div>
              </div>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No work events recorded yet.</p>
              ) : (
                events.map((e) => (
                  <TimelineEventCard key={e.id} event={e} needsCorrection={correctionTargets.has(e.id)} />
                ))
              )}
            </div>
          </>
        );
      }

      case "confirm": {
        const confirmEvent = lastEvent || events[0] || null;
        return (
          <ConfirmationScreen
            vehicleLabel={vehicle.ymm}
            vin={vin}
            eventName={confirmEvent ? workEventLabel(confirmEvent) : ""}
            signerName={confirmEvent?.signer_name || ""}
            photoCount={
              confirmEvent
                ? confirmEvent.photos.length + confirmEvent.tasks.reduce((n, t) => n + t.photo_urls.length, 0)
                : 0
            }
            submittedAt={confirmEvent?.created_at || new Date().toISOString()}
            onDone={onExit}
            onAddAnother={() => setStep("worktype")}
            onViewTimeline={() => setStep("timeline")}
          />
        );
      }
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[480px] mx-auto px-4 pt-5 pb-40">
        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
            {error}
          </div>
        )}
        {body()}
      </div>
    </div>
  );
};

const SummaryStat = ({ label, value, cls }: { label: string; value: number; cls: string }) => (
  <div className="rounded-2xl bg-card border border-border shadow-premium p-3 text-center">
    <p className={`text-2xl font-bold tabular-nums ${cls}`}>{value}</p>
    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mt-0.5">{label}</p>
  </div>
);

interface ProtectionScreenProps {
  vin: string;
  ymm: string;
  products: { name: string }[];
  uploadOpts: UploadOpts;
  defaultName: string;
  available: boolean;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (data: {
    tasks: WorkEventTask[];
    notes: string;
    signer_name: string;
    signature_data: string;
    signature_type: "draw" | "type";
    photos: string[];
  }) => void;
}

const ProtectionScreen = ({
  vin,
  ymm,
  products,
  uploadOpts,
  defaultName,
  available,
  submitting,
  onBack,
  onSubmit,
}: ProtectionScreenProps) => {
  const [rows, setRows] = useState<WorkEventTask[]>(
    products.map((p) => ({ label: p.name, done: false, photo_required: true, photo_urls: [] }))
  );
  const [notes, setNotes] = useState("");
  const [name, setName] = useState(defaultName);
  const [sig, setSig] = useState<{ data: string; type: "draw" | "type" } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const incomplete = rows.find((r) => !r.done);
  const missingPhoto = rows.find((r) => r.photo_urls.length === 0);

  const hint = !available
    ? "Submissions are disabled until the work-events migration is applied."
    : rows.length === 0
      ? "No addendum products are on file for this vehicle."
      : busy
        ? "Waiting for photo uploads to finish."
        : missingPhoto
          ? `${missingPhoto.label}: photo required before you can submit this item.`
          : incomplete
            ? `${incomplete.label} not marked complete.`
            : !name.trim()
              ? "Enter installer name."
              : !sig?.data
                ? "Signature required."
                : !confirmed
                  ? "Check the confirmation box to submit."
                  : null;

  return (
    <>
      <ScreenHeader
        title="Protection / Addendum Install"
        subtitle="Photo proof is required for every addendum product."
        onBack={onBack}
      />
      <VinPill vin={vin} ymm={ymm} />
      <div className="space-y-4">
        {rows.length === 0 ? (
          <div className="rounded-2xl bg-card border border-border shadow-premium p-6 text-center">
            <ShieldCheck className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">No addendum products on file</p>
            <p className="text-xs text-muted-foreground mt-1">
              Products appear here from this vehicle's addendum or get-ready record.
            </p>
          </div>
        ) : (
          rows.map((row, i) => {
            const complete = row.done && row.photo_urls.length > 0;
            return (
              <div
                key={row.label}
                className={`rounded-2xl border shadow-premium overflow-hidden ${complete ? "bg-emerald-50/50 border-emerald-200" : "bg-card border-border"}`}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-foreground">{row.label}</p>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg shrink-0 ${
                        complete ? "bg-emerald-100 text-emerald-700" : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {complete ? "Complete" : "Photo Required"}
                    </span>
                  </div>
                  <div className="mt-3">
                    <PhotoUploadGrid
                      photos={row.photo_urls}
                      onChange={(urls) => setRows((p) => p.map((r, j) => (j === i ? { ...r, photo_urls: urls } : r)))}
                      uploadOpts={uploadOpts}
                      required
                      compact
                      onBusyChange={setBusy}
                    />
                  </div>
                  <button
                    onClick={() => setRows((p) => p.map((r, j) => (j === i ? { ...r, done: !r.done } : r)))}
                    className={`mt-3 w-full min-h-[48px] rounded-xl border-2 flex items-center justify-center gap-2 text-sm font-bold transition ${
                      row.done
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-border bg-card text-foreground hover:border-blue-300"
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {row.done ? "Installed" : "Mark installed"}
                  </button>
                </div>
              </div>
            );
          })
        )}
        {rows.length > 0 && (
          <>
            <div className="rounded-2xl bg-card border border-border shadow-premium p-4">
              <label className="block text-xs font-semibold text-foreground mb-1.5">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Anything worth noting"
                className="w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <SignatureBlock
              name={name}
              onName={setName}
              nameLabel="Installer name"
              onSignature={(data, type) => setSig(data ? { data, type } : null)}
              confirmed={confirmed}
              onConfirmed={setConfirmed}
            />
          </>
        )}
      </div>
      <StickyActionButton
        label="Submit Install Proof"
        disabled={!!hint}
        loading={submitting}
        hint={hint && rows.length > 0 ? hint : undefined}
        onClick={() =>
          onSubmit({
            tasks: rows,
            notes,
            signer_name: name.trim(),
            signature_data: sig?.data || "",
            signature_type: sig?.type || "draw",
            photos: [],
          })
        }
      />
    </>
  );
};

interface ManagerScreenProps {
  vin: string;
  ymm: string;
  checks: ManagerCheck[];
  missing: string[];
  approved: boolean;
  available: boolean;
  submitting: boolean;
  defaultName: string;
  onBack: () => void;
  onApprove: (data: {
    signer_name: string;
    signature_data: string;
    signature_type: "draw" | "type";
    notes: string;
  }) => void;
  onRequestCorrection: (reason: string) => Promise<void>;
}

const ManagerScreen = ({
  vin,
  ymm,
  checks,
  missing,
  approved,
  available,
  submitting,
  defaultName,
  onBack,
  onApprove,
  onRequestCorrection,
}: ManagerScreenProps) => {
  const [name, setName] = useState(defaultName);
  const [sig, setSig] = useState<{ data: string; type: "draw" | "type" } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const hint = !available
    ? "Submissions are disabled until the work-events migration is applied."
    : approved
      ? "This vehicle is already approved ready."
      : missing.length > 0
        ? missing[0]
        : !name.trim()
          ? "Enter manager name."
          : !sig?.data
            ? "Signature required."
            : !confirmed
              ? "Check the confirmation box to approve."
              : null;

  return (
    <>
      <ScreenHeader
        title="Manager Final Review"
        subtitle="Approving unlocks this vehicle for listing."
        onBack={onBack}
      />
      <VinPill vin={vin} ymm={ymm} />
      <div className="space-y-4">
        {approved && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
            Vehicle already approved ready.
          </div>
        )}
        <ManagerReviewPanel checks={checks} missing={missing} onRequestCorrection={onRequestCorrection} />
        {!approved && missing.length === 0 && (
          <SignatureBlock
            name={name}
            onName={setName}
            nameLabel="Manager name"
            onSignature={(data, type) => setSig(data ? { data, type } : null)}
            confirmed={confirmed}
            onConfirmed={setConfirmed}
          />
        )}
      </div>
      <StickyActionButton
        label="Approve Vehicle Ready"
        disabled={!!hint}
        loading={submitting}
        hint={hint || undefined}
        onClick={() =>
          onApprove({
            signer_name: name.trim(),
            signature_data: sig?.data || "",
            signature_type: sig?.type || "draw",
            notes: "Approved via mobile prep flow",
          })
        }
      />
    </>
  );
};

export default PrepMobileFlow;
