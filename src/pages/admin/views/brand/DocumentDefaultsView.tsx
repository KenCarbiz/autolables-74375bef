import { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AdminIcon, AdvancedDisclosure, DraftActionBar, FieldRow, LeaveGuardDialog, ReviewChangesDialog, ScopeLabel, SectionCard, SelectField,
} from "@/components/admin/v3/editor";
import { adminTabHref } from "@/lib/admin/sections";
import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import type { LabelDefaults, LabelSlot } from "@/lib/labelDefaults";
import { useEstimatorSummary } from "./paymentEstimator/summary";
import { directPatch, useSettingsEditor } from "./feeds/useSettingsEditor";
import { Banner, LinkRow, TenantScope } from "./feeds/bits";
import { BuyersGuideChoice, EstimatorCard, PickerDialog, PreviewDialog, SlotCard } from "./feeds/DocParts";
import { ORIGIN_LABEL, fixtureRegistry, resolveSlot, sampleBranding, SLOT_ORDER, useTemplateRegistry, type RegistryFixture, type RegistryState, type TemplateEntry } from "./feeds/templateRegistry";

const OemReference = lazy(() => import("./feeds/OemReference"));

type DocDraft = {
  label_addendum_new: string;
  label_addendum_used: string;
  label_window_used: string;
  label_window_new: string;
  default_ftc_warranty: string;
  default_new_addendum: string;
  default_used_window: string;
  default_used_addendum: string;
};

const SLOT_KEY: Record<LabelSlot, keyof DocDraft> = {
  addendum_new: "label_addendum_new",
  addendum_used: "label_addendum_used",
  window_used: "label_window_used",
  window_new: "label_window_new",
};

const LAYOUTS = [
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
  { value: "compact", label: "Compact" },
];

const FTC = [
  { value: "as_is", label: "As-Is, no warranty", detail: "The vehicle is sold with no dealer warranty. This is the usual used-car default." },
  { value: "implied", label: "Implied warranties only", detail: "The dealer gives no written warranty but state implied warranties apply." },
  { value: "dealer", label: "Dealer warranty", detail: "The dealer provides a written warranty. Terms are entered per vehicle." },
];

const readDocs = (s: DealerSettings): DocDraft => ({
  label_addendum_new: s.label_defaults?.addendum_new ?? "",
  label_addendum_used: s.label_defaults?.addendum_used ?? "",
  label_window_used: s.label_defaults?.window_used ?? "",
  label_window_new: s.label_defaults?.window_new ?? "",
  default_ftc_warranty: s.default_ftc_warranty || "as_is",
  default_new_addendum: s.default_new_addendum || "standard",
  default_used_window: s.default_used_window || "standard",
  default_used_addendum: s.default_used_addendum || "standard",
});

const toPatch = (changed: Partial<DocDraft>, settings: DealerSettings): Partial<DealerSettings> => {
  const patch: Record<string, unknown> = {};
  const labels: LabelDefaults = { ...(settings.label_defaults || {}) };
  let labelsChanged = false;
  for (const slot of SLOT_ORDER) {
    const v = changed[SLOT_KEY[slot]];
    if (v) { labels[slot] = v; labelsChanged = true; }
  }
  if (labelsChanged) patch.label_defaults = labels;
  for (const k of ["default_ftc_warranty", "default_new_addendum", "default_used_window", "default_used_addendum"] as const) {
    if (changed[k] !== undefined) patch[k] = changed[k];
  }
  return patch as Partial<DealerSettings>;
};

const ftcLabel = (v: unknown) => FTC.find((o) => o.value === v)?.label ?? String(v);
const layoutLabel = (v: unknown) => LAYOUTS.find((o) => o.value === v)?.label ?? String(v);

const OPTIONS = {
  read: readDocs,
  toPatch,
  fixtureViewId: "document-defaults",
  labels: {
    label_addendum_new: "New addendum template",
    label_addendum_used: "Used addendum template",
    label_window_used: "Used window sticker template",
    label_window_new: "New window sticker template",
    default_ftc_warranty: "Buyers Guide warranty designation",
    default_new_addendum: "New addendum layout style",
    default_used_window: "Used window sticker layout style",
    default_used_addendum: "Used addendum layout style",
  } satisfies Record<keyof DocDraft, string>,
  describe: (key: string, value: unknown) => {
    if (key === "default_ftc_warranty") return ftcLabel(value);
    if (key.startsWith("default_")) return layoutLabel(value);
    return value ? String(value) : "No default";
  },
};

export default function DocumentDefaultsView() {
  const fixture = useViewFixture<RegistryFixture>("document-defaults");
  const injected = useMemo(() => (fixture ? fixtureRegistry(fixture) : null), [fixture]);
  return injected ? <DocumentDefaultsBody registry={injected} /> : <LiveDocumentDefaults />;
}

