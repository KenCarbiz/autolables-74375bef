import { useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, FileCheck2, Save, ShieldCheck, Wand2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import {
  DEFAULT_CT_MVP_INPUT,
  evaluateCtMvpRules,
  type CtMvpVehicleInput,
} from "@/lib/ctMvp/ruleEngine";
import { certifyCtMvp } from "@/lib/ctMvp/certification";
import { persistCtMvpEvidenceBundle } from "@/lib/ctMvp/persistence";
import { normalizeVehicle } from "@/lib/inventory/normalizeVehicle";
import type { DocumentLifecycleEvent } from "@/lib/audit/documentLifecycle";
import type { SignatureEvidence } from "@/lib/audit/signatureValidation";

const nowIso = () => new Date().toISOString();
const documentKeysFor = (result: ReturnType<typeof evaluateCtMvpRules>) => [
  "window_sticker",
  "addendum",
  ...(result.ftcBuyersGuide === "required" ? ["ftc_buyers_guide"] : []),
  ...(result.k208 === "required" ? ["k208"] : []),
  ...(result.passportStatus === "enabled" ? ["passport"] : []),
];

type FieldProps = {
  label: string;
  children: React.ReactNode;
};

const Field = ({ label, children }: FieldProps) => (
  <label className="space-y-1.5">
    <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
    {children}
  </label>
);

const inputClass = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
const selectClass = `${inputClass} appearance-none`;

const OutputCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
    <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
  </div>
);

