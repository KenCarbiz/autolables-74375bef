import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useReconEstimates, type ReconEstimate, type ReconLine, type ReconMessage, type NewLine } from "@/hooks/useReconEstimates";
import { useDealerSettings, type ReconCannedService } from "@/contexts/DealerSettingsContext";
import NextStepBanner from "@/components/workflow/NextStepBanner";
import {
  Wrench, CheckCircle2, XCircle, Clock, Plus, Trash2, Printer, MessageSquare, Send, Loader2, Car, ShieldAlert, DollarSign,
} from "lucide-react";

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const photoUrls = (p: unknown[]): string[] => (Array.isArray(p) ? p : []).map((x) => typeof x === "string" ? x : (x as { url?: string })?.url || "").filter(Boolean);

const SEV: Record<string, string> = { required: "bg-red-100 text-red-700", recommended: "bg-amber-100 text-amber-700", ok: "bg-emerald-100 text-emerald-700", na: "bg-slate-100 text-slate-600" };
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  auto_approved: { label: "Auto-approved", cls: "bg-emerald-50 text-emerald-600" },
  declined: { label: "Declined", cls: "bg-red-100 text-red-700" },
  deferred: { label: "Deferred", cls: "bg-slate-100 text-slate-600" },
};
const CATEGORIES = ["mechanical", "safety", "tires", "glass", "cosmetic", "interior", "detail", "keys", "sublet"];

// HTML-escape every tenant-supplied field before interpolation: recon line
// descriptions/categories and vehicle ymm/vin all come from user-writable
// rows, so unescaped interpolation was a stored-XSS sink in the print window.
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const printWorkOrder = (est: ReconEstimate, lines: ReconLine[]) => {
  const todo = lines.filter((l) => l.approval_status === "approved" || l.approval_status === "auto_approved");
  const rows = todo.map((l) => `<tr><td>${esc(l.category || "")}</td><td>${esc(l.description)}</td><td style="text-align:right">${esc(money(l.line_total))}</td></tr>`).join("");
  const w = window.open("", "_blank", "width=700,height=800");
  if (!w) return;
  w.document.write(`<html><head><title>Recon Work Order — ${esc(est.vin)}</title>
    <style>body{font-family:Inter,Arial,sans-serif;color:#0F172A;padding:32px}h1{font-size:20px;margin:0}p{color:#64748B;margin:4px 0 16px}
    table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #E6E8EC;font-size:14px;text-align:left}
    tfoot td{font-weight:700;border-top:2px solid #0F172A}</style></head><body>
    <h1>Recon Work Order</h1><p>${esc(est.ymm || "Vehicle")} &middot; VIN ${esc(est.vin)} &middot; Approved work to perform</p>
    <table><thead><tr><th>Category</th><th>Work</th><th style="text-align:right">Cost</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No approved work.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="2">Approved total</td><td style="text-align:right">${esc(money(est.approved_total))}</td></tr></tfoot></table>
    </body></html>`);
  w.document.close(); w.focus(); w.print();
};

