import { useCallback, useEffect, useMemo } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button, InlineNote, LocalTabs, PageBody, PageHeader, type LocalTab } from "@/components/product";
import { useTenant } from "@/contexts/TenantContext";
import { COMPLIANCE_SECTIONS, isComplianceSection, type ComplianceSectionId } from "./complianceData";
import { useComplianceCenterData } from "./useComplianceCenterData";
import { vinDefenseHref } from "./childLinks";
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
  const { pathname } = useLocation();
  const { tenant } = useTenant();
  const data = useComplianceCenterData();

  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;

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

  const tabs: LocalTab[] = COMPLIANCE_SECTIONS.map((s) => {
    const q = new URLSearchParams();
    q.set("tab", s.id);
    return {
      key: s.id,
      label: s.label,
      to: `${pathname}?${q.toString()}`,
      count: badgeFor(s.id) || null,
      active: s.id === section,
    };
  });

  if (section === "vin-defense" && vinParam.length >= 11) return <Navigate to={vinDefenseHref(vinParam)} replace />;

  return (
    <PageBody width="wide">
      <PageHeader
        title={section === "audit" ? "Audit Log" : "Compliance"}
        description={
          section === "audit"
            ? "The immutable event record for this store."
            : "Monitor deal readiness, identify blockers, and manage regulatory requirements."
        }
        actions={
          section === "audit" || section === "vin-defense" ? undefined : (
            <Button onClick={data.refresh} disabled={data.loading}>
              <RefreshCw className={`h-5 w-5 ${data.loading ? "animate-spin" : ""}`} aria-hidden="true" /> Refresh
            </Button>
          )
        }
      />

      <LocalTabs label="Compliance sections" tabs={tabs} />

      {data.error && (
        <InlineNote
          tone="danger"
          title="Compliance data could not be loaded"
          action={<Button size="sm" onClick={data.refresh}>Retry</Button>}
        >
          {data.error}
        </InlineNote>
      )}

      {section === "overview" && (
        <OverviewSection
          overview={data.overview}
          issueRows={data.issueRows}
          loading={data.loading}
          failed={!!data.error}
          onNavigate={setSection}
        />
      )}
      {section === "issues" && <IssuesSection rows={data.issueRows} loading={data.loading} />}
      {section === "price" && <PriceIntegritySection rows={data.priceRows} loading={data.loading} />}
      {section === "vin-defense" && <VinDefenseSection rows={data.issueRows} loading={data.loading} />}
      {section === "titles" && (
        <TitlesSection rows={data.titleRows} loading={data.loading} tenantId={tenantId} />
      )}
      {section === "audit" && <AuditLogSection tenantId={tenantId} />}
      {section === "library" && <LibrarySection />}
    </PageBody>
  );
};

export default ComplianceShell;
