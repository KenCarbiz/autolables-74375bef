import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import SignaturePad from "@/components/addendum/SignaturePad";
import K208Checklist, { K208_ITEMS, k208Answered, k208Result, k208Checklist, type K208Mark } from "@/components/service/K208Checklist";
import { K208_CERTIFICATION_TEXT } from "@/data/ctK208Form";
import { PDI_ITEMS, PDI_CERTIFICATION_TEXT } from "@/data/pdiForm";
import { buildConsentRecord, hashPayload, fetchClientIp } from "@/lib/esign";
import { CheckCircle2, Loader2, ShieldCheck, Sparkles, ChevronRight, Upload, X, AlertTriangle, ArrowLeft, Camera, Wrench, ClipboardCheck } from "lucide-react";

// Remember the signer's name per device + station so a tech/detailer signing
// 20 cars a day doesn't retype it every time.
const rememberedName = (key: string) => { try { return localStorage.getItem(`autolabels.signer.${key}`) || ""; } catch { return ""; } };
const saveName = (key: string, v: string) => { try { if (v.trim()) localStorage.setItem(`autolabels.signer.${key}`, v.trim()); } catch { /* ignore */ } };

// Preloaded completion notes — tap to drop in instead of thumb-typing.
const COMPLETION_NOTES = [
  "Completed per checklist",
  "No issues found",
  "Road tested OK",
  "Customer-requested items done",
  "Recommend follow-up at next service",
];
function NoteChips({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {COMPLETION_NOTES.map((n) => (
        <button key={n} type="button" onClick={() => onPick(n)} className="h-8 px-2.5 rounded-full border border-border text-xs font-medium text-foreground hover:border-primary hover:bg-primary/5">+ {n}</button>
      ))}
    </div>
  );
}
// Append a preset to existing free-text, comma-separated, no duplicates.
const appendNote = (cur: string, add: string) => {
  const parts = cur.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.includes(add)) return cur;
  return parts.length ? `${parts.join(", ")}, ${add}` : add;
};

// /ready/:token — the per-vehicle Get-Ready hub. One permanent QR; anyone scans
// it (no login), picks their station, completes it, signs. Each station locks
// once a signed record exists. Stations: Service (CT K-208) and Detail (cleaning
// + pre-install protection w/ mandatory photos + optional third-party provider).

interface SignoffRow {
  id: string; role: string; performer_name?: string | null; company?: string | null;
  is_third_party?: boolean; detail_types?: { label?: string }[]; installs?: { label?: string }[];
  photos?: number; signed_at?: string | null;
}
interface Ctx {
  ok: boolean; reason?: string; tenant_id?: string; vehicle_listing_id?: string;
  vin?: string; ymm?: string; service_done?: boolean; detail_done?: boolean;
  signoffs?: SignoffRow[];
  preinstall_products?: { id: string; name: string; pre_install: boolean }[];
}
type View = "hub" | "service" | "detail" | "recon" | "pdi";

interface ReconLine { id: string; category: string | null; description: string; severity: string; completed_at: string | null; completed_by: string | null; }

// Self-declared installer identity — the "login" without the friction. The
// signature + photo + IP + timestamp are the real proof of who did the work.
const ROLES = [
  { key: "detail", label: "Detail dept" },
  { key: "service", label: "Service dept" },
  { key: "parts", label: "Parts dept" },
  { key: "recon", label: "Reconditioning" },
  { key: "outside", label: "Outside vendor" },
];
const ROLE_LABEL = (k: string) => ROLES.find((r) => r.key === k)?.label || "Installer";

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

// Department-scoped view. A dispatched link carries ?dept=<role> so each
// department only sees its own stations — keeping SERVICE (K-208 / recon / PDI)
// off what a detailer or outside vendor opens. No param = the full hub (a
// manager's own QR). Presentation-scoped for now; server still serves the whole
// context, so this hides rather than hard-blocks.
const DEPT_STATIONS: Record<string, Set<View>> = {
  detail: new Set<View>(["detail"]),
  outside: new Set<View>(["detail"]),
  parts: new Set<View>(["detail"]),
  service: new Set<View>(["service", "recon", "pdi"]),
  recon: new Set<View>(["recon"]),
};

