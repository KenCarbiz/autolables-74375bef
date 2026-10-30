import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Crumbs, DetailLayout, SummaryList, fmtDateTime } from "@/components/detail/parts";
import { Button, LinkButton, LocalTabs, PageBody, PageHeader, Panel, QueryState, StatusText, Td, Th, WorkTable } from "@/components/product";
import { useTenant } from "@/contexts/TenantContext";
import { vehicleLabel } from "./complianceData";
import { formatDateTime } from "./primitives";
import { complianceVinParam } from "./childLinks";
import { latestSourceTime, useEvidencePacket } from "./useEvidencePacket";
import { useComplianceCenterData } from "./useComplianceCenterData";

type TabId = "evidence" | "activity" | "exports";

interface EvidenceLine {
  label: string;
  description: string;
  count: number;
  section: string | null;
}

const ActivityTable = ({ rows }: { rows: { id?: string; action?: string; user_email?: string | null; created_at?: string; entity_type?: string }[] }) => (
  <Panel title={`Audit events (${rows.length})`} flush inset="sm">
    {rows.length === 0 ? (
      <p className="px-4 pb-4 text-[14px] leading-[20px] text-adm-muted">No audit events name this VIN.</p>
    ) : (
      <WorkTable caption="Audit events" minWidth={560}>
        <thead>
          <tr>
            <Th>Date and time</Th>
            <Th>Actor</Th>
            <Th>Action</Th>
            <Th>Entity</Th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={r.id ?? i}>
              <Td className="whitespace-nowrap">{fmtDateTime(r.created_at)}</Td>
              <Td>{r.user_email || "System"}</Td>
              <Td>{r.action ?? "Unknown"}</Td>
              <Td>{r.entity_type ?? "Unknown"}</Td>
            </tr>
          ))}
        </tbody>
      </WorkTable>
    )}
  </Panel>
);

