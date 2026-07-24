import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import SignaturePad from "@/components/addendum/SignaturePad";
import K208Checklist, { K208_ITEMS, k208Answered, k208Result, k208Checklist, type K208Mark } from "@/components/service/K208Checklist";
import { K208_CERTIFICATION_TEXT } from "@/data/ctK208Form";
import { buildConsentRecord, hashPayload, fetchClientIp } from "@/lib/esign";
import { uploadPhoto } from "@/lib/storage";
import { Loader2, Search, QrCode, ShieldCheck, FileText, Upload, CheckCircle2, Copy, X, ArrowLeft } from "lucide-react";
import NextStepBanner from "@/components/workflow/NextStepBanner";
import ServiceQueue from "@/components/service/ServiceQueue";
import { RequestAdditionalWorkButton, ServiceApprovalsPanel } from "@/components/service/AdditionalWork";
import ServiceStatusBanner from "@/components/service/ServiceStatusBanner";

// /service — desktop hub for logged-in Service staff. For a chosen vehicle:
//   1. Generate the no-login QR to hand to a tech (issue_dept_signoff_token)
//   2. Fill + sign the CT K-208 right here (writes safety_inspections via RLS)
//   3. Upload dealer-facing Title / MCO front+back (vehicle_documents)

interface Veh { id: string; vin: string; ymm: string | null; }
interface DocRef { url: string; caption?: string; category?: string; }
const TITLE_SLOTS = [
  { key: "title_front", label: "Title — front" },
  { key: "title_back", label: "Title — back" },
  { key: "mco_front", label: "MCO — front" },
  { key: "mco_back", label: "MCO — back" },
] as const;

