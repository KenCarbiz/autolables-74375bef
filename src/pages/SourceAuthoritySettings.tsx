import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { toast } from "sonner";
import { Loader2, ShieldAlert, Save, Info, Lock } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// SourceAuthoritySettings — decides which data source is
// authoritative per field when sources disagree. Config only —
// consumption (document-generation & discrepancy detection) is a
// separate step. Edit is gated on `manage_source_authority`.
// ──────────────────────────────────────────────────────────────

type ConflictBehavior = "warn" | "block_generation" | "ignore";

const SOURCES = [
  { value: "dms_feed",           label: "DMS feed" },
  { value: "autolabels_override", label: "AutoLabels override" },
  { value: "dealer_website",     label: "Dealer website" },
  { value: "csv_import",         label: "CSV import" },
  { value: "manual_entry",       label: "Manual entry" },
  { value: "vin_decoder_oem",    label: "VIN decoder / OEM" },
  { value: "marketcheck",        label: "MarketCheck" },
] as const;

const SOURCE_LABEL = Object.fromEntries(SOURCES.map((s) => [s.value, s.label]));

const FIELD_GROUPS: {
  group: string;
  fields: { key: string; label: string; blurb: string }[];
}[] = [
  { group: "Pricing", fields: [
    { key: "advertised_price", label: "Advertised price", blurb: "The price the shopper sees (site / marketplace)." },
    { key: "sale_price",       label: "Sale price",       blurb: "The transactional price used on documents." },
    { key: "msrp",             label: "MSRP",             blurb: "Manufacturer suggested retail price." },
  ]},
  { group: "Vehicle data", fields: [
    { key: "mileage",             label: "Mileage",             blurb: "Odometer reading of record." },
    { key: "stock_number",        label: "Stock number",        blurb: "Dealer stock identifier." },
    { key: "condition_new_used",  label: "Condition (new/used)", blurb: "New / used / CPO classification." },
    { key: "exterior_color",      label: "Exterior color",      blurb: "" },
    { key: "interior_color",      label: "Interior color",      blurb: "" },
    { key: "equipment",           label: "Equipment / options", blurb: "Factory-installed equipment list." },
    { key: "vehicle_location",    label: "Vehicle location",    blurb: "Rooftop / lot the vehicle is at." },
  ]},
  { group: "Disclosure inputs", fields: [
    { key: "certification_status",     label: "Certification status",     blurb: "CPO program participation." },
    { key: "warranty_status",          label: "Warranty status",          blurb: "Remaining coverage disclosed on documents." },
    { key: "vehicle_description",      label: "Vehicle description",      blurb: "Merchandising copy on the sticker / VDP." },
    { key: "dealer_installed_products", label: "Dealer-installed products", blurb: "Addendum items priced by the dealer." },
  ]},
];

// Sensible defaults when a tenant hasn't overridden a field. General
// fallback hierarchy: dms_feed > autolabels_override > dealer_website
// > csv_import > manual_entry.
const DEFAULTS: Record<string, { primary: string; secondary?: string }> = {
  advertised_price:          { primary: "dealer_website" },
  sale_price:                { primary: "dealer_website" },
  msrp:                      { primary: "vin_decoder_oem" },
  mileage:                   { primary: "dms_feed", secondary: "dealer_website" },
  certification_status:      { primary: "dms_feed" },
  warranty_status:           { primary: "autolabels_override" },
  stock_number:              { primary: "dms_feed" },
  condition_new_used:        { primary: "dms_feed" },
  vehicle_description:       { primary: "dealer_website" },
  dealer_installed_products: { primary: "autolabels_override" },
  exterior_color:            { primary: "dealer_website" },
  interior_color:            { primary: "dealer_website" },
  equipment:                 { primary: "vin_decoder_oem" },
  vehicle_location:          { primary: "dms_feed" },
};

