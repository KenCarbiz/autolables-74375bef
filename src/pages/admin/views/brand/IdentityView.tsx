import { useMemo, useState } from "react";
import { AdminIcon, BlockedFeatureNotice, FieldRow, INPUT_CLASS, SectionCard, SelectField, StatusBadge, type ReviewChangeRow } from "@/components/admin/v3/editor";
import { adminTabHref } from "@/lib/admin/sections";
import type { EditorDraftChange } from "@/lib/admin/useEditorDraft";
import type { DraftErrors } from "@/lib/admin/useEditorDraft";
import { isValidTimeZone, timeZoneGroups } from "@/lib/admin/brand/timezones";
import { normalizeStateCode } from "@/lib/dealerState";
import { formatDealerPhone } from "@/lib/dealerIdentity";
import wordmarkReverse from "@/assets/admin-v2/brand/wordmark-reverse.svg";
import { US_STATES, contactReadiness, fieldLabel, headerPreview } from "./brandModel";
import { BrandEditorFrame, LoadingState } from "./editor/BrandEditorFrame";
import { settingsWriter, useBrandEditor, useBrandEditorContext } from "./editor/useBrandEditor";
import { EditLink, OwnedValue, PreviewFrame, ReadinessList, Segmented, SourceLine, type ReadinessItem } from "./editor/parts";
import { useRooftops } from "./editor/useRooftops";

interface IdentityDraft extends Record<string, unknown> {
  dealer_name: string;
  dealer_city: string;
  dealer_state: string;
  dealer_timezone: string;
}

const KEYS = ["dealer_name", "dealer_city", "dealer_state", "dealer_timezone"] as const;
const LEGAL_NAME_MIGRATION = "20261114000000";

const validate = (d: IdentityDraft): DraftErrors<IdentityDraft> => {
  const e: DraftErrors<IdentityDraft> = {};
  const name = (d.dealer_name || "").trim();
  if (!name) e.dealer_name = "Enter the public display name. It prints on documents and stickers.";
  else if (name.length > 120) e.dealer_name = "Use 120 characters or fewer.";
  const state = (d.dealer_state || "").trim();
  if (state && !normalizeStateCode(state)) e.dealer_state = "Choose a US state.";
  const tz = (d.dealer_timezone || "").trim();
  if (tz && !isValidTimeZone(tz)) e.dealer_timezone = "Choose a time zone from the list. It must be a valid IANA name such as America/New_York.";
  return e;
};

const describe = (c: EditorDraftChange<IdentityDraft>): ReviewChangeRow => ({ id: c.key, label: fieldLabel(c.key), before: String(c.before ?? ""), after: String(c.after ?? "") });

const STATE_NAME = (code: string) => US_STATES.find((s) => s.code === normalizeStateCode(code))?.name ?? code;

type PreviewKind = "header" | "document" | "passport";

