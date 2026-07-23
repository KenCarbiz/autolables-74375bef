import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useDealRecord, dealDocStatus, type DealRecord } from "@/hooks/useDealRecord";
import {
  CheckCircle2, Circle, Loader2, FileText, ShieldCheck, Wrench, BookOpen,
  Send, ArrowUpRight, Sparkles, ClipboardCheck, FolderCheck, Signature,
  AlertTriangle, ChevronRight, X, BadgeCheck,
} from "lucide-react";
import { toast } from "sonner";
import SignaturePad from "@/components/addendum/SignaturePad";
import { K208_INSPECTION_RESULTS, K208_CERTIFICATION_TEXT } from "@/data/ctK208Form";

// ──────────────────────────────────────────────────────────────
// DealFlowPanel — the ONE guided deal + documents workspace.
//
// Replaces the scattered generate/upload/view spots for the FTC Buyers
// Guide and the CT K-208 with a single story the used-car manager reads
// top to bottom:
//   1. readiness badge + the single next action
//   2. a five-stage progress rail (file created → manager approval →
//      department work → deal package → customer delivery)
//   3. an "attention required" card naming the one blocker + its owner
//   4. four document-readiness cards (addendum, K-208, get-ready, Buyers
//      Guide) — the canonical place official forms are filled + viewed.
//
// Everything is derived from real data (useDealRecord). "Generate official
// forms" fills the exact AcroForm PDFs via generate-vehicle-forms; "Process
// this deal" files + emails the record. Those are the only two mutations.
// ──────────────────────────────────────────────────────────────

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

type StageState = "complete" | "active" | "upcoming";

interface StageDef {
  key: string;
  label: string;
  sub: string;
  icon: typeof Sparkles;
  tone: "blue" | "amber" | "emerald" | "slate" | "violet";
}

const STAGES: StageDef[] = [
  { key: "created", label: "Vehicle file created", sub: "Documents auto-drafted", icon: Sparkles, tone: "blue" },
  { key: "approval", label: "Manager approval", sub: "Accept the addendum", icon: ClipboardCheck, tone: "amber" },
  { key: "dept", label: "Department work", sub: "Get-Ready + K-208", icon: Wrench, tone: "emerald" },
  { key: "package", label: "Deal package", sub: "Assemble + process", icon: FolderCheck, tone: "slate" },
  { key: "delivery", label: "Customer delivery", sub: "Signed on delivery", icon: Signature, tone: "violet" },
];

const TONE_ACTIVE: Record<StageDef["tone"], string> = {
  blue: "bg-blue-600 text-white ring-blue-200",
  amber: "bg-amber-500 text-white ring-amber-200",
  emerald: "bg-emerald-600 text-white ring-emerald-200",
  slate: "bg-slate-700 text-white ring-slate-200",
  violet: "bg-violet-600 text-white ring-violet-200",
};

// The whole flow reduced to one derived object: which stage is live, whether
// each stage is done, and the single next action the dealer should take.
interface FlowState {
  approved: boolean;
  deptDone: boolean;
  packageReady: boolean;
  processed: boolean;
  delivered: boolean;
  stageStates: Record<string, StageState>;
  activeStage: string;
  badge: { label: string; cls: string };
}

function deriveFlow(record: DealRecord, s: ReturnType<typeof dealDocStatus>): FlowState {
  const approved = !!record.addendum?.acceptedAt;
  const deptDone = s.getReady && (record.isUsed ? s.k208 : true);
  const packageReady = s.complete;
  const processed = !!record.processedAt;
  const delivered = !!record.addendum?.signed;

  const stageStates: Record<string, StageState> = {
    created: "complete",
    approval: approved ? "complete" : "active",
    dept: !approved ? "upcoming" : deptDone ? "complete" : "active",
    package: !deptDone ? "upcoming" : processed ? "complete" : "active",
    delivery: !processed ? "upcoming" : delivered ? "complete" : "active",
  };
  const activeStage = STAGES.find((st) => stageStates[st.key] === "active")?.key ?? "delivery";

  let badge: FlowState["badge"];
  if (delivered) badge = { label: "Complete", cls: "bg-emerald-100 text-emerald-700" };
  else if (processed) badge = { label: "Ready for customer", cls: "bg-violet-100 text-violet-700" };
  else if (packageReady) badge = { label: "Ready to process", cls: "bg-slate-200 text-slate-700" };
  else if (approved && !deptDone) badge = { label: "Get-Ready in progress", cls: "bg-emerald-100 text-emerald-700" };
  else badge = { label: "Needs review", cls: "bg-amber-100 text-amber-700" };

  return { approved, deptDone, packageReady, processed, delivered, stageStates, activeStage, badge };
}

