import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useReconEstimates, type ReconEstimate, type ReconLine, type ReconMessage, type NewLine } from "@/hooks/useReconEstimates";
import { useDealerSettings, type ReconCannedService } from "@/contexts/DealerSettingsContext";
import NextStepBanner from "@/components/workflow/NextStepBanner";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Plus, Trash2, Printer, Send, Loader2 } from "lucide-react";
import { Button, InlineNote, KeyValueList, LocalTabs, MetricStrip, PageBody, PageHeader, Panel, QueryState, SkeletonBlock, StatusText, Td, Th, WorkTable, type LocalTab, type Tone } from "@/components/product";

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const photoUrls = (p: unknown[]): string[] => (Array.isArray(p) ? p : []).map((x) => typeof x === "string" ? x : (x as { url?: string })?.url || "").filter(Boolean);

type ReconView = "pending" | "in-recon" | "closed" | "all";
const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  auto_approved: { label: "Auto-approved", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  deferred: { label: "Deferred", tone: "neutral" },
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
  // The view and the open estimate live in the URL: reload, back and links
  // from Today land on the exact estimate.
  const [searchParams, setSearchParams] = useSearchParams();
  const selId = searchParams.get("estimate");
  const viewParam = searchParams.get("view");
  const view: ReconView = viewParam === "in-recon" || viewParam === "closed" || viewParam === "all" ? viewParam : "pending";
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

  const tabDefs: Array<{ id: ReconView; label: string; items: ReconEstimate[] }> = [
    { id: "pending", label: isManager ? "Pending review" : "Awaiting approval", items: groups.needs },
    { id: "in-recon", label: "In recon", items: groups.inRecon },
    { id: "closed", label: "Closed", items: groups.closed },
    { id: "all", label: "All estimates", items: estimates },
  ];
  const tabs: LocalTab[] = tabDefs.map((t) => ({
    key: t.id,
    label: t.label,
    to: `/recon?view=${t.id}`,
    count: loading ? null : t.items.length,
    active: t.id === view,
  }));
  const shown = tabDefs.find((t) => t.id === view)!;
  const openEstimate = (id: string) => {
    const q = new URLSearchParams(searchParams);
    q.set("estimate", id);
    setSearchParams(q);
  };
  const closeEstimate = () => {
    const q = new URLSearchParams(searchParams);
    q.delete("estimate");
    setSearchParams(q);
  };
  const status = loading ? "loading" : shown.items.length === 0 ? "empty" : "ready";

  return (
    <PageBody width="wide">
      <PageHeader
        title="Recon Approvals"
        description={isManager ? "Approve or decline recon work and ask service questions." : "Submit recon work and track approvals."}
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="h-4 w-4" aria-hidden="true" /> New estimate</Button>}
      />

      <NextStepBanner stage="recon" />

      <MetricStrip
        label="Recon estimate totals"
        metrics={[
          { label: isManager ? "Pending review" : "Awaiting approval", value: loading ? null : groups.needs.length, loading, hint: loading ? undefined : `of ${estimates.length} estimates`, tone: "warning" },
          { label: "Pending amount", value: loading ? null : money(groups.needs.reduce((s, e) => s + (e.subtotal || 0), 0)), loading, hint: "estimated, not yet authorized", tone: "neutral" },
          { label: "In recon", value: loading ? null : groups.inRecon.length, loading, hint: "approved or partly approved", tone: "info" },
          { label: "Approved amount", value: loading ? null : money(groups.inRecon.reduce((s, e) => s + (e.approved_total || 0), 0)), loading, hint: "on estimates in recon", tone: "success" },
        ]}
      />

      <LocalTabs label="Recon estimate states" tabs={tabs} />

      <Panel flush title={loading ? shown.label : `${shown.items.length.toLocaleString()} ${shown.items.length === 1 ? "estimate" : "estimates"} · ${shown.label}`}>
        <QueryState
          status={status}
          emptyTitle={estimates.length === 0 ? "No recon estimates yet." : `No estimates are ${shown.label.toLowerCase()}.`}
          emptyDetail={estimates.length === 0 ? "Service submits the first one with New estimate." : `This is the ${shown.label} view only; ${estimates.length} ${estimates.length === 1 ? "estimate exists" : "estimates exist"} in total.`}
        >
          <WorkTable caption="Recon estimates" minWidth={820}>
            <thead>
              <tr>
                <Th>Vehicle</Th>
                <Th>State</Th>
                <Th align="right">Estimate</Th>
                <Th align="right">Approved</Th>
                <Th>Owner</Th>
                <Th>Age</Th>
                <Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {shown.items.map((e) => (
                <tr key={e.id} className={selId === e.id ? "bg-adm-selected" : undefined}>
                  <Td>
                    <p className="font-semibold text-adm-ink">{e.ymm || "Vehicle"}</p>
                    <p className="font-mono text-[12px] text-adm-muted">VIN …{e.vin.slice(-6)}</p>
                  </Td>
                  <Td><EstimateState status={e.status} /></Td>
                  <Td align="right">{money(e.subtotal)}</Td>
                  <Td align="right">{e.approved_total > 0 ? money(e.approved_total) : "—"}</Td>
                  <Td>{e.submitted_by || <span className="text-adm-muted">Unassigned</span>}</Td>
                  <Td className="whitespace-nowrap text-adm-muted">{ageOf(e.created_at)}</Td>
                  <Td align="right"><Button size="sm" onClick={() => openEstimate(e.id)} aria-label={`Review estimate for ${e.ymm || e.vin}`}>Review</Button></Td>
                </tr>
              ))}
            </tbody>
          </WorkTable>
        </QueryState>
      </Panel>

      {selId && !sel && !loading && (
        <InlineNote tone="warning" title="That estimate is not in your list." action={<Button size="sm" onClick={closeEstimate}>Dismiss</Button>}>
          It may have been removed or belongs to another rooftop.
        </InlineNote>
      )}

      {sel && !detail && <div role="status" aria-label="Loading" className="flex flex-col gap-2"><SkeletonBlock className="h-24 w-full" /><SkeletonBlock className="h-24 w-full" /></div>}

      {sel && detail && (
        <section aria-label="Recon estimate" className="flex flex-col gap-4">
          <Panel
            title={sel.ymm || "Vehicle"}
            description={`VIN ${sel.vin}${sel.submitted_by ? ` · submitted by ${sel.submitted_by}` : ""}`}
            action={
              <>
                {sel.origin === "ingest" && <StatusText tone="info">From intake</StatusText>}
                {sel.sent_to_service_at && <StatusText tone="success" icon>Sent to service</StatusText>}
                <Button size="sm" onClick={() => printWorkOrder(sel, detail.lines)}><Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print work order</Button>
                <Button size="sm" variant="ghost" onClick={closeEstimate}>Close</Button>
              </>
            }
          >
            {isManager && sel.origin === "ingest" && !sel.sent_to_service_at && (
              <Button variant="primary" className="mb-4 w-full" disabled={busy === "send"} onClick={onOkAndSend}>{busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />} OK &amp; send to service</Button>
            )}
            <KeyValueList
              rows={[
                { label: "Estimate", value: <span className="tabular-nums">{money(sel.subtotal)}</span> },
                { label: "Approved", value: <span className="tabular-nums">{money(sel.approved_total)}</span> },
                { label: "Items", value: String(detail.lines.length) },
              ]}
            />
            {sel.notes && <p className="mt-3 text-[13px] text-adm-muted">“{sel.notes}”</p>}
          </Panel>

          <WorkTable caption="Itemized labor, parts and sublet" minWidth={760}>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Severity</Th>
                <Th>Status</Th>
                <Th align="right">Cost</Th>
                <Th align="right">Decision</Th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => {
                const st = STATUS[l.approval_status] || STATUS.pending;
                const photos = photoUrls(l.photos);
                const canAct = isManager && l.approval_status === "pending";
                return (
                  <tr key={l.id}>
                    <Td className="min-w-[240px]">
                      <p className="font-semibold text-adm-ink">{l.description}</p>
                      <p className="text-[12px] text-adm-muted">{[l.category, l.labor_cost > 0 && `Labor ${money(l.labor_cost)}`, l.parts_cost > 0 && `Parts ${money(l.parts_cost)}`, l.sublet_cost > 0 && `Sublet ${money(l.sublet_cost)}`, l.vendor].filter(Boolean).join(" · ")}</p>
                      {l.approval_status === "declined" && l.decline_reason && <p className="mt-1 text-[12px] text-adm-danger">Declined: {l.decline_reason}</p>}
                      {photos.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{photos.slice(0, 6).map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="block h-14 w-14 overflow-hidden rounded-md border border-adm-border bg-adm-workspace"><img src={u} alt="" className="h-full w-full object-cover" /></a>)}</div>}
                    </Td>
                    <Td><StatusText tone={l.severity === "required" ? "danger" : l.severity === "ok" ? "success" : l.severity === "na" ? "neutral" : "warning"}>{l.severity}</StatusText></Td>
                    <Td><StatusText tone={st.tone} icon>{st.label}</StatusText></Td>
                    <Td align="right" className="font-semibold">{money(l.line_total)}</Td>
                    <Td align="right">
                      {canAct && (declineFor === l.id ? (
                        <div className="flex min-w-[220px] flex-col gap-2">
                          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for declining (required)" aria-label="Reason for declining" className="h-9 w-full rounded-md border border-adm-border bg-adm-surface px-3 text-[14px]" />
                          <div className="flex gap-2">
                            <Button size="sm" variant="danger" className="flex-1" disabled={!reason.trim() || busy === l.id} onClick={() => onDecide(l.id, "decline", reason.trim())}>Confirm decline</Button>
                            <Button size="sm" onClick={() => { setDeclineFor(null); setReason(""); }}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="primary" disabled={busy === l.id} onClick={() => onDecide(l.id, "approve")}>{busy === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />} Approve</Button>
                          <Button size="sm" variant="danger" onClick={() => setDeclineFor(l.id)}><XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Decline</Button>
                        </div>
                      ))}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </WorkTable>
          {isManager && groups.needs.some((e) => e.id === sel.id) && !(sel.origin === "ingest" && !sel.sent_to_service_at) && (
            <Button variant="primary" className="w-full" disabled={busy === "all"} onClick={() => onDecide(null, "approve")}>{busy === "all" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />} Approve all remaining</Button>
          )}

          <Panel title="Questions & notes">
            <div className="mb-3 flex max-h-72 flex-col gap-3 overflow-y-auto">
              {detail.messages.length === 0 && <p className="text-[13px] text-adm-muted">No messages yet. Ask service a question or leave a note.</p>}
              {detail.messages.map((m) => (
                <div key={m.id} className="text-[14px]">
                  <span className="font-semibold text-adm-ink">{m.author_name || "Someone"}</span>
                  {m.author_role && <span className="text-[12px] text-adm-muted"> · {m.author_role}</span>}
                  <p className="text-adm-ink">{m.body}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onPost(); }} placeholder={isManager ? "Ask service about this recon…" : "Reply / add a note…"} aria-label="Message" className="h-10 flex-1 rounded-md border border-adm-border bg-adm-surface px-3 text-[14px]" />
              <Button variant="primary" disabled={!msg.trim()} onClick={onPost}><Send className="h-4 w-4" aria-hidden="true" /> Send</Button>
            </div>
          </Panel>
        </section>
      )}

      {showNew && <NewEstimateModal canned={canned} onClose={() => setShowNew(false)} onSubmit={async (input) => { const ok = await submit(input); if (ok) { setShowNew(false); toast.success("Recon estimate submitted"); } else toast.error("Couldn't submit — check the VIN belongs to your inventory."); return ok; }} />}
    </PageBody>
  );
}

const ageOf = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `${h}h` : "<1h";
};

