import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDescriptionPermissions } from "@/hooks/useDescriptionOps";
import { CHANNEL_META, connectorLabel, TONE_CLASS } from "@/lib/description/model";
import { toast } from "sonner";
import { Loader2, Save, ShieldAlert, Sparkles } from "lucide-react";

// Settings → Merchandising & SEO. The dealer answers these questions ONCE;
// they are never re-asked per vehicle. Changing anything material here bumps
// the configuration fingerprint server-side, which is what makes existing
// descriptions eligible for regeneration — it never silently rewrites a
// manually edited description.

const REVIEW_MODES = [
  { key: "AUTO_PUBLISH_CLEAN", label: "Full automation", help: "Publish automatically whenever every check passes." },
  { key: "EXCEPTION_REVIEW", label: "Exception review (recommended)", help: "Publish clean vehicles; hold anything with a warning or conflict." },
  { key: "REQUIRE_APPROVAL_ALL", label: "Approval required", help: "Generate and validate, but a manager approves every vehicle." },
  { key: "DRAFT_ONLY", label: "Draft only", help: "Generate and validate; never publish automatically." },
];

const CLASSES = [
  { key: "new", label: "New" }, { key: "used", label: "Used" },
  { key: "cpo", label: "CPO" }, { key: "demo", label: "Demo / loaner" },
];

// deno-lint-ignore-file no-explicit-any
type Settings = Record<string, any>;