interface NextAction {
  title: string;
  owner: string;
  why: string;
  cta?: { label: string; onClick: () => void; primary?: boolean };
}

export default function DealFlowPanel({ vehicle }: { vehicle: { id: string; vin: string; ymm?: string | null } }) {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canProcess = hasDealerCapability(member?.role, "can_approve_print", isAdmin);
  const { record, loading, reload } = useDealRecord(vehicle.vin, vehicle.id, tenant?.id);
  const [processing, setProcessing] = useState(false);
  const [genForms, setGenForms] = useState(false);
  // Buyers Guide language — 16 CFR 455.5 requires the Spanish Guide when the
  // sale is conducted in Spanish. Both fill the exact official form.
  const [lang, setLang] = useState<"en" | "es">("en");
  // K-208 licensee certification (a manager step, distinct from the technician
  // inspection). Any manager may certify per the store's authority model.
  const [certifyOpen, setCertifyOpen] = useState(false);
  const [certResult, setCertResult] = useState<"A" | "B" | "C" | "">("");
  const [certName, setCertName] = useState("");
  const [certSig, setCertSig] = useState({ data: "", type: "draw" as "draw" | "type" });
  const [certifying, setCertifying] = useState(false);

  const certifyK208 = async () => {
    if (!record?.k208?.id || !certResult || !certSig.data) { toast.error("Choose the A/B/C result and sign to certify."); return; }
    setCertifying(true);
    try {
      const { error } = await (supabase as any).rpc("certify_safety_inspection", {
        p_inspection_id: record.k208.id, p_result_initial: certResult,
        p_licensee_name: certName || null, p_signature_data: certSig.data,
      });
      if (error) {
        const m = String(error.message || "");
        toast.error(/not_authorized/.test(m) ? "You aren't authorized to certify the K-208." : /not_completed/.test(m) ? "The technician must complete the inspection first." : "Couldn't certify the K-208");
        return;
      }
      toast.success("K-208 certified by licensee");
      setCertifyOpen(false); setCertResult(""); setCertName(""); setCertSig({ data: "", type: "draw" });
      await reload();
    } finally {
      setCertifying(false);
    }
  };

  const generateForms = async (kinds?: string[]) => {
    if (!tenant?.id) return;
    setGenForms(true);
    try {
      const body: Record<string, unknown> = { tenant_id: tenant.id, vin: vehicle.vin, lang, app_base: window.location.origin };
      if (kinds) body.kinds = kinds;
      if (record?.buyersGuide?.box) body.box = record.buyersGuide.box;
      const { data, error } = await (supabase as any).functions.invoke("generate-vehicle-forms", { body });
      if (error || !data?.ok) { toast.error("Couldn't fill the official forms"); return; }
      toast.success("Official forms filled and filed to Documents");
      await reload();
    } finally {
      setGenForms(false);
    }
  };

  const viewFilledForm = async (kind: "buyers_guide" | "k208") => {
    if (!tenant?.id) return;
    setGenForms(true);
    try {
      const body: Record<string, unknown> = { tenant_id: tenant.id, vin: vehicle.vin, kinds: [kind], lang, app_base: window.location.origin };
      if (kind === "buyers_guide" && record?.buyersGuide?.box) body.box = record.buyersGuide.box;
      const { data, error } = await (supabase as any).functions.invoke("generate-vehicle-forms", { body });
      const url = data?.forms?.[kind];
      if (error || !data?.ok || !url) { toast.error("Couldn't open the official form"); return; }
      window.open(url, "_blank", "noopener");
      await reload();
    } finally {
      setGenForms(false);
    }
  };

  const process = async () => {
    if (!tenant?.id) return;
    setProcessing(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("process-deal", { body: { tenant_id: tenant.id, vin: vehicle.vin } });
      if (error || !data?.ok) {
        toast.error(data?.error === "not_ready" ? "Finish the required documents before filing." : "Couldn't process the deal");
        return;
      }
      if (data.already_processed) toast.message("This deal was already filed.");
      else if (data.emailed) toast.success("Deal filed and emailed to the office");
      else if (data.error === "no_recipient") toast.message("Deal filed. Add an office email in Settings to auto-send it.");
      else toast.success("Deal filed");
      await reload();
    } finally {
      setProcessing(false);
    }
  };

  const flow = useMemo(() => {
    if (!record) return null;
    return deriveFlow(record, dealDocStatus(record));
  }, [record]);

  const nextAction = useMemo<NextAction | null>(() => {
    if (!record || !flow) return null;
    const s = dealDocStatus(record);
    if (!flow.approved) {
      return {
        title: "The addendum needs manager approval.",
        owner: "Used-car manager",
        why: "Accepting the addendum sends the Get-Ready plan to the departments.",
        cta: record.addendum
          ? { label: "Review addendum", onClick: () => navigate(`/addendum?id=${record.addendum!.id}`), primary: true }
          : { label: "Open addendum", onClick: () => navigate(`/vehicle-file/${vehicle.id}?tab=addendum`), primary: true },
      };
    }
    if (record.isUsed && !s.k208) {
      return {
        title: "Service must sign the CT K-208.",
        owner: "Service department",
        why: "The state safety inspection must be completed and signed before delivery.",
        cta: { label: "Open K-208", onClick: () => navigate(`/k208/${vehicle.vin}`), primary: true },
      };
    }
    if (record.isUsed && record.k208 && !record.k208.certifiedAt) {
      return {
        title: "Certify the K-208 as the licensee.",
        owner: "Manager (licensee)",
        why: "The technician completed the inspection; an authorized manager must confirm the A/B/C result and sign the certification.",
        cta: canProcess ? { label: "Certify K-208", onClick: () => setCertifyOpen(true), primary: true } : undefined,
      };
    }
    if (!s.getReady) {
      return {
        title: "Get-Ready work is not complete.",
        owner: "Detail / install",
        why: "Recon, detail, and accessory installs need completion proof before the deal can be filed.",
        cta: { label: "Open Prep & Install", onClick: () => navigate(`/vehicle-file/${vehicle.id}?tab=prep`), primary: true },
      };
    }
    if (record.isUsed && !s.buyersGuide) {
      return {
        title: "Confirm and publish the FTC Buyers Guide.",
        owner: "Used-car manager",
        why: "The correct As-Is / warranty box must be confirmed, then the official form filled for the deal jacket.",
        cta: { label: "Fill official forms", onClick: () => generateForms(), primary: true },
      };
    }
    if (!flow.processed) {
      return {
        title: "All documents are ready. Process the deal.",
        owner: "Used-car manager",
        why: "Filing assembles the deal jacket and emails the office a copy.",
        cta: canProcess ? { label: "Process this deal", onClick: process, primary: true } : undefined,
      };
    }
    if (!flow.delivered) {
      return {
        title: "Ready for the customer to sign at delivery.",
        owner: "Delivery",
        why: "The customer signs the addendum, Buyers Guide, and K-208 as one bundle on their phone.",
        cta: { label: "Open customer sign-off", onClick: () => navigate(`/vehicle-file/${vehicle.id}?tab=sign`), primary: true },
      };
    }
    return {
      title: "This deal is complete.",
      owner: "—",
      why: "Every required document is signed and archived by VIN.",
    };
  }, [record, flow, canProcess, vehicle.id, vehicle.vin]);

  if (loading) return <p className="text-body-sm text-muted-foreground">Loading deal flow…</p>;
  if (!record || !flow) return <p className="text-body-sm text-muted-foreground">No deal record yet for this vehicle.</p>;

  const s = dealDocStatus(record);

  const k208Certified = !!record.k208?.certifiedAt;
  const k208AwaitingCert = !!record.k208 && !k208Certified;
  const docCards: {
    key: string;
    label: string;
    icon: typeof FileText;
    status: string;
    done: boolean;
    official: boolean;
    meta: string;
    open?: () => void;
    onCertify?: () => void;
    show: boolean;
  }[] = [
    {
      key: "addendum", label: "Addendum", icon: FileText, official: false,
      status: record.addendum?.signed ? "Signed" : record.addendum?.acceptedAt ? "Accepted" : record.addendum ? "Draft" : "Not started",
      done: s.addendum,
      meta: record.addendum?.acceptedAt ? `Accepted ${fmt(record.addendum.acceptedAt)}` : "Awaiting manager acceptance",
      open: () => (record.addendum ? navigate(`/addendum?id=${record.addendum!.id}`) : navigate(`/vehicle-file/${vehicle.id}?tab=addendum`)),
      show: true,
    },
    {
      key: "k208", label: "CT K-208 safety inspection", icon: ShieldCheck, official: true,
      status: k208Certified ? `Certified ${record.k208!.resultInitial || ""}`.trim() : k208AwaitingCert ? "Awaiting licensee" : "Draft",
      done: s.k208,
      meta: k208Certified
        ? `Licensee certified ${fmt(record.k208!.certifiedAt)}`
        : k208AwaitingCert
          ? `Technician signed ${fmt(record.k208!.signedAt)} · licensee must certify`
          : "Auto-generated at ingest · awaiting service sign-off",
      open: () => navigate(`/k208/${vehicle.vin}`),
      onCertify: canProcess && k208AwaitingCert ? () => setCertifyOpen(true) : undefined,
      show: record.isUsed,
    },
    {
      key: "getReady", label: "Get-Ready record", icon: Wrench, official: false,
      status: record.getReady?.completeDate ? "Complete" : record.getReady?.detailSigned ? "Detail signed" : record.getReady ? "In progress" : "Not started",
      done: s.getReady,
      meta: record.getReady?.completeDate ? `Completed ${fmt(record.getReady.completeDate)}` : "Recon, detail, and install proofs",
      open: () => navigate(`/vehicle-file/${vehicle.id}?tab=prep`),
      show: true,
    },
    {
      key: "buyersGuide", label: "FTC Buyers Guide", icon: BookOpen, official: true,
      status: s.buyersGuide ? "Published" : record.buyersGuide ? `Draft (${record.buyersGuide.box || "as-is"})` : "Not generated",
      done: s.buyersGuide,
      meta: record.buyersGuide
        ? [`v${record.buyersGuide.version ?? 1}`, record.buyersGuide.lang ? record.buyersGuide.lang.toUpperCase() : null, "confirm the box, then fill"].filter(Boolean).join(" · ")
        : "Not generated",
      open: () => navigate(`/buyers-guide?vehicleId=${vehicle.id}`),
      show: record.isUsed,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header: title + readiness badge + generate + process */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-title font-display font-semibold text-foreground">Deal flow</h2>
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${flow.badge.cls}`}>{flow.badge.label}</span>
          </div>
          <p className="text-body-sm text-muted-foreground mt-0.5">
            One guided process — every document ready before delivery. Assembled by VIN <span className="font-mono">{vehicle.vin}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canProcess && record.isUsed && (
            <>
              <div className="inline-flex items-center rounded-md border border-border overflow-hidden h-10" title="Buyers Guide language — Spanish is required when the sale is conducted in Spanish (16 CFR 455.5)">
                {(["en", "es"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`h-full px-3 text-sm font-semibold ${lang === l ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  >
                    {l === "en" ? "EN" : "ES"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => generateForms()}
                disabled={genForms}
                title="Fill the official FTC Buyers Guide + CT K-208 PDFs from this vehicle's data and file them to Documents"
                className="h-10 px-4 rounded-md border border-border text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
              >
                {genForms ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                Fill official forms
              </button>
            </>
          )}
          {flow.processed ? (
            <span className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-emerald-50 text-emerald-700 text-sm font-semibold border border-emerald-200">
              <CheckCircle2 className="w-4 h-4" /> Filed {fmt(record.processedAt)}
            </span>
          ) : canProcess ? (
            <button
              onClick={process}
              disabled={processing || !s.complete}
              title={s.complete ? "Email the office the deal record and file it" : "All required documents must be complete first"}
              className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Process this deal
            </button>
          ) : null}
        </div>
      </div>

      {/* Five-stage progress rail — horizontal on desktop, vertical on mobile */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        {/* desktop */}
        <div className="hidden sm:flex items-start">
          {STAGES.map((st, i) => {
            const state = flow.stageStates[st.key];
            const Icon = state === "complete" ? CheckCircle2 : st.icon;
            const isLast = i === STAGES.length - 1;
            return (
              <div key={st.key} className="flex-1 flex flex-col items-center text-center relative">
                {!isLast && (
                  <span className={`absolute top-6 left-1/2 w-full h-0.5 ${state === "complete" ? "bg-emerald-400" : "bg-border"}`} />
                )}
                <span
                  className={`relative z-10 w-12 h-12 rounded-2xl flex items-center justify-center ring-4 ring-offset-0 ${
                    state === "complete"
                      ? "bg-emerald-100 text-emerald-700 ring-emerald-50"
                      : state === "active"
                        ? TONE_ACTIVE[st.tone]
                        : "bg-slate-100 text-slate-400 ring-transparent"
                  }`}
                >
                  <Icon className="w-6 h-6" strokeWidth={2} />
                </span>
                <p className={`mt-2.5 text-[15px] font-semibold leading-tight px-1 ${state === "upcoming" ? "text-muted-foreground" : "text-foreground"}`}>{st.label}</p>
                <p className="text-[13px] text-muted-foreground mt-0.5 px-1">
                  {state === "active" ? <span className="text-foreground font-medium">In progress</span> : st.sub}
                </p>
              </div>
            );
          })}
        </div>
        {/* mobile */}
        <ol className="sm:hidden space-y-0">
          {STAGES.map((st, i) => {
            const state = flow.stageStates[st.key];
            const Icon = state === "complete" ? CheckCircle2 : st.icon;
            const isLast = i === STAGES.length - 1;
            return (
              <li key={st.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                      state === "complete"
                        ? "bg-emerald-100 text-emerald-700"
                        : state === "active"
                          ? TONE_ACTIVE[st.tone]
                          : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  {!isLast && <span className={`w-0.5 flex-1 my-1 ${state === "complete" ? "bg-emerald-400" : "bg-border"}`} />}
                </div>
                <div className={`pt-1.5 pb-4 ${isLast ? "" : ""}`}>
                  <p className={`text-[15px] font-semibold leading-tight ${state === "upcoming" ? "text-muted-foreground" : "text-foreground"}`}>{st.label}</p>
                  <p className="text-[13px] text-muted-foreground mt-0.5">{state === "active" ? "In progress" : st.sub}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Attention required — the single next action */}
      {nextAction && (
        <div className={`rounded-2xl border p-4 sm:p-5 ${flow.delivered ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="flex items-start gap-3">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${flow.delivered ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {flow.delivered ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`text-body font-semibold ${flow.delivered ? "text-emerald-900" : "text-amber-900"}`}>{nextAction.title}</p>
              <p className={`text-body-sm mt-0.5 ${flow.delivered ? "text-emerald-800" : "text-amber-800"}`}>{nextAction.why}</p>
              <p className="text-caption text-muted-foreground mt-1.5">Owner: <span className="font-semibold text-foreground">{nextAction.owner}</span></p>
            </div>
            {nextAction.cta && (
              <button
                onClick={nextAction.cta.onClick}
                disabled={processing || genForms}
                className={`h-10 px-4 rounded-md text-sm font-semibold inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50 ${
                  nextAction.cta.primary ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"
                }`}
              >
                {(processing || genForms) ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {nextAction.cta.label}
                {!(processing || genForms) && <ChevronRight className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Required documents */}
      <div>
        <h3 className="text-body font-semibold text-foreground mb-2">Required documents</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {docCards.filter((c) => c.show).map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.key} className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${c.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-body-sm font-semibold text-foreground">{c.label}</p>
                      {c.official && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Official form</span>}
                    </div>
                    <p className="text-caption text-muted-foreground mt-0.5">{c.meta}</p>
                  </div>
                  {c.done
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    : <Circle className="w-4 h-4 text-slate-300 flex-shrink-0" />}
                </div>
                <div className="flex items-center justify-between gap-2 mt-auto">
                  <span className={`text-caption font-semibold ${c.done ? "text-emerald-700" : "text-muted-foreground"}`}>{c.status}</span>
                  <div className="flex items-center gap-1.5">
                    {c.onCertify && (
                      <button
                        onClick={c.onCertify}
                        className="h-8 px-2.5 rounded-md bg-slate-800 text-white text-caption font-semibold inline-flex items-center gap-1 hover:bg-slate-700"
                        title="Licensee certification — review the inspection and sign the A/B/C result"
                      >
                        <BadgeCheck className="w-3 h-3" /> Certify
                      </button>
                    )}
                    {c.official && record.isUsed && (
                      <button
                        onClick={() => viewFilledForm(c.key === "k208" ? "k208" : "buyers_guide")}
                        disabled={genForms}
                        className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1 hover:bg-muted disabled:opacity-50"
                        title="Fill and open the exact official PDF"
                      >
                        {genForms ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} Official PDF
                      </button>
                    )}
                    {c.open && (
                      <button onClick={c.open} className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1 hover:bg-muted">
                        Open <ArrowUpRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Licensee certification modal — the manager confirms the A/B/C result
          and signs, distinct from the technician's inspection. */}
      {certifyOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => !certifying && setCertifyOpen(false)}>
          <div className="w-full sm:max-w-lg bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-xl max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card">
              <h3 className="text-body font-semibold text-foreground inline-flex items-center gap-1.5"><BadgeCheck className="w-4 h-4 text-slate-700" /> Certify K-208 (licensee)</h3>
              <button onClick={() => setCertifyOpen(false)} disabled={certifying} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-caption text-muted-foreground">Review the completed inspection, then confirm the inspection result and sign as the authorized licensee.</p>
              <div className="space-y-2">
                {K208_INSPECTION_RESULTS.map((r) => (
                  <button
                    key={r.code}
                    onClick={() => setCertResult(r.code)}
                    className={`w-full text-left rounded-xl border p-3 flex gap-3 transition-colors ${certResult === r.code ? "border-slate-800 bg-slate-50" : "border-border hover:bg-muted"}`}
                  >
                    <span className={`w-7 h-7 rounded-md flex items-center justify-center font-bold shrink-0 ${certResult === r.code ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}>{r.code}</span>
                    <span className="text-caption text-foreground leading-snug">{r.label}</span>
                  </button>
                ))}
              </div>
              <input
                value={certName}
                onChange={(e) => setCertName(e.target.value)}
                placeholder="Licensee printed name"
                className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm"
              />
              <p className="text-[11px] text-muted-foreground leading-snug">{K208_CERTIFICATION_TEXT}</p>
              <SignaturePad label="Licensee signature" subtitle="Sign to certify" value={certSig.data} type={certSig.type} onChange={(data, type) => setCertSig({ data, type })} />
              <button
                onClick={certifyK208}
                disabled={certifying || !certResult || !certSig.data}
                className="w-full h-11 rounded-md bg-slate-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {certifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
                Certify inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
