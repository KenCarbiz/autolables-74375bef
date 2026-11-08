import { Link } from "react-router-dom";
import { AdminButton, InlineNote } from "@/components/admin/v2/primitives";
import { AdminIcon, AdminIconTile, EditorEmpty, type AdminIconName } from "@/components/admin/v3/editor";
import { adminTabHref } from "@/lib/admin/sections";
import { OVERVIEW_CARD_FILTER, overlapStatement, overviewCounts, writeHubFilters, DEFAULT_HUB_FILTERS, type OverviewCardKey } from "@/lib/admin/documentsHubModel";
import { cn } from "@/lib/utils";
import { useHubOverview } from "./useHubData";
import { ReadinessChip } from "./hubUi";
import { useDocumentsReadiness } from "../readiness";

const CARDS: Array<{ key: OverviewCardKey; label: string; hint: string; icon: AdminIconName; tone: string }> = [
  { key: "needs_attention", label: "Needs attention", hint: "Rejected document, failed K-208 or open recall", icon: "alert", tone: "text-adm-danger bg-adm-danger-bg" },
  { key: "missing_documents", label: "Missing documents", hint: "A required document has not been started", icon: "file-plus", tone: "text-adm-warning bg-adm-warning-bg" },
  { key: "service_incomplete", label: "Service incomplete", hint: "K-208 not signed on Used and CPO", icon: "wrench", tone: "text-adm-primary bg-adm-selected" },
  { key: "ready", label: "Ready", hint: "Every document and inspection is finished", icon: "check-circle", tone: "text-adm-success bg-adm-success-bg" },
];

const VALUE: Record<OverviewCardKey, "needsAttention" | "missingDocuments" | "serviceIncomplete" | "ready"> = {
  needs_attention: "needsAttention",
  missing_documents: "missingDocuments",
  service_incomplete: "serviceIncomplete",
  ready: "ready",
};

export const hubHref = (view: string, filters: Partial<typeof DEFAULT_HUB_FILTERS> = {}, base = "?tab=templates"): string => {
  const params = writeHubFilters(new URLSearchParams(base), { ...DEFAULT_HUB_FILTERS, ...filters });
  params.set("view", view);
  return `/admin?${params.toString()}`;
};

