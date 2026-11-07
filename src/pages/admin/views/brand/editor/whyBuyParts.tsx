import type { ReactNode } from "react";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, AdvancedDisclosure, FieldRow, INPUT_CLASS, IconButton, LogoSlot, SelectField } from "@/components/admin/v3/editor";

import type { WhyBuyDraft } from "@/lib/admin/brand/whyBuy";


export const DateInput = ({ label, value, onChange, disabled, error, max, id }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; error?: string; max: string; id?: string }) => (
  <FieldRow label={label} error={error} htmlFor={id}>
    {(p) => <input {...p} type="date" className={INPUT_CLASS} value={value} max={max} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
  </FieldRow>
);

export const LegacyDateNote = ({ show }: { show: boolean }) =>
  show ? (
    <p className="flex items-start gap-1.5 text-[13px] leading-[18px] text-adm-warning">
      <AdminIcon name="alert" size="inline" className="mt-px" />
      Saved without a retrieval date. Add one the next time you update this.
    </p>
  ) : null;

/** Photo with a contain preview. Upload is the primary path; an existing web address stays usable under Advanced. */
export const PhotoField = ({
  label, src, onChange, onUpload, uploading, error, disabled, uploadOff, urlError, guidance,
}: {
  label: string;
  src: string;
  onChange: (url: string) => void;
  onUpload: (file: File) => void;
  uploading?: boolean;
  error?: string | null;
  disabled?: boolean;
  uploadOff?: boolean;
  urlError?: string;
  guidance?: ReactNode;
}) => (
  <div className="space-y-3 min-w-0">
    <LogoSlot
      label={label}
      src={src || null}
      alt={label}
      emptyLabel="No photo uploaded"
      plain
      allowedTypes={["image/png", "image/jpeg", "image/webp"]}
      uploading={uploading}
      error={error}
      disabled={disabled || uploadOff}
      guidance={guidance ?? (uploadOff ? "Uploading is off in the design fixture. PNG, JPEG or WebP, up to 2 MB." : "PNG, JPEG or WebP, up to 2 MB. The whole photo is shown, never cropped.")}
      onSelectFile={onUpload}
      onRemove={src ? () => onChange("") : undefined}
    />
    <AdvancedDisclosure title="Use a web address instead">
      <FieldRow label={`${label} web address`} optional error={urlError} help="Existing addresses keep working. Uploading a photo replaces this address.">
        {(p) => <input {...p} className={INPUT_CLASS} value={src} placeholder="https://" disabled={disabled} onChange={(e) => onChange(e.target.value.trim())} />}
      </FieldRow>
    </AdvancedDisclosure>
  </div>
);

export const AddRow = ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) => (
  <AdminButton variant="secondary" disabled={disabled} onClick={onClick}>
    <AdminIcon name="plus" />
    {label}
  </AdminButton>
);

export const RemoveButton = ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) => (
  <IconButton name="close" label={label} disabled={disabled} onClick={onClick} />
);

export const SelectNotSpecified = ({ label, value, onChange, options, disabled, help }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]>; disabled?: boolean; help?: ReactNode }) => (
  <FieldRow label={label} help={help}>
    {(p) => (
      <SelectField {...p} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not specified</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </SelectField>
    )}
  </FieldRow>
);

