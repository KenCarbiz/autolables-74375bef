import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { toast } from "sonner";
import { Wrench, X, AlertTriangle, Loader2, Check, MessageSquare, DollarSign } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// Additional-work request + structured manager approval.
//
// Service files a request when they find work beyond the get-ready plan; the
// sales/used-car manager approves, declines, approves with a spending limit, or
// asks for clarification. The decision is a structured status on service_requests
// — a chat message alone never authorizes work.
// ──────────────────────────────────────────────────────────────

interface Veh { id: string; vin: string; ymm: string | null; }

const IMPACT = [
  { key: "none", label: "No delivery impact" },
  { key: "delays", label: "Delays delivery" },
  { key: "blocks", label: "Blocks delivery" },
];

const money = (n?: number | null) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US")}`);

export function RequestAdditionalWorkButton({ tenantId, veh, onSubmitted }: { tenantId: string; veh: Veh; onSubmitted?: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const blank = { work: "", reason: "", safety: false, parts: "", labor: "", impact: "none", ro: "", message: "" };
  const [f, setF] = useState(blank);
  const total = (Number(f.parts) || 0) + (Number(f.labor) || 0);

  const submit = async () => {
    if (!f.work.trim()) { toast.error("Describe the work requested"); return; }
    setBusy(true);
    const { error } = await (supabase as any).from("service_requests").insert({
      tenant_id: tenantId, vehicle_listing_id: veh.id, vin: veh.vin, ymm: veh.ymm,
      requested_by: user?.id ?? null, requested_by_name: user?.email?.split("@")[0] || null,
      work_requested: f.work.trim(), reason: f.reason.trim() || null, is_safety: f.safety,
      est_parts: Number(f.parts) || null, est_labor: Number(f.labor) || null, est_total: total || null,
      delivery_impact: f.impact, ro_number: f.ro.trim() || null, message: f.message.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error("Couldn't submit the request"); return; }
    toast.success("Additional-work request sent to the manager");
    setF(blank); setOpen(false); onSubmitted?.();
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="h-10 px-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-amber-100">
        <Wrench className="w-4 h-4" /> Request additional work
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full sm:max-w-lg bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-xl max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card">
              <h3 className="text-body font-semibold text-foreground inline-flex items-center gap-1.5"><Wrench className="w-4 h-4 text-amber-600" /> Request additional work</h3>
              <button onClick={() => setOpen(false)} disabled={busy} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-caption text-muted-foreground">{veh.ymm} · <span className="font-mono">…{veh.vin.slice(-8)}</span></p>
              <Field label="Work requested">
                <textarea value={f.work} onChange={(e) => setF({ ...f, work: e.target.value })} rows={2} placeholder="e.g. Replace front tires — below 4/32&quot;" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm" />
              </Field>
              <Field label="Reason">
                <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Why it's needed" className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm" />
              </Field>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={f.safety} onChange={(e) => setF({ ...f, safety: e.target.checked })} />
                <span className="inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-red-500" /> Safety-related (blocks delivery until resolved)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Est. parts"><input inputMode="decimal" value={f.parts} onChange={(e) => setF({ ...f, parts: e.target.value })} placeholder="0" className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm" /></Field>
                <Field label="Est. labor"><input inputMode="decimal" value={f.labor} onChange={(e) => setF({ ...f, labor: e.target.value })} placeholder="0" className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm" /></Field>
              </div>
              <p className="text-sm text-foreground">Total estimate: <span className="font-bold">{money(total || null)}</span></p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Delivery impact">
                  <select value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })} className="w-full h-10 rounded-lg border border-border bg-background px-2 text-sm">
                    {IMPACT.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
                  </select>
                </Field>
                <Field label="RO #"><input value={f.ro} onChange={(e) => setF({ ...f, ro: e.target.value })} placeholder="Repair order" className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm" /></Field>
              </div>
              <Field label="Message to manager">
                <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} rows={2} placeholder="Optional note" className="w-full rounded-lg border border-border bg-background p-2.5 text-sm" />
              </Field>
              <button onClick={submit} disabled={busy || !f.work.trim()} className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
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

export function ServiceApprovalsPanel({ tenantId }: { tenantId: string }) {
  const { user, isAdmin } = useAuth();
  const { member } = useEntitlements();
  const canApprove = hasDealerCapability(member?.role, "can_approve_print", isAdmin);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await (supabase as any).from("service_requests")
      .select("*").eq("tenant_id", tenantId).eq("status", "pending").order("created_at", { ascending: false });
    setReqs((data as Req[]) || []); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  const decide = async (id: string, status: string, extra: Record<string, unknown> = {}) => {
    setBusyId(id);
    const { error } = await (supabase as any).from("service_requests").update({
      status, decided_by: user?.id ?? null, decided_by_name: user?.email?.split("@")[0] || null,
      decided_at: new Date().toISOString(), ...extra,
    }).eq("id", id);
    setBusyId(null);
    if (error) { toast.error("Couldn't record the decision"); return; }
    toast.success("Decision recorded"); load();
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
                <div className="flex items-center gap-2 flex-wrap mt-1.5 text-[11px]">
                  {r.is_safety && <span className="font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Safety</span>}
                  <span className="text-muted-foreground">Est. <b className="text-foreground">{money(r.est_total)}</b> (parts {money(r.est_parts)} · labor {money(r.est_labor)})</span>
                  {r.ro_number && <span className="text-muted-foreground">RO {r.ro_number}</span>}
                  <span className="text-muted-foreground">by {r.requested_by_name || "service"}</span>
                </div>
                {r.message && <p className="text-caption text-muted-foreground mt-1 inline-flex items-start gap-1"><MessageSquare className="w-3 h-3 mt-0.5" /> {r.message}</p>}
              </div>
            </div>
            {canApprove ? (
              <div className="flex items-center gap-1.5 flex-wrap mt-3 pt-3 border-t border-border">
                <button disabled={busyId === r.id} onClick={() => decide(r.id, "approved")} className="h-8 px-3 rounded-md bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> Approve</button>
                <button disabled={busyId === r.id} onClick={() => { const v = window.prompt("Approve up to what dollar amount?"); if (v == null) return; const n = Number(v.replace(/[^0-9.]/g, "")); if (!n) return; decide(r.id, "approved_limit", { spend_limit: n }); }} className="h-8 px-3 rounded-md border border-emerald-300 text-emerald-700 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"><DollarSign className="w-3.5 h-3.5" /> Approve w/ limit</button>
                <button disabled={busyId === r.id} onClick={() => { const note = window.prompt("What do you need clarified?") || ""; decide(r.id, "clarify", { manager_note: note || null }); }} className="h-8 px-3 rounded-md border border-border text-foreground text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"><MessageSquare className="w-3.5 h-3.5" /> Clarify</button>
                <button disabled={busyId === r.id} onClick={() => { const note = window.prompt("Reason for declining (optional)") || ""; decide(r.id, "declined", { manager_note: note || null }); }} className="h-8 px-3 rounded-md border border-rose-200 text-rose-600 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"><X className="w-3.5 h-3.5" /> Decline</button>
              </div>
            ) : (
              <p className="text-caption text-muted-foreground mt-3 pt-3 border-t border-border">Awaiting a manager's decision.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
