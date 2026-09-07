import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useDealRecord, dealDocStatus } from "@/hooks/useDealRecord";
import {
  CheckCircle2, Circle, Loader2, FileText, ShieldCheck, Wrench, BookOpen,
  ArrowUpRight, AlertTriangle, ChevronRight, X, BadgeCheck,
} from "lucide-react";
import { toast } from "sonner";
import SignaturePad from "@/components/addendum/SignaturePad";
import { K208_INSPECTION_RESULTS, K208_CERTIFICATION_TEXT } from "@/data/ctK208Form";
import { deriveFlow, fmtDealDate as fmt, nextDealAction } from "./dealFlow";

// ──────────────────────────────────────────────────────────────
// The deal's DOCUMENTS — the canonical place the official forms are filled,
// certified and viewed: the FTC Buyers Guide (16 CFR 455, English or Spanish)
// and the CT K-208 safety inspection, alongside the addendum and Get-Ready
// records they are filed with.
//
// "Fill official forms" fills the exact AcroForm PDFs via
// generate-vehicle-forms; "Certify" records the licensee certification. The
// stage rail, processing and delivery live on the Customer tab.
// ──────────────────────────────────────────────────────────────

export default function DealDocumentsPanel({ vehicle }: { vehicle: { id: string; vin: string; ymm?: string | null } }) {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canProcess = hasDealerCapability(member?.role, "can_approve_print", isAdmin);
  const { record, loading, reload } = useDealRecord(vehicle.vin, vehicle.id, tenant?.id);
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
    // Open the tab synchronously inside the click gesture, then point it at the
    // filled PDF once it's generated. Calling window.open AFTER the async fill
    // gets blocked by the browser as an unrequested pop-up on the second form of
    // a session — which is why the K-208 opened but the Buyers Guide silently
    // did not.
    const win = window.open("about:blank", "_blank");
    setGenForms(true);
    try {
      const body: Record<string, unknown> = { tenant_id: tenant.id, vin: vehicle.vin, kinds: [kind], lang, app_base: window.location.origin };
      if (kind === "buyers_guide" && record?.buyersGuide?.box) body.box = record.buyersGuide.box;
      const { data, error } = await (supabase as any).functions.invoke("generate-vehicle-forms", { body });
      const url = data?.forms?.[kind] as string | undefined;
      if (error || !data?.ok || !url) { win?.close(); toast.error("Couldn't open the official form"); return; }
      if (win) win.location.href = url; else window.open(url, "_blank", "noopener");
      await reload();
    } finally {
      setGenForms(false);
    }
  };

  const flow = useMemo(() => {
    if (!record) return null;
    return deriveFlow(record, dealDocStatus(record));
  }, [record]);

  const nextAction = useMemo(() => {
    if (!record || !flow) return null;
    return nextDealAction(record, flow, { vehicleId: vehicle.id, vin: vehicle.vin, canProcess });
  }, [record, flow, canProcess, vehicle.id, vehicle.vin]);

  if (loading) return <p className="text-body-sm text-muted-foreground">Loading deal documents…</p>;
  if (!record || !flow) return <p className="text-body-sm text-muted-foreground">No deal record yet for this vehicle.</p>;

  const s = dealDocStatus(record);

  const runCta = () => {
    if (!nextAction?.cta) return;
    const cta = nextAction.cta;
    if (cta.kind === "navigate" && cta.to) navigate(cta.to);
    else if (cta.kind === "fillForms") void generateForms();
    else if (cta.kind === "certifyK208") setCertifyOpen(true);
  };

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
      // The /k208 page is the SIGNED-inspection viewer — only useful once service
      // has signed. Before that it shows "no completed K-208 yet", which reads as
      // broken, so the single "Official PDF" button is the way to view the draft.
      open: record.k208 ? () => navigate(`/k208/${vehicle.vin}`) : undefined,
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
      show: record.isUsed,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-title font-display font-semibold text-foreground">Official forms &amp; deal documents</h2>
          <p className="text-body-sm text-muted-foreground mt-0.5">
            Filled from this vehicle's own data and filed by VIN <span className="font-mono">{vehicle.vin}</span>. The Customer tab tracks where the deal stands.
          </p>
        </div>
        {canProcess && record.isUsed && (
          <div className="flex items-center gap-2 flex-wrap">
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
          </div>
        )}
      </div>

      {/* The one document standing between this deal and delivery, actionable
          here rather than only named. Non-document blockers belong to the
          Customer tab's stage rail. */}
      {nextAction?.documentStep && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-amber-100 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-body font-semibold text-amber-900">{nextAction.title}</p>
              <p className="text-body-sm mt-0.5 text-amber-800">{nextAction.why}</p>
              <p className="text-caption text-muted-foreground mt-1.5">Owner: <span className="font-semibold text-foreground">{nextAction.owner}</span></p>
            </div>
            {nextAction.cta && (
              <button
                onClick={runCta}
                disabled={genForms}
                className="h-10 px-4 rounded-md text-sm font-semibold inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50 bg-primary text-primary-foreground"
              >
                {genForms ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {nextAction.cta.label}
                {!genForms && <ChevronRight className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-body font-semibold text-foreground mb-2">Required documents</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {docCards.filter((c) => c.show).map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.key} className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${c.done ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-body-sm font-semibold text-foreground">{c.label}</p>
                      {c.official && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Official form</span>}
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
                    className={`w-full text-left rounded-xl border p-3 flex gap-3 transition-colors ${certResult === r.code ? "border-slate-800 bg-muted" : "border-border hover:bg-muted"}`}
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
