// ── Shadow evidence, for the dealer and for us ─────────────────────────────
//
// NOT ROUTED. This component is built and tested but reachable from nowhere:
// the route integration is proposed separately so the screen and the decision
// to expose it are two approvals, not one.
//
// What it deliberately does not have: an "evaluate" button, a budget control,
// a provider-call toggle, an edit affordance of any kind. Evidence is
// append-only and this is a window onto it.
//
// "Limited Market Evidence" appears here. That is the point — it is the honest
// internal verdict, and the banner says out loud that none of this reaches a
// customer.

import { SHADOW_REVIEW_AUDIENCE_NOTICE, type ShadowReviewRow } from "@/lib/market/shadowReview";

const money = (n: number | null) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

const days = (n: number | null) =>
  n == null ? "—" : n < 1 ? "today" : `${Math.floor(n)}d ago`;

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm text-foreground truncate ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

export default function ShadowEvidenceTable({ rows }: { rows: ShadowReviewRow[] }) {
  return (
    <section aria-label="Shadow market evaluations" className="space-y-4">
      <div
        role="note"
        className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
      >
        {SHADOW_REVIEW_AUDIENCE_NOTICE}
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No shadow evaluations recorded yet.</p>
      )}

      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-premium">
            <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-base font-semibold text-foreground">
                <span className="font-mono">{r.vin}</span>
              </h3>
              <span className="text-xs text-muted-foreground">
                {r.shadow ? "shadow" : "authorized"} · {r.invocationSource ?? "unknown source"} · {days(r.freshnessDays)}
              </span>
            </header>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Field label="Verdict" value={r.verdict ?? "—"} />
              <Field label="Status" value={r.status ?? "—"} />
              <Field label="Confidence" value={r.confidence ?? "—"} />
              <Field label="Algorithm" value={r.algorithmVersion ?? "—"} mono />

              <Field label="Advertised price" value={money(r.advertisedPrice)} />
              {/* Labelled INTERNAL in the UI, not only in the type. */}
              <Field label="Internal comparison basis" value={money(r.internalComparisonPrice)} />
              <Field label="Doc fee (inside price)" value={money(r.docFee)} />
              <Field label="Price basis" value={r.priceBasisStatus ?? "—"} />

              <Field label="Comparables (raw)" value={String(r.rawComparableCount ?? "—")} />
              <Field label="Comparables (eligible)" value={String(r.eligibleComparableCount ?? "—")} />
              <Field label="Independent rooftops" value={String(r.independentRooftopCount ?? "—")} />
              <Field label="Effective sample" value={String(r.effectiveSampleSize ?? "—")} />

              <Field label="Provider attempt" value={r.providerAttemptStatus ?? "—"} />
              <Field label="Provider prediction" value={money(r.providerPrediction)} />
              <Field label="Provider cost" value={`$${r.providerCostUsd.toFixed(4)}`} />
              <Field label="Legacy − V2" value={money(r.legacyVersusV2)} />

              <Field
                label="Certification"
                value={r.certificationConflict ? "provider conflict recorded" : "no conflict"}
              />
            </div>

            {r.abstentionReasons.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                  Abstention reasons ({r.abstentionReasons.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {r.abstentionReasons.map((reason) => (
                    <li key={reason} className="font-mono text-[11px] text-muted-foreground">{reason}</li>
                  ))}
                </ul>
              </details>
            )}

            {r.ownRooftopExclusions.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                  Own-rooftop exclusions ({r.ownRooftopExclusions.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {r.ownRooftopExclusions.map((d, i) => (
                    <li key={`${d}-${i}`} className="text-[11px] text-muted-foreground">{d}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