export default function MerchandisingSeoPanel() {
  const { tenant } = useTenant();
  const perms = useDescriptionPermissions();
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!tenant?.id) return;
      const { data } = await (supabase as any).from("description_settings")
        .select("*").eq("tenant_id", tenant.id).maybeSingle();
      setS(data || {
        tenant_id: tenant.id, review_mode: "EXCEPTION_REVIEW", review_mode_by_class: {},
        enabled_channels: CHANNEL_META.map((c) => c.key), internal_publication_enabled: true,
        default_tone: "professional", min_length: 400, max_length: 2400,
        prohibited_phrases: [], class_rules: {}, warranty_language_allowed: false,
        cpo_language_allowed: false, accessory_language_allowed: false,
        market_context_allowed: false, price_in_description: false, quality_threshold: 70,
      });
    })();
  }, [tenant?.id]);

  const set = (k: string, v: unknown) => setS((cur) => (cur ? { ...cur, [k]: v } : cur));

  const save = async () => {
    if (!s || !tenant?.id) return;
    setSaving(true);
    const { error } = await (supabase as any).from("description_settings")
      .upsert({ ...s, tenant_id: tenant.id }, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) { toast.error("Could not save settings"); return; }
    toast.success("Merchandising & SEO settings saved");
  };

  if (!s) return <div className="h-64 rounded-2xl border border-border bg-card animate-pulse" />;

  if (!perms.canConfigure) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <ShieldAlert className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-semibold text-foreground">You do not have permission to change these settings.</p>
        <p className="text-xs text-muted-foreground mt-1">Managing merchandising configuration requires the settings permission.</p>
      </div>
    );
  }

  const Field = ({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) => (
    <label className="block">
      <span className="text-[12px] font-bold text-foreground">{label}</span>
      {help && <span className="block text-[11px] text-muted-foreground mb-1">{help}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
  const input = "w-full h-10 rounded-lg border border-border bg-background px-3 text-sm";
  const Toggle = ({ k, label, help }: { k: string; label: string; help: string }) => (
    <label className="flex items-start gap-2.5 rounded-xl border border-border p-3 cursor-pointer">
      <input type="checkbox" checked={!!s[k]} onChange={(e) => set(k, e.target.checked)} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-foreground">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{help}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-4 max-w-[900px]">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-[15px] font-bold text-foreground inline-flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-500" /> Automation mode
        </h2>
        <p className="text-[12px] text-muted-foreground mt-0.5 mb-3">How much AutoLabels does before a person is involved.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {REVIEW_MODES.map((m) => (
            <label key={m.key} className={`rounded-xl border p-3 cursor-pointer transition-colors ${s.review_mode === m.key ? "border-primary bg-primary/[0.04]" : "border-border"}`}>
              <input type="radio" name="review_mode" className="sr-only"
                checked={s.review_mode === m.key} onChange={() => set("review_mode", m.key)} />
              <span className="block text-[12.5px] font-semibold text-foreground">{m.label}</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5">{m.help}</span>
            </label>
          ))}
        </div>

        <p className="text-[12px] font-bold text-foreground mt-4 mb-1.5">Override by inventory type</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CLASSES.map((c) => (
            <label key={c.key} className="block">
              <span className="text-[11px] text-muted-foreground">{c.label}</span>
              <select
                value={(s.review_mode_by_class || {})[c.key] || ""}
                onChange={(e) => set("review_mode_by_class", { ...(s.review_mode_by_class || {}), [c.key]: e.target.value || undefined })}
                className="w-full h-9 rounded-lg border border-border bg-background px-2 text-[12px] mt-0.5">
                <option value="">Use default</option>
                {REVIEW_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-[15px] font-bold text-foreground">Destinations</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5 mb-3">
          AutoLabels publishes only to internal destinations. Marketplace copy is generated for export until a connector exists.
        </p>
        <div className="space-y-1.5">
          {CHANNEL_META.map((c) => {
            const conn = connectorLabel(c);
            const on = (s.enabled_channels || []).includes(c.key);
            return (
              <label key={c.key} className="flex items-center gap-2.5 rounded-xl border border-border p-2.5 cursor-pointer">
                <input type="checkbox" checked={on}
                  onChange={(e) => set("enabled_channels", e.target.checked
                    ? [...(s.enabled_channels || []), c.key]
                    : (s.enabled_channels || []).filter((k: string) => k !== c.key))} />
                <span className="text-[12.5px] font-semibold text-foreground flex-1">{c.label}</span>
                <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full border ${TONE_CLASS[conn.tone]}`}>{conn.label}</span>
              </label>
            );
          })}
        </div>
        <div className="mt-3">
          <Toggle k="internal_publication_enabled" label="Allow internal publication"
            help="When off, nothing is ever written to the shopper listing automatically." />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-[15px] font-bold text-foreground">Voice & identity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Dealership name (as written)"><input className={input} value={s.dealer_name_format || ""} onChange={(e) => set("dealer_name_format", e.target.value)} /></Field>
          <Field label="Default tone"><input className={input} value={s.default_tone || ""} onChange={(e) => set("default_tone", e.target.value)} /></Field>
          <Field label="Primary city"><input className={input} value={s.primary_city || ""} onChange={(e) => set("primary_city", e.target.value)} /></Field>
          <Field label="State"><input className={input} value={s.state || ""} onChange={(e) => set("state", e.target.value)} /></Field>
        </div>
        <Field label="Brand voice"><textarea rows={2} className="w-full rounded-lg border border-border bg-background p-2.5 text-sm" value={s.brand_voice || ""} onChange={(e) => set("brand_voice", e.target.value)} /></Field>
        <Field label="Call to action" help="Appended to every description."><input className={input} value={s.cta_template || ""} onChange={(e) => set("cta_template", e.target.value)} /></Field>
        <Field label="Required legal wording" help="Included verbatim; a missing disclosure blocks publication.">
          <input className={input} value={s.required_legal_text || ""} onChange={(e) => set("required_legal_text", e.target.value)} />
        </Field>
        <Field label="Prohibited phrases" help="Comma separated. Any match blocks publication.">
          <input className={input} value={(s.prohibited_phrases || []).join(", ")}
            onChange={(e) => set("prohibited_phrases", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum length"><input type="number" className={input} value={s.min_length ?? 400} onChange={(e) => set("min_length", Number(e.target.value))} /></Field>
          <Field label="Maximum length"><input type="number" className={input} value={s.max_length ?? 2400} onChange={(e) => set("max_length", Number(e.target.value))} /></Field>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-[15px] font-bold text-foreground">Claim permissions</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5 mb-3">
          Each of these stays off until the dealership confirms it can support the claim. Verified source data is still required — these switches only grant permission, never truth.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Toggle k="cpo_language_allowed" label="Allow CPO language" help="Only when an approved CPO source confirms the program." />
          <Toggle k="warranty_language_allowed" label="Allow warranty language" help="Only with verified remaining coverage." />
          <Toggle k="accessory_language_allowed" label="Allow accessory language" help="Only accessories with verified installation proof." />
          <Toggle k="price_in_description" label="Allow price in description" help="Adds the governed advertised price to the copy." />
          <Toggle k="market_context_allowed" label="Allow market context wording"
            help="Permits market analysis to shape emphasis. It is never stated as a verified vehicle fact." />
        </div>
      </div>

      <div className="sticky bottom-4">
        <button onClick={save} disabled={saving}
          className="w-full sm:w-auto h-11 px-5 rounded-xl bg-primary text-primary-foreground text-[13.5px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save settings
        </button>
      </div>
    </div>
  );
}