export default function HubOverview() {
  const data = useHubOverview(true);
  const readiness = useDocumentsReadiness();
  const counts = data.rows && data.complete ? overviewCounts(data.rows) : null;
  const partial = !!data.rows && !data.complete;
  const queue = data.rows?.filter((r) => r.facts.readiness === "needs_attention").slice(0, 5) ?? [];

  return (
    <div className="space-y-4">
      {data.error && <InlineNote tone="danger" title="Vehicle counts could not be read" action={<AdminButton size="sm" onClick={data.refetch}>Try again</AdminButton>}>This is a failed read, not zero vehicles. The cards show Unknown until it succeeds.</InlineNote>}
      {partial && <InlineNote tone="warning" title="Counts are partial">This dealership has more vehicles or records than one read returns, so the cards show Unknown instead of a clipped total.</InlineNote>}

      <section aria-label="Documents and service summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map((c) => {
          const value = counts ? counts[VALUE[c.key]] : null;
          const empty = counts?.totalActive === 0;
          return (
            <Link
              key={c.key}
              to={hubHref("readiness", OVERVIEW_CARD_FILTER[c.key])}
              className="group rounded-xl border border-adm-divider bg-adm-surface p-4 sm:p-5 flex items-start gap-3 min-w-0 hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary"
            >
              <span aria-hidden="true" className={cn("inline-grid place-items-center w-11 h-11 rounded-[10px] flex-shrink-0", c.tone)}><AdminIcon name={c.icon} size="card" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-[20px] font-medium text-adm-muted">{c.label}</span>
                <span className={cn("block tabular-nums", value === null ? "text-[22px] leading-[30px] font-semibold text-adm-muted" : "text-[28px] leading-[34px] font-bold text-adm-ink")}>{data.loading && !data.rows ? "…" : value === null ? "Unknown" : value.toLocaleString()}</span>
                <span className="block text-[13px] leading-[18px] text-adm-muted">{empty ? "No active vehicles" : c.hint}</span>
              </span>
              <span className="sr-only">. Opens the filtered vehicle list.</span>
              <AdminIcon name="chevron-right" className="mt-1 text-adm-muted group-hover:text-adm-ink flex-shrink-0" />
            </Link>
          );
        })}
      </section>
      {counts && <p className="text-[13px] leading-[18px] text-adm-muted">{counts.totalActive.toLocaleString()} active {counts.totalActive === 1 ? "vehicle" : "vehicles"}. {overlapStatement(counts)}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start">
        <section aria-labelledby="hub-queue" className="rounded-xl bg-adm-surface border border-adm-divider">
          <header className="flex items-start justify-between gap-3 px-4 sm:px-6 pt-5 pb-4 border-b border-adm-divider">
            <div className="min-w-0">
              <h2 id="hub-queue" className="text-[18px] leading-[26px] font-semibold">Work queue</h2>
              <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">Vehicles that need a person first. Opens the full filtered list.</p>
            </div>
            <Link to={hubHref("readiness", OVERVIEW_CARD_FILTER.needs_attention)} className="text-[14px] font-semibold text-adm-primary hover:underline whitespace-nowrap min-h-[44px] sm:min-h-0 inline-flex items-center">View all</Link>
          </header>
          {data.loading && !data.rows ? (
            <div role="status" aria-busy="true" className="px-6 py-5 space-y-3"><span className="sr-only">Loading work queue</span>{[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-md bg-adm-workspace animate-pulse" aria-hidden="true" />)}</div>
          ) : !data.rows ? (
            <EditorEmpty tone="danger" title="The work queue is unavailable" description="Vehicles could not be read, so nothing is shown as clear." />
          ) : queue.length === 0 ? (
            <EditorEmpty artwork="documents" title={counts?.totalActive === 0 ? "No active vehicles" : "Nothing needs attention"} description={counts?.totalActive === 0 ? "Vehicles appear here once inventory is imported or added." : "No vehicle has a rejected document, a failed K-208 or an open recall."} />
          ) : (
            <ul className="divide-y divide-adm-divider">
              {queue.map((r) => (
                <li key={r.key}>
                  <Link to={hubHref("readiness", { q: r.listing.vin }) + `&vehicle=${encodeURIComponent(r.listing.id)}`} className="flex items-center gap-3 px-4 sm:px-6 py-3 min-h-[56px] hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] leading-[20px] font-semibold">{r.listing.ymm?.trim() || `VIN ${r.listing.vin}`}</span>
                      <span className="block text-[13px] leading-[18px] text-adm-muted">VIN {r.listing.vin}{r.stock ? ` . Stock ${r.stock}` : r.stockUnavailable ? " . Stock unavailable" : ""} . {r.facts.nextAction}</span>
                    </span>
                    <ReadinessChip value={r.facts.readiness} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="hub-setup" className="rounded-xl bg-adm-surface border border-adm-divider">
          <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-adm-divider">
            <h2 id="hub-setup" className="text-[18px] leading-[26px] font-semibold">Setup that affects documents</h2>
            <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">Printing, templates and disclosures are separate. A printing issue does not block digital approval.</p>
          </header>
          <ul className="divide-y divide-adm-divider">
            {readiness.items.map((item) => (
              <li key={item.key}>
                <Link to={item.key === "calibration" ? adminTabHref("print-calibration") : item.key === "templates" ? hubHref("library") : adminTabHref("products")} className="flex items-center gap-3 px-4 sm:px-6 py-3 min-h-[56px] hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary">
                  <AdminIconTile name={item.key === "calibration" ? "printer" : item.key === "templates" ? "file" : "shield-check"} tone="neutral" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-[20px] font-semibold">{item.label}</span>
                    <span className="block text-[13px] leading-[18px] text-adm-muted">{item.chip}: {item.detailValue}</span>
                  </span>
                  <AdminIcon name="chevron-right" className="text-adm-muted flex-shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
