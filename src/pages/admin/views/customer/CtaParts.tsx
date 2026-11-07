import { useMemo, useState } from "react";
import { AdminButton } from "@/components/admin/v2/primitives";
import {
  AdminIcon, AdminIconTile, DetailDrawer, EditorEmpty, FieldRow, IconButton, INPUT_CLASS, PreviewOnlyNotice, SortableList, StatusBadge,
} from "@/components/admin/v3/editor";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MAX_STICKY_BUTTONS, STICKY_LABELS, type StickyBottomButtons, type StickyButton } from "@/lib/stickyButtons";
import { normalizeContactRouting, type CustomerPassportContactSettings, type PassportAgent } from "@/lib/passportRouting";
import { findSampleTime, formatInstant, simulateRoute } from "./routingModel";
import {
  ACTION_SPECS, availabilityOf, destinationOptions, GROUP_ORDER, LABEL_MAX, LABEL_WARN, labelOf, selectedOf, specOf, unsafeDestination, type ActionSpec, type CtaContext,
} from "./ctaModel";

export function SelectedActions({ cfg, ctx, canEdit, onReorder, onPrimary, onEdit, onRemove }: {
  cfg: StickyBottomButtons; ctx: CtaContext; canEdit: boolean; onReorder: (next: StickyButton[]) => void; onPrimary: (key: string) => void; onEdit: (key: string) => void; onRemove: (key: string) => void;
}) {
  const selected = selectedOf(cfg);
  if (selected.length === 0) {
    return <EditorEmpty artwork="activity" title="No buttons selected" description={cfg.enabled ? "Add up to four actions from the library. The sticky bar needs at least one while it is on." : "The sticky bar is off, so shoppers see no bottom buttons."} />;
  }
  const items = selected.map((b) => ({ ...b, id: b.key }));
  return (
    <SortableList
      label="Selected buttons"
      items={items}
      onChange={(next) => onReorder(next.map(({ id: _id, ...b }) => b))}
      renderItem={(b) => {
        const spec = specOf(b.key);
        const av = spec ? availabilityOf(spec, ctx) : null;
        const primary = cfg.primary_key === b.key;
        const bad = unsafeDestination(b);
        return (
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {spec && <AdminIconTile name={spec.icon} tone="neutral" />}
            <div className="min-w-0 flex-1 basis-[120px]">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink break-words">{b.label}</p>
              <p className="text-[13px] leading-[18px] text-adm-muted break-words">{spec?.destination ?? "Not a supported action"}</p>
              {bad && <p role="alert" className="text-[13px] leading-[18px] font-medium text-adm-danger">{bad}</p>}
            </div>
            {av && <StatusBadge state={av.state} label={av.label} />}
            <button type="button" aria-pressed={primary} disabled={!canEdit} aria-label={`${primary ? "Primary button" : "Make primary"}: ${b.label}`} onClick={() => onPrimary(b.key)} className={cn("inline-flex items-center gap-1.5 min-h-[40px] max-sm:min-h-[44px] px-3 rounded-md border text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary disabled:opacity-60", primary ? "bg-adm-selected border-adm-primary text-adm-primary" : "bg-adm-surface border-adm-border text-adm-ink hover:bg-adm-workspace")}>
              <AdminIcon name="star" size="compact" />
              {primary ? "Primary" : "Make primary"}
            </button>
            <IconButton name="edit" label={`Edit ${b.label}`} onClick={() => onEdit(b.key)} />
            <IconButton name="close" label={`Remove ${b.label}`} disabled={!canEdit} onClick={() => onRemove(b.key)} />
          </div>
        );
      }}
    />
  );
}

