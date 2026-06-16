import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useGetReady } from "@/hooks/useGetReady";
import { usedSafetyInspectionForm } from "@/data/safetyInspection";
import { useVinDecode } from "@/hooks/useVinDecode";
import { toast } from "sonner";
import {
  Plus, Search, Upload, Car, FileText, Printer, Signature, ScanLine,
  X, CheckCircle2, AlertTriangle,
} from "lucide-react";
import SharedEmptyState from "@/components/ui/empty-state";
import { AdvertisedPriceBand } from "@/components/inventory/AdvertisedPriceBand";

// ──────────────────────────────────────────────────────────────
// Inventory — dealer's primary workspace.
//
// AutoLabels is not a DMS. This list is the single source of
// truth for vehicles the dealer is tracking addenda for. Adding
// a vehicle is the entry point for every downstream workflow:
// window sticker → addendum → prep sign-off → customer signing →
// shopper portal. Every action that follows is scoped to a
// vehicle_listings row.
// ──────────────────────────────────────────────────────────────

interface VehicleRow {
  id: string;
  vin: string;
  ymm: string | null;
  trim: string | null;
  mileage: number | null;
  condition: "new" | "used" | "cpo" | null;
  price: number | null;
  status: "draft" | "published" | "archived";
  slug: string;
  published_at: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

type StatusFilter = "all" | "draft" | "published" | "archived";
type ConditionFilter = "all" | "new" | "used" | "cpo";

const Inventory = () => {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const navigate = useViewTransitionNavigate();
  const { createGetReady } = useGetReady(tenant?.id || "");
  const { settings } = useDealerSettings();

  // Push an inventory vehicle into the Get-Ready prep pipeline. Get-Ready
  // had no intake wired, so the pipeline was always empty.
  const sendToGetReady = async (r: { id: string; vin: string | null; ymm: string | null; condition: string | null }) => {
    const rec = await createGetReady({
      vin: r.vin || "",
      stockNumber: (r.vin || "").slice(-6),
      ymm: r.ymm || "",
      condition: r.condition === "new" ? "new" : "used",
      acquiredDate: new Date().toISOString().slice(0, 10),
      accessoriesToInstall: [],
      // Self-aware: used vehicles need a safety inspection before delivery;
      // new ones do not. Name the state's form (CT -> K-208) when known.
      inspectionRequired: r.condition !== "new",
      inspectionFormType:
        usedSafetyInspectionForm(settings.dealer_state || settings.doc_fee_state, r.condition) || undefined,
      createdBy: user?.id || "",
    });
    if (rec) toast.success(`${r.ymm || r.vin || "Vehicle"} sent to Get-Ready`);
    else toast.error("Could not add to Get-Ready (it may already be in the pipeline).");
  };
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [condition, setCondition] = useState<ConditionFilter>("all");
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAdd, setShowAdd] = useState(searchParams.get("add") === "1");
  const [showImport, setShowImport] = useState(false);

