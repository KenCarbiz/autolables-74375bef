import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadPhoto } from "@/lib/storage";
import { AdminButton } from "@/components/admin/v2/primitives";
import {
  AdminIcon, AdvancedDisclosure, ChipInput, DetailDrawer, EditorEmpty, FieldRow, INPUT_CLASS, IconButton, SectionCard, SelectField, SortableList, StatusBadge, SwitchField, type ReviewChangeRow,
} from "@/components/admin/v3/editor";
import { adminTabHref } from "@/lib/admin/sections";
import { useAdminNow } from "@/lib/admin/dataSource";
import type { DraftErrors, EditorDraftChange } from "@/lib/admin/useEditorDraft";
import {
  buildWhyBuyPatch, firstWhyBuyError, hasWhyBuyErrors, readWhyBuy, validateWhyBuy, type AwardItem, type ReviewItem, type WhyBuyDraft,
} from "@/lib/admin/brand/whyBuy";
import { BrandEditorFrame, LoadingState } from "./editor/BrandEditorFrame";
import { settingsWriter, useBrandEditor, useBrandEditorContext } from "./editor/useBrandEditor";
import { ConfirmDialog, EditLink, OwnedValue, PreviewFrame, SourceLine } from "./editor/parts";
import { AddRow, DateInput, GroupNav, LegacyDateNote, PhotoField, RemoveButton, SelectNotSpecified, WhyBuyPreview, type GroupTab } from "./editor/whyBuyParts";

const LABELS: Record<string, string> = {
  dealer_tagline: "Tagline", why_buy_here: "Brand promise", warranty_programs: "Warranty and program messaging", dealer_years_in_business: "Years in business",
  dealer_family_owned: "Family owned", dealer_storefront_url: "Dealership photo", dealer_satisfaction: "Customer satisfaction", dealer_google_rating: "Google rating",
  dealer_google_count: "Google review count", dealer_bbb_rating: "BBB rating", dealer_service_location: "Service department", dealer_service_address: "Off-site service address",
  dealer_delivery: "Vehicle delivery", dealer_financing: "Financing on-site", dealer_advisor_name: "Advisor name", dealer_advisor_title: "Advisor title",
  dealer_advisor_photo: "Advisor photo", dealer_advisor_response: "Advisor response time", iihs_awards_enabled: "IIHS awards", iihs_awards: "IIHS award rows",
  reviews: "Review sources", awards: "Awards", services: "Services offered", amenities: "Amenities", reputation: "Rating sources and dates",
};

const summarize = (key: string, v: unknown): string => {
  if (key === "reviews") { const a = (v as ReviewItem[]).filter((r) => r.source.trim()); return a.length ? a.map((r) => `${r.source}${r.rating ? ` ${r.rating}` : ""}${r.asOf ? ` (${r.asOf})` : ""}`).join("; ") : "None"; }
  if (key === "awards") { const a = v as AwardItem[]; return a.length ? a.map((x) => x.name).join("; ") : "None"; }
  if (key === "services" || key === "amenities") { const a = v as string[]; return a.length ? a.join(", ") : "None"; }
  if (key === "iihs_awards") return `${(v as unknown[]).length} rows`;
  if (key === "reputation") { const r = v as WhyBuyDraft["reputation"]; return [r.googleAsOf && `Google ${r.googleAsOf}`, r.bbbAsOf && `BBB ${r.bbbAsOf}`, r.satisfactionAsOf && `${r.satisfactionSource || "Satisfaction"} ${r.satisfactionAsOf}`].filter(Boolean).join("; ") || "None"; }
  if (typeof v === "boolean") return v ? "On" : "Off";
  return v === "" || v == null ? "" : String(v);
};

const describe = (c: EditorDraftChange<WhyBuyDraft>): ReviewChangeRow => ({ id: c.key, label: LABELS[c.key] ?? c.key, before: summarize(c.key, c.before), after: summarize(c.key, c.after) });

const CTA_LABELS: Record<string, string> = { dealer_availability: "Dealer Availability CTA (default)", context_aware: "Context-Aware CTA", two_button: "Two Button Layout", progressive: "Progressive CTA" };
const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const chipValidate = (v: string) => (v.includes(",") ? "Leave out commas. Add each item on its own." : null);