export default function ServiceDesk() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id || null;
  const [vinInput, setVinInput] = useState("");
  const [veh, setVeh] = useState<Veh | null>(null);
  const [loadingVeh, setLoadingVeh] = useState(false);

  const loadVehicle = async () => {
    if (!tenantId) return;
    const vin = vinInput.trim().toUpperCase();
    if (vin.length < 11) { toast.error("Enter the full VIN"); return; }
    setLoadingVeh(true);
    // Exact match only: a K-208 / QR is a compliance record, so a partial-VIN
    // substring must never resolve to (and attach to) the wrong vehicle.
    const { data } = await (supabase as any).from("vehicle_listings")
      .select("id, vin, ymm").eq("tenant_id", tenantId).eq("vin", vin).limit(1).maybeSingle();
    setLoadingVeh(false);
    if (!data) { toast.error("No vehicle found for that VIN"); return; }
    setVeh(data as Veh);
  };

  if (!tenantId) return null;

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Service Desk</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Safety inspections, get-ready work, and K-208 execution.</p>
        </div>
        {veh && (
          <button onClick={() => setVeh(null)} className="h-10 px-4 rounded-lg border border-border text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-muted">
            <ArrowLeft className="w-4 h-4" /> Back to queue
          </button>
        )}
      </div>

      {veh ? (
        // Per-vehicle service workspace — opened from the queue (or a Service QR).
        <>
          <div className="rounded-xl bg-muted/50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-display font-bold text-foreground">{veh.ymm || "Vehicle"}</div>
              <div className="font-mono text-xs text-muted-foreground">{veh.vin}</div>
            </div>
            <RequestAdditionalWorkButton tenantId={tenantId} veh={veh} />
          </div>
          <ServiceStatusBanner tenantId={tenantId} veh={veh} />
          <ServiceQrCard tenantId={tenantId} vin={veh.vin} />
          <div id="k208-workspace"><DesktopK208 tenantId={tenantId} veh={veh} /></div>
          <TitleMcoUpload tenantId={tenantId} veh={veh} />
        </>
      ) : (
        // The queue — one landing for service writers/managers.
        <>
          <NextStepBanner stage="service" />
          <ServiceApprovalsPanel tenantId={tenantId} />
          <ServiceQueue onOpen={(v) => setVeh({ id: v.id, vin: v.vin, ymm: v.ymm })} />
          <details className="rounded-2xl border border-border bg-card">
            <summary className="px-4 py-3 text-sm font-semibold text-foreground cursor-pointer">Service settings — publish gate &amp; K-208 authority</summary>
            <div className="p-4 pt-0 space-y-4">
              <GateSettingCard tenantId={tenantId} />
              <RoleAuthorityCard tenantId={tenantId} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

// ── Publish-gate setting: require a signed K-208 before used cars publish ───
function GateSettingCard({ tenantId }: { tenantId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
      setOn(!!(data?.settings as { require_safety_inspection?: boolean } | null)?.require_safety_inspection);
    })();
  }, [tenantId]);

  const toggle = async () => {
    const next = !on;
    setSaving(true);
    const { data } = await (supabase as any).from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
    const settings = { ...((data?.settings as Record<string, unknown>) || {}), require_safety_inspection: next };
    const { error } = await (supabase as any).from("dealer_profiles").update({ settings }).eq("tenant_id", tenantId);
    setSaving(false);
    if (error) { toast.error("Could not save setting"); return; }
    setOn(next);
    toast.success(next ? "Used cars now require a signed K-208 before the deal can be finalized" : "K-208 finalize requirement turned off");
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-primary mt-0.5" />
        <div>
          <div className="font-bold text-foreground">Require K-208 before finalizing a used-car deal</div>
          <div className="text-sm text-muted-foreground">The Passport still auto-publishes so the car is shoppable right away. When on, a used/CPO deal can't be sent for disclosure signature until the service department's safety inspection is signed. New cars are exempt; admins can always override.</div>
        </div>
      </div>
      <button onClick={toggle} disabled={on === null || saving}
        className={`shrink-0 h-7 w-12 rounded-full transition-colors relative ${on ? "bg-emerald-600" : "bg-muted"}`} aria-pressed={!!on}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

// ── Who may authoritatively sign the K-208 (gate authority) ─────────────────
// Keys MUST match real tenant_members.role values — the finalize gate compares
// the signed K-208 inspector's role against these. "Service Writer" is the
// service_advisor role; "Service Manager" is service_manager.
const AUTHORITY_ROLES = [
  { key: "owner", label: "Owner" },
  { key: "admin", label: "Admin" },
  { key: "general_manager", label: "General Manager" },
  { key: "service_manager", label: "Service Manager" },
  { key: "service_advisor", label: "Service Writer" },
] as const;

function RoleAuthorityCard({ tenantId }: { tenantId: string }) {
  const [roles, setRoles] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
      const r = (data?.settings as { k208_authority_roles?: string[] } | null)?.k208_authority_roles;
      setRoles(Array.isArray(r) ? r : []);
    })();
  }, [tenantId]);

  const toggle = async (key: string) => {
    if (roles === null) return;
    const next = roles.includes(key) ? roles.filter((r) => r !== key) : [...roles, key];
    setSaving(true);
    const { data } = await (supabase as any).from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
    const settings = { ...((data?.settings as Record<string, unknown>) || {}), k208_authority_roles: next };
    const { error } = await (supabase as any).from("dealer_profiles").update({ settings }).eq("tenant_id", tenantId);
    setSaving(false);
    if (error) { toast.error("Could not save authority setting"); return; }
    setRoles(next);
    toast.success("Sign-off authority updated");
  };

  const restricted = (roles?.length ?? 0) > 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-primary mt-0.5" />
        <div>
          <div className="font-bold text-foreground">Who can sign off the K-208</div>
          <div className="text-sm text-muted-foreground">
            Pick which roles count as an authorized inspector for the finalize gate. When one or more is selected, only a logged-in member with that role satisfies the requirement — an anonymous windshield-QR sign-off no longer counts on its own (it still records the work). Leave all unselected to accept any signed K-208.
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-8">
        {AUTHORITY_ROLES.map((r) => {
          const on = !!roles?.includes(r.key);
          return (
            <button key={r.key} onClick={() => toggle(r.key)} disabled={roles === null || saving}
              className={`h-9 px-4 rounded-full text-sm font-semibold border transition-colors disabled:opacity-50 ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted"}`}>
              {on ? "✓ " : ""}{r.label}
            </button>
          );
        })}
      </div>
      <div className="pl-8 text-xs text-muted-foreground">
        {restricted ? "Restricted: a logged-in authorized signer is required." : "Open: any signed K-208 (including anonymous QR) satisfies the gate."}
      </div>
    </div>
  );
}

