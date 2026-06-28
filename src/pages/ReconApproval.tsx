import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Car, DollarSign, ShieldAlert, Wrench } from "lucide-react";

const NAME_KEY = "autolabels.signer.ucm";

// /approve/:token — the used-car manager's no-login approve/decline surface for a
// recon estimate submitted by service. Resolves via get_recon_estimate; decisions
// go through the token-gated decide_recon_line / decide_recon_estimate RPCs.

interface Line {
  id: string; category: string | null; description: string; severity: string;
  labor_cost: number; parts_cost: number; sublet_cost: number; line_total: number;
  vendor: string | null; photos: unknown[]; approval_status: string;
  approved_amount: number | null; decline_reason: string | null;
}
interface Estimate {
  id: string; vin: string; ymm: string | null; status: string; submitted_by: string | null;
  submitted_role: string | null; notes: string | null; subtotal: number; approved_total: number;
  created_at: string; vehicle_price: number | null;
}

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const photoUrls = (p: unknown[]): string[] => (Array.isArray(p) ? p : []).map((x) => typeof x === "string" ? x : (x as { url?: string })?.url || "").filter(Boolean);

const SEV: Record<string, { label: string; cls: string }> = {
  required: { label: "Required", cls: "bg-red-100 text-red-700" },
  recommended: { label: "Recommended", cls: "bg-amber-100 text-amber-700" },
  ok: { label: "OK", cls: "bg-emerald-100 text-emerald-700" },
  na: { label: "N/A", cls: "bg-slate-100 text-slate-600" },
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  auto_approved: { label: "Auto-approved", cls: "bg-emerald-50 text-emerald-600" },
  declined: { label: "Declined", cls: "bg-red-100 text-red-700" },
  deferred: { label: "Deferred", cls: "bg-slate-100 text-slate-600" },
};

