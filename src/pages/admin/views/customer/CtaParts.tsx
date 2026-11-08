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
      disabled={!canEdit}
      onChange={(next) => onReorder(next.map(({ id: _id, ...b }) => b))}
      renderItem={(b) => {
        const spec = specOf(b.key);
        const av = spec ? availabilityOf(spec, ctx) : null;
        const primary = cfg.primary_key === b.key;
        const bad = unsafeDestination(b);
        const btn = "inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] min-w-[44px] px-3 rounded-md border text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary disabled:opacity-60";
        return (
          <div className="min-w-0 space-y-1">
            <div className="flex items-start gap-2 min-w-0">
              {spec && <span className="max-sm:hidden"><AdminIconTile name={spec.icon} tone="neutral" /></span>}
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-[20px] font-semibold text-adm-ink break-words">{b.label}</p>
                <p className="max-sm:hidden text-[13px] leading-[18px] text-adm-muted break-words">{spec?.destination ?? "Not a supported action"}</p>
                {bad && <p role="alert" className="text-[13px] leading-[18px] font-medium text-adm-danger">{bad}</p>}
              </div>
              {av && av.state !== "enabled" && <StatusBadge state={av.state} label={av.label} />}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button" aria-pressed={primary} disabled={!canEdit} aria-label={`${primary ? "Primary button" : "Make primary"}: ${b.label}`} onClick={() => onPrimary(b.key)} className={cn(btn, primary ? "bg-adm-selected border-adm-primary text-adm-primary" : "bg-adm-surface border-adm-border text-adm-ink hover:bg-adm-workspace")}>
                <AdminIcon name="star" size="compact" />
                {primary ? "Primary" : "Make primary"}
              </button>
              <IconButton name="edit" label={`Edit ${b.label}`} onClick={() => onEdit(b.key)} />
              <IconButton name="close" label={`Remove ${b.label}`} disabled={!canEdit} onClick={() => onRemove(b.key)} />
            </div>
          </div>
        );
      }}
    />
  );
}

