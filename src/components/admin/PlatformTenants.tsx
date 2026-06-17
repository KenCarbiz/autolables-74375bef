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
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
            title="Search Autocurb and import a dealer"
          >
            <Building2 className="w-3.5 h-3.5" />
            Import from Autocurb
          </button>
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
            try {
              const id = await createTenant(form);
              if (!id) { toast.error("Tenant create failed — no id returned."); return; }
              // Persist the Autocurb mirror (sync key + full profile) on the
              // new tenant, separate from the create RPC.
              if (form.autocurbId && form.autocurbProfile) {
                await (supabase as any).rpc("admin_link_autocurb", {
                  p_tenant_id: id,
                  p_autocurb_id: form.autocurbId,
                  p_profile: form.autocurbProfile,
                });
              }
              toast.success(`Tenant "${form.name}" created. Invite sent to ${form.ownerEmail}.`);
              setCreating(false);
            } catch (e) {
              toast.error(`Create failed: ${e instanceof Error ? e.message : "unknown error"}`);
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
    autocurbId?: string;
    autocurbProfile?: Record<string, unknown>;
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
  // Autocurb import
  const [acQuery, setAcQuery] = useState("");
  const [acHits, setAcHits] = useState<{ autocurb_tenant_id: string; name: string; domain?: string; primary_email?: string; city?: string; state?: string }[]>([]);
  const [acBusy, setAcBusy] = useState(false);
  // Full mirrored profile + sync key from /by-id, persisted after create.
  const [acProfile, setAcProfile] = useState<Record<string, unknown> | null>(null);
  const [acId, setAcId] = useState<string>("");

  const searchAutocurb = async (q: string) => {
    setAcQuery(q);
    if (q.trim().length < 2) { setAcHits([]); return; }
    setAcBusy(true);
    const { data, error } = await supabase.functions.invoke("autocurb-dealer-lookup", { body: { action: "search", q: q.trim() } });
    setAcBusy(false);
    if (error) { toast.error("Autocurb lookup unavailable — deploy the autocurb-dealer-lookup function and set its secrets."); setAcHits([]); return; }
    const res = (data as { result?: typeof acHits; error?: string } | null);
    if (res?.error) { toast.error(res.error === "not_configured" ? "Set AUTOCURB_API_BASE + AUTOCURB_API_TOKEN to import." : `Autocurb: ${res.error}`); setAcHits([]); return; }
    setAcHits(Array.isArray(res?.result) ? res!.result! : []);
    if (!res?.result?.length) toast.message("No matching active Autocurb dealers.");
  };

  const importDealer = async (id: string) => {
    setAcBusy(true);
    const { data } = await supabase.functions.invoke("autocurb-dealer-lookup", { body: { action: "by-id", id } });
    setAcBusy(false);
    const p = (data as { result?: Record<string, string>; error?: string } | null);
    if (p?.error || !p?.result) { toast.error("Could not load that dealer from Autocurb."); return; }
    const r = p.result;
    setName(r.name || r.display_name || "");
    setDomain(r.domain || "");
    setOwnerEmail(r.primary_email || "");
    if (r.name) setSlug(String(r.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
    if (r.bundle_tier === "base" || r.bundle_tier === "pro") setPlanTier(r.bundle_tier);
    setAcProfile(r as Record<string, unknown>);
    setAcId(String(r.autocurb_tenant_id || id));
    setAcHits([]); setAcQuery(r.name || "");
    toast.success("Imported from Autocurb — review and create.");
  };

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
      autocurbId: acId || undefined,
      autocurbProfile: acProfile || undefined,
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
      {/* Look up & import from Autocurb */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:bg-blue-950/30 dark:border-blue-900 p-3">
        <label className="text-[10px] font-bold uppercase tracking-label text-blue-700 dark:text-blue-300">Look up &amp; import from Autocurb</label>
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={acQuery} onChange={(e) => searchAutocurb(e.target.value)} placeholder="Search Autocurb by name, domain, or owner email…" className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-background text-sm outline-none" />
          {acHits.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-lg overflow-hidden max-h-64 overflow-y-auto">
              {acHits.map((h) => (
                <button key={h.autocurb_tenant_id} type="button" onClick={() => importDealer(h.autocurb_tenant_id)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
                  <span className="font-semibold text-foreground">{h.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{[h.primary_email, [h.city, h.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">{acBusy ? "Searching Autocurb…" : "Pick a dealer to auto-fill the form below, or fill it in manually."}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Dealership name *" value={name} onChange={setName} placeholder="Freeman Ford" />
        <Field label="Slug" value={autoSlug} onChange={setSlug} placeholder="freeman-ford" mono />
        <Field label="Domain" value={domain} onChange={setDomain} placeholder="freemanford.com" />
        <Field label="Owner email *" value={ownerEmail} onChange={setOwnerEmail} placeholder="owner@freemanford.com" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Select label="App" value={appSlug} onChange={setAppSlug} options={["autolabels", "autocurb", "autoframe", "autovideo"]} />
        <Select label="Plan tier" value={planTier} onChange={setPlanTier} options={["base", "pro", "starter", "essential", "professional", "unlimited", "enterprise"]} />
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

// First non-empty stringy value among candidates. Autocurb's dealers-api has
// shifted field names over time (address vs address_line1, zip vs postal_code,
// license at the profile vs branding vs store level), so we probe several.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pickStr = (...vals: any[]): string => {
  for (const v of vals) {
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brandsToStr = (...vals: any[]): string => {
  for (const v of vals) {
    if (Array.isArray(v) && v.length) return v.join(", ");
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
};

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [mirror, setMirror] = useState<{ id: string | null; profile: Record<string, any> | null; synced_at: string | null; source: string } | null>(null);
  const [resyncing, setResyncing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("dealer_profiles").select("settings").eq("tenant_id", tenant.id).maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: trow } = await (supabase as any).from("tenants").select("autocurb_tenant_id, autocurb_profile, autocurb_synced_at, source").eq("id", tenant.id).maybeSingle();
      if (!active) return;
      if (trow) setMirror({ id: trow.autocurb_tenant_id, profile: trow.autocurb_profile, synced_at: trow.autocurb_synced_at, source: trow.source });
      const s = (data?.settings as Record<string, string>) || {};
      const next: Record<string, string> = {};
      LEGAL_FIELDS.forEach((f) => { next[f.key] = (s[f.key] as string) || ""; });
      if (!next.dealer_name) next.dealer_name = tenant.name || "";
      // Prefill the editable compliance fields from the Autocurb mirror when
      // empty (a manually-saved value always wins). Lets the operator review
      // and Save Autocurb's data onto the dealer profile in one step.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prof = (trow?.autocurb_profile || {}) as Record<string, any>;
      if (prof && Object.keys(prof).length) {
        const b = (prof.branding || {}) as Record<string, any>;
        const st = (Array.isArray(prof.stores) && prof.stores[0] ? prof.stores[0] : {}) as Record<string, any>;
        const fromAc: Record<string, string> = {
          dealer_name: pickStr(prof.legal_entity_name, prof.name),
          dealer_address: pickStr(prof.address, prof.address_line1, prof.street, prof.street_address, st.address, st.address_line1, st.street, st.street_address),
          dealer_city: pickStr(st.city, prof.city),
          dealer_state: pickStr(prof.governing_law_state, st.state, prof.state),
          dealer_zip: pickStr(st.zip, st.postal_code, st.zip_code, prof.zip, prof.postal_code, prof.zip_code),
          dealer_phone: pickStr(prof.phone, st.phone),
          dealer_principal: pickStr(prof.dealer_principal, prof.principal, prof.owner_name, b.dealer_principal),
          dealer_license_number: pickStr(b.dealer_license_number, prof.dealer_license_number, prof.license_number, prof.dealer_license, st.dealer_license_number, st.license_number),
          dealer_oem_brands: brandsToStr(st.oem_brands, st.brands, st.makes, prof.oem_brands, prof.brands),
        };
        Object.entries(fromAc).forEach(([k, v]) => { if (!next[k] && v) next[k] = String(v); });
      }
      setForm(next);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [tenant.id, tenant.name]);

  const resync = async () => {
    if (!mirror?.id) return;
    setResyncing(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).functions.invoke("autocurb-dealer-lookup", { body: { action: "by-id", id: mirror.id } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = data as { result?: Record<string, any>; error?: string } | null;
    if (error || p?.error || !p?.result) { toast.error("Re-sync failed — check the Autocurb connection."); setResyncing(false); return; }
    await (supabase as any).rpc("admin_link_autocurb", { p_tenant_id: tenant.id, p_autocurb_id: mirror.id, p_profile: p.result });
    setMirror((m) => m ? { ...m, profile: p.result!, synced_at: new Date().toISOString() } : m);
    setResyncing(false);
    toast.success("Re-synced from Autocurb.");
  };

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

        {mirror?.source === "autocurb" && mirror.profile && (() => {
          const p = mirror.profile;
          const b = (p.branding || {}) as Record<string, any>;
          const stores = Array.isArray(p.stores) ? p.stores : [];
          const st = (stores[0] || {}) as Record<string, any>;
          const rows: [string, string][] = [
            ["Legal name", pickStr(p.legal_entity_name, p.name)],
            ["Domain", pickStr(p.domain)],
            ["Owner email", pickStr(p.primary_email)],
            ["Phone", pickStr(p.phone, st.phone)],
            ["Address", pickStr(p.address, p.address_line1, p.street, st.address, st.address_line1, st.street)],
            ["ZIP", pickStr(st.zip, st.postal_code, st.zip_code, p.zip, p.postal_code)],
            ["Governing state", pickStr(p.governing_law_state, st.state)],
            ["DMV license #", pickStr(b.dealer_license_number, p.dealer_license_number, p.license_number, st.license_number)],
            ["OEM brands", brandsToStr(st.oem_brands, st.brands, st.makes, p.oem_brands)],
            ["Bundle tier", pickStr(p.bundle_tier)],
          ].filter(([, v]) => v) as [string, string][];
          return (
            <div className="mx-4 mt-3 rounded-lg border border-blue-200 bg-blue-50/50 dark:bg-blue-950/30 dark:border-blue-900 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">Managed in Autocurb</p>
                <button onClick={resync} disabled={resyncing} className="h-7 px-2.5 rounded-md bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {resyncing ? "Syncing…" : "Re-sync"}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Read-only mirror. {mirror.synced_at ? `Last synced ${new Date(mirror.synced_at).toLocaleString()}` : "Not yet synced"}</p>
              <div className="flex items-center gap-2 mt-2">
                {(() => {
                  const logo = p.logo_url || b.logo_url || b.logo_white_url || b.corporate_logo_url;
                  return logo ? (
                    <img src={logo} alt={p.name} className="h-7 w-auto max-w-[120px] object-contain"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  ) : <span className="text-[10px] text-muted-foreground italic">No logo from Autocurb</span>;
                })()}
                {[p.primary_color, p.secondary_color].filter(Boolean).map((c: string) => (
                  <span key={c} className="w-5 h-5 rounded border border-border" style={{ background: c }} title={c} />
                ))}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                {rows.map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</dt>
                    <dd className="text-foreground truncate">{v}</dd>
                  </div>
                ))}
              </dl>
              {stores.length > 0 && (
                <div className="mt-2">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Stores ({stores.length})</p>
                  <ul className="space-y-0.5">
                    {stores.map((s: Record<string, string>, i: number) => (
                      <li key={i} className="text-[11px] text-foreground truncate">
                        {s.name || "Store"}{[s.city, s.state].filter(Boolean).length ? ` · ${[s.city, s.state].filter(Boolean).join(", ")}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[9px] text-muted-foreground mt-2">Entitlement, plan tier, members, and templates are AutoLabels-owned and edited below — a re-sync never overwrites them.</p>
              {/* Raw payload — the source of truth for "why isn't field X
                  populating": if a value is missing here, Autocurb didn't
                  send it (fix is in Autocurb's dealers-api). */}
              <details className="mt-2">
                <summary className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 cursor-pointer select-none">
                  View raw Autocurb payload
                </summary>
                <pre className="mt-1 max-h-64 overflow-auto rounded bg-background/80 border border-border p-2 text-[10px] leading-snug text-foreground whitespace-pre-wrap break-all">
                  {JSON.stringify(p, null, 2)}
                </pre>
              </details>
            </div>
          );
        })()}

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
