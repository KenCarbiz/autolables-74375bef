import { cn } from "@/lib/utils";
import { AdminButton } from "@/components/admin/v2/primitives";
import InstallerContactsCard from "@/components/admin/InstallerContactsCard";
import { AdminIcon, AdminIconTile, DetailDrawer, FieldRow, INPUT_CLASS, StatusBadge, SwitchField, useIsNarrow } from "@/components/admin/v3/editor";
import { Link } from "react-router-dom";
import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import { CHOICE_LABEL, emailProblem, summarize, type Group, type Item, type StoreDraft } from "./storeSettingsModel";
import { Banner } from "./bits";

const OnOff = ({ on }: { on: boolean }) => (
  <span className={cn("inline-flex items-center gap-1.5 text-[13px] leading-[18px] font-semibold", on ? "text-adm-success" : "text-adm-muted")}>
    <AdminIcon name={on ? "check-circle" : "ban"} size="inline" />{on ? "On" : "Off"}
  </span>
);

export const GroupCard = ({ group, draft, settings, changes, canEdit, onOpen }: { group: Group; draft: StoreDraft; settings: DealerSettings; changes: number; canEdit: boolean; onOpen: () => void }) => {
  const narrow = useIsNarrow();
  const sum = summarize(group, draft, settings);
  const rows = group.items.filter((i): i is Extract<Item, { kind: "switch" | "linked" | "status" }> => i.kind === "switch" || i.kind === "linked" || i.kind === "status");
  const shown = narrow ? rows.slice(0, 2) : rows.slice(0, 4);
  const lines = narrow ? (shown.length ? [] : sum.lines.slice(0, 2)) : sum.lines.slice(0, 2);
  const more = narrow ? rows.length + sum.lines.length - lines.length - shown.length : rows.length - shown.length;
  return (
    <li className={cn("rounded-xl border bg-adm-surface p-4 sm:p-5 flex flex-col gap-3 min-w-0", changes ? "border-adm-primary ring-1 ring-adm-primary/30" : "border-adm-divider")} data-group={group.id}>
      <div className="flex items-start gap-3">
        <AdminIconTile name={group.icon} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{group.title}</h2>
          <p className="text-[13px] leading-[18px] text-adm-muted">{group.blurb}</p>
        </div>
        <AdminButton variant={canEdit && group.id !== "integrations" ? "primary" : "secondary"} onClick={onOpen} className="flex-shrink-0" aria-label={`${group.id === "integrations" || !canEdit ? "View details" : "Configure"}: ${group.title}`}>
          {group.id === "integrations" || !canEdit ? "View" : "Configure"}
        </AdminButton>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {sum.total > 0 && <StatusBadge state={sum.on > 0 ? "enabled" : "disabled"} label={`${sum.on} of ${sum.total} on`} />}
        {changes > 0 && <StatusBadge state="overridden" label={changes === 1 ? "1 change" : `${changes} changes`} />}
      </div>
      <ul className="space-y-1.5" aria-label={`${group.title} summary`}>
        {lines.map((l) => <li key={l} className="text-[14px] leading-[20px] text-adm-ink">{l}</li>)}
        {shown.map((r) => {
          const on = r.kind === "switch" ? draft[r.key] : r.read(settings);
          return (
            <li key={r.kind === "switch" ? r.key : r.label} className="flex items-center justify-between gap-3 text-[14px] leading-[20px]">
              <span className="min-w-0 break-words text-adm-ink">{r.label}</span>
              <OnOff on={on} />
            </li>
          );
        })}
        {more > 0 && <li className="text-[13px] leading-[18px] text-adm-muted">and {more} more</li>}
      </ul>
    </li>
  );
};