  // Clear the ?add=1 flag so a back-nav doesn't re-open the modal.
  useEffect(() => {
    if (searchParams.get("add") === "1") {
      const next = new URLSearchParams(searchParams);
      next.delete("add");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("vehicle_listings")
      .select(
        "id,vin,ymm,trim,mileage,condition,price,status,slug,published_at,view_count,created_at,updated_at"
      )
      .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) {
      toast.error("Failed to load inventory");
      setRows([]);
    } else {
      setRows((data || []) as VehicleRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id]);

  const filtered = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (condition !== "all" && r.condition !== condition) return false;
      if (!lc) return true;
      return (
        r.vin.toLowerCase().includes(lc) ||
        (r.ymm || "").toLowerCase().includes(lc) ||
        (r.trim || "").toLowerCase().includes(lc)
      );
    });
  }, [rows, q, status, condition]);

  // KPI computations — derived from the already-loaded rows so
  // the strip lights up instantly with no extra round-trip.
  // Stripe / Linear pattern: 5 neutral cards, semantic color
  // reserved for status (amber for drafts, emerald for published,
  // sky for momentum). The 7-day momentum card is the trend
  // chip the UI agent flagged as "feels 2026 admin."
  const counts = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const publishedRows = rows.filter((r) => r.status === "published");
    const publishedRecent = publishedRows.filter(
      (r) => r.published_at && new Date(r.published_at).getTime() >= sevenDaysAgo,
    );
    const totalViews = rows.reduce((sum, r) => sum + (r.view_count || 0), 0);
    const archived = rows.filter((r) => r.status === "archived").length;
    return {
      total: rows.length,
      draft: rows.filter((r) => r.status === "draft").length,
      published: publishedRows.length,
      publishedRecent: publishedRecent.length,
      totalViews,
      archived,
    };
  }, [rows]);

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-4">
      {/* Operational header — actions live here, not in a marketing hero. */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pt-1">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Car className="w-3 h-3" />
            Inventory
          </div>
          <h1 className="mt-0.5 text-2xl font-display font-semibold tracking-tight text-foreground">
            Your vehicles
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every sticker, addendum, prep sign-off, and customer signature attaches to a vehicle file here.
          </p>
        </div>
        <div className="flex items-stretch gap-2 flex-wrap">
          <button
            onClick={() => setShowAdd(true)}
            className="h-9 px-4 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white inline-flex items-center gap-2 text-sm font-medium shadow-sm transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4 stroke-2" />
            Add Vehicle
          </button>
          <button
            onClick={() => navigate("/scan")}
            className="h-9 px-4 rounded-md border border-border bg-transparent hover:bg-muted text-foreground inline-flex items-center gap-2 text-sm font-medium transition-colors whitespace-nowrap"
            title="Scan a VIN barcode into inventory"
          >
            <ScanLine className="w-4 h-4 stroke-2" />
            Scan VIN
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="h-9 px-4 rounded-md border border-border bg-transparent hover:bg-muted text-foreground inline-flex items-center gap-2 text-sm font-medium transition-colors whitespace-nowrap"
          >
            <Upload className="w-4 h-4 stroke-2" />
            CSV Import
          </button>
        </div>
      </div>

      {/* KPI strip — Stripe/Linear-style 5-card snapshot of the
          dealer's inventory health. Wave 15.2: Drafts is the
          actionable card (each row is a TODO before it can leave
          the lot) so it gets hero weight — amber tint + larger
          value + bolder hint copy. Published / momentum / views
          are retrospective stats and recede to neutral. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat icon={Car} label="Total" value={counts.total} hint={counts.archived > 0 ? `${counts.archived} archived` : "in inventory"} />
        <Stat
          icon={FileText}
          label="Drafts"
          value={counts.draft}
          accent="amber"
          hint={counts.draft > 0 ? `${counts.draft === 1 ? "vehicle needs" : "vehicles need"} a sticker` : "all clear"}
          prominent={counts.draft > 0}
        />
        <Stat icon={CheckCircle2} label="Published" value={counts.published} accent="emerald" hint="live on shopper portal" />
        <Stat
          icon={Printer}
          label="Published 7d"
          value={counts.publishedRecent}
          accent="sky"
          hint={
            counts.publishedRecent > 0
              ? `momentum`
              : `none this week`
          }
        />
        <Stat icon={Signature} label="Shopper views" value={counts.totalViews} hint="lifetime" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search VIN, year, make, model, trim…"
            className="w-full h-9 pl-7 pr-3 rounded-md border border-border bg-background text-sm"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="h-9 px-2 rounded-md border border-border bg-background text-sm"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value as ConditionFilter)}
          className="h-9 px-2 rounded-md border border-border bg-background text-sm"
        >
          <option value="all">New & used</option>
          <option value="new">New</option>
          <option value="used">Used</option>
          <option value="cpo">CPO</option>
        </select>
      </div>

      {/* Add Vehicle modal */}
      {showAdd && (
        <AddVehicleModal
          tenantId={tenant?.id || null}
          userId={user?.id || null}
          onClose={() => setShowAdd(false)}
          onCreated={(id) => {
            setShowAdd(false);
            navigate(`/vehicle-file/${id}`);
          }}
        />
      )}

      {showImport && (
        <CsvImportModal
          tenantId={tenant?.id || null}
          userId={user?.id || null}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load(); }}
        />
      )}

      {/* Vehicle table */}
      {loading ? (
        <InventorySkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState onAdd={() => setShowAdd(true)} total={rows.length} />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Vehicle</th>
                <th className="text-left px-3 py-2 font-semibold">VIN</th>
                <th className="text-left px-3 py-2 font-semibold">Condition</th>
                <th className="text-right px-3 py-2 font-semibold">Mileage</th>
                <th className="text-right px-3 py-2 font-semibold">Price</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                <th className="text-right px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-muted/30 cursor-pointer"
                  onClick={() => navigate(`/vehicle-file/${r.id}`)}
                >
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-foreground">{r.ymm || "(needs decode)"}</div>
                    <div className="text-[11px] text-muted-foreground">{r.trim || ""}</div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.vin}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      r.condition === "new" ? "bg-blue-100 text-blue-700" :
                      r.condition === "cpo" ? "bg-violet-100 text-violet-700" :
                      "bg-slate-100 text-slate-700"
                    }`}>
                      {r.condition || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.mileage ? r.mileage.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex flex-col items-end gap-1">
                      <span>{r.price ? `$${r.price.toLocaleString()}` : "—"}</span>
                      {r.vin && r.price ? (
                        <AdvertisedPriceBand
                          vin={r.vin}
                          stickerPrice={r.price}
                          compact
                        />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <RowAction
                        label="Sticker"
                        title={r.condition === "new" ? "Generate new-car sticker" : "Generate used-car sticker"}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(r.condition === "new" ? "/new-car-sticker" : "/used-car-sticker");
                        }}
                      />
                      <RowAction
                        label="Get-Ready"
                        title="Send this vehicle into the Get-Ready prep pipeline"
                        onClick={(e) => { e.stopPropagation(); sendToGetReady(r); }}
                      />
                      <RowAction
                        label="Prep"
                        title="Prep + install sign-off"
                        onClick={(e) => { e.stopPropagation(); navigate(`/vehicle-file/${r.id}?tab=prep`); }}
                      />
                      <RowAction
                        label="Addendum"
                        title="Build the customer addendum"
                        onClick={(e) => { e.stopPropagation(); navigate(`/vehicle-file/${r.id}?tab=addendum`); }}
                      />
                      {r.status === "published" ? (
                        <RowAction
                          label="View"
                          tone="emerald"
                          title="Open the public shopper page"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(`/v/${r.slug}`, "_blank", "noopener");
                          }}
                        />
                      ) : (
                        <RowAction
                          label="Publish"
                          tone="blue"
                          title="Publish to the shopper portal"
                          onClick={(e) => { e.stopPropagation(); navigate(`/vehicle-file/${r.id}?tab=labels`); }}
                        />
                      )}
                      {/* Wave 15.3 — one-click jump to the
                          Audit-Defense Packet builder pre-
                          filled with this VIN. Surfaces the
                          compliance moat from the row, not
                          buried inside /compliance. */}
                      <RowAction
                        label="Defend"
                        title="Generate the SB 766 / FTC audit-defense packet for this VIN"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/compliance?vin=${encodeURIComponent(r.vin || "")}`);
                        }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/vehicle-file/${r.id}`); }}
                        className="text-[11px] font-semibold px-2.5 h-7 rounded-md text-primary hover:bg-primary/10 ml-1"
                        title="Open the full vehicle file"
                      >
                        Open →
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

interface RowActionProps {
  label: string;
  title: string;
  tone?: "default" | "blue" | "emerald";
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

const RowAction = ({ label, title, tone = "default", onClick }: RowActionProps) => {
  const cls =
    tone === "blue"
      ? "bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white hover:brightness-110 shadow-sm"
      : tone === "emerald"
        ? "bg-emerald-500 text-white hover:brightness-110 shadow-sm"
        : "bg-muted text-foreground hover:bg-muted/80";
  return (
    <button
      onClick={onClick}
      title={title}
      className={`h-7 px-2 rounded-md text-[10px] font-bold tracking-wide uppercase transition-all whitespace-nowrap hidden md:inline-flex items-center ${cls}`}
    >
      {label}
    </button>
  );
};

const InventorySkeleton = () => (
  <div className="rounded-xl border border-border bg-card overflow-hidden">
    <table className="w-full text-sm">
      <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="text-left px-3 py-2 font-semibold">Vehicle</th>
          <th className="text-left px-3 py-2 font-semibold">VIN</th>
          <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">Condition</th>
          <th className="text-right px-3 py-2 font-semibold hidden md:table-cell">Mileage</th>
          <th className="text-right px-3 py-2 font-semibold">Price</th>
          <th className="text-left px-3 py-2 font-semibold">Status</th>
          <th className="text-right px-3 py-2 font-semibold">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <tr key={i}>
            <td className="px-3 py-3">
              <div className="h-3.5 w-40 rounded bg-muted animate-pulse" />
              <div className="mt-1.5 h-2.5 w-24 rounded bg-muted/70 animate-pulse" />
            </td>
            <td className="px-3 py-3"><div className="h-3 w-32 rounded bg-muted animate-pulse" /></td>
            <td className="px-3 py-3 hidden md:table-cell"><div className="h-5 w-14 rounded-full bg-muted animate-pulse" /></td>
            <td className="px-3 py-3 hidden md:table-cell text-right"><div className="h-3 w-16 rounded bg-muted animate-pulse inline-block" /></td>
            <td className="px-3 py-3 text-right"><div className="h-3 w-20 rounded bg-muted animate-pulse inline-block" /></td>
            <td className="px-3 py-3"><div className="h-5 w-16 rounded-full bg-muted animate-pulse" /></td>
            <td className="px-3 py-3 text-right"><div className="h-6 w-24 rounded-md bg-muted animate-pulse inline-block" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Stat = ({
  icon: Icon,
  label,
  value,
  accent,
  hint,
  prominent = false,
}: {
  icon?: typeof Car;
  label: string;
  value: number;
  accent?: "amber" | "emerald" | "sky";
  hint?: string;
  // Hero-weight the card visually. Used for the actionable card
  // in a KPI strip (the one whose number the dealer is trying to
  // drive). Bumps value text + tints the card so the eye lands
  // there first. Wave 15.2 — Stripe/Linear hierarchy discipline.
  prominent?: boolean;
}) => {
  const valueColor =
    accent === "amber"   ? "text-amber-700" :
    accent === "emerald" ? "text-emerald-700" :
    accent === "sky"     ? "text-[#1E90FF]" :
    "text-foreground";
  const iconBg =
    accent === "amber"   ? "bg-amber-100 text-amber-700" :
    accent === "emerald" ? "bg-emerald-100 text-emerald-700" :
    accent === "sky"     ? "bg-sky-100 text-[#1E90FF]" :
    "bg-muted text-muted-foreground";
  // Prominent tint only fires when the card has an accent — a
  // colourless prominent card has nothing to lean on. The tint
  // is a subtle 5–8% wash so the card pops against neighbours
  // without yelling at the dealer.
  const cardBg =
    prominent && accent === "amber"   ? "bg-amber-50/70 border-amber-200" :
    prominent && accent === "emerald" ? "bg-emerald-50/70 border-emerald-200" :
    prominent && accent === "sky"     ? "bg-sky-50/70 border-sky-200" :
    "bg-card border-border";
  return (
    <div className={`rounded-xl border ${cardBg} p-4 flex items-start gap-3 transition-colors`}>
      {Icon && (
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon className="w-4 h-4" strokeWidth={2} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className={`mt-0.5 font-display ${prominent ? "text-3xl" : "text-2xl"} font-semibold tabular-nums leading-none ${valueColor}`}>
          {value}
        </p>
        {hint && (
          <p className={`text-[10px] mt-1 truncate ${prominent ? "text-foreground/80 font-semibold" : "text-muted-foreground/80"}`}>{hint}</p>
        )}
      </div>
    </div>
  );
};

const StatusPill = ({ status }: { status: VehicleRow["status"] }) => {
  const cls =
    status === "published" ? "bg-emerald-100 text-emerald-700" :
    status === "archived"  ? "bg-slate-100 text-slate-600" :
    "bg-amber-100 text-amber-700";
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>
      {status}
    </span>
  );
};

const EmptyState = ({ onAdd, total }: { onAdd: () => void; total: number }) => (
  <SharedEmptyState
    icon={Car}
    title={total === 0 ? "Let's add your first vehicle" : "No vehicles match your filters"}
    description="Enter a VIN, mileage, and stock number. We'll decode the year, make, model, and equipment, then open the vehicle's file so you can generate stickers, addenda, and signing links."
    actions={[{ label: "Add Vehicle", icon: Plus, onClick: onAdd }]}
  />
);

interface AddProps {
  tenantId: string | null;
  userId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}

const makeSlug = (seed: string) => {
  const clean = seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${clean || "veh"}-${rand}`;
};

