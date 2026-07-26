import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { uploadPhoto } from "@/lib/storage";
import { toast } from "sonner";
import { Wrench, X, AlertTriangle, Loader2, Check, MessageSquare, DollarSign, Camera } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// Additional-work request + structured manager approval.
//
// Service files a request when they find work beyond the get-ready plan; the
// sales/used-car manager approves, declines, approves with a spending limit, or
// asks for clarification. The decision goes through decide_service_request
// (20260726107000): authority check, audit_log, deduped notification to the
// requester — a chat message alone never authorizes work.
// ──────────────────────────────────────────────────────────────

interface Veh { id: string; vin: string; ymm: string | null; }

const IMPACT = [
  { key: "none", label: "No delivery impact" },
  { key: "delays", label: "Delays delivery" },
  { key: "blocks", label: "Blocks delivery" },
];

const money = (n?: number | null) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US")}`);

export function RequestAdditionalWorkButton({ tenantId, veh, inspectionItemId, onSubmitted }: {
  tenantId: string;
  veh: Veh;
  /** Ties the request to the exact failed item (service_requests.inspection_item_id). */
  inspectionItemId?: string | null;
  onSubmitted?: () => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const blank = { work: "", reason: "", repair: "", safety: false, parts: "", labor: "", sublet: "", impact: "none", ro: "", message: "" };
  const [f, setF] = useState(blank);
  const [photos, setPhotos] = useState<string[]>([]);
  const total = (Number(f.parts) || 0) + (Number(f.labor) || 0) + (Number(f.sublet) || 0);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const up = await uploadPhoto("prep-photos", file, { tenantId, vin: veh.vin });
        if (up?.url) setPhotos((p) => [...p, up.url]);
      } catch { toast.error(`Couldn't upload ${file.name}`); }
    }
    setUploading(false);
  };

  const submit = async () => {
    if (!f.work.trim()) { toast.error("Describe the work requested"); return; }
    setBusy(true);
    const { error } = await (supabase as any).from("service_requests").insert({
      tenant_id: tenantId, vehicle_listing_id: veh.id, vin: veh.vin, ymm: veh.ymm,
      requested_by: user?.id ?? null, requested_by_name: user?.email?.split("@")[0] || null,
      work_requested: f.work.trim(), reason: f.reason.trim() || null,
      recommended_repair: f.repair.trim() || null, is_safety: f.safety,
      est_parts: Number(f.parts) || null, est_labor: Number(f.labor) || null,
      sublet_cost: Number(f.sublet) || null, est_total: total || null,
      delivery_impact: f.impact, ro_number: f.ro.trim() || null, message: f.message.trim() || null,
      photos, inspection_item_id: inspectionItemId ?? null,
    });
    setBusy(false);
    if (error) { toast.error("Couldn't submit the request"); return; }
    toast.success("Additional-work request sent to the manager");
    setF(blank); setPhotos([]); setOpen(false); onSubmitted?.();
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="min-h-[44px] px-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-amber-100">
        <Wrench className="w-4 h-4" /> Request additional work
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => !busy && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Request additional work" className="w-full sm:max-w-lg bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-xl max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
              <h3 className="text-body font-semibold text-foreground inline-flex items-center gap-1.5"><Wrench className="w-4 h-4 text-amber-600" /> Request additional work</h3>
              <button onClick={() => setOpen(false)} disabled={busy} aria-label="Close" className="w-11 h-11 grid place-items-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-caption text-muted-foreground">{veh.ymm} · <span className="font-mono">…{veh.vin.slice(-8)}</span></p>
              <Field label="Work requested">
                <textarea value={f.work} onChange={(e) => setF({ ...f, work: e.target.value })} rows={2} placeholder="e.g. Replace front tires — below 4/32&quot;" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm" />
              </Field>
              <Field label="Reason">
                <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Why it's needed" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
              </Field>
              <Field label="Recommended repair">
                <input value={f.repair} onChange={(e) => setF({ ...f, repair: e.target.value })} placeholder="The repair you recommend" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
              </Field>
              <label className="flex items-center gap-2 text-sm text-foreground min-h-[44px]">
                <input type="checkbox" checked={f.safety} onChange={(e) => setF({ ...f, safety: e.target.checked })} />
                <span className="inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-red-500" /> Safety-related (blocks delivery until resolved)</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Est. parts"><input inputMode="decimal" value={f.parts} onChange={(e) => setF({ ...f, parts: e.target.value })} placeholder="0" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" /></Field>
                <Field label="Est. labor"><input inputMode="decimal" value={f.labor} onChange={(e) => setF({ ...f, labor: e.target.value })} placeholder="0" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" /></Field>
                <Field label="Sublet"><input inputMode="decimal" value={f.sublet} onChange={(e) => setF({ ...f, sublet: e.target.value })} placeholder="0" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" /></Field>
              </div>
              <p className="text-sm text-foreground">Total estimate: <span className="font-bold">{money(total || null)}</span></p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Delivery impact">
                  <select value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })} className="w-full h-11 rounded-lg border border-border bg-background px-2 text-sm">
                    {IMPACT.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
                  </select>
                </Field>
                <Field label="RO #"><input value={f.ro} onChange={(e) => setF({ ...f, ro: e.target.value })} placeholder="Repair order" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" /></Field>
              </div>
              <Field label="Photos">
                <input type="file" accept="image/*" multiple id="aw-photos" className="hidden" onChange={(e) => onFiles(e.target.files)} />
                <div className="flex items-center gap-2 flex-wrap">
                  <label htmlFor="aw-photos" className="min-h-[44px] px-3 rounded-md border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted cursor-pointer">
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} Add photo
                  </label>
                  {photos.length > 0 && <span className="text-xs text-muted-foreground">{photos.length} attached</span>}
                </div>
              </Field>
              <Field label="Message to manager">
                <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} rows={2} placeholder="Optional note" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm" />
              </Field>
              <button onClick={submit} disabled={busy || uploading || !f.work.trim()} className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} Send request to manager
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// deno-lint-ignore no-explicit-any
type Req = any;

