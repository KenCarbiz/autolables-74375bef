import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import {
  ArrowLeft, Car, FileText, Wrench, Tag, Signature, Globe,
  CheckCircle2, Clock, Gauge, DollarSign, MapPin, Copy, ExternalLink,
  FileUp, Upload, Printer, Sparkles, Plus, ArrowUpRight,
  AlertTriangle, ShieldCheck, Lock, Unlock, Send, MessageSquare,
} from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import { InstallProofList } from "@/components/admin/InstallProofList";

// ──────────────────────────────────────────────────────────────
// VehicleFile — /vehicle-file/:id
//
// The single canonical per-vehicle workspace. Every downstream tool
// is scoped here: documents (factory sticker, Carfax, brochures),
// addendum build, prep / foreman sign-off, label generation,
// customer signing. The vehicle_listings row is the record; every
// child artifact refers to it by id.
// ──────────────────────────────────────────────────────────────

type TabId = "overview" | "documents" | "addendum" | "prep" | "labels" | "sign";

interface VehicleRow {
  id: string;
  tenant_id: string | null;
  vin: string;
  slug: string;
  ymm: string | null;
  trim: string | null;
  mileage: number | null;
  condition: "new" | "used" | "cpo" | null;
  price: number | null;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  view_count: number;
  sticker_snapshot: Record<string, unknown>;
  dealer_snapshot: Record<string, unknown>;
  documents: Array<{ name: string; url: string; type: string }>;
  videos: Array<{ id: string; url: string; caption?: string }>;
  prep_status: { all_accessories_installed?: boolean; foreman_signed_at?: string } | null;
  recall_check: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const VALID_TABS: TabId[] = ["overview", "documents", "addendum", "prep", "labels", "sign"];

const VehicleFile = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const initialTab = (() => {
    const q = searchParams.get("tab");
    return q && (VALID_TABS as string[]).includes(q) ? (q as TabId) : "overview";
  })();
  const [tab, setTab] = useState<TabId>(initialTab);

  // Keep ?tab= in sync so deep-links + refreshes land on the same tab.
  useEffect(() => {
    const current = searchParams.get("tab");
    if (tab === "overview" && current) {
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      setSearchParams(next, { replace: true });
    } else if (tab !== "overview" && current !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", tab);
      setSearchParams(next, { replace: true });
    }
  }, [tab, searchParams, setSearchParams]);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("vehicle_listings")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setVehicle(data as VehicleRow);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const publicUrl = useMemo(
    () => vehicle ? `${window.location.origin}/v/${vehicle.slug}` : "",
    [vehicle]
  );

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (notFound || !vehicle) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-3">
        <Car className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <h2 className="text-lg font-bold text-foreground">Vehicle not found</h2>
        <p className="text-sm text-muted-foreground">
          This file may have been archived, or your tenant doesn't have access.
        </p>
        <button
          onClick={() => navigate("/inventory")}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to inventory
        </button>
      </div>
    );
  }

  const copyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Shopper link copied");
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  const tabs: { id: TabId; label: string; icon: typeof Car }[] = [
    { id: "overview",  label: "Overview",  icon: Car },
    { id: "documents", label: "Documents", icon: FileUp },
    { id: "addendum",  label: "Addendum",  icon: FileText },
    { id: "prep",      label: "Prep & Install", icon: Wrench },
    { id: "labels",    label: "Labels",    icon: Tag },
    { id: "sign",      label: "Customer Sign-off", icon: Signature },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-4">
      {/* Hero / header */}
      <div>
        <button
          onClick={() => navigate("/inventory")}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          Inventory
        </button>
        <div className="mt-2 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-bold uppercase tracking-label px-2 py-0.5 rounded ${
                  vehicle.condition === "new" ? "bg-blue-100 text-blue-700" :
                  vehicle.condition === "cpo" ? "bg-violet-100 text-violet-700" :
                  "bg-slate-100 text-slate-700"
                }`}>{vehicle.condition || "unknown"}</span>
                <span className={`text-[10px] font-bold uppercase tracking-label px-2 py-0.5 rounded ${
                  vehicle.status === "published" ? "bg-emerald-100 text-emerald-700" :
                  vehicle.status === "archived" ? "bg-slate-100 text-slate-500" :
                  "bg-amber-100 text-amber-700"
                }`}>{vehicle.status}</span>
                {vehicle.prep_status?.foreman_signed_at ? (
                  <span className="text-[10px] font-bold uppercase tracking-label px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    Prep signed
                  </span>
                ) : null}
              </div>
              <h1 className="text-2xl font-black tracking-tight font-display text-foreground">
                {vehicle.ymm || "(needs VIN decode)"}
                {vehicle.trim ? <span className="text-muted-foreground font-normal ml-2">{vehicle.trim}</span> : null}
              </h1>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground mt-2">
                <span className="font-mono">{vehicle.vin}</span>
                {typeof vehicle.mileage === "number" && (
                  <span className="inline-flex items-center gap-1"><Gauge className="w-3 h-3" /> {vehicle.mileage.toLocaleString()} mi</span>
                )}
                {typeof vehicle.price === "number" && (
                  <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${vehicle.price.toLocaleString()}</span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Created {new Date(vehicle.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {vehicle.status === "published" ? (
                <>
                  <button
                    onClick={copyLink}
                    className="h-9 px-3 rounded-md border border-border text-sm font-semibold inline-flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy link
                  </button>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View shopper page
                  </a>
                </>
              ) : (
                <button
                  onClick={() => setTab("labels")}
                  className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Globe className="w-4 h-4" />
                  Publish shopper page
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`h-10 px-3 text-xs font-semibold inline-flex items-center gap-1.5 border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Panels */}
      <div className="pt-2">
        {tab === "overview"  && <OverviewPanel vehicle={vehicle} onReload={load} />}
        {tab === "documents" && <DocumentsPanel vehicle={vehicle} onReload={load} />}
        {tab === "addendum"  && <AddendumPanel vehicle={vehicle} />}
        {tab === "prep"      && <PrepPanel vehicle={vehicle} />}
        {tab === "labels"    && <LabelsPanel vehicle={vehicle} />}
        {tab === "sign"      && <SignPanel vehicle={vehicle} />}
      </div>
    </div>
  );
};