export default function ReconBoard() {
  const { estimates, isManager, loading, reload, loadDetail, submit, decide, postMessage, sendToService } = useReconEstimates();
  const { settings } = useDealerSettings();
  const canned = settings.recon_canned_services || [];
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ lines: ReconLine[]; messages: ReconMessage[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [showNew, setShowNew] = useState(false);

  const sel = estimates.find((e) => e.id === selId) || null;

  const refreshDetail = useCallback(async (id: string) => setDetail(await loadDetail(id)), [loadDetail]);
  useEffect(() => { if (selId) refreshDetail(selId); else setDetail(null); }, [selId, refreshDetail, estimates]);

  const groups = useMemo(() => ({
    needs: estimates.filter((e) => e.status === "submitted"),
    inRecon: estimates.filter((e) => e.status === "approved" || e.status === "partially_approved"),
    closed: estimates.filter((e) => e.status === "declined" || e.status === "completed" || e.status === "voided"),
  }), [estimates]);

  const onDecide = async (lineId: string | null, action: "approve" | "decline", r?: string) => {
    if (!sel) return;
    setBusy(lineId || "all");
    const ok = await decide(sel.id, lineId, action, r);
    setBusy(null); setDeclineFor(null); setReason("");
    if (ok) { await refreshDetail(sel.id); } else toast.error("Couldn't record that decision.");
  };
  const onPost = async () => {
    if (!sel || !msg.trim()) return;
    const ok = await postMessage(sel.id, msg.trim());
    if (ok) { setMsg(""); await refreshDetail(sel.id); } else toast.error("Couldn't post.");
  };
  // UCM OKs a staged intake estimate: approve everything still pending, then
  // release it to service in one tap.
  const onOkAndSend = async () => {
    if (!sel) return;
    setBusy("send");
    if (detail?.lines.some((l) => l.approval_status === "pending")) await decide(sel.id, null, "approve");
    const ok = await sendToService(sel.id);
    setBusy(null);
    if (ok) { await refreshDetail(sel.id); toast.success("Sent to service"); } else toast.error("Couldn't send to service.");
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground inline-flex items-center gap-2"><Wrench className="w-6 h-6 text-primary" /> Recon Approvals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{isManager ? "Approve or decline recon work, ask service questions." : "Submit recon work and track approvals."}</p>
        </div>
        <button onClick={() => setShowNew(true)} className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> New estimate</button>
      </div>

      <div className="mb-5"><NextStepBanner stage="recon" /></div>

      <div className="grid lg:grid-cols-[minmax(0,380px)_1fr] gap-5">
        {/* List */}
        <div className="space-y-5">
          {loading ? <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" /></div> : (
            <>
              {isManager && <Group title="Needs your approval" icon={<ShieldAlert className="w-4 h-4 text-amber-600" />} items={groups.needs} selId={selId} onSelect={setSelId} accent="amber" />}
              {!isManager && <Group title="Awaiting approval" icon={<Clock className="w-4 h-4 text-amber-600" />} items={groups.needs} selId={selId} onSelect={setSelId} accent="amber" />}
              <Group title="In recon" icon={<Wrench className="w-4 h-4 text-emerald-600" />} items={groups.inRecon} selId={selId} onSelect={setSelId} accent="emerald" />
              <Group title="Closed" icon={<XCircle className="w-4 h-4 text-slate-400" />} items={groups.closed} selId={selId} onSelect={setSelId} accent="slate" />
              {estimates.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">No recon estimates yet. Service submits the first one with “New estimate.”</p>}
            </>
          )}
        </div>

        {/* Detail */}
        <div>
          {!sel || !detail ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
              <Car className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm">Select a vehicle to view its recon items{isManager ? " and approve/decline work" : ""}.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <h2 className="text-lg font-bold text-foreground">{sel.ymm || "Vehicle"}</h2>
                      {sel.origin === "ingest" && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-700">From intake</span>}
                      {sel.sent_to_service_at && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Sent to service</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">VIN {sel.vin}{sel.submitted_by ? ` · submitted by ${sel.submitted_by}` : ""}</p>
                  </div>
                  <button onClick={() => printWorkOrder(sel, detail.lines)} className="h-9 px-3 rounded-lg border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted"><Printer className="w-3.5 h-3.5" /> Print work order</button>
                </div>
                {isManager && sel.origin === "ingest" && !sel.sent_to_service_at && (
                  <button disabled={busy === "send"} onClick={onOkAndSend} className="mt-4 w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">{busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} OK &amp; send to service</button>
                )}
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <Stat icon={<DollarSign className="w-4 h-4" />} label="Estimate" value={money(sel.subtotal)} />
                  <Stat icon={<CheckCircle2 className="w-4 h-4" />} label="Approved" value={money(sel.approved_total)} />
                  <Stat icon={<Clock className="w-4 h-4" />} label="Items" value={String(detail.lines.length)} />
                </div>
                {sel.notes && <p className="text-[12px] text-muted-foreground mt-3">“{sel.notes}”</p>}
              </div>

              {/* Lines */}
              <div className="space-y-3">
                {detail.lines.map((l) => {
                  const st = STATUS[l.approval_status] || STATUS.pending;
                  const photos = photoUrls(l.photos);
                  const canAct = isManager && l.approval_status === "pending";
                  return (
                    <div key={l.id} className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${SEV[l.severity] || SEV.recommended}`}>{l.severity}</span>
                            {l.category && <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-600">{l.category}</span>}
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                          </div>
                          <p className="text-[15px] font-semibold text-foreground">{l.description}</p>
                          <p className="text-[12px] text-muted-foreground mt-0.5">{l.labor_cost > 0 && `Labor ${money(l.labor_cost)}`}{l.parts_cost > 0 && ` · Parts ${money(l.parts_cost)}`}{l.sublet_cost > 0 && ` · Sublet ${money(l.sublet_cost)}`}{l.vendor ? ` · ${l.vendor}` : ""}</p>
                          {l.approval_status === "declined" && l.decline_reason && <p className="text-[12px] text-red-600 mt-1">Declined: {l.decline_reason}</p>}
                        </div>
                        <div className="text-[18px] font-extrabold text-foreground shrink-0">{money(l.line_total)}</div>
                      </div>
                      {photos.length > 0 && <div className="flex gap-2 mt-3 flex-wrap">{photos.slice(0, 6).map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="block h-16 w-16 rounded-lg border border-border overflow-hidden bg-muted"><img src={u} alt="" className="h-full w-full object-cover" /></a>)}</div>}
                      {canAct && (declineFor === l.id ? (
                        <div className="mt-3 space-y-2">
                          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for declining (required)" className="w-full h-10 rounded-lg border border-red-300 bg-background px-3 text-sm" />
                          <div className="flex gap-2">
                            <button disabled={!reason.trim() || busy === l.id} onClick={() => onDecide(l.id, "decline", reason.trim())} className="flex-1 h-10 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50">Confirm decline</button>
                            <button onClick={() => { setDeclineFor(null); setReason(""); }} className="h-10 px-4 rounded-lg border border-border text-sm font-semibold">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 mt-3">
                          <button disabled={busy === l.id} onClick={() => onDecide(l.id, "approve")} className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50">{busy === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Approve</button>
                          <button onClick={() => setDeclineFor(l.id)} className="flex-1 h-10 rounded-lg border border-red-300 text-red-700 text-sm font-semibold inline-flex items-center justify-center gap-1.5"><XCircle className="w-4 h-4" /> Decline</button>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {isManager && groups.needs.some((e) => e.id === sel.id) && !(sel.origin === "ingest" && !sel.sent_to_service_at) && (
                  <button disabled={busy === "all"} onClick={() => onDecide(null, "approve")} className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">{busy === "all" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Approve all remaining</button>
                )}
              </div>

              {/* Q&A thread */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <h3 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5 mb-3"><MessageSquare className="w-4 h-4 text-primary" /> Questions & notes</h3>
                <div className="space-y-3 mb-3 max-h-72 overflow-y-auto">
                  {detail.messages.length === 0 && <p className="text-xs text-muted-foreground">No messages yet. Ask service a question or leave a note.</p>}
                  {detail.messages.map((m) => (
                    <div key={m.id} className="text-sm">
                      <span className="font-semibold text-foreground">{m.author_name || "Someone"}</span>
                      {m.author_role && <span className="text-[11px] text-muted-foreground"> · {m.author_role}</span>}
                      <p className="text-foreground/90">{m.body}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onPost(); }} placeholder={isManager ? "Ask service about this recon…" : "Reply / add a note…"} className="flex-1 h-10 rounded-lg border border-border bg-background px-3 text-sm" />
                  <button disabled={!msg.trim()} onClick={onPost} className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"><Send className="w-4 h-4" /> Send</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showNew && <NewEstimateModal canned={canned} onClose={() => setShowNew(false)} onSubmit={async (input) => { const ok = await submit(input); if (ok) { setShowNew(false); toast.success("Recon estimate submitted"); } else toast.error("Couldn't submit — check the VIN belongs to your inventory."); return ok; }} />}
    </div>
  );
}

function Group({ title, icon, items, selId, onSelect, accent }: { title: string; icon: React.ReactNode; items: ReconEstimate[]; selId: string | null; onSelect: (id: string) => void; accent: string }) {
  if (items.length === 0) return null;
  const ring = accent === "amber" ? "border-amber-200" : accent === "emerald" ? "border-emerald-200" : "border-border";
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 inline-flex items-center gap-1.5">{icon} {title} <span className="text-muted-foreground/60">({items.length})</span></div>
      <div className="space-y-2">
        {items.map((e) => (
          <button key={e.id} onClick={() => onSelect(e.id)} className={`w-full text-left rounded-xl border bg-card p-3 hover:bg-muted/40 transition-colors ${selId === e.id ? "border-primary ring-1 ring-primary" : ring}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground text-sm truncate">{e.ymm || "Vehicle"}</span>
              <span className="text-sm font-bold text-foreground shrink-0">{money(e.subtotal)}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">VIN …{e.vin.slice(-6)}{e.approved_total > 0 ? ` · ${money(e.approved_total)} approved` : ""}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-xl bg-muted/50 p-3 text-center"><div className="text-muted-foreground inline-flex justify-center w-full mb-1">{icon}</div><div className="text-[15px] font-bold text-foreground">{value}</div><div className="text-[11px] text-muted-foreground">{label}</div></div>;
}

function NewEstimateModal({ canned, onClose, onSubmit }: { canned: ReconCannedService[]; onClose: () => void; onSubmit: (input: { vin: string; ymm?: string; notes?: string; lines: NewLine[] }) => Promise<boolean> }) {
  const [vin, setVin] = useState("");
  const [ymm, setYmm] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<NewLine[]>([{ description: "", category: "mechanical", severity: "recommended", labor_cost: 0, parts_cost: 0 }]);
  const [busy, setBusy] = useState(false);
  const valid = vin.trim().length >= 11 && lines.some((l) => l.description.trim());
  const set = (i: number, patch: Partial<NewLine>) => setLines((s) => s.map((l, x) => x === i ? { ...l, ...patch } : l));
  const addCanned = (c: ReconCannedService) => setLines((s) => {
    const next = [...s.filter((l) => l.description.trim()), { description: c.label, category: c.category, severity: c.severity, labor_cost: c.labor_cost, parts_cost: c.parts_cost }];
    return next.length ? next : s;
  });
  // Sort the preprinted choices most-used first (self-aware common services).
  const cannedSorted = [...canned].sort((a, b) => (b.uses || 0) - (a.uses || 0));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-foreground mb-3">New recon estimate</h2>
        {cannedSorted.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Quick add</p>
            <div className="flex flex-wrap gap-1.5">
              {cannedSorted.map((c, i) => (
                <button key={i} onClick={() => addCanned(c)} className="h-8 px-2.5 rounded-full border border-border text-xs font-medium hover:border-primary hover:bg-primary/5">
                  + {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="VIN" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" />
          <input value={ymm} onChange={(e) => setYmm(e.target.value)} placeholder="Year Make Model" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" />
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for the manager (optional)" className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm mb-3" />

        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex gap-2">
                <input value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Work needed (e.g. Front brake pads & rotors)" className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm" />
                {lines.length > 1 && <button onClick={() => setLines((s) => s.filter((_, x) => x !== i))} className="w-9 h-9 grid place-items-center rounded-lg border border-border text-muted-foreground"><Trash2 className="w-4 h-4" /></button>}
              </div>
              <div className="flex gap-2">
                <select value={l.category} onChange={(e) => set(i, { category: e.target.value })} className="h-9 rounded-lg border border-border bg-background px-2 text-sm flex-1">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={l.severity} onChange={(e) => set(i, { severity: e.target.value })} className="h-9 rounded-lg border border-border bg-background px-2 text-sm">
                  <option value="required">Required</option><option value="recommended">Recommended</option>
                </select>
              </div>
              <div className="flex gap-2">
                <input type="number" min={0} value={l.labor_cost || ""} onChange={(e) => set(i, { labor_cost: parseFloat(e.target.value) || 0 })} placeholder="Labor $" className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-1/3" />
                <input type="number" min={0} value={l.parts_cost || ""} onChange={(e) => set(i, { parts_cost: parseFloat(e.target.value) || 0 })} placeholder="Parts $" className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-1/3" />
                <input type="number" min={0} value={l.sublet_cost || ""} onChange={(e) => set(i, { sublet_cost: parseFloat(e.target.value) || 0 })} placeholder="Sublet $" className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-1/3" />
              </div>
            </div>
          ))}
          <button onClick={() => setLines((s) => [...s, { description: "", category: "mechanical", severity: "recommended", labor_cost: 0, parts_cost: 0 }])} className="h-9 px-3 rounded-lg border border-dashed border-border text-xs font-semibold inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add line</button>
        </div>

        <div className="flex gap-2 mt-4">
          <button disabled={!valid || busy} onClick={async () => { setBusy(true); await onSubmit({ vin: vin.trim(), ymm: ymm.trim() || undefined, notes: notes.trim() || undefined, lines: lines.filter((l) => l.description.trim()) }); setBusy(false); }} className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit to manager</button>
          <button onClick={onClose} className="h-11 px-5 rounded-xl border border-border font-semibold">Cancel</button>
        </div>
      </div>
    </div>
  );
}
