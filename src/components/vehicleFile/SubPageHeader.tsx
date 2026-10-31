import type { ReactNode } from "react";
import { Car } from "lucide-react";
import { Crumbs } from "@/components/detail/parts";
import { PageHeader } from "@/components/product";
import { listingGallery } from "@/lib/photos";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";
import { STATE_LABEL, STATE_NEXT_ACTION, STATE_OWNER } from "@/lib/lifecycle/states";
import type { LifecycleResult } from "./lifecycle";
import type { VehicleRow } from "./types";

export interface StripFact {
  label: string;
  value: ReactNode;
}

/** One-line vehicle identity under a vehicle-file page title: photo, name, stock and VIN, then a few facts. */
export const IdentityStrip = ({ vehicle, facts, tag }: { vehicle: VehicleRow; facts: StripFact[]; tag?: ReactNode }) => {
  const photo = listingGallery(vehicle)[0];
  const stock = vehicleStockNumber(vehicle);
  return (
    <section aria-label="Vehicle identity" className="flex flex-col gap-3 rounded-[6px] border border-adm-border bg-adm-surface p-3 lg:flex-row lg:items-center">
      <div className="flex min-w-0 items-center gap-3 lg:w-[360px] lg:shrink-0">
        <div className="flex h-[52px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-adm-workspace">
          {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : <Car className="h-6 w-6 text-adm-muted" strokeWidth={1.25} aria-hidden="true" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] leading-[22px] font-bold text-adm-ink">{vehicle.ymm || "Vehicle needs a VIN decode"}</p>
          <p className="truncate text-[12px] leading-[18px] text-adm-muted">
            {stock ? `Stock # ${stock}` : "Stock # not on the feed"} · VIN <span className="font-mono">{vehicle.vin}</span>
          </p>
        </div>
      </div>
      <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:grid-cols-[repeat(3,auto)_minmax(0,1fr)] lg:border-l lg:border-adm-border lg:pl-6">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[12px] leading-[18px] text-adm-muted">{f.label}</dt>
            <dd className="truncate text-[14px] leading-[20px] font-semibold text-adm-ink" title={typeof f.value === "string" ? f.value : undefined}>{f.value}</dd>
          </div>
        ))}
      </dl>
      {tag && <div className="lg:shrink-0">{tag}</div>}
    </section>
  );
};

export const VehicleSubHeader = ({
  vehicle,
  section,
  title,
  description,
  actions,
  strip,
  crumbs = true,
}: {
  vehicle: VehicleRow;
  crumbs?: boolean;
  section: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  strip?: ReactNode;
}) => (
  <div className="flex flex-col gap-4">
    {crumbs && (
      <Crumbs
        items={[
          { label: "Vehicles", to: "/inventory" },
          { label: vehicle.ymm || vehicle.vin, to: `/vehicle-file/${vehicle.id}` },
          { label: section },
        ]}
      />
    )}
    <PageHeader title={title} description={description} actions={actions} />
    {strip}
  </div>
);

export const daysInInventory = (vehicle: Pick<VehicleRow, "created_at">): number =>
  Math.max(0, Math.floor((Date.now() - new Date(vehicle.created_at).getTime()) / 86400000));

/** Owner, state and next action for a vehicle, from the stored lifecycle row only. */
export const lifecycleFacts = (vehicle: VehicleRow, lifecycle: LifecycleResult, openBlockers = 0) => {
  const { row, loading, tracked } = lifecycle;
  const state = row?.state ?? null;
  const contradicted = state === "RETAIL_READY" && openBlockers > 0;
  return {
    owner: state ? STATE_OWNER[state] : tracked ? "Inventory intake" : "Merchandising",
    state: loading ? "Reading" : !tracked ? "Not tracked" : contradicted ? "Not retail ready" : state ? STATE_LABEL[state] : "No record",
    nextAction: contradicted
      ? `Clear ${openBlockers} open blocker${openBlockers === 1 ? "" : "s"}`
      : state ? STATE_NEXT_ACTION[state] : tracked ? "Wait for the first lifecycle recompute after intake" : "Build this vehicle's documents and publish it",
    days: daysInInventory(vehicle),
  };
};
