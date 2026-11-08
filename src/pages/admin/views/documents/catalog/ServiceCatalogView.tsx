import { useState } from "react";
import { Link } from "react-router-dom";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, DataTable, INPUT_CLASS, IconButton, SectionCard, StatusBadge, useIsNarrow, type DataColumn } from "@/components/admin/v3/editor";
import type { GetReadyService } from "@/contexts/DealerSettingsContext";
import { adminTabHref } from "@/lib/admin/sections";
import { formatCost, isUnassigned, removeService, requiresPhotoProof } from "@/lib/admin/serviceCatalog";
import { ConfirmDialog } from "@/pages/admin/views/brand/editor/parts";
import { Callout } from "../print/wizardParts";
import { PROOF_HREF, ProofDrawer, ServicePanel } from "./ServicePanels";
import { useServiceCatalog } from "./useServiceCatalog";

// Service catalog: the internal services a Get-Ready can route to a responsible party (settings.get_ready_services).
// Storage has no archive status and no task id, so removing a service is a real removal that existing jobs survive
// (they copy name, cost and routing when started), and proof rules are matched by task label.

const Assigned = ({ s }: { s: GetReadyService }) =>
  isUnassigned(s) ? (
    <span className="text-adm-muted">Unassigned</span>
  ) : (
    <span className="block min-w-0">
      <span className="block truncate max-w-[260px]" title={s.responsible_name || s.responsible_email}>{s.responsible_name || s.responsible_email}</span>
      {s.responsible_name && s.responsible_email && <span className="block truncate max-w-[260px] text-[13px] text-adm-muted" title={s.responsible_email}>{s.responsible_email}</span>}
    </span>
  );

const ProofCell = ({ s, photoTasks, onOpen }: { s: GetReadyService; photoTasks: string; onOpen: () => void }) =>
  requiresPhotoProof(s, photoTasks) ? (
    <button type="button" onClick={onOpen} className="min-h-[44px] sm:min-h-0 text-left font-medium text-adm-primary hover:underline rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary">Photo required</button>
  ) : (
    <span className="text-adm-ink">None</span>
  );