// ── Generate the no-login QR for a tech ────────────────────────────────────
function ServiceQrCard({ tenantId, vin }: { tenantId: string; vin: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = token ? `${window.location.origin}/ready/${token}` : "";

  const generate = async () => {
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("issue_vehicle_ready_token", {
      p_tenant_id: tenantId, p_vin: vin,
    });
    setBusy(false);
    if (error || !data) { toast.error("Could not generate QR"); return; }
    setToken(String(data));
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2"><QrCode className="w-4 h-4 text-primary" /><h2 className="font-bold text-foreground">Get-Ready QR (windshield)</h2></div>
      <p className="text-sm text-muted-foreground">One code for this car. Service, detail, installers, and outside vendors all scan it, pick their station, and sign — no login. Each station locks once signed.</p>
      {!token ? (
        <button onClick={generate} disabled={busy} className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />} Generate QR
        </button>
      ) : (
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <div className="bg-white p-3 rounded-xl border border-border"><QRCodeSVG value={url} size={150} /></div>
          <div className="flex-1 space-y-2">
            <a href={url} target="_blank" rel="noreferrer" className="block text-sm text-primary break-all underline">{url}</a>
            <button onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copied"); }}
              className="h-9 px-3 rounded-md border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted"><Copy className="w-3.5 h-3.5" /> Copy link</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Complete the K-208 on desktop ──────────────────────────────────────────
function DesktopK208({ tenantId, veh }: { tenantId: string; veh: Veh }) {
  const [marks, setMarks] = useState<Record<string, K208Mark>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [docs, setDocs] = useState<DocRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [inspectorName, setInspectorName] = useState(() => { try { return localStorage.getItem("autolabels.signer.service") || ""; } catch { return ""; } });
  const [signature, setSignature] = useState("");
  const [sigType, setSigType] = useState<"draw" | "type">("draw");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const answered = k208Answered(marks);
  const result = k208Result(marks);
  const allAnswered = answered >= K208_ITEMS.length;
  const failsExplained = K208_ITEMS.every((i) => marks[i.id] !== "fail" || (itemNotes[i.id] || "").trim() !== "");
  // "Pass all" marks every line PASS; exceptions are then marked individually.
  const passAll = () => { setMarks(Object.fromEntries(K208_ITEMS.map((i) => [i.id, "pass" as K208Mark]))); setItemNotes({}); };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      try {
        const up = await uploadPhoto("prep-photos", f, { tenantId, vin: veh.vin });
        if (up?.url) setDocs((d) => [...d, { url: up.url, caption: f.name, category: "inspection" }]);
      } catch { /* skip */ }
    }
    setUploading(false);
  };

  const canSubmit = !!inspectorName.trim() && !!signature.trim() && consent && allAnswered && failsExplained && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const checklist = k208Checklist(marks, itemNotes);
    const failureNotes = checklist.filter((c) => c.result === "fail").map((c) => `${c.label}: ${c.explanation || "(no explanation)"}`).join("; ");
    const payload = { vin: veh.vin, ymm: veh.ymm, checklist, result, failureNotes, notes, docs, inspectorName };
    const content_hash = await hashPayload(payload);
    const ip = await fetchClientIp();
    const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
    const { error } = await (supabase as any).from("safety_inspections").insert({
      tenant_id: tenantId, vehicle_listing_id: veh.id, vin: veh.vin, ymm: veh.ymm, form_type: "CT-K208",
      checklist, result, failure_notes: failureNotes || null, notes: notes || null, documents: docs,
      inspector_name: inspectorName.trim(), inspector_role: "service", signature_data: signature, signature_type: sigType,
      content_hash, esign_consent: buildConsentRecord(), customer_ip: ip,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      submitted_via: "app", status: "signed", signed_at: new Date().toISOString(), created_by: uid,
    });
    setSaving(false);
    if (error) { toast.error(error.message || "Could not save inspection"); return; }
    try { localStorage.setItem("autolabels.signer.service", inspectorName.trim()); } catch { /* ignore */ }
    setDone(true);
    toast.success("K-208 saved and signed");
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 flex items-center gap-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-600" />
        <div><div className="font-bold text-emerald-900">K-208 recorded</div><div className="text-sm text-emerald-800">Result: {result.toUpperCase()} · signed by {inspectorName.trim()}</div></div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /><h2 className="font-bold text-foreground">Complete CT K-208 here</h2></div>
      <K208Checklist marks={marks} onMark={(id, m) => setMarks((s) => ({ ...s, [id]: m }))} onPassAll={passAll}
        onClearAll={() => { setMarks({}); setItemNotes({}); }}
        failureNotes="" onFailureNotes={() => {}} notes={notes} onNotes={setNotes}
        itemNotes={itemNotes} onItemNote={(id, v) => setItemNotes((s) => ({ ...s, [id]: v }))} />

      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Documents (inspection sheet, defect photos)</label>
        <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => onFiles(e.target.files)} className="hidden" id="k208-files" />
        <label htmlFor="k208-files" className="h-9 px-3 rounded-md border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted cursor-pointer w-fit">
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Add file
        </label>
        {docs.length > 0 && <div className="text-xs text-muted-foreground">{docs.length} file(s) attached</div>}
      </div>

      <input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} placeholder="Inspector full name"
        className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm" />
      <SignaturePad label="Inspector signature" subtitle="Sign to certify this inspection." value={signature} type={sigType}
        onChange={(d, t) => { setSignature(d); setSigType(t); }} />
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        <span>{K208_CERTIFICATION_TEXT}</span>
      </label>

      <button onClick={submit} disabled={!canSubmit}
        className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Save & sign K-208 ({result.toUpperCase()})
      </button>
    </div>
  );
}

