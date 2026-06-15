import { useMemo, useState, useEffect } from "react";
import { useAdminPlatform, type TenantSummary } from "@/hooks/useAdminPlatform";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Building2, Search, Power, PowerOff, Calendar, Users, AppWindow, Plus, X, Pencil } from "lucide-react";
import { SortHeader, TablePagination, useSortAndPaginate, toCsv, downloadCsv, useTableDensity, DensityToggle } from "./tablePrimitives";
import { TableEmptyState } from "./TableEmptyState";

const formatDate = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

const sourceBadge = (source: TenantSummary["source"]) => {
  const colors: Record<TenantSummary["source"], string> = {
    autocurb: "bg-violet-100 text-violet-700",
    autolabels: "bg-blue-100 text-blue-700",
    manual: "bg-slate-100 text-slate-700",
  };
  return colors[source] || colors.manual;
};

export const PlatformTenants = () => {
  const { tenants, setTenantActive, createTenant } = useAdminPlatform();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TenantSummary | null>(null);

  const rows = useMemo(() => {
    const all = tenants.data || [];
    const lc = q.trim().toLowerCase();
    return all
      .filter((t) => (filter === "all" ? true : filter === "active" ? t.is_active : !t.is_active))
      .filter((t) => {
        if (!lc) return true;
        return (
          t.name.toLowerCase().includes(lc) ||
          t.slug.toLowerCase().includes(lc) ||
          (t.domain || "").toLowerCase().includes(lc)
        );
      });
  }, [tenants.data, q, filter]);

  const toggle = async (t: TenantSummary) => {
    const ok = await setTenantActive(t.id, !t.is_active);
    if (ok) toast.success(`${t.name} ${t.is_active ? "suspended" : "reactivated"}`);
    else toast.error("Action failed");
  };

  const sortPag = useSortAndPaginate<TenantSummary>(rows, {
    defaultSortKey: "name",
    defaultSortDir: "asc",
    defaultPageSize: 50,
    getSortValue: (row, key) => {
      if (key === "status") return row.is_active ? 1 : 0;
      return (row as unknown as Record<string, unknown>)[key];
    },
  });

  const { density, setDensity, rowClass } = useTableDensity();

  const handleExport = () => {
    const csv = toCsv<TenantSummary>(sortPag.sorted, [
      { header: "Dealer",        get: r => r.name },
      { header: "Slug",          get: r => r.slug },
      { header: "Domain",        get: r => r.domain || "" },
      { header: "Source",        get: r => r.source },
      { header: "Active apps",   get: r => r.active_apps },
      { header: "App slugs",     get: r => r.app_slugs.join("; ") },
      { header: "Members",       get: r => r.member_count },
      { header: "Created",       get: r => r.created_at },
      { header: "Last activity", get: r => r.last_activity || "" },
      { header: "Status",        get: r => r.is_active ? "active" : "suspended" },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`platform-tenants-${stamp}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Tenants</h2>
            <p className="text-[11px] text-muted-foreground">
              {tenants.data?.length ?? 0} total · {rows.length} visible
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            New Tenant
          </button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, slug, domain…"
              className="h-9 pl-7 pr-3 rounded-md border border-border bg-background text-sm w-64"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="h-9 px-2 rounded-md border border-border bg-background text-sm"
          >
            <option value="all">All</option>
            <option value="active">Active only</option>
            <option value="inactive">Suspended only</option>
          </select>
          <DensityToggle density={density} setDensity={setDensity} />
        </div>
      </div>

      {creating && (
        <CreateTenantForm
          onClose={() => setCreating(false)}
          onCreate={async (form) => {
            const id = await createTenant(form);
            if (id) {
              toast.success(`Tenant "${form.name}" created. Invite sent to ${form.ownerEmail}.`);
              setCreating(false);
            } else {
              toast.error("Tenant create failed. See console.");
            }
          }}
        />
      )}

      {editing && (
        <TenantDetailsDrawer
          tenant={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast.success("Dealership details saved"); }}
        />
      )}

      {tenants.isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading tenants…</div>
      ) : rows.length === 0 ? (
        <TableEmptyState
          icon={Building2}
          title={q || filter !== "all" ? "No tenants match these filters" : "No tenants yet"}
          description={
            q || filter !== "all"
              ? "Try clearing the search or filter. New sign-ups appear here automatically."
              : "Dealers signing up through Autocurb or AutoLabels appear here automatically. You can also seed one manually."
          }
          ctaLabel={q || filter !== "all" ? undefined : "New tenant"}
          onCta={q || filter !== "all" ? undefined : () => setCreating(true)}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <SortHeader label="Dealer"        sortKey="name"          activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Source"        sortKey="source"        activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Apps"          sortKey="active_apps"   activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Members"       sortKey="member_count"  activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Created"       sortKey="created_at"    activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Last activity" sortKey="last_activity" activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Status"        sortKey="status"        activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortPag.paginated.map((t) => (
                <tr key={t.id} className={t.is_active ? "" : "opacity-60"}>
                  <td className={rowClass}>
                    <div className="font-semibold text-foreground">{t.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {t.slug}
                      {t.domain ? ` · ${t.domain}` : ""}
                    </div>
                  </td>
                  <td className={rowClass}>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${sourceBadge(t.source)}`}>
                      {t.source}
                    </span>
                  </td>
                  <td className={rowClass}>
                    <div className="flex items-center gap-1.5">
                      <AppWindow className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-semibold">{t.active_apps}</span>
                      {t.app_slugs.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          ({t.app_slugs.join(", ")})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={rowClass}>
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-semibold">{t.member_count}</span>
                    </div>
                  </td>
                  <td className={rowClass}>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(t.created_at)}
                    </div>
                  </td>
                  <td className={`${rowClass} text-muted-foreground`}>
                    {formatDate(t.last_activity)}
                  </td>
                  <td className={`${rowClass} text-right`}>
                    <div className="inline-flex items-center gap-1 justify-end">
                      <button
                        onClick={() => setEditing(t)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 h-7 rounded-md text-foreground hover:bg-muted"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                      <button
                        onClick={() => toggle(t)}
                        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 h-7 rounded-md ${
                          t.is_active
                            ? "text-destructive hover:bg-destructive/10"
                            : "text-emerald-600 hover:bg-emerald-50"
                        }`}
                      >
                        {t.is_active ? <PowerOff className="w-3 h-3" /> : <Power className="w-3 h-3" />}
                        {t.is_active ? "Suspend" : "Reactivate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination
            page={sortPag.page}
            totalPages={sortPag.totalPages}
            pageSize={sortPag.pageSize}
            totalCount={sortPag.totalCount}
            visibleCount={sortPag.paginated.length}
            setPage={sortPag.setPage}
            setPageSize={sortPag.setPageSize}
            onExportCsv={handleExport}
            exportLabel="Export CSV"
          />
        </div>
      )}
    </div>
  );
};

interface CreateFormProps {
  onClose: () => void;
  onCreate: (form: {
    name: string;
    slug?: string;
    domain?: string;
    ownerEmail: string;
    appSlug?: string;
    planTier?: string;
    trialDays?: number;
  }) => Promise<void>;
}

const CreateTenantForm = ({ onClose, onCreate }: CreateFormProps) => {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [domain, setDomain] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [appSlug, setAppSlug] = useState("autolabels");
  const [planTier, setPlanTier] = useState("essential");
  const [trialDays, setTrialDays] = useState(14);
  const [submitting, setSubmitting] = useState(false);

  const autoSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!ownerEmail.includes("@")) return;
    setSubmitting(true);
    await onCreate({
      name: name.trim(),
      slug: autoSlug || undefined,
      domain: domain.trim() || undefined,
      ownerEmail: ownerEmail.trim(),
      appSlug,
      planTier,
      trialDays,
    });
    setSubmitting(false);
  };

  return (
    <form onSubmit={submit} className="rounded-xl border-2 border-primary bg-card p-4 shadow-lg space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Create a new tenant</h3>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Sets up the dealership row, shared profile, trial entitlement, and an owner
        invitation tied to the email below. When the owner signs up (or signs in, if
        they already have a Supabase account), they'll be auto-linked.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Dealership name *" value={name} onChange={setName} placeholder="Freeman Ford" />
        <Field label="Slug" value={autoSlug} onChange={setSlug} placeholder="freeman-ford" mono />
        <Field label="Domain" value={domain} onChange={setDomain} placeholder="freemanford.com" />
        <Field label="Owner email *" value={ownerEmail} onChange={setOwnerEmail} placeholder="owner@freemanford.com" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Select label="App" value={appSlug} onChange={setAppSlug} options={["autolabels", "autocurb", "autoframe", "autovideo"]} />
        <Select label="Plan tier" value={planTier} onChange={setPlanTier} options={["starter", "essential", "professional", "unlimited", "enterprise"]} />
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-label">
            Trial length
          </label>
          <select
            value={trialDays}
            onChange={(e) => setTrialDays(parseInt(e.target.value, 10))}
            className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
          >
            <option value={0}>Active immediately (no trial)</option>
            <option value={7}>7-day trial</option>
            <option value={14}>14-day trial</option>
            <option value={30}>30-day trial</option>
            <option value={90}>90-day trial</option>
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="h-9 px-3 rounded-md text-sm text-muted-foreground">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !name.trim() || !ownerEmail.includes("@")}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create tenant"}
        </button>
      </div>
    </form>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}

const Field = ({ label, value, onChange, placeholder, mono }: FieldProps) => (
  <div>
    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-label">
      {label}
    </label>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm ${
        mono ? "font-mono" : ""
      }`}
    />
  </div>
);

interface SelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}

const Select = ({ label, value, onChange, options }: SelectProps) => (
  <div>
    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-label">
      {label}
    </label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  </div>
);

// Dealer legal + contact profile, editable per tenant by a platform admin.
// Writes to dealer_profiles.settings (the same blob the dealer edits in
// Admin > Branding), so there's one source of truth. The legal fields here
// drive the addendum/Buyers Guide seller identity and the state engine.
const LEGAL_FIELDS: { key: string; label: string; placeholder?: string; required?: boolean }[] = [
  { key: "dealer_name", label: "Legal / business name", required: true },
  { key: "dealer_address", label: "Street address", required: true },
  { key: "dealer_city", label: "City" },
  { key: "dealer_state", label: "Operating state (2-letter)", placeholder: "CT", required: true },
  { key: "dealer_zip", label: "ZIP" },
  { key: "dealer_phone", label: "Phone" },
  { key: "dealer_principal", label: "Dealer principal / owner" },
  { key: "dealer_license_number", label: "DMV dealer license / ID #", required: true },
  { key: "dealer_oem_brands", label: "Franchised OEM brands", placeholder: "e.g. Ford, Lincoln" },
];

const TenantDetailsDrawer = ({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: TenantSummary;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("dealer_profiles").select("settings").eq("tenant_id", tenant.id).maybeSingle();
      if (!active) return;
      const s = (data?.settings as Record<string, string>) || {};
      const next: Record<string, string> = {};
      LEGAL_FIELDS.forEach((f) => { next[f.key] = (s[f.key] as string) || ""; });
      if (!next.dealer_name) next.dealer_name = tenant.name || "";
      setForm(next);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [tenant.id, tenant.name]);

  const required = LEGAL_FIELDS.filter((f) => f.required);
  const doneCount = required.filter((f) => (form[f.key] || "").trim()).length;
  const pct = required.length ? Math.round((doneCount / required.length) * 100) : 100;

  const save = async () => {
    setSaving(true);
    // Merge into the existing settings blob so we never drop other keys.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase as any).from("dealer_profiles").select("settings").eq("tenant_id", tenant.id).maybeSingle();
    const merged = { ...((existing?.settings as Record<string, unknown>) || {}) };
    LEGAL_FIELDS.forEach((f) => { merged[f.key] = (form[f.key] || "").trim(); });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("dealer_profiles").upsert({ tenant_id: tenant.id, settings: merged }, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-end" onClick={onClose}>
      <div className="h-full w-full max-w-md bg-card border-l border-border shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 className="text-sm font-bold text-foreground">Dealership details</h3>
            <p className="text-[11px] text-muted-foreground">{tenant.name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className={`mx-4 mt-4 rounded-lg border-2 p-3 ${pct === 100 ? "border-emerald-500 bg-emerald-50" : "border-amber-300 bg-amber-50/60"}`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">Compliance profile</p>
            <span className={`text-lg font-bold tabular-nums ${pct === 100 ? "text-emerald-600" : "text-amber-600"}`}>{pct}%</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Legal name, address, operating state, and DMV license are required for compliant documents.</p>
        </div>

        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="p-4 space-y-3">
            {LEGAL_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-[11px] font-semibold text-muted-foreground">
                  {f.label}{f.required && <span className="text-destructive"> *</span>}
                </label>
                <input
                  value={form[f.key] || ""}
                  placeholder={f.placeholder}
                  maxLength={f.key === "dealer_state" ? 2 : undefined}
                  onChange={(e) => {
                    const v = f.key === "dealer_state" ? e.target.value.toUpperCase() : e.target.value;
                    setForm((prev) => ({ ...prev, [f.key]: v }));
                  }}
                  className={`mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm ${f.key === "dealer_state" ? "uppercase" : ""}`}
                />
              </div>
            ))}
          </div>
        )}

        <div className="sticky bottom-0 flex gap-2 p-4 border-t border-border bg-card">
          <button onClick={onClose} className="flex-1 h-9 rounded-md bg-muted text-foreground text-sm font-semibold">Cancel</button>
          <button onClick={save} disabled={saving || loading} className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
            {saving ? "Saving…" : "Save details"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlatformTenants;