const AddVehicleModal = ({ tenantId, userId, onClose, onCreated }: AddProps) => {
  const { decode, decoding } = useVinDecode();
  const [vin, setVin] = useState("");
  const [stock, setStock] = useState("");
  const [mileage, setMileage] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<"new" | "used" | "cpo">("used");
  const [state, setState] = useState("");
  const [decoded, setDecoded] = useState<{
    year?: string; make?: string; model?: string; trim?: string;
    bodyStyle?: string; engine?: string; fuelType?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleDecode = async () => {
    if (vin.length < 11) {
      toast.error("Enter a full 17-character VIN to decode");
      return;
    }
    const result = await decode(vin);
    if (result) {
      setDecoded({
        year: result.year,
        make: result.make,
        model: result.model,
        trim: result.trim,
        bodyStyle: result.bodyStyle,
        engine: result.engineDescription,
        fuelType: result.fuelType,
      });
      if (result.year && parseInt(result.year) >= new Date().getFullYear()) {
        setCondition("new");
      }
      toast.success(`Decoded: ${result.year} ${result.make} ${result.model}`);
    } else {
      toast.error("VIN decode failed — you can still continue manually");
    }
  };

  const canSubmit = vin.trim().length >= 11 && stock.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const ymm = decoded
      ? [decoded.year, decoded.make, decoded.model].filter(Boolean).join(" ")
      : null;
    const slug = makeSlug(`${decoded?.make || ""}-${decoded?.model || vin.slice(-6)}`);
    const { data, error } = await (supabase as any)
      .from("vehicle_listings")
      .insert({
        // store_id is NOT NULL and holds the tenant id (text); set both so
        // the tenant-scoped (Inventory) and store-scoped (useVehicleListing)
        // read paths both find the row.
        store_id: tenantId,
        tenant_id: tenantId,
        vin: vin.trim().toUpperCase(),
        slug,
        ymm,
        trim: decoded?.trim || null,
        mileage: mileage ? parseInt(mileage.replace(/[^0-9]/g, ""), 10) : null,
        condition,
        price: price ? parseFloat(price.replace(/[^0-9.]/g, "")) : null,
        sticker_snapshot: decoded ? { decoded } : {},
        dealer_snapshot: {},
        status: "draft",
        created_by: userId,
      })
      .select()
      .single();
    setSubmitting(false);
    if (error) {
      toast.error(`Failed: ${error.message}`);
      return;
    }
    onCreated(data.id);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl max-w-2xl w-full my-10 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Car className="w-5 h-5 text-primary" />
            Add Vehicle
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Paste the VIN and click Decode to auto-fill year / make / model / trim / equipment
          from NHTSA. You can also continue without decoding.
        </p>

        <div className="space-y-3">
          <Field label="VIN *" required>
            <div className="flex items-center gap-2">
              <input
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                placeholder="17 characters"
                maxLength={17}
                className="flex-1 h-10 px-3 rounded-md border border-border bg-background text-sm font-mono tracking-wider"
              />
              <button
                onClick={handleDecode}
                disabled={decoding || vin.length < 11}
                className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
              >
                {decoding ? "Decoding…" : "Decode"}
              </button>
            </div>
          </Field>

          {decoded && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs space-y-1">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Decoded
              </div>
              <p className="text-emerald-900">
                {[decoded.year, decoded.make, decoded.model, decoded.trim].filter(Boolean).join(" ")}
                {decoded.bodyStyle ? ` · ${decoded.bodyStyle}` : ""}
                {decoded.engine ? ` · ${decoded.engine}` : ""}
                {decoded.fuelType ? ` · ${decoded.fuelType}` : ""}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Stock # *" required>
              <input
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="e.g. T5892"
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm"
              />
            </Field>
            <Field label="Mileage">
              <input
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="e.g. 42850"
                inputMode="numeric"
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm"
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Price (optional)">
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="$"
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm"
              />
            </Field>
            <Field label="Condition">
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as typeof condition)}
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm"
              >
                <option value="new">New</option>
                <option value="used">Used</option>
                <option value="cpo">CPO</option>
              </select>
            </Field>
            <Field label="Sale state">
              <input
                value={state}
                onChange={(e) => setState(e.target.value.slice(0, 2).toUpperCase())}
                placeholder="e.g. CA"
                maxLength={2}
                className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm uppercase"
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="h-9 px-4 rounded-md text-sm font-semibold text-muted-foreground">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {submitting ? "Creating…" : "Create & open file"}
            {!submitting && <FileText className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ImportProps {
  tenantId: string | null;
  userId: string | null;
  onClose: () => void;
  onImported: () => void;
}

const CsvImportModal = ({ tenantId, userId, onClose, onImported }: ImportProps) => {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleImport = async () => {
    if (!tenantId) return;
    setSubmitting(true);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      toast.error("Paste at least a header row and one vehicle");
      setSubmitting(false);
      return;
    }
    const header = lines[0].toLowerCase().split(/[,\t]/).map((h) => h.trim());
    const col = (name: string) => header.findIndex((h) => h === name || h === name.replace(/_/g, " "));
    const idx = {
      vin: col("vin"),
      stock: col("stock"),
      mileage: col("mileage"),
      condition: col("condition"),
      price: col("price"),
      year: col("year"),
      make: col("make"),
      model: col("model"),
      trim: col("trim"),
    };
    if (idx.vin < 0 || idx.stock < 0) {
      toast.error("CSV must have at least 'vin' and 'stock' columns");
      setSubmitting(false);
      return;
    }
    const toInsert = lines.slice(1).map((line) => {
      const cells = line.split(/[,\t]/).map((c) => c.trim());
      const vin = (cells[idx.vin] || "").toUpperCase();
      if (vin.length < 11) return null;
      const year = idx.year >= 0 ? cells[idx.year] : "";
      const make = idx.make >= 0 ? cells[idx.make] : "";
      const model = idx.model >= 0 ? cells[idx.model] : "";
      const ymm = [year, make, model].filter(Boolean).join(" ");
      return {
        store_id: tenantId,
        tenant_id: tenantId,
        vin,
        slug: makeSlug(`${make}-${model || vin.slice(-6)}`),
        ymm: ymm || null,
        trim: idx.trim >= 0 ? cells[idx.trim] : null,
        mileage: idx.mileage >= 0 && cells[idx.mileage] ? parseInt(cells[idx.mileage].replace(/[^0-9]/g, ""), 10) : null,
        price: idx.price >= 0 && cells[idx.price] ? parseFloat(cells[idx.price].replace(/[^0-9.]/g, "")) : null,
        condition: idx.condition >= 0 ? (cells[idx.condition] || "used").toLowerCase() as "new" | "used" | "cpo" : "used",
        sticker_snapshot: {},
        dealer_snapshot: {},
        status: "draft",
        created_by: userId,
      };
    }).filter(Boolean) as Record<string, unknown>[];

    const { error, data } = await (supabase as any)
      .from("vehicle_listings")
      .insert(toInsert)
      .select("id");
    setSubmitting(false);
    if (error) {
      toast.error(`Import failed: ${error.message}`);
      return;
    }
    toast.success(`Imported ${data?.length ?? 0} vehicle(s)`);
    onImported();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl max-w-2xl w-full my-10 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            CSV Import
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold mb-1">Format</p>
            <p>
              First row is the header with column names. Minimum columns:{" "}
              <span className="font-mono">vin,stock</span>. Supported:{" "}
              <span className="font-mono">vin, stock, mileage, condition, price, year, make, model, trim</span>.
            </p>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"vin,stock,mileage,condition,price,year,make,model,trim\n1HGCM82633A123456,T5892,42850,used,24995,2023,Honda,Accord,EX-L"}
          rows={10}
          className="w-full rounded-md border border-border bg-background text-xs font-mono p-3"
        />
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-md text-sm font-semibold text-muted-foreground">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!text.trim() || submitting}
            className="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div>
    <label className="text-[10px] font-bold uppercase tracking-label text-muted-foreground">
      {label}
      {required ? <span className="text-destructive ml-0.5">*</span> : null}
    </label>
    <div className="mt-1">{children}</div>
  </div>
);

export default Inventory;
