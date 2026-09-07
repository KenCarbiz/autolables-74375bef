import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { getStateCompliance } from "@/data/stateCompliance";
import { resolveOperatingState } from "@/lib/dealerState";
import { COMPLIANCE_SECTIONS, isComplianceSection, type ComplianceSectionId } from "./complianceData";
import { useComplianceCenterData } from "./useComplianceCenterData";
import OverviewSection from "./OverviewSection";
import IssuesSection from "./IssuesSection";
import PriceIntegritySection from "./PriceIntegritySection";
import VinDefenseSection from "./VinDefenseSection";
import TitlesSection from "./TitlesSection";
import AuditLogSection from "./AuditLogSection";
import LibrarySection from "./LibrarySection";

// ──────────────────────────────────────────────────────────────
// The single compliance surface. /compliance, /compliance-center
// and /titles all render this shell and differ only in which
// section they open on, so the dealership has one place to stand
// instead of four pages that each know part of the answer.
// ──────────────────────────────────────────────────────────────

export const ComplianceShell = ({ defaultSection }: { defaultSection: ComplianceSectionId }) => {
  const [params, setParams] = useSearchParams();
  const { tenant, currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const data = useComplianceCenterData();

  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const dealerState = resolveOperatingState(settings, currentStore?.state);
  const compliance = getStateCompliance(dealerState);
  const storeName = currentStore?.name || settings.dealer_name || "Your dealership";

  const vinParam = (params.get("vin") || "").toUpperCase();
  const tabParam = params.get("tab");
  const section: ComplianceSectionId = isComplianceSection(tabParam)
    ? tabParam
    : vinParam
      ? "vin-defense"
      : defaultSection;

  const setSection = useCallback(
    (next: ComplianceSectionId) => {
      const q = new URLSearchParams(params);
      q.set("tab", next);
      if (next !== "vin-defense") q.delete("vin");
      setParams(q, { replace: true });
    },
    [params, setParams],
  );

  const openVin = useCallback(
    (vin: string) => {
      const q = new URLSearchParams(params);
      q.set("tab", "vin-defense");
      q.set("vin", vin);
      setParams(q, { replace: true });
    },
    [params, setParams],
  );

  // A legacy /compliance-center?filter=… link lands on Issues; the filter
  // vocabulary lives in that section now, so the stale param is dropped.
  useEffect(() => {
    if (params.get("filter") && !tabParam) {
      const q = new URLSearchParams(params);
      q.delete("filter");
      q.set("tab", "issues");
      setParams(q, { replace: true });
    }
  }, [params, tabParam, setParams]);

  const badges = useMemo(
    () => ({
      issues: data.issueRows.filter((r) => r.issues.length > 0).length,
      price: data.priceRows.filter((r) => r.state === "differs" || r.openFlags > 0).length,
      titles: data.titleRows.filter((r) => r.state !== "on_file").length,
    }),
    [data.issueRows, data.priceRows, data.titleRows],
  );

  const badgeFor = (id: ComplianceSectionId): number | null => {
    if (id === "issues") return badges.issues;
    if (id === "price") return badges.price;
    if (id === "titles") return badges.titles;
    return null;
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 lg:p-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-foreground" strokeWidth={2} />
          <h1 className="text-al-page font-display text-foreground">Compliance</h1>
        </div>
        <p className="max-w-3xl text-al-body text-muted-foreground">
          {storeName}
          {compliance.stateName ? ` · ${compliance.stateName}` : dealerState ? ` · ${dealerState}` : ""}
          {" · "}
          {compliance.docFeeTerminology}
          {compliance.docFeeMaxCap !== null ? ` capped at $${compliance.docFeeMaxCap}` : ""}
          {compliance.carsActState ? " · California SB 766 takes effect October 1, 2026" : ""}
        </p>
      </header>

      <nav className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        {COMPLIANCE_SECTIONS.map((s) => {
          const active = s.id === section;
          const badge = badgeFor(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              title={s.blurb}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-al-meta font-bold uppercase tracking-label transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {s.label}
              {badge != null && badge > 0 && (
                <span
                  className={`rounded-full px-1.5 tabular-nums ${
                    active ? "bg-background/20" : "bg-muted text-foreground"
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={data.refresh}
          disabled={data.loading}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-al-meta font-bold text-foreground hover:bg-muted disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${data.loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </nav>

      {data.error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
          <div>
            <p className="text-al-card text-destructive">Compliance data could not be loaded</p>
            <p className="text-al-body text-muted-foreground">{data.error}</p>
          </div>
        </div>
      )}

      {section === "overview" && (
        <OverviewSection
          overview={data.overview}
          issueRows={data.issueRows}
          loading={data.loading}
          onNavigate={setSection}
          onOpenVin={openVin}
        />
      )}
      {section === "issues" && <IssuesSection rows={data.issueRows} loading={data.loading} />}
      {section === "price" && <PriceIntegritySection rows={data.priceRows} loading={data.loading} />}
      {section === "vin-defense" && (
        <VinDefenseSection initialVin={vinParam} tenantId={tenantId} tenantName={tenant?.name || null} />
      )}
      {section === "titles" && (
        <TitlesSection rows={data.titleRows} loading={data.loading} tenantId={tenantId} />
      )}
      {section === "audit" && <AuditLogSection tenantId={tenantId} />}
      {section === "library" && <LibrarySection />}
    </div>
  );
};

export default ComplianceShell;
