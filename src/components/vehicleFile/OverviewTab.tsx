import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronRight, ImageIcon, RefreshCw, Video } from "lucide-react";
import VehicleTruthCard from "@/components/vehicle/VehicleTruthCard";
import { listingGallery } from "@/lib/photos";
import { Card, DeepLink, EmptyNote, Pair, StatRow, TabHeader, btn, fmtWhen, sinceLabel } from "./primitives";
import { STATE_LABEL, STATE_NEXT_ACTION, STATE_OWNER, type LifecycleResult } from "./lifecycle";
import DescriptionCard from "./DescriptionCard";
import { readinessLabel, type ReadinessSummary, type TabId, type VehicleRow } from "./types";

interface Interest {
  lastView: string | null;
  leads: number;
  loading: boolean;
}

const useCustomerInterest = (vehicle: VehicleRow): Interest => {
  const [state, setState] = useState<Interest>({ lastView: null, leads: 0, loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // deno-lint-ignore no-explicit-any
        const sb = supabase as unknown as { from: (t: string) => any };
        const [viewRes, leadRes] = await Promise.all([
          sb.from("audit_log")
            .select("created_at")
            .eq("action", "listing_viewed")
            .or(`entity_id.eq.${vehicle.id},details->>vin.eq.${vehicle.vin},details->>slug.eq.${vehicle.slug}`)
            .order("created_at", { ascending: false })
            .limit(1),
          sb.from("leads").select("id", { count: "exact", head: true }).eq("vehicle_vin", vehicle.vin),
        ]);
        if (cancelled) return;
        setState({
          lastView: (viewRes.data || [])[0]?.created_at ?? null,
          leads: leadRes.count ?? 0,
          loading: false,
        });
      } catch {
        if (!cancelled) setState({ lastView: null, leads: 0, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle.id, vehicle.vin, vehicle.slug]);
  return state;
};

export const OverviewTab = ({ vehicle, ready, lifecycle, stockNumber, onTab, onReload }: {
  vehicle: VehicleRow;
  ready: ReadinessSummary;
  lifecycle: LifecycleResult;
  stockNumber: string | null;
  onTab: (t: TabId) => void;
  onReload: () => void;
}) => {
  const { row: lifecycleRow, loading: lifecycleLoading, tracked } = lifecycle;
  const interest = useCustomerInterest(vehicle);
  const [repulling, setRepulling] = useState(false);
  const readiness = readinessLabel(ready);
  const gallery = listingGallery(vehicle);
  const videos = vehicle.videos || [];
  const state = lifecycleRow?.state ?? null;

  const infoPairs: { label: string; value: React.ReactNode }[] = [
    { label: "VIN", value: <span className="font-mono">{vehicle.vin}</span> },
    { label: "Year / make / model", value: vehicle.ymm || "Needs VIN decode" },
    { label: "Trim", value: vehicle.trim || "Not decoded" },
    { label: "Stock #", value: stockNumber || "Not on the feed" },
    { label: "Condition", value: (vehicle.condition || "unknown").toUpperCase() },
    { label: "Mileage", value: vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} mi` : "Not recorded" },
    { label: "Advertised price", value: vehicle.price != null ? `$${vehicle.price.toLocaleString()}` : "Not priced" },
    { label: "Created", value: new Date(vehicle.created_at).toLocaleDateString() },
    { label: "Last inventory sync", value: vehicle.enriched_at ? (fmtWhen(vehicle.enriched_at) ?? "Unknown") : "Never synced" },
  ];

  // Re-pull this VIN's MarketCheck enrichment (value, comps, days-supply,
  // recalls, VIN history, Black Book) on demand. enriched_at updates on
  // success, so the sync stamp reflects the new run.
  const repullMarket = async () => {
    if (!vehicle.vin || !vehicle.tenant_id) {
      toast.error("This vehicle needs a VIN and a tenant before it can sync");
      return;
    }
    setRepulling(true);
    try {
      const { data, error } = await supabase.functions.invoke("vehicle-enrich", {
        body: { tenant_id: vehicle.tenant_id, vin: vehicle.vin },
      });
      if (error) { toast.error("Re-pull failed — check the MarketCheck key"); return; }
      const pulled = (data as { pulled?: Record<string, unknown> })?.pulled;
      const got = pulled ? Object.entries(pulled).filter(([, v]) => v && v !== 0).map(([k]) => k.replace(/_/g, " ")) : [];
      onReload();
      toast.success(got.length ? `Synced: ${got.join(", ")}` : "Sync complete — no new data available");
    } finally {
      setRepulling(false);
    }
  };

  return (
    <div className="space-y-6">
      <TabHeader
        title="Overview"
        description="What this vehicle is, where it stands, and what is holding it back. Every number here comes from a stored record."
      />

      <Card title="Status" action={
        <span className={`text-al-meta font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
          readiness.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
        }`}>{readiness.label}</span>
      }>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <Pair
            label="Lifecycle stage"
            value={lifecycleLoading ? "Reading…" : !tracked ? "Not tracked (new stock)" : state ? STATE_LABEL[state] : "No lifecycle record yet"}
          />
          <Pair label="Owner" value={state ? STATE_OWNER[state] : tracked ? "Inventory intake" : "Merchandising"} />
          <Pair label="Time in stage" value={state ? (sinceLabel(lifecycleRow?.state_changed_at) ?? "Unknown") : "Not applicable"} />
          <Pair label="Digital status" value={vehicle.status === "published" ? "Live on the shopper portal" : vehicle.status === "archived" ? "Archived" : "Draft — not published"} />
        </div>

        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-al-meta font-bold uppercase tracking-wider text-muted-foreground">Next action</p>
          <p className="text-al-body text-foreground mt-0.5">
            {state ? STATE_NEXT_ACTION[state] : tracked ? "Wait for the first lifecycle recompute after intake" : "Build this vehicle's documents and publish it"}
          </p>
        </div>

        <div>
          <p className="text-al-meta font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Blockers ({ready.blockers.length})
          </p>
          {ready.blockers.length === 0 ? (
            <p className="text-al-body text-emerald-700 inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Nothing is blocking this vehicle from going live.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {ready.blockers.map((b) => (
                <li key={b.label} className="text-al-body text-amber-700 inline-flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {b.label}
                </li>
              ))}
            </ul>
          )}
          {ready.remaining.length > ready.blockers.length && (
            <button onClick={() => onTab("compliance")} className="mt-3 text-al-meta font-semibold text-primary inline-flex items-center gap-1 hover:underline">
              {ready.remaining.length - ready.blockers.length} other open item{ready.remaining.length - ready.blockers.length === 1 ? "" : "s"} <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {tracked && (
          <DeepLink to={`/get-ready-command/${vehicle.id}`} label="Get Ready Command" detail="Move this vehicle through its stage" />
        )}
      </Card>

      <Card title="Vehicle information" action={
        <button onClick={repullMarket} disabled={repulling} className={btn} title="Re-pull market value, comparables, days-supply, recalls, VIN history and Black Book for this VIN">
          <RefreshCw className={`w-3.5 h-3.5 ${repulling ? "animate-spin" : ""}`} /> {repulling ? "Syncing…" : "Re-pull market data"}
        </button>
      }>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          {infoPairs.map((p) => <Pair key={p.label} label={p.label} value={p.value} />)}
        </div>
      </Card>

      <DescriptionCard vehicleId={vehicle.id} />

      <Card title="Media" action={
        <button onClick={() => onTab("documents")} className={btn}>Manage packet <ArrowUpRight className="w-3.5 h-3.5" /></button>
      }>
        {gallery.length === 0 && videos.length === 0 ? (
          <EmptyNote
            title="No photos or video on file"
            detail="Photos arrive with the inventory feed or are attached to the vehicle record. The shopper passport shows a placeholder until at least one photo exists."
          />
        ) : (
          <>
            <div className="flex items-center gap-6">
              <span className="text-al-body text-foreground inline-flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-muted-foreground" /> {gallery.length} photo{gallery.length === 1 ? "" : "s"}
              </span>
              <span className="text-al-body text-foreground inline-flex items-center gap-2">
                <Video className="w-4 h-4 text-muted-foreground" /> {videos.length} video{videos.length === 1 ? "" : "s"}
              </span>
            </div>
            {gallery.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                {gallery.slice(0, 16).map((src, i) => (
                  <img key={`${src}-${i}`} src={src} alt="" className="w-full aspect-[4/3] object-cover rounded-lg border border-border" />
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      <VehicleTruthCard tenantId={vehicle.tenant_id} vehicleId={vehicle.id} />

      <Card title="Customer interest" action={
        <button onClick={() => onTab("customer")} className={btn}>Open Customer <ArrowUpRight className="w-3.5 h-3.5" /></button>
      }>
        {interest.loading ? (
          <p className="text-al-body text-muted-foreground">Loading engagement…</p>
        ) : (
          <div className="space-y-2.5">
            <StatRow label="Shopper page views" value={(vehicle.view_count || 0).toLocaleString()} tone={vehicle.view_count ? undefined : "muted"} />
            <StatRow label="Last shopper view" value={fmtWhen(interest.lastView) ?? "No views recorded"} tone={interest.lastView ? undefined : "muted"} />
            <StatRow label="Leads on this VIN" value={interest.leads.toLocaleString()} tone={interest.leads ? undefined : "muted"} />
          </div>
        )}
      </Card>

      {vehicle.source_url && /^https?:\/\//i.test(vehicle.source_url) && (
        <button onClick={() => window.open(vehicle.source_url as string, "_blank", "noopener")} className={btn}>
          View this vehicle's ad on the dealership website <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      )}
      {!vehicle.source_url && (
        <p className="text-al-meta text-muted-foreground">
          No dealership website URL on file for this VIN, so the live ad cannot be opened from here.
        </p>
      )}
    </div>
  );
};

export default OverviewTab;
