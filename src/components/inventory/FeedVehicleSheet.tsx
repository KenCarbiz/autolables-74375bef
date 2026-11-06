import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { STORE_INVENTORY_PATH } from "@/lib/inventoryScope/paths";
import { feedPhotoUrls, feedTitle, type DisplayRow } from "@/lib/inventoryScope/groupInventory";
import { DealershipStatusBadge } from "./DealershipSelector";

const PRESENCE_LABEL: Record<string, string> = {
  present: "In the latest feed",
  missing: "Missing from the latest feed",
  retirement_review: "Missing from the feed, awaiting review",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Unknown");

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-adm-border py-2.5 text-[14px] leading-[20px]">
    <dt className="text-adm-muted">{label}</dt>
    <dd className="min-w-0 break-words font-medium text-adm-ink">{children}</dd>
  </div>
);

/** Read-only source data for a vehicle that exists only in a dealership feed. No actions. */
export function FeedVehicleSheet({ row, onClose }: { row: DisplayRow | null; onClose: () => void }) {
  const f = row?.feed ?? null;
  const photos = f ? feedPhotoUrls(f.photos) : [];
  return (
    <Sheet open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="feed-vehicle-sheet">
        {row && f && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="pr-6">{feedTitle(f) || "Vehicle (not decoded in feed)"}</SheetTitle>
              <SheetDescription>{row.storeName}</SheetDescription>
              <div><DealershipStatusBadge status={row.status} /></div>
            </SheetHeader>
            <dl className="mt-4">
              <Field label="Dealership">{row.storeName}</Field>
              <Field label="VIN"><span className="font-mono">{row.vin}</span></Field>
              <Field label="Stock number">{f.stock_number || "Not in feed"}</Field>
              <Field label="Condition">{f.condition === "cpo" ? "CPO" : f.condition === "new" ? "New" : "Used"}{f.certified && f.condition !== "cpo" ? ", certified" : ""}</Field>
              <Field label="Trim">{f.trim || "Not in feed"}</Field>
              <Field label="Price">{row.price !== null ? `$${Math.round(row.price).toLocaleString("en-US")}` : "Price not in feed"}</Field>
              <Field label="Mileage">{f.mileage !== null ? `${f.mileage.toLocaleString("en-US")} mi` : "Not in feed"}</Field>
              <Field label="Exterior color">{f.exterior_color || "Not in feed"}</Field>
              <Field label="Photos">
                {photos.length === 0 ? "No photos in feed" : (
                  <span className="flex flex-wrap gap-2">
                    {photos.map((u, i) => <img key={i} src={u} alt="" loading="lazy" className="h-16 w-24 rounded-[4px] bg-adm-workspace object-cover" />)}
                    {f.photo_count > photos.length && <span className="self-center text-[13px] text-adm-muted">{f.photo_count} in feed</span>}
                  </span>
                )}
              </Field>
              <Field label="Feed status">{PRESENCE_LABEL[f.presence] ?? f.presence}</Field>
              <Field label="Last seen">{when(f.last_seen_at)}</Field>
            </dl>
            {row.conflict && (
              <p className="mt-4 rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] leading-[18px] text-red-800">
                This VIN is also claimed by another dealership in the group. Nothing has been moved; review it in Inventory by store.
              </p>
            )}
            <p className="mt-4 text-[13px] leading-[18px] text-adm-muted">
              Read-only. This vehicle comes from the dealership&apos;s inventory feed and has no vehicle file, so it cannot be edited, published or given an addendum from here.
            </p>
            <Link to={STORE_INVENTORY_PATH} className="mt-3 inline-block text-[14px] font-semibold text-adm-primary hover:underline">Inventory by store</Link>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