const AdminSmokeTest = () => {
  const { tenant } = useTenant();
  const [input, setInput] = useState<CtMvpVehicleInput>(DEFAULT_CT_MVP_INPUT);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const result = useMemo(() => evaluateCtMvpRules(input), [input]);
  const docs = useMemo(() => documentKeysFor(result), [result]);
  const lifecycleEvents = useMemo<DocumentLifecycleEvent[]>(() => [
    { type: "vehicle_normalized", occurredAt: nowIso(), source: "admin-smoke-test" },
    { type: "window_sticker_generated", occurredAt: nowIso(), source: "admin-smoke-test" },
    { type: "addendum_generated", occurredAt: nowIso(), source: "admin-smoke-test" },
    ...(result.ftcBuyersGuide === "required" ? [{ type: "ftc_buyers_guide_generated" as const, occurredAt: nowIso(), source: "admin-smoke-test" }] : []),
    ...(result.k208 === "required" ? [{ type: "k208_generated" as const, occurredAt: nowIso(), source: "admin-smoke-test" }] : []),
    ...(result.passportStatus === "enabled" ? [{ type: "passport_generated" as const, occurredAt: nowIso(), source: "admin-smoke-test" }] : []),
    { type: "customer_signed", occurredAt: nowIso(), source: "admin-smoke-test" },
    { type: "deal_delivered", occurredAt: nowIso(), source: "admin-smoke-test" },
    { type: "document_archived", occurredAt: nowIso(), source: "admin-smoke-test" },
  ], [result.ftcBuyersGuide, result.k208, result.passportStatus]);
  const signatureEvidence = useMemo<SignatureEvidence[]>(() => [
    {
      role: "customer",
      signerName: "Sample Customer",
      signedAt: nowIso(),
      ipAddress: "127.0.0.1",
      userAgent: "Smoke Test Browser",
      consentText: "I agree to electronically sign and receive this vehicle document packet.",
      documentKeys: docs,
    },
    {
      role: "dealer",
      signerName: "Sample Dealer Rep",
      signedAt: nowIso(),
      ipAddress: "127.0.0.1",
      userAgent: "Smoke Test Browser",
      consentText: "Dealer representative confirms the generated packet is complete.",
      documentKeys: docs,
    },
    {
      role: "installer",
      signerName: "Sample Installer",
      signedAt: nowIso(),
      ipAddress: "127.0.0.1",
      userAgent: "Smoke Test Browser",
      consentText: "Installer confirms addendum install/proof.",
      documentKeys: ["addendum"],
    },
  ], [docs]);
  const vehicle = useMemo(() => normalizeVehicle({
    vin: input.vin,
    stock: input.stock,
    year: input.year,
    make: input.make,
    model: input.model,
    mileage: input.mileage,
    state: input.state,
    condition: input.condition,
    cpoStatus: input.cpoStatus,
    source: "admin-smoke-test",
  }), [input]);
  const certification = useMemo(() => certifyCtMvp({
    vehicle,
    lifecycleEvents,
    signatureEvidence,
  }), [vehicle, lifecycleEvents, signatureEvidence]);

  const update = <K extends keyof CtMvpVehicleInput>(key: K, value: CtMvpVehicleInput[K]) => {
    setInput((prev) => ({ ...prev, [key]: value }));
  };

  const saveCertification = async () => {
    if (!tenant?.id || tenant.id === "house") {
      toast.error("No active dealer tenant found. Sign in to a dealer account before saving evidence.");
      return;
    }
    setSaving(true);
    try {
      await persistCtMvpEvidenceBundle({
        context: { tenantId: tenant.id, vin: input.vin, stock: input.stock },
        lifecycleEvents,
        signatureEvidence,
        certification,
        source: "admin-smoke-test",
      });
      const savedAt = new Date().toLocaleString();
      setLastSavedAt(savedAt);
      toast.success("Smoke-test certification evidence saved.");
    } catch (error) {
      console.error(error);
      toast.error("Could not save smoke-test evidence. Check migrations and tenant permissions.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-4 lg:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Connecticut MVP validation
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">Admin Smoke Test</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Enter one vehicle and verify the complete document decision chain: sticker, addendum, FTC Buyers Guide, K208,
            passport, trust source, dealer program, lifecycle audit, signatures, packet readiness, and archive readiness.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastSavedAt ? <span className="text-xs font-medium text-muted-foreground">Last saved {lastSavedAt}</span> : null}
          <button
            type="button"
            onClick={saveCertification}
            disabled={saving}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save evidence"}
          </button>
          <button
            type="button"
            onClick={() => setInput(DEFAULT_CT_MVP_INPUT)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <Wand2 className="h-4 w-4" /> Reset sample
          </button>
        </div>
      </div>

      <section className={`rounded-2xl border p-4 shadow-sm ${certification.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            {certification.ready ? <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-700" /> : <XCircle className="mt-0.5 h-6 w-6 text-amber-700" />}
            <div>
              <p className={`text-sm font-bold uppercase tracking-[0.18em] ${certification.ready ? "text-emerald-800" : "text-amber-800"}`}>MVP Certification</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">{certification.ready ? "Ready for Connecticut MVP" : "Not ready yet"}</h2>
              <p className="mt-1 text-sm text-slate-700">{certification.vehicleTitle} · Required docs: {certification.requiredDocumentKeys.join(", ")}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
            <div className="rounded-xl bg-white/80 p-3"><div className="text-lg font-black">{certification.lifecycleAudit.complete ? "Yes" : "No"}</div><div>Lifecycle</div></div>
            <div className="rounded-xl bg-white/80 p-3"><div className="text-lg font-black">{certification.signatureValidation.packetReady ? "Yes" : "No"}</div><div>Packet</div></div>
            <div className="rounded-xl bg-white/80 p-3"><div className="text-lg font-black">{certification.signatureValidation.archiveReady ? "Yes" : "No"}</div><div>Archive</div></div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.25fr]">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Vehicle Inputs</h2>
              <p className="text-xs text-muted-foreground">Required fields for the Connecticut rule engine.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="VIN"><input className={inputClass} value={input.vin} onChange={(e) => update("vin", e.target.value)} /></Field>
            <Field label="Stock Number"><input className={inputClass} value={input.stock} onChange={(e) => update("stock", e.target.value)} /></Field>
            <Field label="Year"><input className={inputClass} value={input.year} onChange={(e) => update("year", e.target.value)} /></Field>
            <Field label="Make"><input className={inputClass} value={input.make} onChange={(e) => update("make", e.target.value)} /></Field>
            <Field label="Model"><input className={inputClass} value={input.model} onChange={(e) => update("model", e.target.value)} /></Field>
            <Field label="Mileage"><input className={inputClass} value={input.mileage} onChange={(e) => update("mileage", e.target.value)} /></Field>
            <Field label="State"><input className={inputClass} value={input.state} onChange={(e) => update("state", e.target.value)} /></Field>
            <Field label="New / Used">
              <select className={selectClass} value={input.condition} onChange={(e) => update("condition", e.target.value as CtMvpVehicleInput["condition"])}>
                <option value="used">Used</option>
                <option value="new">New</option>
              </select>
            </Field>
            <Field label="CPO Status">
              <select className={selectClass} value={input.cpoStatus} onChange={(e) => update("cpoStatus", e.target.value as CtMvpVehicleInput["cpoStatus"])}>
                <option value="none">None</option>
                <option value="dealer">Dealer CPO</option>
                <option value="oem">OEM CPO</option>
              </select>
            </Field>
            <Field label="Passport">
              <select className={selectClass} value={input.passportEnabled ? "on" : "off"} onChange={(e) => update("passportEnabled", e.target.value === "on") }>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div>
                <h2 className="text-base font-semibold text-foreground">Rule Outputs</h2>
                <p className="text-xs text-muted-foreground">What AutoLabels would generate for this vehicle.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <OutputCard label="Selected Window Sticker" value={result.selectedWindowSticker} />
              <OutputCard label="Selected Addendum" value={result.selectedAddendum} />
              <OutputCard label="FTC Buyers Guide" value={result.ftcBuyersGuide === "required" ? "Required" : "Not required"} />
              <OutputCard label="K208" value={result.k208 === "required" ? "Required" : "Not required"} />
              <OutputCard label="Passport Status" value={result.passportStatus === "enabled" ? "Enabled" : "Disabled"} />
              <OutputCard label="Trust Source" value={result.trustSource} />
              <OutputCard label="Dealer Program" value={result.dealerProgram} />
              <OutputCard label="Theme" value={result.theme} />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="text-base font-semibold text-foreground">Certification Checklist</h2>
            <p className="mt-1 text-xs text-muted-foreground">This combines rules, lifecycle, signatures, packet readiness, and archive readiness.</p>
            <div className="mt-4 space-y-2">
              {certification.checks.map((item) => (
                <div key={item.key} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                  {item.status === "pass" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminSmokeTest;
