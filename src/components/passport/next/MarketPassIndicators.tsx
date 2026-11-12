import type { MarketPassPublicContract } from "@/lib/intelligence/marketPass/contracts";
import SegmentedArcGauge from "./SegmentedArcGauge";

/** Renders the two public MarketPass gauges straight from the public contract; it derives nothing. */
export default function MarketPassIndicators({ contract, synthetic = false }: { contract: MarketPassPublicContract; synthetic?: boolean }) {
  const pf = contract.priceFairness;
  const vc = contract.vehicleConfidence;
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4" aria-labelledby="marketpass-title" data-marketpass={contract.contractVersion}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 id="marketpass-title" className="text-sm font-bold text-gray-900 leading-tight">MarketPass</h2>
        {synthetic && (
          <span className="rounded-full bg-amber-100 text-amber-800 font-semibold px-2 py-0.5" style={{ fontSize: "10px" }} data-synthetic>
            Synthetic preview data
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SegmentedArcGauge title="Price Fairness" indicator={pf} />
        <SegmentedArcGauge title="Vehicle Confidence" indicator={vc} />
      </div>
      <div className="mt-3 space-y-2 text-gray-600" style={{ fontSize: "12px" }}>
        <p data-explanation="price_fairness">{pf.explanation}</p>
        <p data-explanation="vehicle_confidence">{vc.explanation}</p>
      </div>
      <p className="mt-3 text-gray-400" style={{ fontSize: "10px" }}>
        Proposed rules, not yet approved. Assessed {contract.computedAt.slice(0, 10)}.
      </p>
    </section>
  );
}
