import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronRight } from "lucide-react";
import VehicleTruthCard from "@/components/vehicle/VehicleTruthCard";
import { listingGallery } from "@/lib/photos";
import { Link } from "react-router-dom";
import { Card, EmptyNote, StatRow, btn, fmtWhen } from "./primitives";
import { type LifecycleResult } from "./lifecycle";
import DescriptionCard from "./DescriptionCard";
import { type ReadinessSummary, type TabId, type VehicleRow } from "./types";

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
  const { tracked } = lifecycle;
  const interest = useCustomerInterest(vehicle);
  const [repulling, setRepulling] = useState(false);
  const gallery = listingGallery(vehicle);
  const videos = vehicle.videos || [];

  const infoPairs: { label: string; value: React.ReactNode }[] = [
    { label: "VIN", value: <span className="font-mono">{vehicle.vin}</span> },
    { label: "Model", value: vehicle.ymm || "Needs VIN decode" },
    { label: "Trim", value: vehicle.trim || "Not decoded" },
    { label: "Stock #", value: stockNumber || "Not on the feed" },
    { label: "Condition", value: <span className="capitalize">{vehicle.condition || "unknown"}</span> },
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
      <div className="grid gap-6 lg:grid-cols-3 lg:items-stretch">
        <Card className="h-full" title="Vehicle details" action={
          <button onClick={repullMarket} disabled={repulling} className="text-[14px] font-semibold text-adm-primary hover:underline disabled:opacity-50" title="Re-pull market value, comparables, days-supply, recalls, VIN history and Black Book for this VIN">
            {repulling ? "Syncing…" : "Re-pull market data"}
          </button>
        }>
          <dl className="text-[14px] leading-[20px] border-t border-adm-border">
            {infoPairs.map((p) => (
              <div key={p.label} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 border-b border-adm-border py-1">
                <dt className="text-adm-muted">{p.label}</dt>
                <dd className="min-w-0 break-words text-adm-ink">{p.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <DescriptionCard vehicleId={vehicle.id} />

        <Card className="h-full" title={`Media (${gallery.length + videos.length})`} action={
          <button onClick={() => onTab("documents")} className="text-[14px] font-semibold text-adm-primary hover:underline">Manage media</button>
        }>
          {gallery.length === 0 && videos.length === 0 ? (
            <EmptyNote
              title="No photos or video on file"
              detail="Photos arrive with the inventory feed or are attached to the vehicle record."
            />
          ) : (
            <>
              <p className="text-[14px] text-adm-muted">{gallery.length} photo{gallery.length === 1 ? "" : "s"} · {videos.length} video{videos.length === 1 ? "" : "s"}</p>
              {gallery.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  <img src={gallery[0]} alt="" className="col-span-3 aspect-[16/10] w-full rounded-[4px] border border-adm-border object-cover" />
                  {gallery.slice(1, gallery.length > 7 ? 5 : 7).map((src, i) => (
                    <img key={`${src}-${i}`} src={src} alt="" className="aspect-[4/3] w-full rounded-[4px] border border-adm-border object-cover" />
                  ))}
                  {gallery.length > 7 && (
                    <span className="grid aspect-[4/3] place-items-center rounded-[4px] bg-adm-workspace text-[14px] font-semibold text-adm-muted">+{gallery.length - 5}</span>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Card title={`Blockers (${ready.blockers.length})`}>
        {ready.blockers.length === 0 ? (
          <p className="inline-flex items-center gap-1.5 text-[14px] text-adm-success">
            <CheckCircle2 className="w-5 h-5" /> Nothing is blocking this vehicle from going live.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {ready.blockers.map((b) => (
              <li key={b.label} className="inline-flex items-center gap-1.5 text-[14px] text-adm-warning">
                <AlertTriangle className="w-5 h-5 shrink-0" /> {b.label}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] font-semibold text-adm-primary">
          {ready.remaining.length > ready.blockers.length && (
            <button onClick={() => onTab("compliance")} className="inline-flex items-center gap-1 hover:underline">
              {ready.remaining.length - ready.blockers.length} other open item{ready.remaining.length - ready.blockers.length === 1 ? "" : "s"} <ChevronRight className="w-5 h-5" />
            </button>
          )}
          {tracked && <Link to={`/get-ready-command/${vehicle.id}`} className="hover:underline">Open Get Ready Command</Link>}
        </div>
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
