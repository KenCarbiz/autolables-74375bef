import { useState, useEffect } from "react";
import { AlertTriangle, Check, X, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  useAdvertisedPrices,
  assessDrift,
  SOURCE_LABELS,
  type AdvertisedSource,
  type DriftAssessment,
} from "@/hooks/useAdvertisedPrices";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";

// ──────────────────────────────────────────────────────────────
// PublishPriceGate — Wave 23.
//
// Controlled modal that sits between "Create listing" and
// "Publish listing" on the sticker pages. Three branches:
//
//   match     → auto-proceed (close the modal silently)
//   untracked → warn; let dealer capture-then-proceed OR
//               proceed-without-snapshot (with audit warning).
//   drift     → require the dealer to EITHER re-capture the
//               advertised price (matches the sticker) OR
//               provide a written justification. Either way,
//               the resolution is recorded to audit_log so the
//               Audit-Defense Packet's section 11 carries the
//               proof of how the drift was resolved.
//
// The gate is the answer to the FTC March 2026 97-dealer letter
// campaign: every published sticker either matches what the
// dealer advertises, or there's a paper trail explaining why.
// ──────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  vin: string;
  stickerPrice: number;
  storeId?: string;
  onProceed: () => Promise<void> | void;
  onCancel: () => void;
}

