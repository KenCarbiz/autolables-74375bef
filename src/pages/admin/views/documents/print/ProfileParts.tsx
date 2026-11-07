import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, AdminIconTile, BlockedFeatureNotice, DetailDrawer, FieldRow, INPUT_CLASS, ScopeLabel, SelectField, StatusBadge } from "@/components/admin/v3/editor";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { DEFAULT_CALIBRATION } from "@/lib/stickerStudio/printConfig";
import { PAPER_FORMATS, VERIFY_MIGRATION_ID, confirmationView, formatLength, isAdjusted, validateProfileDraft, type PrintProfile } from "@/lib/admin/printWizard";
import type { PrintProfiles } from "./usePrintProfiles";

const dateText = (iso: string | null): string => {
  if (!iso) return "Not saved yet";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

export const wizardHref = (p: PrintProfile | null): string => `${ADMIN_CHILD_ROUTES.printCalibration}${p ? `?profile=${p.locationId ?? "default"}` : ""}`;

export const ProfileCard = ({ profile, data, onEdit, onReset, onDelete }: { profile: PrintProfile; data: PrintProfiles; onEdit: () => void; onReset: () => void; onDelete: () => void }) => {
  const view = confirmationView(profile);
  const cal = profile.calibration;
  const rooftop = profile.locationId !== null;
  return (
    <li className="rounded-xl bg-adm-surface border border-adm-divider shadow-[0_1px_2px_rgba(27,43,59,0.06)] p-4 sm:p-5 space-y-4 min-w-0" data-profile-card={profile.locationId ?? "default"}>
      <div className="flex items-start gap-3">
        <AdminIconTile name="printer" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[18px] leading-[26px] font-semibold text-adm-ink break-words">{profile.printerName || "Unnamed printer"}</h3>
          <ScopeLabel scope={rooftop ? "rooftop" : "all_rooftops"} rooftopName={data.rooftopLabel(profile.locationId)} />
        </div>
        <StatusBadge state={view.state === "confirmed" ? "enabled" : "unavailable"} label={view.label} />
      </div>
      <dl className="grid grid-cols-[minmax(96px,128px)_1fr] gap-x-4 gap-y-2 text-[14px] leading-[20px]">
        <dt className="text-adm-muted">Paper</dt>
        <dd>{PAPER_FORMATS.map((f) => `${f.name} ${f.sizeLabel}`).join(", ")}</dd>
        <dt className="text-adm-muted">Alignment</dt>
        <dd className="tabular-nums">{isAdjusted(cal) ? `${formatLength(cal.xOffsetIn, "in")} right, ${formatLength(cal.yOffsetIn, "in")} down, ${cal.scalePct} percent` : "No adjustment"}</dd>
        <dt className="text-adm-muted">Last saved</dt>
        <dd>{dateText(profile.updatedAt)}</dd>
        <dt className="text-adm-muted">Confirmed</dt>
        <dd>{view.state === "confirmed" ? `${dateText(profile.verification.deployed ? profile.verification.verifiedAt : null)}` : view.reason}</dd>
      </dl>
      {rooftop && <p className="text-[13px] leading-[18px] text-adm-muted">Printing reads the dealership default profile today. A rooftop profile is saved but not applied to prints yet.</p>}
      <div className="flex flex-wrap gap-2">
        {data.canEdit && <Link to={wizardHref(profile)} className="inline-flex items-center justify-center gap-2 rounded-md min-h-[36px] max-sm:min-h-[44px] px-3.5 text-[14px] font-semibold bg-adm-primary text-white border border-adm-primary hover:bg-adm-primary-hover"><AdminIcon name="wrench" />Set up printer</Link>}
        {data.canEdit && <AdminButton variant="secondary" onClick={onEdit} aria-label={`Edit ${profile.printerName || "this printer"}`}><AdminIcon name="edit" />Edit</AdminButton>}
        {data.canEdit && <AdminButton variant="secondary" onClick={onReset} disabled={!isAdjusted(cal)} aria-label={`Reset alignment for ${profile.printerName || "this printer"}`}><AdminIcon name="refresh" />Reset</AdminButton>}
        {data.canEdit && <AdminButton variant="danger" onClick={onDelete} aria-label={`Delete ${profile.printerName || "this printer"}`}><AdminIcon name="close" />Delete</AdminButton>}
      </div>
    </li>
  );
};

export const ProfileDrawer = ({ open, editing, data, onClose, startInvalid = false }: { open: boolean; editing: PrintProfile | null; data: PrintProfiles; onClose: () => void; startInvalid?: boolean }) => {
  const free = useMemo(
    () => [
      ...(data.profiles.some((p) => p.locationId === null) ? [] : [{ key: "default", label: `${data.rooftopLabel(null)} (dealership default)` }]),
      ...data.rooftops.filter((r) => !data.profiles.some((p) => p.locationId === r.id)).map((r) => ({ key: r.id, label: r.name })),
    ],
    [data],
  );
  const [name, setName] = useState("");
  const [scope, setScope] = useState("default");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.printerName ?? "");
    setScope(editing ? (editing.locationId ?? "default") : (free[0]?.key ?? "default"));
    setError(null);
    setTouched(startInvalid);
    setSaving(false);
  }, [open, editing, free, startInvalid]);

  const locationId = scope === "default" ? null : scope;
  const errors = validateProfileDraft({ printerName: name, locationId }, data.profiles, editing?.id ?? null);
  const invalid = Object.keys(errors).length > 0;
  const base = editing?.calibration ?? DEFAULT_CALIBRATION;
  const unchanged = !!editing && (editing.printerName ?? "") === name.trim();

  const submit = async () => {
    setTouched(true);
    if (invalid || unchanged || !data.canEdit || data.isFixture) return;
    setSaving(true);
    const r = await data.save(locationId, { ...base, printerName: name.trim() });
    setSaving(false);
    if (r.ok) onClose();
    else setError(r.error ?? "The profile could not be saved. Your entries are kept.");
  };

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title={editing ? "Edit printer profile" : "Add printer profile"}
      description="Saves this location's profile only. Other profiles are not changed."
      footer={
        <>
          <AdminButton variant="secondary" onClick={onClose}>Cancel</AdminButton>
          <AdminButton variant="primary" onClick={() => void submit()} disabled={saving || !data.canEdit || data.isFixture || (!editing && free.length === 0) || unchanged}>{saving ? "Saving" : editing ? "Save profile" : "Add profile"}</AdminButton>
        </>
      }
    >
      {data.isFixture && <p className="text-[14px] text-adm-muted">{data.readOnlyReason}</p>}
      {!editing && free.length === 0 ? (
        <p className="text-[14px] leading-[20px] text-adm-ink">Every location already has a profile. Edit one of them instead.</p>
      ) : (
        <>
          <FieldRow label="Location" error={touched ? errors.locationId : undefined} help={editing ? "A profile stays with its location." : "Each location holds one printer profile."}>
            {(p) => (
              <SelectField {...p} value={scope} disabled={!!editing} onChange={(e) => setScope(e.target.value)}>
                {(editing ? [{ key: editing.locationId ?? "default", label: data.rooftopLabel(editing.locationId) }] : free).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </SelectField>
            )}
          </FieldRow>
          <FieldRow label="Printer label" required error={touched ? errors.printerName : undefined} help="A label for people. It does not connect to a printer.">
            {(p) => <input {...p} className={INPUT_CLASS} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Printer label" disabled={!data.canEdit} />}
          </FieldRow>
          <FieldRow label="Paper format" help="Both formats share one alignment per profile.">
            {() => <p className="text-[14px] leading-[20px] text-adm-ink">{PAPER_FORMATS.map((f) => `${f.name} ${f.sizeLabel} (${f.use.toLowerCase()})`).join(", ")}</p>}
          </FieldRow>
          <FieldRow label="Profile name" optional>
            {(p) => <input {...p} className={INPUT_CLASS} value="" disabled placeholder="Profile name" readOnly />}
          </FieldRow>
          <BlockedFeatureNotice migrationId={VERIFY_MIGRATION_ID} feature="Separate profile name" />
          {error && <p role="alert" className="rounded-lg bg-adm-danger-bg text-adm-danger px-3 py-2 text-[14px] font-medium">{error}</p>}
        </>
      )}
    </DetailDrawer>
  );
};
