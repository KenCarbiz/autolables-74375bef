import { lazy, Suspense, useRef, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminIcon, ScopeLabel, type AdminIconName } from "@/components/admin/v3/editor";
import { SkeletonBlock } from "@/components/admin/v2/primitives";
import { useViewFixture } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
import { HUB_VIEWS, HUB_VIEW_LABEL, parseHubView, type HubView } from "@/lib/admin/documentsHubModel";
import { cn } from "@/lib/utils";
import { LinkRow } from "../../brand/feeds/bits";
import HubOverview from "./HubOverview";
import HubReadiness from "./HubReadiness";
import HubService from "./HubService";
import { useTenant } from "@/contexts/TenantContext";

const TemplatesView = lazy(() => import("../TemplatesView"));

const VIEW_ICON: Record<HubView, AdminIconName> = { overview: "grid", library: "file", readiness: "car", service: "wrench", settings: "settings" };

const PANEL_VIEW: Record<string, HubView> = { "factory-sticker": "library", "factory-sticker-settings": "library", "paper-size": "settings", "print-settings": "settings" };

/** A legacy link that names a panel and no view opens the view that holds that panel. */
export function viewFromParams(params: URLSearchParams): HubView {
  if (!params.get("view") && params.get("panel")) return PANEL_VIEW[params.get("panel") as string] ?? "library";
  return parseHubView(params);
}

export default function DocumentsHubView() {
  const [params, setParams] = useSearchParams();
  const fixture = useViewFixture<{ rooftopLabel?: string }>("documents-hub");
  const { tenant, currentStore } = useTenant();
  const view = viewFromParams(params);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const rooftop = fixture?.rooftopLabel ?? currentStore?.name ?? tenant?.name;

  const select = (next: HubView) => setParams((p) => { const n = new URLSearchParams(p); n.set("view", next); n.delete("vehicle"); n.delete("panel"); return n; });
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? -i : e.key === "End" ? HUB_VIEWS.length - 1 - i : 0;
    if (!move) return;
    e.preventDefault();
    const target = HUB_VIEWS[(i + move + HUB_VIEWS.length) % HUB_VIEWS.length];
    select(target);
    refs.current[target]?.focus();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ScopeLabel scope="all_rooftops" />
        <p className="text-[13px] leading-[18px] text-adm-muted">{rooftop ? `Vehicles listed for ${rooftop} and the rest of the dealer group. ` : ""}Read only: nothing on this page changes a document.</p>
      </div>

      <div role="tablist" aria-label="Documents and service views" className="flex gap-1 overflow-x-auto border-b border-adm-divider -mb-px">
        {HUB_VIEWS.map((v, i) => {
          const active = v === view;
          return (
            <button
              key={v}
              ref={(el) => { refs.current[v] = el; }}
              role="tab"
              type="button"
              id={`hub-tab-${v}`}
              aria-selected={active}
              aria-controls={`hub-panel-${v}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(v)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn("inline-flex items-center gap-2 px-4 min-h-[44px] text-[14px] leading-[20px] font-semibold whitespace-nowrap border-b-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary", active ? "border-adm-primary text-adm-primary" : "border-transparent text-adm-muted hover:text-adm-ink")}
            >
              <AdminIcon name={VIEW_ICON[v]} />
              {HUB_VIEW_LABEL[v]}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`hub-panel-${view}`} aria-labelledby={`hub-tab-${view}`} tabIndex={-1}>
        {view === "overview" && <HubOverview />}
        {view === "readiness" && <HubReadiness />}
        {view === "service" && <HubService />}
        {view === "library" && (
          <Suspense fallback={<SkeletonBlock className="h-64 w-full" />}>
            <TemplatesView section="library" />
          </Suspense>
        )}
        {view === "settings" && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <LinkRow to={adminTabHref("approval-rules")} icon="clipboard-check" title="Approval rules" description="Who approves each document and when" />
              <LinkRow to={adminTabHref("print-calibration")} icon="printer" title="Print and calibration" description="Printer profile and test sheets" />
              <LinkRow to={adminTabHref("service-policy")} icon="wrench" title="Service policy" description="Inspection, technician, recon and title" />
              <LinkRow to={adminTabHref("approvals")} icon="eye" title="Publishing approvals" description="Read-only view of publication gates" />
            </div>
            <Suspense fallback={<SkeletonBlock className="h-64 w-full" />}>
              <TemplatesView section="settings" />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
