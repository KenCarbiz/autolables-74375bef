import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useDealRecord, dealDocStatus } from "@/hooks/useDealRecord";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { STAGES, TONE_ACTIVE, deriveFlow, fmtDealDate as fmt, nextDealAction } from "./dealFlow";

// ──────────────────────────────────────────────────────────────
// Where this deal stands for the CUSTOMER: the five-stage rail (file created →
// manager approval → department work → deal package → customer delivery), the
// single blocker and its owner, filing the deal, and the delivery signature.
//
// "Process this deal" files + emails the record — the only mutation here. The
// official forms themselves are produced on the Documents tab, so a blocker
// that is a document sends the reader there rather than growing a second place
// to fill one.
// ──────────────────────────────────────────────────────────────

export default function DealProgressPanel({ vehicle }: {
  vehicle: { id: string; vin: string; ymm?: string | null };
}) {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canProcess = hasDealerCapability(member?.role, "can_approve_print", isAdmin);
  const { record, loading, reload } = useDealRecord(vehicle.vin, vehicle.id, tenant?.id);
  const [processing, setProcessing] = useState(false);

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

  const nextAction = useMemo(() => {
    if (!record || !flow) return null;
    return nextDealAction(record, flow, { vehicleId: vehicle.id, vin: vehicle.vin, canProcess });
  }, [record, flow, canProcess, vehicle.id, vehicle.vin]);

  if (loading) return <p className="text-body-sm text-muted-foreground">Loading deal flow…</p>;
  if (!record || !flow) return <p className="text-body-sm text-muted-foreground">No deal record yet for this vehicle.</p>;

  const s = dealDocStatus(record);
  const cta = nextAction?.cta;
  // Filling and certifying an official form is the Documents tab's job; here
  // the blocker is named and the reader is sent to the tab that owns it.
  const ctaIsDocument = cta?.kind === "fillForms" || cta?.kind === "certifyK208";
  const ctaLabel = ctaIsDocument ? "Open Documents" : cta?.label;
  const runCta = () => {
    if (!cta) return;
    if (ctaIsDocument) navigate(`/vehicle-file/${vehicle.id}?tab=documents`);
    else if (cta.kind === "process") void process();
    else if (cta.to) navigate(cta.to);
  };

  return (
    <div className="space-y-5">
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
                        : "bg-muted text-muted-foreground ring-transparent"
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
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  {!isLast && <span className={`w-0.5 flex-1 my-1 ${state === "complete" ? "bg-emerald-400" : "bg-border"}`} />}
                </div>
                <div className="pt-1.5 pb-4">
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
            {cta && (
              <button
                onClick={runCta}
                disabled={processing}
                className="h-10 px-4 rounded-md text-sm font-semibold inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50 bg-primary text-primary-foreground"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {ctaLabel}
                {!processing && <ChevronRight className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
