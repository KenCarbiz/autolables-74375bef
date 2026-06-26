import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import SignaturePad from "@/components/addendum/SignaturePad";
import K208Checklist, { k208Answered, k208Result, k208Checklist, type K208Mark } from "@/components/service/K208Checklist";
import { K208_CERTIFICATION_TEXT } from "@/data/ctK208Form";
import { buildConsentRecord, hashPayload, fetchClientIp } from "@/lib/esign";
import { CheckCircle2, Loader2, ShieldCheck, Sparkles, ChevronRight, Upload, X, AlertTriangle, ArrowLeft, Camera } from "lucide-react";

// /ready/:token — the per-vehicle Get-Ready hub. One permanent QR; anyone scans
// it (no login), picks their station, completes it, signs. Each station locks
// once a signed record exists. Stations: Service (CT K-208) and Detail (cleaning
// + pre-install protection w/ mandatory photos + optional third-party provider).

interface Ctx {
  ok: boolean; reason?: string; tenant_id?: string; vehicle_listing_id?: string;
  vin?: string; ymm?: string; service_done?: boolean; detail_done?: boolean;
  preinstall_products?: { id: string; name: string; pre_install: boolean }[];
}
type View = "hub" | "service" | "detail";
const DETAIL_TYPES = [
  { key: "full_detail", label: "Full detail" },
  { key: "exterior_wash", label: "Exterior wash" },
  { key: "interior_clean", label: "Interior clean / vacuum" },
  { key: "shampoo", label: "Carpet / upholstery shampoo" },
  { key: "engine_bay", label: "Engine bay" },
  { key: "clay_wax", label: "Clay, wax & polish" },
  { key: "headlight", label: "Headlight restoration" },
  { key: "odor", label: "Odor treatment" },
];

const uploadViaToken = async (token: string, file: File): Promise<string | null> => {
  try {
    const dataBase64: string = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file);
    });
    const { data, error } = await supabase.functions.invoke("signoff-upload", { body: { token, filename: file.name, contentType: file.type, dataBase64 } });
    return !error ? (data as { url?: string })?.url ?? null : null;
  } catch { return null; }
};

export default function GetReady() {
  const { token = "" } = useParams();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("hub");

  const refresh = useCallback(async () => {
    const { data } = await (supabase as any).rpc("get_vehicle_ready", { _token: token });
    setCtx((data as Ctx) || { ok: false, reason: "not_found" });
    setLoading(false);
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <div className="min-h-screen grid place-items-center bg-background"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  if (!ctx?.ok) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="text-lg font-bold text-foreground">This get-ready code isn't active.</h1>
          <p className="text-sm text-muted-foreground">Ask a manager for a current QR for this vehicle.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="sticky top-0 z-10 bg-primary text-primary-foreground px-4 py-3 shadow-sm flex items-center gap-2">
        {view !== "hub" && <button onClick={() => setView("hub")} className="-ml-1 mr-1"><ArrowLeft className="w-5 h-5" /></button>}
        <div>
          <div className="font-display font-bold leading-tight">{view === "service" ? "Safety Inspection · K-208" : view === "detail" ? "Detail & Install" : "Get the car ready"}</div>
          <div className="text-xs opacity-90">{ctx.ymm || "Vehicle"} · {ctx.vin}</div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4">
        {view === "hub" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Tap your station. Each one locks once it's signed.</p>
            <StationCard icon={<ShieldCheck className="w-5 h-5" />} title="Safety inspection (K-208)" sub="Service department" done={!!ctx.service_done} onClick={() => setView("service")} />
            <StationCard icon={<Sparkles className="w-5 h-5" />} title="Detail & protection install" sub="Detail / installer / outside vendor" done={!!ctx.detail_done} onClick={() => setView("detail")} />
          </div>
        )}
        {view === "service" && <ServiceStation token={token} ctx={ctx} onDone={() => { refresh(); setView("hub"); }} />}
        {view === "detail" && <DetailStation token={token} ctx={ctx} onDone={() => { refresh(); setView("hub"); }} />}
      </div>
    </div>
  );
}