const ChoiceGroup = ({ item, value, onChange, disabled }: { item: Extract<Item, { kind: "choice" }>; value: string; onChange: (v: string) => void; disabled: boolean }) => (
  <fieldset className="min-w-0">
    <legend className="text-[14px] leading-[20px] font-semibold text-adm-ink">{item.label}</legend>
    {item.description && <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">{item.description}</p>}
    <div role="radiogroup" aria-label={item.label} className="mt-2 grid grid-cols-1 gap-2">
      {item.options.map((o) => {
        const on = value === o.value;
        return (
          <label key={o.value} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5 min-h-[44px]", on ? "border-adm-primary bg-adm-selected" : "border-adm-divider", disabled ? "cursor-default opacity-80" : "cursor-pointer hover:border-adm-primary")}>
            <input type="radio" name={item.key} value={o.value} checked={on} disabled={disabled} onChange={() => onChange(o.value)} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[rgb(var(--adm-primary))]" />
            <span className="min-w-0"><span className="block text-[14px] leading-[20px] font-medium text-adm-ink">{o.label}</span>{o.detail && <span className="block text-[13px] leading-[18px] text-adm-muted">{o.detail}</span>}</span>
          </label>
        );
      })}
    </div>
  </fieldset>
);

export const GroupDrawer = ({ group, draft, settings, canEdit, errors, onSet, onClose }: {
  group: Group | null; draft: StoreDraft; settings: DealerSettings; canEdit: boolean; errors: Partial<Record<string, string>>; onSet: (key: keyof StoreDraft, value: StoreDraft[keyof StoreDraft]) => void; onClose: () => void;
}) => {
  const set = onSet as (key: string, value: unknown) => void;
  return (
    <DetailDrawer open={!!group} onClose={onClose} title={group?.title ?? "Settings"} description={group ? (canEdit && group.id !== "integrations" ? "Changes stay in your draft until you review and apply them." : group.blurb) : undefined}
      footer={<AdminButton variant="primary" onClick={onClose}>Done</AdminButton>}>
      {group && !canEdit && group.id !== "integrations" && <Banner tone="neutral" icon="lock" title="Read only">You can see these settings but not change them.</Banner>}
      {group?.items.map((it, i) => {
        if (it.kind === "switch") {
          const blocked = it.requires ? !draft[it.requires] : false;
          return (
            <div key={it.key} className="border-b border-adm-divider pb-4 last:border-0 last:pb-0">
              {canEdit ? <SwitchField label={it.label} checked={draft[it.key]} disabled={blocked && !draft[it.key]} onChange={(v) => set(it.key, v)} /> : <div className="flex items-center justify-between gap-3"><span className="text-[14px] font-medium text-adm-ink">{it.label}</span><OnOff on={draft[it.key]} /></div>}
              {it.beta && <span className="ml-1 align-middle"><StatusBadge state="setup_required" label="Beta" /></span>}
              <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">{it.description}{blocked ? ` ${it.requiresText}` : ""}</p>
            </div>
          );
        }
        if (it.kind === "choice") {
          return canEdit
            ? <ChoiceGroup key={it.key} item={it} value={draft[it.key]} onChange={(v) => set(it.key, v)} disabled={false} />
            : <div key={it.key} className="flex items-center justify-between gap-3"><span className="text-[14px] font-medium text-adm-ink">{it.label}</span><span className="text-[14px] text-adm-ink">{CHOICE_LABEL(it, draft[it.key])}</span></div>;
        }
        if (it.kind === "text") {
          if (it.when && !draft[it.when]) return null;
          const err = errors[it.key] ?? (it.emails ? emailProblem(draft[it.key], it.emails) : null);
          return canEdit ? (
            <FieldRow key={it.key} label={it.label} htmlFor={`store-${it.key}`} help={it.help} error={err ?? undefined} optional>
              {(p) => it.multiline
                ? <textarea {...p} rows={3} value={draft[it.key]} placeholder={it.placeholder} onChange={(e) => set(it.key, e.target.value)} className={cn(INPUT_CLASS, "resize-y")} />
                : <input {...p} type="text" value={draft[it.key]} placeholder={it.placeholder} onChange={(e) => set(it.key, e.target.value)} className={INPUT_CLASS} />}
            </FieldRow>
          ) : (
            <div key={it.key}><p className="text-[14px] font-medium text-adm-ink">{it.label}</p><p className="text-[14px] text-adm-ink break-words">{draft[it.key] || <span className="italic text-adm-muted">Not set</span>}</p></div>
          );
        }
        if (it.kind === "linked") {
          const on = it.read(settings);
          return (
            <div key={`linked-${i}`} className="rounded-lg border border-adm-divider bg-adm-workspace p-4 space-y-2" data-linked-setting="ingest_auto_publish">
              <div className="flex items-start justify-between gap-3"><p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{it.label}</p><OnOff on={on} /></div>
              <p className="text-[13px] leading-[18px] text-adm-muted">{it.description}</p>
              <p className="text-[14px] text-adm-ink">{on ? it.on : it.off}</p>
              <p className="text-[13px] leading-[18px] text-adm-muted">This is one stored setting. It is changed only in Publishing policy, with a review, so every page that shows it agrees.</p>
              <Link to={it.href} className="inline-flex items-center gap-1 min-h-[40px] max-sm:min-h-[44px] text-[14px] font-semibold text-adm-primary hover:underline">{it.linkLabel}<AdminIcon name="chevron-right" size="inline" /></Link>
            </div>
          );
        }
        if (it.kind === "installers") {
          return (
            <div key="installers" className="space-y-2">
              <Banner tone="info" title="Installers save as you add them">The installer list is its own record. Adding, pausing or removing an installer happens immediately and is not part of the draft.</Banner>
              {canEdit ? <InstallerContactsCard /> : <p className="text-[14px] text-adm-muted">Only people who can manage settings can edit the installer list.</p>}
            </div>
          );
        }
        return (
          <div key={it.label} className="flex items-center justify-between gap-3 border-b border-adm-divider pb-3 last:border-0">
            <span className="text-[14px] text-adm-ink">{it.label}</span>
            <StatusBadge state={it.read(settings) ? "enabled" : "unavailable"} label={it.read(settings) ? "Enabled for your store" : "Contact support to enable"} />
          </div>
        );
      })}
    </DetailDrawer>
  );
};
