import { useMemo, useState } from "react";
import { useVehicleTruth, type TruthFactRow } from "@/hooks/useVehicleTruth";
import { AlertTriangle, ChevronDown, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

// What this vehicle IS, as every generator sees it.
//
// The sticker, the description and the Passport all read one resolved
// snapshot, so this card is not another view of the data — it is THE view,
// with each fact shown next to who said it and how strongly. A fact that
// only an inference supports is labelled as such rather than presented in
// the same weight as manufacturer build data.

const TONE: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-700",
  dealer_entered: "bg-blue-50 text-blue-700",
  feed_provided: "bg-blue-50 text-blue-700",
  calculated: "bg-amber-50 text-amber-700",
  inferred: "bg-amber-50 text-amber-700",
  disputed: "bg-rose-50 text-rose-700",
  pending: "bg-slate-100 text-slate-600",
};

const SOURCE_LABEL: Record<string, string> = {
  oem_authorized: "Manufacturer",
  neovin: "NeoVIN build data",
  marketcheck: "Inventory feed",
  dealer_confirmed: "Dealership",
  vin_decode: "VIN decode",
  other_structured: "Configuration match",
  ai_inference: "Inferred",
};

const STATUS_LABEL: Record<string, string> = {
  verified: "Verified",
  dealer_entered: "Dealer stated",
  feed_provided: "Feed",
  calculated: "Calculated",
  inferred: "Inferred",
  disputed: "Disputed",
  pending: "Pending",
};

// Mirrors the ordering on the sticker itself so the two read alike.
const FACT_GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: "Identity", keys: ["manufacturer", "make", "model_year", "model", "trim", "body_configuration", "stock_number"] },
  { title: "Mechanical", keys: ["engine", "transmission", "drivetrain", "fuel_type"] },
  { title: "Appearance", keys: ["exterior_color", "interior_color"] },
  { title: "Manufacturer pricing", keys: ["base_msrp", "destination_charge", "factory_options_total", "total_msrp"] },
  { title: "Dealership", keys: ["condition", "mileage", "advertised_price"] },
  { title: "Equipment", keys: ["factory_packages", "factory_options", "standard_equipment"] },
];

const LABELS: Record<string, string> = {
  manufacturer: "Manufacturer", make: "Make", model_year: "Model year", model: "Model",
  trim: "Trim", body_configuration: "Body", stock_number: "Stock number",
  engine: "Engine", transmission: "Transmission", drivetrain: "Drivetrain", fuel_type: "Fuel",
  exterior_color: "Exterior", interior_color: "Interior",
  base_msrp: "Base MSRP", destination_charge: "Destination", total_msrp: "Total MSRP",
  factory_options_total: "Factory options", condition: "Condition", mileage: "Mileage",
  advertised_price: "Advertised price", factory_packages: "Packages",
  factory_options: "Options", standard_equipment: "Standard equipment",
};

const MONEY = new Set(["base_msrp", "destination_charge", "total_msrp", "factory_options_total", "advertised_price"]);

function display(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    if (!value.length) return "—";
    return value.length <= 3 ? value.join(", ") : `${value.slice(0, 3).join(", ")} +${value.length - 3} more`;
  }
  if (typeof value === "number") {
    if (MONEY.has(key)) return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    return value.toLocaleString("en-US");
  }
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

const factStatus = (fact: TruthFactRow): string => {
  if (fact.source_kind === "ai_inference") return "inferred";
  if (fact.source_kind === "dealer_confirmed") return "dealer_entered";
  if (fact.confidence === "VERIFIED") return "verified";
  if (fact.source_kind === "marketcheck") return "feed_provided";
  return "calculated";
};