export default function ServiceCatalogView() {
  const catalog = useServiceCatalog();
  const [panel, setPanel] = useState<{ editing: GetReadyService | null } | null>(null);
  const [proof, setProof] = useState<GetReadyService | null>(null);
  const [removing, setRemoving] = useState<GetReadyService | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const narrow = useIsNarrow();
  const [query, setQuery] = useState("");
  const invalidDemo = catalog.isFixture && catalog.variant === "invalid";

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    const r = await catalog.write(removeService(catalog.services, removing.name));
    setBusy(false);
    if (r.ok) { setRemoving(null); setActionError(null); } else setActionError(r.error ?? "The service could not be removed. Nothing was changed.");
  };

  const shown = catalog.services.filter((s) => `${s.name} ${s.responsible_name} ${s.responsible_email}`.toLowerCase().includes(query.trim().toLowerCase()));

  const columns: DataColumn<GetReadyService>[] = [
    { id: "service", header: "Service", primary: true, cell: (s) => s.name || "Unnamed service" },
    { id: "assigned", header: "Assigned team/person", cell: (s) => (isUnassigned(s) ? <span className="text-adm-muted">Unassigned</span> : <Assigned s={s} />) },
    { id: "cost", header: "Default internal cost", cell: (s) => formatCost(s.cost) },
    { id: "proof", header: "Required proof", cell: (s) => <ProofCell s={s} photoTasks={catalog.photoTasks} onOpen={() => setProof(s)} /> },
    { id: "status", header: "Status", cell: (s) => (isUnassigned(s) ? <StatusBadge state="setup_required" label="Needs assignment" /> : <StatusBadge state="enabled" label="Active" />) },
    {
      id: "actions",
      header: "Actions",
      cell: (s) => (
        <div className="flex items-center gap-1">
          {catalog.canEdit ? (
            <>
              <IconButton name="edit" label={`Edit ${s.name}`} onClick={() => setPanel({ editing: s })} />
              <IconButton name="close" label={`Remove ${s.name}`} onClick={() => setRemoving(s)} />
            </>
          ) : (
            <AdminButton size="sm" variant="secondary" onClick={() => setPanel({ editing: s })}>View</AdminButton>
          )}
        </div>
      ),
    },
  ];

  if (catalog.state === "loading") return <div role="status" aria-busy="true" aria-label="Loading service catalog" className="h-48 rounded-xl border border-adm-divider bg-adm-surface animate-pulse" />;

  return (
    <div className="space-y-4">
      <Callout icon="info" title="Internal services are not billed to the buyer">These are Get-Ready jobs the store routes to a team or vendor. The cost is the store's own default, and none of it is added to the customer's price.</Callout>
      {!catalog.canEdit && catalog.state === "ready" && <Callout icon="lock" tone="neutral" title="You can view the catalog but not change it">{catalog.readOnlyReason}</Callout>}
      {actionError && <p role="alert" className="rounded-lg bg-adm-danger-bg text-adm-danger px-4 py-3 text-[14px] font-medium">{actionError}</p>}
      <SectionCard
        icon="wrench"
        title="Services"
        description={catalog.state === "ready" ? `${catalog.services.length === 1 ? "1 service" : `${catalog.services.length} services`}. Picked when a Get-Ready starts.` : undefined}
        actions={catalog.canEdit && catalog.state === "ready" ? <AdminButton variant="primary" onClick={() => setPanel({ editing: null })}><AdminIcon name="plus" />Add service</AdminButton> : undefined}
      >
        {catalog.state === "ready" && catalog.services.length > 0 && (
          <div className="relative">
            <label htmlFor="catalog-search" className="sr-only">Search services</label>
            <AdminIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-muted pointer-events-none" />
            <input id="catalog-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services" className={`${INPUT_CLASS} pl-10`} />
          </div>
        )}
        {catalog.state === "ready" && catalog.services.length > 0 && shown.length === 0 ? (
          <p className="text-[14px] text-adm-muted">No service matches "{query.trim()}".</p>
        ) : narrow && catalog.state === "ready" && shown.length > 0 ? (
          <ul aria-label="Service catalog" className="divide-y divide-adm-divider rounded-xl border border-adm-divider">
            {shown.map((s) => (
              <li key={s.name} className="px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setPanel({ editing: s })} aria-label={`Open details for ${s.name}`} className="min-h-[44px] flex-1 text-left text-[15px] font-semibold text-adm-primary break-words">{s.name || "Unnamed service"}</button>
                  {catalog.canEdit ? (
                    <div className="flex items-center -mr-2">
                      <IconButton name="edit" label={`Edit ${s.name}`} onClick={() => setPanel({ editing: s })} />
                      <IconButton name="close" label={`Remove ${s.name}`} onClick={() => setRemoving(s)} />
                    </div>
                  ) : null}
                </div>
                <div className="text-[14px] leading-[20px]"><Assigned s={s} /></div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] leading-[20px]">
                  <span><span className="text-adm-muted">Cost </span>{formatCost(s.cost)}</span>
                  <span className="text-adm-muted">Proof <ProofCell s={s} photoTasks={catalog.photoTasks} onOpen={() => setProof(s)} /></span>
                  {isUnassigned(s) ? <StatusBadge state="setup_required" label="Needs assignment" /> : <StatusBadge state="enabled" label="Active" />}
                </div>
              </li>
            ))}
          </ul>
        ) : (
        <DataTable
          caption="Service catalog"
          columns={columns}
          rows={catalog.state === "failed" ? undefined : shown}
          rowKey={(s) => s.name}
          error={catalog.state === "failed" ? { message: "The catalog could not be read from the server, so nothing is shown as empty. Reload to try again." } : null}
          emptyTitle="No services yet"
          emptyDescription="Add reconditioning, emissions, key cut and similar work, and who handles it."
          emptyAction={catalog.canEdit ? <AdminButton variant="primary" onClick={() => setPanel({ editing: null })}><AdminIcon name="plus" />Add service</AdminButton> : undefined}
          onOpenRow={(s) => setPanel({ editing: s })}
          rowLabel={(s) => s.name}
          minWidth={820}
        />
        )}
      </SectionCard>
      <p className="text-[13px] leading-[18px] text-adm-muted">Photo-proof rules are edited in <Link to={PROOF_HREF} className="font-semibold text-adm-primary hover:underline">Service policy</Link>. Other service settings are on <Link to={adminTabHref("service-policy")} className="font-semibold text-adm-primary hover:underline">Service policy</Link>.</p>

      <ServicePanel open={panel !== null || invalidDemo} editing={panel?.editing ?? null} catalog={catalog} onClose={() => setPanel(null)} onProof={(s) => setProof(s)} startInvalid={invalidDemo && panel === null} />
      <ProofDrawer open={!!proof} service={proof} photoTasks={catalog.photoTasks} onClose={() => setProof(null)} />
      <ConfirmDialog open={!!removing} title={`Remove ${removing?.name ?? "service"}?`} confirmLabel={busy ? "Removing" : "Remove service"} onCancel={() => setRemoving(null)} onConfirm={() => void confirmRemove()}>
        <p>Archive is not available for catalog entries, so this removes the service from the catalog. It is no longer offered when a Get-Ready starts.</p>
        <p><strong>Jobs already started</strong> keep their own copy of the name, cost and routing and stay readable.</p>
        {removing && requiresPhotoProof(removing, catalog.photoTasks) && <p><strong>Photo-proof rule:</strong> the Service policy list names this service. It is left as it is and will not match anything in the catalog.</p>}
        {removing && !requiresPhotoProof(removing, catalog.photoTasks) && <p>No photo-proof rule names this service.</p>}
        <p>Other services are not changed. To bring it back, add it again.</p>
      </ConfirmDialog>
    </div>
  );
}