export function ActionLibrary({ cfg, ctx, canEdit, onAdd }: { cfg: StickyBottomButtons; ctx: CtaContext; canEdit: boolean; onAdd: (key: string) => void }) {
  const picked = new Set(selectedOf(cfg).map((b) => b.key));
  const atMax = picked.size >= MAX_STICKY_BUTTONS;
  const hiddenCredit = ACTION_SPECS.filter((s) => s.needs === "financing" && !ctx.financingOn && !picked.has(s.key));
  return (
    <div className="space-y-5">
      {atMax && <p role="status" className="text-[14px] leading-[20px] text-adm-muted">Four buttons are selected, the maximum. Remove one to add another.</p>}
      {GROUP_ORDER.map((g) => {
        const specs = ACTION_SPECS.filter((s) => s.group === g && !picked.has(s.key) && !(s.needs === "financing" && !ctx.financingOn));
        if (specs.length === 0) return null;
        return (
          <div key={g}>
            <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">{g}</h3>
            <ul aria-label={g} className="mt-2 grid gap-2 sm:grid-cols-2">
              {specs.map((s) => {
                const av = availabilityOf(s, ctx);
                return (
                  <li key={s.key} className="flex items-center gap-3 rounded-lg border border-adm-divider px-3 py-2 min-h-[64px]">
                    <AdminIconTile name={s.icon} tone="neutral" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{labelOf(s.key)}</p>
                      <p className="text-[13px] leading-[18px] text-adm-muted break-words">{av.state === "enabled" ? s.destination : av.reason}</p>
                    </div>
                    <AdminButton variant="secondary" size="sm" disabled={!canEdit || atMax} aria-label={`Add ${labelOf(s.key)}`} onClick={() => onAdd(s.key)}><AdminIcon name="plus" size="compact" />Add</AdminButton>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {hiddenCredit.length > 0 && (
        <p className="text-[13px] leading-[18px] text-adm-muted" data-hidden-credit="">
          {hiddenCredit.map((s) => labelOf(s.key)).join(" and ")} {hiddenCredit.length === 1 ? "is" : "are"} hidden because Financing on-site is off. Turn it on in Why Buy to offer {hiddenCredit.length === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}

export function DestinationPicker({ open, onClose, spec }: { open: boolean; onClose: () => void; spec: ActionSpec | null }) {
  if (!spec) return null;
  const options = destinationOptions(spec);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-admin-v3="" className="max-w-md bg-adm-surface text-adm-ink border-adm-border">
        <DialogTitle className="text-[18px] leading-[26px] font-semibold">Where {labelOf(spec.key)} goes</DialogTitle>
        <DialogDescription className="text-[14px] leading-[20px] text-adm-muted">Each action opens one fixed place in the Passport. Only supported destinations can be chosen.</DialogDescription>
        <ul role="radiogroup" aria-label="Destination" className="space-y-2">
          {options.map((o) => (
            <li key={o.id} role="radio" aria-checked={o.supported} aria-disabled={!o.supported} className={cn("rounded-lg border px-3 py-2.5 flex items-start gap-3", o.supported ? "border-adm-primary bg-adm-selected" : "border-adm-divider opacity-80")}>
              <AdminIcon name={o.supported ? "check-circle" : "ban"} className={cn("mt-0.5", o.supported ? "text-adm-primary" : "text-adm-muted")} />
              <div className="min-w-0">
                <p className="text-[14px] leading-[20px] font-semibold">{o.label}</p>
                <p className="text-[13px] leading-[18px] text-adm-muted break-words">{o.supported ? spec.destination : o.reason}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end"><AdminButton variant="primary" onClick={onClose}>Done</AdminButton></div>
      </DialogContent>
    </Dialog>
  );
}

export function ActionEditorDrawer({ buttonKey, cfg, ctx, canEdit, count, onClose, onLabel, onPrimary }: {
  buttonKey: string | null; cfg: StickyBottomButtons; ctx: CtaContext; canEdit: boolean; count: number; onClose: () => void; onLabel: (key: string, label: string) => void; onPrimary: (key: string) => void;
}) {
  const [picker, setPicker] = useState(false);
  const b = buttonKey ? cfg.buttons.find((x) => x.key === buttonKey) : undefined;
  const spec = buttonKey ? specOf(buttonKey) : undefined;
  const av = spec ? availabilityOf(spec, ctx) : null;
  const label = b?.label ?? "";
  const error = b && !label.trim() ? "Enter a label." : label.trim().length > LABEL_MAX ? `Use ${LABEL_MAX} characters or fewer.` : null;
  const crowded = count >= 3 && label.trim().length > LABEL_WARN;
  return (
    <>
      <DetailDrawer open={!!b} onClose={onClose} title={b ? `Edit ${STICKY_LABELS[b.key] ?? b.key}` : "Edit action"} description="Label and destination for this button." footer={<AdminButton variant="primary" onClick={onClose}>Done</AdminButton>}>
        {b && spec && av && (
          <div className="space-y-5">
            <FieldRow label="Button label" error={error} help={`${label.trim().length} of ${LABEL_MAX} characters. Shorter labels fit four buttons on a phone.`}>
              {(p) => <input {...p} className={INPUT_CLASS} maxLength={LABEL_MAX + 8} disabled={!canEdit} value={label} onChange={(e) => onLabel(b.key, e.target.value)} />}
            </FieldRow>
            {crowded && <p role="status" className="text-[13px] leading-[18px] text-adm-warning">With {count} buttons this label may be cut off on a small phone. Keep it near {LABEL_WARN} characters.</p>}
            <div className="rounded-lg border border-adm-divider p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Destination</p>
                <StatusBadge state={av.state} label={av.label} />
              </div>
              <p className="text-[14px] leading-[20px] text-adm-ink break-words">{spec.destination}</p>
              <p className="text-[13px] leading-[18px] text-adm-muted break-words">{av.reason}</p>
              <AdminButton variant="secondary" onClick={() => setPicker(true)}>View destination options</AdminButton>
            </div>
            <label className="flex items-center gap-3 min-h-[44px] text-[14px] text-adm-ink">
              <input type="radio" name="primary-cta" className="w-5 h-5 accent-[var(--adm-primary,#2457D6)]" checked={cfg.primary_key === b.key} disabled={!canEdit} onChange={() => onPrimary(b.key)} />
              Primary button. Exactly one button is primary.
            </label>
          </div>
        )}
      </DetailDrawer>
      <DestinationPicker open={picker && !!spec} onClose={() => setPicker(false)} spec={spec ?? null} />
    </>
  );
}

const PhoneFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="mx-auto w-full max-w-[340px] rounded-[28px] border-[6px] border-[#1B2B3B] bg-[#F4F6F9] overflow-hidden relative h-[440px]">{children}</div>
);

export function StickyPreview({ cfg, mode }: { cfg: StickyBottomButtons; mode: "mobile" | "desktop" }) {
  const items = selectedOf(cfg).slice(0, MAX_STICKY_BUTTONS);
  const primary = items.some((b) => b.key === cfg.primary_key) ? cfg.primary_key : items[items.length - 1]?.key;
  const shown = cfg.enabled && items.length > 0;
  if (mode === "desktop") {
    return (
      <div className="rounded-xl border border-adm-divider bg-[#F4F6F9] p-3 space-y-3" data-preview="desktop">
        <div className="h-10 rounded-md bg-white border border-adm-divider" aria-hidden="true" />
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
          <div className="h-40 rounded-md bg-white border border-adm-divider" aria-hidden="true" />
          <div className="rounded-md bg-white border border-adm-divider p-2 text-[13px] leading-[18px] text-adm-muted">Customer Action Center</div>
        </div>
        <p className="text-[13px] leading-[18px] text-adm-ink" role="status">On desktop the Passport shows its Action Center and does not show this bottom bar. These buttons appear on phones and tablets.</p>
      </div>
    );
  }
  return (
    <PhoneFrame>
      <div className="p-3 space-y-2" aria-hidden="true">
        <div className="h-36 rounded-lg bg-white border border-[#E6E8EC]" />
        <div className="h-5 w-2/3 rounded bg-white border border-[#E6E8EC]" />
        <div className="h-5 w-1/2 rounded bg-white border border-[#E6E8EC]" />
        <div className="h-16 rounded-lg bg-white border border-[#E6E8EC]" />
      </div>
      {shown ? (
        <div data-sticky-preview="" className="absolute inset-x-0 bottom-0 border-t border-[#E6E8EC] bg-white/95 px-3 py-2.5 grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
          {items.map((b) => {
            const spec = specOf(b.key);
            const isPrimary = b.key === primary;
            return (
              <span key={b.key} className={cn("h-11 rounded-xl inline-flex items-center justify-center gap-1.5 text-[13px] font-bold px-2 min-w-0", isPrimary ? "bg-[#1a6dff] text-white" : "bg-[#F1F5F9] text-[#0F172A] border border-[#E6E8EC]")}>
                {spec && <AdminIcon name={spec.icon} size="compact" className="flex-shrink-0" />}
                <span className="truncate">{b.label}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="absolute inset-x-3 bottom-4 text-center text-[13px] leading-[18px] text-adm-muted" role="status">{cfg.enabled ? "No buttons selected." : "Sticky bar is off. No bar appears."}</p>
      )}
    </PhoneFrame>
  );
}

export function AfterHoursCtaDrawer({ open, onClose, cfg, ctx, routingRaw, agents, now }: { open: boolean; onClose: () => void; cfg: StickyBottomButtons; ctx: CtaContext; routingRaw: unknown; agents: PassportAgent[]; now: Date }) {
  const routing: CustomerPassportContactSettings = useMemo(() => normalizeContactRouting(routingRaw), [routingRaw]);
  const tz = routing.timezone || undefined;
  const openAt = findSampleTime(routing.businessHours, tz, true, now);
  const closedAt = findSampleTime(routing.businessHours, tz, false, now);
  const selected = selectedOf(cfg);
  const contact = (at: Date | null) => (at ? simulateRoute({ routing, agents, now: at }) : null);
  const view = (title: string, at: Date | null) => {
    const r = contact(at);
    return (
      <div className="rounded-lg border border-adm-divider p-4 space-y-2 min-w-0">
        <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{title}</p>
        {at ? <p className="text-[13px] leading-[18px] text-adm-muted">{formatInstant(at, tz)}</p> : <p className="text-[13px] leading-[18px] text-adm-muted">Add routing hours in Contact & Routing to preview this state.</p>}
        {at && r && (
          <ul className="divide-y divide-adm-divider">
            {selected.map((b) => {
              const spec = specOf(b.key);
              const viaForm = spec?.kind === "contact_form" || spec?.kind === "request_form";
              const text = spec?.kind === "native_call" || spec?.kind === "native_text"
                ? availabilityOf(spec, ctx).state === "enabled" ? "Uses the store phone at any hour." : "No store phone, so it opens the contact form."
                : viaForm ? (r.afterHours ? `Contact form: ${r.afterHoursMessage ?? "after-hours message"}` : `Contact form: ${r.displayName}`) : "Same at any hour.";
              return <li key={b.key} className="py-2 text-[14px] leading-[20px]"><span className="font-medium text-adm-ink">{b.label}</span><span className="block text-[13px] leading-[18px] text-adm-muted break-words">{text}</span></li>;
            })}
            {selected.length === 0 && <li className="py-2 text-[13px] text-adm-muted">No buttons selected.</li>}
          </ul>
        )}
      </div>
    );
  };
  return (
    <DetailDrawer open={open} onClose={onClose} title="After-hours preview" description="What each selected button does inside and outside the saved routing hours." footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
      <div className="space-y-4">
        <PreviewOnlyNotice>Uses the saved routing settings, not this draft. After-hours behavior is edited in Contact & Routing. Nothing is sent.</PreviewOnlyNotice>
        {view("Open", openAt)}
        {view("Closed", closedAt)}
      </div>
    </DetailDrawer>
  );
}
