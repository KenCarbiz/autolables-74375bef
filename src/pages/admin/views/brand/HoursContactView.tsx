import { useMemo } from "react";
import { AdminIcon, FieldRow, INPUT_CLASS, SectionCard, SelectField, type ReviewChangeRow } from "@/components/admin/v3/editor";
import { AdminButton } from "@/components/admin/v2/primitives";
import { adminTabHref } from "@/lib/admin/sections";
import type { DraftErrors, EditorDraftChange } from "@/lib/admin/useEditorDraft";
import { formatDealerPhone, normalizeDealerWebsite } from "@/lib/dealerIdentity";
import { contactReadiness, fieldLabel, validateHoursContact } from "./brandModel";
import { BrandEditorFrame, LoadingState } from "./editor/BrandEditorFrame";
import { useNarrow } from "./editor/useNarrow";
import { settingsWriter, useBrandEditor, useBrandEditorContext } from "./editor/useBrandEditor";
import { BlockedCard, EditLink, OwnedValue, PreviewFrame, ReadinessList, SourceLine, type ReadinessItem } from "./editor/parts";

interface HoursDraft extends Record<string, unknown> {
  dealer_hours: string;
  dealer_phone: string;
  dealer_website_url: string;
  public_landing_url: string;
  dealer_address: string;
  dealer_zip: string;
  dealer_principal: string;
  dealer_license_number: string;
}

const KEYS: Array<keyof HoursDraft> = ["dealer_hours", "dealer_phone", "dealer_website_url", "public_landing_url", "dealer_address", "dealer_zip", "dealer_principal", "dealer_license_number"];
const MIGRATION = "20261114000000";

const ERROR_KEY: Array<[RegExp, keyof HoursDraft]> = [[/^ZIP/, "dealer_zip"], [/^Phone/, "dealer_phone"], [/^Website/, "dealer_website_url"], [/^Landing/, "dealer_website_url"]];

const validate = (d: HoursDraft): DraftErrors<HoursDraft> => {
  const out: DraftErrors<HoursDraft> = {};
  for (const message of validateHoursContact(d as never)) {
    const key = /^Landing/.test(message) ? "public_landing_url" : ERROR_KEY.find(([re]) => re.test(message))?.[1];
    if (key && !out[key]) out[key] = message;
  }
  return out;
};

const describe = (c: EditorDraftChange<HoursDraft>): ReviewChangeRow => ({
  id: c.key,
  label: c.key === "dealer_hours" ? "Store hours (free text)" : fieldLabel(c.key),
  before: String(c.before ?? ""),
  after: String(c.after ?? ""),
});