export function ActionLibrary({ cfg, ctx, canEdit, onAdd }: { cfg: StickyBottomButtons; ctx: CtaContext; canEdit: boolean; onAdd: (key: string) => void }) {
  const picked = new Set(selectedOf(cfg).map((b) => b.key));
  const atMax = picked.size >= MAX_STICKY_BUTTONS;
  return (
    <div className="space-y-5">
      {atMax && <p role="status" className="text-[14px] leading-[20px] text-adm-muted">Four buttons are selected, the maximum. Remove one to add another.</p>}
      {GROUP_ORDER.map((g) => {
        const specs = ACTION_SPECS.filter((s) => s.group === g && !picked.has(s.key));
        if (specs.length === 0) return null;
        return (
          <div key={g}>
            <h3 className="text-[14px] leading-[20px] font-semibold text-adm-ink">{g}</h3>
            <ul aria-label={g} className="mt-2 grid gap-2 sm:grid-cols-2 [&>li:last-child:nth-child(odd)]:sm:col-span-2">
              {specs.map((s) => {
                const av = availabilityOf(s, ctx);
                return (
                  <li key={s.key} className="flex items-center gap-3 rounded-lg border border-adm-divider px-3 py-2 min-h-[64px]">
                    <AdminIconTile name={s.icon} tone="neutral" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{labelOf(s.key)}</p>
                      <p className="text-[13px] leading-[18px] text-adm-muted break-words">{av.state === "enabled" ? s.destination : av.reason}</p>
                    </div>
                    <AdminButton variant="secondary" size="sm" className="min-h-[44px] min-w-[44px]" disabled={!canEdit || atMax} aria-label={`Add ${labelOf(s.key)}`} onClick={() => onAdd(s.key)}><AdminIcon name="plus" size="compact" />Add</AdminButton>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <p className="text-[13px] leading-[18px] text-adm-muted" data-credit-note="">Get Pre-Qualified and Apply for Financing open the payment sheet and are not hidden when Financing on-site is off. Hiding them would need a change to the Passport.</p>
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

export interface AfterHoursInput { routingRaw: unknown; agents: PassportAgent[]; now: Date }

const afterHoursState = (inp: AfterHoursInput) => {
  const routing: CustomerPassportContactSettings = normalizeContactRouting(inp.routingRaw);
  const tz = routing.timezone || undefined;
  const openAt = findSampleTime(routing.businessHours, tz, true, inp.now);
  const closedAt = findSampleTime(routing.businessHours, tz, false, inp.now);
  const sim = (at: Date | null) => (at ? simulateRoute({ routing, agents: inp.agents, now: at }) : null);
  return { routing, tz, openAt, closedAt, open: sim(openAt), closed: sim(closedAt) };
};

const behaviorText = (spec: ActionSpec | undefined, ctx: CtaContext, r: ReturnType<typeof simulateRoute> | null): string => {
  if (!spec) return "Not a supported action.";
  if (spec.kind === "native_call" || spec.kind === "native_text") return availabilityOf(spec, ctx).state === "enabled" ? "Uses the store phone at any hour." : "No store phone, so it opens the contact form.";
  if (spec.kind === "contact_form" || spec.kind === "request_form") return r ? (r.afterHours ? `Contact form shows: ${r.afterHoursMessage ?? "the after-hours message"}` : `Contact form shows: ${r.displayName}`) : "Follows routing.";
  return "Same at any hour.";
};

export function ActionEditorDrawer({ buttonKey, cfg, ctx, canEdit, count, onClose, onLabel, onPrimary, afterHours }: {
  buttonKey: string | null; cfg: StickyBottomButtons; ctx: CtaContext; canEdit: boolean; count: number; onClose: () => void; onLabel: (key: string, label: string) => void; onPrimary: (key: string) => void; afterHours: AfterHoursInput;
}) {
  const [picker, setPicker] = useState(false);
  const b = buttonKey ? cfg.buttons.find((x) => x.key === buttonKey) : undefined;
  const spec = buttonKey ? specOf(buttonKey) : undefined;
  const av = spec ? availabilityOf(spec, ctx) : null;
  const ah = useMemo(() => afterHoursState(afterHours), [afterHours]);
  const label = b?.label ?? "";
  const error = b && !label.trim() ? "Enter a label." : label.trim().length > LABEL_MAX ? `Use ${LABEL_MAX} characters or fewer.` : null;
  const crowded = count >= 3 && label.trim().length > LABEL_WARN;
  return (
    <>
      <DetailDrawer open={!!b} onClose={onClose} title={b ? `Edit ${STICKY_LABELS[b.key] ?? b.key}` : "Edit action"} description="Label, destination and after-hours behavior for this button." footer={<AdminButton variant="primary" onClick={onClose}>Done</AdminButton>}>
        {b && spec && av && (
          <div className="space-y-5">
            <FieldRow label="Button label" error={error} help={`${label.trim().length} of ${LABEL_MAX} characters. Long labels wrap onto a second line in the bar.`}>
              {(p) => <input {...p} className={INPUT_CLASS} maxLength={LABEL_MAX + 8} disabled={!canEdit} value={label} onChange={(e) => onLabel(b.key, e.target.value)} />}
            </FieldRow>
            {crowded && <p role="status" className="text-[13px] leading-[18px] text-adm-warning">With {count} buttons this label wraps to several lines on a small phone. Keep it near {LABEL_WARN} characters.</p>}
            <div className="rounded-lg border border-adm-divider p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Destination</p>
                <StatusBadge state={av.state} label={av.label} />
                <StatusBadge state="required" label="Fixed" />
              </div>
              <p className="text-[14px] leading-[20px] text-adm-ink break-words">{spec.destination}</p>
              <p className="text-[13px] leading-[18px] text-adm-muted break-words">{av.reason}</p>
              <p className="text-[13px] leading-[18px] text-adm-muted">The destination is fixed because the Passport maps each action to one of its own flows. A web address is never stored, so unsafe or off-account links cannot be set.</p>
              <AdminButton variant="secondary" onClick={() => setPicker(true)}>View destination options</AdminButton>
            </div>
            <div className="rounded-lg border border-adm-divider p-4 space-y-2" data-after-hours="">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">After hours</p>
              <p className="text-[13px] leading-[18px] text-adm-muted">Read only here. It comes from Contact & Routing, using the saved routing hours.</p>
              <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 text-[14px] leading-[20px]">
                <dt className="text-adm-muted">Open</dt><dd className="min-w-0 break-words">{ah.openAt ? behaviorText(spec, ctx, ah.open) : "Add routing hours to preview."}</dd>
                <dt className="text-adm-muted">Closed</dt><dd className="min-w-0 break-words">{ah.closedAt ? behaviorText(spec, ctx, ah.closed) : "Add routing hours to preview."}</dd>
              </dl>
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

export function StickyPreview({ cfg, mode }: { cfg: StickyBottomButtons; mode: "mobile" | "desktop" }) {
  const items = selectedOf(cfg).slice(0, MAX_STICKY_BUTTONS);
  const primary = items.some((b) => b.key === cfg.primary_key) ? cfg.primary_key : items[items.length - 1]?.key;
  const shown = cfg.enabled && items.length > 0;
  const page = (
    <div className="p-3 space-y-2" aria-hidden="true">
      <div className="flex items-center justify-between"><span className="h-3 w-20 rounded bg-[#CBD5E1]" /><span className="h-3 w-10 rounded bg-[#CBD5E1]" /></div>
      <div className="h-28 rounded-lg bg-[#E2E8F0] grid place-items-center text-[13px] text-[#475569]">Vehicle photo</div>
      <div className="rounded-lg bg-white border border-[#E6E8EC] p-3 space-y-1.5">
        <p className="text-[13px] font-semibold text-[#0F172A]">Year Make Model</p>
        <div className="h-2.5 w-2/3 rounded bg-[#E2E8F0]" />
        <p className="text-[13px] text-[#475569]">Today's price</p>
        <div className="h-2.5 w-1/3 rounded bg-[#E2E8F0]" />
      </div>
      <div className="h-10 rounded-lg bg-white border border-[#E6E8EC]" />
    </div>
  );
  if (mode === "desktop") {
    return (
      <div className="rounded-xl border border-adm-divider bg-[#F4F6F9] p-3 space-y-3" data-preview="desktop">
        <div className="h-8 rounded-md bg-white border border-adm-divider" aria-hidden="true" />
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
          <div className="rounded-md bg-white border border-adm-divider">{page}</div>
          <div className="rounded-md bg-white border border-adm-divider p-2 text-[13px] leading-[18px] text-adm-muted">Customer Action Center</div>
        </div>
        <p className="text-[13px] leading-[18px] text-adm-ink" role="status">On desktop the Passport shows its Action Center and does not show this bottom bar. These buttons appear on phones and tablets.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[28px] border-[6px] border-[#1B2B3B] bg-[#F4F6F9] overflow-hidden flex flex-col min-h-[460px]">
      <div className="flex-1">{page}</div>
      {shown ? (
        <div data-sticky-preview="" className="border-t border-[#E6E8EC] bg-white px-3 py-2.5 grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
          {items.map((b) => {
            const spec = specOf(b.key);
            const isPrimary = b.key === primary;
            return (
              <span key={b.key} className={cn("min-h-[44px] rounded-xl inline-flex flex-col items-center justify-center gap-0.5 text-[13px] leading-[16px] font-bold px-1.5 py-1.5 min-w-0 text-center break-words", isPrimary ? "bg-[#1451c4] text-white" : "bg-[#F1F5F9] text-[#0F172A] border border-[#E6E8EC]")}>
                {spec && <AdminIcon name={spec.icon} size="compact" className="flex-shrink-0" />}
                <span className="min-w-0 [overflow-wrap:anywhere]">{b.label}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="px-3 pb-4 text-center text-[13px] leading-[18px] text-adm-muted" role="status">{cfg.enabled ? "No buttons selected." : "Sticky bar is off. No bar appears."}</p>
      )}
    </div>
  );
}

export function AfterHoursCtaDrawer({ open, onClose, cfg, ctx, routingRaw, agents, now }: { open: boolean; onClose: () => void; cfg: StickyBottomButtons; ctx: CtaContext } & AfterHoursInput) {
  const ah = useMemo(() => afterHoursState({ routingRaw, agents, now }), [routingRaw, agents, now]);
  const selected = selectedOf(cfg);
  const view = (title: string, at: Date | null, r: ReturnType<typeof simulateRoute> | null) => (
    <div className="rounded-lg border border-adm-divider p-4 space-y-2 min-w-0">
      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{title}</p>
      {at ? <p className="text-[13px] leading-[18px] text-adm-muted">{formatInstant(at, ah.tz)}</p> : <p className="text-[13px] leading-[18px] text-adm-muted">Add routing hours in Contact & Routing to preview this state.</p>}
      {at && (
        <ul className="divide-y divide-adm-divider">
          {selected.map((b) => <li key={b.key} className="py-2 text-[14px] leading-[20px]"><span className="font-medium text-adm-ink">{b.label}</span><span className="block text-[13px] leading-[18px] text-adm-muted break-words">{behaviorText(specOf(b.key), ctx, r)}</span></li>)}
          {selected.length === 0 && <li className="py-2 text-[13px] text-adm-muted">No buttons selected.</li>}
        </ul>
      )}
    </div>
  );
  return (
    <DetailDrawer open={open} onClose={onClose} title="After-hours preview" description="What each selected button does inside and outside the saved routing hours." footer={<AdminButton variant="primary" onClick={onClose}>Close</AdminButton>}>
      <div className="space-y-4">
        <PreviewOnlyNotice>Uses the saved routing settings, not this draft. After-hours behavior is edited in Contact & Routing. Nothing is sent.</PreviewOnlyNotice>
        {view("Open", ah.openAt, ah.open)}
        {view("Closed", ah.closedAt, ah.closed)}
      </div>
    </DetailDrawer>
  );
}
