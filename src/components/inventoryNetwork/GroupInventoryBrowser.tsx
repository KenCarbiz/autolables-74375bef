import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, StatusText } from "@/components/product";
import { ICON } from "@/components/admin/v2/primitives";
import type { GroupInventoryData, GroupInventoryStoreRef, GroupInventoryVehicle } from "@/lib/inventoryNetwork/api";

type Chip = "all" | "home" | "additional";

const UNAVAILABLE: Record<string, string> = {
  home_store_unavailable: "This store is not available for browsing right now.",
};

export const formatLocation = (s: GroupInventoryStoreRef) => {
  const place = [s.city, s.state].filter(Boolean).join(" ");
  return place ? `At ${s.name}, ${place}` : `At ${s.name}`;
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const formatPrice = (price: number | string | null | undefined) => {
  const n = price === null || price === undefined ? NaN : Number(price);
  return Number.isFinite(n) && n > 0 ? usd.format(n) : "Price on request";
};

const title = (v: GroupInventoryVehicle) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";
const conditionLabel = (v: GroupInventoryVehicle) => (v.condition === "new" ? "New" : v.certified || v.condition === "cpo" ? "Certified pre-owned" : "Used");

function VehicleCard({ v, contactLabel, onContact }: { v: GroupInventoryVehicle; contactLabel: string; onContact?: (vehicleId: string) => void }) {
  return (
    <li className="flex flex-col overflow-hidden rounded-[6px] border border-adm-border bg-adm-surface">
      <div className="aspect-[4/3] w-full bg-adm-workspace">
        {v.photo ? <img src={v.photo} alt={title(v)} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[13px] text-adm-muted">No photo yet</div>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <StatusText tone={v.condition === "new" ? "info" : "neutral"}>{conditionLabel(v)}</StatusText>
          {v.mileage !== null && v.mileage !== undefined && <span className="text-[12px] text-adm-muted">{Number(v.mileage).toLocaleString("en-US")} mi</span>}
        </div>
        <h4 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{title(v)}</h4>
        {v.exterior_color && <p className="text-[13px] text-adm-muted">{v.exterior_color}</p>}
        <p className="flex items-start gap-1.5 text-[13px] leading-[18px] text-adm-ink"><MapPin className={cn(ICON.inline, "mt-px shrink-0 text-adm-muted")} aria-hidden="true" /><span>{formatLocation(v.owning_store)}</span></p>
        <p className="mt-auto pt-2 text-[20px] leading-[28px] font-bold tabular-nums text-adm-ink">{formatPrice(v.price)}</p>
        <button type="button" onClick={() => onContact?.(v.id)} className="mt-1 inline-flex min-h-[40px] items-center justify-center rounded-md border border-adm-primary bg-adm-surface px-3.5 text-[14px] font-semibold text-adm-primary hover:bg-adm-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary">
          {contactLabel}
        </button>
      </div>
    </li>
  );
}

export function GroupInventoryBrowser({ data, salesperson, onContact }: { data: GroupInventoryData; salesperson: { id: string; name: string } | null; onContact?: (vehicleId: string) => void }) {
  const [chip, setChip] = useState<Chip>("all");
  const vehicles = useMemo(() => {
    if (!data.enabled) return [];
    return [...data.vehicles].sort((a, b) => (a.inventory_group === b.inventory_group ? a.rank - b.rank : a.inventory_group === "home" ? -1 : 1));
  }, [data]);

  if (!data.enabled) return <EmptyState title="Inventory is not available here" detail={UNAVAILABLE[data.reason] ?? "This store is not set up to show inventory."} compact />;

  const home = vehicles.filter((v) => v.inventory_group === "home");
  const extra = vehicles.filter((v) => v.inventory_group === "additional");
  const contactLabel = salesperson ? `Ask ${salesperson.name}` : "Ask about this vehicle";
  const chips: Array<{ key: Chip; label: string; count: number }> = [
    { key: "all", label: "All", count: vehicles.length },
    { key: "home", label: data.home_store.name, count: home.length },
    { key: "additional", label: "Additional", count: extra.length },
  ];
  const showHome = chip !== "additional";
  const showExtra = chip !== "home";

  return (
    <div className="space-y-6">
      <div role="group" aria-label="Filter inventory" className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={chip === c.key}
            onClick={() => setChip(c.key)}
            className={cn("min-h-[36px] rounded-full border px-3.5 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary", chip === c.key ? "border-adm-primary bg-adm-selected text-adm-primary" : "border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace")}
          >
            {c.label} ({c.count})
          </button>
        ))}
      </div>

      {vehicles.length === 0 && <EmptyState title="No vehicles to show" detail="Nothing is available for this store and channel right now." compact />}

      {showHome && home.length > 0 && (
        <section aria-label={`${data.home_store.name} inventory`} className="space-y-3">
          <h3 className="text-[17px] leading-[24px] font-semibold text-adm-ink">{data.home_store.name}</h3>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{home.map((v) => <VehicleCard key={v.id} v={v} contactLabel={contactLabel} onContact={onContact} />)}</ul>
        </section>
      )}

      {showExtra && extra.length > 0 && (
        <section aria-label="Additional group inventory" className={cn("space-y-3", showHome && home.length > 0 && "border-t border-adm-border pt-6")}>
          <div>
            <h3 className="text-[17px] leading-[24px] font-semibold text-adm-ink">Additional group inventory</h3>
            <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">More vehicles from other locations in the same group.</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{extra.map((v) => <VehicleCard key={v.id} v={v} contactLabel={contactLabel} onContact={onContact} />)}</ul>
        </section>
      )}

      {data.total > vehicles.length && <p className="text-[13px] text-adm-muted">Showing {vehicles.length} of {data.total} vehicles.</p>}
    </div>
  );
}

export default GroupInventoryBrowser;