function StationCard({ icon, title, sub, done, onClick }: { icon: React.ReactNode; title: string; sub: string; done: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${done ? "border-emerald-200 bg-emerald-50" : "border-border bg-card hover:bg-muted/40"}`}>
      <div className={`grid place-items-center w-10 h-10 rounded-xl ${done ? "bg-emerald-600 text-white" : "bg-muted text-foreground"}`}>{done ? <CheckCircle2 className="w-5 h-5" /> : icon}</div>
      <div className="flex-1">
        <div className="font-bold text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{done ? "Completed & signed" : sub}</div>
      </div>
      {!done && <ChevronRight className="w-5 h-5 text-muted-foreground" />}
    </button>
  );
}

// ── Service station (CT K-208) ─────────────────────────────────────────────
function ServiceStation({ token, ctx, onDone }: { token: string; ctx: Ctx; onDone: () => void }) {
  const [marks, setMarks] = useState<Record<string, K208Mark>>({});
  const [failureNotes, setFailureNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [docs, setDocs] = useState<{ url: string; caption?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [sig, setSig] = useState(""); const [sigType, setSigType] = useState<"draw" | "type">("draw");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (ctx.service_done) return <DoneCard label="Safety inspection already completed for this vehicle." />;
  const answered = k208Answered(marks); const result = k208Result(marks);
  const passAll = () => { const n: Record<string, K208Mark> = {}; import("@/components/service/K208Checklist").then(({ K208_ITEMS }) => { K208_ITEMS.forEach((i) => n[i.id] = marks[i.id] === "fail" || marks[i.id] === "na" ? marks[i.id] : "pass"); setMarks({ ...n }); }); };
  const onFiles = async (files: FileList | null) => { if (!files?.length) return; setUploading(true); for (const f of Array.from(files)) { const url = await uploadViaToken(token, f); if (url) setDocs((d) => [...d, { url, caption: f.name }]); } setUploading(false); };
  const canSubmit = !!name.trim() && !!sig.trim() && consent && answered > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return; setBusy(true);
    const checklist = k208Checklist(marks);
    const content_hash = await hashPayload({ vin: ctx.vin, checklist, result, name });
    const ip = await fetchClientIp();
    const { data, error } = await (supabase as any).rpc("submit_safety_inspection", {
      _token: token, _checklist: checklist, _result: result, _failure_notes: failureNotes || null, _notes: notes || null,
      _documents: docs, _inspector_name: name.trim(), _signature_data: sig, _content_hash: content_hash,
      _esign_consent: buildConsentRecord(), _ip: ip, _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    setBusy(false);
    if (!error && (data as { ok?: boolean })?.ok) onDone();
  };

  return (
    <div className="space-y-4">
      <K208Checklist marks={marks} onMark={(id, m) => setMarks((s) => ({ ...s, [id]: m }))} onPassAll={passAll} failureNotes={failureNotes} onFailureNotes={setFailureNotes} notes={notes} onNotes={setNotes} />
      <UploadRow label="Repair order / inspection sheet / photos" uploading={uploading} onFiles={onFiles} docs={docs} onRemove={(i) => setDocs((a) => a.filter((_, x) => x !== i))} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Inspector full name" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
      <SignaturePad label="Inspector signature" subtitle="Sign to certify this inspection." value={sig} type={sigType} onChange={(d, t) => { setSig(d); setSigType(t); }} />
      <ConsentRow text={K208_CERTIFICATION_TEXT} checked={consent} onChange={setConsent} />
      <SubmitBar label={`Submit K-208 (${result.toUpperCase()})`} disabled={!canSubmit} busy={busy} onClick={submit} />
    </div>
  );
}

// ── Detail station (cleaning + pre-install + third-party) ───────────────────
function DetailStation({ token, ctx, onDone }: { token: string; ctx: Ctx; onDone: () => void }) {
  const products = ctx.preinstall_products || [];
  const [types, setTypes] = useState<Record<string, boolean>>({});
  const [installs, setInstalls] = useState<Record<string, { on: boolean; photo?: string; uploading?: boolean }>>({});
  const [thirdParty, setThirdParty] = useState(false);
  const [company, setCompany] = useState(""); const [contact, setContact] = useState("");
  const [name, setName] = useState(""); const [sig, setSig] = useState(""); const [sigType, setSigType] = useState<"draw" | "type">("draw");
  const [notes, setNotes] = useState(""); const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false);

  if (ctx.detail_done) return <DoneCard label="Detail & install already completed for this vehicle." />;

  const installPhoto = async (id: string, file: File | null) => {
    if (!file) return;
    setInstalls((s) => ({ ...s, [id]: { ...(s[id] || { on: true }), on: true, uploading: true } }));
    const url = await uploadViaToken(token, file);
    setInstalls((s) => ({ ...s, [id]: { on: true, photo: url || undefined, uploading: false } }));
  };
  const selectedInstalls = products.filter((p) => installs[p.id]?.on);
  const missingPhoto = selectedInstalls.some((p) => p.pre_install && !installs[p.id]?.photo);
  const anySelected = Object.values(types).some(Boolean) || selectedInstalls.length > 0;
  const canSubmit = !!name.trim() && !!sig.trim() && consent && anySelected && !missingPhoto && (!thirdParty || !!company.trim()) && !busy;

  const submit = async () => {
    if (!canSubmit) return; setBusy(true);
    const detail_types = DETAIL_TYPES.filter((t) => types[t.key]).map((t) => ({ key: t.key, label: t.label }));
    const installPayload = selectedInstalls.map((p) => ({ product_id: p.id, label: p.name, pre_install: p.pre_install, photo_url: installs[p.id]?.photo || null }));
    const photos = installPayload.map((i) => i.photo_url).filter(Boolean);
    const content_hash = await hashPayload({ vin: ctx.vin, detail_types, installs: installPayload, name, thirdParty, company });
    const ip = await fetchClientIp();
    const { data, error } = await (supabase as any).rpc("submit_detail_signoff", {
      _token: token, _detail_types: detail_types, _installs: installPayload, _is_third_party: thirdParty,
      _provider_company: thirdParty ? company.trim() : null, _provider_contact: thirdParty ? contact.trim() : null,
      _performer_name: name.trim(), _signature_data: sig, _photos: photos, _notes: notes || null,
      _content_hash: content_hash, _esign_consent: buildConsentRecord(), _ip: ip,
      _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    setBusy(false);
    if (!error && (data as { ok?: boolean })?.ok) onDone();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-foreground">Detail performed</div>
        <div className="grid grid-cols-2 gap-2">
          {DETAIL_TYPES.map((t) => (
            <button key={t.key} onClick={() => setTypes((s) => ({ ...s, [t.key]: !s[t.key] }))}
              className={`h-10 rounded-lg border text-sm font-medium px-3 text-left ${types[t.key] ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-border bg-background text-foreground"}`}>
              {types[t.key] ? "✓ " : ""}{t.label}
            </button>
          ))}
        </div>
      </div>

      {products.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-foreground">Protection / pre-install</div>
          <p className="text-xs text-muted-foreground">Check what you installed. Pre-install items require a photo of the finished work.</p>
          {products.map((p) => {
            const st = installs[p.id];
            return (
              <div key={p.id} className="rounded-xl border border-border p-3 space-y-2">
                <button onClick={() => setInstalls((s) => ({ ...s, [p.id]: { ...(s[p.id] || {}), on: !s[p.id]?.on } }))}
                  className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className={`w-5 h-5 rounded grid place-items-center border ${st?.on ? "bg-emerald-600 border-emerald-600 text-white" : "border-border"}`}>{st?.on && <CheckCircle2 className="w-4 h-4" />}</span>
                  {p.name} {p.pre_install && <span className="text-[10px] uppercase tracking-wider text-amber-600 font-bold">photo req</span>}
                </button>
                {st?.on && p.pre_install && (
                  <div>
                    {st.photo ? (
                      <a href={st.photo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Photo attached</a>
                    ) : (
                      <>
                        <input type="file" accept="image/*" capture="environment" id={`ph-${p.id}`} className="hidden" onChange={(e) => installPhoto(p.id, e.target.files?.[0] ?? null)} />
                        <label htmlFor={`ph-${p.id}`} className="h-8 px-3 rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                          {st.uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} Take / add photo
                        </label>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input type="checkbox" checked={thirdParty} onChange={(e) => setThirdParty(e.target.checked)} />
          I'm an outside (third-party) provider
        </label>
        {thirdParty && (
          <div className="grid gap-2">
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" />
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Contact number / email" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" className="w-full rounded-lg border border-border bg-background p-3 text-sm" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={thirdParty ? "Your name" : "Your full name"} className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
        <SignaturePad label="Signature" subtitle="Sign to confirm the work above was completed." value={sig} type={sigType} onChange={(d, t) => { setSig(d); setSigType(t); }} />
        <ConsentRow text="I confirm the work recorded above was performed on this vehicle and the information is accurate." checked={consent} onChange={setConsent} />
      </div>

      {missingPhoto && <p className="text-center text-xs text-amber-600 font-semibold">Add a photo for each pre-install item before submitting.</p>}
      <SubmitBar label="Submit & sign" disabled={!canSubmit} busy={busy} onClick={submit} />
    </div>
  );
}

// ── small shared bits ──────────────────────────────────────────────────────
function DoneCard({ label }: { label: string }) {
  return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 flex items-center gap-3"><CheckCircle2 className="w-6 h-6 text-emerald-600" /><span className="text-sm font-semibold text-emerald-900">{label}</span></div>;
}
function UploadRow({ label, uploading, onFiles, docs, onRemove }: { label: string; uploading: boolean; onFiles: (f: FileList | null) => void; docs: { url: string; caption?: string }[]; onRemove: (i: number) => void }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
      <div className="text-xs font-bold uppercase tracking-wider text-foreground">{label}</div>
      <input type="file" accept="image/*,application/pdf" multiple capture="environment" id="up-row" className="hidden" onChange={(e) => onFiles(e.target.files)} />
      <label htmlFor="up-row" className="h-9 px-3 rounded-md border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted cursor-pointer w-fit">{uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Add file / photo</label>
      {docs.length > 0 && <div className="flex flex-wrap gap-2 pt-1">{docs.map((d, i) => (<div key={i} className="relative"><a href={d.url} target="_blank" rel="noreferrer" className="block h-16 w-16 rounded-lg border border-border bg-muted overflow-hidden">{/\.(png|jpe?g|webp|gif)$/i.test(d.url) ? <img src={d.url} className="h-full w-full object-cover" /> : <div className="h-full w-full grid place-items-center text-[10px] text-muted-foreground">PDF</div>}</a><button onClick={() => onRemove(i)} className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground text-background grid place-items-center"><X className="w-3 h-3" /></button></div>))}</div>}
    </div>
  );
}
function ConsentRow({ text, checked, onChange }: { text: string; checked: boolean; onChange: (b: boolean) => void }) {
  return <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" /><span>{text}</span></label>;
}
function SubmitBar({ label, disabled, busy, onClick }: { label: string; disabled: boolean; busy: boolean; onClick: () => void }) {
  return <button onClick={onClick} disabled={disabled} className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2">{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} {label}</button>;
}