export default function VinDefensePage() {
  const { vin: raw } = useParams<{ vin: string }>();
  const vin = complianceVinParam(raw);
  const [params] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: TabId = tabParam === "activity" ? "activity" : tabParam === "exports" ? "exports" : "evidence";
  const { tenant } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const data = useComplianceCenterData();
  const { packet, docs, receipts, building, receipt, assemble, exportHtml, exportJson } = useEvidencePacket(vin, tenantId, tenant?.name || null);
  const listing = data.listings.find((l) => l.vin === vin) ?? null;
  const title = listing ? vehicleLabel(listing) : null;
  const base = `/compliance/vin-defense/${vin}`;

  const sectionData = (name: string) => packet?.sections.find((s) => s.name === name)?.data;
  const lines: EvidenceLine[] = useMemo(() => {
    if (!packet) return [];
    const s = packet.summary;
    return [
      { label: "Price snapshots", description: "Advertised price captures with source and time", count: s.advertised_price_snapshot_count, section: "11-advertised-prices" },
      { label: "Window stickers", description: "Generated stickers carrying this VIN", count: docs.stickers, section: null },
      { label: "Addendums", description: `${s.signed_addendum_count} signed`, count: s.addendum_count, section: "03-addendums" },
      { label: "Buyers Guide", description: "FTC Used Car Rule guide", count: docs.buyersGuides, section: null },
      { label: "Customer elections", description: "Add-on acceptance proof", count: packet.sections.find((x) => x.name === "12-addon-elections")?.count ?? 0, section: "12-addon-elections" },
      { label: "Installation proof", description: `${s.install_signature_count} installer signature(s)`, count: s.install_photo_count, section: "13-install-proofs" },
      { label: "Signatures", description: "Customer and co-buyer signings", count: s.customer_signing_count, section: "04-signings" },
      { label: "Documents", description: "Title, MCO and dealer-only files", count: docs.vehicleDocuments.length, section: null },
      { label: "Audit events", description: "Immutable log entries for this VIN", count: s.audit_event_count, section: "08-audit-log" },
    ];
  }, [packet, docs]);

  const total = lines.reduce((n, l) => n + l.count, 0);
  const complete = lines.filter((l) => l.count > 0).length;
  const missing = lines.length - complete;
  const status: "loading" | "ready" = building && !packet ? "loading" : "ready";
  const auditRows = (sectionData("08-audit-log") as { id?: string; action?: string; user_email?: string | null; created_at?: string; entity_type?: string }[] | undefined) ?? [];

  return (
    <PageBody width="wide">
      <Crumbs items={[{ label: "Compliance", to: "/compliance" }, { label: "VIN defense", to: "/compliance?tab=vin-defense" }, { label: vin }]} />
      <PageHeader
        title={title ? `VIN defense — ${title.split(" ").slice(0, 3).join(" ")}` : "VIN defense"}
        description={<span className="font-mono">VIN {vin}</span>}
        inlineMeta
        meta={
          packet ? (
            <span className="flex items-center gap-6">
              <span>Last assembled<br /><span className="text-[13px] font-medium text-adm-ink">{fmtDateTime(packet.manifest.generated_at)}</span></span>
              <span>Status<br /><StatusText tone={missing === 0 ? "success" : "warning"}>{missing === 0 ? "Complete" : "Incomplete"}</StatusText></span>
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button variant="primary" onClick={() => void assemble()} disabled={building || vin.length < 11}>{building ? "Assembling" : "Assemble packet"}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">More <ChevronDown className="h-5 w-5" aria-hidden="true" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!packet} onSelect={exportJson}>Export raw JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <LocalTabs
        label="VIN defense"
        tabs={[
          { key: "evidence", label: "Evidence packet", to: base, active: tab === "evidence" },
          { key: "activity", label: "Activity", to: `${base}?tab=activity`, active: tab === "activity" },
          { key: "exports", label: "Export history", to: `${base}?tab=exports`, count: receipts.length || null, active: tab === "exports" },
        ]}
      />
      <QueryState status={status} emptyTitle="No packet" onRetry={() => void assemble()}>
        {packet && tab === "evidence" && (
          <DetailLayout
            main={
              <Panel flush inset="sm" className="overflow-hidden">
                <WorkTable caption="Evidence packet">
                  <thead>
                    <tr>
                      <Th>Section</Th>
                      <Th>Description</Th>
                      <Th align="right">Artifacts</Th>
                      <Th className="whitespace-nowrap">Latest source time</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.label} className="[&>td]:!py-2.5">
                        <Td className="whitespace-nowrap font-medium">{l.label}</Td>
                        <Td className="max-w-[200px] truncate text-adm-muted">{l.description}</Td>
                        <Td align="right">{l.count}</Td>
                        <Td className="whitespace-nowrap pr-3">{l.section ? formatDateTime(latestSourceTime(sectionData(l.section))) : "Unknown"}</Td>
                        <Td><StatusText tone={l.count > 0 ? "success" : "danger"}>{l.count > 0 ? "Complete" : "Missing"}</StatusText></Td>
                      </tr>
                    ))}
                  </tbody>
                </WorkTable>
              </Panel>
            }
            aside={
              <Panel title="Packet summary" inset="sm">
                <>
                  <SummaryList
                    rows={[
                      { label: "Total artifacts", value: total },
                      { label: "Complete sections", value: `${complete} / ${lines.length}` },
                      { label: "Missing items", value: missing },
                      { label: "Last assembled", value: fmtDateTime(packet.manifest.generated_at) },
                    ]}
                  />
                <h3 className="mt-4 border-t border-adm-border pt-3 text-[15px] font-semibold text-adm-ink">Integrity verification</h3>
                  <SummaryList
                    rows={[
                      { label: "SHA-256 root", value: <code className="font-mono text-[12px]">{packet.manifest.chain_root.slice(0, 16)}</code> },
                      { label: "Sections hashed", value: packet.manifest.sections.length },
                      { label: "Receipts on record", value: receipts.length },
                      { label: "Status", value: receipt === packet.manifest.chain_root ? "Receipt recorded" : "Not exported this session" },
                    ]}
                  />
                  {!packet.summary.has_listing && (
                    <p className="mt-3 text-[13px] leading-[18px] text-adm-warning">No vehicle listing exists for this VIN under this store. Confirm the VIN before relying on this packet.</p>
                  )}
                  <Button variant="outline" className="mt-4 w-full" onClick={exportHtml}>Export packet (HTML)</Button>
                </>
              </Panel>
            }
          />
        )}
        {packet && tab === "activity" && <ActivityTable rows={auditRows} />}
        {packet && tab === "exports" && (
          <Panel title={`Export history (${receipts.length})`} flush inset="sm">
            {receipts.length === 0 ? (
              <p className="px-4 pb-4 text-[14px] leading-[20px] text-adm-muted">No evidence packet has been exported for this VIN yet. Exporting records a receipt of the chain root.</p>
            ) : (
              <WorkTable caption="Export history" minWidth={560}>
                <thead>
                  <tr>
                    <Th>Exported</Th>
                    <Th>Chain root</Th>
                    <Th>Version</Th>
                    <Th>Matches current</Th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap">{fmtDateTime(r.created_at)}</Td>
                      <Td><code className="font-mono text-[12px]">{r.chain_root.slice(0, 24)}</code></Td>
                      <Td>{r.packet_version}</Td>
                      <Td><StatusText tone={r.chain_root === packet.manifest.chain_root ? "success" : "warning"}>{r.chain_root === packet.manifest.chain_root ? "Intact" : "Changed since export"}</StatusText></Td>
                    </tr>
                  ))}
                </tbody>
              </WorkTable>
            )}
          </Panel>
        )}
        {!packet && !building && (
          <Panel><p className="p-4 text-[14px] text-adm-muted">Enter a full VIN to assemble its packet. <LinkButton to="/compliance?tab=vin-defense" variant="ghost" size="sm">Back to VIN defense</LinkButton></p></Panel>
        )}
      </QueryState>
    </PageBody>
  );
}