export default function GetReady() {
  const { token = "" } = useParams();
  const [searchParams] = useSearchParams();
  const dept = (searchParams.get("dept") || "").toLowerCase();
  const allowedStations = DEPT_STATIONS[dept] || null; // null = show all
  const canStation = (v: View) => !allowedStations || allowedStations.has(v);
  // A QR can deep-link straight to a station (e.g. the service QR opening the
  // K-208) via ?station=service | ?do=k208. Falls back to the hub when the
  // station is unknown or the department scope hides it. The back arrow still
  // returns to the hub, so other stations stay reachable.
  const STATION_DEEPLINK: Record<string, View> = { service: "service", k208: "service", detail: "detail", recon: "recon", pdi: "pdi" };
  const requestedStation = STATION_DEEPLINK[(searchParams.get("station") || searchParams.get("do") || "").toLowerCase()];
  const initialView: View = requestedStation && canStation(requestedStation) ? requestedStation : "hub";
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [reconLines, setReconLines] = useState<ReconLine[]>([]);
  const [pdiDone, setPdiDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(initialView);

  const loadRecon = useCallback(async () => {
    const { data } = await (supabase as any).rpc("get_recon_for_token", { _token: token });
    if (data?.ok) setReconLines((data.lines as ReconLine[]) || []);
  }, [token]);

  const loadPdi = useCallback(async () => {
    const { data } = await (supabase as any).rpc("get_pdi_for_token", { _token: token });
    if (data?.ok) setPdiDone(!!data.done);
  }, [token]);

  const refresh = useCallback(async () => {
    const { data } = await (supabase as any).rpc("get_vehicle_ready", { _token: token });
    setCtx((data as Ctx) || { ok: false, reason: "not_found" });
    loadRecon();
    loadPdi();
    setLoading(false);
  }, [token, loadRecon, loadPdi]);
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
          <div className="font-display font-bold leading-tight">{view === "service" ? "Safety Inspection · K-208" : view === "detail" ? "Detail & Install" : view === "recon" ? "Reconditioning Work" : view === "pdi" ? "Pre-Delivery Inspection" : "Get the car ready"}</div>
          <div className="text-xs opacity-90">{ctx.ymm || "Vehicle"} · {ctx.vin}</div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4">
        {view === "hub" && (() => {
          const reconDone = reconLines.length > 0 && reconLines.every((l) => l.completed_at);
          const reconDoneCount = reconLines.filter((l) => l.completed_at).length;
          return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{allowedStations ? "Your station for this vehicle. It locks once it's signed." : "What are you here to do? Tap a step below. Each one locks once it's signed."}</p>
            {canStation("service") && <StationCard step={1} icon={<ShieldCheck className="w-5 h-5" />} title="Sign off the safety inspection (K-208)" sub={ctx.service_done ? "Completed" : "Mark each item Pass or Fail, then sign"} done={!!ctx.service_done} onClick={() => setView("service")} />}
            {canStation("recon") && <StationCard step={2} icon={<Wrench className="w-5 h-5" />} title="Confirm reconditioning is done" sub={reconLines.length === 0 ? "No recon work assigned yet" : reconDone ? "All work confirmed" : `Check off each job — ${reconDoneCount} of ${reconLines.length} done`} done={reconDone} onClick={() => setView("recon")} disabled={reconLines.length === 0} />}
            {canStation("detail") && <StationCard step={3} icon={<Sparkles className="w-5 h-5" />} title="Confirm detail & installed work" sub={dept === "outside" ? "Your installed work" : "Detail · parts · outside vendor"} done={false} onClick={() => setView("detail")} addAction />}
            {canStation("pdi") && <StationCard step={4} icon={<ClipboardCheck className="w-5 h-5" />} title="Pre-delivery inspection (PDI)" sub={pdiDone ? "Completed" : "Final check before delivery — tech or service writer"} done={pdiDone} onClick={() => setView("pdi")} />}

            {(() => {
              const roster = allowedStations
                ? (ctx.signoffs || []).filter((s) => (allowedStations.has("detail")
                    ? (["detail", "parts", "outside"].includes(String(s.role)) || s.is_third_party)
                    : ["service", "recon"].includes(String(s.role))))
                : (ctx.signoffs || []);
              return roster.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-foreground mb-2">Sign-offs on this vehicle</div>
                <div className="divide-y divide-border/60">
                  {roster.map((s) => {
                    const items = [
                      ...((s.detail_types || []).map((d) => d.label).filter(Boolean) as string[]),
                      ...((s.installs || []).map((i) => i.label).filter(Boolean) as string[]),
                    ];
                    const who = s.is_third_party && s.company ? s.company : ROLE_LABEL(s.role);
                    return (
                      <div key={s.id} className="flex items-start gap-3 py-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-foreground">{who}{s.performer_name ? ` · ${s.performer_name}` : ""}</p>
                          <p className="text-[11px] text-muted-foreground">{items.length ? items.join(", ") : "Work recorded"}{s.photos ? ` · ${s.photos} photo${s.photos === 1 ? "" : "s"}` : ""}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}
          </div>
          );
        })()}
        {view === "service" && <ServiceStation token={token} ctx={ctx} onDone={() => { refresh(); setView("hub"); }} />}
        {view === "detail" && <DetailStation token={token} ctx={ctx} onDone={() => { refresh(); setView("hub"); }} />}
        {view === "recon" && <ReconStation token={token} lines={reconLines} onDone={() => { loadRecon(); setView("hub"); }} />}
        {view === "pdi" && <PdiStation token={token} ctx={ctx} onDone={() => { loadPdi(); setView("hub"); }} />}
      </div>
    </div>
  );
}

function StationCard({ icon, title, sub, done, onClick, addAction, step, disabled }: { icon: React.ReactNode; title: string; sub: string; done: boolean; onClick: () => void; addAction?: boolean; step?: number; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`w-full flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${disabled ? "border-border bg-muted/30 opacity-60 cursor-default" : done ? "border-emerald-200 bg-emerald-50" : "border-border bg-card hover:bg-muted/40"}`}>
      {step != null && <div className="grid place-items-center w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">{step}</div>}
      <div className={`grid place-items-center w-11 h-11 rounded-xl shrink-0 ${done ? "bg-emerald-600 text-white" : "bg-muted text-foreground"}`}>{done ? <CheckCircle2 className="w-5 h-5" /> : icon}</div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-foreground leading-tight">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{addAction && !done ? `${sub} · tap to add a sign-off` : sub}</div>
      </div>
      {!done && !disabled && <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />}
    </button>
  );
}

// ── Reconditioning station — service checks off each approved job as done ────
function ReconStation({ token, lines, onDone }: { token: string; lines: ReconLine[]; onDone: () => void }) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(lines.filter((l) => l.completed_at).map((l) => [l.id, true])));
  const [name, setName] = useState(() => rememberedName("service"));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const toConfirm = lines.filter((l) => checked[l.id] && !l.completed_at).map((l) => l.id);
  const canSubmit = !!name.trim() && toConfirm.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return; setBusy(true);
    const { data, error } = await (supabase as any).rpc("recon_confirm_lines_done", {
      _token: token, _line_ids: toConfirm, _by: name.trim(), _notes: notes || null,
    });
    setBusy(false);
    if (!error && (data as { ok?: boolean })?.ok) { saveName("service", name); toast.success(`${(data as { completed?: number }).completed ?? toConfirm.length} job(s) confirmed`); onDone(); }
    else toast.error("Couldn't save — please try again.");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Check off each reconditioning job you completed on this vehicle, then sign.</p>
      <div className="rounded-2xl border border-border bg-card divide-y divide-border/60">
        {lines.map((l) => {
          const on = !!checked[l.id]; const already = !!l.completed_at;
          return (
            <button key={l.id} onClick={() => !already && setChecked((s) => ({ ...s, [l.id]: !s[l.id] }))} disabled={already}
              className="w-full flex items-center gap-3 p-3.5 text-left disabled:opacity-100">
              <span className={`grid place-items-center w-7 h-7 rounded-lg shrink-0 border ${on ? "bg-emerald-600 border-emerald-600 text-white" : "border-border bg-background text-transparent"}`}><CheckCircle2 className="w-4 h-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{l.description}</p>
                <p className="text-[11px] text-muted-foreground">{l.category || "Recon"}{already ? ` · done by ${l.completed_by || "service"}` : ""}</p>
              </div>
            </button>
          );
        })}
      </div>
      <div><p className="text-xs font-semibold text-foreground mb-1.5">Notes (optional)</p><NoteChips onPick={(t) => setNotes((c) => appendNote(c, t))} />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything to note about the work…" className="w-full rounded-lg border border-border bg-background p-3 text-sm" /></div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
      {!canSubmit && !busy && <p className="text-[12px] text-amber-600 text-center">{toConfirm.length === 0 ? "Check off the jobs you completed." : "Enter your name to confirm."}</p>}
      <SubmitBar label={`Confirm ${toConfirm.length || ""} job${toConfirm.length === 1 ? "" : "s"} done`} disabled={!canSubmit} busy={busy} onClick={submit} />
    </div>
  );
}

// ── PDI station — pre-delivery inspection (technician or service writer) ─────
function PdiStation({ token, ctx, onDone }: { token: string; ctx: Ctx; onDone: () => void }) {
  const [role, setRole] = useState<"technician" | "service_writer">("technician");
  const [marks, setMarks] = useState<Record<string, "pass" | "fail">>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [name, setName] = useState(() => rememberedName("pdi"));
  const [sig, setSig] = useState(""); const [sigType, setSigType] = useState<"draw" | "type">("draw");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const answered = PDI_ITEMS.filter((i) => marks[i.id]).length;
  const allAnswered = answered >= PDI_ITEMS.length;
  const anyFail = PDI_ITEMS.some((i) => marks[i.id] === "fail");
  const failsExplained = PDI_ITEMS.every((i) => marks[i.id] !== "fail" || (itemNotes[i.id] || "").trim() !== "");
  const passAll = () => { setMarks(Object.fromEntries(PDI_ITEMS.map((i) => [i.id, "pass" as const]))); setItemNotes({}); };
  const canSubmit = !!name.trim() && !!sig.trim() && consent && allAnswered && failsExplained && !busy;

  const submit = async () => {
    if (!canSubmit) return; setBusy(true);
    const checklist = PDI_ITEMS.map((i) => ({ id: i.id, label: i.label, result: marks[i.id] || "pass", explanation: (itemNotes[i.id] || "").trim() }));
    const result = anyFail ? "fail" : "pass";
    const content_hash = await hashPayload({ vin: ctx.vin, checklist, result, name, role });
    const ip = await fetchClientIp();
    const { data, error } = await (supabase as any).rpc("submit_pdi_signoff", {
      _token: token, _checklist: checklist, _result: result, _notes: notes || null,
      _performer_name: name.trim(), _performer_role: role, _signature_data: sig, _content_hash: content_hash,
      _esign_consent: buildConsentRecord(), _ip: ip, _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    setBusy(false);
    if (!error && (data as { ok?: boolean })?.ok) { saveName("pdi", name); onDone(); }
    else toast.error((data as { reason?: string })?.reason === "expired" ? "This link is no longer active — ask for a new QR." : "Couldn't submit — please try again.");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-foreground">Who's completing the PDI?</div>
        <div className="flex gap-2">
          {([["technician", "Technician"], ["service_writer", "Service writer"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setRole(k)} className={`flex-1 h-10 rounded-lg text-sm font-semibold border ${role === k ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground"}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{answered} of {PDI_ITEMS.length} items marked</p>
        <button onClick={passAll} className="h-9 px-3 rounded-md bg-emerald-600 text-white text-xs font-semibold">Pass all</button>
      </div>
      <div className="rounded-2xl border border-border bg-card divide-y divide-border/60">
        {PDI_ITEMS.map((item) => {
          const failed = marks[item.id] === "fail";
          return (
            <div key={item.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground flex-1">{item.label}</span>
                <div className="flex gap-1.5 shrink-0">
                  {(["pass", "fail"] as const).map((m) => (
                    <button key={m} onClick={() => setMarks((s) => ({ ...s, [item.id]: m }))}
                      className={`h-11 w-16 rounded-md text-[12px] font-semibold border transition-colors ${marks[item.id] === m ? (m === "pass" ? "bg-emerald-600 text-white border-emerald-600" : "bg-red-600 text-white border-red-600") : "bg-background text-muted-foreground border-border hover:bg-muted"}`}>
                      {m === "pass" ? "Pass" : "Fail"}
                    </button>
                  ))}
                </div>
              </div>
              {failed && (
                <input autoFocus value={itemNotes[item.id] || ""} onChange={(e) => setItemNotes((s) => ({ ...s, [item.id]: e.target.value }))}
                  placeholder="What's the issue? (required)" className="mt-2 w-full rounded-lg border border-red-300 bg-red-50/40 px-3 h-10 text-sm" />
              )}
            </div>
          );
        })}
      </div>
      <div><p className="text-xs font-semibold text-foreground mb-1.5">Notes (optional)</p><NoteChips onPick={(t) => setNotes((c) => appendNote(c, t))} />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything to note…" className="w-full rounded-lg border border-border bg-background p-3 text-sm" /></div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
      <SignaturePad label="Signature" subtitle="Sign to certify the PDI." value={sig} type={sigType} onChange={(d, t) => { setSig(d); setSigType(t); }} />
      <ConsentRow text={PDI_CERTIFICATION_TEXT} checked={consent} onChange={setConsent} />
      {!canSubmit && !busy && <p className="text-[12px] text-amber-600 text-center">{!allAnswered ? `${PDI_ITEMS.length - answered} item(s) still need a mark — use "Pass all" then adjust.` : !failsExplained ? "Explain each failed item." : !name.trim() ? "Enter your name." : !sig.trim() ? "Add your signature." : !consent ? "Check the certification box." : ""}</p>}
      <SubmitBar label="Submit PDI" disabled={!canSubmit} busy={busy} onClick={submit} />
    </div>
  );
}

// ── Service station (CT K-208) ─────────────────────────────────────────────
function ServiceStation({ token, ctx, onDone }: { token: string; ctx: Ctx; onDone: () => void }) {
  const [marks, setMarks] = useState<Record<string, K208Mark>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [docs, setDocs] = useState<{ url: string; caption?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState(() => rememberedName("service"));
  const [sig, setSig] = useState(""); const [sigType, setSigType] = useState<"draw" | "type">("draw");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (ctx.service_done) return <DoneCard label="Safety inspection already completed for this vehicle." />;
  const answered = k208Answered(marks); const result = k208Result(marks);
  // "Pass all" marks every line PASS (checks off each spot). If a car doesn't
  // all-pass, the writer marks the failing lines individually instead.
  const passAll = () => { setMarks(Object.fromEntries(K208_ITEMS.map((i) => [i.id, "pass" as K208Mark]))); setItemNotes({}); };
  const onFiles = async (files: FileList | null) => { if (!files?.length) return; setUploading(true); for (const f of Array.from(files)) { const url = await uploadViaToken(token, f); if (url) setDocs((d) => [...d, { url, caption: f.name }]); } setUploading(false); };
  // Every line must be marked (pass/fail), and every FAIL must carry an
  // explanation of defects/repairs — a partial K-208 must never certify as PASS.
  const allAnswered = answered >= K208_ITEMS.length;
  const failsExplained = K208_ITEMS.every((i) => marks[i.id] !== "fail" || (itemNotes[i.id] || "").trim() !== "");
  const canSubmit = !!name.trim() && !!sig.trim() && consent && allAnswered && failsExplained && !busy;

  const submit = async () => {
    if (!canSubmit) return; setBusy(true);
    const checklist = k208Checklist(marks, itemNotes);
    // Roll the per-item explanations up into the failure_notes column too.
    const failureNotes = checklist.filter((c) => c.result === "fail").map((c) => `${c.label}: ${c.explanation || "(no explanation)"}`).join("; ");
    const content_hash = await hashPayload({ vin: ctx.vin, checklist, result, name });
    const ip = await fetchClientIp();
    const { data, error } = await (supabase as any).rpc("submit_safety_inspection", {
      _token: token, _checklist: checklist, _result: result, _failure_notes: failureNotes || null, _notes: notes || null,
      _documents: docs, _inspector_name: name.trim(), _signature_data: sig, _content_hash: content_hash,
      _esign_consent: buildConsentRecord(), _ip: ip, _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    setBusy(false);
    if (!error && (data as { ok?: boolean })?.ok) { saveName("service", name); onDone(); }
    else toast.error(error?.message ? "Couldn't submit — please try again." : (data as { reason?: string })?.reason === "expired" ? "This link is no longer active — ask for a new QR." : "Couldn't submit — please try again.");
  };

  return (
    <div className="space-y-4">
      <K208Checklist marks={marks} onMark={(id, m) => setMarks((s) => ({ ...s, [id]: m }))} onPassAll={passAll} failureNotes="" onFailureNotes={() => {}} notes={notes} onNotes={setNotes} itemNotes={itemNotes} onItemNote={(id, v) => setItemNotes((s) => ({ ...s, [id]: v }))} />
      <div><p className="text-xs font-semibold text-foreground mb-1.5">Quick notes</p><NoteChips onPick={(t) => setNotes((c) => appendNote(c, t))} /></div>
      <UploadRow label="Repair order / inspection sheet / photos" uploading={uploading} onFiles={onFiles} docs={docs} onRemove={(i) => setDocs((a) => a.filter((_, x) => x !== i))} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Inspector full name" className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
      <SignaturePad label="Inspector signature" subtitle="Sign to certify this inspection." value={sig} type={sigType} onChange={(d, t) => { setSig(d); setSigType(t); }} />
      <ConsentRow text={K208_CERTIFICATION_TEXT} checked={consent} onChange={setConsent} />
      {!canSubmit && !busy && (
        <p className="text-[12px] text-amber-600 text-center">
          {!allAnswered ? `${K208_ITEMS.length - answered} item${K208_ITEMS.length - answered === 1 ? "" : "s"} still need a mark — use "Pass all" then adjust any exceptions.`
            : !failsExplained ? "Add an explanation of defects/repairs for each failed item."
            : !name.trim() ? "Enter your name to certify."
            : !sig.trim() ? "Add your signature to certify."
            : !consent ? "Check the certification box to submit." : ""}
        </p>
      )}
      <SubmitBar label={`Submit K-208 (${result.toUpperCase()})`} disabled={!canSubmit} busy={busy} onClick={submit} />
    </div>
  );
}

// ── Detail / install station (role pick + cleaning + installs + accessories) ─
function DetailStation({ token, ctx, onDone }: { token: string; ctx: Ctx; onDone: () => void }) {
  const products = ctx.preinstall_products || [];
  const [role, setRole] = useState("");
  const [types, setTypes] = useState<Record<string, boolean>>({});
  const [installs, setInstalls] = useState<Record<string, { on: boolean; photo?: string; uploading?: boolean }>>({});
  const [extras, setExtras] = useState<{ id: string; label: string; photo?: string; uploading?: boolean }[]>([]);
  const [company, setCompany] = useState(""); const [contact, setContact] = useState("");
  const [name, setName] = useState(() => rememberedName("detail")); const [sig, setSig] = useState(""); const [sigType, setSigType] = useState<"draw" | "type">("draw");
  const [notes, setNotes] = useState(""); const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false);

  const thirdParty = role === "outside";

  const installPhoto = async (id: string, file: File | null) => {
    if (!file) return;
    setInstalls((s) => ({ ...s, [id]: { ...(s[id] || { on: true }), on: true, uploading: true } }));
    const url = await uploadViaToken(token, file);
    setInstalls((s) => ({ ...s, [id]: { on: true, photo: url || undefined, uploading: false } }));
  };
  const extraPhoto = async (id: string, file: File | null) => {
    if (!file) return;
    setExtras((s) => s.map((e) => e.id === id ? { ...e, uploading: true } : e));
    const url = await uploadViaToken(token, file);
    setExtras((s) => s.map((e) => e.id === id ? { ...e, photo: url || undefined, uploading: false } : e));
  };
  const addExtra = () => setExtras((s) => [...s, { id: `x${s.length}-${Math.random().toString(36).slice(2, 7)}`, label: "" }]);
  const selectedInstalls = products.filter((p) => installs[p.id]?.on);
  const validExtras = extras.filter((e) => e.label.trim());
  const missingPhoto = selectedInstalls.some((p) => p.pre_install && !installs[p.id]?.photo);
  const anySelected = Object.values(types).some(Boolean) || selectedInstalls.length > 0 || validExtras.length > 0;
  const canSubmit = !!role && !!name.trim() && !!sig.trim() && consent && anySelected && !missingPhoto && (!thirdParty || !!company.trim()) && !busy;

  const submit = async () => {
    if (!canSubmit) return; setBusy(true);
    const detail_types = DETAIL_TYPES.filter((t) => types[t.key]).map((t) => ({ key: t.key, label: t.label }));
    const installPayload = [
      ...selectedInstalls.map((p) => ({ product_id: p.id, label: p.name, pre_install: p.pre_install, photo_url: installs[p.id]?.photo || null })),
      ...validExtras.map((e) => ({ product_id: null, label: e.label.trim(), pre_install: false, photo_url: e.photo || null })),
    ];
    const photos = installPayload.map((i) => i.photo_url).filter(Boolean);
    const content_hash = await hashPayload({ vin: ctx.vin, role, detail_types, installs: installPayload, name, thirdParty, company });
    const ip = await fetchClientIp();
    const { data, error } = await (supabase as any).rpc("submit_detail_signoff", {
      _token: token, _detail_types: detail_types, _installs: installPayload, _is_third_party: thirdParty,
      _provider_company: thirdParty ? company.trim() : null, _provider_contact: thirdParty ? contact.trim() : null,
      _performer_name: name.trim(), _signature_data: sig, _photos: photos, _notes: notes || null,
      _content_hash: content_hash, _esign_consent: buildConsentRecord(), _ip: ip,
      _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null, _performer_role: role,
    });
    setBusy(false);
    if (!error && (data as { ok?: boolean })?.ok) { saveName("detail", name); onDone(); }
    else toast.error((data as { reason?: string })?.reason === "expired" ? "This link is no longer active — ask for a new QR." : "Couldn't submit — please try again.");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-foreground">Who's signing off?</div>
        <p className="text-xs text-muted-foreground">Pick your department or vendor. Each party records and signs only their own work.</p>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((rl) => (
            <button key={rl.key} onClick={() => setRole(rl.key)}
              className={`h-10 rounded-lg border text-sm font-semibold px-3 ${role === rl.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground"}`}>
              {rl.label}
            </button>
          ))}
        </div>
        {thirdParty && (
          <div className="grid gap-2 pt-1">
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" />
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Contact number / email" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" />
          </div>
        )}
      </div>

      {!role ? (
        <p className="text-center text-xs text-muted-foreground py-4">Select who's signing off to continue.</p>
      ) : (
      <>
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
        <div className="text-xs font-bold uppercase tracking-wider text-foreground">Other accessories / equipment installed</div>
        <p className="text-xs text-muted-foreground">Anything not listed above — wind deflector, all-weather mats, trailer hitch, tint. Add a photo of the finished work.</p>
        {extras.map((e) => (
          <div key={e.id} className="rounded-xl border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input value={e.label} onChange={(ev) => setExtras((s) => s.map((x) => x.id === e.id ? { ...x, label: ev.target.value } : x))} placeholder="Accessory / item installed" className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm" />
              <button onClick={() => setExtras((s) => s.filter((x) => x.id !== e.id))} className="w-8 h-8 grid place-items-center rounded-md border border-border text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            {e.photo ? (
              <a href={e.photo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Photo attached</a>
            ) : (
              <>
                <input type="file" accept="image/*" capture="environment" id={`ex-${e.id}`} className="hidden" onChange={(ev) => extraPhoto(e.id, ev.target.files?.[0] ?? null)} />
                <label htmlFor={`ex-${e.id}`} className="h-8 px-3 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer w-fit">
                  {e.uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} Take / add photo
                </label>
              </>
            )}
          </div>
        ))}
        <button onClick={addExtra} className="h-9 px-3 rounded-md border border-dashed border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted w-fit"><Upload className="w-3.5 h-3.5" /> Add accessory</button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <NoteChips onPick={(t) => setNotes((c) => appendNote(c, t))} />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional) — tap a chip above or type" className="w-full rounded-lg border border-border bg-background p-3 text-sm" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={thirdParty ? "Your name" : "Your full name"} className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
        <SignaturePad label="Signature" subtitle="Sign to confirm the work above was completed." value={sig} type={sigType} onChange={(d, t) => { setSig(d); setSigType(t); }} />
        <ConsentRow text="I confirm the work recorded above was performed on this vehicle and the information is accurate." checked={consent} onChange={setConsent} />
      </div>

      {missingPhoto && <p className="text-center text-xs text-amber-600 font-semibold">Add a photo for each pre-install item before submitting.</p>}
      <SubmitBar label="Submit & sign" disabled={!canSubmit} busy={busy} onClick={submit} />
      </>
      )}
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