export default function IdentityView() {
  const ctx = useBrandEditorContext();
  const { source, settings } = ctx;
  const rooftops = useRooftops(ctx);
  const [kind, setKind] = useState<PreviewKind>("header");

  const baseline = useMemo<IdentityDraft | undefined>(
    () => (source.loading && !ctx.fixture ? undefined : { dealer_name: settings.dealer_name || "", dealer_city: settings.dealer_city || "", dealer_state: normalizeStateCode(settings.dealer_state) || settings.dealer_state || "", dealer_timezone: settings.dealer_timezone || "" }),
    [source.loading, ctx.fixture, settings.dealer_name, settings.dealer_city, settings.dealer_state, settings.dealer_timezone],
  );
  const write = useMemo(() => settingsWriter(source), [source]);
  const editor = useBrandEditor<IdentityDraft>({ ctx, baseline, validate, write, describe });
  const draft = editor.draft;
  const disabled = !ctx.editable;

  const previewOpts = useMemo(() => ({ tenantName: source.tenantName, stores: source.stores, activeStoreId: source.activeStoreId }), [source.tenantName, source.stores, source.activeStoreId]);
  const preview = useMemo(() => headerPreview({ ...settings, ...(draft ?? {}) }, previewOpts), [settings, draft, previewOpts]);
  const savedPreview = useMemo(() => headerPreview(settings, previewOpts), [settings, previewOpts]);
  const differs = preview.name !== savedPreview.name || preview.location !== savedPreview.location || preview.documentName !== savedPreview.documentName;
  const readiness = useMemo(() => contactReadiness(settings), [settings]);

  if (!draft) return <LoadingState />;

  const zones = timeZoneGroups(draft.dealer_timezone);
  const errors = editor.errors as Record<string, string | undefined>;
  const rooftop = rooftops.rooftops.find((r) => r.id === source.activeStoreId) ?? null;
  const activeStore = source.activeStoreId ? source.stores.find((s) => s.id === source.activeStoreId) : undefined;
  const storeCity = activeStore?.city?.trim();
  const locationDiverges = !!storeCity && storeCity.toLowerCase() !== (draft.dealer_city || "").trim().toLowerCase();

  const items: ReadinessItem[] = readiness.map((r) => ({
    key: r.key,
    label: r.label,
    value: r.value,
    ready: r.state === "ready",
    editTo: r.editHref,
    reason: r.key === "sales_phone" && settings.dealer_phone ? `A main phone, ${formatDealerPhone(settings.dealer_phone) || settings.dealer_phone}, is saved on Hours & Contact, but customer routing reads the sales number set in Contact & Routing.` : undefined,
  }));

  return (
    <BrandEditorFrame
      ctx={ctx}
      editor={editor}
      scopeNote="Display name, city, state and time zone are saved once for the account and apply to every rooftop."
      impact="The application header, documents, stickers and the customer Passport read these values the next time they load."
      previewLabel="Identity preview"
      preview={
        <>
          <PreviewFrame title="Identity preview" draft={differs} caption={differs ? "This preview shows unsaved changes. Apply them to change what people see." : "This preview shows the saved identity."}>
            <Segmented label="Preview surface" value={kind} onChange={setKind} options={[{ value: "header", label: "App header" }, { value: "document", label: "Document" }, { value: "passport", label: "Passport" }]} />
            {kind === "header" && (
              <div>
                <div className="rounded-lg bg-adm-sidebar px-5 py-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5 min-h-[88px]" aria-label="Application header preview">
                  <img src={wordmarkReverse} alt="AutoLabels" className="h-[21px] w-auto flex-shrink-0" />
                  <span className="h-px w-10 sm:h-10 sm:w-px bg-white/25 flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0 text-white">
                    <p className="text-[18px] leading-[24px] font-semibold break-words" data-parity="dealer-identity">{preview.name || "Dealership name"}</p>
                    <p className="text-[14px] leading-[20px] text-white/80 break-words" data-parity="dealer-identity">{preview.location || "City, State"}</p>
                  </div>
                </div>
                <div className="mt-2"><SourceLine>{preview.nameSource === "store" ? "The header names the active rooftop from Store settings." : preview.nameSource === "group" ? "The header names the dealer group because no rooftop is active." : preview.nameSource === "settings" ? "The header names the display name saved here." : "No name is saved yet."}</SourceLine></div>
              </div>
            )}
            {kind === "document" && (
              <div>
                <div className="rounded-lg border border-adm-border bg-white px-5 py-4 text-[#142338]" aria-label="Document masthead preview">
                  {preview.logoUrl ? <img src={preview.logoUrl} alt="Dealership logo" className="h-10 w-auto max-w-[200px] object-contain" /> : null}
                  <p className="text-[18px] leading-[24px] font-bold break-words" data-parity="dealer-identity">{preview.documentName || "Dealership name"}</p>
                  <p className="text-[14px] leading-[20px] text-[#475569]">{preview.location || "City, State"}</p>
                </div>
                <div className="mt-2"><SourceLine>Documents print the display name saved here, with the logo from Appearance.</SourceLine></div>
              </div>
            )}
            {kind === "passport" && (
              <div>
                <div className="rounded-lg border border-adm-border bg-white px-4 py-3 flex items-center justify-between gap-3 text-[#142338]" aria-label="Customer Passport header preview">
                  <span className="text-[14px] leading-[20px] font-bold">AutoLabels</span>
                  <span className="text-[14px] leading-[20px] font-semibold text-right break-words min-w-0" data-parity="dealer-identity">{preview.documentName || "Dealership name"}</span>
                </div>
                <div className="mt-2"><SourceLine>The customer Passport header shows the display name saved here.</SourceLine></div>
              </div>
            )}
            {preview.warnings.length > 0 && (
              <ul className="space-y-1.5" aria-label="Identity warnings">
                {preview.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-[13px] leading-[18px] text-adm-ink">
                    <AdminIcon name="alert" size="inline" className="mt-px text-adm-warning" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </PreviewFrame>

          <section aria-label="Contact readiness" className="rounded-xl border border-adm-divider bg-adm-surface p-4 sm:p-5 space-y-3">
            <h2 className="text-[16px] leading-[22px] font-semibold text-adm-ink">Contact readiness</h2>
            <p className="text-[13px] leading-[18px] text-adm-muted">Each contact is read from the editor that owns it.</p>
            <ReadinessList items={items} label="Contact readiness" />
          </section>
        </>
      }
    >
      <SectionCard icon="building" title="Names" description="The legal name and the public name are different values with different owners.">
        <FieldRow label="Legal name" help={<SourceLine>Shared dealer profile (onboarding_profiles.legal_name). Used on legal and compliance documents once stored.</SourceLine>}>
          {(p) => <input {...p} className={INPUT_CLASS} value="" placeholder="Not stored yet" disabled readOnly />}
        </FieldRow>
        <BlockedFeatureNotice migrationId={LEGAL_NAME_MIGRATION} feature="Legal name" />
        <FieldRow label="Public display name" required error={errors.dealer_name} help={<SourceLine>Dealer settings (dealer_name), saved once for the account. Printed on documents, stickers and the Passport header.</SourceLine>}>
          {(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_name} disabled={disabled} autoComplete="organization" onChange={(e) => editor.set("dealer_name", e.target.value)} />}
        </FieldRow>
      </SectionCard>

      <SectionCard icon="layers" title="Group and rooftop" description="These come from the account and Store settings. They are shown here so you can see what each surface reads, and they are not edited on this page.">
        <div className="grid gap-4 md:grid-cols-2">
          <OwnedValue label="Dealer group" value={source.tenantName ?? ""} empty="No dealer group" source="Account (tenants.name). Shared by every rooftop." />
          <OwnedValue
            label="Active rooftop"
            value={rooftop?.displayName || ctx.rooftopName || ""}
            empty="No rooftop selected"
            source={rooftop ? "Rooftop registry (dealer_stores.display_name)." : "Store settings (rooftop name). The header shows this name."}
            editTo={adminTabHref("store-settings")}
            editLabel="Store settings"
          />
          {rooftop && <OwnedValue label="Rooftop legal name" value={rooftop.legalName ?? ""} empty="Not recorded for this rooftop" source="Rooftop registry (dealer_stores.legal_name)." />}
        </div>
        {rooftops.state === "unavailable" && !ctx.fixture && (
          <p className="text-[14px] leading-[20px] text-adm-muted">The rooftop registry names are not readable for your role or are not set up yet, so only the Store settings name is shown.</p>
        )}
        {rooftops.state === "unavailable" && ctx.fixture && (
          <p className="text-[14px] leading-[20px] text-adm-muted">No rooftop registry rows in this fixture variant, so only the Store settings name is shown.</p>
        )}
      </SectionCard>

      <SectionCard icon="pin" title="Location and time zone" description="One editor for city and state, so documents and the header cannot disagree.">
        <div className="grid gap-4 md:grid-cols-2">
          <FieldRow label="City" optional help={<SourceLine>Dealer settings (dealer_city).</SourceLine>}>
            {(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_city} disabled={disabled} autoComplete="address-level2" onChange={(e) => editor.set("dealer_city", e.target.value)} />}
          </FieldRow>
          <FieldRow label="State" error={errors.dealer_state} help={<SourceLine>Dealer settings (dealer_state). Drives state compliance rules.</SourceLine>}>
            {(p) => (
              <SelectField {...p} value={draft.dealer_state} disabled={disabled} onChange={(e) => editor.set("dealer_state", e.target.value)}>
                <option value="">Select a state</option>
                {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </SelectField>
            )}
          </FieldRow>
        </div>
        {locationDiverges && (
          <p role="note" className="flex items-start gap-2 text-[14px] leading-[20px] text-adm-ink">
            <AdminIcon name="alert" size="inline" className="mt-0.5 text-adm-warning" />
            <span>Store settings lists {activeStore?.name} in {storeCity}. Documents use the city above. Update the rooftop in Store settings if they should match.</span>
          </p>
        )}
        <FieldRow label="Time zone" error={errors.dealer_timezone} help={<SourceLine>Dealer settings (dealer_timezone), stored as an IANA identifier. Deadlines and hours are read in this zone.</SourceLine>}>
          {(p) => (
            <SelectField {...p} value={draft.dealer_timezone} disabled={disabled} onChange={(e) => editor.set("dealer_timezone", e.target.value)}>
              <option value="">Select a time zone</option>
              {zones.unknownCurrent && <option value={zones.unknownCurrent}>{zones.unknownCurrent} (not a valid zone)</option>}
              <optgroup label="United States">{zones.us.map((z) => <option key={z.id} value={z.id}>{z.label} - {z.id}</option>)}</optgroup>
              {zones.other.length > 0 && <optgroup label="All other time zones">{zones.other.map((z) => <option key={z} value={z}>{z}</option>)}</optgroup>}
            </SelectField>
          )}
        </FieldRow>
        <p className="text-[14px] leading-[20px] text-adm-muted">
          Street address, ZIP, phone and website are edited on <EditLink to={adminTabHref("hours-contact")}>Hours & Contact</EditLink>
          {draft.dealer_state ? <> The state shown on documents is {STATE_NAME(draft.dealer_state)}.</> : null}
        </p>
      </SectionCard>

      <SectionCard icon="image" title="Logo and colours" description="A summary only. Logos and colours have one editor, on Appearance.">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="w-[120px] h-[72px] rounded-lg border border-adm-divider bg-adm-workspace grid place-items-center p-2" data-landmark="brand-logo">
            {settings.dealer_logo_url ? <img src={settings.dealer_logo_url} alt="Dealership logo for light backgrounds" className="max-w-full max-h-full object-contain" /> : <span className="text-[13px] text-adm-muted text-center">No logo uploaded</span>}
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="flex items-center gap-2 text-[14px] leading-[20px] text-adm-ink"><span>Light background</span><StatusBadge state={settings.dealer_logo_url ? "enabled" : "setup_required"} label={settings.dealer_logo_url ? "Uploaded" : "Missing"} /></p>
            <p className="flex items-center gap-2 text-[14px] leading-[20px] text-adm-ink"><span>Dark background</span><StatusBadge state="blocked_schema" /></p>
            <p className="flex items-center gap-2 text-[14px] leading-[20px] text-adm-ink">
              <span>Accent</span>
              <span aria-hidden="true" className="w-5 h-5 rounded border border-adm-border" style={{ backgroundColor: settings.primary_color || "transparent" }} />
              <span className="text-adm-muted">{settings.primary_color || "AutoLabels default"}</span>
            </p>
          </div>
          <div className="sm:ml-auto"><EditLink to={adminTabHref("appearance")}>Manage logos and colours</EditLink></div>
        </div>
      </SectionCard>
    </BrandEditorFrame>
  );
}
