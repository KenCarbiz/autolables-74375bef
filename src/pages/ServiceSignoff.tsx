import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import SignaturePad from "@/components/addendum/SignaturePad";
import { K208_INSPECTION_CATEGORIES, K208_CERTIFICATION_TEXT } from "@/data/ctK208Form";
import { buildConsentRecord, hashPayload, fetchClientIp } from "@/lib/esign";
import { CheckCircle2, Loader2, ShieldCheck, Upload, X, AlertTriangle } from "lucide-react";

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