// ── Title / MCO upload (dealer-facing) ─────────────────────────────────────
function TitleMcoUpload({ tenantId, veh }: { tenantId: string; veh: Veh }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});

  const upload = async (docType: string, file: File | null) => {
    if (!file) return;
    setBusy(docType);
    try {
      const up = await uploadPhoto("prep-photos", file, { tenantId, vin: veh.vin });
      if (up?.url) {
        const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
        const { error } = await (supabase as any).from("vehicle_documents").insert({
          tenant_id: tenantId, vehicle_listing_id: veh.id, vin: veh.vin, doc_type: docType,
          url: up.url, filename: file.name, customer_facing: false, uploaded_by: uid, uploaded_via: "app",
        });
        if (error) throw new Error(error.message);
        setSaved((s) => ({ ...s, [docType]: up.url }));
        toast.success("Uploaded");
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
    setBusy(null);
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /><h2 className="font-bold text-foreground">Title / MCO (dealer-only)</h2></div>
      <p className="text-sm text-muted-foreground">Front and back of the title, or the new-car MCO. These are never shown on the public Passport.</p>
      <div className="grid grid-cols-2 gap-3">
        {TITLE_SLOTS.map((slot) => (
          <div key={slot.key} className="rounded-xl border border-dashed border-border p-3 text-center space-y-2">
            <div className="text-xs font-semibold text-foreground">{slot.label}</div>
            {saved[slot.key] ? (
              <a href={saved[slot.key]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Uploaded</a>
            ) : (
              <>
                <input type="file" accept="image/*,application/pdf" id={`doc-${slot.key}`} className="hidden" onChange={(e) => upload(slot.key, e.target.files?.[0] ?? null)} />
                <label htmlFor={`doc-${slot.key}`} className="h-8 px-3 rounded-md border border-border text-[11px] font-semibold inline-flex items-center gap-1.5 hover:bg-muted cursor-pointer">
                  {busy === slot.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
                </label>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
