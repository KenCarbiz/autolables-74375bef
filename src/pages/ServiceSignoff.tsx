import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import SignaturePad from "@/components/addendum/SignaturePad";
import { K208_INSPECTION_CATEGORIES, K208_CERTIFICATION_TEXT } from "@/data/ctK208Form";
import { buildConsentRecord, hashPayload, fetchClientIp } from "@/lib/esign";
import { CheckCircle2, Loader2, ShieldCheck, Upload, X, AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { OUTCOME_LABELS, type RecallOutcome } from "@/hooks/useRecallTask";

// ──────────────────────────────────────────────────────────────
// /inspect/:token — no-login Service department safety-inspection (CT K-208)
// sign-off. The tech scans the per-vehicle QR, fills the checklist, optionally
// uploads the inspection sheet / defect photos, types their name + signs, and
// submits once. The token is single-use: it's consumed on submit and the QR
// goes dead (re-issuable by a manager). Mirrors the customer-signing token flow.
// ──────────────────────────────────────────────────────────────

type Mark = "pass" | "fail" | "na" | "";
interface TokenCtx { ok: boolean; reason?: string; tenant_id?: string; vehicle_listing_id?: string; vin?: string; ymm?: string; stock_number?: string; department?: string; }
interface DocRef { url: string; caption?: string; category?: string; }

export default function ServiceSignoff() {
  const { token = "" } = useParams();
  const [ctx, setCtx] = useState<TokenCtx | null>(null);
  const [loading, setLoading] = useState(true);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [failureNotes, setFailureNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [docs, setDocs] = useState<DocRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [inspectorName, setInspectorName] = useState("");
  const [signature, setSignature] = useState("");
  const [signatureType, setSignatureType] = useState<"draw" | "type">("type");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).rpc("get_dept_signoff_token", { _token: token });
      setCtx((data as TokenCtx) || { ok: false, reason: "not_found" });
      setLoading(false);
    })();
  }, [token]);

  const allItems = useMemo(() => K208_INSPECTION_CATEGORIES.flatMap((c) => c.items.map((i) => ({ ...i, category: c.category }))), []);
  const anyFail = Object.values(marks).some((m) => m === "fail");
  const answered = allItems.filter((i) => marks[i.id] && marks[i.id] !== "").length;
  const result: "pass" | "fail" = anyFail ? "fail" : "pass";

  const passAll = () => {
    const next: Record<string, Mark> = {};
    allItems.forEach((i) => { next[i.id] = marks[i.id] === "fail" || marks[i.id] === "na" ? marks[i.id] : "pass"; });
    setMarks(next);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const dataBase64: string = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        const { data, error } = await supabase.functions.invoke("signoff-upload", {
          body: { token, filename: file.name, contentType: file.type, dataBase64 },
        });
        const url = (data as { url?: string })?.url;
        if (!error && url) setDocs((d) => [...d, { url, caption: file.name, category: "inspection" }]);
      } catch { /* skip this file */ }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const canSubmit = !!inspectorName.trim() && !!signature.trim() && consent && answered > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit || !ctx) return;
    setSubmitting(true);
    const checklist = allItems.map((i) => ({ id: i.id, label: i.label, category: i.category, result: marks[i.id] || "na" }));
    const payload = { vin: ctx.vin, ymm: ctx.ymm, checklist, result, failureNotes, notes, docs, inspectorName, signedAt: new Date().toISOString() };
    const content_hash = await hashPayload(payload);
    const ip = await fetchClientIp();
    const { data, error } = await (supabase as any).rpc("submit_safety_inspection", {
      _token: token,
      _checklist: checklist,
      _result: result,
      _failure_notes: failureNotes || null,
      _notes: notes || null,
      _documents: docs,
      _inspector_name: inspectorName.trim(),
      _signature_data: signature,
      _content_hash: content_hash,
      _esign_consent: buildConsentRecord(),
      _ip: ip,
      _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    setSubmitting(false);
    if (!error && (data as { ok?: boolean })?.ok) setDone(true);
    else {
      const reason = (data as { reason?: string })?.reason;
      // Token consumed between load and submit, or another failure.
      setCtx({ ok: false, reason: reason || "error" });
    }
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center bg-background"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (done) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="max-w-md w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h1 className="text-xl font-bold text-emerald-900">Inspection submitted</h1>
          <p className="text-sm text-emerald-800">Thank you, {inspectorName.trim()}. The safety inspection for {ctx?.ymm || ctx?.vin} is recorded and signed. This link is now closed.</p>
        </div>
      </div>
    );
  }

  if (!ctx?.ok) {
    const msg = ctx?.reason === "expired" ? "This inspection link has expired."
      : ctx?.reason === "used_or_revoked" ? "This inspection has already been completed."
      : ctx?.reason === "wrong_department" ? "This link isn't for a safety inspection."
      : "This inspection link is invalid.";
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="text-lg font-bold text-foreground">{msg}</h1>
          <p className="text-sm text-muted-foreground">Ask a manager to issue a new QR code for this vehicle.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 z-10 bg-primary text-primary-foreground px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          <div>
            <div className="font-display font-bold leading-tight">Safety Inspection · CT K-208</div>
            <div className="text-xs opacity-90">{ctx.ymm || "Vehicle"} · {ctx.vin}</div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-5">
        <RecallOutcomeCard token={token} />

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{answered} of {allItems.length} items marked</p>
          <button onClick={passAll} className="h-9 px-3 rounded-md bg-emerald-600 text-white text-xs font-semibold">Pass all</button>
        </div>

        {K208_INSPECTION_CATEGORIES.map((cat) => (
          <div key={cat.category} className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/50 text-xs font-bold uppercase tracking-wider text-foreground">{cat.category}</div>
            <div className="divide-y divide-border/60">
              {cat.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-sm text-foreground flex-1">{item.label}</span>
                  <div className="flex gap-1 shrink-0">
                    {(["pass", "fail", "na"] as const).map((m) => (
                      <button key={m} onClick={() => setMarks((s) => ({ ...s, [item.id]: m }))}
                        className={`h-8 w-12 rounded-md text-[11px] font-semibold border transition-colors ${
                          marks[item.id] === m
                            ? m === "pass" ? "bg-emerald-600 text-white border-emerald-600"
                              : m === "fail" ? "bg-red-600 text-white border-red-600"
                              : "bg-slate-500 text-white border-slate-500"
                            : "bg-background text-muted-foreground border-border hover:bg-muted"
                        }`}>
                        {m === "pass" ? "Pass" : m === "fail" ? "Fail" : "N/A"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {anyFail && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
            <label className="text-xs font-bold text-red-800 uppercase tracking-wider">What failed & what was done</label>
            <textarea value={failureNotes} onChange={(e) => setFailureNotes(e.target.value)} rows={3}
              className="w-full rounded-lg border border-red-200 bg-white p-3 text-sm" placeholder="Describe failures and corrective action taken before sale…" />
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <label className="text-xs font-bold text-foreground uppercase tracking-wider">Documents & photos (optional)</label>
          <p className="text-xs text-muted-foreground">Attach the signed inspection sheet or any defect photos.</p>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple capture="environment" onChange={(e) => onFiles(e.target.files)} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="h-10 px-4 rounded-md border border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Add file / photo
          </button>
          {docs.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {docs.map((d, i) => (
                <div key={i} className="relative">
                  <a href={d.url} target="_blank" rel="noreferrer" className="block h-16 w-16 rounded-lg border border-border bg-muted overflow-hidden">
                    {/\.(png|jpe?g|webp|gif)$/i.test(d.url) ? <img src={d.url} alt={d.caption} className="h-full w-full object-cover" /> : <div className="h-full w-full grid place-items-center text-[10px] text-muted-foreground">PDF</div>}
                  </a>
                  <button onClick={() => setDocs((arr) => arr.filter((_, idx) => idx !== i))} className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground text-background grid place-items-center"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <label className="text-xs font-bold text-foreground uppercase tracking-wider">Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-border bg-background p-3 text-sm" placeholder="Anything else to record…" />
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <label className="text-xs font-bold text-foreground uppercase tracking-wider">Inspector</label>
          <input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} placeholder="Your full name"
            className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
          <SignaturePad label="Inspector signature" subtitle="Sign to certify this inspection." value={signature} type={signatureType}
            onChange={(d, t) => { setSignature(d); setSignatureType(t); }} />
          <label className="flex items-start gap-2 text-xs text-muted-foreground pt-1">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>{K208_CERTIFICATION_TEXT}</span>
          </label>
        </div>

        <div className={`text-center text-sm font-semibold ${result === "fail" ? "text-red-600" : "text-emerald-600"}`}>
          Overall result: {result === "fail" ? "FAIL — corrections required" : "PASS"}
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-card border-t border-border p-4">
        <div className="max-w-2xl mx-auto">
          <button onClick={submit} disabled={!canSubmit}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Submit & sign inspection
          </button>
          {!canSubmit && !submitting && (
            <p className="text-center text-[11px] text-muted-foreground mt-1.5">
              {answered === 0 ? "Mark the checklist, " : ""}{!inspectorName.trim() ? "enter your name, " : ""}{!signature.trim() ? "sign, " : ""}{!consent ? "and accept the certification" : ""} to submit.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Open Recall outcome (no-login, token-gated) ───────────────────────────
// Shows above the K-208 form when the scanned vehicle has an open recall. The
// service department records one of three outcomes with name/RO/notes and an
// optional photo or document. Resolving clears the publish blocker.
const RECALL_OUTCOMES: RecallOutcome[] = ["recall_completed", "no_fix_available", "does_not_apply"];

function RecallOutcomeCard({ token }: { token: string }) {
  const [task, setTask] = useState<{ task_id: string; vin?: string; open_recall_count?: number } | null>(null);
  const [picked, setPicked] = useState<RecallOutcome | null>(null);
  const [employee, setEmployee] = useState("");
  const [ro, setRo] = useState("");
  const [notes, setNotes] = useState("");
  const [docs, setDocs] = useState<{ url: string; caption?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<RecallOutcome | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      // deno-lint-ignore no-explicit-any
      const { data } = await (supabase as any).rpc("get_recall_task_for_token", { _token: token });
      const d = data as { ok?: boolean; has_open_recall?: boolean; task_id?: string; vin?: string; open_recall_count?: number };
      if (d?.ok && d.has_open_recall && d.task_id) setTask({ task_id: d.task_id, vin: d.vin, open_recall_count: d.open_recall_count });
    })();
  }, [token]);

  if (!task) return null;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const dataBase64: string = await new Promise((resolve, reject) => {
          const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file);
        });
        const { data, error } = await supabase.functions.invoke("signoff-upload", {
          body: { token, filename: file.name, contentType: file.type, dataBase64 },
        });
        const url = (data as { url?: string })?.url;
        if (!error && url) setDocs((p) => [...p, { url, caption: file.name }]);
      } catch { /* skip */ }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    if (!picked) return;
    if (!employee.trim()) { toast.error("Service employee name is required"); return; }
    setSubmitting(true);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase as any).rpc("submit_recall_outcome_public", {
      _token: token, _outcome: picked, _employee_name: employee.trim(),
      _ro_number: ro.trim() || null, _notes: notes.trim() || null,
      _documents: docs, _ip: null, _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    setSubmitting(false);
    if (!error && (data as { ok?: boolean })?.ok) { setDone(picked); toast.success("Recall outcome recorded"); }
    else toast.error((data as { reason?: string })?.reason || "Could not record outcome");
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 text-emerald-800"><CheckCircle2 className="w-5 h-5" /><span className="font-bold text-sm">Recall outcome recorded</span></div>
        <p className="text-xs text-emerald-700 mt-1">{OUTCOME_LABELS[done]} · {employee.trim()}{ro.trim() ? ` · RO ${ro.trim()}` : ""}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 overflow-hidden">
      <div className="px-4 py-3 bg-red-100/70 flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-red-600" />
        <div>
          <div className="font-bold text-sm text-red-800">Open Recall Found</div>
          <div className="text-xs text-red-700">{task.open_recall_count || 1} active manufacturer recall{(task.open_recall_count || 1) === 1 ? "" : "s"} requires service review.</div>
        </div>
      </div>
      <div className="p-4 space-y-2.5">
        <p className="text-xs font-semibold text-foreground">Select the service outcome:</p>
        <div className="grid gap-2">
          {RECALL_OUTCOMES.map((o) => (
            <button key={o} onClick={() => setPicked(o)}
              className={`text-left text-sm font-semibold px-3 py-2.5 rounded-xl border transition-colors ${picked === o ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border bg-card text-foreground hover:bg-muted"}`}>
              {OUTCOME_LABELS[o]}
            </button>
          ))}
        </div>
        {picked && (
          <div className="space-y-2 pt-1">
            <input value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="Service employee name *" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm" />
            <input value={ro} onChange={(e) => setRo(e.target.value)} placeholder="RO number (if applicable)" className="w-full px-3 py-2.5 border border-border rounded-xl text-sm" />
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" rows={2} className="w-full px-3 py-2.5 border border-border rounded-xl text-sm resize-none" />
            <div>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full h-10 rounded-xl border border-dashed border-border text-sm font-semibold inline-flex items-center justify-center gap-2 text-muted-foreground hover:bg-muted disabled:opacity-50">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{docs.length ? `${docs.length} file${docs.length === 1 ? "" : "s"} attached` : "Attach photo or document (optional)"}
              </button>
              {docs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {docs.map((d, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-muted px-2 py-1 rounded-md">{d.caption || "file"}
                      <button onClick={() => setDocs((p) => p.filter((_, j) => j !== i))}><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={submit} disabled={submitting} className="w-full h-11 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-50">
              {submitting ? "Recording…" : `Record: ${OUTCOME_LABELS[picked]}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
