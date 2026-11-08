import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, DetailDrawer, FieldRow, INPUT_CLASS, SelectField, StatusBadge } from "@/components/admin/v3/editor";
import type { GetReadyService } from "@/contexts/DealerSettingsContext";
import { adminTabHref } from "@/lib/admin/sections";
import { CATALOG_CURRENCY, emptyServiceDraft, formatCost, normalizeCost, requiresPhotoProof, toDraft, toEntry, validateService, type ServiceDraft } from "@/lib/admin/serviceCatalog";
import { Callout } from "../print/wizardParts";
import type { ServiceCatalog } from "./useServiceCatalog";

export const PROOF_HREF = adminTabHref("service-policy", "prep-rules");

export const ProofDrawer = ({ open, service, photoTasks, onClose }: { open: boolean; service: GetReadyService | null; photoTasks: string; onClose: () => void }) => {
  const on = service ? requiresPhotoProof(service, photoTasks) : false;
  return (
    <DetailDrawer open={open} onClose={onClose} title="Required proof" description={service?.name} footer={<AdminButton variant="secondary" onClick={onClose}>Close</AdminButton>}>
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge state={on ? "required" : "disabled"} label={on ? "Photo required" : "No proof required"} />
      </div>
      <p className="text-[14px] leading-[20px] text-adm-ink">
        {on
          ? "Service Install sign-offs for a task with this name block submit until a photo is attached."
          : "No task with this name is on the photo-proof list, so a sign-off can submit without a photo."}
      </p>
      <Callout tone="warning" icon="alert" title="Matched by task label, not by a stable id">
        The photo-proof list stores task labels. It has no task id yet, so renaming a service or a task stops the rule from matching. Check the list after any rename.
      </Callout>
      <Callout tone="neutral" icon="link" title="Edited in one place">
        The photo-proof list is edited in Service policy, under Technician sign-off rules. <Link to={PROOF_HREF} className="font-semibold text-adm-primary hover:underline max-sm:inline-flex max-sm:items-center max-sm:min-h-[44px] max-sm:px-1">Open Service policy</Link>
      </Callout>
    </DetailDrawer>
  );
};

