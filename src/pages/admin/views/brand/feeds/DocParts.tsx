import { Component, useId, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { AdminButton, AdminLinkButton } from "@/components/admin/v2/primitives";
import { useReturnFocus } from "@/components/admin/v2/useReturnFocus";
import { AdminIcon, AdminIconTile, EditorArtwork, IconButton, StatusBadge, useIsNarrow } from "@/components/admin/v3/editor";
import { TemplateRenderer, type StickerBranding } from "@/lib/stickerStudio/templates";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import type { EstimatorSummary } from "../paymentEstimator/summary";
import {
  compatibility, ORIGIN_LABEL, SAMPLE_DATA, SOURCE_TEXT, SLOT_TITLE, slotDef,
  type ResolvedSlot, type TemplateEntry,
} from "./templateRegistry";
import type { LabelSlot } from "@/lib/labelDefaults";

export const OriginBadge = ({ origin }: { origin: keyof typeof ORIGIN_LABEL }) => (
  <StatusBadge state={origin === "oem_reproduction" ? "stale" : "internal_publication"} label={ORIGIN_LABEL[origin].label} />
);

export const AvailabilityBadge = ({ availability }: { availability: TemplateEntry["availability"] | "missing" }) =>
  availability === "available" ? <StatusBadge state="enabled" label="Available" />
    : availability === "retired" ? <StatusBadge state="unavailable" label="Retired" />
    : <StatusBadge state="failed" label="Not in registry" />;

class PreviewBoundary extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-center justify-center gap-1 h-full px-3 text-center text-adm-danger">
        <AdminIcon name="alert" size="card" />
        <p className="text-[13px] leading-[18px] font-semibold">Preview failed to draw</p>
        <p className="text-[13px] leading-[18px] text-adm-muted">{this.props.name} was not replaced with another template.</p>
      </div>
    );
  }
}

export const NoPreview = ({ label = "No preview for this option", compact }: { label?: string; compact?: boolean }) => (
  <div className="flex flex-col items-center justify-center gap-1 h-full px-3 text-center">
    <EditorArtwork name="no-preview" className={compact ? "h-[56px] w-[88px]" : "h-[72px] w-[112px]"} />
    <p className="text-[13px] leading-[18px] font-medium text-adm-muted">{label}</p>
  </div>
);

/**
 * Real layout at true paper ratio inside a fixed-size frame, never cropped. The frame is an image of the layout
 * with sample data, so it is exposed as one labelled image and its inner sample text is presentational.
 */
export const Thumb = ({ entry, branding, size = "card" }: { entry: TemplateEntry; branding: StickerBranding; size?: "card" | "small" | "mini" }) => {
  const dims = size === "card" ? { w: 168, h: 224, scale: 0.2 } : size === "small" ? { w: 120, h: 160, scale: 0.14 } : { w: 144, h: 192, scale: 0.17 };
  return (
    <div className="rounded-lg border border-adm-divider bg-adm-workspace overflow-hidden flex items-center justify-center flex-shrink-0 mx-auto" style={{ width: dims.w, height: dims.h }} data-preview={entry.template ? "renderer" : "none"}
      {...(entry.template ? { role: "img", "aria-label": `Layout preview of ${entry.name}, drawn with sample data` } : {})}>
      {entry.template ? (
        <PreviewBoundary name={entry.name}>
          <div className="pointer-events-none" aria-hidden="true" {...{ inert: "" }}><TemplateRenderer template={entry.template} data={SAMPLE_DATA} branding={branding} scale={dims.scale} /></div>
        </PreviewBoundary>
      ) : (
        <NoPreview label="Builder: no stored preview" compact />
      )}
    </div>
  );
};

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex justify-between gap-3 py-1.5 border-b border-adm-divider last:border-0">
    <dt className="text-[13px] leading-[18px] text-adm-muted flex-shrink-0">{label}</dt>
    <dd className="text-[13px] leading-[18px] font-medium text-adm-ink text-right min-w-0 break-words">{children}</dd>
  </div>
);

export const EntryFacts = ({ entry }: { entry: TemplateEntry }) => (
  <dl>
    <Fact label="Registry ID"><code className="text-[13px]">{entry.id}</code></Fact>
    <Fact label="Version">{entry.version}</Fact>
    <Fact label="Document type">{entry.documentType}</Fact>
    <Fact label="Paper size">{entry.paper}</Fact>
    <Fact label="Availability"><AvailabilityBadge availability={entry.availability} /></Fact>
  </dl>
);