const EXPIRY_OPTIONS = [
  { value: 0, label: "Never" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
] as const;

interface Rule {
  id?: string;
  tenant_id: string;
  field_key: string;
  primary_source: string;
  secondary_source: string | null;
  conflict_behavior: ConflictBehavior;
  override_expires_days: number | null;
  auto_replace_override: boolean;
  updated_at?: string;
}

const isDefault = (r: Rule): boolean => {
  const d = DEFAULTS[r.field_key];
  if (!d) return false;
  return r.primary_source === d.primary
    && (r.secondary_source || null) === (d.secondary || null)
    && r.conflict_behavior === "warn"
    && (r.override_expires_days == null || r.override_expires_days === 0)
    && r.auto_replace_override === false;
};

const buildDefault = (tenantId: string, fieldKey: string): Rule => ({
  tenant_id: tenantId, field_key: fieldKey,
  primary_source: DEFAULTS[fieldKey]?.primary || "dms_feed",
  secondary_source: DEFAULTS[fieldKey]?.secondary || null,
  conflict_behavior: "warn",
  override_expires_days: null,
  auto_replace_override: false,
});

export default function SourceAuthoritySettings() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const tenantId = tenant?.id || null;

  const canEdit = hasDealerCapability(member?.role, "manage_source_authority", isAdmin);

  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await (supabase as any).from("source_authority_rules")
      .select("*").eq("tenant_id", tenantId);
    const map: Record<string, Rule> = {};
    for (const g of FIELD_GROUPS) for (const f of g.fields) {
      const row = (data || []).find((r: Rule) => r.field_key === f.key);
      map[f.key] = row ? { ...row } : buildDefault(tenantId, f.key);
    }
    setRules(map);
    setDirty(new Set());
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const patchRule = (key: string, patch: Partial<Rule>) => {
    if (!canEdit) return;
    setRules((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    setDirty((prev) => new Set(prev).add(key));
  };

  const save = async () => {
    if (!tenantId || !canEdit || dirty.size === 0) return;
    setSaving(true);
    const payload = Array.from(dirty).map((k) => {
      const r = rules[k];
      return {
        tenant_id: tenantId,
        field_key: r.field_key,
        primary_source: r.primary_source,
        secondary_source: r.secondary_source,
        conflict_behavior: r.conflict_behavior,
        override_expires_days: r.override_expires_days,
        auto_replace_override: r.auto_replace_override,
      };
    });
    const { error } = await (supabase as any).from("source_authority_rules")
      .upsert(payload, { onConflict: "tenant_id,field_key" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Saved ${dirty.size} rule${dirty.size === 1 ? "" : "s"}`);
    load();
  };

  const dirtyCount = dirty.size;

  if (!tenantId) return null;

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-5">
      {/* ── Header ─────────────────────────────────────────── */}
      <div>
        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <ShieldAlert className="w-3 h-3" /> High-risk setting
        </div>
        <h1 className="mt-1 text-2xl font-display font-semibold tracking-tight text-foreground">
          Source Authority
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          These rules decide which data source is authoritative for each field when sources disagree. The authoritative source is used for documents; other sources are used to detect discrepancies.
        </p>
        <p className="text-[11px] text-muted-foreground mt-2 max-w-3xl italic">
          AutoLabels supports compliance operations; dealerships must review federal, state, and local requirements with qualified legal counsel.
        </p>
      </div>

      {!canEdit && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2 text-sm text-amber-800">
          <Lock className="w-4 h-4 mt-0.5" />
          <div>
            <div className="font-semibold">Read-only view</div>
            Only Dealer Principal, General Manager, Compliance Administrator, or platform admins can edit source authority.
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading rules…
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 flex items-start gap-2 text-xs text-sky-800">
            <Info className="w-4 h-4 mt-0.5" />
            <div>
              Default fallback hierarchy when no rule is set:
              <span className="ml-1 font-semibold">DMS feed → AutoLabels override → Dealer website → CSV import → Manual entry.</span>
            </div>
          </div>

          {FIELD_GROUPS.map((group) => (
            <section key={group.group} className="rounded-2xl border border-border bg-card overflow-hidden">
              <header className="px-5 py-3 border-b border-border bg-muted/30 sticky top-0 z-10">
                <h2 className="font-display text-base font-bold tracking-tight text-foreground">{group.group}</h2>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/20">
                    <tr>
                      <th className="text-left px-4 py-2 min-w-[220px]">Field</th>
                      <th className="text-left px-3 py-2">Primary source</th>
                      <th className="text-left px-3 py-2">Secondary</th>
                      <th className="text-left px-3 py-2">On conflict</th>
                      <th className="text-left px-3 py-2">Override expiry</th>
                      <th className="text-left px-3 py-2 pr-5">Auto-replace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.fields.map((f) => {
                      const r = rules[f.key];
                      if (!r) return null;
                      const usingDefault = !r.id && isDefault(r);
                      const isDirty = dirty.has(f.key);
                      return (
                        <tr key={f.key} className="border-t border-border align-top">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{f.label}</span>
                              {usingDefault && <DefaultChip />}
                              {isDirty && <DirtyChip />}
                            </div>
                            {f.blurb && <div className="text-[11px] text-muted-foreground mt-0.5">{f.blurb}</div>}
                          </td>
                          <td className="px-3 py-3">
                            <SourceSelect value={r.primary_source} disabled={!canEdit}
                              onChange={(v) => patchRule(f.key, { primary_source: v })} />
                          </td>
                          <td className="px-3 py-3">
                            <SourceSelect value={r.secondary_source || ""} disabled={!canEdit} nullable
                              onChange={(v) => patchRule(f.key, { secondary_source: v || null })} />
                          </td>
                          <td className="px-3 py-3">
                            <select value={r.conflict_behavior} disabled={!canEdit}
                              onChange={(e) => patchRule(f.key, { conflict_behavior: e.target.value as ConflictBehavior })}
                              className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-60">
                              <option value="warn">Warn</option>
                              <option value="block_generation">Block document generation</option>
                              <option value="ignore">Ignore</option>
                            </select>
                          </td>
                          <td className="px-3 py-3">
                            <select value={r.override_expires_days ?? 0} disabled={!canEdit}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                patchRule(f.key, { override_expires_days: v === 0 ? null : v });
                              }}
                              className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-60">
                              {EXPIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-3 pr-5">
                            <label className="inline-flex items-center gap-2 text-xs">
                              <input type="checkbox" disabled={!canEdit}
                                checked={r.auto_replace_override}
                                onChange={(e) => patchRule(f.key, { auto_replace_override: e.target.checked })}
                                className="h-4 w-4 rounded border-border disabled:opacity-60" />
                              <span className="text-muted-foreground">Auto-replace</span>
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {canEdit && (
            <div className="sticky bottom-4 z-20 flex justify-end">
              <div className="rounded-full shadow-lg bg-background border border-border px-3 py-2 flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {dirtyCount === 0 ? "No unsaved changes" : `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}`}
                </span>
                <button onClick={save} disabled={saving || dirtyCount === 0}
                  className="h-9 px-4 rounded-full bg-[#F97316] hover:bg-[#EA6A0C] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save changes
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const SourceSelect = ({ value, onChange, disabled, nullable }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; nullable?: boolean;
}) => (
  <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
    className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-60">
    {nullable && <option value="">— None —</option>}
    {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
  </select>
);

const DefaultChip = () => (
  <span className="inline-flex items-center h-5 px-2 rounded-full bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border">
    Default
  </span>
);
const DirtyChip = () => (
  <span className="inline-flex items-center h-5 px-2 rounded-full bg-amber-500/15 text-[10px] font-bold uppercase tracking-wider text-amber-800 border border-amber-500/30">
    Unsaved
  </span>
);

// Referenced to appease lint on the potentially unused label map.
export const __SOURCE_LABEL = SOURCE_LABEL;
