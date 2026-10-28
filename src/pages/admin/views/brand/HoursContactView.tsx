import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AdminCard } from "@/components/admin/v2/primitives";
import { adminTabHref } from "@/lib/admin/sections";
import { formatDealerPhone, normalizeDealerWebsite } from "@/lib/dealerIdentity";
import { HOURS_CONTACT_KEYS, contactReadiness, headerPreview, validateHoursContact } from "./brandModel";
import { useBrandForm } from "./useBrandForm";
import { BrandSaveBar } from "./BrandSaveBar";
import { ReadOnlyField, TextAreaField, TextField } from "./fields";
import { ContactReadinessCard } from "./cards";

// Hours, contact, address and licensing. City and state are owned by the
// Identity tab and only displayed here.

export default function HoursContactView() {
  const form = useBrandForm(HOURS_CONTACT_KEYS, validateHoursContact);
  const { draft, set, source } = form;
  const readiness = useMemo(() => contactReadiness(source.settings), [source.settings]);
  const site = useMemo(() => normalizeDealerWebsite(draft.dealer_website_url), [draft.dealer_website_url]);
  const landing = useMemo(() => normalizeDealerWebsite(draft.public_landing_url, { isLandingPage: true }), [draft.public_landing_url]);
  const warnings = useMemo(() => headerPreview({ ...source.settings, ...draft }, { tenantName: source.tenantName, stores: source.stores, activeStoreId: source.activeStoreId }).warnings, [source.settings, draft, source.tenantName, source.stores, source.activeStoreId]);
  const errorFor = (pattern: RegExp) => form.errors.find((e) => pattern.test(e)) ?? null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 items-start">
        <div className="space-y-4">
          <AdminCard title="Hours" description="Shown to shoppers on the Vehicle Passport. Business hours for routing are set under Customer Experience.">
            <TextAreaField label="Store hours" value={draft.dealer_hours} onChange={(v) => set("dealer_hours", v)} rows={2} placeholder="Mon to Sat 9 to 7, Sun closed" />
          </AdminCard>

          <AdminCard title="Contact" description="The dealership's own phone and web addresses. Lead routing recipients are configured under Customer Experience.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextField
                label="Main phone"
                value={draft.dealer_phone}
                onChange={(v) => set("dealer_phone", v)}
                onBlur={() => { const f = formatDealerPhone(draft.dealer_phone); if (f) set("dealer_phone", f); }}
                inputMode="tel"
                autoComplete="tel"
                error={errorFor(/phone/i)}
              />
              <TextField
                label="Website"
                value={draft.dealer_website_url}
                onChange={(v) => set("dealer_website_url", v)}
                hint={site.display ? `Customers see ${site.display}` : "The dealership's front door."}
                error={errorFor(/^Website/)}
                inputMode="url"
              />
              <TextField
                label="Public landing page"
                value={draft.public_landing_url}
                onChange={(v) => set("public_landing_url", v)}
                hint={landing.display ? `Printed as ${landing.display}` : "Optional. A deliberate landing page that keeps its path on documents."}
                error={errorFor(/landing/i)}
                inputMode="url"
                className="md:col-span-2"
              />
              <TextField label="Street address" value={draft.dealer_address} onChange={(v) => set("dealer_address", v)} autoComplete="street-address" className="md:col-span-2" />
              <ReadOnlyField id="contact-city" label="City" value={source.settings.dealer_city} editHref={adminTabHref("identity")} editLabel="Edit on Identity" />
              <div className="grid grid-cols-2 gap-4">
                <ReadOnlyField id="contact-state" label="State" value={source.settings.dealer_state} editHref={adminTabHref("identity")} editLabel="Edit on Identity" />
                <TextField label="ZIP" value={draft.dealer_zip} onChange={(v) => set("dealer_zip", v)} inputMode="numeric" autoComplete="postal-code" error={errorFor(/ZIP/)} />
              </div>
            </div>
          </AdminCard>

          <AdminCard title="Legal and licensing" description="Identifies the licensed seller on the addendum and Buyers Guide.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextField label="Dealer principal" value={draft.dealer_principal} onChange={(v) => set("dealer_principal", v)} placeholder="Owner of record" />
              <TextField label="DMV dealer license number" value={draft.dealer_license_number} onChange={(v) => set("dealer_license_number", v)} />
            </div>
          </AdminCard>
        </div>

        <div className="space-y-4">
          <ContactReadinessCard rows={readiness} />
          <AdminCard title="Document identity" description="What the document identity resolver reports for this dealership.">
            {warnings.length === 0 ? (
              <p className="flex items-center gap-2 text-[14px] text-adm-success"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />Every identity field documents need is set.</p>
            ) : (
              <ul className="space-y-2">
                {warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-[13px] leading-[18px] text-adm-ink">
                    <AlertTriangle className="w-4 h-4 mt-0.5 text-adm-warning flex-shrink-0" aria-hidden="true" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      </div>

      <BrandSaveBar form={form} />
    </div>
  );
}