export default function HoursContactView() {
  const ctx = useBrandEditorContext();
  const { source, settings } = ctx;
  const baseline = useMemo<HoursDraft | undefined>(
    () => (source.loading && !ctx.fixture ? undefined : (Object.fromEntries(KEYS.map((k) => [k, String(settings[k as keyof typeof settings] ?? "")])) as HoursDraft)),
    [source.loading, ctx.fixture, settings],
  );
  const write = useMemo(() => settingsWriter(source), [source]);
  const editor = useBrandEditor<HoursDraft>({ ctx, baseline, validate, write, describe });
  const draft = editor.draft;
  if (!draft) return <LoadingState />;

  const disabled = !ctx.editable;
  const errors = editor.errors as Record<string, string | undefined>;
  const phone = formatDealerPhone(draft.dealer_phone);
  const site = normalizeDealerWebsite(draft.dealer_website_url);
  const landing = normalizeDealerWebsite(draft.public_landing_url, { isLandingPage: true });
  const smsAgents = (settings.passport_agents ?? []).filter((a) => (a.smsNumber ?? "").trim());
  const hoursLines = draft.dealer_hours.split("\n").map((l) => l.trim()).filter(Boolean);
  const address = [draft.dealer_address.trim(), [settings.dealer_city, settings.dealer_state].filter(Boolean).join(", "), draft.dealer_zip.trim()].filter(Boolean).join(", ");

  const baseRows = contactReadiness({ ...settings, dealer_website_url: draft.dealer_website_url, public_landing_url: draft.public_landing_url });
  const narrow = useNarrow();
  const items: ReadinessItem[] = [
    { key: "main_phone", label: "Main phone", value: phone || "Not configured", ready: !!phone, editTo: "#contact-phone", reason: draft.dealer_phone && !phone ? "The number is incomplete or looks like a placeholder." : undefined },
    ...baseRows.map((r) => ({
      key: r.key,
      label: r.label,
      value: r.value,
      ready: r.state === "ready",
      editTo: r.editHref,
      reason:
        r.key === "sales_phone" && phone
          ? `The main phone ${phone} is saved here, but customer routing reads the sales number in Contact & Routing, so it does not count.`
          : r.key === "sales_phone"
            ? "No sales number is set in Contact & Routing."
            : r.key === "sales_email"
              ? "No sales email is set in Contact & Routing."
              : "Neither a website nor a landing page is saved.",
    })),
  ];

  const shopper = (
    <PreviewFrame title="What shoppers see" draft={editor.dirty} caption="Built from the draft values on this page.">
            <div className="rounded-lg border border-adm-border bg-white text-[#142338] p-4 space-y-3" aria-label="Customer contact preview">
              <div>
                <p className="text-[13px] leading-[18px] font-semibold text-[#475569]">Call</p>
                <p className="text-[16px] leading-[22px] font-semibold break-words" data-parity="dealer-identity">{phone || <span className="font-normal text-[#475569]">No phone saved</span>}</p>
              </div>
              <div>
                <p className="text-[13px] leading-[18px] font-semibold text-[#475569]">Hours</p>
                {hoursLines.length ? hoursLines.map((l, i) => <p key={i} className="text-[14px] leading-[20px] break-words">{l}</p>) : <p className="text-[14px] leading-[20px] text-[#475569]">No hours saved</p>}
              </div>
              <div>
                <p className="text-[13px] leading-[18px] font-semibold text-[#475569]">Visit</p>
                <p className="text-[14px] leading-[20px] break-words">{address || <span className="text-[#475569]">No address saved</span>}</p>
                {(landing.display || site.display) && <p className="text-[14px] leading-[20px] text-[#2457D6] break-words">{landing.display || site.display}</p>}
              </div>
            </div>
          </PreviewFrame>
  );
  const readiness = (
    <section aria-label="Contact readiness" className="rounded-xl border border-adm-divider bg-adm-surface p-4 sm:p-5 space-y-3">
      <h2 className="text-[16px] leading-[22px] font-semibold text-adm-ink">Contact readiness</h2>
      <p className="text-[13px] leading-[18px] text-adm-muted max-lg:hidden">Each row reads the field that owns it, so an existing main phone is never reported as missing.</p>
      <ReadinessList items={items} label="Contact readiness" collapseReady={narrow} />
    </section>
  );
  return (
    <BrandEditorFrame
      ctx={ctx}
      editor={editor}
      scopeNote="Public contact details, address, licensing and the saved hours text are stored once for the account."
      impact="Customer pages and documents read these values the next time they load. Routing readiness reads the Contact & Routing editor, not this page."
      previewLabel="What shoppers see"
      preview={
        <>
          {shopper}
          {readiness}
        </>
      }
      mobilePreview={{ top: shopper, after: readiness }}
    >
      <SectionCard icon="phone" title="Public contact" description="Numbers and addresses customers see.">
        <div id="contact-phone" className="grid gap-4 md:grid-cols-2">
          <FieldRow
            label="Main public phone"
            optional
            error={errors.dealer_phone}
            help={<SourceLine hideOnPhone>Dealer settings (dealer_phone).</SourceLine>}
          >
            {(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_phone} inputMode="tel" autoComplete="tel" disabled={disabled} onChange={(e) => editor.set("dealer_phone", e.target.value)} onBlur={() => { const f = formatDealerPhone(draft.dealer_phone); if (f && f !== draft.dealer_phone) editor.set("dealer_phone", f); }} />}
          </FieldRow>
          <OwnedValue
            label="Text message (SMS) sender"
            value={smsAgents.length ? `${smsAgents.length} ${smsAgents.length === 1 ? "salesperson has" : "salespeople have"} a text number` : ""}
            empty="No text numbers set"
            source="Contact & Routing (passport_agents). Never copied from the public phone."
            editTo={adminTabHref("routing")}
            editLabel="Contact & Routing"
          />
          <FieldRow label="Website" optional error={errors.dealer_website_url} help={site.display ? `Customers see ${site.display}` : <SourceLine hideOnPhone>Dealer settings (dealer_website_url).</SourceLine>}>
            {(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_website_url} inputMode="url" disabled={disabled} onChange={(e) => editor.set("dealer_website_url", e.target.value)} />}
          </FieldRow>
          <FieldRow label="Public landing page" optional error={errors.public_landing_url} help={landing.display ? `Printed as ${landing.display}` : <SourceLine hideOnPhone>Dealer settings (public_landing_url).</SourceLine>}>
            {(p) => <input {...p} className={INPUT_CLASS} value={draft.public_landing_url} inputMode="url" disabled={disabled} onChange={(e) => editor.set("public_landing_url", e.target.value)} />}
          </FieldRow>
        </div>
      </SectionCard>

      <SectionCard icon="clock" title="Business hours" description="The saved hours text shoppers see.">
        <FieldRow
          label="Store hours"
          optional
          help={<SourceLine hideOnPhone>Dealer settings (dealer_hours). Shown to shoppers as written.</SourceLine>}
        >
          {(p) => <textarea {...p} rows={2} className={`${INPUT_CLASS} resize-y`} value={draft.dealer_hours} disabled={disabled} placeholder="One line per day or range" onChange={(e) => editor.set("dealer_hours", e.target.value)} />}
        </FieldRow>
        <OwnedValue label="Time zone" value={settings.dealer_timezone} empty="No time zone set" source="Dealer settings (dealer_timezone)." editTo={adminTabHref("identity")} editLabel="Identity" compactOnPhone />
      </SectionCard>

      <BlockedCard
        icon="calendar"
        title="Structured hours and phones"
        does="Weekly schedule, holidays, routing hours and department phones. Your saved hours text stays the source. AutoFilm parity is not claimed."
        migrationId={MIGRATION}
        preview={
          <>
            <FieldRow label="Schedule time zone">{(p) => <SelectField {...p} disabled><option>Uses the time zone from Identity</option></SelectField>}</FieldRow>
            <FieldRow label="Phone (E.164)">{(p) => <input {...p} className={INPUT_CLASS} disabled placeholder="+15555550100" />}</FieldRow>
            <AdminButton variant="secondary" disabled><AdminIcon name="plus" />Add number</AdminButton>
          </>
        }
      />

      <SectionCard icon="pin" title="Address and licensing" description="Seller identity on the addendum and Buyers Guide.">
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Street address" optional className="col-span-2" help={<SourceLine hideOnPhone>Dealer settings (dealer_address).</SourceLine>}>
            {(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_address} autoComplete="street-address" disabled={disabled} onChange={(e) => editor.set("dealer_address", e.target.value)} />}
          </FieldRow>
          <div className="col-span-2 md:col-span-1"><OwnedValue label="City and state" value={[settings.dealer_city, settings.dealer_state].filter(Boolean).join(", ")} empty="Not set" source="Dealer settings. Edited on Identity." editTo={adminTabHref("identity")} editLabel="Identity" compactOnPhone /></div>
          <FieldRow label="ZIP" optional error={errors.dealer_zip}>
            {(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_zip} inputMode="numeric" autoComplete="postal-code" disabled={disabled} onChange={(e) => editor.set("dealer_zip", e.target.value)} />}
          </FieldRow>
          <FieldRow label="DMV dealer license number" optional>
            {(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_license_number} disabled={disabled} onChange={(e) => editor.set("dealer_license_number", e.target.value)} />}
          </FieldRow>
        
          <FieldRow label="Dealer principal" optional className="col-span-2 md:col-span-1" >
            {(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_principal} disabled={disabled} onChange={(e) => editor.set("dealer_principal", e.target.value)} />}
          </FieldRow>
        </div>
        <div>
          <EditLink to={adminTabHref("routing")}>Lead routing recipients: Contact & Routing</EditLink>
        </div>
      </SectionCard>
    </BrandEditorFrame>
  );
}