function LiveDocumentDefaults() {
  return <DocumentDefaultsBody registry={useTemplateRegistry()} />;
}

function DocumentDefaultsBody({ registry }: { registry: RegistryState }) {
  const ed = useSettingsEditor<DocDraft>(OPTIONS);
  const { source, edit, canEdit } = ed;
  const estimatorLive = useEstimatorSummary();
  const estimatorSummary = source.isFixture && ed.variant === "none" ? { kind: "none" as const } : source.isFixture && ed.variant === "partial" ? { kind: "saved" as const, enabled: true, ranges: 1, complete: false, updatedAt: null } : estimatorLive.summary;
  const [picking, setPicking] = useState<LabelSlot | null>(null);
  const [previewing, setPreviewing] = useState<TemplateEntry | null>(null);
  const draft = edit.draft;
  const branding = useMemo(() => sampleBranding(ed.settings), [ed.settings]);

  const explicit: LabelDefaults = useMemo(() => {
    if (!draft) return {};
    const out: LabelDefaults = {};
    for (const slot of SLOT_ORDER) if (draft[SLOT_KEY[slot]]) out[slot] = draft[SLOT_KEY[slot]];
    return out;
  }, [draft]);
  const resolved = useMemo(() => SLOT_ORDER.map((slot) => resolveSlot(slot, explicit, registry.entries, registry.legacyByKind)), [explicit, registry.entries, registry.legacyByKind]);

  if (!draft) return <div className="h-48 rounded-xl border border-adm-divider bg-adm-surface animate-pulse" aria-busy="true" aria-label="Loading document defaults" />;

  const entryNames = new Map(registry.entries.map((e) => [e.ref, `${e.name} (${e.id}, ${e.version})`]));
  const reviewRows = ed.rows.map((r) => (r.id.startsWith("label_") ? { ...r, before: entryNames.get(String(r.before)) ?? r.before, after: entryNames.get(String(r.after)) ?? r.after } : r));
  const counts = { dealer: registry.entries.length };
  const missing = resolved.filter((r) => r.state === "missing");
  const pickingResolved = picking ? resolved.find((r) => r.slot === picking) : null;

  return (
    <div className="space-y-4">
      <TenantScope summary="The payment estimator below is the one per-store setting." />

      {!canEdit && <Banner tone="neutral" icon="lock" title="You can view these defaults but not change them">Changing document defaults needs the manage settings permission. Ask an owner or manager to make the change.</Banner>}
      {ed.unreadable && <Banner tone="danger" title="Settings could not be read">Nothing is shown as saved and nothing can be applied until the settings load.</Banner>}
      {!registry.archiveReadable && !registry.loading && <Banner tone="warning" title="Template archive not readable">Versions and retirement could not be read from the template archive, so templates show as built in. Selection still works.</Banner>}
      {missing.length > 0 && <Banner tone="danger" title={missing.length === 1 ? "A saved default is missing from the registry" : `${missing.length} saved defaults are missing from the registry`}>Documents already made are unchanged, but new ones cannot use a template that is not registered. Choose a replacement.</Banner>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" aria-label="Kinds of document">
        {(["dealer_label", "oem_reproduction", "oem_original"] as const).map((k) => (
          <div key={k} className="rounded-xl border border-adm-divider bg-adm-surface p-4 flex items-start gap-3">
            <AdminIcon name={k === "oem_original" ? "lock" : k === "oem_reproduction" ? "copy" : "file"} size="card" className="mt-0.5 text-adm-primary flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{ORIGIN_LABEL[k].label}</p>
              <p className="text-[13px] leading-[18px] text-adm-muted">{ORIGIN_LABEL[k].detail}</p>
              <p className="mt-1 text-[13px] leading-[18px] font-medium text-adm-ink">{k === "dealer_label" ? `${counts.dealer} in the registry. Selectable here.` : k === "oem_reproduction" ? "Chosen per vehicle by make. Not a dealer default." : "Attached per vehicle. Not selectable."}</p>
            </div>
          </div>
        ))}
      </div>

      <SectionCard icon="layers" title="Default templates" description="What each generator starts with for a new or used vehicle. Existing documents keep the template they were made with.">
        <Link to="/sticker-studio" className="inline-flex items-center gap-1.5 min-h-[44px] -my-2 text-[14px] font-semibold text-adm-primary hover:underline">Open Sticker Studio <AdminIcon name="external-link" size="inline" /></Link>
        {registry.loading ? (
          <ul className="grid grid-cols-1 xl:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading templates">{[0, 1, 2, 3].map((i) => <li key={i} className="h-[320px] rounded-xl border border-adm-divider bg-adm-workspace animate-pulse" />)}</ul>
        ) : (
          <ul className="grid grid-cols-1 xl:grid-cols-2 gap-4" aria-label="Default templates">
            {resolved.map((r) => (
              <SlotCard key={r.slot} slot={r.slot} resolved={r} entry={r.entry} branding={branding} canEdit={canEdit}
                changed={edit.changedKeys.includes(SLOT_KEY[r.slot])} onChange={() => setPicking(r.slot)} onPreview={() => setPreviewing(r.entry)} />
            ))}
          </ul>
        )}
        <p className="max-sm:hidden text-[13px] leading-[18px] text-adm-muted">Thumbnails are drawn by the live template renderer with sample vehicle data. A builder with no stored preview shows a placeholder, never a made-up image. The same default is also editable under Documents &amp; Service, Templates (linked below); both write the same stored setting.</p>
      </SectionCard>

      <SectionCard icon="book" title="Buyers Guide default" description="The FTC Used Car Rule form has one prescribed layout, so only its default warranty designation is chosen here.">
        <BuyersGuideChoice value={draft.default_ftc_warranty} onChange={(v) => edit.set("default_ftc_warranty", v)} canEdit={canEdit} options={FTC} />
        <p className="text-[13px] leading-[18px] text-adm-muted">Applies to used vehicles, including CPO. New and demo vehicles do not get a Buyers Guide.</p>
      </SectionCard>

      <SectionCard icon="calculator" title="Passport payment estimator" description="Retail finance assumptions shoppers see on the Passport. Configured separately for each store.">
        <EstimatorCard summary={estimatorSummary} storeName={estimatorLive.storeName} />
      </SectionCard>

      <AdvancedDisclosure title="Advanced: layout style and registry reference">
        <div className="space-y-5">
          <div>
            <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">Layout style (legacy)</h3>
            <p className="text-[13px] leading-[18px] text-adm-muted">Three older style values are still saved with your settings. No generator in this version reads them, so changing them does not change a document. They are kept so nothing already saved is lost.</p>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
              {([["default_new_addendum", "New-car addendum style"], ["default_used_window", "Used-car window sticker style"], ["default_used_addendum", "Used-car addendum style"]] as const).map(([k, label]) => (
                <FieldRow key={k} label={label} htmlFor={`legacy-${k}`}>
                  {(p) => (
                    <SelectField {...p} value={draft[k]} disabled={!canEdit} onChange={(e) => edit.set(k, e.target.value)}>
                      {LAYOUTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </SelectField>
                  )}
                </FieldRow>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">Reproduction templates in the registry</h3>
            <p className="text-[13px] leading-[18px] text-adm-muted">Read-only. These are chosen per vehicle from its make and are never approved or published from this page.</p>
            <Suspense fallback={<p className="mt-3 text-[14px] text-adm-muted">Loading the registry.</p>}><OemReference /></Suspense>
          </div>
        </div>
      </AdvancedDisclosure>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LinkRow to={adminTabHref("templates")} icon="file" title="Templates and print stock" description="Paper size, pre-printed stock and the template archive" />
        <LinkRow to={adminTabHref("approval-rules")} icon="shield-check" title="Approval rules" description="Who must approve a document before it prints or publishes" />
      </div>

      {canEdit && <DraftActionBar state={ed.barState} onDiscard={ed.discard} onReview={ed.flow.openReview} onRetry={() => void ed.apply()} onRefresh={ed.refresh} retryDisabled={!ed.canApply} />}

      <PickerDialog slot={picking} open={!!picking} onClose={() => setPicking(null)} entries={registry.entries} current={pickingResolved?.ref ?? null} branding={branding}
        onPick={(ref) => picking && edit.set(SLOT_KEY[picking], ref)} />
      <PreviewDialog entry={previewing} branding={branding} onClose={() => setPreviewing(null)} />

      <ReviewChangesDialog open={ed.flow.phase === "reviewing" || ed.flow.phase === "saving"} scope={<ScopeLabel scope="all_rooftops" />}
        timing="Used the next time a document is generated. Documents already produced are not changed or regenerated."
        changes={reviewRows} impact={<p className="text-[14px] text-adm-muted">Only the slots listed change. Other defaults, approved templates and signed records stay as they are.</p>}
        applying={ed.flow.phase === "saving"} applyDisabled={!ed.canApply} error={!ed.canApply ? ed.blockedReason : undefined}
        onCancel={ed.flow.closeReview} onApply={() => void ed.apply()} />
      <LeaveGuardDialog open={ed.guard.pending} onStay={ed.guard.stay} onLeave={ed.guard.leave} />
    </div>
  );
}

