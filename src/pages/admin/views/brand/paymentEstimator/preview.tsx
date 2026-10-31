import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ADMIN_UNAVAILABLE_COPY, chargeTreatment, downPaymentExplanation, formatApr, formatMoney, formatPayment, formatPercent, resolveEstimate,
  type EstimatorConfig,
} from "@/lib/payment/estimator";
import type { LoadState, PreviewVehicle } from "./data";
import { EstimatorIcon } from "./icons";

// Live draft preview. The same resolver the customer Passport uses, run on the
// draft (never saved) for a vehicle from this store's own inventory. With no
// inventory, a clearly labelled Example vehicle stands in; it exists only in
// this panel and is never written anywhere.

export const EXAMPLE_VEHICLE_ID = "__example__";

export function exampleVehicle(draft: EstimatorConfig, includesDocFee: boolean): PreviewVehicle {
  const r = draft.rules.find((x) => x.enabled && x.endYear != null && Number.isInteger(x.endYear));
  return { id: EXAMPLE_VEHICLE_ID, label: "Example vehicle", vin: null, condition: null, mileage: null, modelYear: r?.endYear ?? null, sellingPrice: 30000, includesDocFee };
}

export function PreviewPanel({ draft, vehicles, vehiclesState, checkedAt, exampleIncludesDocFee, className }: {
  draft: EstimatorConfig; vehicles: PreviewVehicle[]; vehiclesState: LoadState; checkedAt: number | null; exampleIncludesDocFee: boolean; className?: string;
}) {
  const priced = useMemo(() => vehicles.filter((v) => v.sellingPrice != null), [vehicles]);
  const useExample = vehiclesState === "ready" && vehicles.length === 0;
  const options = useExample ? [exampleVehicle(draft, exampleIncludesDocFee)] : vehicles;
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [term, setTerm] = useState<number | null>(null);
  useEffect(() => {
    if (options.length && !options.some((o) => o.id === vehicleId)) setVehicleId((priced[0] ?? options[0]).id);
  }, [options, priced, vehicleId]);
  const vehicle = options.find((o) => o.id === vehicleId) ?? options[0] ?? null;
  useEffect(() => { setTerm(null); }, [vehicleId]);

  // Preview as customers would see it when the estimator is on.
  const asOn = useMemo(() => ({ ...draft, enabled: true }), [draft]);
  const result = vehicle ? resolveEstimate(asOn, { modelYear: vehicle.modelYear, sellingPrice: vehicle.sellingPrice }, { termMonths: term }, { validate: "matched" }) : null;
  const charges = chargeTreatment(vehicle?.includesDocFee ?? exampleIncludesDocFee);
  const est = result?.status === "available" ? result : null;

  return (
    <section aria-labelledby="pe-preview-title" className={cn("rounded-[8px] border border-adm-border bg-adm-surface p-5", className)}>
      <h2 id="pe-preview-title" className="text-[18px] leading-[26px] font-semibold text-adm-ink">Customer preview</h2>
      <p className="text-[13px] text-adm-muted">Draft assumptions. Not saved, not a lender offer.</p>
      {!draft.enabled && <p className="mt-2 rounded-md bg-adm-warning-bg px-3 py-2 text-[12px] leading-[18px] text-adm-warning">The estimator is off, so customers see no estimate. This shows what they would see with it on.</p>}

      <div className="mt-4">
        <label htmlFor="pe-preview-vehicle" className="block text-[13px] font-semibold text-adm-ink">Vehicle</label>
        {vehiclesState === "loading" ? (
          <div className="mt-1 h-11 animate-pulse rounded-md bg-adm-workspace motion-reduce:animate-none" aria-label="Loading inventory" />
        ) : (
          <select id="pe-preview-vehicle" value={vehicle?.id ?? ""} onChange={(e) => setVehicleId(e.target.value)} disabled={options.length <= 1}
            className="mt-1 h-11 w-full rounded-md border border-adm-border bg-adm-surface px-2 text-[14px] text-adm-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary disabled:bg-adm-workspace">
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.vin ? ` · ${o.vin.slice(-6)}` : ""}</option>)}
          </select>
        )}
        {useExample && <p className="mt-1 text-[12px] text-adm-muted">This store has no inventory to preview, so an Example vehicle ($30,000) is used. It is not inventory and is never saved.</p>}
        {vehiclesState === "error" && <p className="mt-1 text-[12px] text-adm-danger">Inventory couldn't be loaded for the preview.</p>}
        {vehiclesState === "ready" && checkedAt != null && vehicles.length > 0 && <p className="mt-1 text-[12px] text-adm-muted">{vehicles.length} vehicles from this store, read {new Date(checkedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.</p>}
      </div>

      {vehicle && (
        <div className="mt-4 flex items-center gap-3 rounded-[6px] bg-adm-workspace px-3 py-3">
          <EstimatorIcon name="car" size={24} className="flex-shrink-0 text-adm-muted" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-adm-ink">{vehicle.id === EXAMPLE_VEHICLE_ID ? "Example vehicle" : vehicle.label}</p>
            <p className="text-[12px] text-adm-muted">Model year {vehicle.modelYear ?? "unknown"}{vehicle.condition ? ` · ${vehicle.condition.toUpperCase() === "CPO" ? "CPO" : vehicle.condition[0].toUpperCase() + vehicle.condition.slice(1)}` : ""}{vehicle.mileage != null ? ` · ${vehicle.mileage.toLocaleString()} mi` : ""}</p>
          </div>
        </div>
      )}

      {vehicle && (
        <dl className="mt-4 space-y-2 text-[14px]">
          <Row label="Selling price" value={vehicle.sellingPrice != null ? formatMoney(vehicle.sellingPrice) : "Not published"} strong />
          <p className="text-[12px] text-adm-muted -mt-1">{charges.basis}.</p>
          {est ? (
            <>
              <Row label="Matched rule" value={`Model years ${est.ruleLabel}`} />
              <div>
                <dt className="text-[13px] text-adm-muted">Available terms</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Preview term">
                  {est.terms.map((t) => {
                    const on = t.months === est.termMonths;
                    return (
                      <button key={t.months} type="button" role="radio" aria-checked={on} onClick={() => setTerm(t.months)}
                        className={cn("min-h-[44px] rounded-md border px-3 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary",
                          on ? "border-adm-primary bg-adm-selected text-adm-primary" : "border-adm-border text-adm-ink hover:bg-adm-workspace")}>
                        {t.months} mo{t.months === est.defaultTermMonths ? " · default" : ""}
                      </button>
                    );
                  })}
                </dd>
              </div>
              <Row label="Assumed APR" value={`${formatApr(est.aprPercent)} for ${est.termMonths} months`} />
              <Row label="Down payment" value={formatMoney(est.downPayment)} />
              <p className="text-[12px] text-adm-muted -mt-1">
                {est.downMode === "percent" && est.downPercent != null ? `${formatPercent(est.downPercent)} of the selling price.` : "Fixed amount."}
                {est.downClamped ? ` ${downPaymentExplanation(draft.downPayment, est.sellingPrice)}` : ""}
              </p>
              <Row label="Amount financed" value={formatMoney(est.amountFinanced)} />
              <div className="border-t border-adm-border pt-3" aria-live="polite">
                <dt className="text-[13px] text-adm-muted">Estimated payment</dt>
                <dd className="mt-0.5 text-[30px] leading-[36px] font-bold text-adm-primary tabular-nums">{formatPayment(est.monthlyPayment)}<span className="ml-1 text-[14px] font-medium text-adm-muted">/ month</span></dd>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-adm-border bg-adm-workspace px-3 py-3" role="status">
              <p className="text-[14px] font-semibold text-adm-ink">Estimate unavailable</p>
              <p className="mt-0.5 text-[13px] text-adm-muted">{result ? ADMIN_UNAVAILABLE_COPY[result.status === "unavailable" ? result.reason : "invalid_config"] : ""}</p>
              <p className="mt-1 text-[12px] text-adm-muted">Customers see: “A payment estimate isn't available for this vehicle. Contact the dealership for financing details.”</p>
            </div>
          )}
        </dl>
      )}

      <div className="mt-4 border-t border-adm-border pt-3 text-[12px] leading-[18px] text-adm-muted">
        <p>Estimate only, at the dealership's assumed APR. Not a credit approval or lender offer.</p>
        <p className="mt-1">{charges.summary}</p>
      </div>
    </section>
  );
}

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className="text-[13px] text-adm-muted">{label}</dt>
    <dd className={cn("text-right tabular-nums text-adm-ink", strong ? "text-[16px] font-bold" : "text-[14px] font-medium")}>{value}</dd>
  </div>
);