export const SlotCard = ({ resolved, slot, entry, branding, canEdit, onChange, onPreview, changed }: {
  resolved: ResolvedSlot; slot: LabelSlot; entry: TemplateEntry | null; branding: StickerBranding; canEdit: boolean; onChange: () => void; onPreview: () => void; changed: boolean;
}) => {
  const def = slotDef(slot);
  const narrow = useIsNarrow();
  return (
    <li className={cn("rounded-xl border bg-adm-surface flex flex-col min-w-0", changed ? "border-adm-primary ring-1 ring-adm-primary/30" : "border-adm-divider")} data-slot={slot}>
      <header className="flex items-start gap-3 px-4 pt-4">
        <AdminIconTile name={def.kind === "window" ? "file" : "file-plus"} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{SLOT_TITLE[slot]}</h3>
          <p className="text-[13px] leading-[18px] text-adm-muted">{def.sub}</p>
        </div>
        {changed && <StatusBadge state="overridden" label="Changed" />}
      </header>
      <div className="p-4 grid grid-cols-[120px_minmax(0,1fr)] min-[520px]:grid-cols-[168px_minmax(0,1fr)] min-[520px]:grid-rows-[auto_auto_1fr] gap-x-4 gap-y-3 flex-1">
        <div className="min-[520px]:row-span-3">
          {entry ? <><div className="hidden min-[520px]:block"><Thumb entry={entry} branding={branding} size="card" /></div><div className="min-[520px]:hidden"><Thumb entry={entry} branding={branding} size="small" /></div></> : (
            <div className="rounded-lg border border-dashed border-adm-border bg-adm-workspace mx-auto w-[120px] h-[160px] min-[520px]:w-[168px] min-[520px]:h-[224px]"><NoPreview label={resolved.state === "missing" ? "Saved template not found" : "No default chosen"} compact /></div>
          )}
        </div>
        {entry ? (
          <>
            <div className="min-w-0">
              <p className="text-[16px] leading-[22px] font-semibold text-adm-ink break-words">{entry.name}</p>
              {!narrow && <div className="mt-1.5 flex flex-wrap gap-1.5"><OriginBadge origin={entry.origin} /></div>}
              {narrow && <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">{SOURCE_TEXT[resolved.source]}.</p>}
            </div>
            <div className="col-span-2 min-[520px]:col-span-1 min-w-0">
              {narrow ? (
                <details className="group">
                  <summary className="flex items-center justify-between gap-2 min-h-[44px] cursor-pointer list-none text-[14px] font-semibold text-adm-primary">
                    <span className="flex items-center gap-2 flex-wrap min-w-0"><OriginBadge origin={entry.origin} /></span>
                    <span className="inline-flex items-center gap-1 flex-shrink-0">Details<AdminIcon name="chevron-down" className="group-open:rotate-180" /></span>
                  </summary>
                  <EntryFacts entry={entry} />
                  {entry.note && <p className="mt-2 text-[13px] leading-[18px] text-adm-muted">{entry.note}</p>}
                </details>
              ) : (
                <>
                  <EntryFacts entry={entry} />
                  <p className="mt-2 text-[13px] leading-[18px] text-adm-muted">{SOURCE_TEXT[resolved.source]}.{entry.note ? ` ${entry.note}` : ""}</p>
                </>
              )}
            </div>
          </>
        ) : resolved.state === "missing" ? (
          <div role="alert" className="col-span-2 min-[520px]:col-span-1 rounded-lg bg-adm-danger-bg px-3 py-2 text-[14px] leading-[20px] text-adm-danger">
            <p className="font-semibold">The saved default is not in the registry</p>
            <p className="text-adm-ink/80">Saved value <code className="text-[13px] break-all">{resolved.ref}</code>. Documents made earlier are unchanged. Choose a template to replace it.</p>
          </div>
        ) : (
          <p className="col-span-2 min-[520px]:col-span-1 text-[14px] leading-[20px] text-adm-muted">No default is set for this slot, so the generator asks each time.</p>
        )}
        <div className="col-span-2 min-[520px]:col-span-1 flex flex-wrap gap-2 self-end">
          {canEdit && <AdminButton variant="primary" onClick={onChange}>Change template</AdminButton>}
          {entry && <AdminButton variant="secondary" onClick={onPreview}><AdminIcon name="eye" />Preview</AdminButton>}
        </div>
      </div>
    </li>
  );
};

const DialogShell = ({ open, onClose, title, description, children, footer, wide }: { open: boolean; onClose: () => void; title: string; description: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) => {
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0B1526]/50" />
        <DialogPrimitive.Content data-admin-v3="" onCloseAutoFocus={returnFocus}
          className={cn("fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)] max-sm:inset-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-auto max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none max-sm:border-0 flex flex-col rounded-xl bg-adm-surface border border-adm-border shadow-xl text-adm-ink", wide ? "sm:max-w-[1040px]" : "sm:max-w-[720px]")}>
          <header className="flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-4 border-b border-adm-divider">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[20px] leading-[28px] font-bold">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[14px] leading-[20px] text-adm-muted">{description}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild><IconButton name="close" label="Close" /></DialogPrimitive.Close>
          </header>
          <div className="px-5 sm:px-6 py-5 overflow-y-auto min-h-0 flex-1">{children}</div>
          {footer && <footer className="px-5 sm:px-6 py-4 border-t border-adm-divider flex items-center justify-end gap-3 flex-wrap">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export const PreviewDialog = ({ entry, branding, onClose }: { entry: TemplateEntry | null; branding: StickerBranding; onClose: () => void }) => {
  const narrow = useIsNarrow();
  return (
    <DialogShell open={!!entry} onClose={onClose} title={entry?.name ?? "Preview"} description="Drawn by the same renderer that produces the document, with sample vehicle data. It is not a real vehicle."
      footer={<AdminButton variant="primary" onClick={onClose}>Close preview</AdminButton>}>
      {entry && (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px] gap-6">
          <div className="rounded-lg border border-adm-divider bg-adm-workspace p-4 flex justify-center overflow-x-auto" data-preview={entry.template ? "renderer" : "none"}>
            {entry.template ? (
              <PreviewBoundary name={entry.name}><TemplateRenderer template={entry.template} data={SAMPLE_DATA} branding={branding} scale={narrow ? 0.34 : 0.6} /></PreviewBoundary>
            ) : (
              <div className="h-[260px] w-full"><NoPreview label="This builder has no stored preview. Open it to see the live layout." /></div>
            )}
          </div>
          <div className="space-y-3">
            <OriginBadge origin={entry.origin} />
            <p className="text-[14px] leading-[20px] text-adm-muted">{ORIGIN_LABEL[entry.origin].detail}</p>
            <EntryFacts entry={entry} />
          </div>
        </div>
      )}
    </DialogShell>
  );
};

export const PickerDialog = ({ slot, open, onClose, entries, current, onPick, branding }: {
  slot: LabelSlot | null; open: boolean; onClose: () => void; entries: TemplateEntry[]; current: string | null; onPick: (ref: string) => void; branding: StickerBranding;
}) => {
  const [choice, setChoice] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<TemplateEntry | null>(null);
  const groupId = useId();
  const def = slot ? slotDef(slot) : null;
  const selected = choice ?? current;
  const rows = def ? entries.map((e) => ({ e, c: compatibility(e, def.kind, def.condition) })) : [];
  const ok = rows.filter((r) => r.c.ok);
  const blocked = rows.filter((r) => !r.c.ok);
  const done = () => { if (choice && choice !== current) onPick(choice); setChoice(null); onClose(); };
  const cancel = () => { setChoice(null); onClose(); };
  const card = (e: TemplateEntry, reason: string | null) => {
    const on = selected === e.ref;
    return (
      <li key={e.ref}>
        <button type="button" role="radio" aria-checked={on} aria-disabled={!!reason} aria-describedby={reason ? `${groupId}-${e.id}` : undefined}
          onClick={() => { if (!reason) setChoice(e.ref); }}
          className={cn("w-full text-left rounded-xl border p-3 flex flex-col gap-2 min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary",
            reason ? "border-adm-divider bg-adm-workspace opacity-80 cursor-not-allowed" : on ? "border-adm-primary ring-2 ring-adm-primary/30 bg-adm-selected" : "border-adm-divider bg-adm-surface hover:border-adm-primary")}>
          <Thumb entry={e} branding={branding} size="mini" />
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink break-words">{e.name}</span>
              <span className="block text-[13px] leading-[18px] text-adm-muted">{e.documentType}, {e.paper}</span>
              <span className="block text-[13px] leading-[18px] text-adm-muted"><code className="text-[13px]">{e.id}</code>, {e.version}</span>
            </span>
            {on && <AdminIcon name="check-circle" size="card" className="text-adm-primary flex-shrink-0" />}
          </span>
          <span className="flex flex-wrap gap-1.5"><OriginBadge origin={e.origin} /><AvailabilityBadge availability={e.availability} /></span>
          {reason && <span id={`${groupId}-${e.id}`} className="text-[13px] leading-[18px] text-adm-ink flex items-start gap-1.5"><AdminIcon name="ban" size="inline" className="mt-px text-adm-muted" />{reason}</span>}
        </button>
        {!reason && <button type="button" onClick={() => setPreviewing(e)} className="mt-1 inline-flex items-center gap-1.5 min-h-[40px] max-sm:min-h-[44px] px-1 text-[14px] font-semibold text-adm-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary rounded-md"><AdminIcon name="eye" size="inline" />Preview {e.name}</button>}
      </li>
    );
  };
  return (
    <>
      <DialogShell open={open} onClose={cancel} wide title={def ? `Choose the ${SLOT_TITLE[slot as LabelSlot].toLowerCase()} template` : "Choose a template"}
        description="Only templates that fit this document are selectable. Choosing one changes your draft; nothing is saved until you review and apply."
        footer={<><AdminButton variant="secondary" onClick={cancel}>Cancel</AdminButton><AdminButton variant="primary" onClick={done} disabled={!choice || choice === current}>Use this template</AdminButton></>}>
        <div className="space-y-6">
          <section aria-label="Compatible templates">
            <h3 className="text-[16px] leading-[24px] font-semibold text-adm-ink">Compatible ({ok.length})</h3>
            {ok.length === 0 ? <p className="mt-2 text-[14px] text-adm-muted">No available template fits this slot.</p> : (
              <ul role="radiogroup" aria-label="Compatible templates" className="mt-3 grid grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-3 gap-4">{ok.map((r) => card(r.e, null))}</ul>
            )}
          </section>
          {blocked.length > 0 && (
            <section aria-label="Not compatible">
              <h3 className="text-[16px] leading-[24px] font-semibold text-adm-ink">Not compatible ({blocked.length})</h3>
              <p className="text-[14px] leading-[20px] text-adm-muted">Shown so you can see why they are unavailable here.</p>
              <ul className="mt-3 grid grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-3 gap-4">{blocked.map((r) => card(r.e, r.c.reason))}</ul>
            </section>
          )}
        </div>
      </DialogShell>
      <PreviewDialog entry={previewing} branding={branding} onClose={() => setPreviewing(null)} />
    </>
  );
};

export const BuyersGuideChoice = ({ value, onChange, canEdit, options }: { value: string; onChange: (v: string) => void; canEdit: boolean; options: { value: string; label: string; detail: string }[] }) => {
  const group = useId();
  return (
    <div role="radiogroup" aria-label="FTC Buyers Guide warranty designation" className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <label key={o.value} className={cn("rounded-xl border p-4 flex items-start gap-3 min-h-[44px]", on ? "border-adm-primary ring-1 ring-adm-primary/30 bg-adm-selected" : "border-adm-divider bg-adm-surface", canEdit ? "cursor-pointer hover:border-adm-primary" : "cursor-default")}>
            <input type="radio" name={group} value={o.value} checked={on} disabled={!canEdit} onChange={() => onChange(o.value)} className="mt-1 h-5 w-5 flex-shrink-0 accent-[rgb(var(--adm-primary))]" />
            <span className="min-w-0">
              <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink">{o.label}</span>
              <span className="block text-[13px] leading-[18px] text-adm-muted">{o.detail}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
};

export const EstimatorCard = ({ summary, storeName }: { summary: EstimatorSummary; storeName: string }) => {
  const view = (() => {
    if (summary.kind === "loading") return { state: "waiting_for_data" as const, label: "Checking", text: "Reading this store's saved assumptions." };
    if (summary.kind === "unknown") return { state: "unknown" as const, label: "Status unknown", text: "The saved assumptions could not be read here. Open the estimator to see them." };
    if (summary.kind === "none") return { state: "setup_required" as const, label: "Not configured", text: "No payment assumptions are saved, so shoppers see no payment estimate on the Passport." };
    if (!summary.complete) return { state: "setup_required" as const, label: "Incomplete", text: `${summary.ranges} model-year ${summary.ranges === 1 ? "range is" : "ranges are"} saved but the assumptions are not complete. No estimate is shown until they are.` };
    if (!summary.enabled) return { state: "disabled" as const, label: "Configured, turned off", text: "Assumptions are valid but the estimate is switched off, so shoppers see none." };
    return { state: "enabled" as const, label: "Configured and on", text: `${summary.ranges} model-year ${summary.ranges === 1 ? "range" : "ranges"} drive the estimate shown on the Passport.` };
  })();
  const applied = summary.kind === "saved" && summary.updatedAt ? new Date(summary.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <AdminIconTile name="calculator" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><StatusBadge state={view.state} label={view.label} /><span className="text-[13px] text-adm-muted">Store: {storeName}</span></div>
          <p className="mt-1 text-[14px] leading-[20px] text-adm-ink" aria-live="polite">{view.text}</p>
          {applied && <p className="text-[13px] leading-[18px] text-adm-muted">Last applied {applied}.</p>}
          <p className="text-[13px] leading-[18px] text-adm-muted">Terms, APRs and down payments are set in the estimator and are never worked out on this page.</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap flex-shrink-0">
        <AdminLinkButton to={ADMIN_CHILD_ROUTES.paymentEstimator} variant="primary">Configure estimator</AdminLinkButton>
        <AdminLinkButton to={ADMIN_CHILD_ROUTES.paymentAssumptions} variant="secondary">View assumptions</AdminLinkButton>
      </div>
    </div>
  );
};