const stars = (rating: string) => {
  const n = Number(rating);
  return Number.isFinite(n) && rating.trim() ? `${n.toFixed(1)} of 5` : "";
};

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** The dealer-supplied facts, laid out like the Passport's "Why buy" section. Only populated facts render. */
export function WhyBuyPreview({ draft, dealerName }: { draft: WhyBuyDraft; dealerName: string }) {
  const facts: Array<{ key: string; text: ReactNode }> = [];
  if (draft.dealer_years_in_business.trim()) facts.push({ key: "years", text: `${draft.dealer_years_in_business.trim()} years in business` });
  if (draft.dealer_family_owned === "yes") facts.push({ key: "family", text: "Family owned" });
  if (draft.dealer_satisfaction.trim()) facts.push({ key: "sat", text: <>{draft.dealer_satisfaction.trim()} customer satisfaction{draft.reputation.satisfactionSource ? <span className="text-[#475569]"> ({draft.reputation.satisfactionSource}{draft.reputation.satisfactionAsOf ? `, ${fmtDate(draft.reputation.satisfactionAsOf)}` : ""})</span> : null}</> });
  if (draft.dealer_google_rating.trim()) facts.push({ key: "google", text: <>Google {draft.dealer_google_rating.trim()}{draft.dealer_google_count.trim() ? ` from ${Number(draft.dealer_google_count) ? Number(draft.dealer_google_count).toLocaleString() : draft.dealer_google_count} reviews` : ""}{draft.reputation.googleAsOf ? <span className="text-[#475569]"> (as of {fmtDate(draft.reputation.googleAsOf)})</span> : null}</> });
  if (draft.dealer_bbb_rating.trim()) facts.push({ key: "bbb", text: <>BBB {draft.dealer_bbb_rating.trim()}{draft.reputation.bbbAsOf ? <span className="text-[#475569]"> (as of {fmtDate(draft.reputation.bbbAsOf)})</span> : null}</> });
  if (draft.dealer_service_location === "onsite") facts.push({ key: "svc", text: "On-site service center" });
  if (draft.dealer_financing === "yes") facts.push({ key: "fin", text: "Financing available" });
  if (draft.dealer_delivery && draft.dealer_delivery !== "none") facts.push({ key: "del", text: `${draft.dealer_delivery.charAt(0).toUpperCase()}${draft.dealer_delivery.slice(1)} delivery available` });
  const reviews = draft.reviews.filter((r) => r.source.trim());
  const awards = draft.awards.filter((a) => a.name.trim());
  const empty = !draft.dealer_tagline.trim() && !draft.why_buy_here.trim() && !facts.length && !reviews.length && !awards.length && !draft.services.length && !draft.amenities.length && !draft.dealer_advisor_name.trim() && !draft.dealer_storefront_url.trim();

  return (
    <div className="rounded-lg border border-adm-border bg-white text-[#142338] p-4 space-y-4" aria-label="Why buy preview" data-testid="why-buy-preview">
      <h3 className="text-[18px] leading-[24px] font-bold break-words">Why buy from {dealerName || "this dealership"}</h3>
      {empty && <p className="text-[14px] leading-[20px] text-[#475569]">Nothing to show yet. Only facts you enter appear here, and nothing is filled in for you.</p>}
      {draft.dealer_storefront_url.trim() && <img src={draft.dealer_storefront_url} alt="Dealership" className="w-full max-h-40 object-contain rounded-md bg-[#F1F5F9]" />}
      {draft.dealer_tagline.trim() && <p className="text-[14px] leading-[20px] font-semibold break-words">{draft.dealer_tagline.trim()}</p>}
      {draft.why_buy_here.trim() && <p className="text-[14px] leading-[20px] break-words">{draft.why_buy_here.trim()}</p>}
      {facts.length > 0 && (
        <ul className="grid gap-2">
          {facts.map((f) => (
            <li key={f.key} className="flex items-start gap-2 text-[14px] leading-[20px]">
              <AdminIcon name="check-circle" size="inline" className="mt-px text-[#1A9F5F]" />
              <span className="min-w-0 break-words">{f.text}</span>
            </li>
          ))}
        </ul>
      )}
      {(draft.services.length > 0 || draft.amenities.length > 0) && (
        <div className="flex flex-wrap gap-1.5" aria-label="Services and amenities">
          {[...draft.services, ...draft.amenities].map((c) => <span key={c} className="rounded-full bg-[#EEF2F7] px-2.5 py-1 text-[13px] leading-[18px]">{c}</span>)}
        </div>
      )}
      {awards.length > 0 && (
        <div>
          <p className="text-[13px] leading-[18px] font-semibold text-[#475569]">Awards</p>
          <ul className="mt-1 space-y-1">{awards.map((a) => <li key={a.id} className="flex items-start gap-2 text-[14px] leading-[20px]"><AdminIcon name="award" size="inline" className="mt-px" /><span className="break-words">{a.name}{a.issuer ? ` (${a.issuer})` : ""}</span></li>)}</ul>
        </div>
      )}
      {reviews.length > 0 && (
        <div className="space-y-2">
          <p className="text-[13px] leading-[18px] font-semibold text-[#475569]">What owners say</p>
          {reviews.map((r) => (
            <blockquote key={r.id} className="m-0 rounded-md bg-[#F1F5F9] px-3 py-2">
              {r.quote.trim() && <p className="text-[14px] leading-[20px] break-words">"{r.quote.trim()}"</p>}
              <p className="text-[13px] leading-[18px] text-[#475569]">{r.source}{stars(r.rating) ? `, ${stars(r.rating)}` : ""}{r.asOf ? `, ${fmtDate(r.asOf)}` : ""}</p>
            </blockquote>
          ))}
        </div>
      )}
      {draft.dealer_advisor_name.trim() && (
        <div className="flex items-center gap-3 border-t border-[#E2E8F0] pt-3">
          {draft.dealer_advisor_photo.trim() ? <img src={draft.dealer_advisor_photo} alt="" className="w-12 h-12 rounded-full object-cover bg-[#F1F5F9]" /> : <span aria-hidden="true" className="w-12 h-12 rounded-full bg-[#EEF2F7] grid place-items-center"><AdminIcon name="user" size="card" /></span>}
          <div className="min-w-0">
            <p className="text-[14px] leading-[20px] font-semibold break-words">{draft.dealer_advisor_name.trim()}</p>
            {draft.dealer_advisor_title.trim() && <p className="text-[13px] leading-[18px] text-[#475569] break-words">{draft.dealer_advisor_title.trim()}</p>}
            {draft.dealer_advisor_response.trim() && <p className="text-[13px] leading-[18px] text-[#475569] break-words">{draft.dealer_advisor_response.trim()}</p>}
          </div>
        </div>
      )}
    </div>
  );
}


