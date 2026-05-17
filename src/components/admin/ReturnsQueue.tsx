import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RotateCcw, CheckCircle2, XCircle, Clock, X, AlertTriangle, ShieldCheck } from "lucide-react";
import {
  assessReturn,
  computeMileageCharge,
  computeRestockingFee,
  SB766_RESTOCKING_FLOOR,
  SB766_RESTOCKING_CEILING,
  SB766_PER_MILE_FEE_CAP,
  SB766_MILEAGE_CAP,
} from "@/lib/sb766";

// ──────────────────────────────────────────────────────────────
// ReturnsQueue — dealer-facing view of SB 766 return activity.
// Reads from addendum_signings (tenant-scoped via RLS) and shows
// any row with return_status set. Acts on requested rows via
// resolve_return(signing_id, outcome, restocking, mileage, reason).
//
// Wave 14.4.2 — the resolve action now opens an inline form
// that runs the dealer's inputs through assessReturn() so the
// restocking fee and mileage charge are clamped to the
// §11713.21 caps live. Replaces window.prompt() chain which
// accepted any number and quietly let dealers exceed the
// $600 / $150 limits.
// ──────────────────────────────────────────────────────────────

interface ReturnRow {
  id: string;
  vin: string | null;
  signer_name: string | null;
  signed_at: string;
  return_status: string;
  return_window_closes_at: string | null;
  return_requested_at: string | null;
  return_reason: string | null;
  return_restocking_fee: number | null;
  return_delivery_mileage: number | null;
}

