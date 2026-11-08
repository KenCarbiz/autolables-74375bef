import { useState } from "react";
import { Link } from "react-router-dom";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, BlockedFeatureNotice, EditorEmpty, ScopeLabel, SectionCard } from "@/components/admin/v3/editor";
import { adminTabHref } from "@/lib/admin/sections";
import { VERIFY_MIGRATION_ID, resetAdjustments, type PrintProfile } from "@/lib/admin/printWizard";
import { ConfirmDialog } from "@/pages/admin/views/brand/editor/parts";
import { Callout } from "./print/wizardParts";
import { ProfileCard, ProfileDrawer, wizardHref } from "./print/ProfileParts";
import { usePrintProfiles } from "./print/usePrintProfiles";

// Print & Calibration: one card per saved printer profile (dealer_print_settings, one row per location), the
// guided Set up printer wizard, and honest status. A profile is a print offset, not proof of a connected
// printer, and nothing here marks one verified.

export default function PrintCalibrationView() {
  const data = usePrintProfiles();
  const [drawer, setDrawer] = useState<{ editing: PrintProfile | null } | null>(null);
  const [resetting, setResetting] = useState<PrintProfile | null>(null);
  const [deleting, setDeleting] = useState<PrintProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const invalidDemo = data.isFixture && data.variant === "invalid";

  const confirmReset = async () => {
    if (!resetting) return;
    setBusy(true);
    const r = await data.save(resetting.locationId, resetAdjustments(resetting.calibration));
    setBusy(false);
    if (r.ok) { setResetting(null); setActionError(null); } else setActionError(r.error ?? "The alignment could not be reset. Nothing was changed.");
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const r = await data.remove(deleting.id);
    setBusy(false);
    if (r.ok) { setDeleting(null); setActionError(null); } else setActionError(r.error ?? "The profile could not be deleted. Nothing was changed.");
  };

  if (data.state === "loading" || data.state === "no-tenant") {
    return <div role="status" aria-busy="true" aria-label="Loading printer profiles" className="h-48 rounded-xl border border-adm-divider bg-adm-surface animate-pulse" />;
  }

  const hasDefault = data.profiles.some((p) => p.locationId === null);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ScopeLabel scope="rooftop" rooftopName={data.tenantName ?? "This dealership"} />
        <div className="flex gap-2 flex-wrap">
          {data.canEdit && data.state === "ready" && <AdminButton variant="secondary" onClick={() => setDrawer({ editing: null })}><AdminIcon name="plus" />Add profile</AdminButton>}
          {data.canEdit && data.state === "ready" && <Link to={wizardHref(data.profiles[0] ?? null)} className="inline-flex items-center justify-center gap-2 rounded-md min-h-[36px] max-sm:min-h-[44px] px-3.5 text-[14px] font-semibold bg-adm-primary text-white border border-adm-primary hover:bg-adm-primary-hover"><AdminIcon name="wrench" />Set up printer</Link>}
        </div>
      </div>

      {!data.canEdit && <Callout icon="lock" tone="neutral" title="You can view printer profiles but not change them">{data.readOnlyReason ?? "Sign in to a dealership to change printer profiles."}</Callout>}
      {actionError && <p role="alert" className="rounded-lg bg-adm-danger-bg text-adm-danger px-4 py-3 text-[14px] font-medium">{actionError}</p>}

      {data.state === "failed" ? (
        <div className="rounded-xl bg-adm-surface border border-adm-divider"><EditorEmpty tone="danger" title="Could not load printer profiles" description={data.error ?? "Nothing was changed."} action={<AdminButton variant="secondary" onClick={data.reload}>Try again</AdminButton>} /></div>
      ) : data.profiles.length === 0 ? (
        <div className="rounded-xl bg-adm-surface border border-adm-divider">
          <EditorEmpty
            artwork="documents"
            title="No printer profile yet"
            description="Printing uses no offset until a profile is saved. Set up a printer to print a test sheet and align it."
            action={data.canEdit ? <Link to={wizardHref(null)} className="inline-flex items-center justify-center gap-2 rounded-md min-h-[44px] px-4 text-[14px] font-semibold bg-adm-primary text-white border border-adm-primary hover:bg-adm-primary-hover"><AdminIcon name="wrench" />Set up printer</Link> : undefined}
          />
        </div>
      ) : (
        <SectionCard icon="printer" title="Printer profiles" description={`${data.profiles.length === 1 ? "1 profile" : `${data.profiles.length} profiles`}. Each location keeps its own alignment, and changing one never changes another.`}>
          <ul className="grid grid-cols-1 xl:grid-cols-2 gap-4" aria-label="Printer profiles">
            {data.profiles.map((p) => (
              <ProfileCard key={p.id} profile={p} data={data} onEdit={() => setDrawer({ editing: p })} onReset={() => setResetting(p)} onDelete={() => setDeleting(p)} />
            ))}
          </ul>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard icon="info" title="Before you print">
          <ul className="space-y-2 text-[14px] leading-[20px] text-adm-ink list-disc pl-5">
            <li>Your browser's print dialog chooses the physical printer. Pick the printer named on the profile.</li>
            <li>Print at <strong>Actual size</strong> (100%) with <strong>Headers and footers</strong> turned off.</li>
            <li>Any signed-in member of this dealership can change printer profiles; changes are not limited by role.</li>
            <li>A profile does not prove a printer is connected or that printed margins match. Only a printed test sheet checked by a person does.</li>
          </ul>
          <p className="text-[13px] leading-[18px] text-adm-muted">Label templates and paper size are on <Link to={adminTabHref("templates")} className="font-semibold text-adm-primary hover:underline">Templates</Link>.{!hasDefault && data.profiles.length > 0 ? " Printing uses the dealership default profile, and none is saved yet." : ""}</p>
        </SectionCard>
        <SectionCard icon="shield-check" title="Test sheet and confirmation">
          <BlockedFeatureNotice migrationId={VERIFY_MIGRATION_ID} feature="Test sheet record, profile name and confirmed alignment">
            <p className="text-[13px] leading-[18px] text-adm-muted">Until then every profile reads Not verified and test prints are not recorded. Offsets and scale still save.</p>
          </BlockedFeatureNotice>
        </SectionCard>
      </div>

      <ProfileDrawer open={drawer !== null || invalidDemo} editing={drawer?.editing ?? null} data={data} onClose={() => setDrawer(null)} startInvalid={invalidDemo} />
      <ConfirmDialog open={!!resetting} title="Reset this profile's alignment?" confirmLabel={busy ? "Resetting" : "Reset alignment"} onCancel={() => setResetting(null)} onConfirm={() => void confirmReset()}>
        <p>{resetting?.printerName || "This printer"} at {resetting ? data.rooftopLabel(resetting.locationId) : ""} goes back to no offset and 100 percent scale. Its printer label, safe margins and guides are kept.</p>
        <p>Other profiles are not changed.</p>
      </ConfirmDialog>
      <ConfirmDialog open={!!deleting} title="Delete this printer profile?" confirmLabel={busy ? "Deleting" : "Delete profile"} onCancel={() => setDeleting(null)} onConfirm={() => void confirmDelete()}>
        <p>{deleting?.printerName || "This printer"} at {deleting ? data.rooftopLabel(deleting.locationId) : ""} is removed. {deleting?.locationId === null ? "Printing then uses no offset until you save a new default profile." : "Other profiles are not changed."}</p>
        <p>Stickers, templates and signed documents are not changed.</p>
      </ConfirmDialog>
    </div>
  );
}