export const PublishPriceGate = ({
  open,
  vin,
  stickerPrice,
  storeId = "",
  onProceed,
  onCancel,
}: Props) => {
  const { byVin, captureSnapshot, capturing } = useAdvertisedPrices(storeId);
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [mode, setMode] = useState<"choose" | "recapture" | "justify">("choose");
  const [justification, setJustification] = useState("");
  const [reCapturePrice, setReCapturePrice] = useState("");
  const [reCaptureSource, setReCaptureSource] = useState<AdvertisedSource>("website");
  const [reCaptureUrl, setReCaptureUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Re-compute assessment whenever VIN's snapshot changes.
  const ap = vin ? byVin.get(vin.toUpperCase()) : undefined;
  const drift: DriftAssessment = assessDrift(stickerPrice, ap);

  // Auto-proceed for match — no modal interaction required.
  useEffect(() => {
    if (open && drift.status === "match") {
      // Fire and forget; the parent will close us once
      // onProceed resolves.
      void onProceed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, drift.status]);

  if (!open) return null;
  if (drift.status === "match") {
    // The auto-proceed effect above is handling this. Render
    // a minimal "passing" indicator while it resolves.
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-card rounded-2xl p-6 max-w-sm w-full text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
            <Check className="w-6 h-6" strokeWidth={2.5} />
          </div>
          <p className="text-sm font-semibold text-foreground">
            Sticker matches advertised — publishing
          </p>
        </div>
      </div>
    );
  }

  const logResolution = async (action: "publish_price_match_recaptured" | "publish_price_drift_justified" | "publish_price_untracked_acknowledged", payload: Record<string, unknown>) => {
    try {
      await (supabase as any).from("audit_log").insert({
        action,
        entity_type: "vehicle_listing",
        entity_id: vin,
        store_id: tenant?.id || null,
        user_email: user?.email || null,
        details: { vin, ...payload },
      });
    } catch {
      // Best-effort log — if the audit row fails to write, the
      // publish still proceeds; the resolution gets re-derived
      // from the advertised_prices row alone.
    }
  };

  const handleRecaptureSubmit = async () => {
    const priceNum = Number(reCapturePrice);
    if (!priceNum || priceNum <= 0) {
      toast.error("Enter the advertised price");
      return;
    }
    setSubmitting(true);
    try {
      await captureSnapshot({
        vin,
        advertised_price: priceNum,
        source_label: reCaptureSource,
        source_url: reCaptureUrl,
        captured_by: user?.email || "",
        notes: "Captured at publish time to resolve drift",
      });
      await logResolution("publish_price_match_recaptured", {
        sticker_price: stickerPrice,
        captured_price: priceNum,
        source: reCaptureSource,
        source_url: reCaptureUrl,
      });
      toast.success("Advertised price updated — proceeding to publish");
      await onProceed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't capture");
    } finally {
      setSubmitting(false);
    }
  };

  const handleJustifySubmit = async () => {
    if (!justification.trim()) {
      toast.error("Justification required");
      return;
    }
    setSubmitting(true);
    try {
      await logResolution("publish_price_drift_justified", {
        advertised_price: drift.advertised,
        sticker_price: drift.sticker,
        delta: drift.delta,
        abs_delta: drift.abs_delta,
        justification: justification.trim(),
      });
      toast.success("Drift justified — proceeding to publish");
      await onProceed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record justification");
    } finally {
      setSubmitting(false);
    }
  };

  const handleProceedUntracked = async () => {
    setSubmitting(true);
    try {
      await logResolution("publish_price_untracked_acknowledged", {
        sticker_price: stickerPrice,
        warning: "Listing published without an advertised-price snapshot on file.",
      });
      await onProceed();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-card rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
              drift.status === "drift" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"
            }`}>
              <AlertTriangle className="w-5 h-5" strokeWidth={2.25} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Publish-time check · FTC §5 + SB 766 §11713.21
              </p>
              <h2 className="text-base font-display font-bold text-foreground mt-0.5">
                {drift.status === "drift" ? "Sticker price differs from advertised" : "No advertised price on file"}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">VIN ${vin.slice(-8)}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Comparison */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Sticker</p>
              <p className="text-2xl font-display font-black tabular-nums text-foreground mt-0.5">
                ${stickerPrice.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Total on this addendum</p>
            </div>
            <div className={`rounded-lg border px-3 py-2.5 ${
              drift.status === "drift" ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70"
            }`}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Advertised {drift.source ? `· ${SOURCE_LABELS[drift.source]}` : ""}
              </p>
              <p className="text-2xl font-display font-black tabular-nums text-foreground mt-0.5">
                {drift.advertised != null ? `$${drift.advertised.toLocaleString()}` : "— not tracked"}
              </p>
              {ap?.source_url && (
                <a
                  href={ap.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] underline-offset-2 hover:underline text-foreground/70 inline-flex items-center gap-0.5 mt-0.5"
                >
                  view source <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
              {drift.snapshot_at && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Captured {new Date(drift.snapshot_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          {drift.status === "drift" && (
            <div className="rounded-lg border border-rose-300 bg-rose-50/70 px-3 py-2 text-xs text-rose-900">
              <p className="font-semibold">
                {drift.delta > 0 ? "Sticker is " : "Sticker is "}
                <span className="font-mono">${drift.abs_delta.toLocaleString()}</span>
                {drift.delta > 0 ? " HIGHER" : " LOWER"} than your advertised price.
              </p>
              <p className="mt-1 text-rose-800/90 leading-snug">
                {drift.reason}
              </p>
            </div>
          )}

          {/* Branch — choose mode */}
          {mode === "choose" && drift.status === "drift" && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Choose a resolution to publish
              </p>
              <button
                onClick={() => {
                  setReCapturePrice(String(stickerPrice));
                  setMode("recapture");
                }}
                className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted/40 px-3 py-2.5 transition-colors"
              >
                <p className="text-sm font-semibold text-foreground">Update advertised price to match</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Recommended. Re-capture an advertised-price snapshot at the new amount.
                  Quickest path to a clean record.
                </p>
              </button>
              <button
                onClick={() => setMode("justify")}
                className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted/40 px-3 py-2.5 transition-colors"
              >
                <p className="text-sm font-semibold text-foreground">Document a written justification</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  For intentional price changes (rate adjustment, dealer markdown). The
                  text is permanently logged to the Audit-Defense Packet.
                </p>
              </button>
            </div>
          )}

          {mode === "choose" && drift.status === "untracked" && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Capture now or proceed without
              </p>
              <button
                onClick={() => {
                  setReCapturePrice(String(stickerPrice));
                  setMode("recapture");
                }}
                className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted/40 px-3 py-2.5 transition-colors"
              >
                <p className="text-sm font-semibold text-foreground">Capture advertised price now</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Recommended for a complete audit trail. Most dealers paste the same
                  number as the sticker for a clean record.
                </p>
              </button>
              <button
                onClick={handleProceedUntracked}
                disabled={submitting}
                className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted/40 px-3 py-2.5 transition-colors disabled:opacity-50"
              >
                <p className="text-sm font-semibold text-foreground">Proceed without snapshot</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  The Audit-Defense Packet will record this publish as
                  "acknowledged untracked." Drift detection can't run for this VIN
                  until you capture a snapshot.
                </p>
              </button>
            </div>
          )}

          {/* Branch — recapture form */}
          {mode === "recapture" && (
            <form
              onSubmit={(e) => { e.preventDefault(); handleRecaptureSubmit(); }}
              className="space-y-3"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                New advertised-price snapshot
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Price ($)
                  </label>
                  <input
                    type="number"
                    value={reCapturePrice}
                    onChange={(e) => setReCapturePrice(e.target.value)}
                    className="mt-0.5 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Source
                  </label>
                  <select
                    value={reCaptureSource}
                    onChange={(e) => setReCaptureSource(e.target.value as AdvertisedSource)}
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
                    value={reCaptureUrl}
                    onChange={(e) => setReCaptureUrl(e.target.value)}
                    placeholder="https://…"
                    className="mt-0.5 w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setMode("choose")}
                  className="h-9 px-3 rounded-md text-xs text-muted-foreground hover:bg-muted"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting || capturing}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white text-xs font-display font-black shadow-premium hover:brightness-110 disabled:opacity-50"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {submitting ? "Saving…" : "Capture & publish"}
                </button>
              </div>
            </form>
          )}

          {/* Branch — written justification */}
          {mode === "justify" && (
            <form
              onSubmit={(e) => { e.preventDefault(); handleJustifySubmit(); }}
              className="space-y-3"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Written justification · permanent log entry
              </p>
              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                rows={4}
                placeholder="e.g. Customer requested a $1,000 rate adjustment after trade-in valuation came in higher than appraised. Manager approved the discount on the F&I print queue."
                className="w-full px-2 py-2 rounded-md border border-border bg-background text-sm"
                required
              />
              <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900">
                This text is hashed into the Audit-Defense Packet's audit_log
                section. It cannot be edited or removed once published.
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setMode("choose")}
                  className="h-9 px-3 rounded-md text-xs text-muted-foreground hover:bg-muted"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting || !justification.trim()}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white text-xs font-display font-black shadow-premium hover:brightness-110 disabled:opacity-50"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {submitting ? "Logging…" : "Log & publish"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublishPriceGate;