export default function WhyBuyView() {
  const ctx = useBrandEditorContext();
  const { source, settings } = ctx;
  const now = useAdminNow();
  const today = new Date(now).toISOString().slice(0, 10);
  const baseline = useMemo<WhyBuyDraft | undefined>(() => (source.loading && !ctx.fixture ? undefined : readWhyBuy(settings as never)), [source.loading, ctx.fixture, settings]);
  const write = useMemo(() => settingsWriter(source), [source]);
  const validate = useCallback(
    (d: WhyBuyDraft): DraftErrors<WhyBuyDraft> => {
      if (!baseline) return {};
      const e = validateWhyBuy(d, baseline, today);
      if (!hasWhyBuyErrors(e)) return {};
      const first = firstWhyBuyError(e) ?? "Fix the highlighted fields.";
      return { dealer_tagline: first } as DraftErrors<WhyBuyDraft>;
    },
    [baseline, today],
  );
  const editor = useBrandEditor<WhyBuyDraft>({ ctx, baseline, validate, write, describe, buildPatch: (d, b) => buildWhyBuyPatch(d, b) });
  const draft = editor.draft;
  const [uploading, setUploading] = useState<"store" | "advisor" | null>(null);
  const [uploadError, setUploadError] = useState<{ kind: "store" | "advisor"; message: string } | null>(null);
  const [refresh, setRefresh] = useState<{ busy: boolean; note: string | null; failed: boolean }>({ busy: false, note: null, failed: false });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [group, setGroup] = useState("brand");
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  if (!draft || !baseline) return <LoadingState />;

  const disabled = !ctx.editable;
  const errs = validateWhyBuy(draft, baseline, today);
  const set = editor.set as <K extends keyof WhyBuyDraft>(k: K, v: WhyBuyDraft[K]) => void;
  const rep = draft.reputation;
  const setRep = (p: Partial<WhyBuyDraft["reputation"]>) => set("reputation", { ...rep, ...p });
  const dealerName = settings.dealer_name || source.tenantName || "";
  const syncedAt = (settings as unknown as { google_rating_synced_at?: string }).google_rating_synced_at;
  const team = (settings.passport_agents ?? []).filter((a) => a.name.trim());
  const missingDate = (value: string, asOf: string, baseValue: string, baseAsOf: string) => !!value.trim() && !asOf && value === baseValue && asOf === baseAsOf;

  const upload = async (file: File, kind: "store" | "advisor") => {
    if (!source.tenantId || source.isFixture) return;
    setUploading(kind);
    setUploadError(null);
    const fail = (message: string) => setUploadError({ kind, message });
    try {
      const r = await uploadPhoto("dealer-logos", file, { tenantId: source.tenantId, storeId: source.activeStoreId ?? undefined, vin: kind === "store" ? "storefront" : "advisor" });
      if (!r?.url) { fail("The upload did not return a file address."); return; }
      set(kind === "store" ? "dealer_storefront_url" : "dealer_advisor_photo", r.url);
      toast.success("Photo uploaded. Review and apply to use it.");
    } catch (e) {
      fail(`Upload failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setUploading(null);
    }
  };

  const refreshGoogle = async () => {
    if (!source.tenantId) return;
    setConfirmRefresh(false);
    setRefresh({ busy: true, note: null, failed: false });
    try {
      const { data, error } = await supabase.functions.invoke("google-reviews", { body: { tenant_id: source.tenantId } });
      const d = data as { ok?: boolean; error?: string; rating?: string | number; count?: string | number; matched?: string } | null;
      if (error || !d?.ok) {
        setRefresh({ busy: false, failed: true, note: d?.error === "place_not_found" ? "Google could not find this dealership. Check the display name and address on Identity and Hours & Contact." : "Google did not return a rating right now. Nothing was changed." });
        return;
      }
      setRefresh({ busy: false, failed: false, note: `Saved to your account now: Google returned ${d.rating} from ${Number(d.count).toLocaleString()} reviews, matched to "${d.matched}".` });
      ctx.reload();
    } catch {
      setRefresh({ busy: false, failed: true, note: "Google did not return a rating right now. Nothing was changed." });
    }
  };

  const reviewItems = draft.reviews.map((r, i) => ({ ...r, label: r.source.trim() || `Review ${i + 1}` }));
  const awardItems = draft.awards.map((a, i) => ({ ...a, label: a.name.trim() || `Award ${i + 1}` }));
  const patchReview = (id: string, p: Partial<ReviewItem>) => set("reviews", draft.reviews.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const patchAward = (id: string, p: Partial<AwardItem>) => set("awards", draft.awards.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const tabs: GroupTab[] = [
    { id: "brand", label: "Brand promise", count: null, issue: !!(errs.top.dealer_tagline || errs.top.dealer_years_in_business || errs.top.dealer_storefront_url) },
    { id: "reviews", label: "Reviews & reputation", count: draft.reviews.length, issue: !!(errs.top.dealer_google_rating || errs.top.dealer_google_count || errs.top.googleAsOf || errs.top.bbbAsOf || errs.top.satisfactionSource || errs.top.satisfactionAsOf || Object.keys(errs.reviews).length) },
    { id: "amenities", label: "Amenities & services", count: draft.services.length + draft.amenities.length, issue: false },
    { id: "awards", label: "Awards", count: draft.awards.length, issue: !!(Object.keys(errs.awards).length || Object.keys(errs.iihs).length) },
    { id: "advisor", label: "Advisor", count: null, issue: !!errs.top.dealer_advisor_photo },
  ];
  const offsite = draft.dealer_service_location === "offsite";
  const cta = settings.mobile_slideout_cta_variant || "dealer_availability";

  return (
    <BrandEditorFrame
      ctx={ctx}
      editor={editor}
      scopeNote="Why Buy content is saved once for the account and appears for every rooftop."
      impact="The customer Passport shows only the facts that are filled in. The Passport layout and the values it reads are not changed by this editor."
      previewLabel="Customer preview"
      preview={
        <PreviewFrame title="Customer preview" draft={editor.dirty} caption="Dealer-supplied facts only. The Passport arranges them in its own layout.">
          <WhyBuyPreview draft={draft} dealerName={dealerName} />
          <AdminButton variant="secondary" className="w-full lg:hidden" onClick={() => setPreviewOpen(true)}>
            <AdminIcon name="maximize" />
            Open larger preview
          </AdminButton>
        </PreviewFrame>
      }
    >
      <GroupNav tabs={tabs} value={group} onChange={setGroup} />

      <div role="tabpanel" id="why-buy-panel-brand" aria-labelledby="why-buy-tab-brand" hidden={group !== "brand"} className="min-w-0">
      <SectionCard icon="star" title="Brand promise" description="Your headline message and the facts about the dealership.">
        <div className="grid gap-4 md:grid-cols-2">
          <FieldRow label="Tagline" optional className="md:col-span-2" error={errs.top.dealer_tagline} help={<SourceLine>Dealer settings (dealer_tagline). Shown under the dealership name on documents.</SourceLine>}>
            {(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_tagline} disabled={disabled} maxLength={160} onChange={(e) => set("dealer_tagline", e.target.value)} />}
          </FieldRow>
          <FieldRow label="Brand promise" optional className="md:col-span-2" help={<SourceLine>Dealer settings (why_buy_here). Printed as the value statement on stickers.</SourceLine>}>
            {(p) => <textarea {...p} rows={3} className={`${INPUT_CLASS} resize-y`} value={draft.why_buy_here} disabled={disabled} placeholder="One or two sentences in your own words" onChange={(e) => set("why_buy_here", e.target.value)} />}
          </FieldRow>
          <FieldRow label="Years in business" optional error={errs.top.dealer_years_in_business} help={<SourceLine>Dealer settings (dealer_years_in_business). Leave blank to hide it.</SourceLine>}>
            {(p) => <input {...p} inputMode="numeric" className={INPUT_CLASS} value={draft.dealer_years_in_business} disabled={disabled} onChange={(e) => set("dealer_years_in_business", e.target.value)} />}
          </FieldRow>
          <SelectNotSpecified label="Family owned" value={draft.dealer_family_owned} disabled={disabled} onChange={(v) => set("dealer_family_owned", v)} options={[["yes", "Yes"]]} />
          <FieldRow label="Warranty and program messaging" optional className="md:col-span-2" help={<>Free text. Verified, structured programs are managed in <EditLink to={adminTabHref("warranty-programs")}>Pricing & Products</EditLink>.</>}>
            {(p) => <textarea {...p} rows={3} className={`${INPUT_CLASS} resize-y`} value={draft.warranty_programs} disabled={disabled} onChange={(e) => set("warranty_programs", e.target.value)} />}
          </FieldRow>
        </div>
        <PhotoField
          label="Dealership photo"
          src={draft.dealer_storefront_url}
          onChange={(u) => set("dealer_storefront_url", u)}
          onUpload={(f) => void upload(f, "store")}
          uploading={uploading === "store"}
          error={uploadError?.kind === "store" ? uploadError.message : null}
          disabled={disabled}
          uploadOff={source.isFixture}
          urlError={errs.top.dealer_storefront_url}
        />
      </SectionCard>
      </div>

      <div role="tabpanel" id="why-buy-panel-reviews" aria-labelledby="why-buy-tab-reviews" hidden={group !== "reviews"} className="min-w-0">
      <SectionCard icon="chart" title="Reviews & reputation" description="Every rating needs a source and the date it was retrieved or entered. Nothing is filled in for you.">
        <div className="rounded-lg border border-adm-divider p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">Google rating</h3>
            <div className="flex items-center gap-2 flex-wrap">
              {source.isFixture ? <StatusBadge state="unavailable" label="Refresh unavailable in fixture" /> : null}
              <AdminButton variant="secondary" disabled={disabled || source.isFixture || refresh.busy || editor.dirty} onClick={() => setConfirmRefresh(true)}>
                <AdminIcon name="refresh" className={refresh.busy ? "animate-spin motion-reduce:animate-none" : undefined} />
                {refresh.busy ? "Refreshing" : "Refresh from Google and save now"}
              </AdminButton>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldRow label="Rating" error={errs.top.dealer_google_rating}>{(p) => <input {...p} inputMode="decimal" className={INPUT_CLASS} value={draft.dealer_google_rating} disabled={disabled} placeholder="0 to 5" onChange={(e) => set("dealer_google_rating", e.target.value)} />}</FieldRow>
            <FieldRow label="Review count" error={errs.top.dealer_google_count}>{(p) => <input {...p} inputMode="numeric" className={INPUT_CLASS} value={draft.dealer_google_count} disabled={disabled} onChange={(e) => set("dealer_google_count", e.target.value)} />}</FieldRow>
            <DateInput label="Retrieved on" value={rep.googleAsOf} max={today} disabled={disabled} error={errs.top.googleAsOf} onChange={(v) => setRep({ googleAsOf: v })} />
          </div>
          <LegacyDateNote show={missingDate(draft.dealer_google_rating, rep.googleAsOf, baseline.dealer_google_rating, baseline.reputation.googleAsOf)} />
          {editor.dirty && !source.isFixture && <p className="text-[13px] leading-[18px] text-adm-muted">Apply or discard your changes before refreshing. The refresh saves immediately and reloads these values.</p>}
          <p role="status" className={`text-[13px] leading-[18px] ${refresh.failed ? "text-adm-danger" : "text-adm-muted"}`}>
            {refresh.note ?? (syncedAt ? `Last refreshed from Google on ${new Date(syncedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.` : "Refresh uses your connected Google listing. If nothing is connected, enter the rating yourself with its date.")}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-adm-divider p-4 space-y-3">
            <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">BBB rating</h3>
            <FieldRow label="Rating" optional>{(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_bbb_rating} disabled={disabled} placeholder="Letter grade" onChange={(e) => set("dealer_bbb_rating", e.target.value)} />}</FieldRow>
            <DateInput label="Entered on" value={rep.bbbAsOf} max={today} disabled={disabled} error={errs.top.bbbAsOf} onChange={(v) => setRep({ bbbAsOf: v })} />
            <LegacyDateNote show={missingDate(draft.dealer_bbb_rating, rep.bbbAsOf, baseline.dealer_bbb_rating, baseline.reputation.bbbAsOf)} />
          </div>
          <div className="rounded-lg border border-adm-divider p-4 space-y-3">
            <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">Customer satisfaction</h3>
            <FieldRow label="Figure" optional>{(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_satisfaction} disabled={disabled} placeholder="Percent or score" onChange={(e) => set("dealer_satisfaction", e.target.value)} />}</FieldRow>
            <FieldRow label="Source" error={errs.top.satisfactionSource}>{(p) => <input {...p} className={INPUT_CLASS} value={rep.satisfactionSource} disabled={disabled} placeholder="Who measured it" onChange={(e) => setRep({ satisfactionSource: e.target.value })} />}</FieldRow>
            <DateInput label="Measured on" value={rep.satisfactionAsOf} max={today} disabled={disabled} error={errs.top.satisfactionAsOf} onChange={(v) => setRep({ satisfactionAsOf: v })} />
            <LegacyDateNote show={missingDate(draft.dealer_satisfaction, rep.satisfactionAsOf, baseline.dealer_satisfaction, baseline.reputation.satisfactionAsOf)} />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">Review sources</h3>
          {draft.reviews.length === 0 ? (
            <EditorEmpty artwork="documents" title="No reviews added" description="Add a review with its source and date. Only reviews you enter are shown to shoppers." className="py-6" />
          ) : (
            <SortableList
              label="Review sources"
              items={reviewItems}
              onChange={(next) => set("reviews", next.map(({ label: _l, ...r }) => r))}
              renderItem={(item) => {
                const r = draft.reviews.find((x) => x.id === item.id) as ReviewItem;
                const err = errs.reviews[r.id];
                return (
                  <div className="grid gap-3 py-1 sm:grid-cols-[minmax(0,1fr)_96px_156px_44px] sm:items-end">
                    <FieldRow label="Source" error={err && /source|bar/i.test(err) ? err : undefined}>{(p) => <input {...p} className={INPUT_CLASS} value={r.source} disabled={disabled} placeholder="Google, Edmunds" onChange={(e) => patchReview(r.id, { source: e.target.value })} />}</FieldRow>
                    <FieldRow label="Rating" optional error={err && /rating from/i.test(err) ? err : undefined}>{(p) => <input {...p} inputMode="decimal" className={INPUT_CLASS} value={r.rating} disabled={disabled} placeholder="0 to 5" onChange={(e) => patchReview(r.id, { rating: e.target.value })} />}</FieldRow>
                    <DateInput label="Date" value={r.asOf} max={today} disabled={disabled} error={err && /date/i.test(err) ? err : undefined} onChange={(v) => patchReview(r.id, { asOf: v })} />
                    <span className="hidden sm:flex sm:row-start-1 sm:col-start-4 justify-center"><RemoveButton label={`Remove review ${r.source || ""}`.trim()} disabled={disabled} onClick={() => set("reviews", draft.reviews.filter((x) => x.id !== r.id))} /></span>
                    <div className="sm:col-span-4"><FieldRow label="Quote" optional error={err && /quote/i.test(err) ? err : undefined}>{(p) => <textarea {...p} rows={2} className={`${INPUT_CLASS} resize-y`} value={r.quote} disabled={disabled} onChange={(e) => patchReview(r.id, { quote: e.target.value })} />}</FieldRow></div>
                    <div className="sm:col-span-4 flex items-center justify-between gap-2 flex-wrap">
                      <LegacyDateNote show={!!r.rating.trim() && !r.asOf} />
                      <span className="sm:hidden ml-auto"><RemoveButton label={`Remove review ${r.source || ""}`.trim()} disabled={disabled} onClick={() => set("reviews", draft.reviews.filter((x) => x.id !== r.id))} /></span>
                    </div>
                  </div>
                );
              }}
            />
          )}
          <AddRow label="Add review" disabled={disabled || draft.reviews.length >= 12} onClick={() => set("reviews", [...draft.reviews, { id: newId("review"), source: "", rating: "", quote: "", asOf: today }])} />
        </div>
      </SectionCard>
      </div>

      <div role="tabpanel" id="why-buy-panel-amenities" aria-labelledby="why-buy-tab-amenities" hidden={group !== "amenities"} className="min-w-0">
      <SectionCard icon="coffee" title="Amenities & services" description="What a visitor can count on at this dealership. Only what you set appears.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectNotSpecified label="Service department" value={draft.dealer_service_location} disabled={disabled} onChange={(v) => set("dealer_service_location", v)} options={[["onsite", "On-site (same location as sales)"], ["offsite", "Off-site (separate location)"], ["none", "No service department"]]} />
          {offsite && (
            <FieldRow label="Off-site service address" help={<SourceLine>Shown only because service is off-site.</SourceLine>}>
              {(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_service_address} disabled={disabled} onChange={(e) => set("dealer_service_address", e.target.value)} />}
            </FieldRow>
          )}
          <SelectNotSpecified label="Vehicle delivery" value={draft.dealer_delivery} disabled={disabled} onChange={(v) => set("dealer_delivery", v)} options={[["none", "Not offered"], ["local", "Local"], ["regional", "Regional"], ["nationwide", "Nationwide"]]} />
          <SelectNotSpecified label="Financing on-site" value={draft.dealer_financing} disabled={disabled} onChange={(v) => set("dealer_financing", v)} options={[["yes", "Yes"]]} />
        </div>
        <ChipInput label="Services offered" values={draft.services} disabled={disabled} validate={chipValidate} max={20} placeholder="Type a service and press Enter" onChange={(v) => set("services", v)} />
        <ChipInput label="Amenities" values={draft.amenities} disabled={disabled} validate={chipValidate} max={20} placeholder="Type an amenity and press Enter" onChange={(v) => set("amenities", v)} />
        <div className="rounded-lg border border-adm-divider bg-adm-workspace p-4">
          <OwnedValue label="Mobile slide-out CTA style" value={CTA_LABELS[cta] ?? cta} source="Dealer settings (mobile_slideout_cta_variant). Owned by the Calls to action editor, not edited on this page." editTo={adminTabHref("calls-to-action")} editLabel="Calls to action" />
        </div>
      </SectionCard>
      </div>

      <div role="tabpanel" id="why-buy-panel-awards" aria-labelledby="why-buy-tab-awards" hidden={group !== "awards"} className="min-w-0">
      <SectionCard icon="award" title="Awards" description="Manufacturer and industry recognition. Add only awards the dealership holds.">
        {draft.awards.length === 0 ? (
          <EditorEmpty artwork="documents" title="No awards added" description="Awards appear to shoppers only after you add them here." className="py-6" />
        ) : (
          <SortableList
            label="Awards"
            items={awardItems}
            onChange={(next) => set("awards", next.map(({ label: _l, ...a }) => a))}
            renderItem={(item) => {
              const a = draft.awards.find((x) => x.id === item.id) as AwardItem;
              return (
                <div className="grid gap-3 py-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] sm:items-end">
                  <FieldRow label="Award" error={errs.awards[a.id]}>{(p) => <input {...p} className={INPUT_CLASS} value={a.name} disabled={disabled} onChange={(e) => patchAward(a.id, { name: e.target.value })} />}</FieldRow>
                  <FieldRow label="Awarded by" optional>{(p) => <input {...p} className={INPUT_CLASS} value={a.issuer} disabled={disabled} onChange={(e) => patchAward(a.id, { issuer: e.target.value })} />}</FieldRow>
                  <span className="flex justify-end sm:justify-center"><RemoveButton label={`Remove award ${a.name}`.trim()} disabled={disabled} onClick={() => set("awards", draft.awards.filter((x) => x.id !== a.id))} /></span>
                </div>
              );
            }}
          />
        )}
        <AddRow label="Add award" disabled={disabled || draft.awards.length >= 20} onClick={() => set("awards", [...draft.awards, { id: newId("award"), name: "", issuer: "" }])} />
        <AdvancedDisclosure title="IIHS Top Safety Pick statements">
          <p className="text-[14px] leading-[20px] text-adm-muted">IIHS ratings are copyrighted. Showing them needs IIHS's written permission. Keep this off until permission is granted, then check each model against the IIHS site before adding it. Text only, no IIHS logos.</p>
          <SwitchField label={draft.iihs_awards_enabled ? "IIHS statements on" : "IIHS statements off"} checked={draft.iihs_awards_enabled} disabled={disabled} onChange={(v) => set("iihs_awards_enabled", v)} />
          <ul className="space-y-3" aria-label="IIHS award rows">
            {draft.iihs_awards.map((a, i) => (
              <li key={i} className="space-y-1">
                <div className="grid grid-cols-2 sm:grid-cols-[88px_1fr_1fr_170px_auto] gap-2 items-end">
                  <FieldRow label="Year">{(p) => <input {...p} inputMode="numeric" className={INPUT_CLASS} value={a.year} disabled={disabled} onChange={(e) => set("iihs_awards", draft.iihs_awards.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />}</FieldRow>
                  <FieldRow label="Make">{(p) => <input {...p} className={INPUT_CLASS} value={a.make} disabled={disabled} onChange={(e) => set("iihs_awards", draft.iihs_awards.map((x, j) => (j === i ? { ...x, make: e.target.value } : x)))} />}</FieldRow>
                  <FieldRow label="Model">{(p) => <input {...p} className={INPUT_CLASS} value={a.model} disabled={disabled} onChange={(e) => set("iihs_awards", draft.iihs_awards.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))} />}</FieldRow>
                  <FieldRow label="Award">{(p) => (
                    <SelectField {...p} value={a.award} disabled={disabled} onChange={(e) => set("iihs_awards", draft.iihs_awards.map((x, j) => (j === i ? { ...x, award: e.target.value as typeof a.award } : x)))}>
                      <option value="tsp">Top Safety Pick</option>
                      <option value="tsp_plus">Top Safety Pick+</option>
                    </SelectField>
                  )}</FieldRow>
                  <IconButton name="close" label={`Remove IIHS row ${i + 1}`} disabled={disabled} onClick={() => set("iihs_awards", draft.iihs_awards.filter((_, j) => j !== i))} />
                </div>
                {errs.iihs[i] && <p role="alert" className="text-[13px] leading-[18px] font-medium text-adm-danger">{errs.iihs[i]}</p>}
              </li>
            ))}
          </ul>
          <AddRow label="Add IIHS row" disabled={disabled} onClick={() => set("iihs_awards", [...draft.iihs_awards, { year: "", make: "", model: "", award: "tsp_plus" }])} />
        </AdvancedDisclosure>
      </SectionCard>
      </div>

      <div role="tabpanel" id="why-buy-panel-advisor" aria-labelledby="why-buy-tab-advisor" hidden={group !== "advisor"} className="min-w-0">
      <SectionCard icon="user" title="Advisor" description="The person shown in the customer conversion panel. Leave blank for a generic specialist card.">
        {team.length > 0 && (
          <FieldRow label="Choose from your team" optional help={<>People listed in <EditLink to={adminTabHref("routing")}>Contact & Routing</EditLink>. Choosing one fills the fields below.</>}>
            {(p) => (
              <SelectField {...p} value="" disabled={disabled} onChange={(e) => {
                const a = team.find((t) => t.id === e.target.value);
                if (!a) return;
                set("dealer_advisor_name", a.name);
                set("dealer_advisor_title", a.title ?? "");
                if (a.photoUrl) set("dealer_advisor_photo", a.photoUrl);
              }}>
                <option value="">Select a person</option>
                {team.map((t) => <option key={t.id} value={t.id}>{t.name}{t.title ? `, ${t.title}` : ""}</option>)}
              </SelectField>
            )}
          </FieldRow>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <FieldRow label="Advisor name" optional>{(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_advisor_name} disabled={disabled} autoComplete="off" onChange={(e) => set("dealer_advisor_name", e.target.value)} />}</FieldRow>
          <FieldRow label="Advisor title" optional>{(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_advisor_title} disabled={disabled} onChange={(e) => set("dealer_advisor_title", e.target.value)} />}</FieldRow>
          <FieldRow label="Typical response time" optional className="md:col-span-2" help="Only enter a response time you can keep.">{(p) => <input {...p} className={INPUT_CLASS} value={draft.dealer_advisor_response} disabled={disabled} onChange={(e) => set("dealer_advisor_response", e.target.value)} />}</FieldRow>
        </div>
        <PhotoField
          label="Advisor photo"
          src={draft.dealer_advisor_photo}
          onChange={(u) => set("dealer_advisor_photo", u)}
          onUpload={(f) => void upload(f, "advisor")}
          uploading={uploading === "advisor"}
          error={uploadError?.kind === "advisor" ? uploadError.message : null}
          disabled={disabled}
          uploadOff={source.isFixture}
          urlError={errs.top.dealer_advisor_photo}
        />
      </SectionCard>
      </div>

      <ConfirmDialog
        open={confirmRefresh}
        title="Refresh the Google rating and save it now?"
        confirmLabel="Refresh and save now"
        onCancel={() => setConfirmRefresh(false)}
        onConfirm={() => void refreshGoogle()}
      >
        <p>This asks Google for your current rating and review count, then saves them to your account immediately. It is not part of Review and Apply, so Discard cannot undo it.</p>
        <p>The customer Passport shows the new rating as soon as it is saved. If Google finds no match, nothing changes.</p>
      </ConfirmDialog>

      <DetailDrawer open={previewOpen} onClose={() => setPreviewOpen(false)} title="Customer preview" description="Draft values. Only populated facts appear.">
        <WhyBuyPreview draft={draft} dealerName={dealerName} />
      </DetailDrawer>
    </BrandEditorFrame>
  );
}

