import { useState } from "react";
import { Check, AlertTriangle, Plus, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  useAdvertisedPrices,
  assessDrift,
  SOURCE_LABELS,
  type AdvertisedSource,
} from "@/hooks/useAdvertisedPrices";
import { useAuth } from "@/contexts/AuthContext";

// ──────────────────────────────────────────────────────────────
// AdvertisedPriceBand — Wave 20.
//
// Renders a one-line comparison: sticker price vs latest
// advertised price snapshot. Tone reacts to status:
//   match     → emerald (sticker matches advertised within $50)
//   drift     → rose / amber (sticker ≠ advertised, FTC §5 hook)
//   untracked → muted (no snapshot on file — capture one)
//
// Click the band to expand an inline capture form (no modal —
// the band IS the surface). Saves a new row into
// advertised_prices; the realtime invalidate updates this row
// (and every other consumer) within ~1s.
// ──────────────────────────────────────────────────────────────

interface Props {
  vin: string;
  stickerPrice: number | null | undefined;
  storeId?: string;
  // Dealer doc/conveyance fee (already baked into the MarketCheck advertised
  // price). When set we surface the breakdown: advertised = selling + doc fee.
  docFee?: number;
  // Compact mode renders just a small chip + the click target,
  // for use inside an inventory row. Default false renders the
  // full band with reason text.
  compact?: boolean;
}

const fmtMoney = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const AdvertisedPriceBand = ({ vin, stickerPrice, storeId = "", docFee = 0, compact = false }: Props) => {
  const { byVin, captureSnapshot, capturing } = useAdvertisedPrices(storeId);
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);

  const sticker = stickerPrice ?? 0;
  const ap = vin ? byVin.get(vin.toUpperCase()) : undefined;
  const drift = assessDrift(sticker, ap, docFee);
  // MarketCheck pulls the dealer's ACTUAL advertised price into the listing
  // price, so when there's no manually-captured snapshot we recognize the
  // listing price itself as the advertised price — it already includes the
  // dealer's doc/conveyance fee.
  const feedAdvertised = !ap && sticker > 0;
  const sellingBeforeFee = docFee > 0 ? sticker - docFee : null;
  const docNote = feedAdvertised
    ? (docFee > 0
        ? `Advertised ${fmtMoney(sticker)} · incl. ${fmtMoney(docFee)} doc fee · selling ${fmtMoney(sellingBeforeFee!)}`
        : `Advertised ${fmtMoney(sticker)}`)
    : "";

  const positive = drift.status === "match" || feedAdvertised;
  const toneClass =
    positive                     ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
    : drift.status === "drift"   ? "border-rose-300 bg-rose-50/70 text-rose-900"
    :                              "border-red-200 bg-red-50/70 text-red-700";

  const icon =
    positive ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
    : drift.status === "drift" ? <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.5} />
    : <X className="w-3.5 h-3.5" strokeWidth={2.5} />;

  const label =
    positive                     ? "Advertised price on file"
    : drift.status === "drift"   ? "Price drift"
    :                              "No advertised price on file";

  if (compact) {
    return (
      <div className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(e2 => !e2); }}
          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border ${toneClass}`}
          title={feedAdvertised ? docNote : drift.reason}
        >
          {icon}
          {label}
          {feedAdvertised && docFee > 0 && (
            <span className="font-mono normal-case tracking-normal ml-1">incl {fmtMoney(docFee)} doc</span>
          )}
          {drift.status === "drift" && (
            <span className="font-mono normal-case tracking-normal ml-1">
              {drift.delta > 0 ? "+" : "−"}{fmtMoney(drift.abs_delta)}
            </span>
          )}
        </button>
        {expanded && (
          <CaptureForm
            vin={vin}
            existing={ap ? ap.advertised_price : null}
            onCancel={() => setExpanded(false)}
            onSubmit={async (payload) => {
              try {
                await captureSnapshot({
                  vin,
                  advertised_price: payload.price,
                  source_label: payload.source,
                  source_url: payload.url,
                  captured_by: user?.email || "",
                });
                toast.success("Advertised price captured");
                setExpanded(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't capture");
              }
            }}
            saving={capturing}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-lg border ${toneClass} px-3 py-2`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {icon}
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em]">{label}</p>
            <p className="text-[11px] opacity-80 leading-tight mt-0.5">
              {feedAdvertised ? (
                <>
                  Advertised {fmtMoney(sticker)}
                  {docFee > 0 && <>{" · "}incl. {fmtMoney(docFee)} doc fee{" · "}selling {fmtMoney(sellingBeforeFee!)}</>}
                </>
              ) : (
                <>Sticker {fmtMoney(sticker)}</>
              )}
              {ap && (
                <>
                  {" · "}
                  Advertised {fmtMoney(ap.advertised_price)}
                  {" · "}
                  <span className="opacity-70">
                    {SOURCE_LABELS[ap.source_label]}
                    {ap.source_url && (
                      <a
                        href={ap.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        view <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </span>
                  {" · "}
                  <span className="opacity-70">
                    {new Date(ap.snapshot_at).toLocaleDateString()}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold underline-offset-2 hover:underline whitespace-nowrap"
        >
          {expanded ? "Cancel" : ap ? "Re-capture" : "Capture"}
          {!expanded && <Plus className="w-3 h-3" />}
        </button>
      </div>

      {drift.status === "drift" && (
        <p className="text-[10px] mt-1.5 leading-snug font-semibold">
          {drift.reason}
        </p>
      )}

      {expanded && (
        <div className="mt-2 pt-2 border-t border-current/15">
          <CaptureForm
            vin={vin}
            existing={ap ? ap.advertised_price : null}
            onCancel={() => setExpanded(false)}
            onSubmit={async (payload) => {
              try {
                await captureSnapshot({
                  vin,
                  advertised_price: payload.price,
                  source_label: payload.source,
                  source_url: payload.url,
                  captured_by: user?.email || "",
                });
                toast.success("Advertised price captured");
                setExpanded(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't capture");
              }
            }}
            saving={capturing}
          />
        </div>
      )}
    </div>
  );
};

interface CaptureFormProps {
  vin: string;
  existing: number | null;
  onCancel: () => void;
  onSubmit: (payload: { price: number; source: AdvertisedSource; url: string }) => Promise<void>;
  saving: boolean;
}

const CaptureForm = ({ vin, existing, onCancel, onSubmit, saving }: CaptureFormProps) => {
  const [price, setPrice] = useState<string>(existing ? String(existing) : "");
  const [source, setSource] = useState<AdvertisedSource>("website");
  const [url, setUrl] = useState<string>("");

  const valid = Number(price) > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({ price: Number(price), source, url: url.trim() });
      }}
      className="bg-card rounded-md p-3 border border-border text-foreground"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">
          Capture advertised price · VIN …{vin.slice(-8)}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Price ($)
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 23495"
            className="mt-0.5 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
            min={0}
            required
          />
        </div>
        <div>
          <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Source
          </label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as AdvertisedSource)}
            className="mt-0.5 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
          >
            {Object.entries(SOURCE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            URL (optional)
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="mt-0.5 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 rounded-md text-xs text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || saving}
          className="h-8 px-3 rounded-md bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white text-xs font-display font-black shadow-premium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Capture snapshot"}
        </button>
      </div>
    </form>
  );
};

export default AdvertisedPriceBand;