const ESTIMATE_STATE: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Pending review", tone: "warning" },
  approved: { label: "Authorized", tone: "success" },
  partially_approved: { label: "Partly authorized", tone: "info" },
  declined: { label: "Declined", tone: "danger" },
  completed: { label: "Completed", tone: "neutral" },
  voided: { label: "Voided", tone: "neutral" },
};
function EstimateState({ status }: { status: string }) {
  const s = ESTIMATE_STATE[status] || { label: status, tone: "neutral" as Tone };
  return <StatusText tone={s.tone} icon>{s.label}</StatusText>;
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
      <div className="bg-adm-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-adm-ink mb-3">New recon estimate</h2>
        {cannedSorted.length > 0 && (
          <div className="mb-3">
            <p className="text-[12px] leading-[18px] font-semibold uppercase tracking-wider text-adm-muted mb-1.5">Quick add</p>
            <div className="flex flex-wrap gap-1.5">
              {cannedSorted.map((c, i) => (
                <button key={i} onClick={() => addCanned(c)} className="h-8 px-2.5 rounded-md border border-adm-border text-xs font-medium hover:border-primary hover:bg-primary/5">
                  + {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="VIN" className="h-10 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm" />
          <input value={ymm} onChange={(e) => setYmm(e.target.value)} placeholder="Year Make Model" className="h-10 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm" />
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for the manager (optional)" className="w-full h-10 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm mb-3" />

        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="rounded-xl border border-adm-border p-3 space-y-2">
              <div className="flex gap-2">
                <input value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Work needed (e.g. Front brake pads & rotors)" className="flex-1 h-9 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm" />
                {lines.length > 1 && <button onClick={() => setLines((s) => s.filter((_, x) => x !== i))} className="w-9 h-9 grid place-items-center rounded-lg border border-adm-border text-adm-muted"><Trash2 className="w-4 h-4" /></button>}
              </div>
              <div className="flex gap-2">
                <select value={l.category} onChange={(e) => set(i, { category: e.target.value })} className="h-9 rounded-lg border border-adm-border bg-adm-surface px-2 text-sm flex-1">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={l.severity} onChange={(e) => set(i, { severity: e.target.value })} className="h-9 rounded-lg border border-adm-border bg-adm-surface px-2 text-sm">
                  <option value="required">Required</option><option value="recommended">Recommended</option>
                </select>
              </div>
              <div className="flex gap-2">
                <input type="number" min={0} value={l.labor_cost || ""} onChange={(e) => set(i, { labor_cost: parseFloat(e.target.value) || 0 })} placeholder="Labor $" className="h-9 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm w-1/3" />
                <input type="number" min={0} value={l.parts_cost || ""} onChange={(e) => set(i, { parts_cost: parseFloat(e.target.value) || 0 })} placeholder="Parts $" className="h-9 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm w-1/3" />
                <input type="number" min={0} value={l.sublet_cost || ""} onChange={(e) => set(i, { sublet_cost: parseFloat(e.target.value) || 0 })} placeholder="Sublet $" className="h-9 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm w-1/3" />
              </div>
            </div>
          ))}
          <button onClick={() => setLines((s) => [...s, { description: "", category: "mechanical", severity: "recommended", labor_cost: 0, parts_cost: 0 }])} className="h-9 px-3 rounded-lg border border-dashed border-adm-border text-xs font-semibold inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add line</button>
        </div>

        <div className="flex gap-2 mt-4">
          <button disabled={!valid || busy} onClick={async () => { setBusy(true); await onSubmit({ vin: vin.trim(), ymm: ymm.trim() || undefined, notes: notes.trim() || undefined, lines: lines.filter((l) => l.description.trim()) }); setBusy(false); }} className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit to manager</button>
          <button onClick={onClose} className="h-11 px-5 rounded-xl border border-adm-border font-semibold">Cancel</button>
        </div>
      </div>
    </div>
  );
}