export const ServicePanel = ({ open, editing, catalog, onClose, onProof, startInvalid = false }: { open: boolean; editing: GetReadyService | null; catalog: ServiceCatalog; onClose: () => void; onProof: (s: GetReadyService) => void; startInvalid?: boolean }) => {
  const [draft, setDraft] = useState<ServiceDraft>(emptyServiceDraft());
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(editing ? toDraft(editing) : startInvalid ? { name: "", responsible_name: "", responsible_email: "not-an-email", cost: "12,5x" } : emptyServiceDraft());
    setTouched(startInvalid);
    setSaving(false);
    setError(null);
  }, [open, editing, startInvalid]);

  const errors = useMemo(() => validateService(draft, catalog.services, editing?.name ?? null), [draft, catalog.services, editing]);
  const invalid = Object.keys(errors).length > 0;
  const set = (p: Partial<ServiceDraft>) => setDraft((d) => ({ ...d, ...p }));
  const members = (catalog.members ?? []).filter((m) => m.status === "active" && m.email);
  const renamed = !!editing && editing.name.trim().toLowerCase() !== draft.name.trim().toLowerCase();
  const proofAtRisk = renamed && !!editing && requiresPhotoProof(editing, catalog.photoTasks);
  const readOnly = !catalog.canEdit;

  const submit = async () => {
    setTouched(true);
    if (invalid || readOnly || catalog.isFixture) return;
    setSaving(true);
    const entry = toEntry(draft);
    const next = editing ? catalog.services.map((s) => (s === editing ? entry : s)) : [...catalog.services, entry];
    const r = await catalog.write(next);
    setSaving(false);
    if (r.ok) onClose();
    else setError(r.error ?? "The service could not be saved. Your entries are kept.");
  };

  if (readOnly && editing) {
    return (
      <DetailDrawer open={open} onClose={onClose} title={editing.name} description="Read only" footer={<AdminButton variant="secondary" onClick={onClose}>Close</AdminButton>}>
        <dl className="grid grid-cols-[minmax(110px,150px)_1fr] gap-x-4 gap-y-3 text-[14px] leading-[20px]">
          <dt className="text-adm-muted">Assigned to</dt><dd className="break-words">{[editing.responsible_name, editing.responsible_email].filter(Boolean).join(", ") || "Unassigned"}</dd>
          <dt className="text-adm-muted">Default internal cost</dt><dd>{formatCost(editing.cost)}</dd>
          <dt className="text-adm-muted">Required proof</dt><dd>{requiresPhotoProof(editing, catalog.photoTasks) ? "Photo required" : "None"}</dd>
        </dl>
        <Callout icon="lock" tone="neutral" title="You can view this service but not change it">{catalog.readOnlyReason}</Callout>
      </DetailDrawer>
    );
  }

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title={editing ? "Edit service" : "Add service"}
      description="An internal service for Get-Ready work. It is not billed to the buyer."
      footer={
        <>
          <AdminButton variant="secondary" onClick={onClose}>Cancel</AdminButton>
          <AdminButton variant="primary" onClick={() => void submit()} disabled={saving || readOnly || catalog.isFixture}>{saving ? "Saving" : editing ? "Save service" : "Add service"}</AdminButton>
        </>
      }
    >
      {catalog.isFixture && <p className="text-[14px] text-adm-muted">{catalog.readOnlyReason}</p>}
      <FieldRow label="Service" required error={touched ? errors.name : undefined}>
        {(p) => <input {...p} className={INPUT_CLASS} value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="Service name" />}
      </FieldRow>
      <fieldset className="space-y-4 min-w-0">
        <legend className="text-[14px] font-semibold text-adm-ink">Assigned team or person</legend>
        {catalog.membersState === "ready" && members.length > 0 && (
          <FieldRow label="Choose from your team" optional help="Fills the email below. Teams are not stored separately; the department shown comes from each person's role.">
            {(p) => (
              <SelectField {...p} value="" onChange={(e) => { const m = members.find((x) => x.id === e.target.value); if (m) set({ responsible_email: m.email, responsible_name: draft.responsible_name.trim() ? draft.responsible_name : m.email }); }}>
                <option value="">Choose a person</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.email}, {m.roleLabel}, {m.department}</option>)}
              </SelectField>
            )}
          </FieldRow>
        )}
        {catalog.membersState === "failed" && <p className="text-[13px] leading-[18px] text-adm-muted">The team list could not be loaded. Enter the team or person by hand.</p>}
        <FieldRow label="Team or person" optional error={touched ? errors.responsible_name : undefined}>
          {(p) => <input {...p} className={INPUT_CLASS} value={draft.responsible_name} maxLength={120} onChange={(e) => set({ responsible_name: e.target.value })} placeholder="Team or person" />}
        </FieldRow>
        <FieldRow label="Email" optional error={touched ? errors.responsible_email : undefined} help="Where this service is sent. An outside vendor is fine.">
          {(p) => <input {...p} type="email" className={INPUT_CLASS} value={draft.responsible_email} onChange={(e) => set({ responsible_email: e.target.value })} placeholder="Email address" />}
        </FieldRow>
      </fieldset>
      <FieldRow label={`Default internal cost (${CATALOG_CURRENCY})`} optional error={touched ? errors.cost : undefined} help={`The store's own cost in ${CATALOG_CURRENCY}. Leave blank to enter it per job.`}>
        {(p) => (
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-[14px] text-adm-muted">$</span>
            <input {...p} inputMode="decimal" className={INPUT_CLASS} value={draft.cost} onChange={(e) => set({ cost: e.target.value })} placeholder="0.00" />
            <span className="text-[14px] text-adm-muted">{CATALOG_CURRENCY}</span>
          </div>
        )}
      </FieldRow>
      {editing && (
        <div className="rounded-lg border border-adm-divider p-3 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[14px] font-semibold text-adm-ink">Required proof</p>
              <p className="text-[14px] text-adm-muted">{requiresPhotoProof(editing, catalog.photoTasks) ? "Photo required" : "None configured"}</p>
            </div>
            <AdminButton variant="secondary" onClick={() => onProof(editing)}>View proof rule</AdminButton>
          </div>
          {proofAtRisk && <Callout tone="warning" icon="alert" title="Renaming breaks the proof rule">The photo-proof list matches by label, so it will stop applying under the new name until you update it in Service policy.</Callout>}
        </div>
      )}
      <div className="rounded-lg border border-dashed border-adm-border bg-adm-workspace p-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[14px] font-semibold text-adm-ink flex items-center gap-2"><AdminIcon name="archive" size="inline" />Archive</p>
          <AdminButton variant="secondary" disabled aria-disabled="true">Archive unavailable</AdminButton>
        </div>
        <p className="text-[13px] leading-[18px] text-adm-muted">Catalog entries have no archive status in storage, so a service cannot be hidden and kept. Removing it takes it off the list for new jobs; jobs already started keep their own copy.</p>
      </div>
      {normalizeCost(draft.cost) && !errors.cost && <p className="sr-only">Cost {formatCost(draft.cost)}</p>}
      {error && <p role="alert" className="rounded-lg bg-adm-danger-bg text-adm-danger px-3 py-2 text-[14px] font-medium">{error}</p>}
    </DetailDrawer>
  );
};