export default function VehicleTruthCard({
  tenantId, vehicleId,
}: {
  tenantId: string | null;
  vehicleId: string;
}) {
  const { truth, loading, error, refresh } = useVehicleTruth(tenantId, vehicleId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const byKey = useMemo(() => {
    const map = new Map<string, TruthFactRow>();
    for (const fact of truth.facts) {
      const held = map.get(fact.fact_key);
      // Several sources can answer the same fact; the snapshot already
      // picked a winner, so show the strongest rather than the last read.
      if (!held || (held.confidence !== "VERIFIED" && fact.confidence === "VERIFIED")) {
        map.set(fact.fact_key, fact);
      }
    }
    return map;
  }, [truth.facts]);

  const blocking = truth.conflicts.filter((c) => c.blocks_generation);

  const onRefresh = async () => {
    setBusy(true);
    const result = await refresh();
    setBusy(false);
    if (!result) { toast.error("Could not rebuild the vehicle snapshot"); return; }
    toast.success(result.created
      ? `Snapshot v${result.version} recorded`
      : "No material change — current snapshot reused");
  };

  return (
    <div className="bg-card rounded-2xl shadow-premium overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <h4 className="text-sm font-bold text-foreground">Vehicle Truth</h4>
            {truth.snapshot && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                v{truth.snapshot.snapshot_version}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            One resolved record. The window sticker, the description and the Passport all read this.
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={busy || loading || !tenantId}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-xs font-semibold text-foreground disabled:opacity-50 shrink-0"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Rebuild
        </button>
      </div>

      {error && (
        <p className="px-4 pb-3 text-xs text-rose-600">{error}</p>
      )}

      {!loading && !truth.snapshot && !error && (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          No snapshot recorded yet. Rebuild resolves one from the data already saved for this VIN —
          it does not call a provider and costs nothing.
        </p>
      )}

      {blocking.length > 0 && (
        <div className="mx-4 mb-3 rounded-lg bg-rose-50 border border-rose-200 p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            {blocking.length === 1 ? "1 conflict needs a decision" : `${blocking.length} conflicts need a decision`}
          </div>
          <ul className="mt-1.5 space-y-1">
            {blocking.map((conflict) => (
              <li key={conflict.id} className="text-xs text-rose-700">
                <span className="font-semibold">{LABELS[conflict.fact_key] ?? conflict.fact_key}</span>
                {": "}
                {conflict.candidates.map((c) => `${display(conflict.fact_key, c.value)} (${SOURCE_LABEL[c.sourceKind] ?? c.sourceKind})`).join(" vs ")}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-rose-600">
            Two sources that may both verify this disagree. A person decides, not the ranking.
          </p>
        </div>
      )}

      {truth.snapshot && (
        <>
          <div className="px-4 pb-3 space-y-3">
            {FACT_GROUPS.map((group) => {
              const rows = group.keys.map((k) => [k, byKey.get(k)] as const).filter(([, f]) => !!f);
              if (!rows.length) return null;
              return (
                <div key={group.title}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">{group.title}</p>
                  <div className="space-y-1">
                    {rows.map(([key, fact]) => {
                      const status = factStatus(fact!);
                      return (
                        <div key={key} className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="text-muted-foreground shrink-0">{LABELS[key] ?? key}</span>
                          <span className="flex-1 border-b border-dotted border-border/60 translate-y-[-2px]" />
                          <span className="font-semibold text-foreground text-right truncate max-w-[55%]">
                            {display(key, fact!.fact_value?.v)}
                          </span>
                          <span className={`text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded shrink-0 ${TONE[status]}`}>
                            {STATUS_LABEL[status]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border text-xs font-semibold text-muted-foreground"
          >
            Where this came from
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div className="px-4 py-3 border-t border-border space-y-2 bg-muted/30">
              {truth.sources.length === 0 && (
                <p className="text-xs text-muted-foreground">No provider retrievals recorded for this vehicle yet.</p>
              )}
              {truth.sources.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-foreground font-medium">{SOURCE_LABEL[source.source_kind] ?? source.source_kind}</span>
                  <span className="text-muted-foreground">
                    {new Date(source.retrieved_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    {source.billable ? " · billed" : " · reused"}
                  </span>
                </div>
              ))}
              {truth.snapshot.material_changes.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                    What changed in v{truth.snapshot.snapshot_version}
                  </p>
                  {truth.snapshot.material_changes.map((change) => (
                    <p key={change.field} className="text-xs text-muted-foreground">
                      {change.label}: {String(change.previous ?? "—")} to {String(change.next ?? "—")}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