export interface GroupTab { id: string; label: string; count: number | null; issue: boolean }

/** Category navigation: a select on mobile, a sticky tab list from 1024px. */
export function GroupNav({ tabs, value, onChange }: { tabs: GroupTab[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="lg:sticky lg:top-0 z-10 bg-adm-workspace/95 backdrop-blur lg:py-2 -mx-1 px-1">
      <div className="lg:hidden">
        <FieldRow label="Section" htmlFor="why-buy-section">
          <SelectField id="why-buy-section" value={value} onChange={(e) => onChange(e.target.value)}>
            {tabs.map((t) => <option key={t.id} value={t.id}>{t.label}{t.count !== null ? ` (${t.count})` : ""}{t.issue ? " - needs attention" : ""}</option>)}
          </SelectField>
        </FieldRow>
      </div>
      <div role="tablist" aria-label="Why buy sections" className="hidden lg:flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`why-buy-tab-${t.id}`}
            aria-selected={value === t.id}
            aria-controls={`why-buy-panel-${t.id}`}
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-2 min-h-[40px] px-3.5 rounded-lg border text-[14px] leading-[20px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary ${value === t.id ? "bg-adm-surface border-adm-primary text-adm-primary" : "bg-adm-surface border-adm-divider text-adm-ink hover:bg-adm-workspace"}`}
          >
            {t.label}
            {t.count !== null && <span className="rounded-full bg-adm-workspace px-2 text-[13px] leading-[20px] text-adm-muted">{t.count}</span>}
            {t.issue && <AdminIcon name="alert" size="inline" className="text-adm-danger" label="Needs attention" />}
          </button>
        ))}
      </div>
    </div>
  );
}
