import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, AlertTriangle, XCircle, DollarSign, RefreshCw } from "lucide-react";
import type { PriceIntegrityAssessment, AdvertisedSource } from "@/hooks/useAdvertisedPrices";

// AddendumPriceIntegrity — the per-deal FTC price gate the dealer sees
// before "Ready for Signatures". The advertised/website price must equal
// selling price + doc fee + every pre-installed (non-removable) item; if it
// doesn't, the deal cannot be sent for signature until the dealer fixes the
// selling price, captures the right advertised price, or reclassifies a
// pre-installed line to customer-elected (so the buyer may decline it).

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const SOURCE_LABELS: Record<AdvertisedSource, string> = {
  website: "Dealer website", autotrader: "AutoTrader", cars_com: "Cars.com",
  facebook: "Facebook", cargurus: "CarGurus", truecar: "TrueCar", carfax: "CARFAX",
  capital_one: "Capital One", manual: "Manual entry", other: "Other",
};

export default function AddendumPriceIntegrity({
  assessment,
  sellingPrice,
  onSellingPriceChange,
  docFeeLabel = "Doc fee",
  vin,
  onCaptureAdvertised,
  onRescrape,
  rescraping = false,
  className = "",
}: {
  assessment: PriceIntegrityAssessment;
  sellingPrice: number | null;
  onSellingPriceChange: (n: number | null) => void;
  docFeeLabel?: string;
  vin?: string;
  onCaptureAdvertised?: (price: number, source: AdvertisedSource) => void | Promise<void>;
  onRescrape?: () => void | Promise<void>;
  rescraping?: boolean;
  className?: string;
}) {
  const [capture, setCapture] = useState("");
  const a = assessment;

  const tone =
    a.status === "ok" ? "border-emerald-200" :
    a.status === "untracked" ? "border-amber-200" :
    "border-red-200";
  const headerCls =
    a.status === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-900" :
    a.status === "untracked" ? "bg-amber-50 border-amber-200 text-amber-900" :
    "bg-red-50 border-red-200 text-red-900";
  const HeaderIcon = a.status === "ok" ? ShieldCheck : a.status === "untracked" ? AlertTriangle : XCircle;
  const title =
    a.status === "ok" ? "Price integrity verified" :
    a.status === "no_selling_price" ? "Enter the selling price to verify" :
    a.status === "untracked" ? "Advertised price not on file" :
    "Price integrity: mismatch — fix before signing";

  const submitCapture = () => {
    const n = parseFloat(capture.replace(/[^0-9.]/g, ""));
    if (!n || n <= 0 || !onCaptureAdvertised) return;
    onCaptureAdvertised(n, "manual");
    setCapture("");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-xl border ${tone} bg-white overflow-hidden ${className}`}
    >
      <div className={`flex items-center gap-3 px-4 py-3 border-b ${headerCls}`}>
        <HeaderIcon className="w-5 h-5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-semibold">{title}</p>
          <p className="text-caption opacity-80">{a.reason}</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Selling price entry */}
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Selling price (before doc fee)
          </span>
          <div className="mt-1 flex items-center gap-2">
            <div className="relative flex-1">
              <DollarSign className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                inputMode="decimal"
                value={sellingPrice == null ? "" : String(sellingPrice)}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, "");
                  onSellingPriceChange(v === "" ? null : parseFloat(v));
                }}
                placeholder="0"
                className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-3 text-sm tabular-nums"
              />
            </div>
          </div>
        </label>

        {/* The equation */}
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[12px] space-y-1">
          <Row label="Selling price" value={money(a.sellingPrice)} />
          <Row label={docFeeLabel} value={money(a.docFee)} />
          <Row
            label={`Pre-installed items (${a.includedItems.length})`}
            value={money(a.includedTotal)}
          />
          {a.includedItems.length > 0 && (
            <div className="pl-3 pt-0.5 space-y-0.5">
              {a.includedItems.map((it, i) => (
                <div key={i} className="flex justify-between text-[11px] text-muted-foreground">
                  <span className="truncate pr-2">{it.name}</span>
                  <span className="tabular-nums">{money(it.price)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1 mt-1 font-bold text-foreground">
            <span>Expected all-in price</span>
            <span className="tabular-nums">{money(a.expectedOnline)}</span>
          </div>
          {typeof a.advertised === "number" && (
            <div className="flex justify-between font-semibold">
              <span className="text-muted-foreground">
                Advertised{a.source ? ` · ${SOURCE_LABELS[a.source]}` : ""}
              </span>
              <span className="tabular-nums">{money(a.advertised)}</span>
            </div>
          )}
          {a.status === "mismatch" && (
            <div className="flex justify-between font-bold text-red-700">
              <span>Difference</span>
              <span className="tabular-nums">
                {a.delta > 0 ? "+" : "−"}{money(Math.abs(a.delta))}
              </span>
            </div>
          )}
        </div>

        {/* Resolution guidance */}
        {a.status === "mismatch" && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-900">
            <p className="font-semibold">How to resolve</p>
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              <li>Correct the selling price above, or</li>
              <li>If a pre-installed item is not in the advertised price, flip its Sale Method to <span className="font-semibold">Customer Elected</span> — the buyer may then decline it, and it drops out of the all-in total, or</li>
              <li>Capture the corrected advertised/website price below.</li>
            </ul>
          </div>
        )}

        {/* Capture / re-scrape advertised price (manual escape + refresh) */}
        {(a.status === "untracked" || a.status === "mismatch") && vin && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <DollarSign className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                inputMode="decimal"
                value={capture}
                onChange={(e) => setCapture(e.target.value)}
                placeholder="Advertised price from your website"
                className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-3 text-sm tabular-nums"
              />
            </div>
            <button
              type="button"
              onClick={submitCapture}
              disabled={!onCaptureAdvertised}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
            >
              Capture
            </button>
            {onRescrape && (
              <button
                type="button"
                onClick={onRescrape}
                disabled={rescraping}
                title="Re-scrape the dealer website for this VIN"
                className="h-9 px-2.5 rounded-md border border-border text-sm inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rescraping ? "animate-spin" : ""}`} />
                Re-scrape
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground">{label}</span>
    <span className="tabular-nums text-foreground">{value}</span>
  </div>
);
