import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { uploadPhoto } from "@/lib/storage";
import { AdminCard } from "@/components/admin/v2/primitives";
import { adminTabHref } from "@/lib/admin/sections";
import { IDENTITY_KEYS, US_STATES, US_TIME_ZONES, contactReadiness, headerPreview, validateIdentity } from "./brandModel";
import { useBrandForm } from "./useBrandForm";
import { BrandSaveBar } from "./BrandSaveBar";
import { ReadOnlyValue, RowField, SelectControl, TextField, controlClass } from "./fields";
import { AppearanceCard, ContactReadinessCard, HeaderPreviewCard, LogoField } from "./cards";

const STATE_OPTIONS = [{ value: "", label: "Select a state" }, ...US_STATES.map((s) => ({ value: s.code, label: s.name }))];

export default function IdentityView() {
  const form = useBrandForm(IDENTITY_KEYS, validateIdentity);
  const { draft, set, source } = form;
  const [uploading, setUploading] = useState(false);

  const zoneOptions = useMemo(() => {
    const known = US_TIME_ZONES.map((z) => ({ value: z.id, label: z.label }));
    const current = draft.dealer_timezone;
    if (current && !US_TIME_ZONES.some((z) => z.id === current)) known.push({ value: current, label: current });
    return [{ value: "", label: "Select a time zone" }, ...known];
  }, [draft.dealer_timezone]);

  const previewOpts = useMemo(() => ({ tenantName: source.tenantName, stores: source.stores, activeStoreId: source.activeStoreId }), [source.tenantName, source.stores, source.activeStoreId]);
  const savedPreview = useMemo(() => headerPreview(source.settings, previewOpts), [source.settings, previewOpts]);
  const preview = useMemo(() => headerPreview({ ...source.settings, ...draft }, previewOpts), [source.settings, draft, previewOpts]);
  const previewDiffers = preview.name !== savedPreview.name || preview.location !== savedPreview.location || preview.documentName !== savedPreview.documentName;
  const readiness = useMemo(() => contactReadiness(source.settings), [source.settings]);
  const nameError = form.errors.find((e) => /name/i.test(e)) ?? null;
  const stateError = form.errors.find((e) => /state/i.test(e)) ?? null;

  const pickLogo = async (file: File) => {
    if (!source.tenantId) { toast.error("No dealership context. Reload the page and try again."); return; }
    setUploading(true);
    try {
      const result = await uploadPhoto("dealer-logos", file, { tenantId: source.tenantId, storeId: source.activeStoreId ?? undefined, vin: "brand-logo" });
      if (!result?.url) { toast.error("The upload did not return a file address."); return; }
      // An upload is itself an explicit action, so the address is saved at
      // once rather than left as an orphaned file behind an unsaved draft.
      const ok = await source.updateSettings({ dealer_logo_url: result.url });
      set("dealer_logo_url", result.url);
      if (ok) toast.success("Logo uploaded and saved.");
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="flex items-center justify-end gap-1.5 text-[12px] leading-[18px] text-adm-muted">
        <Info className="w-4 h-4" aria-hidden="true" />
        Branding for this rooftop.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 items-start">
        <div className="space-y-4">
          <AdminCard title="Store identity" description="Basic information about this dealership. This appears across AutoLabels.">
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-6">
              <div className="space-y-3">
                <TextField label="Dealership name" value={draft.dealer_name} onChange={(v) => set("dealer_name", v)} error={nameError} autoComplete="organization" />
                <RowField label="Group" htmlFor="brand-group">
                  <ReadOnlyValue id="brand-group" value={source.tenantName ?? ""} locked placeholder="No dealer group" />
                </RowField>
                <RowField label="City" htmlFor="brand-city">
                  <input id="brand-city" value={draft.dealer_city} onChange={(e) => set("dealer_city", e.target.value)} className={controlClass} autoComplete="address-level2" />
                </RowField>
                <RowField label="State" htmlFor="brand-state">
                  <SelectControl id="brand-state" value={(draft.dealer_state || "").toUpperCase()} options={STATE_OPTIONS} onChange={(v) => set("dealer_state", v)} aria-invalid={stateError ? true : undefined} />
                  {stateError && <p className="mt-1 text-[12px] text-adm-danger">{stateError}</p>}
                </RowField>
                <RowField label="Time zone" htmlFor="brand-timezone">
                  <SelectControl id="brand-timezone" value={draft.dealer_timezone || ""} options={zoneOptions} onChange={(v) => set("dealer_timezone", v)} />
                </RowField>
              </div>
              <LogoField
                logoUrl={draft.dealer_logo_url}
                uploading={uploading}
                onPick={(f) => void pickLogo(f)}
                onRemove={() => set("dealer_logo_url", "")}
                disabled={!!form.blockedReason}
              />
            </div>
          </AdminCard>

          <AppearanceCard accent={source.settings.primary_color} editHref={adminTabHref("appearance")} />
        </div>

        <div className="space-y-4">
          <HeaderPreviewCard preview={preview} draftDiffers={previewDiffers} />
          <ContactReadinessCard rows={readiness} />
        </div>
      </div>

      <BrandSaveBar form={form} />
    </div>
  );
}
