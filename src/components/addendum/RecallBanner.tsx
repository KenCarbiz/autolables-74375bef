import { useEffect, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  Check,
  X,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import { useRecallLookup, type RecallResult } from "@/hooks/useRecallLookup";

interface Props {
  vin?: string;
  make: string;
  model: string;
  year: string;
  tenantId?: string | null;
  onStopSale?: () => void;
}

export default function RecallBanner({
  vin,
  make,
  model,
  year,
  tenantId,
  onStopSale,
}: Props) {
  const { lookup, loading } = useRecallLookup();
  const [result, setResult] = useState<RecallResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [stopSaleCalled, setStopSaleCalled] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      const res = await lookup({ vin, make, model, year, tenantId });
      setResult(res);
    };
    fetch();
  }, [year, make, model, vin, tenantId, lookup]);

  useEffect(() => {
    if (result?.hasStopSale && !stopSaleCalled) {
      onStopSale?.();
      setStopSaleCalled(true);
    }
  }, [result?.hasStopSale, onStopSale, stopSaleCalled]);

  if (loading) {
    return (
      <div className="rounded-xl px-4 py-3 bg-gray-100 text-gray-700 text-sm flex items-center gap-3">
        <div className="w-4 h-4 bg-gray-400 rounded-full animate-pulse" />
        Checking NHTSA recalls for {year} {make} {model}…
      </div>
    );
  }

  if (dismissed) return null;
  // No result yet (or the lookup returned null — e.g. recall API not
  // configured / errored): render nothing rather than dereferencing null.
  if (!result) return null;

  if (result.hasStopSale) {
    return (
      <div className="rounded-xl px-4 py-3 bg-red-100 border border-red-300 text-red-900 flex items-start gap-3">
        <AlertOctagon className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold text-sm">
            STOP SALE: Do-not-drive recall open. Vehicle cannot be sold until remedied.
          </div>
          <details className="mt-2">
            <summary className="text-sm text-red-800 cursor-pointer flex items-center gap-1">
              View recall details <ChevronDown className="w-4 h-4" />
            </summary>
            <div className="mt-2 space-y-2 text-xs bg-white bg-opacity-50 p-2 rounded">
              {result.recalls.map((r) => (
                <div key={r.campaignNumber} className="border-l-2 border-red-300 pl-2">
                  <div className="font-mono text-red-700">{r.campaignNumber}</div>
                  <div className="text-red-600">{r.component}</div>
                  <div className="line-clamp-2 text-red-700">{r.summary}</div>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    );
  }

  if (result.hasTakata) {
    return (
      <div className="rounded-xl px-4 py-3 bg-amber-100 border border-amber-300 text-amber-900 text-sm flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold">
            Takata airbag recall campaign open. Verify remedy before sale.
          </div>
          <details className="mt-2">
            <summary className="text-xs text-amber-800 cursor-pointer flex items-center gap-1">
              Details <ChevronDown className="w-4 h-4" />
            </summary>
            <div className="mt-2 space-y-2 text-xs bg-white bg-opacity-50 p-2 rounded">
              {result.recalls.map((r) => (
                <div key={r.campaignNumber} className="border-l-2 border-amber-300 pl-2">
                  <div className="font-mono text-amber-700">{r.campaignNumber}</div>
                  <div className="text-amber-600">{r.component}</div>
                  <div className="line-clamp-2 text-amber-700">{r.summary}</div>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    );
  }

  if (result.hasOpenRecall) {
    return (
      <div className="rounded-xl px-4 py-3 bg-blue-100 border border-blue-300 text-blue-900 text-sm flex items-start gap-3">
        <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold">
            {result.recalls.length} open recall(s). See details before delivery.
          </div>
          <details className="mt-2">
            <summary className="text-xs text-blue-800 cursor-pointer flex items-center gap-1">
              Details <ChevronDown className="w-4 h-4" />
            </summary>
            <div className="mt-2 space-y-2 text-xs bg-white bg-opacity-50 p-2 rounded">
              {result.recalls.map((r) => (
                <div key={r.campaignNumber} className="border-l-2 border-blue-300 pl-2">
                  <div className="font-mono text-blue-700">{r.campaignNumber}</div>
                  <div className="text-blue-600">{r.component}</div>
                  <div className="line-clamp-2 text-blue-700">{r.summary}</div>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl px-4 py-3 bg-green-100 border border-green-300 text-green-900 text-sm flex items-center gap-3">
      <Check className="w-5 h-5 flex-shrink-0" />
      <div className="flex-1">No open recalls for this vehicle.</div>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 hover:bg-green-200 rounded"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
