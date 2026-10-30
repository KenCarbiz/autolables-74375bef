import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import Seo from "@/components/Seo";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useVehicleDocuments } from "@/lib/stickerStudio/useVehicleDocuments";
import {
  STATUS_META,
  allowedActions,
  transitionDocument,
  type DocumentStatus,
  type GeneratedDocument,
} from "@/lib/stickerStudio/documentWorkflow";
import { fetchFiledDocumentAssets } from "@/hooks/useWindowSticker";
import { freshFiledDocumentUrl, isSignedStorageUrl } from "@/lib/filedDocumentUrl";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";
import { Button, EmptyState, LinkButton, PageBody, PageHeader, Panel, SkeletonBlock, StatusText, Td, Th, WorkTable, type Tone } from "@/components/product";
import { Crumbs, SummaryList, fmtDateTime } from "@/components/detail/parts";

// /vehicle-file/:id/documents/:docId — one stored document version. Only the
// current, open version can be approved; superseded, archived and rejected
// versions are history and read-only. Every transition goes through
// transitionDocument, which writes the audit row.

const TYPE_LABEL: Record<string, string> = {
  window: "Window sticker",
  addendum: "Addendum",
  passport: "Vehicle passport",
  cpo_sheet: "CPO sheet",
  buyers_guide: "Buyers Guide",
  factory_sticker: "Factory build record",
};

const STATUS_TONE: Record<string, Tone> = {
  approved: "success",
  printed: "success",
  published: "success",
  pending_approval: "warning",
  rejected: "danger",
  draft: "neutral",
  superseded: "warning",
  archived: "neutral",
};

const CLOSED: DocumentStatus[] = ["superseded", "archived", "rejected"];

interface VehicleBits {
  id: string;
  vin: string;
  ymm: string | null;
  tenant_id: string | null;
}