const statusTone: Record<string, string> = {
  eligible:  "border-slate-200 bg-slate-50 text-slate-700",
  requested: "border-amber-300 bg-amber-50 text-amber-900",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-900",
  denied:    "border-red-300 bg-red-50 text-red-900",
  expired:   "border-slate-200 bg-white text-slate-500",
  waived:    "border-slate-200 bg-white text-slate-500",
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

const fmtMoney = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// Days between two ISO timestamps, calendar-style (matches how
// §11713.21 reads — "three calendar days").
const calendarDaysSince = (iso: string): number => {
  const then = new Date(iso);
  const now = new Date();
  const t = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const n = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((n - t) / (1000 * 60 * 60 * 24));
};

const ReturnsQueue = () => {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState<{ row: ReturnRow; outcome: "completed" | "denied" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("addendum_signings")
      .select("id, vin, signer_name, signed_at, return_status, return_window_closes_at, return_requested_at, return_reason, return_restocking_fee, return_delivery_mileage")
      .not("return_status", "is", null)
      .order("return_requested_at", { ascending: false, nullsFirst: false })
      .order("signed_at", { ascending: false });
    setRows(((data as ReturnRow[]) || []));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitResolve = async (args: {
    id: string;
    outcome: "completed" | "denied";
    restocking: number | null;
    mileage: number | null;
    reason: string | null;
  }) => {
    const { error } = await (supabase as any).rpc("resolve_return", {
      _signing_id: args.id,
      _outcome: args.outcome,
      _restocking: args.restocking,
      _mileage: args.mileage,
      _reason: args.reason,
    });
    if (error) {
      toast.error("Couldn't resolve return.");
      return;
    }
    toast.success(args.outcome === "completed" ? "Return marked completed." : "Return denied.");
    setResolving(null);
    await load();
  };

  const requested = rows.filter(r => r.return_status === "requested");
  const other = rows.filter(r => r.return_status !== "requested");

  if (!loading && rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 mb-3">
        <RotateCcw className="w-4 h-4 text-slate-700" />
        <h3 className="text-base font-semibold text-foreground">SB 766 returns</h3>
        {requested.length > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-800 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
            {requested.length} open
          </span>
        )}
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}

      {requested.length > 0 && (
        <div className="space-y-2 mb-3">
          {requested.map(r => (
            <div key={r.id} className={`rounded-xl border p-3 ${statusTone.requested}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-bold">{r.signer_name || "Buyer"} — VIN {(r.vin || "").slice(-8)}</p>
                  <p className="text-[11px] mt-1">
                    Requested {fmtDate(r.return_requested_at)} · Window closes {fmtDate(r.return_window_closes_at)}
                  </p>
                  {r.return_reason && (
                    <p className="text-[11px] mt-1 italic">"{r.return_reason}"</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setResolving({ row: r, outcome: "completed" })}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-slate-950 text-white text-[11px] font-semibold hover:bg-slate-900"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Complete
                  </button>
                  <button
                    onClick={() => setResolving({ row: r, outcome: "denied" })}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-slate-300 text-[11px] font-semibold hover:bg-slate-100"
                  >
                    <XCircle className="w-3 h-3" /> Deny
                  </button>
                </div>
              </div>

              {resolving?.row.id === r.id && (
                <ResolvePanel
                  row={r}
                  outcome={resolving.outcome}
                  onCancel={() => setResolving(null)}
                  onSubmit={submitResolve}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {other.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-1.5">History</p>
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-[12px]">
              <tbody>
                {other.map(r => (
                  <tr key={r.id} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 border ${statusTone[r.return_status] || statusTone.eligible}`}>
                        {r.return_status === "expired" && <Clock className="w-3 h-3" />}
                        {r.return_status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{(r.vin || "").slice(-8)}</td>
                    <td className="px-3 py-2">{r.signer_name || "Buyer"}</td>
                    <td className="px-3 py-2 text-slate-500 text-right">{fmtDate(r.signed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};

// ──────────────────────────────────────────────────────────────
// ResolvePanel — inline form that pipes the dealer's inputs
// through assessReturn() and only lets them submit the
// statutory-compliant amounts. Replaces three sequential
// window.prompt() calls that had zero validation.
// ──────────────────────────────────────────────────────────────

interface ResolvePanelProps {
  row: ReturnRow;
  outcome: "completed" | "denied";
  onCancel: () => void;
  onSubmit: (args: {
    id: string;
    outcome: "completed" | "denied";
    restocking: number | null;
    mileage: number | null;
    reason: string | null;
  }) => Promise<void>;
}

const ResolvePanel = ({ row, outcome, onCancel, onSubmit }: ResolvePanelProps) => {
  const [price, setPrice] = useState<string>("");
  const [miles, setMiles] = useState<string>("");
  const [restocking, setRestocking] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const days = calendarDaysSince(row.signed_at);
  const priceNum = Number(price) || 0;
  const milesNum = Number(miles) || 0;

  // Live SB 766 assessment. The dealer sees the eligibility
  // verdict + recommended caps the moment they type numbers.
  // CA is assumed since SB 766 only governs California sales;
  // assessReturn returns applicable=false for any other state,
  // which is correct — we just surface the reason field.
  const assessment = useMemo(
    () => assessReturn({
      state: "CA",
      price: priceNum,
      miles_at_return: milesNum,
      days_since_purchase: days,
    }),
    [priceNum, milesNum, days],
  );

  // Suggested restocking pre-fills the input the first time
  // price becomes valid. Dealer can override down (never up)
  // because the §11713.21 ceiling is statutory.
  const suggestedRestocking = computeRestockingFee(priceNum);
  useEffect(() => {
    if (outcome === "completed" && suggestedRestocking.applicable && restocking === "") {
      setRestocking(String(suggestedRestocking.amount));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedRestocking.amount, outcome]);

  const restockingNum = Number(restocking) || 0;
  const restockingCapped = restockingNum > SB766_RESTOCKING_CEILING
    ? SB766_RESTOCKING_CEILING
    : restockingNum < SB766_RESTOCKING_FLOOR && restockingNum > 0
      ? SB766_RESTOCKING_FLOOR
      : restockingNum;
  const mileageCharge = computeMileageCharge(milesNum);
  const dealerRetention = restockingCapped + mileageCharge.charge;
  const refund = Math.max(0, priceNum - dealerRetention);

  const canSubmit = outcome === "denied"
    ? !!reason.trim()
    : assessment.eligible && priceNum > 0 && milesNum >= 0;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    await onSubmit({
      id: row.id,
      outcome,
      restocking: outcome === "completed" ? restockingCapped : null,
      mileage: outcome === "completed" ? mileageCharge.miles_at_return : null,
      reason: reason.trim() || null,
    });
    setSubmitting(false);
  };

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700">
          {outcome === "completed" ? "Resolve return — §11713.21 caps applied live" : "Deny return — reason required"}
        </p>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700"><X className="w-3.5 h-3.5" /></button>
      </div>

      {outcome === "completed" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Purchase price ($)">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="22000"
                className="w-full h-9 px-2 rounded-md border border-slate-300 bg-white text-sm"
              />
            </Field>
            <Field label={`Miles at return (cap: ${SB766_MILEAGE_CAP})`}>
              <input
                type="number"
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                placeholder="180"
                className="w-full h-9 px-2 rounded-md border border-slate-300 bg-white text-sm"
              />
            </Field>
          </div>

          {/* Live assessment. Renders even on empty inputs so
              the dealer learns the rule structure. */}
          <div className={`rounded-md border px-3 py-2 ${assessment.eligible ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-center gap-1.5">
              {assessment.eligible
                ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                : <AlertTriangle className="w-3.5 h-3.5 text-amber-800" />}
              <p className={`text-[11px] font-bold uppercase tracking-[0.14em] ${assessment.eligible ? "text-emerald-800" : "text-amber-900"}`}>
                {assessment.eligible ? "Eligible" : "Ineligible"}
              </p>
              <span className="text-[10px] text-slate-500">· day {days} of 3 · {milesNum} of {SB766_MILEAGE_CAP} mi</span>
            </div>
            {assessment.reason && (
              <p className="text-[11px] text-amber-900 mt-1">{assessment.reason}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`Restocking fee ($${SB766_RESTOCKING_FLOOR}–$${SB766_RESTOCKING_CEILING})`}>
              <input
                type="number"
                value={restocking}
                onChange={(e) => setRestocking(e.target.value)}
                placeholder={String(suggestedRestocking.amount)}
                className="w-full h-9 px-2 rounded-md border border-slate-300 bg-white text-sm"
              />
            </Field>
            <Field label={`Mileage charge (cap: $${SB766_PER_MILE_FEE_CAP})`}>
              <div className="h-9 px-2 inline-flex items-center rounded-md border border-slate-200 bg-slate-50 text-sm font-mono w-full">
                {fmtMoney(mileageCharge.charge)}
                {mileageCharge.charge_capped && <span className="ml-2 text-[10px] text-amber-700">capped</span>}
              </div>
            </Field>
          </div>

          <div className="rounded-md bg-slate-950 text-white px-3 py-2 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/70">Refund to buyer</div>
            <div className="font-mono text-base font-bold tabular-nums">{fmtMoney(refund)}</div>
          </div>

          <Field label="Note for the record (optional)">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. delivered to buyer's address per request"
              className="w-full h-9 px-2 rounded-md border border-slate-300 bg-white text-sm"
            />
          </Field>
        </>
      )}

      {outcome === "denied" && (
        <Field label="Reason for denial (required — kept on the audit log)">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Vehicle returned outside the 3-day window with 500 miles — exceeds §11713.21 cap of 400 mi."
            rows={3}
            className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white text-sm"
          />
        </Field>
      )}

      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="h-8 px-3 rounded-md text-[11px] font-semibold text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit || submitting}
          className={`h-8 px-3 rounded-md text-[11px] font-semibold inline-flex items-center gap-1.5 ${outcome === "completed" ? "bg-slate-950 text-white hover:bg-slate-900" : "bg-red-700 text-white hover:bg-red-800"} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {submitting ? "Submitting…" : outcome === "completed" ? "Confirm refund" : "Confirm denial"}
        </button>
      </div>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);

export default ReturnsQueue;