export default function ReconApproval() {
  const { token = "" } = useParams();
  const [est, setEst] = useState<Estimate | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [approver, setApprover] = useState(() => { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } });
  const [busy, setBusy] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    // deno-lint-ignore no-explicit-any
    const { data } = await (supabase as any).rpc("get_recon_estimate", { _approval_token: token });
    if (!data?.ok) { setNotFound(true); setLoading(false); return; }
    setEst(data.estimate as Estimate);
    setLines((data.lines || []) as Line[]);
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const decideLine = async (lineId: string, action: "approve" | "decline", declineReason?: string) => {
    setBusy(lineId);
    // deno-lint-ignore no-explicit-any
    const { data } = await (supabase as any).rpc("decide_recon_line", {
      _approval_token: token, _line_id: lineId, _action: action, _reason: declineReason || null, _by: approver.trim() || null, _channel: "link",
    });
    setBusy(null); setDeclineFor(null); setReason("");
    if (data?.ok) { try { if (approver.trim()) localStorage.setItem(NAME_KEY, approver.trim()); } catch { /* ignore */ } await load(); }
    else toast.error(data?.reason === "reason_required" ? "Add a reason to decline." : "Couldn't record that — try again.");
  };

  const decideAll = async (action: "approve" | "decline") => {
    setBusy("all");
    // deno-lint-ignore no-explicit-any
    const { data } = await (supabase as any).rpc("decide_recon_estimate", {
      _approval_token: token, _action: action, _by: approver.trim() || null, _channel: "link",
    });
    setBusy(null);
    if (data?.ok) { try { if (approver.trim()) localStorage.setItem(NAME_KEY, approver.trim()); } catch { /* ignore */ } await load(); }
    else toast.error("Couldn't record that — try again.");
  };

  if (loading) return <div className="min-h-screen grid place-items-center bg-background"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (notFound || !est) return (
    <div className="min-h-screen grid place-items-center bg-background p-6">
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 text-center space-y-3">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
        <h1 className="text-lg font-bold text-foreground">This approval link isn't active.</h1>
        <p className="text-sm text-muted-foreground">Ask service to re-send the recon estimate.</p>
      </div>
    </div>
  );

  const pending = lines.filter((l) => l.approval_status === "pending");
  const pendingTotal = pending.reduce((s, l) => s + l.line_total, 0);
  const overMargin = est.vehicle_price != null && est.subtotal > 0 ? Math.round((est.subtotal / est.vehicle_price) * 100) : null;

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 z-10 bg-primary text-primary-foreground px-4 py-3 shadow-sm">
        <div className="font-display font-bold leading-tight">Recon Approval</div>
        <div className="text-xs opacity-90 inline-flex items-center gap-1.5"><Car className="w-3.5 h-3.5" /> {est.ymm || "Vehicle"} · {est.vin}</div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Decision context */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <Metric icon={<DollarSign className="w-4 h-4" />} label="Vehicle price" value={money(est.vehicle_price)} />
            <Metric icon={<Wrench className="w-4 h-4" />} label="Estimate total" value={money(est.subtotal)} />
            <Metric icon={<CheckCircle2 className="w-4 h-4" />} label="Approved" value={money(est.approved_total)} />
            <Metric icon={<ShieldAlert className="w-4 h-4" />} label="Awaiting you" value={money(pendingTotal)} />
          </div>
          {overMargin != null && overMargin >= 12 && (
            <p className="mt-3 text-[12px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 inline-flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Recon is {overMargin}% of the vehicle price — review margin before approving.
            </p>
          )}
          {est.submitted_by && <p className="mt-3 text-[12px] text-muted-foreground">Submitted by {est.submitted_by}{est.submitted_role ? ` · ${est.submitted_role}` : ""}{est.notes ? ` — “${est.notes}”` : ""}</p>}
        </div>

        {/* Approver identity */}
        <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Your name (for the record)"
          className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm" />

        {/* Lines */}
        <div className="space-y-3">
          {lines.map((l) => {
            const sev = SEV[l.severity] || SEV.recommended;
            const st = STATUS[l.approval_status] || STATUS.pending;
            const photos = photoUrls(l.photos);
            const isPending = l.approval_status === "pending";
            return (
              <div key={l.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${sev.cls}`}>{sev.label}</span>
                      {l.category && <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-600">{l.category}</span>}
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                    </div>
                    <p className="text-[15px] font-semibold text-foreground">{l.description}</p>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      {l.labor_cost > 0 && `Labor ${money(l.labor_cost)}`}{l.parts_cost > 0 && ` · Parts ${money(l.parts_cost)}`}{l.sublet_cost > 0 && ` · Sublet ${money(l.sublet_cost)}`}{l.vendor ? ` · ${l.vendor}` : ""}
                    </p>
                    {l.approval_status === "declined" && l.decline_reason && <p className="text-[12px] text-red-600 mt-1">Declined: {l.decline_reason}</p>}
                  </div>
                  <div className="text-right shrink-0"><div className="text-[18px] font-extrabold text-foreground">{money(l.line_total)}</div></div>
                </div>

                {photos.length > 0 && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {photos.slice(0, 6).map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="block h-16 w-16 rounded-lg border border-border overflow-hidden bg-muted"><img src={u} alt="" className="h-full w-full object-cover" /></a>)}
                  </div>
                )}

                {isPending && (
                  declineFor === l.id ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {["Price too high", "Not needed for sale", "Defer to next service", "Customer can address"].map((rc) => (
                          <button key={rc} onClick={() => setReason(rc)} className="h-8 px-2.5 rounded-full border border-border text-xs font-medium hover:border-red-300 hover:bg-red-50">{rc}</button>
                        ))}
                      </div>
                      <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for declining (required)" className="w-full h-11 rounded-lg border border-red-300 bg-background px-3 text-sm" />
                      <div className="flex gap-2">
                        <button disabled={!reason.trim() || busy === l.id} onClick={() => decideLine(l.id, "decline", reason.trim())} className="flex-1 h-10 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50">Confirm decline</button>
                        <button onClick={() => { setDeclineFor(null); setReason(""); }} className="h-10 px-4 rounded-lg border border-border text-sm font-semibold">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-3">
                      <button disabled={busy === l.id} onClick={() => decideLine(l.id, "approve")} className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                        {busy === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Approve
                      </button>
                      <button disabled={busy === l.id} onClick={() => setDeclineFor(l.id)} className="flex-1 h-10 rounded-lg border border-red-300 text-red-700 text-sm font-semibold inline-flex items-center justify-center gap-1.5">
                        <XCircle className="w-4 h-4" /> Decline
                      </button>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bulk action bar */}
      {pending.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-card border-t border-border p-3">
          <div className="max-w-2xl mx-auto flex gap-2">
            <button disabled={busy === "all"} onClick={() => decideAll("approve")} className="flex-1 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">
              {busy === "all" ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Approve all {pending.length} · {money(pendingTotal)}
            </button>
            <button disabled={busy === "all"} onClick={() => decideAll("decline")} className="h-12 px-4 rounded-xl border border-red-300 text-red-700 font-bold">Decline all</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground inline-flex items-center justify-center w-full mb-1">{icon}</div>
      <div className="text-[15px] font-bold text-foreground leading-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
