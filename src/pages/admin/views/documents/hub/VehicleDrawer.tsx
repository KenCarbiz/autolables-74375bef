import { useState } from "react";
import { Link } from "react-router-dom";
import { AdminButton, AdminLinkButton, InlineNote } from "@/components/admin/v2/primitives";
import { AdminIcon, DetailDrawer } from "@/components/admin/v3/editor";
import { useTenant } from "@/contexts/TenantContext";
import { useAdminFixture } from "@/lib/admin/dataSource";
import { fetchFiledDocumentAssets } from "@/hooks/useWindowSticker";
import { freshFiledDocumentUrl } from "@/lib/filedDocumentUrl";
import { isRetiredDocument } from "@/lib/commandCenter/documentSet";
import { vinKey } from "@/lib/vinKeys";
import type { HubDocRow } from "@/lib/admin/documentsHubModel";
import type { HubRow } from "./hubData";
import { useVehicleHistory } from "./useHubData";
import { DocCellChip, ReadinessChip, ServiceCellChip, docStatusLabel } from "./hubUi";

const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not recorded");

const TYPE_LABEL: Record<string, string> = { window: "Window sticker", factory_sticker: "Factory sticker", buyers_guide: "FTC Buyers Guide" };

function PrivatePreview({ vehicleId, doc }: { vehicleId: string; doc: HubDocRow }) {
  const { tenant } = useTenant();
  const fixture = useAdminFixture();
  const [state, setState] = useState<"idle" | "loading" | "missing" | "failed">("idle");
  const open = async () => {
    if (!tenant?.id || fixture) return;
    setState("loading");
    try {
      const url = await freshFiledDocumentUrl((id) => fetchFiledDocumentAssets(tenant.id, vehicleId, id), doc.id, null);
      if (!url) {
        setState("missing");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <div className="mt-2">
      <AdminButton size="sm" onClick={() => void open()} disabled={!!fixture || state === "loading"} aria-label={`Open private preview of ${TYPE_LABEL[doc.document_type] ?? doc.document_type} version ${doc.version ?? 1}`}>
        <AdminIcon name="eye" />
        {state === "loading" ? "Opening" : "Open private preview"}
      </AdminButton>
      {fixture && <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">Preview needs the signed storage grant and is not available in the design fixture.</p>}
      {state === "missing" && <p role="status" className="mt-1 text-[13px] leading-[18px] text-adm-muted">No stored file exists for this version.</p>}
      {state === "failed" && <p role="alert" className="mt-1 text-[13px] leading-[18px] text-adm-danger">The preview could not be opened. The document itself is unchanged.</p>}
    </div>
  );
}

export function VehicleDrawer({ row, open, onClose }: { row: HubRow | null; open: boolean; onClose: () => void }) {
  const { history, loading, unavailable } = useVehicleHistory(open && row ? row.listing.id : null);
  if (!row) return <DetailDrawer open={false} onClose={onClose} title="Vehicle">{null}</DetailDrawer>;
  const { listing, facts } = row;
  const title = listing.ymm?.trim() || `VIN ${vinKey(listing.vin)}`;
  const docs = history?.docs ?? [];
  const byType = (type: string) => docs.filter((d) => d.document_type === type);
  const types = Array.from(new Set(docs.map((d) => d.document_type)));

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title={title}
      description={`VIN ${vinKey(listing.vin)}${row.stock ? `, stock ${row.stock}` : row.stockUnavailable ? ", stock unavailable" : ""}`}
      footer={
        <>
          <AdminLinkButton to={`/vehicle-file/${listing.id}?tab=documents`} variant="primary">
            <AdminIcon name="upload" />
            Upload or replace in vehicle file
          </AdminLinkButton>
        </>
      }
    >
      <section aria-labelledby="hub-drawer-status" className="space-y-3">
        <h3 id="hub-drawer-status" className="text-[16px] leading-[24px] font-semibold">Status</h3>
        <div className="flex flex-wrap items-center gap-2"><ReadinessChip value={facts.readiness} /></div>
        <p className="text-[14px] leading-[20px]"><span className="text-adm-muted">Next action: </span><span className="font-medium">{facts.nextAction}</span></p>
        {facts.blockers.includes("open_recall") && <InlineNote tone="warning">The listing records {listing.open_recall_count} open recall{listing.open_recall_count === 1 ? "" : "s"}. A zero is never shown as a clean recall check here.</InlineNote>}
      </section>

      <section aria-labelledby="hub-drawer-docs" className="space-y-3">
        <h3 id="hub-drawer-docs" className="text-[16px] leading-[24px] font-semibold">Documents</h3>
        <ul className="space-y-3">
          {facts.documents.map((cell) => (
            <li key={cell.key} className="rounded-lg border border-adm-divider px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><DocCellChip cell={cell} /></div>
              {cell.doc ? (
                <>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[13px] leading-[18px]">
                    <dt className="text-adm-muted">Document ID</dt><dd className="break-all font-mono text-[13px]">{cell.doc.id}</dd>
                    <dt className="text-adm-muted">Version</dt><dd>v{cell.doc.version ?? 1}</dd>
                    <dt className="text-adm-muted">Status</dt><dd>{docStatusLabel(cell.doc.document_status)}</dd>
                    <dt className="text-adm-muted">Template</dt><dd className="break-all">{cell.doc.template_id ?? "Not recorded"}{cell.doc.template_version ? ` v${cell.doc.template_version}` : ""}</dd>
                    <dt className="text-adm-muted">Created</dt><dd>{when(cell.doc.created_at)}</dd>
                  </dl>
                  {cell.doc.rejection_reason && <p className="mt-1.5 text-[13px] leading-[18px] text-adm-danger">Rejected: {cell.doc.rejection_reason}</p>}
                  <PrivatePreview vehicleId={listing.id} doc={cell.doc} />
                  <p className="mt-2 text-[13px] leading-[18px]">
                    <Link className="font-semibold text-adm-primary hover:underline" to={`/vehicle-file/${listing.id}/documents/${cell.doc.id}`}>Open audit and approval detail</Link>
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[13px] leading-[18px] text-adm-muted">No live document of this type. Generate it from the vehicle file; this list updates from the stored record.</p>
              )}
            </li>
          ))}
        </ul>
        <p className="text-[13px] leading-[18px] text-adm-muted">Uploaded and generated files stay private. Previews are signed on demand under the existing storage grants.</p>
      </section>

      <section aria-labelledby="hub-drawer-service" className="space-y-3">
        <h3 id="hub-drawer-service" className="text-[16px] leading-[24px] font-semibold">Service</h3>
        <ServiceCellChip service={facts.service} />
        {facts.service && <p className="text-[13px] leading-[18px] text-adm-muted">{facts.service.detail}{facts.service.inspectionId ? ` Inspection record ${facts.service.inspectionId}.` : ""}</p>}
        <AdminLinkButton to={`/vehicle-file/${listing.id}?tab=compliance`} size="sm">Open compliance tab</AdminLinkButton>
      </section>

      <section aria-labelledby="hub-drawer-versions" className="space-y-3">
        <h3 id="hub-drawer-versions" className="text-[16px] leading-[24px] font-semibold">Version history</h3>
        {loading && <p role="status" className="text-[14px] text-adm-muted">Reading document versions</p>}
        {!loading && unavailable && <InlineNote tone="neutral">Version history is unavailable because the document versions could not be read. The current documents above are unaffected.</InlineNote>}
        {!loading && !unavailable && history && docs.length === 0 && <p className="text-[14px] text-adm-muted">No generated documents exist for this vehicle yet.</p>}
        {!loading && !unavailable && types.map((type) => (
          <div key={type}>
            <p className="text-[14px] leading-[20px] font-semibold">{TYPE_LABEL[type] ?? type}</p>
            <ol className="mt-1 divide-y divide-adm-divider rounded-lg border border-adm-divider">
              {byType(type).map((d) => (
                <li key={d.id} className="px-3 py-2 text-[13px] leading-[18px]">
                  <span className="font-semibold">v{d.version ?? 1}</span> {docStatusLabel(d.document_status)}
                  {isRetiredDocument(d) ? <span className="text-adm-muted"> (kept, not current)</span> : null}
                  <span className="block text-adm-muted">{when(d.created_at)} . <span className="break-all font-mono">{d.id}</span></span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>
    </DetailDrawer>
  );
}