const DocumentApproval = () => {
  const { id = "", docId = "" } = useParams<{ id: string; docId: string }>();
  const { user, isAdmin } = useAuth();
  const { tenant } = useTenant();
  const { member } = useEntitlements();
  const manager = hasDealerCapability(member?.role, "can_approve_print", isAdmin);
  const { documents, loading, available, reload } = useVehicleDocuments(id);
  const [vehicle, setVehicle] = useState<VehicleBits | null>(null);
  const [stock, setStock] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await (supabase as any).from("vehicle_listings").select("*").eq("id", id).maybeSingle();
        if (live && data) {
          setVehicle(data as VehicleBits);
          setStock(vehicleStockNumber(data) || null);
        }
      } catch {
        if (live) setVehicle(null);
      }
    })();
    return () => { live = false; };
  }, [id]);

  const doc = useMemo(() => documents.find((d) => d.id === docId) || null, [documents, docId]);
  const versions = useMemo(
    () => (doc ? documents.filter((d) => d.document_type === doc.document_type).sort((a, b) => b.version - a.version) : []),
    [documents, doc],
  );
  const current = useMemo(() => versions.find((v) => !CLOSED.includes(v.document_status)) || null, [versions]);

  const back = `/vehicle-file/${id}?tab=documents`;
  const vehicleLabel = vehicle?.ymm || "Vehicle";

  if (loading && !doc) {
    return (
      <PageBody width="wide">
        <div role="status" aria-label="Loading document" className="flex flex-col gap-3">
          <SkeletonBlock className="h-5 w-48" />
          <SkeletonBlock className="h-10 w-1/2" />
          <SkeletonBlock className="h-80 w-full" />
        </div>
      </PageBody>
    );
  }

  if (!doc) {
    return (
      <PageBody width="form">
        <Crumbs items={[{ label: "Vehicles", to: "/inventory" }, { label: "Documents", to: back }, { label: "Not found" }]} />
        <EmptyState
          title="Document version not found"
          detail={available ? "This version is not on file for this vehicle, or your store does not have access to it." : "Document history is not available for this store yet."}
          action={<LinkButton to={back} variant="primary">Back to documents</LinkButton>}
        />
      </PageBody>
    );
  }

  const label = TYPE_LABEL[doc.document_type] || doc.document_type;
  const meta = STATUS_META[doc.document_status] || STATUS_META.draft;
  const isCurrent = current?.id === doc.id;
  const actions = allowedActions(doc.document_status, manager);
  const canApprove = isCurrent && actions.includes("approve");
  const canReject = isCurrent && actions.includes("reject");
  const readOnly = !isCurrent;
  const storedUrl = doc.online_url || doc.pdf_url || doc.png_url || null;

  const open = async (d: GeneratedDocument) => {
    const stored = d.online_url || d.pdf_url || d.png_url || null;
    if (!stored) {
      toast.error("No file is stored on this version");
      return;
    }
    const fresh = tenant?.id
      ? await freshFiledDocumentUrl((documentId) => fetchFiledDocumentAssets(tenant.id, id, documentId), d.id, d.pdf_url || d.online_url || null)
      : null;
    const url = fresh || (isSignedStorageUrl(stored) ? null : stored);
    if (!url) {
      toast.error("This file could not be opened. Regenerate the document and try again.");
      return;
    }
    window.open(url, "_blank", "noopener");
  };

  const decide = async (action: "approve" | "reject") => {
    let reason: string | undefined;
    if (action === "reject") reason = window.prompt("Reason for rejection (optional)") || undefined;
    setBusy(true);
    const r = await transitionDocument({ doc, action, actorId: user?.id, reason, expectedStatus: doc.document_status });
    setBusy(false);
    if (r.ok) {
      toast.success(action === "approve" ? "Version approved" : "Version rejected");
      reload();
    } else {
      toast.error(r.error === "stale_status" ? "This version changed while you were reviewing it. Reload and try again." : r.error || "Action failed");
    }
  };

  const requirements: Array<{ label: string; ok: boolean | null; note: string }> = [
    { label: "Current version", ok: isCurrent, note: isCurrent ? "This is the open version" : `Not current${current ? `, version ${current.version} is open` : ""}` },
    { label: "Stored file on record", ok: !!storedUrl, note: storedUrl ? "A file is stored for this version" : "No file stored" },
    { label: "Approver capability", ok: manager, note: manager ? "Your role can approve and print" : "Your role cannot approve" },
  ];

  const tags = (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {label}
      <StatusText tone={STATUS_TONE[doc.document_status] || "neutral"}>{meta.label}</StatusText>
    </span>
  );

  return (
    <PageBody width="wide">
      <Seo title={`${label} version ${doc.version}`} description="One stored document version with its approval details and history." path={`/vehicle-file/${id}/documents/${doc.id}`} />
      <Crumbs
        items={[
          { label: "Vehicles", to: "/inventory" },
          { label: vehicleLabel, to: `/vehicle-file/${id}` },
          { label: "Documents", to: back },
          { label: `${label}, version ${doc.version}` },
        ]}
      />

      <PageHeader
        title={tags}
        description={`${vehicleLabel}${stock ? ` (Stock ${stock})` : ""}. Version ${doc.version}, generated ${fmtDateTime(doc.created_at)}.`}
        actions={
          <>
            <LinkButton to={back}>Back to documents</LinkButton>
            <Button onClick={() => void open(doc)} disabled={!storedUrl}>Open file</Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_300px] lg:items-start">
        <Panel title="Document preview" titleSize="sm" inset="sm">
          {doc.png_url && !isSignedStorageUrl(doc.png_url) ? (
            <img src={doc.png_url} alt={`${label} version ${doc.version}`} className="w-full rounded-[4px] border border-adm-border" />
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-adm-border bg-adm-workspace px-6 text-center">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">No preview image is stored</p>
              <p className="text-[13px] leading-[18px] text-adm-muted max-w-sm">
                The stored file opens from its own address so the preview is never a re-drawn copy of an official form.
              </p>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-6 min-w-0">
          <Panel title="Approval details" titleSize="sm" inset="sm">
            <SummaryList
              rows={[
                { label: "Status", value: <StatusText tone={STATUS_TONE[doc.document_status] || "neutral"}>{meta.label}</StatusText> },
                { label: "Version", value: doc.version },
                { label: "Created", value: fmtDateTime(doc.created_at) },
                { label: "Approved", value: doc.approved_at ? fmtDateTime(doc.approved_at) : "Not approved" },
                { label: "Printed", value: doc.printed_at ? `${fmtDateTime(doc.printed_at)}${doc.print_count ? ` (${doc.print_count})` : ""}` : "Not printed" },
                { label: "Published", value: doc.published_at ? fmtDateTime(doc.published_at) : "Not published" },
                { label: "Vehicle", value: vehicleLabel },
                { label: "VIN", value: <span className="font-mono">{vehicle?.vin || "Unknown"}</span> },
              ]}
            />
            {doc.rejection_reason && <p className="mt-2 text-[13px] leading-[18px] text-adm-danger">Rejected: {doc.rejection_reason}</p>}
          </Panel>

          <Panel title="Approval requirements" titleSize="sm" inset="sm">
            <ul className="divide-y divide-adm-border">
              {requirements.map((r) => (
                <li key={r.label} className="flex items-start justify-between gap-3 py-2 text-[14px] leading-[20px]">
                  <span className="min-w-0">
                    <span className="block text-adm-ink">{r.label}</span>
                    <span className="block text-[13px] leading-[18px] text-adm-muted">{r.note}</span>
                  </span>
                  <StatusText tone={r.ok ? "success" : "warning"}>{r.ok ? "Met" : "Not met"}</StatusText>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="flex flex-col gap-6 min-w-0">
          <Panel title="Approval actions" titleSize="sm" inset="sm">
            <div className="flex flex-col gap-2">
              <Button variant="primary" disabled={!canApprove || busy} onClick={() => void decide("approve")}>
                {busy ? "Working" : "Approve"}
              </Button>
              {canReject && (
                <Button variant="danger" disabled={busy} onClick={() => void decide("reject")}>Reject</Button>
              )}
              {readOnly && current && (
                <LinkButton to={`/vehicle-file/${id}/documents/${current.id}`} variant="outline">Open current version</LinkButton>
              )}
            </div>
            <p className="mt-3 text-[13px] leading-[18px] text-adm-muted">
              {readOnly
                ? `Historical version, read only${current ? "" : ". No open version exists for this document type."}`
                : !actions.includes("approve")
                  ? doc.document_status === "approved" || doc.document_status === "printed" || doc.document_status === "published"
                    ? "This version is already approved."
                    : manager
                      ? "Submit this version for approval from the documents list first."
                      : "Your role cannot approve documents."
                  : "Approval is recorded with your name and the time."}
            </p>
          </Panel>

          <Panel title="Approval history" titleSize="sm" inset="sm" flush>
            <div className="px-4 pb-4">
              <WorkTable caption="Versions of this document" minWidth={300}>
                <thead>
                  <tr><Th>Version</Th><Th>Status</Th><Th>Created</Th></tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <Td className="whitespace-nowrap font-semibold">
                        {v.id === doc.id ? `v${v.version}` : <Link to={`/vehicle-file/${id}/documents/${v.id}`} className="text-adm-primary hover:underline">v{v.version}</Link>}
                      </Td>
                      <Td><StatusText tone={STATUS_TONE[v.document_status] || "neutral"}>{STATUS_META[v.document_status]?.label || v.document_status}</StatusText></Td>
                      <Td className="whitespace-nowrap text-adm-muted">{v.created_at ? new Date(v.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Unknown"}</Td>
                    </tr>
                  ))}
                </tbody>
              </WorkTable>
            </div>
          </Panel>
        </div>
      </div>
    </PageBody>
  );
};

export default DocumentApproval;