export function ServiceApprovalsPanel({ tenantId, vin, onDecided }: { tenantId: string; vin?: string; onDecided?: () => void }) {
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canApprove = hasDealerCapability(member?.role, "can_approve_service_work", isAdmin);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Decisions that need input (limit amount, clarify/decline note) open a
  // small inline form instead of window.prompt.
  const [pendingDecision, setPendingDecision] = useState<{ id: string; kind: "approved_limit" | "clarify" | "declined" } | null>(null);
  const [decisionValue, setDecisionValue] = useState("");

  const load = async () => {
    let q = (supabase as any).from("service_requests")
      .select("*").eq("tenant_id", tenantId).eq("status", "pending").order("created_at", { ascending: false });
    if (vin) q = q.eq("vin", vin.toUpperCase());
    const { data } = await q;
    setReqs((data as Req[]) || []); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId, vin]);

  // The ONLY decision path: decide_service_request checks authority, writes
  // audit_log, and notifies the requester (deduped) server-side.
  const decide = async (id: string, decision: string, note?: string | null, spendLimit?: number | null) => {
    setBusyId(id);
    const { error } = await (supabase as any).rpc("decide_service_request", {
      p_request_id: id, p_decision: decision, p_note: note ?? null, p_spend_limit: spendLimit ?? null,
    });
    setBusyId(null);
    if (error) {
      const m = String(error.message || "");
      toast.error(/not_authorized/.test(m) ? "Your role can't decide additional-work requests." : "Couldn't record the decision");
      return;
    }
    toast.success("Decision recorded"); load(); onDecided?.();
  };

  const openDecisionForm = (id: string, kind: "approved_limit" | "clarify" | "declined") => {
    setPendingDecision({ id, kind });
    setDecisionValue("");
  };

  const confirmDecision = (id: string) => {
    if (!pendingDecision || pendingDecision.id !== id) return;
    const v = decisionValue.trim();
    if (pendingDecision.kind === "approved_limit") {
      const n = Number(v.replace(/[^0-9.]/g, ""));
      if (!n || n <= 0) { toast.error("Enter the dollar limit to approve up to"); return; }
      decide(id, "approved_limit", null, n);
    } else if (pendingDecision.kind === "clarify") {
      if (!v) { toast.error("Say what you need clarified"); return; }
      decide(id, "clarify", v);
    } else {
      decide(id, "declined", v || null);
    }
    setPendingDecision(null);
    setDecisionValue("");
  };

  const DECISION_FORM_META = {
    approved_limit: { label: "Approve up to what dollar amount?", placeholder: "e.g. 500", inputMode: "decimal" as const, confirm: "Approve with limit" },
    clarify: { label: "What do you need clarified?", placeholder: "Question for the requester", inputMode: "text" as const, confirm: "Send question" },
    declined: { label: "Reason for declining (optional)", placeholder: "Optional reason", inputMode: "text" as const, confirm: "Decline request" },
  };

  if (loading || reqs.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-amber-600" />
        <h2 className="text-body font-bold text-foreground">Additional-work approvals</h2>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800">{reqs.length}</span>
      </div>
      <div className="space-y-3">
        {reqs.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{r.ymm || "Vehicle"} <span className="font-mono text-[11px] text-muted-foreground">…{String(r.vin).slice(-8)}</span></p>
                <p className="text-sm text-foreground mt-0.5">{r.work_requested}</p>
                {r.reason && <p className="text-caption text-muted-foreground">{r.reason}</p>}
                {r.recommended_repair && <p className="text-caption text-muted-foreground">Recommended: {r.recommended_repair}</p>}
                <div className="flex items-center gap-2 flex-wrap mt-1.5 text-[11px]">
                  {r.is_safety && <span className="font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Safety</span>}
                  <span className="text-muted-foreground">Est. <b className="text-foreground">{money(r.est_total)}</b> (parts {money(r.est_parts)} · labor {money(r.est_labor)}{r.sublet_cost != null ? ` · sublet ${money(r.sublet_cost)}` : ""})</span>
                  {r.ro_number && <span className="text-muted-foreground">RO {r.ro_number}</span>}
                  <span className="text-muted-foreground">by {r.requested_by_name || "service"}</span>
                </div>
                {Array.isArray(r.photos) && r.photos.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {(r.photos as string[]).slice(0, 4).map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer">
                        <img src={u} alt="Request evidence" className="w-12 h-9 rounded-md object-cover border border-border" />
                      </a>
                    ))}
                  </div>
                )}
                {r.message && <p className="text-caption text-muted-foreground mt-1 inline-flex items-start gap-1"><MessageSquare className="w-3 h-3 mt-0.5" /> {r.message}</p>}
              </div>
            </div>
            {canApprove ? (
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button disabled={busyId === r.id} onClick={() => decide(r.id, "approved")} className="min-h-[44px] px-3 rounded-md bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> Approve</button>
                  <button disabled={busyId === r.id} aria-expanded={pendingDecision !== null && pendingDecision.id === r.id && pendingDecision.kind === "approved_limit"} onClick={() => openDecisionForm(r.id, "approved_limit")} className="min-h-[44px] px-3 rounded-md border border-emerald-300 text-emerald-700 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"><DollarSign className="w-3.5 h-3.5" /> Approve w/ limit</button>
                  <button disabled={busyId === r.id} aria-expanded={pendingDecision !== null && pendingDecision.id === r.id && pendingDecision.kind === "clarify"} onClick={() => openDecisionForm(r.id, "clarify")} className="min-h-[44px] px-3 rounded-md border border-border text-foreground text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"><MessageSquare className="w-3.5 h-3.5" /> Clarify</button>
                  <button disabled={busyId === r.id} aria-expanded={pendingDecision !== null && pendingDecision.id === r.id && pendingDecision.kind === "declined"} onClick={() => openDecisionForm(r.id, "declined")} className="min-h-[44px] px-3 rounded-md border border-rose-200 text-rose-600 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"><X className="w-3.5 h-3.5" /> Decline</button>
                </div>
                {(() => {
                  const pd = pendingDecision;
                  if (!pd || pd.id !== r.id) return null;
                  const meta = DECISION_FORM_META[pd.kind];
                  return (
                    <form
                      onSubmit={(e) => { e.preventDefault(); confirmDecision(r.id); }}
                      className="flex items-end gap-2 flex-wrap rounded-lg border border-border bg-muted/40 p-2.5"
                    >
                      <label className="flex-1 min-w-[180px]">
                        <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{meta.label}</span>
                        <input
                          autoFocus
                          value={decisionValue}
                          onChange={(e) => setDecisionValue(e.target.value)}
                          inputMode={meta.inputMode}
                          placeholder={meta.placeholder}
                          className="mt-1 w-full h-11 rounded-lg border border-border bg-background px-3 text-sm"
                        />
                      </label>
                      <button type="submit" disabled={busyId === r.id} className="min-h-[44px] px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
                        {meta.confirm}
                      </button>
                      <button type="button" onClick={() => { setPendingDecision(null); setDecisionValue(""); }} className="min-h-[44px] px-3 rounded-md border border-border text-foreground text-xs font-semibold">
                        Cancel
                      </button>
                    </form>
                  );
                })()}
              </div>
            ) : (
              <p className="text-caption text-muted-foreground mt-3 pt-3 border-t border-border">Awaiting a manager's decision. Your role can't decide additional-work requests.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