interface AuditEvent {
  id: string;
  action: string;
  created_at: string;
  user_email: string | null;
  details: Record<string, unknown> | null;
  entity_type: string;
}

const PRETTY_ACTION: Record<string, string> = {
  listing_viewed: "Shopper viewed the page",
  listing_published: "Published to shopper portal",
  addendum_signed: "Customer signed the addendum",
  addendum_viewed: "Addendum opened by customer",
  addendum_consent_given: "Customer accepted E-SIGN consent",
  deal_signed: "Deal jacket signed",
  document_archived: "Signed document archived",
  vdp_scraped: "VDP scraped from dealer site",
  prep_sign_off_signed: "Foreman signed off on prep",
  recall_checked: "NHTSA recall lookup ran",
};

const prettyAction = (a: string) =>
  PRETTY_ACTION[a] || a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const OverviewPanel = ({ vehicle }: { vehicle: VehicleRow; onReload: () => void }) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingEvents(true);
      try {
        // Audit rows for this vehicle can match by entity_id (vehicle_listing)
        // OR by details->>vin (addendum / deal / archive paths) OR by the
        // slug (listing_viewed events). Pull them all in one OR query.
        const { data } = await (supabase as any)
          .from("audit_log")
          .select("id,action,created_at,user_email,details,entity_type")
          .or(
            `entity_id.eq.${vehicle.id},details->>vin.eq.${vehicle.vin},details->>slug.eq.${vehicle.slug}`
          )
          .order("created_at", { ascending: false })
          .limit(80);
        if (!cancelled) setEvents((data || []) as AuditEvent[]);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoadingEvents(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle.id, vehicle.vin, vehicle.slug]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-3">
        <Card title="Activity timeline">
          {loadingEvents ? (
            <p className="text-xs text-muted-foreground">Loading events…</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No recorded activity yet. Events show up here as stickers are generated,
              prep is signed off, customers view the shopper page, and the addendum is
              signed. Every row is served from the append-only audit_log and is
              defensible in a compliance review.
            </p>
          ) : (
            <ol className="relative border-l-2 border-border pl-4 space-y-3">
              {events.map((ev) => (
                <li key={ev.id} className="relative">
                  <span className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-gradient-to-br from-[#3BB4FF] to-[#1E90FF] ring-4 ring-background" />
                  <div className="text-sm font-semibold text-foreground">
                    {prettyAction(ev.action)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString()}
                    {ev.user_email ? ` · ${ev.user_email}` : ""}
                    {ev.entity_type ? ` · ${ev.entity_type}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Decoded equipment">
          {vehicle.sticker_snapshot && Object.keys(vehicle.sticker_snapshot).length > 0 ? (
            <pre className="text-[11px] font-mono bg-muted/40 rounded p-3 whitespace-pre-wrap break-words max-h-64 overflow-auto">
              {JSON.stringify(vehicle.sticker_snapshot, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              No decoded equipment on file yet. Re-run the VIN decode from the VIN above
              to auto-populate year / make / model / trim / engine / fuel type.
            </p>
          )}
        </Card>

        <Card title="Recall status">
          {vehicle.recall_check ? (
            <pre className="text-[11px] font-mono bg-muted/40 rounded p-3 whitespace-pre-wrap break-words max-h-40 overflow-auto">
              {JSON.stringify(vehicle.recall_check, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              No NHTSA recall check on file. A fresh check runs automatically when you
              publish the shopper page. Publish is blocked if the VIN has an active
              do-not-drive campaign without an admin override.
            </p>
          )}
        </Card>
      </div>

      <div className="space-y-3">
        <Card title="Milestones">
          <ul className="space-y-2 text-xs">
            <Item ok label="Vehicle created" when={vehicle.created_at} />
            <Item ok={!!vehicle.ymm} label="VIN decoded" when={vehicle.ymm ? vehicle.updated_at : null} />
            <Item ok={!!vehicle.prep_status?.foreman_signed_at} label="Prep & install signed off" when={vehicle.prep_status?.foreman_signed_at || null} />
            <Item ok={vehicle.status === "published"} label="Shopper page published" when={vehicle.published_at} />
          </ul>
        </Card>

        <Card title="Public URL">
          {vehicle.status === "published" ? (
            <a
              href={`${window.location.origin}/v/${vehicle.slug}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary break-all font-mono hover:underline"
            >
              {window.location.origin}/v/{vehicle.slug}
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not yet published. Published vehicles get a shareable URL,
              QR code, and embed snippet for the dealer's website.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
};

const DocumentsPanel = ({ vehicle, onReload }: { vehicle: VehicleRow; onReload: () => void }) => {
  const [uploading, setUploading] = useState<string | null>(null);

  const upload = async (file: File, type: "factory_sticker" | "carfax" | "brochure" | "we_owe" | "other") => {
    if (!vehicle.tenant_id) {
      toast.error("Vehicle has no tenant — re-save the vehicle file first");
      return;
    }
    setUploading(type);
    const ext = file.name.split(".").pop() || "bin";
    const path = `${vehicle.tenant_id}/${vehicle.id}/${type}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("vehicle-docs")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (upErr) {
      // Try to auto-create the bucket once; ignore failures.
      await supabase.storage.createBucket("vehicle-docs", {
        public: false, fileSizeLimit: 25 * 1024 * 1024,
      }).catch(() => undefined);
      const retry = await supabase.storage
        .from("vehicle-docs")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (retry.error) {
        toast.error(`Upload failed: ${retry.error.message}`);
        setUploading(null);
        return;
      }
    }
    const { data: signed } = await supabase.storage
      .from("vehicle-docs")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    const next = [...(vehicle.documents || []), {
      name: file.name, type, url: signed?.signedUrl || path,
    }];
    const { error: updErr } = await (supabase as any)
      .from("vehicle_listings")
      .update({ documents: next })
      .eq("id", vehicle.id);
    setUploading(null);
    if (updErr) {
      toast.error("Saved file, but failed to attach to vehicle row");
    } else {
      toast.success(`${type.replace(/_/g, " ")} attached`);
      onReload();
    }
  };

  const slots: Array<{ type: "factory_sticker" | "carfax" | "brochure" | "we_owe" | "other"; label: string; desc: string }> = [
    { type: "factory_sticker", label: "Factory window sticker", desc: "OEM Monroney PDF / image — we'll show it to the buyer at signing." },
    { type: "carfax", label: "Carfax / AutoCheck", desc: "Vehicle history report — attach for buyer review + signoff." },
    { type: "brochure", label: "Product brochure", desc: "OEM or dealer marketing PDF — appears on the shopper page." },
    { type: "we_owe", label: "\"We owe\"", desc: "Items the dealership agreed to deliver post-sale (e.g. pending install)." },
    { type: "other", label: "Other", desc: "Anything else — inspection, MPI, warranty paperwork." },
  ];

  const filesByType = useMemo(() => {
    const m: Record<string, typeof vehicle.documents> = {};
    (vehicle.documents || []).forEach((d) => {
      m[d.type] = m[d.type] || [];
      m[d.type].push(d);
    });
    return m;
  }, [vehicle.documents]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {slots.map((s) => (
        <div key={s.type} className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">{s.label}</h3>
            <span className="text-[10px] text-muted-foreground">{(filesByType[s.type] || []).length} file(s)</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{s.desc}</p>
          {(filesByType[s.type] || []).map((d, i) => (
            <a
              key={i}
              href={d.url}
              target="_blank"
              rel="noreferrer"
              className="block text-xs text-primary hover:underline truncate"
            >
              {d.name}
            </a>
          ))}
          <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed border-border text-xs font-semibold cursor-pointer hover:bg-muted/40">
            <Upload className="w-3 h-3" />
            {uploading === s.type ? "Uploading…" : "Upload"}
            <input
              type="file"
              className="hidden"
              disabled={uploading !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f, s.type);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      ))}
    </div>
  );
};

const LabelsPanel = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const links = vehicle.condition === "new"
    ? [
        { path: "/new-car-sticker", label: "New-car Monroney + Addendum", desc: "Factory-style sticker with dealer-installed accessories and doc fee." },
        { path: "/buyers-guide",    label: "FTC Buyers Guide", desc: "Required for used sales. Spanish version auto-toggles." },
      ]
    : [
        { path: "/used-car-sticker", label: "Used-car Monroney + Addendum", desc: "Three layouts: full, equipment-only, accessories-only." },
        { path: "/cpo-sheet",        label: "CPO sheet",  desc: "Certified Pre-Owned disclosure template." },
        { path: "/buyers-guide",     label: "FTC Buyers Guide", desc: "Required; bilingual (en/es)." },
        { path: "/trade-up",         label: "Trade-Up sticker", desc: "For demo / courtesy / trade-in display units." },
      ];
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold text-foreground">Generate labels for this vehicle</h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          Every label pulls VIN, YMM, trim, equipment, and price from this file. When
          you publish to the shopper portal, the QR on the printed sticker resolves
          to <span className="font-mono">/v/{vehicle.slug}</span>.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {links.map((l) => (
          <button
            key={l.path}
            onClick={() => navigate(l.path)}
            className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary hover:shadow-premium transition"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-foreground inline-flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5" />
                {l.label}
              </span>
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{l.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

interface AddendumRow {
  id: string;
  created_at: string;
  status: string | null;
  customer_name: string | null;
  cobuyer_name: string | null;
  content_hash: string | null;
  signed_at: string | null;
  token: string | null;
  total_price: number | null;
}

const AddendumPanel = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AddendumRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("addendums")
        .select(
          "id,created_at,status,customer_name,cobuyer_name,content_hash,signed_at,token,total_price"
        )
        .eq("vehicle_vin", vehicle.vin)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setRows((data || []) as AddendumRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle.vin]);

  const signed = rows.filter((r) => r.status === "signed" || !!r.signed_at);
  const drafts = rows.filter((r) => !(r.status === "signed" || !!r.signed_at));

  const copyLink = async (token: string | null) => {
    if (!token) return;
    const url = `${window.location.origin}/sign/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Signing link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-title font-display font-semibold text-foreground">
            Addendums
          </h2>
          <p className="text-body-sm text-muted-foreground">
            Every signed addendum for this vehicle, scoped to VIN
            <span className="font-mono ml-1">{vehicle.vin}</span>.
          </p>
        </div>
        <button
          onClick={() => navigate("/addendum")}
          className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          New Addendum
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading addendums…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No addendums for this vehicle yet"
          description="Build one and the customer can sign on any phone. Every signed copy is hash-sealed and archived to the compliance record."
          actions={[{ label: "Start Addendum", icon: Plus, onClick: () => navigate("/addendum") }]}
        />
      ) : (
        <div className="space-y-3">
          {signed.length > 0 && (
            <Section title={`Signed (${signed.length})`}>
              {signed.map((r) => (
                <AddendumCard key={r.id} row={r} onOpen={() => navigate(`/addendum?id=${r.id}`)} onCopyLink={copyLink} />
              ))}
            </Section>
          )}
          {drafts.length > 0 && (
            <Section title={`Drafts (${drafts.length})`}>
              {drafts.map((r) => (
                <AddendumCard key={r.id} row={r} onOpen={() => navigate(`/addendum?id=${r.id}`)} onCopyLink={copyLink} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <p className="text-caption font-bold uppercase tracking-label text-muted-foreground mb-2">
      {title}
    </p>
    <div className="space-y-2">{children}</div>
  </div>
);

const AddendumCard = ({
  row,
  onOpen,
  onCopyLink,
}: {
  row: AddendumRow;
  onOpen: () => void;
  onCopyLink: (token: string | null) => void;
}) => {
  const signed = row.status === "signed" || !!row.signed_at;
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${
        signed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
      }`}>
        {signed ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body-sm font-semibold text-foreground truncate">
          {row.customer_name || "Unnamed customer"}
          {row.cobuyer_name ? <span className="text-muted-foreground"> + {row.cobuyer_name}</span> : null}
        </p>
        <div className="flex items-center gap-3 text-caption text-muted-foreground mt-0.5 flex-wrap">
          <span>{new Date(row.created_at).toLocaleDateString()}</span>
          {typeof row.total_price === "number" && (
            <span className="tabular-nums">${row.total_price.toLocaleString()}</span>
          )}
          {row.content_hash && (
            <span className="font-mono text-[10px]">hash: {row.content_hash.slice(0, 10)}…</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {!signed && row.token && (
          <button
            onClick={() => onCopyLink(row.token)}
            className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1"
            title="Copy signing link"
          >
            <Copy className="w-3 h-3" />
            Link
          </button>
        )}
        <button
          onClick={onOpen}
          className="h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-caption font-semibold inline-flex items-center gap-1"
        >
          Open
          <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

interface PrepRow {
  id: string;
  created_at: string;
  signed_at: string | null;
  updated_at: string;
  status: "pending" | "signed" | "rejected" | "overridden";
  foreman_name: string | null;
  inspection_passed: boolean;
  inspection_form_type: string | null;
  rejection_reason: string | null;
  listing_unlocked: boolean;
  accessories_installed: Array<{ name: string; installed_date?: string | null }> | null;
  install_photos: Array<{ url: string; caption?: string }> | null;
  notes: string | null;
}

const PrepPanel = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PrepRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("prep_sign_offs")
        .select(
          "id,created_at,signed_at,updated_at,status,foreman_name,inspection_passed,inspection_form_type,rejection_reason,listing_unlocked,accessories_installed,install_photos,notes"
        )
        .eq("vin", vehicle.vin)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (!cancelled) {
        setRows((data || []) as PrepRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle.vin]);

  const latest = rows[0] || null;
  const history = rows.slice(1);
  const unlocked = !!latest?.listing_unlocked;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-title font-display font-semibold text-foreground">
            Prep & Install
          </h2>
          <p className="text-body-sm text-muted-foreground">
            Foreman sign-off unlocks publishing and freezes the install
            record onto every signed addendum for this VIN.
          </p>
        </div>
        <button
          onClick={() => navigate(`/prep?vin=${encodeURIComponent(vehicle.vin)}`)}
          className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          New Sign-Off
        </button>
      </div>

      {/* Listing-unlock banner */}
      <div
        className={`rounded-xl border p-4 flex items-center gap-3 ${
          unlocked
            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-amber-50 border-amber-200 text-amber-900"
        }`}
      >
        {unlocked ? (
          <Unlock className="w-5 h-5 flex-shrink-0" />
        ) : (
          <Lock className="w-5 h-5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-semibold">
            {unlocked
              ? "Publishing unlocked"
              : "Publishing locked — prep sign-off required"}
          </p>
          <p className="text-caption opacity-80">
            {unlocked
              ? `Foreman ${latest?.foreman_name || ""} signed off ${
                  latest?.signed_at
                    ? new Date(latest.signed_at).toLocaleString()
                    : ""
                }.`
              : "A signed prep record gates the public listing. Latest sign-off must have inspection passed and listing_unlocked = true."}
          </p>
        </div>
      </div>

      {/* Vendor / detail-shop install proofs (scan-to-verify QR flow) */}
      <InstallProofList vin={vehicle.vin} />

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading sign-offs…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No prep sign-offs for this vehicle"
          description="Run a foreman sign-off when the install is complete. Until then the public listing stays locked and addendums can't reference an install audit."
          actions={[
            {
              label: "Start Sign-Off",
              icon: Plus,
              onClick: () => navigate(`/prep?vin=${encodeURIComponent(vehicle.vin)}`),
            },
          ]}
        />
      ) : (
        <div className="space-y-3">
          {latest && (
            <Section title="Latest sign-off">
              <PrepCard row={latest} onOpen={() => navigate("/prep")} />
            </Section>
          )}
          {history.length > 0 && (
            <Section title={`History (${history.length})`}>
              {history.map((r) => (
                <PrepCard key={r.id} row={r} onOpen={() => navigate("/prep")} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
};

const PrepCard = ({ row, onOpen }: { row: PrepRow; onOpen: () => void }) => {
  const installed = (row.accessories_installed || []).filter((a) => a.installed_date).length;
  const total = (row.accessories_installed || []).length;
  const photos = (row.install_photos || []).length;
  const statusCls =
    row.status === "signed" ? "bg-emerald-100 text-emerald-700" :
    row.status === "rejected" ? "bg-red-100 text-red-700" :
    row.status === "overridden" ? "bg-violet-100 text-violet-700" :
    "bg-amber-100 text-amber-700";
  const statusIcon =
    row.status === "signed" ? <CheckCircle2 className="w-4 h-4" /> :
    row.status === "rejected" ? <AlertTriangle className="w-4 h-4" /> :
    <Clock className="w-4 h-4" />;
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${statusCls}`}>
        {statusIcon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-body-sm font-semibold text-foreground truncate">
            {row.foreman_name || "Unassigned foreman"}
          </p>
          <span className={`text-[10px] font-bold uppercase tracking-label px-1.5 py-0.5 rounded ${statusCls}`}>
            {row.status}
          </span>
          {row.listing_unlocked && (
            <span className="text-[10px] font-bold uppercase tracking-label px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
              <Unlock className="w-2.5 h-2.5" />
              unlocked
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-caption text-muted-foreground mt-0.5 flex-wrap">
          <span>{new Date(row.updated_at).toLocaleDateString()}</span>
          {total > 0 && <span>{installed}/{total} installed</span>}
          {photos > 0 && <span>{photos} photo{photos === 1 ? "" : "s"}</span>}
          {row.inspection_form_type && row.inspection_form_type !== "None" && (
            <span>{row.inspection_form_type} inspection</span>
          )}
          {row.status === "rejected" && row.rejection_reason && (
            <span className="text-red-600 truncate">Reason: {row.rejection_reason}</span>
          )}
        </div>
      </div>
      <button
        onClick={onOpen}
        className="h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-caption font-semibold inline-flex items-center gap-1"
      >
        Open
        <ArrowUpRight className="w-3 h-3" />
      </button>
    </div>
  );
};

interface DealTokenRow {
  id: string;
  token: string;
  status: "pending" | "signed" | "expired" | "revoked";
  vehicle_payload: { vin?: string; ymm?: string; buyer?: { name?: string }; coBuyer?: { name?: string } } | null;
  content_hash: string | null;
  customer_ip: string | null;
  expires_at: string;
  signed_at: string | null;
  created_at: string;
}

interface SigningRow {
  id: string;
  signer_type: string;
  signer_name: string | null;
  signature_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
  signed_at: string;
  addendum_id: string | null;
  deal_token_id: string | null;
}

const SignPanel = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<DealTokenRow[]>([]);
  const [signings, setSignings] = useState<SigningRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: t }, { data: s }] = await Promise.all([
        (supabase as any)
          .from("deal_signing_tokens")
          .select(
            "id,token,status,vehicle_payload,content_hash,customer_ip,expires_at,signed_at,created_at"
          )
          .eq("vehicle_payload->>vin", vehicle.vin)
          .order("created_at", { ascending: false })
          .limit(20),
        (supabase as any)
          .from("addendum_signings")
          .select(
            "id,signer_type,signer_name,signature_type,ip_address,user_agent,signed_at,addendum_id,deal_token_id"
          )
          .eq("vin", vehicle.vin)
          .order("signed_at", { ascending: false })
          .limit(50),
      ]);
      if (!cancelled) {
        setTokens((t || []) as DealTokenRow[]);
        setSignings((s || []) as SigningRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle.vin]);

  const pending = tokens.filter((t) => t.status === "pending");
  const completed = tokens.filter((t) => t.status === "signed");
  const expired = tokens.filter((t) => t.status === "expired" || t.status === "revoked");

  const dealUrl = (token: string) => `${window.location.origin}/deal/${token}`;

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(dealUrl(token));
      toast.success("Signing link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const smsLink = (token: string) => {
    const body = encodeURIComponent(
      `Sign your paperwork for ${vehicle.ymm || "your vehicle"}: ${dealUrl(token)}`
    );
    window.open(`sms:?body=${body}`, "_blank");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-title font-display font-semibold text-foreground">
            Customer Sign-off
          </h2>
          <p className="text-body-sm text-muted-foreground">
            Active signing links and the full signature audit trail for
            VIN <span className="font-mono">{vehicle.vin}</span>.
          </p>
        </div>
        <button
          onClick={() => navigate("/addendum")}
          className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          New Signing Link
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading signatures…
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <Section title={`Active links (${pending.length})`}>
              {pending.map((t) => (
                <DealTokenCard key={t.id} row={t} url={dealUrl(t.token)} onCopy={() => copyLink(t.token)} onSms={() => smsLink(t.token)} />
              ))}
            </Section>
          )}

          {signings.length > 0 && (
            <Section title={`Signatures captured (${signings.length})`}>
              {signings.map((s) => (
                <SigningCard key={s.id} row={s} onOpen={() => s.addendum_id ? navigate(`/addendum?id=${s.addendum_id}`) : navigate("/saved")} />
              ))}
            </Section>
          )}

          {completed.length > 0 && (
            <Section title={`Completed deal jackets (${completed.length})`}>
              {completed.map((t) => (
                <DealTokenCard key={t.id} row={t} url={dealUrl(t.token)} onCopy={() => copyLink(t.token)} onSms={() => smsLink(t.token)} />
              ))}
            </Section>
          )}

          {expired.length > 0 && (
            <Section title={`Expired / revoked (${expired.length})`}>
              {expired.map((t) => (
                <DealTokenCard key={t.id} row={t} url={dealUrl(t.token)} onCopy={() => copyLink(t.token)} onSms={() => smsLink(t.token)} />
              ))}
            </Section>
          )}

          {pending.length === 0 && signings.length === 0 && completed.length === 0 && expired.length === 0 && (
            <EmptyState
              icon={Signature}
              title="No signatures captured for this vehicle"
              description="Generate a signing link from an addendum and the customer can sign on any phone. Every signature stores its hash, IP, user agent, and consent record."
              actions={[{ label: "Build Addendum", icon: Plus, onClick: () => navigate("/addendum") }]}
            />
          )}
        </>
      )}
    </div>
  );
};

const DealTokenCard = ({
  row, url, onCopy, onSms,
}: {
  row: DealTokenRow;
  url: string;
  onCopy: () => void;
  onSms: () => void;
}) => {
  const buyerName = row.vehicle_payload?.buyer?.name || "Customer";
  const cobuyerName = row.vehicle_payload?.coBuyer?.name;
  const statusCls =
    row.status === "signed" ? "bg-emerald-100 text-emerald-700" :
    row.status === "expired" ? "bg-slate-100 text-slate-600" :
    row.status === "revoked" ? "bg-red-100 text-red-700" :
    "bg-amber-100 text-amber-700";
  const statusIcon =
    row.status === "signed" ? <CheckCircle2 className="w-4 h-4" /> :
    row.status === "expired" ? <Clock className="w-4 h-4" /> :
    row.status === "revoked" ? <AlertTriangle className="w-4 h-4" /> :
    <Send className="w-4 h-4" />;
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${statusCls}`}>
        {statusIcon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body-sm font-semibold text-foreground truncate">
          {buyerName}
          {cobuyerName ? <span className="text-muted-foreground"> + {cobuyerName}</span> : null}
        </p>
        <div className="flex items-center gap-3 text-caption text-muted-foreground mt-0.5 flex-wrap">
          <span className={`text-[10px] font-bold uppercase tracking-label px-1.5 py-0.5 rounded ${statusCls}`}>
            {row.status}
          </span>
          <span>{new Date(row.created_at).toLocaleDateString()}</span>
          {row.signed_at && <span>signed {new Date(row.signed_at).toLocaleString()}</span>}
          {row.status === "pending" && (
            <span>expires {new Date(row.expires_at).toLocaleDateString()}</span>
          )}
          {row.content_hash && (
            <span className="font-mono text-[10px]">hash: {row.content_hash.slice(0, 10)}…</span>
          )}
        </div>
      </div>
      {row.status === "pending" && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCopy}
            className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1"
            title="Copy signing link"
          >
            <Copy className="w-3 h-3" />
            Link
          </button>
          <button
            onClick={onSms}
            className="h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-caption font-semibold inline-flex items-center gap-1"
            title="Text the link to the customer"
          >
            <MessageSquare className="w-3 h-3" />
            Text
          </button>
        </div>
      )}
      {row.status === "signed" && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1"
        >
          View
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
};

const SigningCard = ({ row, onOpen }: { row: SigningRow; onOpen: () => void }) => {
  const ua = (row.user_agent || "").slice(0, 36);
  const isPrimary = row.signer_type === "customer" || row.signer_type === "cobuyer";
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${
        isPrimary ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
      }`}>
        <Signature className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body-sm font-semibold text-foreground truncate">
          {row.signer_name || "Unnamed signer"}
          <span className="ml-2 text-[10px] font-bold uppercase tracking-label px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {row.signer_type.replace(/_/g, " ")}
          </span>
        </p>
        <div className="flex items-center gap-3 text-caption text-muted-foreground mt-0.5 flex-wrap">
          <span>{new Date(row.signed_at).toLocaleString()}</span>
          {row.signature_type && <span>{row.signature_type}</span>}
          {row.ip_address && <span className="font-mono text-[10px]">ip: {row.ip_address}</span>}
          {ua && <span className="truncate font-mono text-[10px]" title={row.user_agent || ""}>{ua}…</span>}
        </div>
      </div>
      {(row.addendum_id || row.deal_token_id) && (
        <button
          onClick={onOpen}
          className="h-8 px-2.5 rounded-md border border-border text-caption font-semibold text-foreground inline-flex items-center gap-1"
        >
          Open
          <ArrowUpRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

const JumpTo = ({ path, reason }: { path: string; reason: string }) => {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-card p-6 text-center space-y-3">
      <p className="text-sm text-muted-foreground">{reason}</p>
      <button
        onClick={() => navigate(path)}
        className="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
      >
        Open →
      </button>
      <p className="text-[11px] text-muted-foreground">
        Next wave folds this workflow directly into the vehicle file so you never
        leave the page.
      </p>
    </div>
  );
};

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-4 space-y-2">
    <h3 className="text-xs font-bold uppercase tracking-label text-muted-foreground">{title}</h3>
    {children}
  </div>
);

const Item = ({ ok, label, when }: { ok: boolean; label: string; when: string | null }) => (
  <li className="flex items-center justify-between gap-2">
    <span className="inline-flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-300"}`} />
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </span>
    <span className="text-[10px] text-muted-foreground">
      {when ? new Date(when).toLocaleDateString() : "pending"}
    </span>
  </li>
);

export default VehicleFile;
