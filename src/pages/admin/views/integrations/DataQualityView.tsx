import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { countDisplay, HEALTH_META, type CountValue } from "@/lib/admin/health";
import { summarizeDataQuality } from "@/lib/admin/integrations/dataQuality";
import { loadDataQualityCounts } from "@/lib/admin/integrations/queries";
import { AdminCard, AdminTable, InlineNote, SectionTitle, SkeletonBlock, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import MarketcheckDataHealthCard from "@/components/admin/MarketcheckDataHealthCard";
import { useViewer } from "./common";

// Data quality: tenant-scoped counts over active inventory, each with the
// exact screen where the problem is fixed. A count that could not be read
// stays Unavailable; nothing here is ever rendered as zero by default.

export interface DataQualityViewFixture {
  counts: Record<string, CountValue>;
}

export default function DataQualityView() {
  const fixture = useViewFixture<DataQualityViewFixture>("data-quality");
  const now = useAdminNow();
  const viewer = useViewer();
  const tenantId = fixture ? null : viewer.tenantId;

  const live = useQuery({
    queryKey: ["admin-v2", "data-quality", tenantId],
    enabled: !fixture && !!tenantId,
    staleTime: 60_000,
    queryFn: () => loadDataQualityCounts(tenantId as string, now),
  });

  const counts: Record<string, CountValue> | null = fixture ? fixture.counts : live.data ?? (live.isError ? {} : null);
  const summary = useMemo(() => (counts ? summarizeDataQuality(counts) : null), [counts]);

  if (!summary) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading data quality">
        <SkeletonBlock className="h-12 w-full" />
        <SkeletonBlock className="h-72 w-full" />
      </div>
    );
  }

  const tone = HEALTH_META[summary.state].tone;

  return (
    <div className="space-y-4">
      <SectionTitle title="Data quality" description="Checks over active inventory for this rooftop. Each row links to the screen where it is fixed." />
      <InlineNote tone={summary.state === "healthy" ? "success" : tone} title={summary.headline}>
        {summary.unavailable > 0 ? "Unavailable counts are not zero; they could not be read." : "Counts exclude archived vehicles."}
      </InlineNote>
      <AdminCard title="Checks" flush>
        <AdminTable caption="Data quality checks">
          <thead>
            <tr>
              <Th>Check</Th>
              <Th align="right">Count</Th>
              <Th>Affects</Th>
              <Th>Status</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.check.id}>
                <Td>
                  <p className="font-semibold text-adm-ink">{row.check.label}</p>
                  <p className="text-[12px] leading-[18px] text-adm-muted">{row.check.description}</p>
                </Td>
                <Td align="right" className="font-semibold">{countDisplay(row.count)}</Td>
                <Td className="text-adm-muted">{row.check.affectedOutput}</Td>
                <Td><StatusChip tone={row.tone}>{row.count.kind === "known" ? (row.count.value === 0 ? "Clear" : row.check.severity === "info" ? "Context" : "Needs attention") : HEALTH_META[row.state].label}</StatusChip></Td>
                <Td><Link to={row.check.destination} className="font-semibold text-adm-primary hover:underline">{row.check.destinationLabel}</Link></Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </AdminCard>

      {viewer.canManageSettings && tenantId && (
        <div className="space-y-3">
          <SectionTitle as="h3" title="Market data refresh tools" description="Manual enrichment for this rooftop. Each button starts provider calls immediately and counts against the monthly quota; prefer the scheduled jobs." />
          <MarketcheckDataHealthCard />
        </div>
      )}
    </div>
  );
}
